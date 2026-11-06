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

import { ensureLocal } from "./cloud.js";
import { extractContacts, isEmail, readSpreadsheet } from "./contacts.js";
import { bestMatch, displayName, firstName, lastName, nameDistance } from "./people.js";
import * as R from "./records.js";
import { writeJson } from "./store.js";
import { FLAG_DEFS } from "./templates.js";

const MAX_BATCH = 150; // one manual send; Gmail allows roughly 500 messages a day, Exchange throttles per minute
const AUTO_MAX = 20; // more people than this in one automatic round is held for a human to look at
const LOG_KEEP = 200;
const ATTACH_MAX_FILES = 10; // final copies attached to one email
const ATTACH_MAX_BYTES = 18 * 1024 * 1024; // under Gmail's 25 MB once encoded; Exchange is often lower still
const AUTO_DELAY_MS = 8000; // let a burst of changes (a bulk step, a sync) settle into one email each
const STEP_LABEL = Object.fromEntries(FLAG_DEFS.map(([k, label]) => [k, label]));
const STEP_SHORT = { issuer_signed: "Issuer signature", sqccf_processed: "SQ/CCF processing", cadet_cc_initialed: "Cadet Commander initials", recipient_signed: "Recipient signature", aoc_signed: "AOC/AMT signature" };

const id = () => randomBytes(6).toString("hex");
const stamp = () => new Date().toISOString().slice(0, 19);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
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
  attach_final: false, // attach each fully signed Form 10 (the final copy) to the email
};

// Which paperwork a manual notification is about. A cadet's email lists (and attaches) only the forms in scope,
// and people with none in scope are left out of every way of picking recipients except naming one person.
export const SCOPES = [
  ["all", "Everything"],
  ["negative", "All negative"],
  ["positive", "All positive"],
  ["outstanding_negative", "Outstanding negative"],
  ["in_progress", "In progress"],
  ["rejected", "Rejected"],
];
const waiting = (r) => FLAG_DEFS.some(([k]) => r[k] === false); // at least one signature or step still to come
function inOne(r, scope) {
  const neg = r.pos_neg !== "Pos" && !r.rejected;
  switch (scope) {
    case "negative": return neg;
    case "positive": return r.pos_neg === "Pos" && !r.rejected;
    case "outstanding_negative": return neg && waiting(r);
    case "in_progress": return !r.rejected && waiting(r);
    case "rejected": return Boolean(r.rejected);
    default: return true;
  }
}
/** A form is in scope if it fits ANY of the chosen kinds (`scopes` may be one key or a list). */
export function inScope(r, scopes) {
  return (Array.isArray(scopes) ? scopes : [scopes]).some((k) => inOne(r, k));
}
/** One key or a list -> a de-duplicated list of valid keys; null when nothing was asked for. */
function toScopes(x) {
  if (x === undefined || x === null || x === "") return null;
  const arr = [...new Set(Array.isArray(x) ? x : [x])];
  if (!arr.length || arr.some((k) => !SCOPES.some(([v]) => v === k))) throw new Error("Unknown kind of paperwork");
  return arr;
}
/** "Outstanding paperwork" for picking people: still waiting on a step, or rejected and needing a redo. */
const outstanding = (r) => Boolean(r.rejected) || waiting(r);

const MANUAL_DETAILS = ["forms", "date", "form", "reason", "details", "status", "steps", "outcomes", "balances", "balance_detail", "totals", "footer", "attach_final"];
const MANUAL_DEFAULT = () => ({
  subject: "Conduct paperwork update", message: "", scopes: ["all"],
  content: { ...CONTENT_DEFAULT, only_open: false, positives: true }, // which forms are listed comes from the scope, not these two
});

const DEFAULT_STATE = () => ({
  contacts: [],
  declined: [], // "<contact id>|<cadet key>": offered as the same person and answered "no"
  auto: { enabled: false, stages: ["recipient_signed", "aoc_signed"] },
  signature: { enabled: false, text: "" }, // closing lines added to every email when on
  content: { ...CONTENT_DEFAULT }, // what the summary email includes (automatic updates)
  manual: MANUAL_DEFAULT(), // the Notifications wizard's message and choices, kept between sessions
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
    if (data.manual && typeof data.manual === "object") {
      const m = data.manual;
      s.manual.subject = String(m.subject ?? s.manual.subject).slice(0, 150);
      s.manual.message = String(m.message ?? "").slice(0, 5000);
      try { s.manual.scopes = toScopes(m.scopes ?? m.scope) || s.manual.scopes; } catch { /* keep the default */ }
      if (m.content && typeof m.content === "object") for (const k of MANUAL_DETAILS) if (typeof m.content[k] === "boolean") s.manual.content[k] = m.content[k];
    }
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
    if (!st.configured) return { ok: false, reason: st.reason || "No email account is connected yet. Set one up in Settings → Push notifications." };
    return { ok: true, user: st.user, drafts: st.drafts === true, pace: st.pace ?? 350 };
  }

  /** Automatic updates only make sense when mail really goes out: a pile of silent drafts would be worse than nothing. */
  autoReady() {
    const rd = this.ready();
    if (rd.ok && rd.drafts) return { ok: false, reason: "Outlook is set to save drafts, and automatic updates need it set to send. Change that in Settings → Push notifications." };
    return rd;
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
      // per kind of paperwork: how many of their forms count, and how many of those still need something
      const rel = {};
      const out = {};
      for (const [k] of SCOPES) {
        const inK = p.forms.filter((f) => inScope(f.record, k));
        rel[k] = inK.length;
        out[k] = inK.filter((f) => outstanding(f.record)).length;
      }
      // each form and which kinds it belongs to, so the screen can count a union of kinds without asking again
      const fl = p.forms.map((f) => ({ in: SCOPES.filter(([k]) => inScope(f.record, k)).map(([k]) => k), out: outstanding(f.record) }));
      return { key: p.key, name: p.name, class_year: p.class_year, forms: p.forms.length, open, rel, out, fl, emails: cs.map((c) => c.email), auto: cs.filter((c) => c.auto).length };
    }).sort((a, b) => a.name.localeCompare(b.name));
    return {
      mail: { ...st }, ready: this.ready().ok, contacts, people: list, cadets: this.knownNames(snap).sort(),
      auto: { ...this.state.auto }, signature: { ...this.state.signature }, content: { ...this.state.content }, log: this.state.log.slice(-40).reverse(),
      steps: FLAG_DEFS.map(([k, label]) => ({ key: k, label })), max_batch: MAX_BATCH, auto_max: AUTO_MAX,
      manual: { ...this.state.manual, content: { ...this.state.manual.content } }, scopes: SCOPES.map(([key, label]) => ({ key, label })),
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
    if (rec.rejected) return []; // the status line already says so
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
  compose(person, intro, { note = "", balances = new Map(), attached = [], notAttached = [], content = null, forms = null } = {}) {
    const ct = content || this.state.content;
    const all = [...person.forms].sort((a, b) => (b.record.date_iso || "").localeCompare(a.record.date_iso || ""));
    const mapped = all.map((f) => {
      const r = f.record;
      return {
        f, date: fmtDate(r.date_iso, r.date), form: formName(r.form_type), pn: r.pos_neg === "Pos" ? "Positive" : r.pos_neg === "Neg" ? "Negative" : "",
        reason: [r.reason_category, r.reason_details].map(R.collapse).filter(Boolean),
        pr: r.rejected ? { steps: [], done: 0, next: "" } : this.progress(r), outcomes: this.outcomes(r), positive: r.pos_neg === "Pos", rejected: Boolean(r.rejected),
      };
    });
    const rows = forms ? mapped.filter((r) => forms.includes(r.f)) : mapped.filter((r) => (ct.positives || !r.positive) && (!ct.only_open || (r.pr.next && !r.rejected)));
    const neg = all.filter((f) => f.record.pos_neg !== "Pos" && !f.record.rejected);
    const sum = (k, onlyCounted = false) => neg.reduce((a, f) => a + (onlyCounted && !f.record.counted ? 0 : num(f.record[k])), 0);
    const rej = all.filter((f) => f.record.rejected).length;
    const totals = { forms: all.length, pos: all.length - neg.length - rej, rej, neg: neg.length, demerits: sum("demerits"), tours: sum("tours", true), confinements: sum("confinements", true) };
    const bal = ct.balances ? balances.get(person.key) || null : null;
    const today = fmtDate(new Date().toISOString().slice(0, 10));
    const sig = this.state.signature.enabled ? this.state.signature.text : "";

    const status = (pr, rejected) => (rejected ? "Rejected, so nothing from this form counts" : pr.next ? `Waiting on: ${pr.next}` : "Fully processed");
    const urgent = (pr, rejected) => rejected || Boolean(pr.next); // the reader has something to chase: bold it
    const stepsLine = (pr) => [pr.steps.some((s) => s.done) && `Done: ${pr.steps.filter((s) => s.done).map((s) => s.label).join(", ")}.`, pr.steps.some((s) => !s.done) && `Still to do: ${pr.steps.filter((s) => !s.done).map((s) => s.label).join(", ")}.`].filter(Boolean).join(" ");
    // Only tours / confinements the cadet actually has; "0 left of 0 assigned" is noise.
    const balanceLines = (b) => [["Tours", b.tours], ["Confinements", b.confinements]].filter(([, x]) => x.assigned > 0 || x.left > 0).map(([label, x]) => ({
      bold: x.left > 0,
      text: x.left > 0
        ? `${label}: ${x.left} left to serve${ct.balance_detail && x.served > 0 ? ` (${x.served} served of ${x.assigned})` : ""}`
        : `${label}: none left to serve${ct.balance_detail ? ` (all ${x.assigned} served)` : ""}`,
    }));
    const balLines = bal ? balanceLines(bal) : [];
    const kinds = [totals.neg && `${totals.neg} negative`, totals.pos && `${totals.pos} positive`, totals.rej && `${totals.rej} rejected`].filter(Boolean);
    const sanctions = [totals.demerits && `${totals.demerits} demerit${totals.demerits === 1 ? "" : "s"}`, totals.tours && `${totals.tours} tour${totals.tours === 1 ? "" : "s"}`, totals.confinements && `${totals.confinements} confinement${totals.confinements === 1 ? "" : "s"}`].filter(Boolean);
    const totalsLine = `Totals: ${totals.forms} form${totals.forms === 1 ? "" : "s"}${kinds.length ? ` (${kinds.join(", ")})` : ""}${sanctions.length ? `; ${sanctions.join(", ")}` : ""}.`;
    const empty = forms ? "No paperwork matches this update." : ct.only_open ? "Nothing is waiting on a step right now." : "No paperwork to list.";
    const attachLines = [
      ...(attached.length ? [`Attached: the final signed copy of ${attached.length === 1 ? "this form" : "these forms"} (${attached.join(", ")}).`] : []),
      ...(notAttached.length ? [`Not attached (too large to send): ${notAttached.join(", ")}.`] : []),
    ];
    const footerLine = "Sent by the First Sergeant's paperwork tracker. If something here looks wrong, reply to this email.";

    const text = [
      intro, "", ...(note ? [note, ""] : []),
      ...(ct.forms ? [
        `Your paperwork on file (${today}):`, "",
        ...(rows.length ? rows.flatMap((r) => [
          `* ${[ct.date && r.date, ct.form && `${r.form}${r.pn ? `, ${r.pn}` : ""}`, ct.reason && r.reason[0]].filter(Boolean).join(" - ") || "Form"}`,
          ...(ct.details && r.reason[1] ? [`    ${r.reason[1]}`] : []),
          ...(ct.status ? [`    ${status(r.pr, r.rejected)}`] : []),
          ...(ct.steps && r.pr.steps.length ? [`    ${stepsLine(r.pr)}`] : []),
          ...(ct.outcomes && r.outcomes.length ? [`    Rewards / sanctions: ${r.outcomes.join("; ")}`] : []), "",
        ]) : [empty, ""]),
      ] : []),
      ...(balLines.length ? [...balLines.map((l) => l.text), ""] : []),
      ...(attachLines.length ? [...attachLines, ""] : []),
      ...(ct.totals ? [totalsLine] : []),
      ...(ct.footer ? ["", footerLine] : []),
      ...(sig ? ["", "--", sig] : []),
    ].join("\n");

    // Plain on purpose: the default font, black text, thin grey rules, no colour or icons, so it reads
    // like a note someone typed rather than a designed notification.
    const cell = "padding:4px 8px;border:1px solid #bfbfbf;vertical-align:top;text-align:left";
    const columns = [
      ct.date && ["Date", (r) => `<td style="${cell};white-space:nowrap">${esc(r.date)}</td>`],
      ct.form && ["Form", (r) => `<td style="${cell}">${esc(r.form)}${r.pn ? `, ${esc(r.pn.toLowerCase())}` : ""}</td>`],
      (ct.reason || ct.details) && ["Reason", (r) => `<td style="${cell}">${ct.reason ? esc(r.reason[0] || "") : ""}${ct.details && r.reason[1] ? `${ct.reason ? "<br>" : ""}${esc(r.reason[1])}` : ""}</td>`],
      (ct.status || ct.steps) && ["Where it is", (r) => `<td style="${cell}">${ct.status ? (urgent(r.pr, r.rejected) ? `<b>${esc(status(r.pr, r.rejected))}</b>` : esc(status(r.pr, r.rejected))) : ""}${ct.steps && r.pr.steps.length ? `${ct.status ? "<br>" : ""}${esc(stepsLine(r.pr))}` : ""}</td>`],
      ct.outcomes && rows.some((r) => r.outcomes.length) && ["Rewards / sanctions", (r) => `<td style="${cell}">${r.outcomes.map(esc).join("<br>")}</td>`],
    ].filter(Boolean);
    const para = (t) => `<p style="margin:0 0 12px">${t}</p>`;
    const html = `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#000">
      ${para(esc(intro).replace(/\n/g, "<br>"))}
      ${note ? para(`<b>${esc(note.split("\n")[0])}</b>${note.includes("\n") ? `<br>${esc(note.slice(note.indexOf("\n") + 1)).replace(/\n/g, "<br>")}` : ""}`) : ""}
      ${ct.forms ? `${para(`Your paperwork on file (${esc(today)}):`)}
      ${rows.length && columns.length ? `<table style="border-collapse:collapse;margin:0 0 12px" cellspacing="0" cellpadding="0">
        <thead><tr>${columns.map(([h]) => `<th style="${cell};font-weight:bold">${h}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((r) => `<tr>${columns.map(([, c]) => c(r)).join("")}</tr>`).join("")}</tbody>
      </table>` : para(esc(empty))}` : ""}
      ${balLines.length ? para(balLines.map((l) => (l.bold ? `<b>${esc(l.text)}</b>` : esc(l.text))).join("<br>")) : ""}
      ${attachLines.length ? para(attachLines.map((l) => (/^Attached: /.test(l) ? `<b>Attached:</b> ${esc(l.slice(10))}` : `<b>${esc(l)}</b>`)).join("<br>")) : ""}
      ${ct.totals ? para(esc(totalsLine)) : ""}
      ${ct.footer ? para(esc(footerLine)) : ""}${sig ? para(esc(sig).replace(/\n/g, "<br>")) : ""}</div>`;
    return { text, html, forms: rows.length };
  }

  /**
   * The final signed Form 10s to attach for these forms: only fully signed, counted ones (never a
   * rejected or archived one), and only when the setting is on. Capped so a message always goes through.
   */
  finalCopies(person, forms = person.forms, ct = this.state.content) {
    const files = [];
    const skipped = [];
    if (!ct.attach_final) return { files, skipped };
    let total = 0;
    for (const f of forms) {
      const r = f.record;
      if (r.form_type !== "F10" || !r.counted || (!ct.positives && r.pos_neg === "Pos")) continue;
      const p = this.store.pdfPath(f.id);
      if (!p) continue;
      try {
        ensureLocal(p);
        const size = fs.statSync(p).size;
        if (files.length >= ATTACH_MAX_FILES || total + size > ATTACH_MAX_BYTES) { skipped.push(f.filename); continue; }
        total += size;
        files.push({ filename: f.filename, path: p });
      } catch {
        skipped.push(f.filename);
      }
    }
    return { files, skipped };
  }

  personalise(template, person) {
    return String(template ?? "").replace(/\{name\}/gi, person.name).replace(/\{first_?name\}/gi, firstName(person.name)).replace(/\{last_?name\}/gi, lastName(person.name));
  }

  /** What a manual notification means for one person: the forms in scope, the files to attach, and the body. */
  manualBody(person, { subject, message, scope, content }, balances) {
    const sc = toScopes(scope);
    // which forms are listed comes from the scope, so the two older "which forms" switches are pinned
    const ct = content ? { ...this.mergeContent(this.state.manual.content, content, [...MANUAL_DETAILS, "only_open", "positives"]), only_open: false, positives: true } : this.state.content;
    const forms = sc ? person.forms.filter((f) => inScope(f.record, sc)) : null;
    const att = this.finalCopies(person, forms || person.forms, ct);
    const body = this.compose(person, this.personalise(message, person), { balances, attached: att.files.map((f) => f.filename), notAttached: att.skipped, content: ct, forms });
    return { body, att };
  }

  /** What would go to one person, without sending anything. */
  preview({ key, subject, message, scope, content }, snap) {
    const person = this.people(snap).get(key);
    if (!person) throw new Error("That cadet has no active paperwork on file");
    const { body: c, att } = this.manualBody(person, { subject, message, scope, content }, this.balanceMap(snap));
    return { to: this.contactsFor(key).map((x) => x.email), subject: this.personalise(subject, person) || "Conduct paperwork update", html: c.html, text: c.text, attachments: att.files.map((f) => f.filename) };
  }

  // ------------------------------------------------------------------ sending
  enqueue(fn) {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => {});
    return run;
  }

  /** Send one message, turning any failure into words. Never throws. */
  async deliver(to, subject, text, html, attachments = []) {
    try {
      await this.mailer.send({ to, subject, text, html, attachments });
      return null;
    } catch (e) {
      return String(e?.message || e) || "The message could not be sent";
    }
  }

  /**
   * Send the summary email to each chosen cadet (everyone with an email on file for them).
   * Cadets with no email are reported, not an error: the rest still go.
   */
  send({ keys, subject, message, scope, content, kind = "manual", test = false }, snap) {
    const rd = this.ready();
    if (!rd.ok) throw new Error(rd.reason);
    toScopes(scope); // refuses an unknown kind before anything is sent
    keys = [...new Set((Array.isArray(keys) ? keys : []).map(String))];
    if (!keys.length) throw new Error("Choose at least one person to send to");
    if (keys.length > MAX_BATCH && !test) throw new Error(`That is ${keys.length} people. Send at most ${MAX_BATCH} at a time (mail accounts limit how many go out in a day).`);
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
    const opts = { subject, message, scope, content };
    if (scope || content) this.manualBody(jobs[0].person, opts, balances); // a bad scope or setting fails here, before anything is sent
    const progress = (this.sendProgress = { running: true, total: jobs.length, done: 0, current: null, failed: 0, drafted: rd.drafts });
    return this.enqueue(async () => {
      const sent = [];
      const failed = [];
      for (const [i, { person, emails }] of jobs.entries()) {
        if (i) await wait(rd.pace);
        const to = test ? [rd.user] : emails;
        progress.current = { name: person.name, to };
        const { body, att } = scope || content ? this.manualBody(person, opts, balances) : (() => {
          const a = this.finalCopies(person);
          return { att: a, body: this.compose(person, this.personalise(message, person), { balances, attached: a.files.map((f) => f.filename), notAttached: a.skipped }) };
        })();
        const prefix = test ? "[TEST - would go to " + emails.join(", ") + "] " : "";
        const err = await this.deliver(to, prefix + this.personalise(subj, person), body.text, body.html, att.files);
        this.log({ kind: test ? "test" : kind, ok: !err, to, subject: this.personalise(subj, person), person: person.name, error: err || undefined, drafted: rd.drafts || undefined, attached: att.files.length || undefined });
        progress.done++;
        if (err) { failed.push({ name: person.name, error: err }); progress.failed++; }
        else sent.push(person.name);
        if (err && /rejected the sign-in|app password|sign-in|quota|limit exceeded/i.test(err)) break; // every one after it would fail the same way
      }
      progress.running = false;
      progress.current = null;
      this.store.bump();
      return { sent: sent.length, sent_names: sent, failed, skipped, aborted: sent.length + failed.length < jobs.length, drafted: rd.drafts };
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

  /** Apply on/off switches to a copy of `base`, refusing unknown or non-boolean ones and an empty table. */
  mergeContent(base, patch, allowed = Object.keys(CONTENT_DEFAULT)) {
    const c = { ...base };
    for (const [k, v] of Object.entries(patch || {})) {
      if (!allowed.includes(k)) throw new Error(`Unknown email setting “${k}”`);
      if (typeof v !== "boolean") throw new Error("Email settings are on or off");
      c[k] = v;
    }
    if (c.forms && !["date", "form", "reason", "details", "status", "steps", "outcomes"].some((k) => c[k])) throw new Error("Pick at least one column for the paperwork table, or turn the table off");
    return c;
  }

  setContent(patch) {
    this.state.content = this.mergeContent(this.state.content, patch);
    this.save();
    this.store.bump();
    return { ...this.state.content };
  }

  /** Save the wizard's message and choices so the next notification starts from them. */
  setDraft(patch = {}) {
    const m = { ...this.state.manual, content: { ...this.state.manual.content } };
    if ("subject" in patch) m.subject = String(patch.subject ?? "").slice(0, 150);
    if ("message" in patch) {
      if (String(patch.message ?? "").length > 5000) throw new Error("Keep the message under 5,000 characters");
      m.message = String(patch.message ?? "");
    }
    if ("scopes" in patch || "scope" in patch) m.scopes = toScopes(patch.scopes ?? patch.scope) || ["all"];
    if (patch.content) m.content = this.mergeContent(m.content, patch.content, MANUAL_DETAILS);
    this.state.manual = m;
    this.save();
    return this.state.manual;
  }

  setAuto(patch) {
    const a = this.state.auto;
    if ("stages" in patch) {
      if (!Array.isArray(patch.stages) || patch.stages.some((k) => !R.FLAG_KEYS.includes(k))) throw new Error("Unknown routing step");
      a.stages = [...new Set(patch.stages)];
    }
    if ("enabled" in patch) {
      const on = patch.enabled === true;
      if (on && !this.autoReady().ok) throw new Error(`Set up email first. ${this.autoReady().reason}`);
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

    const rd = this.autoReady();
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
        if (!first) await wait(rd.pace);
        first = false;
        const person = people.get(key);
        const lines = evs.map(({ form, stage }) => `${formName(form.record.form_type)} dated ${fmtDate(form.record.date_iso, form.record.date)} (${form.record.reason_category || form.filename}): ${STEP_LABEL[stage] || stage}`);
        const intro = `Hello ${firstName(person.name)},\n\nYour paperwork has moved forward.`;
        const att = this.finalCopies(person, evs.map((e) => e.form));
        const body = this.compose(person, intro, { note: `Just completed:\n${lines.join("\n")}`, balances, attached: att.files.map((f) => f.filename), notAttached: att.skipped });
        const subject = evs.length === 1 ? `Paperwork update: ${STEP_SHORT[evs[0].stage] || "step complete"}` : "Paperwork update";
        const err = await this.deliver([...emails], subject, body.text, body.html, att.files);
        this.log({ kind: "auto", ok: !err, to: [...emails], subject, person: person.name, error: err || undefined, attached: att.files.length || undefined });
      }
      this.store.bump();
    }).catch(() => {});
    return { queued: perPerson.size };
  }
}
