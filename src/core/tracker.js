// Served tours and confinements, and the balance everyone owes.
//
// closet knows what was *assigned* (the Tours and Confinements on each Form 10) and counts it only
// once the form is fully signed and not rejected. What was *served* is written down by hand in a
// spreadsheet, so closet reads that: only the serving log, never the balances sheet. Balance =
// assigned - served, per cadet, floored at zero like the sheet's own formula.
// closet can also write the whole workbook (conduct log, serving log, balances with live formulas)
// after saving a copy, and make a blank workbook laid out the way the defaults expect. Where things
// sit in the sheet is all settings (`tracker` in settings.json); the defaults match the CS07 tracker.
// The workbook may live in OneDrive: it is downloaded before it is read and left to sync after a write.

import fs from "node:fs";
import path from "node:path";

import { ensureLocal, settle } from "./cloud.js";
import { bestMatch } from "./people.js";
import * as R from "./records.js";
import { writeJson } from "./store.js";
import { colLetter, isoToSerial, normHeader, patchWorkbook, readWorkbook, serialToIso, writeWorkbook } from "./xlsx.js";

const POLL_MS = 20000;
const KEEP_BACKUPS = 10;
const BLANK_ROWS = 300; // pre-formatted rows in a new workbook
const BAL_ROWS = 91; // balance rows always carrying formulas, so a name typed below the last one just works
export const TRACKER_SCHEMA = 2;

// What a pushed conduct column can show. Indexes are into R.sheetRows(); the rest come from the form.
export const PUSH_SOURCES = [
  ["date", "Date"], ["class_year", "Class year"], ["form_type", "Form type"], ["reason_category", "Reason category"],
  ["reason_details", "Reason details"], ["month", "Month"], ["recipient", "Recipient"], ["issuer", "Issuer"], ["pos_neg", "Pos/Neg"],
  ["cdna", "CDNA"], ["passes", "Passes"], ["demerits", "Demerits"], ["tours", "Tours"], ["confinements", "Confinements"], ["other", "Other"],
  ["squadron", "Squadron"], ["filename", "File name"], ["status", "Processing status (Complete / In progress / Rejected)"],
];
export const BAL_SOURCES = [
  ["name", "Cadet name"], ["class_year", "Class year"], ["reports", "Reports count"], ["tours_assigned", "Tours assigned"], ["tours_served", "Tours served"],
  ["tours_left", "Tours left"], ["conf_assigned", "Confinements assigned"], ["conf_served", "Confinements served"], ["conf_left", "Confinements left"], ["status", "Balance status"],
];
const ROW_INDEX = Object.fromEntries(["date", "class_year", "form_type", "reason_category", "reason_details", "month", "recipient", "issuer", "pos_neg", "cdna", "passes", "demerits", "tours", "confinements", "other"].map((k, i) => [k, i]));
const NUMERIC = new Set(["class_year", "cdna", "passes", "demerits", "tours", "confinements"]);
const WIDTH = { date: 12, class_year: 11, form_type: 11, reason_category: 24, reason_details: 40, month: 12, recipient: 24, issuer: 22, pos_neg: 9, other: 20, filename: 36, status: 14 };
const DONE = "Complete";

export const SERVED_FIELDS = [["date", "Date served"], ["cadet", "Cadet name"], ["type", "Sanction type"], ["amount", "Amount served"], ["supervisor", "Supervisor"], ["notes", "Notes"]];
export const SERVED_REQUIRED = ["cadet", "type", "amount"];

const cols = (pairs) => pairs.map(([header, source]) => ({ header, source }));
export const TRACKER_DEFAULTS = {
  schema: TRACKER_SCHEMA,
  path: "", // the workbook
  auto_pull: true, // re-read the serving log whenever the file changes
  served: {
    sheet: "Served Log", header_row: 9,
    columns: { date: "Date Served", cadet: "Cadet Name", type: "Sanction Type", amount: "Amount Served", supervisor: "Supervisor / Monitor", notes: "Notes" },
    tour_word: "Tour", confinement_word: "Confinement", // what the type column says
  },
  push: {
    enabled: false, // writing into the workbook is opt-in
    sheet: "Conduct Log", header_row: 1,
    columns: cols([
      ["Date", "date"], ["Class Year", "class_year"], ["Form Type", "form_type"], ["Reason Category", "reason_category"], ["Description", "reason_details"],
      ["Month", "month"], ["Recipient", "recipient"], ["Issuer", "issuer"], ["Pos/Neg", "pos_neg"], ["CDNA", "cdna"], ["Passes", "passes"],
      ["Demerits", "demerits"], ["Tours", "tours"], ["Confinements", "confinements"], ["Other", "other"], ["Status", "status"],
    ]),
    served: { enabled: true }, // rewritten from a fresh read of itself, with names spelled the way the balances expect
    balances: {
      enabled: true, sheet: "Cadet Balances", header_row: 9, // cadet names plus live formulas; never read back
      columns: cols([
        ["Cadet Name", "name"], ["Class Year", "class_year"], ["Reports Count", "reports"], ["Tours Assigned", "tours_assigned"], ["Tours Served", "tours_served"],
        ["Net Tours", "tours_left"], ["Confinements Assigned", "conf_assigned"], ["Confinements Served", "conf_served"], ["Net Confinements", "conf_left"], ["Status", "status"],
      ]),
    },
  },
};

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const merge = (base, patch) => {
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(patch || {})) {
    if (!(k in base)) continue;
    out[k] = isObj(base[k]) && isObj(v) ? merge(base[k], v) : v;
  }
  return out;
};

/** Settings saved by an older closet, brought up to date (before they are merged and checked). */
export function upgradeTracker(saved) {
  if (!isObj(saved) || (saved.schema ?? 1) >= TRACKER_SCHEMA) return saved;
  const t = structuredClone(saved);
  const old = JSON.stringify(cols([["Date", "date"], ["Class Year", "class_year"], ["Form Type", "form_type"], ["Reason Category", "reason_category"], ["Description", "reason_details"], ["Month", "month"], ["Recipient", "recipient"], ["Issuer", "issuer"], ["Pos/Neg", "pos_neg"], ["CDNA", "cdna"], ["Passes", "passes"], ["Demerits", "demerits"], ["Tours", "tours"], ["Confinements", "confinements"], ["Other", "other"]]));
  t.push ||= {};
  if (Array.isArray(t.push.columns)) {
    if (JSON.stringify(t.push.columns) === old) delete t.push.columns; // the old defaults: take the new ones
    else if (!t.push.columns.some((c) => c?.source === "status")) t.push.columns = [...t.push.columns, { header: "Status", source: "status" }];
  }
  const { sheet, header_row } = t.push.balances || {};
  t.push.balances = { enabled: true, ...(sheet ? { sheet } : {}), ...(header_row ? { header_row } : {}) }; // the whole sheet is written now
  t.push.served = { enabled: true };
  t.schema = TRACKER_SCHEMA;
  return t;
}

/** Settings after merging a patch over the current ones; throws a sentence for anything unusable. */
export function mergeTracker(cur, patch) {
  const t = merge(cur, patch);
  const str = (v, what, max = 200) => {
    const s = String(v ?? "").trim();
    if (!s) throw new Error(`${what} can't be blank`);
    if (s.length > max) throw new Error(`${what} is too long`);
    return s;
  };
  const sheet = (v, what) => {
    const s = str(v, what, 31);
    if (/[\[\]:*?/\\]/.test(s)) throw new Error(`${what} can't contain [ ] : * ? / \\`);
    return s;
  };
  const row = (v, what) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 1000) throw new Error(`${what} must be a row number from 1 to 1000`);
    return n;
  };
  const columns = (list, sources, what, need = []) => {
    if (!Array.isArray(list) || !list.length || list.length > 40) throw new Error(`${what}: pick between 1 and 40 columns`);
    const seen = new Set();
    const out = list.map((c) => {
      const header = str(c?.header, "A column heading", 60);
      if (!sources.some(([k]) => k === c?.source)) throw new Error(`“${header}” has no valid source`);
      if (seen.has(normHeader(header))) throw new Error(`“${header}” is listed twice`);
      seen.add(normHeader(header));
      return { header, source: c.source };
    });
    for (const n of need) if (!out.some((c) => c.source === n)) throw new Error(`${what} needs a column for “${sources.find(([k]) => k === n)[1]}”`);
    return out;
  };
  t.schema = TRACKER_SCHEMA;
  t.path = String(t.path ?? "").trim().replace(/^"(.*)"$/, "$1");
  if (t.path && !/\.xls[xm]$/i.test(t.path)) throw new Error("The discipline sheet has to be an .xlsx workbook. In Google Sheets use File → Download → Microsoft Excel.");
  t.auto_pull = t.auto_pull !== false;
  const s = t.served;
  s.sheet = sheet(s.sheet, "The served log's sheet name");
  s.header_row = row(s.header_row, "The served log's header row");
  for (const [k, label] of SERVED_FIELDS) {
    s.columns[k] = String(s.columns[k] ?? "").trim();
    if (SERVED_REQUIRED.includes(k) && !s.columns[k]) throw new Error(`The “${label}” column needs a heading`);
  }
  s.tour_word = str(s.tour_word, "The word for tours", 30).replace(/["*?~]/g, "");
  s.confinement_word = str(s.confinement_word, "The word for confinements", 30).replace(/["*?~]/g, "");
  if (!s.tour_word || !s.confinement_word) throw new Error("The words for tours and confinements need some letters in them");
  if (normHeader(s.tour_word) === normHeader(s.confinement_word)) throw new Error("Tours and confinements need different words");
  const p = t.push;
  p.enabled = p.enabled === true;
  p.sheet = sheet(p.sheet, "The conduct log's sheet name");
  p.header_row = row(p.header_row, "The conduct log's header row");
  p.columns = columns(p.columns, PUSH_SOURCES, "The conduct log", ["recipient"]);
  p.served = { enabled: p.served?.enabled !== false };
  const b = p.balances;
  b.enabled = b.enabled !== false;
  b.sheet = sheet(b.sheet, "The balances sheet name");
  b.header_row = row(b.header_row, "The balances header row");
  b.columns = columns(b.columns, BAL_SOURCES, "The balances sheet", ["name"]);
  if (b.columns.filter((c) => c.source === "name").length > 1) throw new Error("The balances sheet can only have one cadet name column");
  const names = [p.sheet, b.sheet, ...(p.served.enabled ? [s.sheet] : [])].map((x) => x.toLowerCase());
  if (new Set(names).size !== names.length) throw new Error("The conduct log, serving log and balances need three different sheets");
  return t;
}

const now = () => new Date().toISOString().slice(0, 19);
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const quote = (name) => `'${name.replace(/'/g, "''")}'`;
const wordIn = (w) => w.replace(/"/g, '""');

/**
 * The Excel formula for one cell of a balances row, or null when the workbook lacks a column it
 * needs. X says where things are: X.name (this sheet's name column letter), X.col(source) (this
 * sheet's other columns), X.cond(source) / X.srv(field) (whole-column ranges on the conduct and
 * serving logs), and the words in the type column.
 */
function balanceFormula(source, r, X) {
  const me = `$${X.name}${r}`;
  const g = (body) => `IF(${me}="","",${body})`;
  const rec = X.cond("recipient");
  const assigned = (field) => {
    const f = X.cond(field);
    if (!rec || !f) return null;
    const st = X.cond("status");
    return g(st ? `SUMIFS(${f},${rec},${me},${st},"${DONE}")` : `SUMIF(${rec},${me},${f})`); // only fully signed forms count
  };
  const served = (word) => {
    const [amt, cad, typ] = [X.srv("amount"), X.srv("cadet"), X.srv("type")];
    return amt && cad && typ ? g(`SUMIFS(${amt},${cad},${me},${typ},"*${wordIn(word)}*")`) : null;
  };
  const net = (a, s) => {
    const [ca, cs] = [X.col(a), X.col(s)];
    return ca && cs ? g(`MAX(0,${ca}${r}-${cs}${r})`) : null;
  };
  switch (source) {
    case "class_year": return rec && X.cond("class_year") ? g(`IFERROR(INDEX(${X.cond("class_year")},MATCH(${me},${rec},0)),"")`) : null;
    case "reports": return rec ? g(`COUNTIF(${rec},${me})`) : null;
    case "tours_assigned": return assigned("tours");
    case "conf_assigned": return assigned("confinements");
    case "tours_served": return served(X.tourWord);
    case "conf_served": return served(X.confWord);
    case "tours_left": return net("tours_assigned", "tours_served");
    case "conf_left": return net("conf_assigned", "conf_served");
    case "status": {
      const [t, c] = [X.col("tours_left"), X.col("conf_left")];
      return t && c ? g(`IF(${t}${r}+${c}${r}>0,"Outstanding Balance","Clear")`) : null;
    }
    default: return null;
  }
}

export class Tracker {
  constructor(store) {
    this.store = store;
    this.file = path.join(store.meta, "served.json");
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(this.file, "utf8")); } catch { /* nothing pulled yet */ }
    this.state = { entries: [], raw: [], pulled_at: null, source: "", stamp: "", skipped: {}, header_row: null, error: "", last_push: null, ...saved };
    this.timer = setInterval(() => this.poll(), POLL_MS);
    this.timer.unref?.();
    setTimeout(() => this.poll(), 1500).unref?.();
  }

  close() {
    clearInterval(this.timer);
  }

  get cfg() {
    return this.store.settings.tracker;
  }

  save() {
    writeJson(this.file, this.state);
  }

  reset() {
    this.state = { ...this.state, entries: [], raw: [], pulled_at: null, stamp: "", skipped: {}, error: "" };
    this.save();
  }

  // ------------------------------------------------------------------ pulling what was served
  /** Re-read the serving log when the workbook changed on disk. */
  poll() {
    const c = this.cfg;
    if (!c?.path || !c.auto_pull) return;
    try {
      const st = fs.statSync(c.path);
      const stamp = `${c.path}|${st.size}|${Math.round(st.mtimeMs)}`;
      if (stamp !== this.state.stamp) this.pull();
    } catch (e) {
      const msg = e.code === "ENOENT" ? "The discipline sheet isn't where Settings says it is" : `Couldn't read the discipline sheet: ${e.message}`;
      if (this.state.error !== msg) { this.state.error = msg; this.save(); this.store.bump(); }
    }
  }

  /** Read the serving log. Never throws: the answer says what happened. */
  pull() {
    const c = this.cfg;
    if (!c?.path) return { ok: false, error: "No discipline sheet is set. Choose one in Settings → Discipline sheet." };
    try {
      ensureLocal(c.path); // a OneDrive placeholder has no content here until it is downloaded
      const st = fs.statSync(c.path);
      const result = this.read(c.path, c.served);
      Object.assign(this.state, {
        entries: result.entries, raw: result.raw, pulled_at: now(), source: c.path, stamp: `${c.path}|${st.size}|${Math.round(st.mtimeMs)}`,
        skipped: result.skipped, header_row: result.header_row, error: "",
      });
      this.save();
      this.store.bump();
      return { ok: true, entries: result.entries.length, skipped: result.skipped, header_row: result.header_row };
    } catch (e) {
      const error = e.code === "ENOENT" ? "That file isn't there. Check the path in Settings → Discipline sheet." : String(e.message || e);
      this.state.error = error;
      this.save();
      this.store.bump();
      return { ok: false, error };
    }
  }

  /**
   * The serving log in a workbook: `entries` are the completed discipline ({ date, cadet, type,
   * amount, supervisor, notes, row }); `raw` is every row with anything in it, as written, so a
   * rewrite of the sheet can keep rows closet couldn't use.
   */
  read(file, sv) {
    const sheets = readWorkbook(file);
    const sheet = sheets.find((s) => s.name.toLowerCase() === sv.sheet.toLowerCase());
    if (!sheet) throw new Error(`The workbook has no sheet called “${sv.sheet}” (it has ${sheets.map((s) => `“${s.name}”`).join(", ")}). Change the served log's sheet name in Settings.`);
    const want = Object.fromEntries(SERVED_FIELDS.filter(([k]) => sv.columns[k]).map(([k]) => [k, normHeader(sv.columns[k])]));
    const locate = (r) => {
      const cells = sheet.rows.get(r);
      if (!cells) return null;
      const at = {};
      for (const [k, h] of Object.entries(want)) {
        const i = cells.findIndex((x) => normHeader(x) === h);
        if (i >= 0) at[k] = i;
      }
      return SERVED_REQUIRED.every((k) => k in at) ? at : null;
    };
    let hr = sv.header_row;
    let at = locate(hr);
    if (!at) { // the heading moved: look for it near the top before giving up
      for (let r = 1; r <= 60 && !at; r++) if ((at = locate(r))) hr = r;
    }
    if (!at) {
      throw new Error(`Couldn't find the headings ${SERVED_REQUIRED.map((k) => `“${sv.columns[k]}”`).join(", ")} on the sheet “${sheet.name}”. Check the column headings and header row in Settings → Discipline sheet.`);
    }
    const tour = normHeader(sv.tour_word);
    const conf = normHeader(sv.confinement_word);
    const entries = [];
    const raw = [];
    const skipped = { unnamed: 0, unknown_type: 0, bad_amount: 0 };
    for (const r of [...sheet.rows.keys()].filter((n) => n > hr).sort((a, b) => a - b)) {
      const cells = sheet.rows.get(r);
      const get = (k) => (k in at ? R.collapse(cells[at[k]]) : "");
      const all = Object.fromEntries(SERVED_FIELDS.map(([k]) => [k, get(k)]));
      if (!Object.values(all).some(Boolean)) continue;
      raw.push(all);
      const [name, typeText, amountText] = [all.cadet, all.type, all.amount];
      const t = normHeader(typeText);
      const type = t.includes(tour) ? "tour" : t.includes(conf) ? "confinement" : null;
      const amount = parseFloat(amountText);
      if (!name) { skipped.unnamed++; continue; }
      if (!type) { skipped.unknown_type++; continue; }
      if (!(amount > 0)) { skipped.bad_amount++; continue; }
      const date = /^\d+(\.\d+)?$/.test(all.date) ? serialToIso(all.date) : R.parseDate(all.date);
      entries.push({ row: r, date: date || "", cadet: name, type, amount, supervisor: all.supervisor, notes: all.notes });
    }
    return { entries, raw, skipped, header_row: hr };
  }

  // ------------------------------------------------------------------ balances
  /**
   * One line per cadet: tours and confinements assigned, served, and still owed. Only fully signed,
   * unrejected forms are assigned anything. With `before` (YYYY-MM-DD) only forms dated earlier
   * count, and everything served is applied to them (oldest first), which shows who still owes
   * old sanctions.
   */
  balances(snap = this.store.snapshot(), { before = "" } = {}) {
    const people = new Map();
    const person = (key, name) => {
      if (!people.has(key)) people.set(key, { key, name, class_year: "", on_file: false, forms: 0, tours: { assigned: 0, served: 0 }, confinements: { assigned: 0, served: 0 } });
      return people.get(key);
    };
    for (const f of snap.forms) {
      if (f.missing || f.archived || !f.parsed) continue;
      (f.record.recipient_list || []).forEach((name, i) => {
        const key = R.nameKey(name);
        if (!key) return;
        const p = person(key, name);
        p.on_file = true;
        p.forms++;
        if (!p.class_year && f.rows[i]?.[1]) p.class_year = f.rows[i][1];
        if (f.record.counted && f.record.pos_neg !== "Pos" && (!before || (f.record.date_iso && f.record.date_iso < before))) {
          p.tours.assigned += num(f.record.tours);
          p.confinements.assigned += num(f.record.confinements);
        }
      });
    }
    const known = new Map([...people.values()].map((p) => [p.key, p.name]));
    const distinct = new Set((this.store.names?.distinct || []).map((p) => [...p].map((x) => x.toLowerCase()).sort().join("\u0000")));
    const isDistinct = (a, b) => distinct.has([a, b].map((x) => R.collapse(x).toLowerCase()).sort().join("\u0000"));
    const match = (name) => {
      const key = R.nameKey(R.canon(name));
      if (!key || known.has(key)) return key;
      const m = bestMatch(name, [...known.values()], { distinct: isDistinct });
      return m && !m.ambiguous ? R.nameKey(m.name) : key;
    };
    const unmatched = new Map();
    for (const e of this.state.entries) {
      const key = match(e.cadet);
      if (!key) continue;
      const p = person(key, R.singleName(e.cadet) || e.cadet);
      p[e.type === "tour" ? "tours" : "confinements"].served += e.amount;
      if (!p.on_file) unmatched.set(key, p.name);
    }
    const list = [...people.values()].map((p) => {
      for (const k of ["tours", "confinements"]) {
        p[k].left = Math.max(0, p[k].assigned - p[k].served);
        p[k].over = Math.max(0, p[k].served - p[k].assigned);
      }
      return p;
    }).sort((a, b) => a.name.localeCompare(b.name));
    const sum = (k, f) => list.reduce((a, p) => a + p[k][f], 0);
    return {
      list, unmatched: [...unmatched.values()].sort(), match, byKey: new Map(list.map((p) => [p.key, p])), before,
      totals: { tours: { assigned: sum("tours", "assigned"), served: sum("tours", "served"), left: sum("tours", "left") }, confinements: { assigned: sum("confinements", "assigned"), served: sum("confinements", "served"), left: sum("confinements", "left") } },
    };
  }

  /** What the UI shows. */
  view(snap = this.store.snapshot(), before = "") {
    const c = this.cfg;
    const b = this.balances(snap, { before: /^\d{4}-\d\d-\d\d$/.test(before) ? before : "" });
    return {
      path: c.path, configured: Boolean(c.path), exists: Boolean(c.path) && fs.existsSync(c.path), error: this.state.error,
      pulled_at: this.state.pulled_at, entries: this.state.entries.length, skipped: this.state.skipped, header_row: this.state.header_row,
      balances: b.list, totals: b.totals, unmatched: b.unmatched, before: b.before,
      recent: [...this.state.entries].sort((x, y) => (y.date || "").localeCompare(x.date || "") || y.row - x.row).slice(0, 40),
      push: { enabled: c.push.enabled, last: this.state.last_push },
      defaults: TRACKER_DEFAULTS, sources: PUSH_SOURCES, balance_sources: BAL_SOURCES,
    };
  }

  /** How many cadets still owe tours or confinements (the count on the Balances tab). */
  owing(snap) {
    return this.balances(snap).list.filter((p) => p.tours.left || p.confinements.left).length;
  }

  /** The balance of one cadet by name key, or null when there is nothing to say. */
  balanceFor(key, snap) {
    return this.balances(snap).byKey.get(key) || null;
  }

  // ------------------------------------------------------------------ pushing closet's records
  conductColumns(snap, canon) {
    const cfg = this.cfg.push;
    const forms = snap.forms.filter((f) => !f.missing && !f.archived && f.parsed)
      .sort((a, b) => (a.record.date_iso || "9").localeCompare(b.record.date_iso || "9") || a.filename.localeCompare(b.filename));
    const rows = [];
    for (const f of forms) for (const r of f.rows) rows.push({ row: r, form: f });
    const cell = (source, { row, form }) => {
      let v;
      if (source === "squadron") v = R.collapse(form.record.squadron);
      else if (source === "filename") v = form.filename;
      else if (source === "status") v = form.record.rejected ? "Rejected" : form.record.complete ? DONE : "In progress";
      else if (source === "recipient") v = canon(row[ROW_INDEX.recipient]); // spelled the way the balances sheet will look it up
      else v = row[ROW_INDEX[source]];
      if (v === "" || v === undefined) return null;
      if (source === "date") { const s = isoToSerial(v); return s ? { date: s } : v; }
      if (NUMERIC.has(source) && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
      return v;
    };
    const recipients = rows.map((r) => canon(r.row[ROW_INDEX.recipient]));
    return { rows: rows.length, recipients, columns: cfg.columns.map((c) => ({ header: c.header, values: rows.map((r) => cell(c.source, r)) })) };
  }

  /**
   * Overwrite the workbook: the conduct log from closet's records, the serving log from a fresh
   * read of itself (nothing entered since the last sync is lost; names are respelled to match),
   * and the balances sheet as names plus live formulas. A copy is saved first.
   */
  push() {
    const c = this.cfg;
    const p = c.push;
    const sv = c.served;
    if (!p.enabled) throw new Error("Turn on “Allow writing” in Settings → Discipline sheet first.");
    if (!c.path || !fs.existsSync(c.path)) throw new Error("The discipline sheet isn't where Settings says it is.");
    ensureLocal(c.path);
    const fresh = this.pull(); // what was entered since the last sync is read before anything is rewritten
    if (!fresh.ok) throw new Error(`Couldn't read the serving log first, so nothing was written: ${fresh.error}`);
    const snap = this.store.snapshot();
    const bal = this.balances(snap);
    const canon = (name) => bal.byKey.get(bal.match(name))?.name || R.collapse(name);
    const conduct = this.conductColumns(snap, canon);
    const edits = [{ sheet: p.sheet, headerRow: p.header_row, columns: conduct.columns }];

    const servedCols = SERVED_FIELDS.filter(([k]) => sv.columns[k]).map(([k]) => ({
      header: sv.columns[k],
      values: this.state.raw.map((r) => {
        const v = r[k];
        if (v === "") return null;
        if (k === "cadet") return canon(v);
        if (k === "date") return /^\d+(\.\d+)?$/.test(v) ? { date: Number(v) } : v;
        if (k === "amount") return /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
        return v;
      }),
    }));
    edits.push(p.served.enabled
      ? { sheet: sv.sheet, headerRow: sv.header_row, columns: servedCols }
      : { sheet: sv.sheet, headerRow: sv.header_row, lookup: true, columns: servedCols.map((x) => ({ header: x.header, values: [] })) });

    const b = p.balances;
    const warnings = [];
    if (b.enabled) {
      const reportsBy = new Map();
      for (const n of conduct.recipients) if (n) reportsBy.set(n, (reportsBy.get(n) || 0) + 1);
      const people = bal.list;
      const total = Math.max(people.length, BAL_ROWS);
      const nameCol = b.columns.find((x) => x.source === "name");
      if (!conduct.columns.length || !p.columns.some((x) => x.source === "status")) warnings.push(`The conduct log has no Status column, so tours and confinements on forms that aren't fully signed yet will be counted by the balances sheet.`);
      const cached = (src, person) => {
        const [t, f] = [person.tours, person.confinements];
        return { name: person.name, class_year: person.class_year, reports: reportsBy.get(person.name) || 0, tours_assigned: t.assigned, tours_served: t.served, tours_left: t.left, conf_assigned: f.assigned, conf_served: f.served, conf_left: f.left, status: t.left + f.left > 0 ? "Outstanding Balance" : "Clear" }[src];
      };
      edits.push({
        sheet: b.sheet, headerRow: b.header_row, minRows: total,
        columns: b.columns.map((col) => ({
          header: col.header,
          values: (L) => {
            const X = {
              name: L(b.sheet, nameCol.header),
              col: (src) => { const x = b.columns.find((y) => y.source === src); return x ? L(b.sheet, x.header) : null; },
              cond: (src) => { const x = p.columns.find((y) => y.source === src); const l = x && L(p.sheet, x.header); return l ? `${quote(p.sheet)}!$${l}:$${l}` : null; },
              srv: (f) => { const h = sv.columns[f]; const l = h && L(sv.sheet, h); return l ? `${quote(sv.sheet)}!$${l}:$${l}` : null; },
              tourWord: sv.tour_word, confWord: sv.confinement_word,
            };
            return Array.from({ length: total }, (_, i) => {
              const person = people[i];
              if (col.source === "name") return person ? person.name : null;
              const f = X.name ? balanceFormula(col.source, b.header_row + 1 + i, X) : null;
              if (!f) return null;
              const v = person ? cached(col.source, person) : "";
              return { f, v: v === "" || v === undefined ? "" : v };
            });
          },
        })),
      });
    } else {
      edits.push({ sheet: b.sheet, headerRow: b.header_row, lookup: true, columns: [] });
    }

    const dir = path.join(this.store.meta, "sheet-backups");
    fs.mkdirSync(dir, { recursive: true });
    const ext = path.extname(c.path);
    const backup = path.join(dir, `${path.basename(c.path, ext)}-${now().replace(/[-:]/g, "").replace("T", "-")}${ext}`);
    fs.copyFileSync(c.path, backup);
    const done = patchWorkbook(c.path, edits.filter((e) => !e.lookup || e.columns.length));
    const synced = settle(c.path); // OneDrive picks the change up and uploads it
    for (const old of fs.readdirSync(dir).sort().slice(0, -KEEP_BACKUPS)) fs.rmSync(path.join(dir, old), { force: true });
    this.state.last_push = { at: now(), rows: conduct.rows, backup, synced };
    this.state.stamp = ""; // our own write: read the serving log again next time round
    this.save();
    this.store.bump();
    return { rows: conduct.rows, sheets: done, backup, warnings, synced };
  }

  // ------------------------------------------------------------------ a blank workbook
  /** Write a new workbook laid out the way the current settings expect (the defaults match the CS07 tracker). */
  createTemplate(file) {
    const c = this.cfg;
    const p = c.push;
    const sv = c.served;
    const b = p.balances;

    // Conduct log
    const conduct = { name: p.sheet, freeze: p.header_row, widths: p.columns.map((x) => WIDTH[x.source] || 12), cells: [], rowHeights: { [p.header_row]: 24 } };
    p.columns.forEach((x, i) => {
      conduct.cells.push({ r: p.header_row, c: i, v: x.header, s: "head" });
      const style = x.source === "date" ? "date" : NUMERIC.has(x.source) ? "num" : "text";
      for (let r = p.header_row + 1; r <= p.header_row + BLANK_ROWS; r++) conduct.cells.push({ r, c: i, s: style });
    });
    conduct.filter = `A${p.header_row}:${colLetter(p.columns.length - 1)}${p.header_row + BLANK_ROWS}`;

    // Serving log: B.. in the order of the settings
    const fields = SERVED_FIELDS.filter(([k]) => sv.columns[k]);
    const at = Object.fromEntries(fields.map(([k], i) => [k, i + 1]));
    const hr = sv.header_row;
    const served = { name: sv.sheet, freeze: hr, grid: false, widths: [3, ...fields.map(([k]) => ({ date: 14, cadet: 26, type: 18, amount: 15, supervisor: 24, notes: 36 }[k]))], cells: [], rowHeights: { [hr]: 24 }, validation: [] };
    fields.forEach(([k], i) => {
      served.cells.push({ r: hr, c: i + 1, v: sv.columns[k], s: "head" });
      for (let r = hr + 1; r <= hr + BLANK_ROWS; r++) served.cells.push({ r, c: i + 1, s: k === "date" ? "date" : k === "amount" ? "num" : "text" });
    });
    if ("type" in at) served.validation.push({ sqref: `${colLetter(at.type)}${hr + 1}:${colLetter(at.type)}1000`, list: [sv.tour_word, sv.confinement_word] });
    if (hr >= 8 && "type" in at && "amount" in at) {
      const T = `${colLetter(at.type)}${hr + 1}:${colLetter(at.type)}1000`;
      const A = `${colLetter(at.amount)}${hr + 1}:${colLetter(at.amount)}1000`;
      served.cells.push(
        { r: 2, c: 1, v: "Cadet Disciplinary Serving Log", s: "title" }, { r: 3, c: 1, v: "Record of served tours and confinements", s: "sub" },
        { r: 5, c: 1, v: `TOTAL ${sv.tour_word.toUpperCase()}S SERVED`, s: "kpiLabel" }, { r: 5, c: 3, v: `TOTAL ${sv.confinement_word.toUpperCase()}S SERVED`, s: "kpiLabel" }, { r: 5, c: 5, v: "TOTAL SESSIONS LOGGED", s: "kpiLabel" },
        { r: 6, c: 1, f: `SUMIF(${T},"*${wordIn(sv.tour_word)}*",${A})`, s: "kpi" }, { r: 6, c: 3, f: `SUMIF(${T},"*${wordIn(sv.confinement_word)}*",${A})`, s: "kpi" }, { r: 6, c: 5, f: `COUNT(${A})`, s: "kpi" },
        { r: hr - 1, c: 1, v: "Serving Records", s: "sub" },
      );
    }

    // Balances: names are typed (or written by closet); the sheet's own formulas do the sums
    const bh = b.header_row;
    const idx = (src) => b.columns.findIndex((x) => x.source === src);
    const letterOf = (src) => (idx(src) < 0 ? null : colLetter(1 + idx(src)));
    const whole = (sheetName, l) => (l ? `${quote(sheetName)}!$${l}:$${l}` : null);
    const X = {
      name: letterOf("name"), col: letterOf,
      cond: (src) => { const i = p.columns.findIndex((x) => x.source === src); return i < 0 ? null : whole(p.sheet, colLetter(i)); },
      srv: (f) => (f in at ? whole(sv.sheet, colLetter(at[f])) : null),
      tourWord: sv.tour_word, confWord: sv.confinement_word,
    };
    const balances = { name: b.sheet, freeze: bh, grid: false, widths: [3, 28, ...b.columns.slice(1).map(() => 16)], cells: [], rowHeights: { [bh]: 30 } };
    b.columns.forEach((col, i) => balances.cells.push({ r: bh, c: 1 + i, v: col.header, s: "head" }));
    const last = bh + BAL_ROWS;
    for (let r = bh + 1; r <= last; r++) {
      b.columns.forEach((col, i) => {
        if (col.source === "name") return void balances.cells.push({ r, c: 1 + i, s: "text" });
        const f = balanceFormula(col.source, r, X);
        balances.cells.push(f ? { r, c: 1 + i, f, s: ["status", "class_year"].includes(col.source) ? "text" : "num" } : { r, c: 1 + i, s: "text" });
      });
    }
    if (bh >= 8 && X.name) {
      const rec = X.cond("recipient");
      balances.cells.push(
        { r: 2, c: 1, v: "Cadet Conduct & Balance Tracker", s: "title" }, { r: 3, c: 1, v: "Corps disciplinary summaries, tour and confinement balances. Type cadet names under the heading; everything else fills in.", s: "sub" },
        { r: 5, c: 1, v: "TOTAL CADETS", s: "kpiLabel" }, { r: 5, c: 3, v: "TOTAL REPORTS", s: "kpiLabel" }, { r: 5, c: 5, v: "REMAINING TOURS", s: "kpiLabel" }, { r: 5, c: 7, v: "REMAINING CONFINEMENTS", s: "kpiLabel" },
        { r: 6, c: 1, f: `COUNTA(${X.name}${bh + 1}:${X.name}${last})`, s: "kpi" }, { r: 6, c: 3, f: rec ? `COUNTA(${rec})-1` : "0", s: "kpi" },
        { r: 6, c: 5, f: X.col("tours_left") ? `SUM(${X.col("tours_left")}${bh + 1}:${X.col("tours_left")}${last})` : "0", s: "kpi" },
        { r: 6, c: 7, f: X.col("conf_left") ? `SUM(${X.col("conf_left")}${bh + 1}:${X.col("conf_left")}${last})` : "0", s: "kpi" },
        { r: bh - 1, c: 1, v: "Cadet Balance Summary", s: "sub" },
      );
    }
    writeWorkbook(file, [conduct, served, balances]);
    return { file, sheets: [conduct.name, served.name, balances.name] };
  }
}
