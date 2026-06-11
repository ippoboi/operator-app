"use strict";
const { contextBridge, ipcRenderer } = require("electron");

/* API-shaped seam: plain JSON in/out. V2 promotes these to HTTP endpoints. */
contextBridge.exposeInMainWorld("api", {
  getSyncStatus: () => ipcRenderer.invoke("sync:status"),
  setCredentials: (provider, creds) => ipcRenderer.invoke("sync:set-credentials", provider, creds),
  connectGoogle: () => ipcRenderer.invoke("sync:connect", "google"),
  connectStrava: () => ipcRenderer.invoke("sync:connect", "strava"),
  disconnect: (provider) => ipcRenderer.invoke("sync:disconnect", provider),
  pushPlan: (snapshot) => ipcRenderer.invoke("sync:push-plan", snapshot),
  syncStrava: (plan) => ipcRenderer.invoke("sync:strava", plan),
});
