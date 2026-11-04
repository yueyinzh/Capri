const { contextBridge, ipcRenderer } = require("electron");

const subscribe = (channel, callback) => {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld("capriChat", {
  getBootstrap: () => ipcRenderer.invoke("chat:bootstrap"),
  send: (text) => ipcRenderer.invoke("chat:send", { text }),
  stop: () => ipcRenderer.invoke("chat:stop"),
  clear: () => ipcRenderer.invoke("chat:clear"),
  switchPersona: (personaId) =>
    ipcRenderer.invoke("chat:switch-persona", { personaId }),
  saveProvider: (config) => ipcRenderer.invoke("chat:save-provider", config),
  setApiKey: (apiKey) => ipcRenderer.invoke("chat:set-api-key", { apiKey }),
  clearApiKey: () => ipcRenderer.invoke("chat:clear-api-key"),
  onDelta: (callback) => subscribe("chat:delta", callback),
  onPhase: (callback) => subscribe("chat:phase", callback),
  onDone: (callback) => subscribe("chat:done", callback),
  onError: (callback) => subscribe("chat:error", callback),
  onHistory: (callback) => subscribe("chat:history", callback)
});
