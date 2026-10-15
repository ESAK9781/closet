// closet: Electron main process.
//
// Owns the Store (metadata folder + parser threads) and serves the UI from a private closet://
// scheme. The UI talks to the store through one IPC channel that keeps the REST-style paths the
// app has always used, and the store pushes a "changed" event instead of the UI polling.

import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, protocol, screen, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Store } from "../core/store.js";
import { createUpdater, RELEASES_URL } from "./updater.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const RENDERER = path.join(ROOT, "src", "renderer");
const TEMPLATES = path.join(ROOT, "resources", "templates");
const FONTS = path.join(ROOT, "node_modules", "@fontsource-variable", "archivo", "files");
const ICON = path.join(ROOT, "resources", process.platform === "win32" ? "icon.ico" : "icon.png");

// ---------------------------------------------------------------------------- app config
// Where the data lives is per-computer (userData/config.json); everything about the paperwork
// lives in the metadata folder next to the dump folder, so the two travel together. New installs
// keep both inside the app's data folder (per-OS via Electron), out of the way of casual edits;
// the quick-dump output folder is the one place meant to be opened, so it defaults to Documents.

const CONFIG = () => path.join(app.getPath("userData"), "config.json");
let config = {};

const defaultQuickDumpDir = () => path.join(app.getPath("documents"), "closet", "quick dump");

function loadConfig() {
  if (process.env.CLOSET_DUMP) {
    // tests / portable use: don't touch saved settings
    config = { dumpDir: process.env.CLOSET_DUMP, quickDumpDir: process.env.CLOSET_QUICKDUMP || path.join(path.dirname(path.resolve(process.env.CLOSET_DUMP)), "quick dump") };
    return;
  }
  try {
    config = JSON.parse(fs.readFileSync(CONFIG(), "utf8"));
  } catch {
    // First run under the "closet" name: carry settings over from when it was called "The Closet"
    try {
      config = JSON.parse(fs.readFileSync(path.join(app.getPath("appData"), "The Closet", "config.json"), "utf8"));
    } catch {
      config = {};
    }
  }
  if (!config.dumpDir) {
    // an older build's default location wins if it's already there, so nobody's paperwork "disappears"
    const legacy = path.join(app.getPath("documents"), "closet", "dump");
    config.dumpDir = fs.existsSync(legacy) ? legacy : path.join(app.getPath("userData"), "dump");
  }
  if (!config.quickDumpDir) config.quickDumpDir = defaultQuickDumpDir();
  saveConfig();
}

function saveConfig() {
  if (process.env.CLOSET_DUMP) return;
  fs.mkdirSync(path.dirname(CONFIG()), { recursive: true });
  fs.writeFileSync(CONFIG(), JSON.stringify(config, null, 1));
}

const metaDirFor = (dumpDir) => path.join(path.dirname(path.resolve(dumpDir)), "metadata");

// ---------------------------------------------------------------------------- store
let store = null;
let win = null;
let updater = null;

async function openStore() {
  if (store) await store.close();
  store = new Store({ dumpDir: config.dumpDir, metaDir: metaDirFor(config.dumpDir), templatesDir: TEMPLATES });
  store.on("changed", (v) => win?.webContents.send("closet:changed", v));
  win?.webContents.send("closet:changed", -1);
}

/** The REST-style routes the UI uses, served over IPC. */
async function route(method, url, body) {
  const [p, qs] = url.split("?");
  const q = new URLSearchParams(qs || "");
  const m = (re) => re.exec(p);
  let x;
  if (method === "GET" && p === "/api/state") return { ...store.snapshot(), quick_dump_dir: config.quickDumpDir };
  if (method === "GET" && p === "/api/version") return { version: store.version, status: { ...store.status, queued: store.queue.length + store.inFlight.size } };
  if (method === "POST" && p === "/api/quick-dump") return store.quickDump(config.quickDumpDir);
  if (method === "GET" && p === "/api/bulk-step") {
    const ids = (q.get("ids") || "").split(",").filter(Boolean);
    const plan = store.bulkPlan(q.get("step") || "", ids.length ? ids : null);
    return { ...plan, forms: plan.forms.map((f) => ({ id: f.id, filename: f.filename, recipients: f.recipients, writes: f.items.length })) };
  }
  if (method === "POST" && p === "/api/bulk-step") return store.bulkStep(String(body?.step || ""), body?.initials, Array.isArray(body?.ids) ? body.ids.map(String) : null);
  if ((x = m(/^\/api\/forms\/([0-9a-f]+)\/approve-aoc$/)) && method === "POST") return store.approveAoc(x[1]);
  if (method === "POST" && p === "/api/sync/pull") return store.sync.pull();
  if (method === "POST" && p === "/api/sync/resolve") return store.sync.resolve(Array.isArray(body?.decisions) ? body.decisions : []);
  if (method === "POST" && p === "/api/sync/push") return store.sync.push();
  if (method === "POST" && p === "/api/sync/fix") return store.sync.fix(String(body?.id || ""), String(body?.step || ""), String(body?.action || ""));
  if ((x = m(/^\/api\/sync\/pending\/([0-9a-f]+)$/)) && method === "GET") {
    const d = store.sync.pendingDetail(x[1]);
    if (!d) throw new Error("That pulled file is no longer waiting");
    return d;
  }
  if (method === "POST" && p === "/api/scan") return { ...store.scan(), version: store.version };
  if (method === "POST" && p === "/api/reset") {
    if (body?.confirm !== "clear") throw new Error("Missing confirmation");
    return { ...(await store.reset()), version: store.version };
  }
  if (method === "POST" && p === "/api/names/resolve") {
    if (!body?.a || !body?.b) throw new Error("Need both names");
    store.resolveNames(body.a, body.b, Boolean(body.same), body.correct || "");
    return { version: store.version };
  }
  if (method === "GET" && p === "/api/settings") return store.settings;
  if (method === "PUT" && p === "/api/settings") return store.updateSettings(body);
  if (method === "GET" && p === "/api/export.tsv") return store.exportTsv((q.get("ids") || "").split(",").filter(Boolean), q.get("header") === "1");
  if (method === "POST" && p === "/api/forms/bulk") {
    for (const id of body?.ids || []) store.updateForm(id, body.patch || {});
    return { updated: (body?.ids || []).length, version: store.version };
  }
  if (method === "POST" && p === "/api/upload/stage") {
    return { ...store.stageFiles((body?.paths || []).filter((x) => typeof x === "string")), version: store.version };
  }
  if (method === "POST" && p === "/api/upload/resolve") {
    if (!body?.name || !body?.src || !body?.action) throw new Error("Missing name/src/action");
    const name = store.resolveConflict(body.name, body.src, body.action);
    return { name, version: store.version };
  }
  if ((x = m(/^\/api\/forms\/([0-9a-f]+)\/reparse$/)) && method === "POST") {
    store.reparse(x[1]);
    return { ok: true };
  }
  if ((x = m(/^\/api\/forms\/([0-9a-f]+)$/))) {
    if (method === "GET") {
      const d = store.detail(x[1]);
      if (!d) throw new Error("No such form");
      return d;
    }
    if (method === "PATCH") {
      if (!store.updateForm(x[1], body || {})) throw new Error("No such form");
      return store.detail(x[1]);
    }
  }
  throw new Error(`Unknown request ${method} ${p}`);
}

function registerIpc() {
  ipcMain.handle("closet:api", async (_e, { method, url, body }) => {
    try {
      return { ok: true, data: await route(method || "GET", url, body) };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });
  ipcMain.handle("closet:copy", (_e, text) => clipboard.writeText(String(text ?? "")));
  ipcMain.handle("closet:open-pdf", async (_e, id) => {
    const f = store.pdfPath(id);
    if (!f) return "That PDF is no longer in the dump folder.";
    return (await shell.openPath(f)) || null;
  });
  ipcMain.handle("closet:show-pdf", (_e, id) => {
    const f = store.pdfPath(id);
    if (f) shell.showItemInFolder(f);
  });
  ipcMain.handle("closet:open-folder", (_e, which) => {
    if (which === "quickdump") fs.mkdirSync(config.quickDumpDir, { recursive: true });
    return shell.openPath(which === "meta" ? store.meta : which === "quickdump" ? config.quickDumpDir : store.dump);
  });
  ipcMain.handle("closet:choose-quick-dump", async () => {
    const r = await dialog.showOpenDialog(win, {
      title: "Choose the quick dump folder",
      message: "Quick dump writes its sorted folders and print packet here.",
      defaultPath: config.quickDumpDir,
      properties: ["openDirectory", "createDirectory"],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    config.quickDumpDir = r.filePaths[0];
    saveConfig();
    return config.quickDumpDir;
  });
  ipcMain.handle("closet:choose-sync-folder", async (_e, key, dir) => {
    const cur = store.settings.sync_folders?.[key]?.[dir];
    const r = await dialog.showOpenDialog(win, {
      title: dir === "push" ? "Choose the send folder" : "Choose the returned folder",
      message: dir === "push" ? "closet puts copies here for people to sign. It only ever removes its own copies." : "Signed copies saved here are pulled in at the next sync.",
      defaultPath: cur || undefined,
      properties: ["openDirectory", "createDirectory"],
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false };
    try {
      store.updateSettings({ sync_folders: { [key]: { [dir]: r.filePaths[0] } } });
      return { ok: true, path: r.filePaths[0] };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });
  ipcMain.handle("closet:clear-sync-folder", (_e, key, dir) => {
    try {
      store.updateSettings({ sync_folders: { [key]: { [dir]: "" } } });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });
  ipcMain.handle("closet:open-path", (_e, p) => {
    if (typeof p === "string" && path.isAbsolute(p) && fs.existsSync(p)) shell.showItemInFolder(p);
  });
  ipcMain.handle("closet:choose-dump", async () => {
    const r = await dialog.showOpenDialog(win, {
      title: "Choose the dump folder",
      message: "Pick the folder your paperwork PDFs go in. The metadata folder is kept next to it.",
      defaultPath: config.dumpDir,
      properties: ["openDirectory", "createDirectory"],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    config.dumpDir = r.filePaths[0];
    saveConfig();
    await openStore();
    return { dump: store.dump, meta: store.meta };
  });
  ipcMain.handle("closet:add-files", (_e, paths) => store.addFiles((paths || []).filter((p) => typeof p === "string")));
  ipcMain.handle("closet:update-state", () => updater.state());
  ipcMain.handle("closet:update-check", () => { updater.check(); return updater.state(); });
  ipcMain.handle("closet:update-install", () => updater.install());
  ipcMain.handle("closet:update-auto", (_e, on) => {
    config.autoUpdate = Boolean(on);
    saveConfig();
    if (config.autoUpdate) updater.check();
    updater.notify();
    return updater.state();
  });
  ipcMain.handle("closet:open-releases", () => shell.openExternal(RELEASES_URL));
  ipcMain.handle("closet:info", () => ({ version: app.getVersion(), platform: process.platform }));

  // ---------------------------------------------------------------- file-system dialogs
  ipcMain.handle("closet:download-pdf", async (_e, id) => {
    const src = store.pdfPath(id);
    if (!src) return { ok: false, error: "That PDF is no longer in the dump folder." };
    const r = await dialog.showSaveDialog(win, {
      title: "Save a copy of this paperwork", defaultPath: path.basename(src),
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (r.canceled || !r.filePath) return { ok: false };
    try {
      fs.copyFileSync(src, r.filePath);
      return { ok: true, path: r.filePath };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });
  ipcMain.handle("closet:upload-replacement", async (_e, id) => {
    if (!store.pdfPath(id)) return { ok: false, error: "That PDF is no longer in the dump folder." };
    const r = await dialog.showOpenDialog(win, {
      title: "Choose the updated copy", message: "Pick the newer (e.g. signed) PDF for this same form.",
      filters: [{ name: "PDF", extensions: ["pdf"] }], properties: ["openFile"],
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false };
    try {
      store.replaceFile(id, r.filePaths[0]);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });
  ipcMain.handle("closet:pick-upload-files", async () => {
    const r = await dialog.showOpenDialog(win, {
      title: "Add paperwork to the dump folder",
      filters: [{ name: "PDF", extensions: ["pdf"] }], properties: ["openFile", "multiSelections"],
    });
    return r.canceled ? [] : r.filePaths;
  });
  ipcMain.handle("closet:bulk-download", async (_e, ids) => {
    const files = (ids || []).map((id) => ({ id, src: store.pdfPath(id) })).filter((x) => x.src);
    if (!files.length) return { ok: false, error: "Nothing to download." };
    const r = await dialog.showOpenDialog(win, {
      title: "Choose a folder for the downloaded paperwork",
      properties: ["openDirectory", "createDirectory"],
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false };
    const dest = r.filePaths[0];
    let count = 0;
    for (const { src } of files) {
      const base = path.basename(src);
      const stem = base.replace(/\.pdf$/i, "");
      let name = base;
      for (let i = 2; fs.existsSync(path.join(dest, name)); i++) name = `${stem} (${i}).pdf`;
      try {
        fs.copyFileSync(src, path.join(dest, name));
        count++;
      } catch { /* one bad file shouldn't stop the rest */ }
    }
    return { ok: true, dir: dest, count };
  });
}

// ---------------------------------------------------------------------------- closet:// scheme
protocol.registerSchemesAsPrivileged([
  { scheme: "closet", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function inside(base, file) {
  const rel = path.relative(base, file);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function registerScheme() {
  protocol.handle("closet", async (req) => {
    const u = new URL(req.url);
    const parts = decodeURIComponent(u.pathname).split("/").filter(Boolean);
    let file = null;
    if (u.host === "app") {
      if (parts[0] === "fonts") file = path.join(FONTS, parts.slice(1).join("/"));
      else file = path.join(RENDERER, parts.join("/") || "index.html");
      if (!inside(parts[0] === "fonts" ? FONTS : RENDERER, file)) file = null;
    } else if (u.host === "syncpage" && parts.length === 2 && /^[0-9a-f]+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
      file = store?.sync.pageImage(parts[0], Number(parts[1]));
    } else if (u.host === "page" && parts.length === 2 && /^[0-9a-f]+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
      file = store?.pageImage(parts[0], Number(parts[1]));
    }
    if (!file || !fs.existsSync(file)) return new Response("Not found", { status: 404 });
    const res = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(res.headers);
    headers.set("Cache-Control", u.host === "page" || u.host === "syncpage" ? "no-cache" : "no-store");
    return new Response(res.body, { status: res.status, headers });
  });
}

// ---------------------------------------------------------------------------- window
function createWindow() {
  const b = config.bounds;
  const visible = b && screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x < a.x + a.width - 80 && b.x + b.width > a.x + 80 && b.y >= a.y - 10 && b.y < a.y + a.height - 80;
  });
  win = new BrowserWindow({
    width: visible ? b.width : 1440,
    height: visible ? b.height : 920,
    x: visible ? b.x : undefined,
    y: visible ? b.y : undefined,
    minWidth: 900,
    minHeight: 620,
    title: "closet",
    icon: fs.existsSync(ICON) ? ICON : undefined,
    backgroundColor: "#0f1319",
    show: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    titleBarOverlay: process.platform === "darwin" ? undefined : { color: "#0f1319", symbolColor: "#b4bbc8", height: 38 },
    webPreferences: {
      preload: path.join(ROOT, "src", "main", "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  if (visible && config.maximized) win.maximize();
  win.once("ready-to-show", () => win.show());
  const remember = () => {
    if (win.isMinimized()) return;
    config.maximized = win.isMaximized();
    if (!config.maximized) config.bounds = win.getBounds();
    saveConfig();
  };
  win.on("close", remember);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("closet://app/")) e.preventDefault();
  });
  win.loadURL("closet://app/index.html");
}

function buildMenu() {
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(null); // frameless look; copy/paste/undo still work in text boxes
    return;
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: "appMenu" },
    { role: "editMenu" },
    { label: "View", submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }] },
    { role: "windowMenu" },
  ]));
}

// ---------------------------------------------------------------------------- lifecycle
if (process.env.CLOSET_USER_DATA) app.setPath("userData", process.env.CLOSET_USER_DATA);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(async () => {
    app.setAppUserModelId("com.esak.thecloset");
    loadConfig();
    registerScheme();
    updater = createUpdater({ isAuto: () => config.autoUpdate !== false, onState: (st) => win?.webContents.send("closet:update-status", st) });
    registerIpc();
    buildMenu();
    await openStore();
    createWindow();
    updater.start();
    app.on("activate", () => {
      if (!BrowserWindow.getAllWindows().length) createWindow();
    });
  });
  app.on("window-all-closed", async () => {
    await store?.close();
    app.quit();
  });
}
