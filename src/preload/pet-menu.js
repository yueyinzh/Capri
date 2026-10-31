const { contextBridge, ipcRenderer } = require("electron");

const subscribe = (channel, callback) => {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld("capriPetMenu", {
  getSnapshot: () => ipcRenderer.invoke("pet-menu:snapshot"),
  runCommand: (command) => ipcRenderer.invoke("pet-menu:command", command),
  onUpdate: (callback) => subscribe("pet-menu:update", callback)
});
