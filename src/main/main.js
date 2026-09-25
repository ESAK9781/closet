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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const RENDERER = path.join(ROOT, "src", "renderer");
const TEMPLATES = path.join(ROOT, "resources", "templates");
const FONTS = path.join(ROOT, "node_modules", "@fontsource-variable", "archivo", "files");
const ICON = path.join(ROOT, "resources", process.platform === "win32" ? "icon.ico" : "icon.png");

// ---------------------------------------------------------------------------- app config
// Where the data lives is per-computer (userData/config.json); everything about the paperwork
// lives in the metadata folder next to the dump folder, so the two travel together.

const CONFIG = () => path.join(app.getPath("userData"), "config.json");
let config = {};

function loadConfig() {
  if (process.env.CLOSET_DUMP) {
    config = { dumpDir: process.env.CLOSET_DUMP }; // tests / portable use: don't touch saved settings
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
  if (!config.dumpDir) config.dumpDir = path.join(app.getPath("documents"), "closet", "dump");
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
  if (method === "GET" && p === "/api/state") return store.snapshot();
  if (method === "GET" && p === "/api/version") return { version: store.version, status: { ...store.status, queued: store.queue.length + store.inFlight.size } };
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
  ipcMain.handle("closet:open-folder", (_e, which) => shell.openPath(which === "meta" ? store.meta : store.dump));
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
  ipcMain.handle("closet:info", () => ({ version: app.getVersion(), platform: process.platform }));
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
    } else if (u.host === "page" && parts.length === 2 && /^[0-9a-f]+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
      file = store?.pageImage(parts[0], Number(parts[1]));
    }
    if (!file || !fs.existsSync(file)) return new Response("Not found", { status: 404 });
    const res = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(res.headers);
    headers.set("Cache-Control", u.host === "page" ? "no-cache" : "no-store");
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
    registerIpc();
    buildMenu();
    await openStore();
    createWindow();
    app.on("activate", () => {
      if (!BrowserWindow.getAllWindows().length) createWindow();
    });
  });
  app.on("window-all-closed", async () => {
    await store?.close();
    app.quit();
  });
}
