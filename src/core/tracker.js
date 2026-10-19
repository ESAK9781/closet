// Served tours and confinements, and the balance everyone owes.
//
// closet knows what was *assigned* (the Tours and Confinements on each Form 10). What was *served*
// is written down by hand in a spreadsheet, so closet reads that: only the serving log, never the
// conduct log. Balance = assigned - served, per cadet, floored at zero like the sheet's own formula.
// closet can also write its own records back into the sheet (overwriting what was there, after
// saving a copy), and make a blank workbook laid out the way the defaults expect. Where things sit
// in the sheet is all settings (`tracker` in settings.json); the defaults match the CS07 tracker.

import fs from "node:fs";
import path from "node:path";

import { bestMatch } from "./people.js";
import * as R from "./records.js";
import { writeJson } from "./store.js";
import { colLetter, isoToSerial, normHeader, patchWorkbook, readWorkbook, serialToIso, writeWorkbook } from "./xlsx.js";

const POLL_MS = 20000;
const KEEP_BACKUPS = 10;
const BLANK_ROWS = 300; // pre-formatted rows in a new workbook

// What a pushed column can show. Indexes are into R.sheetRows(); the last two come from the form itself.
export const PUSH_SOURCES = [
  ["date", "Date"], ["class_year", "Class year"], ["form_type", "Form type"], ["reason_category", "Reason category"],
  ["reason_details", "Reason details"], ["month", "Month"], ["recipient", "Recipient"], ["issuer", "Issuer"], ["pos_neg", "Pos/Neg"],
  ["cdna", "CDNA"], ["passes", "Passes"], ["demerits", "Demerits"], ["tours", "Tours"], ["confinements", "Confinements"], ["other", "Other"],
  ["squadron", "Squadron"], ["filename", "File name"],
];
const ROW_INDEX = Object.fromEntries(["date", "class_year", "form_type", "reason_category", "reason_details", "month", "recipient", "issuer", "pos_neg", "cdna", "passes", "demerits", "tours", "confinements", "other"].map((k, i) => [k, i]));
const NUMERIC = new Set(["class_year", "cdna", "passes", "demerits", "tours", "confinements"]);
const WIDTH = { date: 12, class_year: 11, form_type: 11, reason_category: 24, reason_details: 40, month: 12, recipient: 24, issuer: 22, pos_neg: 9, other: 20, filename: 36 };

export const SERVED_FIELDS = [["date", "Date served"], ["cadet", "Cadet name"], ["type", "Sanction type"], ["amount", "Amount served"], ["supervisor", "Supervisor"], ["notes", "Notes"]];
export const SERVED_REQUIRED = ["cadet", "type", "amount"];

export const TRACKER_DEFAULTS = {
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
    columns: [
      ["Date", "date"], ["Class Year", "class_year"], ["Form Type", "form_type"], ["Reason Category", "reason_category"], ["Description", "reason_details"],
      ["Month", "month"], ["Recipient", "recipient"], ["Issuer", "issuer"], ["Pos/Neg", "pos_neg"], ["CDNA", "cdna"], ["Passes", "passes"],
      ["Demerits", "demerits"], ["Tours", "tours"], ["Confinements", "confinements"], ["Other", "other"],
    ].map(([header, source]) => ({ header, source })),
    balances: { enabled: false, sheet: "Cadet Balances", header_row: 9, header: "Cadet Name" }, // closet fills the names; the sheet's own formulas do the sums
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
  s.tour_word = str(s.tour_word, "The word for tours", 30);
  s.confinement_word = str(s.confinement_word, "The word for confinements", 30);
  if (normHeader(s.tour_word) === normHeader(s.confinement_word)) throw new Error("Tours and confinements need different words");
  const p = t.push;
  p.enabled = p.enabled === true;
  p.sheet = sheet(p.sheet, "The conduct log's sheet name");
  p.header_row = row(p.header_row, "The conduct log's header row");
  if (!Array.isArray(p.columns) || !p.columns.length || p.columns.length > 40) throw new Error("Pick between 1 and 40 columns to write");
  const seen = new Set();
  p.columns = p.columns.map((c) => {
    const header = str(c?.header, "A column heading", 60);
    if (!PUSH_SOURCES.some(([k]) => k === c?.source)) throw new Error(`“${header}” has no valid source`);
    if (seen.has(normHeader(header))) throw new Error(`“${header}” is listed twice`);
    seen.add(normHeader(header));
    return { header, source: c.source };
  });
  const b = p.balances;
  b.enabled = b.enabled === true;
  b.sheet = sheet(b.sheet, "The balances sheet name");
  b.header_row = row(b.header_row, "The balances header row");
  b.header = str(b.header, "The balances name column heading", 60);
  return t;
}

const now = () => new Date().toISOString().slice(0, 19);
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const quote = (name) => `'${name.replace(/'/g, "''")}'`;

export class Tracker {
  constructor(store) {
    this.store = store;
    this.file = path.join(store.meta, "served.json");
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(this.file, "utf8")); } catch { /* nothing pulled yet */ }
    this.state = { entries: [], pulled_at: null, source: "", stamp: "", skipped: {}, header_row: null, error: "", last_push: null, ...saved };
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
    this.state = { ...this.state, entries: [], pulled_at: null, stamp: "", skipped: {}, error: "" };
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
      const st = fs.statSync(c.path);
      const result = this.read(c.path, c.served);
      Object.assign(this.state, {
        entries: result.entries, pulled_at: now(), source: c.path, stamp: `${c.path}|${st.size}|${Math.round(st.mtimeMs)}`,
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

  /** The completed discipline in a workbook: [{ date, cadet, type, amount, supervisor, notes, row }]. */
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
    const skipped = { unnamed: 0, unknown_type: 0, bad_amount: 0 };
    for (const r of [...sheet.rows.keys()].filter((n) => n > hr).sort((a, b) => a - b)) {
      const cells = sheet.rows.get(r);
      const get = (k) => (k in at ? R.collapse(cells[at[k]]) : "");
      const [name, typeText, amountText] = [get("cadet"), get("type"), get("amount")];
      if (!name && !typeText && !amountText) continue;
      const t = normHeader(typeText);
      const type = t.includes(tour) ? "tour" : t.includes(conf) ? "confinement" : null;
      const amount = parseFloat(amountText);
      if (!name) { skipped.unnamed++; continue; }
      if (!type) { skipped.unknown_type++; continue; }
      if (!(amount > 0)) { skipped.bad_amount++; continue; }
      const raw = get("date");
      const date = /^\d+(\.\d+)?$/.test(raw) ? serialToIso(raw) : R.parseDate(raw);
      entries.push({ row: r, date: date || "", cadet: name, type, amount, supervisor: get("supervisor"), notes: get("notes") });
    }
    return { entries, skipped, header_row: hr };
  }

  // ------------------------------------------------------------------ balances
  /** One line per cadet: tours and confinements assigned, served, and still owed. */
  balances(snap = this.store.snapshot()) {
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
        if (f.record.pos_neg !== "Pos") {
          p.tours.assigned += num(f.record.tours);
          p.confinements.assigned += num(f.record.confinements);
        }
      });
    }
    const known = new Map([...people.values()].map((p) => [p.key, p.name]));
    const distinct = new Set((this.store.names?.distinct || []).map((p) => [...p].map((x) => x.toLowerCase()).sort().join("\u0000")));
    const isDistinct = (a, b) => distinct.has([a, b].map((x) => R.collapse(x).toLowerCase()).sort().join("\u0000"));
    const unmatched = new Map();
    for (const e of this.state.entries) {
      let key = R.nameKey(R.canon(e.cadet));
      if (!key) continue;
      if (!known.has(key)) {
        const m = bestMatch(e.cadet, [...known.values()], { distinct: isDistinct });
        if (m && !m.ambiguous) key = R.nameKey(m.name);
      }
      const p = person(key, people.get(key)?.name || R.singleName(e.cadet) || e.cadet);
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
      list, unmatched: [...unmatched.values()].sort(),
      totals: { tours: { assigned: sum("tours", "assigned"), served: sum("tours", "served"), left: sum("tours", "left") }, confinements: { assigned: sum("confinements", "assigned"), served: sum("confinements", "served"), left: sum("confinements", "left") } },
    };
  }

  /** What the UI shows. */
  view(snap = this.store.snapshot()) {
    const c = this.cfg;
    const b = this.balances(snap);
    return {
      path: c.path, configured: Boolean(c.path), exists: Boolean(c.path) && fs.existsSync(c.path), error: this.state.error,
      pulled_at: this.state.pulled_at, entries: this.state.entries.length, skipped: this.state.skipped, header_row: this.state.header_row,
      balances: b.list, totals: b.totals, unmatched: b.unmatched,
      recent: [...this.state.entries].sort((x, y) => (y.date || "").localeCompare(x.date || "") || y.row - x.row).slice(0, 40),
      push: { enabled: c.push.enabled, last: this.state.last_push },
      defaults: TRACKER_DEFAULTS, sources: PUSH_SOURCES,
    };
  }

  /** How many cadets still owe tours or confinements (the count on the Balances tab). */
  owing(snap) {
    return this.balances(snap).list.filter((p) => p.tours.left || p.confinements.left).length;
  }

  /** The balance of one cadet by name key, or null when there is nothing to say. */
  balanceFor(key, snap) {
    return this.balances(snap).list.find((p) => p.key === key) || null;
  }

  // ------------------------------------------------------------------ pushing closet's records
  conductColumns(snap) {
    const cfg = this.cfg.push;
    const forms = snap.forms.filter((f) => !f.missing && !f.archived && f.parsed)
      .sort((a, b) => (a.record.date_iso || "9").localeCompare(b.record.date_iso || "9") || a.filename.localeCompare(b.filename));
    const rows = [];
    for (const f of forms) for (const r of f.rows) rows.push({ row: r, form: f });
    const cell = (source, { row, form }) => {
      const v = source === "squadron" ? R.collapse(form.record.squadron) : source === "filename" ? form.filename : row[ROW_INDEX[source]];
      if (v === "" || v === undefined) return null;
      if (source === "date") { const s = isoToSerial(v); return s ? { date: s } : v; }
      if (NUMERIC.has(source) && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
      return v;
    };
    return { rows: rows.length, columns: cfg.columns.map((c) => ({ header: c.header, values: rows.map((r) => cell(c.source, r)) })) };
  }

  /** Overwrite the sheet's records with closet's. A copy of the workbook is saved first. */
  push() {
    const c = this.cfg;
    if (!c.push.enabled) throw new Error("Turn on “Write closet's records into the sheet” in Settings → Discipline sheet first.");
    if (!c.path || !fs.existsSync(c.path)) throw new Error("The discipline sheet isn't where Settings says it is.");
    const snap = this.store.snapshot();
    const conduct = this.conductColumns(snap);
    const edits = [{ sheet: c.push.sheet, headerRow: c.push.header_row, columns: conduct.columns }];
    const b = c.push.balances;
    if (b.enabled) {
      const names = this.balances(snap).list.filter((p) => p.on_file).map((p) => p.name);
      edits.push({ sheet: b.sheet, headerRow: b.header_row, columns: [{ header: b.header, values: names }] });
    }
    const dir = path.join(this.store.meta, "sheet-backups");
    fs.mkdirSync(dir, { recursive: true });
    const ext = path.extname(c.path);
    const backup = path.join(dir, `${path.basename(c.path, ext)}-${now().replace(/[-:]/g, "").replace("T", "-")}${ext}`);
    fs.copyFileSync(c.path, backup);
    const done = patchWorkbook(c.path, edits);
    for (const old of fs.readdirSync(dir).sort().slice(0, -KEEP_BACKUPS)) fs.rmSync(path.join(dir, old), { force: true });
    this.state.last_push = { at: now(), rows: conduct.rows, backup };
    this.state.stamp = ""; // our own write: read the serving log again next time round
    this.save();
    this.store.bump();
    return { rows: conduct.rows, sheets: done, backup };
  }

  // ------------------------------------------------------------------ a blank workbook
  /** Write a new workbook laid out the way the current settings expect (the defaults match the CS07 tracker). */
  createTemplate(file) {
    const c = this.cfg;
    const p = c.push;
    const sv = c.served;
    const colOf = (source) => p.columns.findIndex((x) => x.source === source);
    const rng = (source, hr) => { const i = colOf(source); return i < 0 ? null : `${quote(p.sheet)}!$${colLetter(i)}$${hr + 1}:$${colLetter(i)}$1000`; };

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
        { r: 6, c: 1, f: `SUMIF(${T},"${sv.tour_word}",${A})`, s: "kpi" }, { r: 6, c: 3, f: `SUMIF(${T},"${sv.confinement_word}",${A})`, s: "kpi" }, { r: 6, c: 5, f: `COUNT(${A})`, s: "kpi" },
        { r: hr - 1, c: 1, v: "Serving Records", s: "sub" },
      );
    }

    // Balances: the names are typed (or written by closet); the sheet's formulas do the sums
    const bl = p.balances;
    const bh = bl.header_row;
    const heads = [bl.header, "Class Year", "Reports Count", "Tours Assigned", "Tours Served", "Net Tours", "Confinements Assigned", "Confinements Served", "Net Confinements", "Status"];
    const balances = { name: bl.sheet, freeze: bh, grid: false, widths: [3, 28, 12, 14, 16, 14, 12, 20, 20, 16, 20], cells: [], rowHeights: { [bh]: 30 } };
    heads.forEach((h, i) => balances.cells.push({ r: bh, c: i + 1, v: h, s: "head" }));
    const nameRng = rng("recipient", p.header_row);
    const served$ = (key) => `${quote(sv.sheet)}!$${colLetter(at[key])}$${hr + 1}:$${colLetter(at[key])}$1000`;
    const sum = (typeWord) => (["amount", "cadet", "type"].every((k) => k in at) ? `SUMIFS(${served$("amount")},${served$("cadet")},$B{r},${served$("type")},"${typeWord}")` : "0");
    const last = bh + 91;
    for (let r = bh + 1; r <= last; r++) {
      const f = (s) => s.replaceAll("{r}", String(r));
      const guard = (body) => `IF($B${r}="","",${body})`;
      const tours = rng("tours", p.header_row);
      const confs = rng("confinements", p.header_row);
      balances.cells.push(
        { r, c: 1, s: "text" },
        { r, c: 2, s: "text", f: nameRng && rng("class_year", p.header_row) ? guard(`IFERROR(INDEX(${rng("class_year", p.header_row)},MATCH($B${r},${nameRng},0)),"")`) : "\"\"" },
        { r, c: 3, s: "num", f: nameRng ? guard(`COUNTIF(${nameRng},$B${r})`) : "\"\"" },
        { r, c: 4, s: "num", f: nameRng && tours ? guard(`SUMIF(${nameRng},$B${r},${tours})`) : "\"\"" },
        { r, c: 5, s: "num", f: guard(f(sum(sv.tour_word))) },
        { r, c: 6, s: "num", f: guard(`MAX(0,E${r}-F${r})`) },
        { r, c: 7, s: "num", f: nameRng && confs ? guard(`SUMIF(${nameRng},$B${r},${confs})`) : "\"\"" },
        { r, c: 8, s: "num", f: guard(f(sum(sv.confinement_word))) },
        { r, c: 9, s: "num", f: guard(`MAX(0,H${r}-I${r})`) },
        { r, c: 10, s: "text", f: guard(`IF(G${r}+J${r}>0,"Outstanding Balance","Clear")`) },
      );
    }
    if (bh >= 8) {
      balances.cells.push(
        { r: 2, c: 1, v: "Cadet Conduct & Balance Tracker", s: "title" }, { r: 3, c: 1, v: "Corps disciplinary summaries, tour and confinement balances", s: "sub" },
        { r: 5, c: 1, v: "TOTAL CADETS", s: "kpiLabel" }, { r: 5, c: 3, v: "TOTAL REPORTS", s: "kpiLabel" }, { r: 5, c: 5, v: "REMAINING TOURS", s: "kpiLabel" }, { r: 5, c: 7, v: "REMAINING CONFINEMENTS", s: "kpiLabel" },
        { r: 6, c: 1, f: `COUNTA(B${bh + 1}:B${last})`, s: "kpi" }, { r: 6, c: 3, f: nameRng ? `COUNTA(${nameRng})` : "0", s: "kpi" },
        { r: 6, c: 5, f: `SUM(G${bh + 1}:G${last})`, s: "kpi" }, { r: 6, c: 7, f: `SUM(J${bh + 1}:J${last})`, s: "kpi" },
        { r: bh - 1, c: 1, v: "Cadet Balance Summary", s: "sub" },
      );
    }
    writeWorkbook(file, [conduct, served, balances]);
    return { file, sheets: [conduct.name, served.name, balances.name] };
  }
}
