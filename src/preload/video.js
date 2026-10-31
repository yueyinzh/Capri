const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("capriVideo", {
  getStatus: () => ipcRenderer.invoke("video:status"),
  addToQueue: (url, rightsConfirmed) =>
    ipcRenderer.invoke("video:queue-add", { url, rightsConfirmed }),
  listJobs: () => ipcRenderer.invoke("video:list"),
  cancel: (jobId) => ipcRenderer.invoke("video:cancel", { jobId }),
  retry: (jobId) => ipcRenderer.invoke("video:retry", { jobId }),
  openOutput: () => ipcRenderer.invoke("video:open-output"),
  openFolder: (jobId) => ipcRenderer.invoke("video:open-folder", { jobId }),
  onJobsUpdated: (callback) => {
    const listener = (_event, jobs) => callback(jobs);
    ipcRenderer.on("video:jobs-updated", listener);
    return () => ipcRenderer.removeListener("video:jobs-updated", listener);
  }
});
