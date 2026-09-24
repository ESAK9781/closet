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
  chooseDumpFolder: () => ipcRenderer.invoke("closet:choose-dump"),
  addFiles: (files) => ipcRenderer.invoke("closet:add-files", Array.from(files, (f) => webUtils.getPathForFile(f))),
  info: () => ipcRenderer.invoke("closet:info"),
  platform: process.platform,
});
