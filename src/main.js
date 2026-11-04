const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  ipcMain,
  nativeImage,
  screen
} = require("electron");
const { CleanerModule } = require("./main/cleaner");
const { ChatModule } = require("./main/chat");
const { PetContextMenu } = require("./main/pet-menu");
const { VideoModule } = require("./main/video");

const ROOT = path.join(__dirname, "..");
const CONFIG_DIR = path.join(ROOT, "config");
const PRELOAD_PATH = path.join(__dirname, "preload.js");
const PET_HTML_PATH = path.join(__dirname, "renderer", "index.html");
const SETTINGS_HTML_PATH = path.join(__dirname, "renderer", "settings.html");
const TRAY_ICON_PATH = path.join(ROOT, "assets", "tray", "mojie_tray.png");
const BASE_WIDTH = 360;
const BASE_HEIGHT = 460;
const MIN_SCALE = 0.5;
const MAX_SCALE = 2;

let mainWindow = null;
let settingsWindow = null;
let tray = null;
let isQuitting = false;
let dragState = null;
let settingsSaveTimer = null;
let settings;
let emotionsConfig;
let dialogueConfig;
let cleanerModule;
let videoModule;
let chatModule;
let petContextMenu;

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const roundScale = (value) => Math.round(value * 100) / 100;

function sanitizeSettings(candidate) {
  const source = candidate && typeof candidate === "object" ? candidate : {};
  return {
    scale: clamp(Number(source.scale) || 1, MIN_SCALE, MAX_SCALE),
    alwaysOnTop:
      typeof source.alwaysOnTop === "boolean" ? source.alwaysOnTop : true,
    openAtLogin:
      typeof source.openAtLogin === "boolean" ? source.openAtLogin : false,
    volume: clamp(Number(source.volume) || 0, 0, 1),
    showTray: typeof source.showTray === "boolean" ? source.showTray : true,
    x: Number.isFinite(source.x) ? Math.round(source.x) : null,
    y: Number.isFinite(source.y) ? Math.round(source.y) : null
  };
}

function loadSettings() {
  const defaults = readJson(path.join(CONFIG_DIR, "default-settings.json"));
  const userPath = path.join(app.getPath("userData"), "settings.json");

  try {
    const saved = readJson(userPath);
    settings = sanitizeSettings({ ...defaults, ...saved });
  } catch {
    settings = sanitizeSettings(defaults);
  }

  return userPath;
}

function persistSettings() {
  const userPath = path.join(app.getPath("userData"), "settings.json");
  const tempPath = `${userPath}.tmp`;
  fs.mkdirSync(path.dirname(userPath), { recursive: true });
  fs.writeFileSync(tempPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, userPath);
}

function scheduleSettingsSave() {
  clearTimeout(settingsSaveTimer);
  settingsSaveTimer = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const bounds = mainWindow.getBounds();
      settings.x = bounds.x;
      settings.y = bounds.y;
    }
    persistSettings();
  }, 180);
}

function publicSettings() {
  return { ...settings };
}

function broadcastSettings() {
  const payload = publicSettings();
  for (const win of [mainWindow, settingsWindow]) {
    if (win && !win.isDestroyed()) {
      win.webContents.send("settings:changed", payload);
    }
  }
}

function syncLoginItem() {
  try {
    const options = { openAtLogin: settings.openAtLogin };
    if (process.platform === "win32" && !app.isPackaged) {
      options.path = process.execPath;
      options.args = [app.getAppPath()];
    }
    app.setLoginItemSettings(options);
  } catch (error) {
    console.warn("无法更新开机启动设置：", error.message);
  }
}

function clampBoundsToWorkArea(bounds, workArea) {
  return {
    x: clamp(bounds.x, workArea.x, workArea.x + workArea.width - bounds.width),
    y: clamp(bounds.y, workArea.y, workArea.y + workArea.height - bounds.height),
    width: bounds.width,
    height: bounds.height
  };
}

function maxScaleForDisplay(display) {
  return Math.max(
    MIN_SCALE,
    Math.min(
      MAX_SCALE,
      display.workArea.width / BASE_WIDTH,
      display.workArea.height / BASE_HEIGHT
    )
  );
}

function fitBoundsToDisplay(bounds, display) {
  const scale = roundScale(
    Math.min(settings.scale, maxScaleForDisplay(display))
  );
  const width = Math.round(BASE_WIDTH * scale);
  const height = Math.round(BASE_HEIGHT * scale);
  const anchorX = bounds.x + bounds.width / 2;
  const anchorBottom = bounds.y + bounds.height;
  const resized = {
    x: Math.round(anchorX - width / 2),
    y: Math.round(anchorBottom - height),
    width,
    height
  };

  if (scale !== settings.scale) {
    settings.scale = scale;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.setZoomFactor(scale);
    }
    broadcastSettings();
  }

  return clampBoundsToWorkArea(resized, display.workArea);
}

function initialBounds() {
  const hasSavedPosition =
    Number.isFinite(settings.x) && Number.isFinite(settings.y);
  const display = hasSavedPosition
    ? screen.getDisplayNearestPoint({ x: settings.x, y: settings.y })
    : screen.getPrimaryDisplay();
  const scale = roundScale(
    clamp(settings.scale, MIN_SCALE, maxScaleForDisplay(display))
  );
  settings.scale = scale;

  const width = Math.round(BASE_WIDTH * scale);
  const height = Math.round(BASE_HEIGHT * scale);
  const workArea = display.workArea;
  const candidate = hasSavedPosition
    ? { x: settings.x, y: settings.y, width, height }
    : {
        x: workArea.x + workArea.width - width - 20,
        y: workArea.y + workArea.height - height - 12,
        width,
        height
      };

  return clampBoundsToWorkArea(candidate, workArea);
}

function applyScale(requestedScale) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const bounds = mainWindow.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const scale = roundScale(
    clamp(Number(requestedScale) || 1, MIN_SCALE, maxScaleForDisplay(display))
  );
  const width = Math.round(BASE_WIDTH * scale);
  const height = Math.round(BASE_HEIGHT * scale);
  const anchorX = bounds.x + bounds.width / 2;
  const anchorBottom = bounds.y + bounds.height;
  const candidate = {
    x: Math.round(anchorX - width / 2),
    y: Math.round(anchorBottom - height),
    width,
    height
  };

  settings.scale = scale;
  mainWindow.setBounds(clampBoundsToWorkArea(candidate, display.workArea));
  mainWindow.webContents.setZoomFactor(scale);
}

function updateSettings(patch) {
  if (!patch || typeof patch !== "object") return publicSettings();
  const previousScale = settings.scale;
  const previousShowTray = settings.showTray;

  if (Number.isFinite(patch.scale)) {
    applyScale(patch.scale);
  }
  if (typeof patch.alwaysOnTop === "boolean") {
    settings.alwaysOnTop = patch.alwaysOnTop;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(settings.alwaysOnTop);
    }
  }
  if (typeof patch.openAtLogin === "boolean") {
    settings.openAtLogin = patch.openAtLogin;
  }
  if (Number.isFinite(patch.volume)) {
    settings.volume = clamp(patch.volume, 0, 1);
  }
  if (typeof patch.showTray === "boolean") {
    settings.showTray = patch.showTray;
  }

  if (previousScale !== settings.scale) {
    settings.x = mainWindow?.getBounds().x ?? settings.x;
    settings.y = mainWindow?.getBounds().y ?? settings.y;
  }
  if (previousShowTray !== settings.showTray) {
    if (!settings.showTray && mainWindow && !mainWindow.isVisible()) {
      showMainWindow();
    }
    syncTray();
  }

  syncLoginItem();
  persistSettings();
  broadcastSettings();
  return publicSettings();
}

function sendToPet(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function notifyPet(input, fallbackState = "happy") {
  if (isQuitting) return;
  const notice =
    typeof input === "string"
      ? { message: input, state: fallbackState, durationMs: 2800 }
      : input;
  if (!notice?.message) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!mainWindow.isVisible()) mainWindow.showInactive();
  sendToPet("pet:set-state", {
    state: notice.state || "happy",
    force: true
  });
  sendToPet("pet:show-notice", {
    message: notice.message,
    state: notice.state || "happy",
    durationMs: notice.durationMs || 2800
  });
}

function showMainWindow() {
  if (!settings) return;
  if (!mainWindow || mainWindow.isDestroyed()) {
    createPetWindow();
    return;
  }
  mainWindow.show();
  mainWindow.focus();
}

function hideMainWindow() {
  if (!tray || !mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.hide();
}

function showMainWindowInactive() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!mainWindow.isVisible()) mainWindow.showInactive();
}

function requestPetState(state) {
  showMainWindow();
  sendToPet("pet:set-state", { state, force: true });
}

function showPetContextMenu() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  petContextMenu?.showAtCursor();
}

function showInteractionMenu() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const menu = Menu.buildFromTemplate([
    {
      label: "摸摸她",
      click: () => requestPetState("happy")
    },
    {
      label: "故意招惹",
      click: () => requestPetState("angry")
    },
    {
      label: "让她歇会儿",
      click: () => requestPetState("sleep")
    },
    { type: "separator" },
    {
      label: "和摩羯聊聊…",
      click: () => chatModule?.openWindow()
    },
    {
      label: "打开设置",
      click: openSettingsWindow
    }
  ]);
  menu.popup({ window: mainWindow });
}

function createTray() {
  if (tray || !settings.showTray) return;
  const image = nativeImage.createFromPath(TRAY_ICON_PATH);
  if (image.isEmpty()) {
    console.warn(`托盘图标无效：${TRAY_ICON_PATH}`);
    settings.showTray = false;
    persistSettings();
    broadcastSettings();
    return;
  }

  tray = new Tray(image.resize({ width: 20, height: 20 }));
  tray.setToolTip("摩羯桌宠");
  tray.on("click", () => {
    if (mainWindow?.isVisible()) {
      hideMainWindow();
    } else {
      showMainWindow();
    }
  });
  refreshTrayMenu();
}

function refreshTrayMenu() {
  if (!tray) return;
  const isVisible = Boolean(mainWindow?.isVisible());
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: isVisible ? "隐藏摩羯" : "显示摩羯",
        click: isVisible ? hideMainWindow : showMainWindow
      },
      {
        label: "和摩羯聊聊…",
        click: () => chatModule?.openWindow()
      },
      {
        label: "设置…",
        click: openSettingsWindow
      },
      {
        label: "一键提速…",
        click: () => cleanerModule?.openWindow()
      },
      {
        label: "输入网址下载…",
        click: () => videoModule?.openWindow()
      },
      { type: "separator" },
      {
        label: "退出",
        click: quitApplication
      }
    ])
  );
}

function syncTray() {
  if (!settings.showTray && tray) {
    tray.destroy();
    tray = null;
  } else if (settings.showTray && !tray) {
    createTray();
  } else {
    refreshTrayMenu();
  }
}

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 440,
    height: 580,
    minWidth: 420,
    minHeight: 540,
    title: "摩羯桌宠设置",
    backgroundColor: "#18181d",
    autoHideMenuBar: true,
    show: false,
    icon: TRAY_ICON_PATH,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });

  settingsWindow.loadFile(SETTINGS_HTML_PATH);
  settingsWindow.once("ready-to-show", () => settingsWindow?.show());
  settingsWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

function createPetWindow() {
  const bounds = initialBounds();
  const scale = settings.scale;

  mainWindow = new BrowserWindow({
    ...bounds,
    transparent: true,
    frame: false,
    resizable: false,
    acceptFirstMouse: true,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    backgroundColor: "#00000000",
    icon: TRAY_ICON_PATH,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      zoomFactor: scale
    }
  });

  mainWindow.setAlwaysOnTop(settings.alwaysOnTop);
  mainWindow.loadFile(PET_HTML_PATH);
  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow?.webContents.setZoomFactor(settings.scale);
  });
  mainWindow.once("ready-to-show", () => {
    mainWindow?.webContents.setZoomFactor(settings.scale);
    mainWindow?.showInactive();
    refreshTrayMenu();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.on("moved", () => {
    petContextMenu?.hide();
    scheduleSettingsSave();
  });
  mainWindow.on("show", refreshTrayMenu);
  mainWindow.on("hide", () => {
    petContextMenu?.hide();
    refreshTrayMenu();
  });
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      hideMainWindow();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
    dragState = null;
  });
}

function privateBootstrap() {
  const emotions = structuredClone(emotionsConfig);
  for (const frame of Object.values(emotions.frames)) {
    frame.url = pathToFileURL(path.join(ROOT, frame.file)).href;
  }
  return {
    emotions,
    dialogues: structuredClone(dialogueConfig),
    settings: publicSettings()
  };
}

function senderIsMainWindow(event) {
  return Boolean(
    mainWindow &&
      !mainWindow.isDestroyed() &&
      BrowserWindow.fromWebContents(event.sender) === mainWindow
  );
}

function registerIpc() {
  ipcMain.handle("app:bootstrap", () => privateBootstrap());
  ipcMain.handle("settings:get", () => publicSettings());
  ipcMain.handle("settings:update", (_event, patch) => updateSettings(patch));
  ipcMain.handle("settings:open", () => {
    openSettingsWindow();
    return true;
  });
  ipcMain.handle("app:quit", () => {
    quitApplication();
    return true;
  });
  ipcMain.handle("settings:reset-position", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return publicSettings();
    settings.x = null;
    settings.y = null;
    const display = screen.getPrimaryDisplay();
    settings.scale = roundScale(
      Math.min(settings.scale, maxScaleForDisplay(display))
    );
    const width = Math.round(BASE_WIDTH * settings.scale);
    const height = Math.round(BASE_HEIGHT * settings.scale);
    const area = display.workArea;
    mainWindow.webContents.setZoomFactor(settings.scale);
    mainWindow.setBounds(
      clampBoundsToWorkArea(
        {
          x: area.x + area.width - width - 20,
          y: area.y + area.height - height - 12,
          width,
          height
        },
        area
      )
    );
    broadcastSettings();
    scheduleSettingsSave();
    return publicSettings();
  });

  ipcMain.on("pet:context-menu", (event) => {
    if (senderIsMainWindow(event)) showPetContextMenu();
  });
  ipcMain.on("pet:interaction-menu", (event) => {
    if (senderIsMainWindow(event)) showInteractionMenu();
  });
  ipcMain.on("app:open-cleaner", (event) => {
    if (senderIsMainWindow(event)) cleanerModule?.openWindow();
  });
  ipcMain.on("app:open-downloader", (event) => {
    if (senderIsMainWindow(event)) videoModule?.openWindow();
  });
  ipcMain.on("pet:drag-start", (event, point) => {
    if (!senderIsMainWindow(event) || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
      return;
    }
    dragState = {
      screenX: point.x,
      screenY: point.y,
      bounds: mainWindow.getBounds()
    };
  });
  ipcMain.on("pet:drag-move", (event, point) => {
    if (
      !senderIsMainWindow(event) ||
      !dragState ||
      !Number.isFinite(point?.x) ||
      !Number.isFinite(point?.y)
    ) {
      return;
    }
    const candidate = {
      ...dragState.bounds,
      x: dragState.bounds.x + Math.round(point.x - dragState.screenX),
      y: dragState.bounds.y + Math.round(point.y - dragState.screenY)
    };
    const display = screen.getDisplayNearestPoint({
      x: candidate.x + candidate.width / 2,
      y: candidate.y + candidate.height / 2
    });
    mainWindow.setBounds(fitBoundsToDisplay(candidate, display));
  });
  ipcMain.on("pet:drag-end", (event) => {
    if (!senderIsMainWindow(event)) return;
    dragState = null;
    scheduleSettingsSave();
  });
}

function quitApplication() {
  if (isQuitting) return;
  isQuitting = true;
  clearTimeout(settingsSaveTimer);

  if (mainWindow && !mainWindow.isDestroyed()) {
    const bounds = mainWindow.getBounds();
    settings.x = bounds.x;
    settings.y = bounds.y;
  }
  try {
    persistSettings();
  } catch (error) {
    console.warn("退出前保存设置失败：", error.message);
  }

  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.destroy();
  petContextMenu?.cleanup();
  cleanerModule?.cleanup();
  videoModule?.cleanup();
  chatModule?.cleanup();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
  if (tray) {
    tray.destroy();
    tray = null;
  }
  app.quit();
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", showMainWindow);
  app.whenReady().then(() => {
    app.setName("摩羯桌宠");
    if (process.platform === "win32") {
      app.setAppUserModelId("local.capri.mojie-desktop-pet");
    }

    emotionsConfig = readJson(path.join(CONFIG_DIR, "emotions.json"));
    dialogueConfig = readJson(path.join(CONFIG_DIR, "dialogues.json"));
    loadSettings();
    registerIpc();
    cleanerModule = new CleanerModule({
      rootDir: ROOT,
      ownerWindowProvider: () => mainWindow,
      notifyPet
    });
    videoModule = new VideoModule({
      rootDir: ROOT,
      notifyPet
    });
    chatModule = new ChatModule({
      rootDir: ROOT,
      userDataDir: app.getPath("userData"),
      ownerWindowProvider: () => mainWindow,
      sendToPet,
      showPetInactive: showMainWindowInactive,
      notifyPet
    });
    petContextMenu = new PetContextMenu({
      rootDir: ROOT,
      snapshotProvider: () => ({
        settings: publicSettings(),
        showTray: Boolean(tray),
        states: Object.entries(emotionsConfig.states).map(([id, state]) => [
          id,
          state.label
        ])
      }),
      setState: (state) => {
        if (emotionsConfig.states[state]) {
          sendToPet("pet:set-state", { state, force: true });
        }
      },
      updateSettings,
      openCleaner: () => cleanerModule.openWindow(),
      openDownloader: () => videoModule.openWindow(),
      openChat: () => chatModule.openWindow(),
      openSettings: openSettingsWindow,
      hidePet: hideMainWindow,
      quitApplication
    });
    cleanerModule.registerIpc();
    videoModule.registerIpc();
    chatModule.registerIpc();
    petContextMenu.registerIpc();
    createTray();
    createPetWindow();
    syncLoginItem();
    persistSettings();

    screen.on("display-added", () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const bounds = mainWindow.getBounds();
        const display = screen.getDisplayMatching(mainWindow.getBounds());
        mainWindow.setBounds(fitBoundsToDisplay(bounds, display));
      }
    });
    screen.on("display-removed", () => {
      showMainWindow();
    });
    screen.on("display-metrics-changed", () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const bounds = mainWindow.getBounds();
        const display = screen.getDisplayMatching(mainWindow.getBounds());
        mainWindow.setBounds(fitBoundsToDisplay(bounds, display));
      }
    });
  });
}

app.on("activate", showMainWindow);
app.on("before-quit", () => {
  isQuitting = true;
  petContextMenu?.cleanup();
  cleanerModule?.cleanup();
  videoModule?.cleanup();
  chatModule?.cleanup();
});
app.on("will-quit", () => {
  clearTimeout(settingsSaveTimer);
});
