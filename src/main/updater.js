// Automatic updates from this project's GitHub releases (electron-updater).
//
// A release is what CI publishes for a v* tag: the installers plus latest*.yml metadata. The app
// checks shortly after start and every few hours, downloads a newer version in the background and
// installs it when the app is closed (or right away if the user asks). Only the packaged app updates.

import { app } from "electron";
import electronUpdater from "electron-updater";

const { autoUpdater } = electronUpdater;

export const RELEASES_URL = "https://github.com/ESAK9781/closet/releases/latest";
const FIRST_CHECK_MS = 15 * 1000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

// Why an install can't update itself. macOS is left out because updating there needs a signed app.
function unsupportedReason() {
  if (!app.isPackaged) return "Updates only apply to the installed app.";
  if (process.env.PORTABLE_EXECUTABLE_DIR) return "The portable build can't update itself. Download the new version from the releases page.";
  if (process.platform === "darwin") return "Updating in place needs a signed app, which closet isn't yet. Download new versions from the releases page.";
  if (process.platform === "linux" && !process.env.APPIMAGE) return "Only the AppImage build updates itself. Download the new package from the releases page.";
  return null;
}

/**
 * @param {object} o
 * @param {() => boolean} o.isAuto     whether periodic checks are switched on
 * @param {(state: object) => void} o.onState  called on every change
 */
export function createUpdater({ isAuto, onState }) {
  const reason = unsupportedReason();
  const state = { supported: !reason, reason, status: reason ? "unsupported" : "idle", version: app.getVersion(), latest: null, percent: 0, error: null, checkedAt: null };
  const set = (patch) => {
    Object.assign(state, patch);
    onState({ ...state, auto: isAuto() });
  };
  const busy = () => ["checking", "downloading", "ready"].includes(state.status);

  if (!reason) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = null;
    autoUpdater.on("checking-for-update", () => set({ status: "checking", error: null }));
    autoUpdater.on("update-available", (i) => set({ status: "downloading", latest: i.version, percent: 0 }));
    autoUpdater.on("update-not-available", () => set({ status: "current", latest: null, checkedAt: new Date().toISOString() }));
    autoUpdater.on("download-progress", (p) => set({ percent: Math.round(p.percent || 0) }));
    autoUpdater.on("update-downloaded", (i) => set({ status: "ready", latest: i.version, percent: 100, checkedAt: new Date().toISOString() }));
    autoUpdater.on("error", (e) => set({ status: "error", error: String(e?.message || e).split("\n")[0].slice(0, 200), checkedAt: new Date().toISOString() }));
  }

  const check = () => {
    if (reason || busy()) return;
    autoUpdater.checkForUpdates().catch(() => {}); // failures arrive through the "error" event
  };

  return {
    state: () => ({ ...state, auto: isAuto() }),
    check,
    /** Begin the background schedule (no-op for builds that can't update). */
    start() {
      if (reason) return;
      setTimeout(() => isAuto() && check(), FIRST_CHECK_MS).unref?.();
      setInterval(() => isAuto() && check(), CHECK_EVERY_MS).unref?.();
    },
    install() {
      if (state.status === "ready") autoUpdater.quitAndInstall(true, true);
    },
    notify: () => set({}),
  };
}
