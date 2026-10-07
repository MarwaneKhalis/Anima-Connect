const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("anima", Object.freeze({
  request: (request) => ipcRenderer.invoke("anima:request", request),
}));
