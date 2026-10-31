const fs = require("node:fs/promises");
const path = require("node:path");
const { BrowserWindow, app, ipcMain, shell } = require("electron");
const { DownloadQueue } = require("./queue");
const { resolveTools } = require("./tools");
const { validateVideoUrl } = require("./url-policy");

class VideoModule {
  constructor({ rootDir, notifyPet, outputRoot }) {
    this.rootDir = rootDir;
    this.notifyPet = notifyPet;
    this.window = null;
    this.registered = false;
    this.outputRoot =
      outputRoot || path.join(app.getPath("downloads"), "CAPRI");
    this.queue = new DownloadQueue({
      outputRoot: this.outputRoot,
      notifyJobs: (jobs) => this.sendJobs(jobs),
      notifyPet: (message, state) => this.notifyPet(message, state),
      toolsProvider: () => this.getTools()
    });
  }

  getTools() {
    return resolveTools(this.rootDir, app.getPath("userData"));
  }

  registerIpc() {
    if (this.registered) return;
    this.registered = true;

    ipcMain.handle("video:status", (event) => {
      this.assertSender(event);
      return this.status();
    });
    ipcMain.handle("video:queue-add", async (event, payload) => {
      this.assertSender(event);
      try {
        if (payload?.rightsConfirmed !== true) {
          throw new Error("请先确认你拥有该内容的下载权限");
        }
        const tools = this.getTools();
        if (!tools.available) {
          throw new Error("下载组件未安装，请先运行 npm run setup:video-tools");
        }
        const url = await validateVideoUrl(payload?.url);
        const jobId = this.queue.add({
          url,
          sourceHost: new URL(url).hostname
        });
        return { ok: true, jobId };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    });
    ipcMain.handle("video:list", (event) => {
      this.assertSender(event);
      return { ok: true, jobs: this.queue.list() };
    });
    ipcMain.handle("video:cancel", (event, { jobId } = {}) => {
      this.assertSender(event);
      try {
        this.queue.cancel(jobId);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    });
    ipcMain.handle("video:retry", (event, { jobId } = {}) => {
      this.assertSender(event);
      try {
        this.queue.retry(jobId);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    });
    ipcMain.handle("video:open-output", async (event) => {
      this.assertSender(event);
      try {
        await fs.mkdir(this.outputRoot, { recursive: true });
        const message = await shell.openPath(this.outputRoot);
        if (message) throw new Error(message);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    });
    ipcMain.handle("video:open-folder", (event, { jobId } = {}) => {
      this.assertSender(event);
      const job = this.queue.jobs.get(jobId);
      if (job?.outputPath) {
        shell.showItemInFolder(job.outputPath);
      } else {
        fs.mkdir(this.outputRoot, { recursive: true })
          .then(() => shell.openPath(this.outputRoot))
          .catch(() => {});
      }
      return { ok: true };
    });
  }

  assertSender(event) {
    if (
      !this.window ||
      this.window.isDestroyed() ||
      BrowserWindow.fromWebContents(event.sender) !== this.window
    ) {
      throw new Error("未授权的下载请求");
    }
  }

  status() {
    const tools = this.getTools();
    return {
      ok: true,
      ready: tools.available,
      missing: tools.missing,
      outputRoot: this.outputRoot,
      jobs: this.queue.list()
    };
  }

  sendJobs(jobs) {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send("video:jobs-updated", jobs);
    }
  }

  openWindow() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.show();
      this.window.focus();
      return;
    }

    this.window = new BrowserWindow({
      width: 780,
      height: 720,
      minWidth: 680,
      minHeight: 600,
      title: "CAPRI // 视频下载",
      backgroundColor: "#100b10",
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        preload: path.join(this.rootDir, "src", "preload", "video.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        backgroundThrottling: false
      }
    });
    this.window.loadFile(
      path.join(this.rootDir, "src", "renderer", "video", "index.html")
    );
    this.window.once("ready-to-show", () => this.window?.show());
    this.window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    this.window.webContents.on("will-navigate", (event) => event.preventDefault());
    this.window.on("closed", () => {
      this.window = null;
    });
  }

  cleanup() {
    this.queue.shutdown();
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy();
    }
    this.window = null;
  }
}

module.exports = {
  VideoModule
};
