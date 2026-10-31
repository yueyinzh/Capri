const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain
} = require("electron");
const { executePlan } = require("./executor");
const {
  discoverBrowserCacheDirectories,
  getLogDirectories,
  getTempDirectories,
  safeRealDirectory
} = require("./paths");
const { PlanStore } = require("./plan-store");
const { scanGroups } = require("./scanner");

const CATEGORY_LABELS = {
  temp: "临时目录",
  "chrome-cache": "Chrome 缓存",
  "edge-cache": "Edge 缓存",
  logs: "Capri 日志",
  node_modules: "项目 node_modules"
};

const ALLOWED_CATEGORIES = new Set(Object.keys(CATEGORY_LABELS));

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024))
  );
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}

class CleanerModule {
  constructor({ rootDir, ownerWindowProvider, notifyPet }) {
    this.rootDir = rootDir;
    this.ownerWindowProvider = ownerWindowProvider;
    this.notifyPet = notifyPet;
    this.window = null;
    this.planStore = new PlanStore();
    this.projectSelections = new Map();
    this.activeRuns = new Map();
    this.scanController = null;
    this.registeredHandlers = new Map();
    this.disposed = false;
    this.cleanupTimer = setInterval(
      () => this.planStore.clearExpired(),
      60_000
    );
    this.cleanupTimer.unref?.();
  }

  send(channel, payload) {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, payload);
    }
  }

  assertSender(event) {
    if (
      !this.window ||
      this.window.isDestroyed() ||
      BrowserWindow.fromWebContents(event.sender) !== this.window
    ) {
      throw new Error("无效的清理窗口请求");
    }
  }

  ownerWindow() {
    try {
      const owner = this.ownerWindowProvider?.();
      return owner && !owner.isDestroyed() ? owner : undefined;
    } catch {
      return undefined;
    }
  }

  openWindow() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.show();
      this.window.focus();
      return this.window;
    }

    this.window = new BrowserWindow({
      width: 780,
      height: 720,
      minWidth: 680,
      minHeight: 600,
      title: "CAPRI 一键提速",
      backgroundColor: "#101116",
      autoHideMenuBar: true,
      show: false,
      icon: path.join(this.rootDir, "assets", "tray", "mojie_tray.png"),
      webPreferences: {
        preload: path.join(this.rootDir, "src", "preload", "cleaner.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        backgroundThrottling: false
      }
    });

    this.window.loadFile(
      path.join(this.rootDir, "src", "renderer", "cleaner", "index.html")
    );
    this.window.once("ready-to-show", () => this.window?.show());
    this.window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    this.window.webContents.on("will-navigate", (event) => event.preventDefault());
    this.window.on("closed", () => {
      for (const run of this.activeRuns.values()) run.cancelled = true;
      if (this.scanController) this.scanController.cancelled = true;
      this.window = null;
    });
    return this.window;
  }

  async chooseProject() {
    const options = {
      title: "选择要清理 node_modules 的项目",
      properties: ["openDirectory"]
    };
    const owner = this.window || this.ownerWindow();
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) {
      return { cancelled: true };
    }

    const projectPath = await safeRealDirectory(result.filePaths[0]);
    if (!projectPath) {
      throw new Error("该项目目录位于禁止清理的位置");
    }

    const packageJsonPath = path.join(projectPath, "package.json");
    try {
      const stat = await fs.lstat(packageJsonPath);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error();
    } catch {
      throw new Error("所选目录不是有效的 Node.js 项目");
    }

    const selectionId = randomUUID();
    this.projectSelections.set(selectionId, {
      path: projectPath,
      createdAt: Date.now()
    });
    return {
      cancelled: false,
      selectionId,
      displayPath: projectPath
    };
  }

  async buildGroups(categories, projectSelectionId) {
    const groups = [];

    if (categories.includes("temp")) {
      for (const tempPath of await getTempDirectories()) {
        groups.push({
          id: randomUUID(),
          category: "temp",
          label: CATEGORY_LABELS.temp,
          path: tempPath,
          removeRoot: false,
          minAgeMs: 24 * 60 * 60 * 1000
        });
      }
    }

    if (
      categories.includes("chrome-cache") ||
      categories.includes("edge-cache")
    ) {
      const browserCaches = await discoverBrowserCacheDirectories();
      for (const cache of browserCaches) {
        if (!categories.includes(cache.category)) continue;
        groups.push({
          id: randomUUID(),
          category: cache.category,
          label: `${cache.browser} 缓存 · ${cache.profile}`,
          path: cache.path,
          removeRoot: false
        });
      }
    }

    if (categories.includes("logs")) {
      for (const logPath of await getLogDirectories()) {
        groups.push({
          id: randomUUID(),
          category: "logs",
          label: CATEGORY_LABELS.logs,
          path: logPath,
          removeRoot: false
        });
      }
    }

    if (categories.includes("node_modules")) {
      const selection = this.projectSelections.get(projectSelectionId);
      if (!selection) {
        throw new Error("请先选择一个包含 package.json 的项目");
      }
      const nodeModulesPath = await safeRealDirectory(
        path.join(selection.path, "node_modules")
      );
      if (nodeModulesPath) {
        groups.push({
          id: randomUUID(),
          category: "node_modules",
          label: CATEGORY_LABELS.node_modules,
          path: nodeModulesPath,
          removeRoot: true
        });
      }
    }

    return groups;
  }

  async scan(payload = {}) {
    if (this.scanController) {
      throw new Error("已有扫描任务正在进行");
    }

    const categories = Array.isArray(payload.categories)
      ? [...new Set(payload.categories)]
      : [];
    if (
      categories.length === 0 ||
      categories.some((category) => !ALLOWED_CATEGORIES.has(category))
    ) {
      throw new Error("请选择有效的清理类别");
    }

    const requestId =
      typeof payload.requestId === "string"
        ? payload.requestId.slice(0, 128)
        : randomUUID();
    const scanController = { cancelled: false };
    this.scanController = scanController;

    try {
      const groups = await this.buildGroups(
        categories,
        payload.projectSelectionId
      );
      const scanned = await scanGroups(groups, {
        isCancelled: () => scanController.cancelled,
        onProgress: (progress) =>
          this.send("cleaner:progress", { ...progress, requestId })
      });

      const planId = randomUUID();
      const items = scanned.map((group) => ({
        id: group.id,
        category: group.category,
        label: group.label,
        path: group.path,
        sizeBytes: group.totalBytes,
        fileCount: group.fileCount,
        directoryCount: group.directoryCount,
        removeRoot: group.removeRoot,
        skippedEntries: group.skippedEntries,
        warnings: group.warnings
      }));
      const totals = scanned.reduce(
        (summary, group) => ({
          sizeBytes: summary.sizeBytes + group.totalBytes,
          fileCount: summary.fileCount + group.fileCount,
          directoryCount: summary.directoryCount + group.directoryCount
        }),
        { sizeBytes: 0, fileCount: 0, directoryCount: 0 }
      );

      this.planStore.set(planId, {
        groups: scanned,
        totals,
        categories
      });

      return {
        requestId,
        planId,
        items,
        totals,
        warnings:
          items.length === 0
            ? ["没有发现可清理目录；可关闭浏览器后重新扫描，或先手动选择项目。"]
            : []
      };
    } finally {
      if (this.scanController === scanController) {
        this.scanController = null;
      }
    }
  }

  async execute({ planId, itemIds } = {}) {
    const plan = this.planStore.get(planId);
    if (!plan) throw new Error("清理计划已过期，请重新扫描");

    const selectedIds = new Set(Array.isArray(itemIds) ? itemIds : []);
    const groups = plan.groups.filter((group) => selectedIds.has(group.id));
    if (groups.length === 0) throw new Error("请至少选择一项可清理内容");

    const selectedTotals = groups.reduce(
      (summary, group) => ({
        sizeBytes: summary.sizeBytes + group.totalBytes,
        fileCount: summary.fileCount + group.fileCount
      }),
      { sizeBytes: 0, fileCount: 0 }
    );
    const previewPaths = groups
      .slice(0, 6)
      .map((group) => `• ${group.path}`)
      .join("\n");
    const extraGroups = groups.length > 6 ? `\n…另有 ${groups.length - 6} 项` : "";
    const options = {
      type: "warning",
      title: "确认清理",
      message: `将删除 ${selectedTotals.fileCount} 个文件，预计释放 ${formatBytes(selectedTotals.sizeBytes)}`,
      detail: `${previewPaths}${extraGroups}\n\n不允许删除的文件会自动跳过。此操作不会结束进程或修改注册表。`,
      buttons: ["取消", "确认清理"],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    };
    const confirmation = this.window
      ? await dialog.showMessageBox(this.window, options)
      : await dialog.showMessageBox(options);
    if (confirmation.response !== 1) {
      return { cancelled: true };
    }

    this.planStore.consume(planId);
    const runId = randomUUID();
    const run = { cancelled: false };
    this.activeRuns.set(runId, run);

    setImmediate(async () => {
      try {
        const result = await executePlan({
          groups,
          isCancelled: () => run.cancelled,
          onProgress: (progress) =>
            this.send("cleaner:progress", { ...progress, runId })
        });
        this.send("cleaner:complete", { ...result, runId });

        if (!this.disposed && typeof this.notifyPet === "function") {
          const prefix = result.cancelled ? "清理已取消" : "清理完成";
          const suffix =
            result.failureCount + result.skippedEntries > 0
              ? `，跳过 ${result.failureCount + result.skippedEntries} 项`
              : "";
          await this.notifyPet({
            message: `${prefix}，释放了 ${formatBytes(result.freedBytes)}${suffix}`,
            state: result.cancelled ? "surprised" : "happy",
            durationMs: 3600
          });
        }
      } catch (error) {
        this.send("cleaner:error", {
          runId,
          code: error.code || "CLEAN_FAILED",
          message: error.message
        });
        if (!this.disposed && typeof this.notifyPet === "function") {
          await this.notifyPet({
            message: "清理出了点问题，我已经停手了。",
            state: "sad",
            durationMs: 3000
          });
        }
      } finally {
        this.activeRuns.delete(runId);
      }
    });

    return {
      cancelled: false,
      runId,
      totalBytes: selectedTotals.sizeBytes,
      totalFiles: selectedTotals.fileCount
    };
  }

  cancelRun(runId) {
    const run = this.activeRuns.get(runId);
    if (!run) return false;
    run.cancelled = true;
    return true;
  }

  registerIpc() {
    const register = (channel, handler) => {
      const wrapped = async (event, payload) => {
        this.assertSender(event);
        return handler(payload);
      };
      this.registeredHandlers.set(channel, wrapped);
      ipcMain.handle(channel, wrapped);
    };

    register("cleaner:choose-project", () => this.chooseProject());
    register("cleaner:scan", (payload) => this.scan(payload));
    register("cleaner:execute", (payload) => this.execute(payload));
    register("cleaner:cancel", ({ runId } = {}) => ({
      cancelled: this.cancelRun(runId)
    }));
    register("cleaner:capabilities", () => ({
      categories: Object.entries(CATEGORY_LABELS).map(([id, label]) => ({
        id,
        label
      })),
      platform: process.platform,
      appName: app.getName()
    }));
  }

  cleanup() {
    this.disposed = true;
    clearInterval(this.cleanupTimer);
    if (this.scanController) this.scanController.cancelled = true;
    for (const run of this.activeRuns.values()) run.cancelled = true;
    this.planStore.clear();

    for (const channel of this.registeredHandlers.keys()) {
      ipcMain.removeHandler(channel);
    }
    this.registeredHandlers.clear();

    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy();
    }
    this.window = null;
  }
}

module.exports = {
  CleanerModule,
  formatBytes
};
