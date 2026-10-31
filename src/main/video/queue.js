const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { sanitizedEnvironment } = require("./tools");

const MAX_JOBS = 50;
const MAX_RETRIES = 2;

function formatError(stderr) {
  const text = String(stderr || "").toLowerCase();
  if (text.includes("drm")) return "目标内容受 DRM 保护，无法下载";
  if (text.includes("sign in") || text.includes("login")) {
    return "目标内容需要登录，当前版本不读取浏览器凭证";
  }
  if (text.includes("unsupported url")) return "yt-dlp 不支持该页面";
  if (text.includes("private video") || text.includes("not available")) {
    return "视频不可用或没有访问权限";
  }
  if (text.includes("http error 401") || text.includes("http error 403")) {
    return "目标站点拒绝访问，可能需要授权或登录";
  }
  if (text.includes("no such option") || text.includes("unrecognized arguments")) {
    return "yt-dlp 版本与当前参数不兼容，请更新视频工具";
  }
  if (text.includes("timed out") || text.includes("connection")) {
    return "网络连接失败";
  }
  return "下载失败，请检查网址、网络和下载组件";
}

function isRetryable(stderr) {
  const text = String(stderr || "").toLowerCase();
  return (
    !text.includes("unsupported url") &&
    !text.includes("drm") &&
    !text.includes("sign in") &&
    !text.includes("private video") &&
    (text.includes("timed out") ||
      text.includes("connection") ||
      text.includes("http error 5"))
  );
}

function sanitizeFilename(filename) {
  const cleaned = path
    .basename(filename)
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 180);
  return cleaned || `video-${Date.now()}.mp4`;
}

function parseProgress(line, job) {
  if (!line.startsWith("CAPRI_PROGRESS|")) return false;
  const [
    ,
    status,
    downloaded,
    totalBytesValue,
    totalEstimateValue,
    speed,
    eta,
    percentText
  ] = line.split("|");
  const downloadedBytes = Number(downloaded);
  const reportedTotal = Number(totalBytesValue);
  const estimatedTotal = Number(totalEstimateValue);
  const totalBytes = Number.isFinite(reportedTotal)
    ? reportedTotal
    : estimatedTotal;
  const speedBps = Number(speed);
  const etaSeconds = Number(eta);
  const numericPercent = Number.parseFloat(percentText);

  job.status = status === "finished" ? "processing" : "downloading";
  job.progress = {
    percent: Number.isFinite(numericPercent)
      ? Math.max(0, Math.min(100, numericPercent))
      : Number.isFinite(downloadedBytes) && Number.isFinite(totalBytes) && totalBytes > 0
        ? Math.min(100, (downloadedBytes / totalBytes) * 100)
        : 0,
    downloadedBytes: Number.isFinite(downloadedBytes) ? downloadedBytes : 0,
    totalBytes: Number.isFinite(totalBytes) ? totalBytes : null,
    speedBps: Number.isFinite(speedBps) ? speedBps : 0,
    etaSeconds: Number.isFinite(etaSeconds) ? etaSeconds : null
  };
  return true;
}

class DownloadQueue {
  constructor({ outputRoot, notifyJobs, notifyPet, toolsProvider }) {
    this.outputRoot = outputRoot;
    this.notifyJobs = notifyJobs;
    this.notifyPet = notifyPet;
    this.toolsProvider = toolsProvider;
    this.jobs = new Map();
    this.queued = [];
    this.activeJobId = null;
    this.emitTimer = null;
    this.closed = false;
  }

  emit(immediate = false) {
    if (this.closed) return;
    const send = () => {
      this.emitTimer = null;
      this.notifyJobs(this.list());
    };
    if (immediate) {
      clearTimeout(this.emitTimer);
      send();
      return;
    }
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(send, 180);
  }

  list() {
    return [...this.jobs.values()]
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((job) => ({
        id: job.id,
        status: job.status,
        title: job.title || job.sourceHost,
        sourceHost: job.sourceHost,
        progress: job.progress,
        outputPath: job.outputPath,
        error: job.error,
        retries: job.retries,
        createdAt: job.createdAt
      }));
  }

  add({ url, sourceHost }) {
    if (this.jobs.size >= MAX_JOBS) {
      const finished = [...this.jobs.values()]
        .filter((job) => ["completed", "failed", "cancelled"].includes(job.status))
        .sort((left, right) => left.createdAt - right.createdAt);
      while (this.jobs.size >= MAX_JOBS && finished.length > 0) {
        this.jobs.delete(finished.shift().id);
      }
      if (this.jobs.size >= MAX_JOBS) {
        throw new Error("下载任务已达到上限，请等待当前队列完成");
      }
    }
    const id = randomUUID();
    const job = {
      id,
      url,
      sourceHost,
      status: "queued",
      title: "",
      outputPath: "",
      error: "",
      retries: 0,
      createdAt: Date.now(),
      progress: {
        percent: 0,
        downloadedBytes: 0,
        totalBytes: null,
        speedBps: 0,
        etaSeconds: null
      },
      child: null,
      cancelled: false
    };
    this.jobs.set(id, job);
    this.queued.push(id);
    this.emit(true);
    this.processNext();
    return id;
  }

  cancel(id) {
    const job = this.jobs.get(id);
    if (!job) throw new Error("下载任务不存在");
    if (!["queued", "resolving", "downloading", "processing"].includes(job.status)) {
      return false;
    }
    job.cancelled = true;
    job.status = "cancelled";
    this.queued = this.queued.filter((jobId) => jobId !== id);
    if (job.child) this.killChild(job.child);
    this.emit(true);
    return true;
  }

  retry(id) {
    const job = this.jobs.get(id);
    if (!job) throw new Error("下载任务不存在");
    if (!["failed", "cancelled"].includes(job.status)) {
      throw new Error("当前任务状态不能重试");
    }
    job.status = "queued";
    job.error = "";
    job.cancelled = false;
    job.retries = 0;
    job.progress.percent = 0;
    this.queued.push(id);
    this.emit(true);
    this.processNext();
    return true;
  }

  async processNext() {
    if (this.closed || this.activeJobId) return;
    const id = this.queued.shift();
    if (!id) return;
    const job = this.jobs.get(id);
    if (!job || job.status !== "queued") {
      this.processNext();
      return;
    }

    this.activeJobId = id;
    try {
      await this.run(job);
    } catch (error) {
      await this.fail(job, error);
    } finally {
      this.activeJobId = null;
      this.emit(true);
      setImmediate(() => this.processNext());
    }
  }

  async run(job) {
    const tools = this.toolsProvider();
    if (!tools.available) {
      throw new Error("下载组件未安装，请先运行 npm run setup:video-tools");
    }

    const jobDir = path.join(this.outputRoot, ".partial", job.id);
    await fs.rm(jobDir, { recursive: true, force: true });
    await fs.mkdir(jobDir, { recursive: true });
    if (job.cancelled) {
      await fs.rm(jobDir, { recursive: true, force: true });
      return;
    }
    job.status = "resolving";
    this.emit(true);

    const outputTemplate = path.join(
      jobDir,
      "%(title).100B [%(id)s].%(ext)s"
    );
    const args = [
      "--ignore-config",
      "--no-playlist",
      "--no-warnings",
      "--no-colors",
      "--newline",
      "--windows-filenames",
      "--progress",
      "--progress-template",
      "download:CAPRI_PROGRESS|%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(progress._percent_str)s",
      "--print",
      "before_dl:CAPRI_TITLE|%(title)s",
      "--print",
      "after_move:CAPRI_FILE|%(filepath)s",
      "--format",
      "bv*+ba/b",
      "--merge-output-format",
      "mp4",
      "--ffmpeg-location",
      tools.ffmpegPath,
      "--output",
      outputTemplate,
      "--",
      job.url
    ];

    const child = spawn(tools.ytDlpPath, args, {
      shell: false,
      windowsHide: true,
      env: sanitizedEnvironment(),
      stdio: ["ignore", "pipe", "pipe"]
    });
    job.child = child;

    let stdoutBuffer = "";
    let stderrBuffer = "";
    let finalFile = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        if (parseProgress(line, job)) {
          this.emit();
        } else if (line.startsWith("CAPRI_TITLE|")) {
          job.title = line.slice("CAPRI_TITLE|".length).trim();
          this.emit();
        } else if (line.startsWith("CAPRI_FILE|")) {
          finalFile = line.slice("CAPRI_FILE|".length).trim();
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      stderrBuffer = `${stderrBuffer}${chunk}`.slice(-12000);
    });

    const exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    job.child = null;

    if (job.cancelled) {
      await fs.rm(jobDir, { recursive: true, force: true });
      job.status = "cancelled";
      job.progress.percent = 0;
      return;
    }
    if (exitCode !== 0) {
      const error = new Error(formatError(stderrBuffer));
      error.retryable = isRetryable(stderrBuffer);
      throw error;
    }
    if (!finalFile) {
      throw new Error("下载完成但未找到输出文件");
    }

    const realJobDir = await fs.realpath(jobDir);
    const realFile = await fs.realpath(finalFile);
    if (!realFile.startsWith(`${realJobDir}${path.sep}`)) {
      throw new Error("下载结果路径校验失败");
    }

    await fs.mkdir(this.outputRoot, { recursive: true });
    const targetBase = sanitizeFilename(path.basename(realFile));
    const finalPath = await this.uniqueTargetPath(targetBase);
    await fs.rename(realFile, finalPath);
    await fs.rm(jobDir, { recursive: true, force: true });

    job.status = "completed";
    job.outputPath = finalPath;
    job.progress.downloadedBytes = (await fs.stat(finalPath)).size;
    job.progress.totalBytes = job.progress.downloadedBytes;
    job.progress.percent = 100;
    this.emit(true);
    this.notifyPet(`下载完成：${path.basename(finalPath)}`, "happy");
  }

  async uniqueTargetPath(filename) {
    const extension = path.extname(filename);
    const stem = path.basename(filename, extension);
    let candidate = path.join(this.outputRoot, filename);
    let suffix = 2;
    while (true) {
      try {
        await fs.access(candidate);
        candidate = path.join(this.outputRoot, `${stem} (${suffix})${extension}`);
        suffix += 1;
      } catch {
        return candidate;
      }
    }
  }

  async fail(job, error) {
    const message = error?.message || String(error);
    if (job.cancelled) {
      job.status = "cancelled";
      return;
    }
    if (error?.retryable && job.retries < MAX_RETRIES) {
      job.retries += 1;
      job.status = "queued";
      job.error = `${message}，正在重试 ${job.retries}/${MAX_RETRIES}`;
      await new Promise((resolve) => setTimeout(resolve, 1200));
      this.queued.push(job.id);
      return;
    }
    job.status = "failed";
    job.error = message;
    await fs
      .rm(path.join(this.outputRoot, ".partial", job.id), {
        recursive: true,
        force: true
      })
      .catch(() => {});
  }

  killChild(child) {
    if (!child || child.killed) return;
    if (process.platform === "win32") {
      const killer = spawn(
        path.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"),
        ["/PID", String(child.pid), "/T", "/F"],
        { shell: false, windowsHide: true }
      );
      killer.on("error", () => child.kill());
      return;
    }
    child.kill("SIGTERM");
    setTimeout(() => {
      if (!child.killed) child.kill("SIGKILL");
    }, 2500).unref();
  }

  shutdown() {
    this.closed = true;
    clearTimeout(this.emitTimer);
    for (const job of this.jobs.values()) {
      if (job.child) this.killChild(job.child);
      if (["queued", "resolving", "downloading", "processing"].includes(job.status)) {
        job.status = "cancelled";
        job.cancelled = true;
      }
    }
  }
}

module.exports = {
  DownloadQueue
};
