// OneDrive "Files On-Demand": a file in a synced folder can be a placeholder with no content on this
// computer yet, and a file just written is uploaded a moment later (and locked while that happens).
// Anything closet reads from a folder it doesn't own goes through ensureLocal() first; anything it
// writes is checked with settle() afterwards. Off Windows, or outside a OneDrive folder, both are
// no-ops, so nothing else needs to know.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const OFFLINE = 0x1000; // content isn't here
const RECALL_ON_OPEN = 0x40000;
const RECALL_ON_DATA_ACCESS = 0x400000; // OneDrive's placeholder flag
const CLOUD_ONLY = OFFLINE | RECALL_ON_OPEN | RECALL_ON_DATA_ACCESS;

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export function inOneDrive(p) {
  if (!p || !probe.supported()) return false;
  const full = path.resolve(p).toLowerCase();
  const roots = [process.env.OneDrive, process.env.OneDriveCommercial, process.env.OneDriveConsumer].filter(Boolean).map((r) => path.resolve(r).toLowerCase());
  return roots.some((r) => full === r || full.startsWith(r + path.sep)) || /[\\/]onedrive[^\\/]*[\\/]/i.test(full);
}

// Swappable so tests can pretend a file is a placeholder.
export const probe = {
  supported: () => process.platform === "win32", // placeholders are a Windows file attribute
  attributes(p) {
    try {
      const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "[int](Get-Item -LiteralPath $env:CLOSET_P -Force).Attributes"],
        { env: { ...process.env, CLOSET_P: p }, encoding: "utf8", timeout: 15000, windowsHide: true });
      return parseInt(out.trim(), 10) || 0;
    } catch {
      return 0; // can't tell: treat as an ordinary file and let the read report its own error
    }
  },
  read(p) {
    const fd = fs.openSync(p, "r");
    try { // reading is what makes OneDrive download the content
      const buf = Buffer.alloc(1 << 20);
      while (fs.readSync(fd, buf, 0, buf.length, null) > 0) { /* drain */ }
    } finally {
      fs.closeSync(fd);
    }
  },
};

export const isCloudOnly = (p) => inOneDrive(p) && (probe.attributes(p) & CLOUD_ONLY) !== 0;

/**
 * Make sure a file's content is on this computer before reading it. Returns true when it had to be
 * downloaded. Throws a sentence when OneDrive can't deliver it (signed out, offline, paused).
 */
export function ensureLocal(p, { timeoutMs = 90000 } = {}) {
  if (!isCloudOnly(p)) return false;
  const name = path.basename(p);
  const t0 = Date.now();
  let lastErr = null;
  while (Date.now() - t0 < timeoutMs) {
    try {
      probe.read(p);
      if (!isCloudOnly(p)) return true;
    } catch (e) {
      lastErr = e;
    }
    sleep(1500);
  }
  throw new Error(`“${name}” is only in OneDrive, not on this computer yet, and OneDrive didn't download it${lastErr ? ` (${lastErr.code || lastErr.message})` : ""}. Check that OneDrive is running, signed in and not paused, or right-click the file → Always keep on this device, then try again.`);
}

/**
 * After closet writes a file: give OneDrive time to pick it up. It locks a file while uploading, so
 * "can be opened for writing again" is the signal it has finished. Never throws; returns whether the
 * file was free by the deadline.
 */
export function settle(p, { timeoutMs = 20000 } = {}) {
  if (!inOneDrive(p)) return true;
  sleep(1500); // let the sync client notice the change and take its lock
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      fs.closeSync(fs.openSync(p, "r+"));
      return true;
    } catch (e) {
      if (!["EBUSY", "EPERM", "EACCES"].includes(e.code)) return true;
    }
    sleep(500);
  }
  return false;
}
