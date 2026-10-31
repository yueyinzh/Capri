const { contextBridge, ipcRenderer } = require("electron");

const subscribe = (channel, callback) => {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld("capriCleaner", {
  getCapabilities: () => ipcRenderer.invoke("cleaner:capabilities"),
  chooseProject: () => ipcRenderer.invoke("cleaner:choose-project"),
  scan: (payload) => ipcRenderer.invoke("cleaner:scan", payload),
  execute: (payload) => ipcRenderer.invoke("cleaner:execute", payload),
  cancel: (runId) => ipcRenderer.invoke("cleaner:cancel", { runId }),
  onProgress: (callback) => subscribe("cleaner:progress", callback),
  onComplete: (callback) => subscribe("cleaner:complete", callback),
  onError: (callback) => subscribe("cleaner:error", callback)
});
