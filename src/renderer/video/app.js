const api = window.capriVideo;
const elements = {
  url: document.querySelector("#video-url"),
  rights: document.querySelector("#rights-confirmed"),
  add: document.querySelector("#add-job"),
  formMessage: document.querySelector("#form-message"),
  toolsMessage: document.querySelector("#tools-message"),
  toolBadge: document.querySelector("#tool-badge"),
  list: document.querySelector("#job-list"),
  openOutput: document.querySelector("#open-output"),
  outputRoot: document.querySelector("#output-root")
};

let toolsReady = false;
let jobs = [];
let submitting = false;

const statusLabels = {
  queued: "排队中",
  resolving: "正在解析",
  downloading: "下载中",
  processing: "处理中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消"
};

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024))
  );
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatSpeed(bytes) {
  return Number.isFinite(bytes) && bytes > 0 ? `${formatBytes(bytes)}/s` : "--";
}

function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "--";
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const remaining = total % 60;
  return minutes ? `${minutes}:${String(remaining).padStart(2, "0")}` : `${remaining}s`;
}

function setFormMessage(message) {
  elements.formMessage.textContent = message || "";
}

function setToolsStatus(status) {
  toolsReady = status.ready === true;
  elements.toolBadge.textContent = toolsReady ? "TOOLS READY" : "TOOLS MISSING";
  elements.toolBadge.classList.toggle("ready", toolsReady);
  elements.toolBadge.classList.toggle("missing", !toolsReady);
  elements.outputRoot.textContent = status.outputRoot || elements.outputRoot.textContent;

  if (toolsReady) {
    elements.toolsMessage.textContent = "";
  } else {
    const missing = (status.missing || []).join("、");
    elements.toolsMessage.textContent = `缺少 ${missing}。请先在项目目录运行 npm run setup:video-tools。`;
  }
  updateSubmitState();
}

function updateSubmitState() {
  elements.add.disabled =
    submitting || !toolsReady || !elements.rights.checked;
}

function createButton(label, action, jobId) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.dataset.action = action;
  button.dataset.jobId = jobId;
  return button;
}

function renderJobs() {
  elements.list.replaceChildren();
  if (!jobs.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    const title = document.createElement("span");
    title.textContent = "QUEUE EMPTY";
    const text = document.createElement("p");
    text.textContent = "粘贴网址并确认版权后，任务会显示在这里。";
    empty.append(title, text);
    elements.list.append(empty);
    return;
  }

  for (const job of jobs) {
    const card = document.createElement("article");
    card.className = "job-card";
    card.dataset.jobId = job.id;

    const main = document.createElement("div");
    main.className = "job-main";
    const kicker = document.createElement("div");
    kicker.className = "job-kicker";
    kicker.textContent = `${String(job.sourceHost || "unknown").toUpperCase()} // ${job.id.slice(0, 8)}`;
    const title = document.createElement("div");
    title.className = "job-title";
    title.textContent = job.title || "等待解析标题…";
    main.append(kicker, title);

    const status = document.createElement("div");
    status.className = `job-status ${job.status}`;
    status.textContent = statusLabels[job.status] || job.status;

    const progressWrap = document.createElement("div");
    progressWrap.className = "job-progress";
    const progress = document.createElement("progress");
    progress.max = 100;
    progress.value = Math.max(0, Math.min(100, job.progress?.percent || 0));
    const meta = document.createElement("span");
    meta.className = "job-meta";
    meta.textContent =
      job.status === "downloading"
        ? `${Math.round(job.progress.percent)}% · ${formatSpeed(job.progress.speedBps)} · ${formatEta(job.progress.etaSeconds)}`
        : job.status === "completed"
          ? `${formatBytes(job.progress?.downloadedBytes)}`
          : statusLabels[job.status] || job.status;
    progressWrap.append(progress, meta);

    card.append(main, status, progressWrap);

    if (job.error) {
      const error = document.createElement("div");
      error.className = "job-error";
      error.textContent = job.error;
      card.append(error);
    }
    if (job.outputPath) {
      const output = document.createElement("div");
      output.className = "job-path";
      output.textContent = job.outputPath;
      card.append(output);
    }

    const actions = document.createElement("div");
    actions.className = "job-actions";
    if (["queued", "resolving", "downloading", "processing"].includes(job.status)) {
      actions.append(createButton("取消", "cancel", job.id));
    }
    if (["failed", "cancelled"].includes(job.status)) {
      actions.append(createButton("重试", "retry", job.id));
    }
    if (job.status === "completed") {
      actions.append(createButton("打开文件位置", "open", job.id));
    }
    if (actions.childElementCount) card.append(actions);
    elements.list.append(card);
  }
}

async function refreshStatus() {
  const status = await api.getStatus();
  setToolsStatus(status);
  jobs = status.jobs || jobs;
  renderJobs();
}

async function submit() {
  if (elements.add.disabled) return;
  const rawUrl = elements.url.value.trim();
  let parsed;
  try {
    parsed = new URL(rawUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
  } catch {
    setFormMessage("请输入完整的 http 或 https 视频页面网址。");
    return;
  }

  submitting = true;
  updateSubmitState();
  setFormMessage("正在验证网址并加入队列…");
  try {
    const result = await api.addToQueue(
      parsed.href,
      elements.rights.checked
    );
    if (!result.ok) {
      setFormMessage(result.error || "任务创建失败");
      return;
    }
    elements.url.value = "";
    elements.rights.checked = false;
    setFormMessage("任务已加入队列。");
    await refreshStatus();
  } catch (error) {
    setFormMessage(error.message || "任务创建失败");
  } finally {
    submitting = false;
    updateSubmitState();
  }
}

elements.rights.addEventListener("change", updateSubmitState);
elements.add.addEventListener("click", submit);
elements.url.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !elements.add.disabled) submit();
});

elements.openOutput.addEventListener("click", async () => {
  const result = await api.openOutput();
  if (!result.ok) setFormMessage(result.error || "无法打开下载目录");
});

elements.list.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const { action, jobId } = button.dataset;
  button.disabled = true;
  try {
    if (action === "cancel") await api.cancel(jobId);
    if (action === "retry") await api.retry(jobId);
    if (action === "open") await api.openFolder(jobId);
    await refreshStatus();
  } catch (error) {
    setFormMessage(error.message || "任务操作失败");
  } finally {
    button.disabled = false;
  }
});

api.onJobsUpdated((nextJobs) => {
  jobs = nextJobs;
  renderJobs();
});

refreshStatus().catch((error) => {
  setToolsStatus({ ready: false, missing: ["下载后端"], outputRoot: "" });
  setFormMessage(error.message || "无法读取下载组件状态");
});
