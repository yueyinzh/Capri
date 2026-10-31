const path = require("node:path");
const {
  BrowserWindow,
  ipcMain,
  screen
} = require("electron");

const MENU_WIDTH = 300;
const MENU_HEIGHT = 452;
const MIN_SCALE = 0.5;
const MAX_SCALE = 2;

class PetContextMenu {
  constructor({
    rootDir,
    snapshotProvider,
    setState,
    updateSettings,
    openCleaner,
    openDownloader,
    openSettings,
    hidePet,
    quitApplication
  }) {
    this.rootDir = rootDir;
    this.snapshotProvider = snapshotProvider;
    this.setState = setState;
    this.updateSettings = updateSettings;
    this.openCleaner = openCleaner;
    this.openDownloader = openDownloader;
    this.openSettings = openSettings;
    this.hidePet = hidePet;
    this.quitApplication = quitApplication;
    this.window = null;
    this.registeredHandlers = new Map();
    this.pendingPresentation = false;
  }

  registerIpc() {
    this.registerHandler("pet-menu:snapshot", () => this.snapshotProvider());
    this.registerHandler("pet-menu:command", (command) => this.handleCommand(command));
  }

  registerHandler(channel, handler) {
    const wrapped = (event, payload) => {
      this.assertSender(event);
      return handler(payload);
    };
    this.registeredHandlers.set(channel, wrapped);
    ipcMain.handle(channel, wrapped);
  }

  assertSender(event) {
    if (
      !this.window ||
      this.window.isDestroyed() ||
      BrowserWindow.fromWebContents(event.sender) !== this.window
    ) {
      throw new Error("无效的桌宠菜单请求");
    }
  }

  createWindow() {
    if (this.window && !this.window.isDestroyed()) return this.window;

    this.window = new BrowserWindow({
      width: MENU_WIDTH,
      height: MENU_HEIGHT,
      transparent: true,
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      show: false,
      backgroundColor: "#00000000",
      webPreferences: {
        preload: path.join(this.rootDir, "src", "preload", "pet-menu.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        backgroundThrottling: false
      }
    });

    this.window.setAlwaysOnTop(true);
    this.window.loadFile(
      path.join(this.rootDir, "src", "renderer", "pet-menu", "index.html")
    );
    this.window.once("ready-to-show", () => {
      if (this.pendingPresentation) {
        this.pendingPresentation = false;
        this.present();
      }
    });
    this.window.on("blur", () => this.hide());
    this.window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    this.window.webContents.on("will-navigate", (event) => event.preventDefault());
    this.window.on("closed", () => {
      this.window = null;
    });
    return this.window;
  }

  showAtCursor() {
    const menuWindow = this.createWindow();
    this.sendSnapshot();
    if (menuWindow.webContents.isLoadingMainFrame()) {
      this.pendingPresentation = true;
    } else {
      this.present();
    }
  }

  present() {
    if (!this.window || this.window.isDestroyed()) return;
    const point = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(point);
    const workArea = display.workArea;
    const [width, height] = this.window.getSize();
    const x = Math.min(
      workArea.x + workArea.width - width,
      Math.max(workArea.x, point.x - width + 28)
    );
    const y = Math.min(
      workArea.y + workArea.height - height,
      Math.max(workArea.y, point.y - height - 10)
    );
    this.window.setPosition(
      Math.round(x),
      Math.round(y)
    );
    this.window.show();
    this.window.focus();
    this.sendSnapshot();
  }

  sendSnapshot() {
    if (
      this.window &&
      !this.window.isDestroyed() &&
      !this.window.webContents.isLoadingMainFrame()
    ) {
      this.window.webContents.send("pet-menu:update", this.snapshotProvider());
    }
  }

  hide() {
    if (this.window && !this.window.isDestroyed() && this.window.isVisible()) {
      this.window.hide();
    }
  }

  handleCommand(command) {
    if (!command || typeof command !== "object") {
      throw new Error("无效的菜单命令");
    }
    switch (command.action) {
      case "close":
        this.hide();
        break;
      case "set-state":
        if (typeof command.state !== "string") {
          throw new Error("无效的表情状态");
        }
        this.setState(command.state);
        this.hide();
        break;
      case "toggle-always-on-top":
        this.updateSettings({ alwaysOnTop: Boolean(command.value) });
        this.sendSnapshot();
        break;
      case "set-scale": {
        const scale = Number(command.scale);
        if (!Number.isFinite(scale) || scale < MIN_SCALE || scale > MAX_SCALE) {
          throw new Error("无效的缩放比例");
        }
        this.updateSettings({ scale });
        this.hide();
        break;
      }
      case "open-cleaner":
        this.hide();
        this.openCleaner();
        break;
      case "open-downloader":
        this.hide();
        this.openDownloader();
        break;
      case "open-settings":
        this.hide();
        this.openSettings();
        break;
      case "hide-pet":
        this.hide();
        this.hidePet();
        break;
      case "quit":
        this.hide();
        this.quitApplication();
        break;
      default:
        throw new Error("未知的菜单命令");
    }
    return { ok: true };
  }

  cleanup() {
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
  PetContextMenu
};
