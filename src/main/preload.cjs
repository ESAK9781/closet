// The only bridge between the page and the app: a small, explicit API (no Node in the page).
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("closet", {
  /** REST-style call into the store: api("PATCH", "/api/forms/<id>", {...}) */
  api: async (method, url, body) => {
    const r = await ipcRenderer.invoke("closet:api", { method, url, body });
    if (!r.ok) throw new Error(r.error);
    return r.data;
  },
  onChanged: (fn) => ipcRenderer.on("closet:changed", (_e, v) => fn(v)),
  copy: (text) => ipcRenderer.invoke("closet:copy", text),
  openPdf: (id) => ipcRenderer.invoke("closet:open-pdf", id),
  showPdf: (id) => ipcRenderer.invoke("closet:show-pdf", id),
  openFolder: (which) => ipcRenderer.invoke("closet:open-folder", which),
  chooseQuickDumpFolder: () => ipcRenderer.invoke("closet:choose-quick-dump"),
  chooseSyncFolder: (key, dir) => ipcRenderer.invoke("closet:choose-sync-folder", key, dir),
  clearSyncFolder: (key, dir) => ipcRenderer.invoke("closet:clear-sync-folder", key, dir),
  showPath: (p) => ipcRenderer.invoke("closet:open-path", p),
  chooseDumpFolder: () => ipcRenderer.invoke("closet:choose-dump"),
  addFiles: (files) => ipcRenderer.invoke("closet:add-files", Array.from(files, (f) => webUtils.getPathForFile(f))),
  info: () => ipcRenderer.invoke("closet:info"),
  downloadPdf: (id) => ipcRenderer.invoke("closet:download-pdf", id),
  uploadReplacement: (id) => ipcRenderer.invoke("closet:upload-replacement", id),
  pickUploadFiles: () => ipcRenderer.invoke("closet:pick-upload-files"),
  bulkDownload: (ids) => ipcRenderer.invoke("closet:bulk-download", ids),
  updates: {
    state: () => ipcRenderer.invoke("closet:update-state"),
    check: () => ipcRenderer.invoke("closet:update-check"),
    install: () => ipcRenderer.invoke("closet:update-install"),
    setAuto: (on) => ipcRenderer.invoke("closet:update-auto", on),
    openReleases: () => ipcRenderer.invoke("closet:open-releases"),
    onStatus: (fn) => ipcRenderer.on("closet:update-status", (_e, st) => fn(st)),
  },
  platform: process.platform,
});
