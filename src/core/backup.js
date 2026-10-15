// Backup and restore: the whole app state in one standard .zip file.
//
// What goes in: every PDF in the dump folder, the metadata folder (your edits, reviews, names,
// settings, sync state, and the originals closet kept when it edited a PDF), and the few
// per-computer app settings. Page images and the template cache are left out: they're rebuilt.
//
// Restoring is built so it can't leave you worse off than before it started: the whole backup is read
// and checked first (nothing is touched if it's damaged), the current state is saved to a safety
// backup, and if anything goes wrong part-way the safety backup is put back.
//
// Written by hand (Node's zlib only) so it adds no dependency and the file opens in any zip tool.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

export const BACKUP_FORMAT = 1;
export const BACKUP_EXT = ".zip";
const SKIP_META = new Set(["renders", "templates", "bulk", "sync"]); // rebuilt or temporary
const MAX_BYTES = 3.5 * 1024 ** 3; // no zip64: a bigger archive is refused instead of corrupted

// --------------------------------------------------------------------------- zip writing

const dosTime = (ms) => {
  const d = new Date(ms);
  const y = Math.max(1980, d.getFullYear());
  return [(d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()];
};

class ZipWriter {
  constructor(file) {
    this.fd = fs.openSync(file, "w");
    this.pos = 0;
    this.central = [];
  }

  write(buf) {
    fs.writeSync(this.fd, buf);
    this.pos += buf.length;
    if (this.pos > MAX_BYTES) throw new Error("The backup would be larger than 3.5 GB, which this format can't hold");
  }

  add(name, data, mtimeMs = Date.now()) {
    const nameBuf = Buffer.from(name, "utf8");
    const crc = zlib.crc32(data);
    let body = data;
    let method = 0;
    if (data.length > 64) {
      const z = zlib.deflateRawSync(data, { level: 6 });
      if (z.length < data.length) { body = z; method = 8; }
    }
    const [t, d] = dosTime(mtimeMs);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6); // UTF-8 names
    head.writeUInt16LE(method, 8);
    head.writeUInt16LE(t, 10);
    head.writeUInt16LE(d, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    this.central.push({ nameBuf, crc, method, csize: body.length, usize: data.length, t, d, offset: this.pos });
    this.write(head);
    this.write(nameBuf);
    this.write(body);
  }

  close() {
    const start = this.pos;
    for (const e of this.central) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0);
      c.writeUInt16LE(20, 4);
      c.writeUInt16LE(20, 6);
      c.writeUInt16LE(0x0800, 8);
      c.writeUInt16LE(e.method, 10);
      c.writeUInt16LE(e.t, 12);
      c.writeUInt16LE(e.d, 14);
      c.writeUInt32LE(e.crc, 16);
      c.writeUInt32LE(e.csize, 20);
      c.writeUInt32LE(e.usize, 24);
      c.writeUInt16LE(e.nameBuf.length, 28);
      c.writeUInt32LE(e.offset, 42);
      this.write(c);
      this.write(e.nameBuf);
    }
    const size = this.pos - start;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.central.length, 8);
    end.writeUInt16LE(this.central.length, 10);
    end.writeUInt32LE(size, 12);
    end.writeUInt32LE(start, 16);
    this.write(end);
    fs.fsyncSync(this.fd);
    fs.closeSync(this.fd);
  }

  abort() {
    try { fs.closeSync(this.fd); } catch { /* already closed */ }
  }
}

// --------------------------------------------------------------------------- zip reading

/** Open a zip: its entries, and a function that returns an entry's bytes after checking them. */
export function openZip(file) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    if (size < 22) throw new Error("That file is too small to be a backup");
    const tailLen = Math.min(size, 65557);
    const tail = Buffer.alloc(tailLen);
    fs.readSync(fd, tail, 0, tailLen, size - tailLen);
    let e = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error("That isn't a backup file (or it was cut short while saving)");
    const count = tail.readUInt16LE(e + 10);
    const cdSize = tail.readUInt32LE(e + 12);
    const cdOff = tail.readUInt32LE(e + 16);
    if (cdOff + cdSize > size || count === 0xffff) throw new Error("The backup's index is damaged");
    const cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdOff);
    const entries = [];
    for (let p = 0, i = 0; i < count; i++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== 0x02014b50) throw new Error("The backup's index is damaged");
      const nlen = cd.readUInt16LE(p + 28);
      const xlen = cd.readUInt16LE(p + 30);
      const clen = cd.readUInt16LE(p + 32);
      entries.push({
        name: cd.toString("utf8", p + 46, p + 46 + nlen), method: cd.readUInt16LE(p + 10), crc: cd.readUInt32LE(p + 16),
        csize: cd.readUInt32LE(p + 20), usize: cd.readUInt32LE(p + 24), offset: cd.readUInt32LE(p + 42),
      });
      p += 46 + nlen + xlen + clen;
    }
    const read = (en) => {
      const h = Buffer.alloc(30);
      fs.readSync(fd, h, 0, 30, en.offset);
      if (h.readUInt32LE(0) !== 0x04034b50) throw new Error(`"${en.name}" is damaged in the backup`);
      const data = Buffer.alloc(en.csize);
      fs.readSync(fd, data, 0, en.csize, en.offset + 30 + h.readUInt16LE(26) + h.readUInt16LE(28));
      let out;
      try {
        out = en.method === 0 ? data : en.method === 8 ? zlib.inflateRawSync(data) : null;
      } catch {
        out = null;
      }
      if (!out || out.length !== en.usize || zlib.crc32(out) !== en.crc) throw new Error(`"${en.name}" is damaged in the backup`);
      return out;
    };
    return { entries, read, close: () => fs.closeSync(fd) };
  } catch (err) {
    fs.closeSync(fd);
    throw err;
  }
}

// --------------------------------------------------------------------------- what is in a backup

function listFiles(root, skipTop = new Set()) {
  const out = [];
  const walk = (dir, rel) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!rel && skipTop.has(d.name)) continue;
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) walk(path.join(dir, d.name), r);
      else if (d.isFile() && !d.name.endsWith(".tmp")) out.push(r);
    }
  };
  if (fs.existsSync(root)) walk(root, "");
  return out;
}

const dumpPdfs = (dump) => (fs.existsSync(dump) ? fs.readdirSync(dump, { withFileTypes: true }).filter((d) => d.isFile() && /\.pdf$/i.test(d.name)).map((d) => d.name) : []);

/**
 * Write a backup of the app's state to `out` (a single .zip). Written beside it and renamed into
 * place, so a failure never leaves a half-written file where a backup should be.
 *
 * @param {{dump: string, meta: string, config?: object, appVersion?: string, out: string}} o
 */
export function createBackup({ dump, meta, config = {}, appVersion = "", out }) {
  const tmp = `${out}.partial`;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const zip = new ZipWriter(tmp);
  try {
    const pdfs = dumpPdfs(dump);
    const metaFiles = listFiles(meta, SKIP_META);
    const files = {};
    let bytes = 0;
    for (const n of pdfs) {
      const p = path.join(dump, n);
      const data = fs.readFileSync(p);
      const st = fs.statSync(p);
      files[`dump/${n}`] = { mtimeMs: st.mtimeMs };
      bytes += data.length;
      zip.add(`dump/${n}`, data, st.mtimeMs);
    }
    for (const r of metaFiles) {
      const p = path.join(meta, ...r.split("/"));
      const data = fs.readFileSync(p);
      const st = fs.statSync(p);
      files[`metadata/${r}`] = { mtimeMs: st.mtimeMs };
      bytes += data.length;
      zip.add(`metadata/${r}`, data, st.mtimeMs);
    }
    const keep = ["quickDumpDir", "autoUpdate"]; // per-computer; the dump location stays where it is on restore
    const manifest = {
      app: "closet", format: BACKUP_FORMAT, created_at: new Date().toISOString(), app_version: appVersion, platform: process.platform,
      source_dump_dir: dump, pdfs: pdfs.length, forms: metaFiles.filter((f) => /^forms\/[^/]+\.json$/.test(f)).length,
      meta_files: metaFiles.length, bytes, files,
    };
    zip.add("config.json", Buffer.from(JSON.stringify(Object.fromEntries(keep.filter((k) => k in config).map((k) => [k, config[k]])), null, 1)));
    zip.add("manifest.json", Buffer.from(JSON.stringify(manifest, null, 1)));
    zip.close();
    fs.renameSync(tmp, out);
    return { path: out, pdfs: pdfs.length, forms: manifest.forms, meta_files: metaFiles.length, bytes: fs.statSync(out).size };
  } catch (e) {
    zip.abort();
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

/**
 * Read a backup completely and check it: structure, every file's checksum, and every path (nothing
 * may point outside the dump/metadata folders). Throws on the first problem; touches nothing.
 */
export function verifyBackup(file) {
  const zip = openZip(file);
  try {
    const byName = new Map(zip.entries.map((e) => [e.name, e]));
    if (byName.size !== zip.entries.length) throw new Error("The backup lists the same file twice");
    const mEntry = byName.get("manifest.json");
    if (!mEntry) throw new Error("That zip isn't a closet backup (no manifest)");
    let manifest;
    try {
      manifest = JSON.parse(zip.read(mEntry).toString("utf8"));
    } catch (e) {
      throw new Error(`The backup's manifest is unreadable: ${e.message}`);
    }
    if (manifest.app !== "closet") throw new Error("That zip isn't a closet backup");
    if (manifest.format !== BACKUP_FORMAT) throw new Error(`That backup was made by a different version of closet (format ${manifest.format}); update closet to restore it`);
    for (const e of zip.entries) {
      if (e.name === "manifest.json" || e.name === "config.json") continue;
      const m = /^(dump|metadata)\/(.+)$/.exec(e.name);
      const parts = m ? m[2].split("/") : [];
      const bad = !m || e.name.includes("\\") || e.name.includes(":") || e.name.endsWith("/") || parts.some((p) => !p || p === "." || p === "..");
      if (bad) throw new Error(`The backup contains an unexpected path ("${e.name}"), so it was not restored`);
      if (m[1] === "dump" && (parts.length !== 1 || !/\.pdf$/i.test(parts[0]))) throw new Error(`The backup contains an unexpected dump file ("${e.name}")`);
      zip.read(e); // checks size and checksum
    }
    for (const n of Object.keys(manifest.files || {})) if (!byName.has(n)) throw new Error(`The backup is missing "${n}"`);
    const config = byName.has("config.json") ? JSON.parse(zip.read(byName.get("config.json")).toString("utf8")) : {};
    return { manifest, config };
  } finally {
    zip.close();
  }
}

/** Replace the dump PDFs and metadata with the contents of an already-verified backup. */
function extractBackup(file, { dump, meta }, manifest) {
  const zip = openZip(file);
  try {
    for (const n of dumpPdfs(dump)) fs.rmSync(path.join(dump, n), { force: true });
    fs.rmSync(meta, { recursive: true, force: true });
    fs.mkdirSync(dump, { recursive: true });
    fs.mkdirSync(meta, { recursive: true });
    for (const e of zip.entries) {
      const m = /^(dump|metadata)\/(.+)$/.exec(e.name);
      if (!m) continue;
      const base = m[1] === "dump" ? dump : meta;
      const dest = path.join(base, ...m[2].split("/"));
      const rel = path.relative(base, dest);
      if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`Refusing to write outside the app folders: ${e.name}`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, zip.read(e));
      const ms = manifest.files?.[e.name]?.mtimeMs;
      if (ms) fs.utimesSync(dest, ms / 1000, ms / 1000); // exactly the same modified time (fractional seconds), so nothing needs reading again
    }
  } finally {
    zip.close();
  }
}

/**
 * Put a backup in place of the current dump PDFs and metadata. Only the app's own things are
 * replaced: the PDFs in the dump folder (not other files or folders there) and the metadata folder's
 * contents. `safety` is where the current state is saved first; it's put back if this fails.
 *
 * @returns {{manifest: object, config: object, safety: string}}
 */
export function restoreBackup(file, { dump, meta, safety, appVersion = "" }) {
  const { manifest, config } = verifyBackup(file); // nothing below runs if the backup is bad
  createBackup({ dump, meta, appVersion, out: safety });
  try {
    extractBackup(file, { dump, meta }, manifest);
  } catch (err) {
    try {
      extractBackup(safety, { dump, meta }, verifyBackup(safety).manifest);
    } catch (e2) {
      err.message += ` (and putting your previous data back also failed: ${e2.message}; it is saved in ${safety})`;
      throw err;
    }
    err.message += " Your previous data was put back.";
    throw err;
  }
  return { manifest, config, safety };
}

export { ZipWriter };
