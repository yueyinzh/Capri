const { contextBridge, ipcRenderer } = require("electron");

const subscribe = (channel, callback) => {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld("capri", {
  getBootstrap: () => ipcRenderer.invoke("app:bootstrap"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  updateSettings: (patch) => ipcRenderer.invoke("settings:update", patch),
  openSettings: () => ipcRenderer.invoke("settings:open"),
  openCleaner: () => ipcRenderer.send("app:open-cleaner"),
  openDownloader: () => ipcRenderer.send("app:open-downloader"),
  openChat: () => ipcRenderer.send("chat:open"),
  resetPosition: () => ipcRenderer.invoke("settings:reset-position"),
  quit: () => ipcRenderer.invoke("app:quit"),
  showPetMenu: () => ipcRenderer.send("pet:context-menu"),
  showInteractionMenu: () => ipcRenderer.send("pet:interaction-menu"),
  dragStart: (point) => ipcRenderer.send("pet:drag-start", point),
  dragMove: (point) => ipcRenderer.send("pet:drag-move", point),
  dragEnd: () => ipcRenderer.send("pet:drag-end"),
  onSettingsChanged: (callback) => subscribe("settings:changed", callback),
  onStateRequested: (callback) => subscribe("pet:set-state", callback),
  onNotice: (callback) => subscribe("pet:show-notice", callback),
  onChatBubble: (callback) => subscribe("pet:chat-bubble", callback),
  onShowRequested: (callback) => subscribe("pet:show", callback)
});
