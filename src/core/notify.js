// Email notifications: the contact registry, the per-cadet summary email, and automatic updates.
//
// Nothing here talks to Gmail itself. The main process hands the Store a `mailer`
// ({ status(), send(message) }) that holds the credentials, so a backup of the metadata folder never
// contains a password and this file can be tested with a fake. Every path that could send checks
// `ready()` first; with no mailer, no contacts, or auto-updates off, the answer is a plain
// explanation, never an exception.
//
// State lives in metadata/notify.json: contacts, declined links, automatic-update settings, the
// last-seen routing state of every form (so a step is announced once, when it passes), and a log.

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { extractContacts, isEmail, readSpreadsheet } from "./contacts.js";
import { bestMatch, displayName, nameDistance } from "./people.js";
import * as R from "./records.js";
import { writeJson } from "./store.js";
import { FLAG_DEFS } from "./templates.js";

const MAX_BATCH = 150; // one manual send; Gmail allows roughly 500 messages a day
const AUTO_MAX = 20; // more people than this in one automatic round is held for a human to look at
const LOG_KEEP = 200;
const AUTO_DELAY_MS = 8000; // let a burst of changes (a bulk step, a sync) settle into one email each
const STEP_LABEL = Object.fromEntries(FLAG_DEFS.map(([k, label]) => [k, label]));
const STEP_SHORT = { issuer_signed: "Issuer signature", sqccf_processed: "SQ/CCF processing", cadet_cc_initialed: "Cadet Commander initials", recipient_signed: "Recipient signature", aoc_signed: "AOC/AMT signature" };

const id = () => randomBytes(6).toString("hex");
const stamp = () => new Date().toISOString().slice(0, 19);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const firstName = (name) => R.collapse(name).split(" ")[0] || "";
const formName = (ft) => (ft === "F174" ? "AF 174" : ft === "F10" ? "Form 10" : "Form");
const fmtDate = (iso, raw) => {
  if (!iso) return raw || "No date";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${String(y).slice(2)}`;
};
const num = (v) => { const n = parseFloat(v); return Number.isNaN(n) ? 0 : n; };

// What a cadet's email can include (Settings → Push notifications). Every one is a plain on/off.
export const CONTENT_DEFAULT = {
  forms: true, date: true, form: true, reason: true, details: true, status: true, steps: true, outcomes: true, // the paperwork table and its columns
  only_open: false, positives: true, // which forms are listed
  balances: true, balance_detail: true, // tours and confinements still to serve (and the served / assigned counts behind them)
  totals: true, footer: true,
};

const DEFAULT_STATE = () => ({
  contacts: [],
  declined: [], // "<contact id>|<cadet key>": offered as the same person and answered "no"
  auto: { enabled: false, stages: ["recipient_signed", "aoc_signed"] },
  signature: { enabled: false, text: "" }, // closing lines added to every email when on
  content: { ...CONTENT_DEFAULT }, // what the summary email includes
  seen: { parser: null, forms: {} },
  log: [],
});

export class Notifier {
  /**
   * @param {import("./store.js").Store} store
   * @param {{mailer?: object, parserVersion?: number}} o
   */
  constructor(store, { mailer = null, parserVersion = 0 } = {}) {
    this.store = store;
    this.mailer = mailer;
    this.parserVersion = parserVersion;
    this.file = path.join(store.meta, "notify.json");
    this.state = this.load();
    this.chain = Promise.resolve(); // every send waits its turn: no two at once, no flood
    this.timer = null;
    this.onChanged = () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.check().catch(() => {}), AUTO_DELAY_MS);
    };
    store.on("changed", this.onChanged);
  }

  close() {
    clearTimeout(this.timer);
    this.store.off("changed", this.onChanged);
  }

  load() {
    let data = {};
    try { data = JSON.parse(fs.readFileSync(this.file, "utf8")); } catch { /* first run, or unreadable: start empty */ }
    const s = DEFAULT_STATE();
    if (Array.isArray(data.contacts)) {
      s.contacts = data.contacts.filter((c) => c && isEmail(c.email)).map((c) => ({
        id: String(c.id || id()), name: R.collapse(c.name), email: String(c.email).trim().toLowerCase(), cadet: R.collapse(c.cadet),
        auto: c.auto === true, source: c.source === "manual" ? "manual" : "upload", match: c.match || "", guessed: Boolean(c.guessed),
        sheet_name: c.sheet_name || "", added_at: c.added_at || stamp(),
      }));
    }
    if (Array.isArray(data.declined)) s.declined = data.declined.filter((x) => typeof x === "string");
    if (data.auto && typeof data.auto === "object") {
      s.auto.enabled = data.auto.enabled === true;
      if (Array.isArray(data.auto.stages)) s.auto.stages = data.auto.stages.filter((k) => R.FLAG_KEYS.includes(k));
    }
    if (data.signature && typeof data.signature === "object") s.signature = { enabled: data.signature.enabled === true, text: String(data.signature.text || "").slice(0, 1000) };
    if (data.content && typeof data.content === "object") for (const k of Object.keys(CONTENT_DEFAULT)) if (typeof data.content[k] === "boolean") s.content[k] = data.content[k];
    if (data.seen?.forms && typeof data.seen.forms === "object") s.seen = { parser: data.seen.parser ?? null, forms: data.seen.forms };
    if (Array.isArray(data.log)) s.log = data.log.slice(-LOG_KEEP);
    return s;
  }

  save() {
    writeJson(this.file, this.state);
  }

  // ------------------------------------------------------------------ readiness
  /** Can mail go out right now? A reason in plain words when it can't. */
  ready() {
    const st = this.mailer?.status?.();
    if (!st) return { ok: false, reason: "Email isn't available in this copy of closet." };
    if (!st.configured) return { ok: false, reason: st.reason || "No Gmail account is connected yet. Set one up in Settings → Push notifications." };
    return { ok: true, user: st.user };
  }

  // ------------------------------------------------------------------ cadets on file
  /** Everyone with active paperwork on file, by name key: who they are and which forms are theirs. */
  people(snap) {
    const map = new Map();
    for (const f of snap.forms) {
      if (f.missing || f.archived || !f.parsed) continue;
      (f.record.recipient_list || []).forEach((name, i) => {
        const key = R.nameKey(name);
        if (!key) return;
        const p = map.get(key) || { key, name, class_year: "", forms: [] };
        p.forms.push(f);
        if (!p.class_year && f.rows[i]?.[1]) p.class_year = f.rows[i][1];
        map.set(key, p);
      });
    }
    return map;
  }

  /** Names known from every form that isn't missing (archived people are still people we know). */
  knownNames(snap) {
    const names = new Map();
    for (const f of snap.forms) {
      if (f.missing || !f.parsed) continue;
      for (const n of f.record.recipient_list || []) if (R.nameKey(n)) names.set(R.nameKey(n), n);
    }
    return [...names.values()];
  }

  distinct() {
    const set = new Set((this.store.names?.distinct || []).map((p) => [...p].map((x) => x.toLowerCase()).sort().join("\u0000")));
    return (a, b) => set.has([a, b].map((x) => R.collapse(x).toLowerCase()).sort().join("\u0000"));
  }

  tieKey(c) {
    return c.cadet ? R.nameKey(R.canon(c.cadet)) : "";
  }

  contactsFor(key) {
    return key ? this.state.contacts.filter((c) => this.tieKey(c) === key) : [];
  }

  // ------------------------------------------------------------------ registry
  /** Where a name goes in the registry: the nearest recipient on file, if there is a clear one. */
  place(rawName, snap) {
    const known = snap ? this.knownNames(snap) : [];
    const m = rawName ? bestMatch(rawName, known, { distinct: this.distinct() }) : null;
    if (m && !m.ambiguous) return { name: m.name, cadet: m.name, match: m.dist === 0 ? "same" : "close" };
    return { name: rawName ? displayName(rawName) : "", cadet: "", match: "" };
  }

  addContact({ name, email, cadet = "", source = "manual", guessed = false }, snap) {
    email = String(email || "").trim().toLowerCase();
    if (!isEmail(email)) throw new Error(`"${email || "(blank)"}" isn't an email address`);
    if (this.state.contacts.some((c) => c.email === email)) throw new Error(`${email} is already in the registry`);
    const typed = R.collapse(name);
    const placed = cadet ? { name: typed ? displayName(typed) : R.collapse(cadet), cadet: R.collapse(cadet), match: "same" } : this.place(typed, snap);
    const c = {
      id: id(), name: placed.name, email, cadet: placed.cadet, auto: false, source, match: placed.match, guessed,
      sheet_name: typed && typed !== placed.name ? typed : "", added_at: stamp(),
    };
    this.state.contacts.push(c);
    this.save();
    this.store.bump();
    return c;
  }

  updateContact(cid, patch, snap = null) {
    const c = this.state.contacts.find((x) => x.id === cid);
    if (!c) throw new Error("That contact no longer exists");
    if ("email" in patch) {
      const email = String(patch.email || "").trim().toLowerCase();
      if (!isEmail(email)) throw new Error(`"${email || "(blank)"}" isn't an email address`);
      if (this.state.contacts.some((x) => x.id !== cid && x.email === email)) throw new Error(`${email} is already in the registry`);
      c.email = email;
    }
    if ("name" in patch) {
      c.name = R.collapse(patch.name);
      if (!c.cadet && !("cadet" in patch) && snap) {
        const placed = this.place(c.name, snap); // a corrected name can now match someone on file
        if (placed.cadet) Object.assign(c, { name: placed.name, cadet: placed.cadet, match: placed.match });
      }
    }
    if ("cadet" in patch) {
      c.cadet = R.collapse(patch.cadet);
      c.match = c.cadet ? "same" : "";
      this.state.declined = this.state.declined.filter((x) => !x.startsWith(`${cid}|`));
    }
    if ("auto" in patch) c.auto = patch.auto === true;
    c.guessed = false; // a person looked at it
    this.save();
    this.store.bump();
    return c;
  }

  removeContacts(ids) {
    const gone = new Set(ids);
    const before = this.state.contacts.length;
    this.state.contacts = this.state.contacts.filter((c) => !gone.has(c.id));
    this.state.declined = this.state.declined.filter((x) => !gone.has(x.split("|")[0]));
    this.save();
    this.store.bump();
    return before - this.state.contacts.length;
  }

  /** Opt a group of contacts in or out of automatic updates. */
  setAutoFor(ids, on) {
    const want = new Set(ids);
    let n = 0;
    for (const c of this.state.contacts) if (want.has(c.id) && c.auto !== (on === true)) { c.auto = on === true; n++; }
    this.save();
    this.store.bump();
    return n;
  }

  /** The user's answer to "is this email that cadet?" */
  answerTie(cid, cadet, yes) {
    const c = this.state.contacts.find((x) => x.id === cid);
    if (!c) throw new Error("That contact no longer exists");
    const key = R.nameKey(cadet);
    if (yes) {
      c.cadet = R.collapse(cadet);
      c.match = "same";
    } else if (!this.state.declined.includes(`${cid}|${key}`)) this.state.declined.push(`${cid}|${key}`);
    this.save();
    this.store.bump();
  }

  /** Read a spreadsheet and add every email in it. Existing addresses are left exactly as the user has them. */
  importFile(file, snap) {
    const sheets = readSpreadsheet(file);
    const known = this.knownNames(snap);
    const { pairs, rows_with_email } = extractContacts(sheets, { known, similarity: nameDistance });
    const report = { file: path.basename(file), found: pairs.length, rows_with_email, added: 0, existing: 0, tied: 0, close: 0, untied: 0, guessed: 0, nameless: 0 };
    for (const p of pairs) {
      if (this.state.contacts.some((c) => c.email === p.email)) { report.existing++; continue; }
      const placed = this.place(p.name, snap);
      this.state.contacts.push({
        id: id(), name: placed.name, email: p.email, cadet: placed.cadet, auto: false, source: "upload", match: placed.match,
        guessed: p.guessed, sheet_name: p.name && p.name !== placed.name ? p.name : "", added_at: stamp(),
      });
      report.added++;
      if (placed.match === "same") report.tied++;
      else if (placed.match === "close") { report.tied++; report.close++; } else report.untied++;
      if (p.guessed) report.guessed++;
      if (!placed.name) report.nameless++;
    }
    if (report.added) { this.save(); this.store.bump(); }
    this.log({ kind: "import", ok: true, to: [], subject: `Imported ${report.added} contact${report.added === 1 ? "" : "s"} from ${report.file}` });
    return report;
  }

  /** Cadets with paperwork but no email, for which the registry has a likely match nobody has ruled on. */
  suggestions(snap) {
    if (!this.state.contacts.length) return [];
    const free = this.state.contacts.filter((c) => !c.cadet);
    if (!free.length) return [];
    const out = [];
    const distinct = this.distinct();
    for (const p of this.people(snap).values()) {
      if (this.contactsFor(p.key).length) continue;
      const candidates = free
        .filter((c) => c.name && !this.state.declined.includes(`${c.id}|${p.key}`) && !distinct(c.name, p.name) && nameDistance(c.name, p.name) <= 2)
        .map((c) => ({ id: c.id, name: c.name, email: c.email, dist: nameDistance(c.name, p.name) }))
        .sort((a, b) => a.dist - b.dist);
      if (candidates.length) out.push({ cadet: p.name, key: p.key, class_year: p.class_year, candidates });
    }
    return out;
  }

  // ------------------------------------------------------------------ views
  /** The little that every screen needs (it rides along with the app state). */
  summary(snap) {
    const rd = this.ready();
    return {
      ready: rd.ok, reason: rd.ok ? "" : rd.reason, contacts: this.state.contacts.length,
      auto: { ...this.state.auto }, ties: this.suggestions(snap),
    };
  }

  /** Everything the Notifications tab and the settings tab show. */
  view(snap) {
    const people = this.people(snap);
    const st = this.mailer?.status?.() || { configured: false, reason: "Email isn't available in this copy of closet." };
    const contacts = this.state.contacts.map((c) => {
      const p = people.get(this.tieKey(c));
      return { ...c, class_year: p?.class_year || "", forms: p?.forms.length || 0, on_file: Boolean(p), tied_key: this.tieKey(c) };
    });
    const list = [...people.values()].map((p) => {
      const cs = this.contactsFor(p.key);
      const open = p.forms.filter((f) => FLAG_DEFS.some(([k]) => f.record[k] === false)).length;
      return { key: p.key, name: p.name, class_year: p.class_year, forms: p.forms.length, open, emails: cs.map((c) => c.email), auto: cs.filter((c) => c.auto).length };
    }).sort((a, b) => a.name.localeCompare(b.name));
    return {
      mail: { ...st }, ready: this.ready().ok, contacts, people: list, cadets: this.knownNames(snap).sort(),
      auto: { ...this.state.auto }, signature: { ...this.state.signature }, content: { ...this.state.content }, log: this.state.log.slice(-40).reverse(),
      steps: FLAG_DEFS.map(([k, label]) => ({ key: k, label })), max_batch: MAX_BATCH, auto_max: AUTO_MAX,
    };
  }

  log(entry) {
    this.state.log.push({ at: stamp(), ...entry });
    this.state.log = this.state.log.slice(-LOG_KEEP);
    this.save();
  }

  // ------------------------------------------------------------------ the summary email
  /** Where one form stands: which steps are done, and the next one it's waiting on. */
  progress(rec) {
    const steps = FLAG_DEFS.filter(([k]) => rec[k] !== null && rec[k] !== undefined).map(([k, , short]) => ({ key: k, label: STEP_SHORT[k] || short, done: rec[k] === true }));
    const next = steps.find((s) => !s.done);
    return { steps, done: steps.filter((s) => s.done).length, next: next ? next.label : "" };
  }

  /** What a form means for the cadet: sanctions on a negative, recognition on a positive. */
  outcomes(rec) {
    const parts = [];
    const add = (label, v) => { const t = R.collapse(v); if (t && t !== "0") parts.push(`${label}: ${t}`); };
    if (rec.rejected) return ["Rejected: nothing from this form counts"];
    if (rec.pos_neg === "Pos") {
      add("CDNA", rec.cdna);
      add("Passes", rec.passes);
    } else {
      add("Demerits", rec.demerits);
      add("Tours", rec.tours);
      add("Confinements", rec.confinements);
      if (R.collapse(rec.other)) parts.push(R.collapse(rec.other));
    }
    // tours, confinements, passes and CDNA only count once everyone has signed
    return rec.counted || !parts.length ? parts : [`Pending until fully signed: ${parts.join("; ")}`];
  }

  /** key -> tours/confinements balance, worked out once per batch of emails. */
  balanceMap(snap) {
    try {
      return new Map(this.store.tracker.balances(snap).list.map((p) => [p.key, p]));
    } catch {
      return new Map(); // a balance problem must never stop an email
    }
  }

  /**
   * The text-and-table body for one cadet, with `intro` (already personalised) above it. What
   * appears is up to Settings → Push notifications (`state.content`); `balances` is balanceMap().
   */
  compose(person, intro, { note = "", balances = new Map() } = {}) {
    const ct = this.state.content;
    const all = [...person.forms].sort((a, b) => (b.record.date_iso || "").localeCompare(a.record.date_iso || ""));
    const mapped = all.map((f) => {
      const r = f.record;
      return {
        date: fmtDate(r.date_iso, r.date), form: formName(r.form_type), pn: r.pos_neg === "Pos" ? "Positive" : r.pos_neg === "Neg" ? "Negative" : "",
        reason: [r.reason_category, r.reason_details].map(R.collapse).filter(Boolean),
        pr: r.rejected ? { steps: [], done: 0, next: "" } : this.progress(r), outcomes: this.outcomes(r), positive: r.pos_neg === "Pos", rejected: Boolean(r.rejected),
      };
    });
    const rows = mapped.filter((r) => (ct.positives || !r.positive) && (!ct.only_open || (r.pr.next && !r.rejected)));
    const neg = all.filter((f) => f.record.pos_neg !== "Pos" && !f.record.rejected);
    const sum = (k, onlyCounted = false) => neg.reduce((a, f) => a + (onlyCounted && !f.record.counted ? 0 : num(f.record[k])), 0);
    const totals = { forms: all.length, pos: all.length - neg.length, neg: neg.length, demerits: sum("demerits"), tours: sum("tours", true), confinements: sum("confinements", true) };
    const bal = ct.balances ? balances.get(person.key) || null : null;
    const today = fmtDate(new Date().toISOString().slice(0, 10));
    const sig = this.state.signature.enabled ? this.state.signature.text : "";

    const status = (pr, rejected) => (rejected ? "Rejected: no further signatures needed" : pr.next ? `Waiting on: ${pr.next} (${pr.done} of ${pr.steps.length} steps done)` : `Fully processed (${pr.steps.length} of ${pr.steps.length} steps)`);
    const balanceLine = (label, b) => (ct.balance_detail ? `${label}: ${b.left} left to serve (${b.served} served of ${b.assigned} assigned)` : `${label}: ${b.left} left to serve`);
    const totalsLine = `Totals: ${totals.forms} form${totals.forms === 1 ? "" : "s"} (${totals.neg} negative, ${totals.pos} positive); ${totals.demerits} demerits, ${totals.tours} tours, ${totals.confinements} confinements.`;
    const empty = ct.only_open ? "Nothing is waiting on a step right now." : "No paperwork to list.";

    const text = [
      intro, "", ...(note ? [note, ""] : []),
      ...(ct.forms ? [
        `Your paperwork on file (${today}):`, "",
        ...(rows.length ? rows.flatMap((r) => [
          `* ${[ct.date && r.date, ct.form && `${r.form}${r.pn ? `, ${r.pn}` : ""}`, ct.reason && r.reason[0]].filter(Boolean).join(" - ") || "Form"}`,
          ...(ct.details && r.reason[1] ? [`    ${r.reason[1]}`] : []),
          ...(ct.status ? [`    ${status(r.pr, r.rejected)}`] : []),
          ...(ct.steps ? [`    ${r.pr.steps.map((s) => `${s.done ? "[x]" : "[ ]"} ${s.label}`).join("  ")}`] : []),
          ...(ct.outcomes ? [`    Rewards / sanctions: ${r.outcomes.join("; ") || "none recorded"}`] : []), "",
        ]) : [empty, ""]),
      ] : []),
      ...(bal ? ["Tours and confinements:", `  ${balanceLine("Tours", bal.tours)}`, `  ${balanceLine("Confinements", bal.confinements)}`, ""] : []),
      ...(ct.totals ? [totalsLine] : []),
      ...(ct.footer ? ["", "Sent by the First Sergeant's paperwork tracker. If something here looks wrong, reply to this email."] : []),
      ...(sig ? ["", "--", sig] : []),
    ].join("\n");

    const td = "padding:8px 10px;border-bottom:1px solid #e3e6ec;vertical-align:top;font-size:13px;color:#1d2330";
    const th = "padding:8px 10px;background:#f1f3f7;border-bottom:1px solid #d5d9e2;text-align:left;font-size:12px;color:#4a5265;text-transform:uppercase;letter-spacing:.04em";
    const columns = [
      ct.date && ["Date", (r) => `<td style="${td};white-space:nowrap">${esc(r.date)}</td>`],
      ct.form && ["Form", (r) => `<td style="${td}">${esc(r.form)}${r.pn ? `<br><span style="color:${r.pn === "Positive" ? "#1f7a4d" : "#b3402f"}">${esc(r.pn)}</span>` : ""}</td>`],
      (ct.reason || ct.details) && ["Reason", (r) => `<td style="${td}">${ct.reason ? esc(r.reason[0] || "") : ""}${ct.details && r.reason[1] ? `<div style="color:#5b6376;margin-top:${ct.reason ? 3 : 0}px">${esc(r.reason[1])}</div>` : ""}</td>`],
      (ct.status || ct.steps) && ["Where it is", (r) => `<td style="${td}">${ct.status ? `<b>${esc(status(r.pr, r.rejected))}</b>` : ""}${ct.steps ? `<div style="margin-top:${ct.status ? 4 : 0}px;color:#5b6376;line-height:1.5">${r.pr.steps.map((s) => `${s.done ? "&#10003;" : "&#9675;"} ${esc(s.label)}`).join("<br>")}</div>` : ""}</td>`],
      ct.outcomes && ["Rewards / sanctions", (r) => `<td style="${td}">${r.outcomes.length ? r.outcomes.map(esc).join("<br>") : '<span style="color:#8b93a5">None recorded</span>'}</td>`],
    ].filter(Boolean);
    const balCell = (label, b) => `<td style="padding:8px 14px;border:1px solid #d5d9e2;font-size:13px;vertical-align:top"><b>${esc(label)}</b><div style="font-size:20px;font-weight:600;color:${b.left ? "#b3402f" : "#1f7a4d"};margin:2px 0">${b.left} left to serve</div>${ct.balance_detail ? `<div style="color:#5b6376">${b.served} served of ${b.assigned} assigned</div>` : ""}</td>`;
    const html = `<div style="font-family:Segoe UI,Arial,sans-serif;color:#1d2330;max-width:760px">
      <div style="font-size:14px;line-height:1.55">${esc(intro).replace(/\n/g, "<br>")}</div>
      ${note ? `<div style="margin:12px 0;padding:10px 12px;background:#eef4ff;border-left:3px solid #3b6fd4;font-size:13px;line-height:1.5">${esc(note).replace(/\n/g, "<br>")}</div>` : ""}
      ${ct.forms ? `<h3 style="font-size:14px;margin:20px 0 8px">Your paperwork on file <span style="font-weight:normal;color:#6b7386">as of ${esc(today)}</span></h3>
      ${rows.length && columns.length ? `<table style="border-collapse:collapse;width:100%;border:1px solid #d5d9e2" cellspacing="0" cellpadding="0">
        <thead><tr>${columns.map(([h]) => `<th style="${th}">${h}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((r) => `<tr>${columns.map(([, cell]) => cell(r)).join("")}</tr>`).join("")}</tbody>
      </table>` : `<p style="font-size:13px;color:#5b6376;margin:0">${esc(empty)}</p>`}` : ""}
      ${bal ? `<h3 style="font-size:14px;margin:20px 0 8px">Tours and confinements</h3><table style="border-collapse:collapse" cellspacing="0" cellpadding="0"><tr>${balCell("Tours", bal.tours)}${balCell("Confinements", bal.confinements)}</tr></table>` : ""}
      ${ct.totals ? `<p style="font-size:13px;margin:12px 0 0"><b>Totals:</b> ${totals.forms} form${totals.forms === 1 ? "" : "s"} (${totals.neg} negative, ${totals.pos} positive) &middot; ${totals.demerits} demerits &middot; ${totals.tours} tours &middot; ${totals.confinements} confinements</p>` : ""}
      ${ct.footer ? `<p style="font-size:12px;color:#7a8296;margin-top:18px">Sent by the First Sergeant's paperwork tracker. If something here looks wrong, reply to this email.</p>` : ""}${sig ? `<div style="margin-top:16px;padding-top:10px;border-top:1px solid #e3e6ec;font-size:13px;line-height:1.5">${esc(sig).replace(/\n/g, "<br>")}</div>` : ""}</div>`;
    return { text, html, forms: rows.length };
  }

  personalise(template, person) {
    return String(template ?? "").replace(/\{name\}/gi, person.name).replace(/\{first_?name\}/gi, firstName(person.name));
  }

  /** What would go to one person, without sending anything. */
  preview({ key, subject, message }, snap) {
    const person = this.people(snap).get(key);
    if (!person) throw new Error("That cadet has no active paperwork on file");
    const c = this.compose(person, this.personalise(message, person), { balances: this.balanceMap(snap) });
    return { to: this.contactsFor(key).map((x) => x.email), subject: this.personalise(subject, person) || "Conduct paperwork update", html: c.html, text: c.text };
  }

  // ------------------------------------------------------------------ sending
  enqueue(fn) {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => {});
    return run;
  }

  /** Send one message, turning any failure into words. Never throws. */
  async deliver(to, subject, text, html) {
    try {
      await this.mailer.send({ to, subject, text, html });
      return null;
    } catch (e) {
      return String(e?.message || e) || "The message could not be sent";
    }
  }

  /**
   * Send the summary email to each chosen cadet (everyone with an email on file for them).
   * Cadets with no email are reported, not an error: the rest still go.
   */
  send({ keys, subject, message, kind = "manual", test = false }, snap) {
    const rd = this.ready();
    if (!rd.ok) throw new Error(rd.reason);
    keys = [...new Set((Array.isArray(keys) ? keys : []).map(String))];
    if (!keys.length) throw new Error("Choose at least one person to send to");
    if (keys.length > MAX_BATCH && !test) throw new Error(`That is ${keys.length} people. Send at most ${MAX_BATCH} at a time (Gmail limits daily sends).`);
    const people = this.people(snap);
    const jobs = [];
    const skipped = [];
    for (const k of keys) {
      const person = people.get(k);
      if (!person) { skipped.push({ name: k, reason: "no active paperwork on file" }); continue; }
      const emails = this.contactsFor(k).map((c) => c.email);
      if (!emails.length) { skipped.push({ name: person.name, reason: "no email on file" }); continue; }
      jobs.push({ person, emails });
    }
    if (!jobs.length) throw new Error(skipped.length ? `Nobody to send to: ${skipped.map((s) => `${s.name} (${s.reason})`).join(", ")}` : "Nobody to send to");
    const subj = R.collapse(subject) || "Conduct paperwork update";
    const balances = this.balanceMap(snap);
    return this.enqueue(async () => {
      const sent = [];
      const failed = [];
      for (const [i, { person, emails }] of jobs.entries()) {
        if (i) await wait(350);
        const body = this.compose(person, this.personalise(message, person), { balances });
        const to = test ? [rd.user] : emails;
        const prefix = test ? "[TEST - would go to " + emails.join(", ") + "] " : "";
        const err = await this.deliver(to, prefix + this.personalise(subj, person), body.text, body.html);
        this.log({ kind: test ? "test" : kind, ok: !err, to, subject: this.personalise(subj, person), person: person.name, error: err || undefined });
        if (err) failed.push({ name: person.name, error: err });
        else sent.push(person.name);
        if (err && /rejected the sign-in|app password|sign-in|quota|limit exceeded/i.test(err)) break; // every one after it would fail the same way
      }
      this.store.bump();
      return { sent: sent.length, sent_names: sent, failed, skipped, aborted: sent.length + failed.length < jobs.length };
    });
  }

  // ------------------------------------------------------------------ automatic updates
  setSignature(patch) {
    const g = this.state.signature;
    if ("text" in patch) {
      const t = String(patch.text ?? "").replace(/\r\n/g, "\n").trim();
      if (t.length > 1000) throw new Error("Keep the signature under 1,000 characters");
      g.text = t;
    }
    if ("enabled" in patch) g.enabled = patch.enabled === true;
    this.save();
    this.store.bump();
    return { ...g };
  }

  setContent(patch) {
    const c = { ...this.state.content };
    for (const [k, v] of Object.entries(patch || {})) {
      if (!(k in CONTENT_DEFAULT)) throw new Error(`Unknown email setting “${k}”`);
      if (typeof v !== "boolean") throw new Error("Email settings are on or off");
      c[k] = v;
    }
    if (c.forms && !["date", "form", "reason", "details", "status", "steps", "outcomes"].some((k) => c[k])) throw new Error("Pick at least one column for the paperwork table, or turn the table off");
    this.state.content = c;
    this.save();
    this.store.bump();
    return { ...c };
  }

  setAuto(patch) {
    const a = this.state.auto;
    if ("stages" in patch) {
      if (!Array.isArray(patch.stages) || patch.stages.some((k) => !R.FLAG_KEYS.includes(k))) throw new Error("Unknown routing step");
      a.stages = [...new Set(patch.stages)];
    }
    if ("enabled" in patch) {
      const on = patch.enabled === true;
      if (on && !this.ready().ok) throw new Error(`Connect a Gmail account first. ${this.ready().reason}`);
      if (on && !a.enabled) this.rebaseline(); // turning it on never announces what already happened
      a.enabled = on;
    }
    this.save();
    this.store.bump();
    return a;
  }

  flagsOf(f) {
    return Object.fromEntries(R.FLAG_KEYS.map((k) => [k, f.record[k] ?? null]));
  }

  /** Remember where every form stands now, without announcing anything. */
  rebaseline(snap = this.store.snapshot()) {
    const forms = {};
    for (const f of snap.forms) if (f.parsed && !f.pending && !f.missing && !f.archived && !f.rejected) forms[f.id] = this.flagsOf(f);
    this.state.seen = { parser: this.parserVersion, forms };
  }

  /** Forget what was seen (the store was cleared and is being read again). */
  reset() {
    this.state.seen = { parser: null, forms: {} };
    this.save();
  }

  /**
   * Look for steps that just passed. A form we hadn't seen before, or a read by a newer parser, only
   * sets the baseline; so does anything while a step is switched off. Returns what was queued.
   */
  async check(snap = this.store.snapshot()) {
    const a = this.state.auto;
    if (!a.enabled) return { queued: 0 };
    if (this.state.seen.parser !== this.parserVersion) { this.rebaseline(snap); this.save(); return { queued: 0 }; }
    if (snap.forms.some((f) => f.pending)) { this.onChanged(); return { queued: 0 }; } // let the reads finish first
    const events = [];
    const next = {};
    for (const f of snap.forms) {
      if (!f.parsed || f.missing || f.archived || f.rejected) continue; // a rejected form is out of the process: nothing to announce, and un-rejecting re-baselines it quietly
      const cur = this.flagsOf(f);
      next[f.id] = cur;
      const prev = this.state.seen.forms[f.id];
      if (!prev) continue;
      for (const k of a.stages) if (prev[k] === false && cur[k] === true) events.push({ form: f, stage: k });
    }
    const changed = JSON.stringify(next) !== JSON.stringify(this.state.seen.forms);
    this.state.seen.forms = next;
    if (changed) this.save();
    if (!events.length) return { queued: 0 };

    const rd = this.ready();
    const people = this.people(snap);
    const perPerson = new Map();
    for (const ev of events) {
      for (const name of ev.form.record.recipient_list || []) {
        const key = R.nameKey(name);
        const optedIn = this.contactsFor(key).filter((c) => c.auto);
        if (!optedIn.length || !people.has(key)) continue;
        const entry = perPerson.get(key) || { key, emails: new Set(), events: [] };
        optedIn.forEach((c) => entry.emails.add(c.email));
        entry.events.push(ev);
        perPerson.set(key, entry);
      }
    }
    if (!perPerson.size) return { queued: 0 };
    if (!rd.ok) {
      this.log({ kind: "auto", ok: false, to: [], subject: "Automatic updates", error: `Skipped ${perPerson.size} update${perPerson.size === 1 ? "" : "s"}: ${rd.reason}` });
      this.store.bump();
      return { queued: 0 };
    }
    if (perPerson.size > AUTO_MAX) {
      this.log({ kind: "auto", ok: false, to: [], subject: "Automatic updates", error: `Held: ${perPerson.size} people would be emailed at once (more than ${AUTO_MAX}). Nothing was sent; use the Notifications tab if you want to send these.` });
      this.store.bump();
      return { queued: 0, held: perPerson.size };
    }
    const balances = this.balanceMap(snap);
    this.enqueue(async () => {
      let first = true;
      for (const { key, emails, events: evs } of perPerson.values()) {
        if (!first) await wait(350);
        first = false;
        const person = people.get(key);
        const lines = evs.map(({ form, stage }) => `${formName(form.record.form_type)} dated ${fmtDate(form.record.date_iso, form.record.date)} (${form.record.reason_category || form.filename}): ${STEP_LABEL[stage] || stage}`);
        const intro = `Hello ${firstName(person.name)},\n\nYour paperwork has moved forward.`;
        const body = this.compose(person, intro, { note: `Just completed:\n${lines.join("\n")}`, balances });
        const subject = evs.length === 1 ? `Paperwork update: ${STEP_SHORT[evs[0].stage] || "step complete"}` : "Paperwork update";
        const err = await this.deliver([...emails], subject, body.text, body.html);
        this.log({ kind: "auto", ok: !err, to: [...emails], subject, person: person.name, error: err || undefined });
      }
      this.store.bump();
    }).catch(() => {});
    return { queued: perPerson.size };
  }
}
