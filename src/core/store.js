// The metadata folder: settings, template cache, one JSON per PDF, page images.
//
// PDFs are never moved or modified. Each PDF in the dump folder gets metadata/forms/<id>.json,
// where id is derived from the filename (same scheme and schema as the original Python version, so
// an existing metadata folder carries straight over). A PDF is only read again when its size/mtime
// *and* content hash change, or when the parser version is bumped. User edits live under
// `overrides` and survive re-reads (and renames: a renamed file with the same content inherits them).

import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";

import { ParserPool } from "./pool.js";
import { quickDump } from "./quickdump.js";
import * as R from "./records.js";
import { Sync, validateFolders } from "./sync.js";
import { APPROVE_STAMP, BULK_STEPS, FORM_TYPES, flagSlots } from "./templates.js";

export const PARSER_VERSION = 20; // JS engine; bumping re-reads every form (edits are kept)

export const DEFAULT_SETTINGS = {
  form_type_labels: { F10: "F10", F174: "F174" },
  pos_label: "Pos",
  neg_label: "Neg",
  month_format: "name",
  f174_commander_role: "aoc_signed",
  include_header: false,
  position_tolerance_pt: 10,
  first_shirt_fill_date: true, // bulk SQ/CCF initialing also writes today's date in the log-in date box
  bulk_initials: { sqccf_processed: "", cadet_cc_initialed: "" }, // remembered between runs
  dump_mode: "quick", // "quick": one Quick dump folder; "sync": send/returned folders per step (sync.js)
  print_packet: false, // also write the combined AOC/AMT print packet when dumping or syncing
  sync_folders: {}, // { <step key>|complete|intake: { push, pull } }
};

// Blank templates that older versions kept in the dump folder: never listed as paperwork.
const TEMPLATE_NAMES = new Set(Object.values(FORM_TYPES).map((s) => s.templateFile.toLowerCase()));

const now = () => new Date().toISOString().slice(0, 19);
const clone = (o) => structuredClone(o);

/** Today's date the way the forms write it: "15 Oct 26", or ISO when the form's own date is ISO. */
function todayText(iso = false) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
  return iso ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : `${pad(d.getDate())} ${mon} ${String(d.getFullYear()).slice(2)}`;
}

export function formId(filename) {
  return createHash("sha1").update(filename.toLowerCase(), "utf8").digest("hex").slice(0, 14);
}

/** Atomic JSON write, retrying while Windows briefly holds the file (antivirus, OneDrive, a reader). */
export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      if (attempt >= 19 || !["EPERM", "EBUSY", "EACCES"].includes(e.code)) throw e;
      const until = Date.now() + 50 * (attempt + 1);
      while (Date.now() < until) { /* brief spin; happens rarely */ }
    }
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function sha1File(file) {
  return createHash("sha1").update(fs.readFileSync(file)).digest("hex");
}

export class Store extends EventEmitter {
  /**
   * @param {object} o
   * @param {string} o.dumpDir     where the PDFs live (never modified)
   * @param {string} o.metaDir     where everything closet learns is kept
   * @param {string} o.templatesDir bundled blank templates
   * @param {number} [o.workers]   parser threads
   */
  constructor({ dumpDir, metaDir, templatesDir, workers }) {
    super();
    this.dump = path.resolve(dumpDir);
    this.meta = path.resolve(metaDir);
    this.formsDir = path.join(this.meta, "forms");
    this.rendersDir = path.join(this.meta, "renders");
    this.tmplDir = path.join(this.meta, "templates");
    for (const d of [this.dump, this.formsDir, this.rendersDir, this.tmplDir]) fs.mkdirSync(d, { recursive: true });
    const readme = path.join(this.meta, "README.txt");
    if (!fs.existsSync(readme)) {
      fs.writeFileSync(readme, [
        "closet - metadata folder", "",
        "forms/<id>.json   one file per PDF in the dump folder: cached read + your edits (overrides)",
        "renders/<id>/     cached page images used by the app",
        "templates/        cached geometry of the blank template forms",
        "names.json        name spellings you confirmed (typo answers)",
        "settings.json     app settings", "",
        "Deleting renders/ or templates/ is safe (they are rebuilt). forms/ holds your edits.", "",
      ].join("\n"));
    }
    this.metas = new Map();
    this.queue = [];
    this.inFlight = new Set();
    this.status = { state: "idle", done: 0, total: 0, current: null, last_scan: null };
    this.version = 0; // bumps whenever anything visible changes
    this.generation = 0; // bumps on reset; reads that finish afterwards are dropped
    this.templateError = null;
    this.settings = this.loadSettings();
    this.namesPath = path.join(this.meta, "names.json");
    this.names = this.loadNames();
    this.sync = new Sync(this);
    if (this.settings.dump_mode === "sync") this.sync.activate();
    for (const f of fs.readdirSync(this.formsDir)) {
      if (!f.endsWith(".json")) continue;
      const m = readJson(path.join(this.formsDir, f), null);
      if (m?.id) this.metas.set(m.id, m);
    }
    this.pool = new ParserPool({ templatesDir, cacheDir: this.tmplDir, size: workers });
    this.ready = this.pool.start().then(
      () => { this.templateError = null; },
      (e) => { this.templateError = String(e.message || e); this.bump(); },
    );
    this.ready.then(() => {
      this.scan();
      this.watch();
    });
  }

  // ------------------------------------------------------------------ change notification
  bump() {
    this.version++;
    clearTimeout(this.emitTimer);
    this.emitTimer = setTimeout(() => this.emit("changed", this.version), 60);
  }

  watch() {
    // Real file watching (the Python version polled every 10 s); a slow periodic scan backs it
    // up for network drives and sync clients where change events can be missed.
    try {
      this.watcher = fs.watch(this.dump, () => {
        clearTimeout(this.scanTimer);
        this.scanTimer = setTimeout(() => this.scan(), 400);
      });
      this.watcher.on("error", () => {});
    } catch { /* folder not watchable: the periodic scan still works */ }
    this.poller = setInterval(() => this.scan(), 30000);
  }

  async close() {
    this.watcher?.close();
    clearInterval(this.poller);
    clearTimeout(this.scanTimer);
    await this.pool.stop();
  }

  // ------------------------------------------------------------------ settings
  loadSettings() {
    const file = path.join(this.meta, "settings.json");
    const s = clone(DEFAULT_SETTINGS);
    const user = readJson(file, {});
    delete user.details_chars; // reason details are never trimmed
    delete user.template_files; // templates ship with the app now
    for (const [k, v] of Object.entries(user)) {
      if (!(k in DEFAULT_SETTINGS)) continue;
      if (v && typeof v === "object" && typeof s[k] === "object") Object.assign(s[k], v);
      else s[k] = v;
    }
    writeJson(file, s);
    return s;
  }

  updateSettings(patch) {
    let reread = false;
    if (patch?.sync_folders) {
      const merged = { ...this.settings.sync_folders };
      for (const [k, v] of Object.entries(patch.sync_folders)) merged[k] = { ...merged[k], ...v };
      validateFolders(merged, { dump: this.dump, meta: this.meta });
      patch = { ...patch, sync_folders: merged };
    }
    for (const v of Object.values(patch?.bulk_initials || {})) {
      if (typeof v !== "string" || v.length > 8 || /[^ -~]/.test(v)) throw new Error("Initials are 8 printable characters at most");
    }
    if (patch?.dump_mode !== undefined && !["quick", "sync"].includes(patch.dump_mode)) throw new Error("Unknown dump mode");
    for (const [k, v] of Object.entries(patch || {})) {
      if (!(k in DEFAULT_SETTINGS)) continue;
      if (k === "position_tolerance_pt" && v !== this.settings[k]) reread = true;
      if (k === "sync_folders") this.settings[k] = v;
      else if (v && typeof v === "object" && typeof this.settings[k] === "object") Object.assign(this.settings[k], v);
      else this.settings[k] = v;
    }
    if (this.settings.dump_mode === "sync") this.sync.activate();
    writeJson(path.join(this.meta, "settings.json"), this.settings);
    if (reread) for (const id of this.metas.keys()) this.reparse(id);
    this.bump();
    return this.settings;
  }

  // ------------------------------------------------------------------ name spellings
  loadNames() {
    const data = { aliases: {}, distinct: [], ...readJson(this.namesPath, {}) };
    R.ALIASES.clear();
    for (const [k, v] of Object.entries(data.aliases)) R.ALIASES.set(k, v);
    return data;
  }

  /** Different names within two characters of each other that the user hasn't ruled on. */
  namePairs(forms) {
    const counts = new Map();
    for (const f of forms) {
      if (f.missing || !f.parsed) continue;
      for (const n of f.record.recipient_list || []) counts.set(n, (counts.get(n) || 0) + 1);
    }
    const distinct = new Set(this.names.distinct.map((p) => [...p].sort().join("\u0000")));
    const names = [...counts.keys()].sort();
    const pairs = [];
    for (let i = 0; i < names.length; i++) {
      const la = names[i].toLowerCase();
      if (la.length < 4) continue;
      for (let j = i + 1; j < names.length; j++) {
        const lb = names[j].toLowerCase();
        if (la === lb || lb.length < 4 || distinct.has([la, lb].sort().join("\u0000"))) continue;
        if (R.levenshtein(la, lb, 2) <= 2) pairs.push({ a: names[i], b: names[j], a_forms: counts.get(names[i]), b_forms: counts.get(names[j]) });
      }
    }
    return pairs;
  }

  resolveNames(a, b, same, correct = "") {
    const la = R.collapse(a).toLowerCase();
    const lb = R.collapse(b).toLowerCase();
    if (same) {
      const fix = R.collapse(correct) || a;
      const al = this.names.aliases;
      for (const [old, target] of Object.entries(al)) if ([la, lb].includes(target.toLowerCase())) al[old] = fix; // follow along
      for (const n of [la, lb]) if (n !== fix.toLowerCase()) al[n] = fix;
      delete al[fix.toLowerCase()];
    } else {
      this.names.distinct.push([la, lb].sort());
    }
    writeJson(this.namesPath, this.names);
    this.names = this.loadNames();
    this.bump();
  }

  // ------------------------------------------------------------------ scanning
  save(m) {
    writeJson(path.join(this.formsDir, `${m.id}.json`), m);
  }

  newMeta(id, filename) {
    return {
      id, filename, added_at: now(),
      size: null, mtime: null, sha1: null, parser_version: null,
      analysis: null, filename_info: R.parseFilename(filename),
      issues: [], overrides: {}, reviewed: false, reviewed_at: null,
      logged: false, logged_at: null, notes: "", history: [],
    };
  }

  /** Cheap stat pass. Queues new/changed PDFs for the parser pool. */
  scan() {
    const seen = new Set();
    let changed = false;
    let files = [];
    try {
      files = fs.readdirSync(this.dump, { withFileTypes: true })
        .filter((d) => d.isFile() && d.name.toLowerCase().endsWith(".pdf") && !TEMPLATE_NAMES.has(d.name.toLowerCase()))
        .map((d) => d.name)
        .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    } catch { /* dump folder unavailable (unplugged drive): everything shows as missing */ }
    for (const name of files) {
      const id = formId(name);
      seen.add(id);
      let st;
      try {
        st = fs.statSync(path.join(this.dump, name));
      } catch {
        continue;
      }
      let m = this.metas.get(id);
      if (!m) {
        m = this.newMeta(id, name);
        this.metas.set(id, m);
        this.save(m);
        changed = true;
      }
      if (m.missing) {
        m.missing = false;
        changed = true;
      }
      const stale = m.size !== st.size || m.mtime !== st.mtimeMs / 1000 || m.parser_version !== PARSER_VERSION || !m.analysis;
      if (stale && !this.queue.includes(id) && !this.inFlight.has(id)) this.queue.push(id);
    }
    for (const [id, m] of this.metas) {
      if (!seen.has(id) && !m.missing) {
        m.missing = true;
        this.save(m);
        changed = true;
      }
    }
    this.status.last_scan = now();
    if (this.queue.length) this.pump();
    if (changed) this.bump();
    return { queued: this.queue.length, changed };
  }

  reparse(id) {
    const m = this.metas.get(id);
    if (!m) return;
    m.parser_version = null;
    if (!this.queue.includes(id) && !this.inFlight.has(id)) this.queue.unshift(id);
    this.pump();
  }

  /**
   * Forget everything learned about the paperwork and read the dump folder from scratch: cached
   * reads, page images, template cache, name answers and all edits. Settings are kept.
   */
  async reset() {
    this.generation++;
    this.queue.length = 0;
    const n = this.metas.size;
    this.metas.clear();
    for (const d of [this.formsDir, this.rendersDir]) {
      fs.rmSync(d, { recursive: true, force: true });
      fs.mkdirSync(d, { recursive: true });
    }
    fs.rmSync(this.namesPath, { force: true });
    this.names = this.loadNames();
    Object.assign(this.status, { state: "idle", done: 0, total: 0, current: null });
    this.bump();
    return { cleared: n, ...this.scan() };
  }

  // ------------------------------------------------------------------ parsing (worker pool)
  pump() {
    if (this.templateError) return;
    this.status.total = this.status.done + this.queue.length + this.inFlight.size;
    while (this.queue.length && this.inFlight.size < this.pool.size) {
      const id = this.queue.shift();
      const m = this.metas.get(id);
      if (!m) continue;
      this.inFlight.add(id);
      this.status.state = "parsing";
      this.status.current = m.filename;
      this.parse(m).finally(() => {
        this.inFlight.delete(id);
        if (!this.queue.length && !this.inFlight.size) Object.assign(this.status, { state: "idle", done: 0, total: 0, current: null });
        this.bump();
        this.pump();
      });
    }
    this.bump();
  }

  async parse(m) {
    const file = path.join(this.dump, m.filename);
    const gen = this.generation;
    let st;
    let sha;
    try {
      st = fs.statSync(file);
      sha = sha1File(file);
    } catch {
      return;
    }
    // content unchanged and parser current -> just refresh stat info
    if (sha === m.sha1 && m.parser_version === PARSER_VERSION && m.analysis) {
      Object.assign(m, { size: st.size, mtime: st.mtimeMs / 1000 });
      this.save(m);
      this.status.done++;
      return;
    }
    // renamed file? inherit edits from a missing record with identical content
    if (!m.sha1 && !Object.keys(m.overrides || {}).length) {
      for (const other of this.metas.values()) {
        if (other !== m && other.missing && other.sha1 === sha) {
          for (const k of ["overrides", "reviewed", "reviewed_at", "logged", "logged_at", "archived", "archived_at", "notes", "history"]) {
            if (other[k] !== undefined) m[k] = clone(other[k]);
          }
          m.history = [...(m.history || []), { at: now(), what: `Renamed from ${other.filename}` }];
          this.metas.delete(other.id);
          fs.rmSync(path.join(this.formsDir, `${other.id}.json`), { force: true });
          fs.rmSync(path.join(this.rendersDir, other.id), { recursive: true, force: true });
          break;
        }
      }
    }
    const t0 = Date.now();
    let a;
    try {
      a = await this.pool.analyze({
        file, hint: m.overrides?.form_type || null, // form type comes from the pages, not the name
        renderDir: path.join(this.rendersDir, m.id),
        tol: Number(this.settings.position_tolerance_pt) || 10,
      });
    } catch (e) {
      a = { error: `Could not read PDF: ${e.message || e}`, page_count: 0 };
    }
    a.parse_seconds = Math.round((Date.now() - t0) / 10) / 100;
    if (gen !== this.generation || this.metas.get(m.id) !== m) return; // cleared while it was being read
    // A machine-readable form that comes back as a scan is the print-sign-scan round trip. Reading
    // the scan would replace real values with blanks and guessed ink, so keep the earlier read, show
    // the new pages, and send it back to review for a person to check the signatures.
    const prev = m.analysis;
    const scannedBack = m.sha1 && m.sha1 !== sha && prev && !prev.error && prev.mode !== "raster" && a.mode === "raster";
    if (scannedBack) {
      const { renders, render_scale, page_count, page_map, layout_scores, registration, parse_seconds } = a;
      a = { ...prev, renders, render_scale, page_count, page_map, layout_scores, registration, parse_seconds, scanned_copy: true };
      m.scan_replaced_at = now();
      Object.assign(m, { reviewed: false, reviewed_at: null });
      m.history = [...(m.history || []), { at: now(), what: "Scanned copy uploaded; earlier read kept, sent back for review" }].slice(-60);
    } else {
      delete m.scan_replaced_at;
    }
    Object.assign(m, {
      size: st.size, mtime: st.mtimeMs / 1000, sha1: sha, parser_version: PARSER_VERSION,
      analysis: a, filename_info: R.parseFilename(m.filename), parsed_at: now(),
    });
    m.issues = this.issues(m);
    this.save(m);
    this.status.done++;
  }

  // ------------------------------------------------------------------ review classification
  issues(m) {
    const a = m.analysis || {};
    const fn = m.filename_info || {};
    const out = [];
    const review = (text) => out.push({ level: "review", text });
    const warn = (text) => out.push({ level: "warn", text });
    if (a.error) {
      review(a.error);
      return out;
    }
    if (m.scan_replaced_at) review("Replaced with a scanned copy. The earlier read was kept, not re-read: check the signatures and initials by hand");
    if (!fn.pos_neg) review("Filename has no Pos/Neg part, so it can't tell positive from negative");
    if (!fn.reason) warn("Filename has no reason part, so Reason Category is blank");
    for (const n of a.type_notes || []) review(n);
    if (a.page_count > a.template_pages) review(`${a.page_count} pages; the ${a.form_type} template has ${a.template_pages}`);
    const pm = a.page_map || [];
    const slots = a.slots || {};
    const missingPages = pm.map((j, i) => (j < 0 ? i + 1 : 0)).filter(Boolean);
    if (missingPages.length && Object.values(slots).some((s) => s.page === null)) review(`Template page ${missingPages.join(", ")} not found in the PDF`);
    const total = a.slot_total || 1;
    const byWidget = Object.values(slots).filter((s) => s.source_widget).length;
    if (a.mode === "fields" && byWidget < 0.8 * total) review(`Only ${byWidget} of ${total} form fields found`);
    else if (a.mode === "text") review("No fillable fields – values were read from flattened text positions");
    else if (a.mode === "raster") review("Scanned/rasterized form – text can't be read automatically");
    const scored = (a.layout_scores || []).filter((_, i) => pm[i] >= 0);
    if (scored.length && Math.min(...scored) < 0.45) review("Page layout differs noticeably from the template");
    const core = FORM_TYPES[a.form_type]?.core || [];
    const lost = core.filter((k) => slots[k] && !slots[k].located).map((k) => slots[k].label);
    if (lost.length) review(`Couldn't locate: ${lost.join(", ")}`);
    const unreadable = Object.values(slots).filter((s) => s.source === "ink" && s.ftype === "Text").map((s) => s.label);
    if (unreadable.length && a.mode !== "raster") warn(`Handwriting detected but not readable: ${unreadable.slice(0, 6).join(", ")}`);
    if (!["date", "date_awarded"].some((k) => slots[k]?.filled)) warn("No date on the form");
    const loose = Object.values(slots).filter((s) => s.source_widget && !s.within_tolerance).map((s) => s.label);
    if (loose.length) {
      warn(`${loose.length} field(s) matched but sit more than ${this.settings.position_tolerance_pt} pt from the template position: ${loose.slice(0, 5).join(", ")}`);
    }
    if (a.extra_widgets?.length) warn(`${a.extra_widgets.length} filled field(s) didn't match any template slot`);
    return out;
  }

  // ------------------------------------------------------------------ edits
  updateForm(id, patch) {
    const m = this.metas.get(id);
    if (!m) return null;
    const ov = (m.overrides ||= {});
    const changes = [];
    const allowed = new Set([...R.RECORD_FIELDS, ...R.FLAG_KEYS]);
    for (const [k, v] of Object.entries(patch.overrides || {})) {
      if (!allowed.has(k)) continue;
      if (v === null) {
        if (k in ov) {
          delete ov[k];
          changes.push(`${k} reset to detected`);
        }
      } else if (ov[k] !== v) {
        ov[k] = v;
        changes.push(`${k} → ${typeof v === "boolean" ? (v ? "yes" : "no") : v}`);
      }
    }
    const fields = (ov.fields ||= {});
    for (const [k, v] of Object.entries(patch.fields || {})) {
      if (v === null) {
        if (k in fields) {
          delete fields[k];
          changes.push(`field ${k} reset`);
        }
      } else if (fields[k] !== v) {
        fields[k] = v;
        changes.push(`field ${k} edited`);
      }
    }
    if (!Object.keys(fields).length) delete ov.fields;
    const words = {
      reviewed: ["marked reviewed", "unmarked reviewed"],
      logged: ["marked logged to sheet", "unmarked logged to sheet"],
      archived: ["archived", "restored from archive"],
    };
    for (const [k, [on, off]] of Object.entries(words)) {
      if (k in patch && Boolean(patch[k]) !== Boolean(m[k])) {
        m[k] = Boolean(patch[k]);
        m[`${k}_at`] = patch[k] ? now() : null;
        changes.push(patch[k] ? on : off);
      }
    }
    if ("notes" in patch && patch.notes !== m.notes) {
      m.notes = patch.notes;
      changes.push("notes edited");
    }
    if (patch.overrides && "form_type" in patch.overrides) this.reparse(id); // read against the template the user named
    if (changes.length) {
      m.history = [...(m.history || []), { at: now(), what: changes.join("; ") }].slice(-60);
      this.save(m);
      this.bump();
    }
    return m;
  }

  /** Copy PDFs into the dump folder (drag and drop). Never overwrites: "name (2).pdf" etc. */
  addFiles(paths) {
    const added = [];
    for (const src of paths) {
      if (!src.toLowerCase().endsWith(".pdf") || !fs.existsSync(src)) continue;
      if (path.dirname(path.resolve(src)) === this.dump) continue; // already there
      const base = path.basename(src, path.extname(src));
      let name = `${base}.pdf`;
      for (let i = 2; fs.existsSync(path.join(this.dump, name)); i++) name = `${base} (${i}).pdf`;
      fs.copyFileSync(src, path.join(this.dump, name), fs.constants.COPYFILE_EXCL);
      added.push(name);
    }
    if (added.length) this.scan();
    return added;
  }

  /**
   * Copy PDFs into the dump folder, but pause on a name collision instead of silently renaming:
   * used by the "Add files" button, where the caller can ask whether a collision is an updated
   * (e.g. newly signed) copy of the same paperwork rather than a different form.
   */
  stageFiles(paths) {
    const added = [];
    const conflicts = [];
    for (const src of paths) {
      if (!src.toLowerCase().endsWith(".pdf") || !fs.existsSync(src)) continue;
      if (path.dirname(path.resolve(src)) === this.dump) continue; // already there
      const name = path.basename(src);
      if (fs.existsSync(path.join(this.dump, name))) {
        conflicts.push({ src, name });
      } else {
        fs.copyFileSync(src, path.join(this.dump, name), fs.constants.COPYFILE_EXCL);
        added.push(name);
      }
    }
    if (added.length) this.scan();
    return { added, conflicts };
  }

  /**
   * Settle one name collision from stageFiles(): "replace" overwrites the existing PDF's content
   * (same id, so edits/flags/history carry over -- an updated or newly signed copy); "keep-both"
   * adds it alongside under a suffixed name; "skip" leaves the dump folder untouched.
   */
  resolveConflict(name, src, action) {
    if (action === "skip" || !fs.existsSync(src)) return null;
    if (action === "replace") {
      fs.copyFileSync(src, path.join(this.dump, name));
      const m = this.metas.get(formId(name));
      if (m) {
        m.history = [...(m.history || []), { at: now(), what: "Replaced with an uploaded copy" }].slice(-60);
        this.save(m);
      }
      this.scan();
      return name;
    }
    const base = path.basename(name, ".pdf");
    let alt = name;
    for (let i = 2; fs.existsSync(path.join(this.dump, alt)); i++) alt = `${base} (${i}).pdf`;
    fs.copyFileSync(src, path.join(this.dump, alt));
    this.scan();
    return alt;
  }

  /**
   * Overwrite one form's PDF with an updated copy (e.g. the same paperwork scanned back in with a
   * signature on it now), keeping the same filename so edits, flags and history carry over.
   */
  replaceFile(id, src, note = "Replaced with an uploaded copy") {
    const m = this.metas.get(id);
    if (!m) throw new Error("No such form");
    if (!fs.existsSync(src)) throw new Error("That file no longer exists");
    fs.copyFileSync(src, path.join(this.dump, m.filename));
    m.history = [...(m.history || []), { at: now(), what: note }].slice(-60);
    this.save(m);
    this.scan();
    this.reparse(id); // even if size and modified time happen to match the old file
  }

  /** Forms that still need a bulk step, and what would be written on each. */
  bulkPlan(step, ids = null) {
    const spec = BULK_STEPS[step];
    if (!spec) throw new Error("That step can't be completed in bulk");
    const fillDates = !spec.dateSetting || Boolean(this.settings[spec.dateSetting]);
    const out = [];
    let skipped = 0;
    for (const f of this.snapshot().forms) {
      if (f.archived || f.missing || f.record?.[step] !== false || (ids && !ids.includes(f.id))) continue;
      const m = this.metas.get(f.id);
      const slots = m?.analysis?.slots || {};
      const at = slots[spec.initials];
      if (!f.parsed || f.pending || !at?.located || at.page === null || !this.pdfPath(f.id)) { skipped++; continue; }
      const items = [];
      if (!at.filled) items.push({ key: spec.initials, page: at.page, rect: at.rect, kind: "initials" });
      if (fillDates) for (const k of spec.dates) if (slots[k]?.located && slots[k].page !== null && !slots[k].filled) items.push({ key: k, page: slots[k].page, rect: slots[k].rect, kind: "date" });
      out.push({ id: f.id, filename: f.filename, recipients: f.record.recipients || "", items, iso: /^\d{4}-\d\d-\d\d$/.test(String(slots.date?.value || "").trim()) });
    }
    return { step, label: spec.label, forms: out, skipped, fill_dates: fillDates, initials: this.settings.bulk_initials?.[step] || "" };
  }

  /**
   * Initial (and date) every form still waiting on a step: the same initials everywhere, written into
   * the PDF (the original is kept under metadata/backups), and the step's flag set. The initials are
   * remembered for next time.
   */
  async bulkStep(step, initials, ids = null) {
    initials = String(initials ?? "").trim();
    if (!initials) throw new Error("Enter the initials to use");
    this.updateSettings({ bulk_initials: { [step]: initials } });
    await this.ready;
    if (this.templateError) throw new Error(this.templateError);
    await this.whenIdle();
    const plan = this.bulkPlan(step, ids);
    const dateText = todayText;
    const out = { step, label: plan.label, initials, done: [], failed: [], skipped: plan.skipped, filled_dates: plan.fill_dates, written: 0 };
    const work = path.join(this.meta, "bulk");
    const backups = path.join(this.meta, "backups");
    fs.mkdirSync(work, { recursive: true });
    fs.mkdirSync(backups, { recursive: true });
    await Promise.all(plan.forms.map(async (f) => {
      const m = this.metas.get(f.id);
      const src = this.pdfPath(f.id);
      const tmp = path.join(work, `${f.id}.pdf`);
      try {
        if (!m || !src) throw new Error("the file is gone");
        const items = f.items.map((it) => ({ page: it.page, rect: it.rect, text: it.kind === "initials" ? initials : dateText(f.iso) }));
        if (items.length) {
          const before = sha1File(src);
          await this.pool.run("fillSlots", { file: src, items, out: tmp });
          if (sha1File(src) !== before) throw new Error("the file changed while it was being edited; try again");
          this.backupAndReplace(m, src, tmp);
          out.written += items.length;
        }
        const ov = (m.overrides ||= {});
        ov[step] = true; // shown as done in the app even before the edited PDF has been read again
        const what = items.length ? `Bulk ${plan.label}: wrote ${f.items.map((i) => (i.kind === "initials" ? `initials ${initials}` : "date")).join(" and ")} into the PDF` : `Bulk ${plan.label}: marked done (already filled in)`;
        m.history = [...(m.history || []), { at: now(), what }].slice(-60);
        this.save(m);
        this.reparse(f.id);
        out.done.push(f.id);
      } catch (e) {
        out.failed.push({ id: f.id, filename: f.filename, error: String(e?.message || e) });
      } finally {
        fs.rmSync(tmp, { force: true });
      }
    }));
    this.scan();
    this.bump();
    return out;
  }

  /**
   * Mark one form's AOC/AMT approval without a signed copy (the AMT said yes, nothing came back):
   * the empty signature box is removed and a red "approved by First Sergeant (unofficial)" stamp goes
   * where it was, with any date box that goes with it filled. Single form only, on purpose.
   */
  async approveAoc(id) {
    const m = this.metas.get(id);
    if (!m) throw new Error("No such form");
    await this.ready;
    await this.whenIdle();
    const f = this.snapshot().forms.find((x) => x.id === id);
    if (!f || f.archived || !f.parsed) throw new Error("That form isn't ready (it may still be being read)");
    if (f.record.aoc_signed !== false) throw new Error(f.record.aoc_signed ? "That form already has its AOC/AMT signature" : "This form has no AOC/AMT step");
    const slotKey = (flagSlots(f.record.form_type, this.settings).aoc_signed || [])[0];
    const slots = m.analysis?.slots || {};
    const at = slots[slotKey];
    if (!at?.located || at.page === null) throw new Error("closet couldn't find where the AOC/AMT signature goes on this form");
    const spec = APPROVE_STAMP[slotKey] || { expandDown: 0, dates: [] };
    const iso = /^\d{4}-\d\d-\d\d$/.test(String(slots.date?.value || "").trim());
    const today = todayText(iso);
    const dates = spec.dates.filter((k) => slots[k]?.located && slots[k].page !== null && !slots[k].filled)
      .map((k) => ({ page: slots[k].page, rect: slots[k].rect, text: today }));
    const src = this.pdfPath(id);
    if (!src) throw new Error("The PDF is gone");
    const work = path.join(this.meta, "bulk");
    fs.mkdirSync(work, { recursive: true });
    const tmp = path.join(work, `${id}.pdf`);
    try {
      const before = sha1File(src);
      const r = await this.pool.run("approveAoc", {
        file: src, out: tmp,
        options: { page: at.page, rect: at.rect, expandDown: spec.expandDown, small: "Marked AOC/AMT approved by First Sergeant (unofficial)", big: "AOC/AMT Approved", date: todayText(false), dates },
      });
      if (sha1File(src) !== before) throw new Error("the file changed while it was being edited; try again");
      this.backupAndReplace(m, src, tmp);
      (m.overrides ||= {}).aoc_signed = true;
      m.history = [...(m.history || []), { at: now(), what: `Marked AOC/AMT approved by First Sergeant (unofficial): ${r.removed ? "empty signature box replaced with" : "added"} a stamp${dates.length ? " and dated the form" : ""}` }].slice(-60);
      this.save(m);
      this.reparse(id);
      this.scan();
      this.bump();
      return { id, removed: r.removed, dated: dates.length };
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  /** Keep the file as it was under metadata/backups, then put the edited copy in its place. */
  backupAndReplace(m, src, edited) {
    const backups = path.join(this.meta, "backups");
    fs.mkdirSync(backups, { recursive: true });
    fs.copyFileSync(src, path.join(backups, `${m.id}-${Date.now()}.pdf`));
    fs.copyFileSync(edited, src);
  }

  /** Resolves once nothing is queued or being read. */
  whenIdle(timeout = 300000) {
    const t0 = Date.now();
    return new Promise((resolve, reject) => {
      const tick = () => {
        if (!this.queue.length && !this.inFlight.size) return resolve();
        if (Date.now() - t0 > timeout) return reject(new Error("Timed out waiting for forms to be read"));
        setTimeout(tick, 100);
      };
      tick();
    });
  }

  // ------------------------------------------------------------------ views
  snapshot() {
    const metas = [...this.metas.values()];
    const roster = R.buildRoster(metas.filter((m) => !m.missing));
    const forms = metas.map((m) => this.summary(m, roster));
    forms.sort((a, b) => ((b.record.date_iso || "") + b.filename.toLowerCase()).localeCompare((a.record.date_iso || "") + a.filename.toLowerCase()));
    return {
      version: this.version,
      status: { ...this.status, queued: this.queue.length + this.inFlight.size },
      template_error: this.templateError,
      settings: this.settings,
      columns: R.SHEET_COLUMNS,
      roster: Object.fromEntries(roster),
      name_pairs: this.namePairs(forms),
      forms,
      sync: this.sync.summary(),
      dump_dir: this.dump,
      meta_dir: this.meta,
    };
  }

  summary(m, roster) {
    const rec = m.analysis ? R.buildRecord(m, this.settings, roster) : null;
    const issues = m.issues || [];
    const flagged = issues.some((i) => i.level === "review");
    return {
      id: m.id,
      filename: m.filename,
      missing: Boolean(m.missing),
      parsed: Boolean(m.analysis),
      pending: this.queue.includes(m.id) || this.inFlight.has(m.id),
      mode: m.analysis?.mode ?? null,
      page_count: m.analysis?.page_count ?? null,
      issues,
      needs_review: flagged && !m.reviewed && !m.archived,
      // a positive F10 without CDNA/Passes stays on the incomplete list until they're entered
      incomplete: rec && !m.archived && !m.missing ? R.missingManual(rec) : [],
      archived: Boolean(m.archived),
      archived_at: m.archived_at ?? null,
      flagged,
      reviewed: Boolean(m.reviewed),
      reviewed_at: m.reviewed_at ?? null,
      logged: Boolean(m.logged),
      logged_at: m.logged_at ?? null,
      notes: m.notes || "",
      added_at: m.added_at,
      record: rec || {},
      rows: rec ? R.sheetRows(rec, this.settings, roster) : [],
    };
  }

  detail(id) {
    const m = this.metas.get(id);
    if (!m) return null;
    const roster = R.buildRoster([...this.metas.values()].filter((x) => !x.missing));
    return {
      ...this.summary(m, roster),
      analysis: m.analysis || {},
      filename_info: m.filename_info,
      overrides: m.overrides || {},
      fields: R.effectiveFields(m),
      history: m.history || [],
      sha1: m.sha1,
      parsed_at: m.parsed_at,
    };
  }

  exportTsv(ids, header) {
    const snap = this.snapshot();
    const want = ids?.length ? new Set(ids) : null;
    const lines = header ? [snap.columns.join("\t")] : [];
    for (const f of [...snap.forms].reverse()) {
      if (f.missing || f.archived || (want && !want.has(f.id))) continue;
      lines.push(...f.rows.map((r) => r.join("\t")));
    }
    return lines.join("\n");
  }

  quickDump(outDir) {
    return quickDump(this, outDir, { packet: Boolean(this.settings.print_packet) });
  }

  pageImage(id, n) {
    const dir = path.join(this.rendersDir, id);
    for (const ext of ["jpg", "png"]) {
      const f = path.join(dir, `p${n}.${ext}`);
      if (fs.existsSync(f)) return f;
    }
    return null;
  }

  pdfPath(id) {
    const m = this.metas.get(id);
    if (!m) return null;
    const f = path.join(this.dump, m.filename);
    return fs.existsSync(f) ? f : null;
  }
}
