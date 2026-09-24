// Turning raw slot values + user edits into tracker records and Google Sheets rows.

import { FLAG_DEFS, FORM_TYPES, flagSlots } from "./templates.js";

export const SHEET_COLUMNS = ["Date", "Class Year", "Form Type", "Reason Category", "Reason Details", "Month",
  "Name", "Issuer", "Pos/Neg", "CDNA", "Passes", "Demerits", "Tours", "Confinements", "Other"];

// Record fields the user can edit (in addition to the four flags)
export const RECORD_FIELDS = ["recipients", "form_type", "pos_neg", "date", "class_year", "squadron",
  "reason_category", "reason_details", "issuer", "cdna", "passes", "demerits", "tours", "confinements", "other"];

// Typed in by hand, and only for positive Form 10s -- where they're required.
export const MANUAL_POS_F10 = ["cdna", "passes"];
// Section VI counts on the F10. Blank means none given (0); the F174 has no such blocks.
export const SANCTION_FIELDS = ["demerits", "tours", "confinements"];
export const FLAG_KEYS = FLAG_DEFS.map(([k]) => k);

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
  "October", "November", "December"];

export const collapse = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const isBlank = (v) => v === null || v === undefined || v === "" || v === false;

// --------------------------------------------------------------------------- filename

const POS = /^(pos|positive|\+)$/i;
const NEG = /^(neg|negative|-)$/i;
const FT = /^(?:af|afcw)?\s*(?:imt|form|frm|f)?\s*-?\s*(10|174)$/i;

function splitCamel(s) {
  return s.replace(/(?<=[a-z])(?=[A-Z])/g, " ").replace(/[-\s]+/g, " ").trim();
}

/** Recipient_PosOrNeg_FormType_Reason -> parts (lenient about order and spelling). */
export function parseFilename(filename) {
  const stem = filename.replace(/\.pdf$/i, "");
  const parts = stem.split("_").map((p) => p.trim());
  const pn = parts.findIndex((p) => POS.test(p) || NEG.test(p));
  const ft = parts.findIndex((p) => FT.test(p.replace(/ /g, "")));
  const info = { recipient: "", pos_neg: "", form_type: "", reason: "", valid: false, problems: [] };
  if (pn >= 0) info.pos_neg = POS.test(parts[pn]) ? "Pos" : "Neg";
  else info.problems.push("no Pos/Neg part");
  if (ft >= 0) info.form_type = "F" + FT.exec(parts[ft].replace(/ /g, ""))[1];
  else info.problems.push("no form type part (F10 / F174)");
  const markers = [pn, ft].filter((i) => i >= 0);
  if (markers.length) {
    const first = Math.min(...markers);
    const last = Math.max(...markers);
    info.recipient = parts.slice(0, first).filter(Boolean).join(" ");
    info.reason = splitCamel(parts.slice(last + 1).filter(Boolean).join(" "));
    if (!info.reason) info.problems.push("no reason part");
  }
  if (!info.recipient) info.problems.push("no recipient part");
  info.valid = pn === 1 && ft === 2 && parts.length >= 4 && Boolean(info.recipient);
  if (!info.valid && !info.problems.length) info.problems.push("parts out of order");
  return info;
}

// --------------------------------------------------------------------------- names

const RANK = /^(c[1-4]c|cadet)$/i;
const RANK_AFTER_C = /^(lt|col|gen|sgt|capt|maj)$/i;

/** Ranks aren't part of a name: drop C1C-C4C, "Cadet", and C/ grades (C/Capt, C/2d Lt, ...). */
export function stripRank(name) {
  const out = [];
  let skipNext = false;
  for (const tok of collapse(name).split(" ")) {
    const bare = tok.replace(/^[,.]+|[,.]+$/g, "");
    if (skipNext && RANK_AFTER_C.test(bare)) {
      skipNext = false;
      continue;
    }
    skipNext = false;
    if (RANK.test(bare)) continue;
    if (bare.toLowerCase().startsWith("c/")) {
      skipNext = true; // "C/2d Lt": the grade can run into a second word
      continue;
    }
    out.push(tok);
  }
  return collapse(out.join(" ")).replace(/^[\s,]+|[\s,]+$/g, "");
}

// Spellings the user confirmed are the same person: lowercased name -> correct name.
export const ALIASES = new Map();

export function canon(name) {
  const c = collapse(name);
  return ALIASES.get(c.toLowerCase()) ?? c;
}

/**
 * Typed recipient list. Commas separate people, but a one-word piece can't be a whole name, so it
 * is a surname written "Last, First": "Doe, John, Amy Wu" -> John Doe, Amy Wu.
 */
export function splitNames(s) {
  const chunks = String(s || "").split(/[,;\n]/).map(stripRank).filter(Boolean);
  const out = [];
  for (let i = 0; i < chunks.length; i++) {
    if (chunks[i].split(" ").length === 1 && i + 1 < chunks.length) {
      out.push(collapse(`${chunks[i + 1]} ${chunks[i]}`));
      i++;
    } else out.push(chunks[i]);
  }
  return out.map(canon);
}

/** "Doe, John A" -> "John A Doe" (forms ask for Last, First, MI). */
export function formNameToDisplay(name) {
  const n = collapse(name);
  const parts = n.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return collapse(`${parts.slice(1).join(" ")} ${parts[0]}`);
  return n;
}

/** A detected recipient is always one person: "Doe, John" -> "John Doe", never a list. */
export function singleName(name) {
  return canon(stripRank(formNameToDisplay(stripRank(name)).replace(/,/g, " ")));
}

/** Several recipients only exist when the user typed a comma-separated list. */
export function recipientNames(meta, autoRecipients) {
  const typed = meta.overrides?.recipients;
  if (typed !== undefined && typed !== null) return splitNames(typed);
  return collapse(autoRecipients) ? [autoRecipients] : [];
}

/** Order-insensitive key so "Doe John" and "John Doe" land on the same cadet. */
export function nameKey(n) {
  return stripRank(n).toLowerCase().split(/[^a-z]+/).filter((t) => t.length > 1).sort().join(" ");
}

/** Edit distance, giving up early once it exceeds `cap`. */
export function levenshtein(a, b, cap = 3) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] !== b[j - 1] ? 1 : 0)));
    }
    if (Math.min(...cur) > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}

// --------------------------------------------------------------------------- dates & numbers

const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const monthNum = (s) => MON[s.toLowerCase()] ?? MON[s.toLowerCase().slice(0, 3)];

function iso(y, m, d) {
  if (y < 100) y += 2000;
  if (!(y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null; // e.g. 31 Feb
  return dt.toISOString().slice(0, 10);
}

/** Dates as people write them on these forms -> YYYY-MM-DD (null if it can't be read). */
export function parseDate(raw) {
  const s = collapse(raw).replace(/_/g, " ");
  if (!s) return null;
  let m;
  if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) return iso(+m[1], +m[2], +m[3]); // 20260916
  if ((m = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s))) return iso(+m[1], +m[2], +m[3]); // 2026-09-16
  if ((m = /(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s))) return iso(+m[3], +m[1], +m[2]); // 9/16/2026 (US)
  if ((m = /(\d{1,2})\s*-?\s*([A-Za-z]{3,9})\.?\s*-?,?\s*(\d{2,4})/.exec(s)) && monthNum(m[2])) {
    return iso(+m[3], monthNum(m[2]), +m[1]); // 16 Sep 26, 16SEP2026, 16-Sep-26
  }
  if ((m = /([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2,4})/.exec(s)) && monthNum(m[1])) {
    return iso(+m[3], monthNum(m[1]), +m[2]); // September 16, 2026
  }
  return null;
}

export function parseClassYear(raw) {
  const s = collapse(raw);
  let m = /\b(20\d{2})\b/.exec(s);
  if (m) return m[1];
  m = /(?:'|’|C\s*)(\d{2})\b/.exec(s) || /^(\d{2})$/.exec(s);
  if (m) return "20" + m[1];
  return s;
}

const NOTHING = /^(n\.?\s*\/?\s*a\.?|none|nil|null|no|-+|—|0)$/i;
// Printed block labels that can bleed into a box's text on recreated/flattened copies
const LABEL_WORDS = /^(\d{1,2}\.|demerits?|demerit\(s\)|confinements?|confinement\(s\)|tours?|loss|of|pass|priv(ilege)?s?|revoke|pov|\(s\))$/i;

/** Drop printed-label words (e.g. "4. TOURS") that surround a handwritten/typed value. */
export function stripLabel(raw) {
  const toks = collapse(raw).split(" ").filter(Boolean);
  while (toks.length && LABEL_WORDS.test(toks[0])) toks.shift();
  while (toks.length && LABEL_WORDS.test(toks[toks.length - 1])) toks.pop();
  return toks.join(" ");
}

/**
 * Demerits / tours / confinements: a number, and blank or N/A means 0. Returns "" when the box
 * can't actually be read (handwriting, or any box on a scanned copy, where a faint "1" can look
 * blank), so the number gets typed in rather than silently becoming 0.
 */
export function sanctionCount(raw, slot = null, scanned = false) {
  const s = stripLabel(raw);
  if (!s || NOTHING.test(s)) {
    if (!collapse(raw) && (scanned || slot?.source === "ink")) return "";
    return "0";
  }
  const m = /(?<![\d.])(\d+(?:\.\d+)?)(?![\d.])/.exec(s);
  if (m) return m[1].endsWith(".0") ? m[1].slice(0, -2) : m[1];
  return s;
}

export function otherText(raw) {
  const s = stripLabel(raw);
  return !s || NOTHING.test(s) ? "" : s;
}

/** CDNA and Passes are entered by hand, and only for positive Form 10s. */
export const cdnaApplies = (formType, posNeg) => formType === "F10" && posNeg === "Pos";

/** Required hand-entered values still blank (a positive F10 needs CDNA and Passes). */
export function missingManual(rec) {
  if (!cdnaApplies(rec.form_type, rec.pos_neg)) return [];
  const labels = { cdna: "CDNA", passes: "Passes" };
  return MANUAL_POS_F10.filter((k) => !collapse(rec[k])).map((k) => labels[k]);
}

export function monthLabel(isoDate, fmt) {
  if (!isoDate) return "";
  const y = +isoDate.slice(0, 4);
  const m = +isoDate.slice(5, 7);
  if (fmt === "short") return MONTHS[m - 1].slice(0, 3);
  if (fmt === "iso") return `${y}-${String(m).padStart(2, "0")}`;
  if (fmt === "name_year") return `${MONTHS[m - 1]} ${y}`;
  if (fmt === "number") return String(m);
  return MONTHS[m - 1];
}

// --------------------------------------------------------------------------- record

export function effectiveFields(meta) {
  const out = {};
  for (const [k, v] of Object.entries(meta.analysis?.slots || {})) out[k] = v.value ?? "";
  Object.assign(out, meta.overrides?.fields || {});
  return out;
}

const filled = (slot, value) => (!isBlank(value) && !["", "False"].includes(collapse(value))) || Boolean(slot?.filled);

/** What the software believes, before user overrides. */
export function autoRecord(meta, settings, roster) {
  const a = meta.analysis || {};
  const fn = meta.filename_info || {};
  const ft = meta.overrides?.form_type || a.form_type || "";
  const f = effectiveFields(meta);
  const slots = a.slots || {};

  // Only Pos/Neg and the reason category come from the filename; the rest is read off the form.
  const recipients = singleName(f.recipient_name || "");
  const dateFields = ft === "F10" ? ["date", "date_awarded", "date_counseled", "login_date"] : ["date", "counselee_date", "commander_date"];
  const dateRaw = dateFields.map((k) => f[k]).find((v) => collapse(v)) || "";
  const isoDate = parseDate(dateRaw);

  let classYear = parseClassYear(f.class_year || "");
  if (!classYear) classYear = roster.get(nameKey(recipients)) || "";

  let details;
  let issuer;
  if (ft === "F174") {
    details = collapse(f.reason) || collapse(f.narrative);
    issuer = collapse(f.issuer);
  } else {
    details = collapse(f.narrative);
    issuer = formNameToDisplay(f.issuer || "");
    const grade = collapse(f.issuer_grade);
    if (grade && issuer && !issuer.toLowerCase().startsWith(grade.toLowerCase())) issuer = `${grade} ${issuer}`;
  }

  const other = [];
  if (ft === "F10") {
    if (otherText(f.loss_of_pass)) other.push(`Loss of pass: ${otherText(f.loss_of_pass)}`);
    if (otherText(f.pov_priv)) other.push(`POV revoked: ${otherText(f.pov_priv)}`);
  }

  const flags = {};
  const fslots = flagSlots(ft, settings);
  for (const key of FLAG_KEYS) {
    const keys = fslots[key] || [];
    flags[key] = keys.length ? keys.some((k) => filled(slots[k], f[k])) : null; // null: not on this form
  }

  const scanned = a.mode === "raster";
  return {
    recipients: collapse(recipients),
    form_type: ft,
    pos_neg: fn.pos_neg || "",
    date: isoDate || collapse(dateRaw),
    class_year: classYear,
    squadron: collapse(f.squadron),
    reason_category: fn.reason || "",
    reason_details: details,
    issuer,
    cdna: "", // never on the form: typed in by hand (positive F10s only)
    passes: "", // same as CDNA
    ...Object.fromEntries(SANCTION_FIELDS.map((k) => [k, ft === "F10" ? sanctionCount(f[k], slots[k], scanned) : ""])),
    other: other.join("; "),
    ...flags,
  };
}

export function buildRecord(meta, settings, roster) {
  const auto = autoRecord(meta, settings, roster);
  const ov = meta.overrides || {};
  const rec = { ...auto };
  const keys = [...RECORD_FIELDS, ...FLAG_KEYS];
  for (const k of keys) if (ov[k] !== undefined && ov[k] !== null) rec[k] = ov[k];
  rec.date_iso = rec.date ? parseDate(rec.date) : null;
  rec.recipient_list = recipientNames(meta, auto.recipients);
  rec.auto = auto;
  rec.overridden = keys.filter((k) => ov[k] !== undefined && ov[k] !== null).sort();
  return rec;
}

/** One Conduct Log row per recipient. */
export function sheetRows(rec, settings, roster) {
  const labels = settings.form_type_labels || {};
  const pn = rec.pos_neg || "";
  const pnLabel = pn === "Pos" ? settings.pos_label || "Pos" : pn === "Neg" ? settings.neg_label || "Neg" : pn;
  const names = rec.recipient_list?.length ? rec.recipient_list : [""];
  const years = String(rec.class_year || "").split(",").map(collapse);
  const manual = cdnaApplies(rec.form_type, pn);
  return names.map((name, i) => {
    let cy;
    if (names.length === 1) cy = collapse(rec.class_year);
    else if (years.length === names.length) cy = years[i] || roster.get(nameKey(name)) || ""; // as collected when the list was typed
    else cy = roster.get(nameKey(name)) || "";
    return [
      rec.date_iso || rec.date || "",
      cy,
      labels[rec.form_type] ?? rec.form_type ?? "",
      rec.reason_category || "",
      rec.reason_details || "", // always the full text
      monthLabel(rec.date_iso, settings.month_format || "name"),
      name,
      rec.issuer || "",
      pnLabel,
      ...MANUAL_POS_F10.map((k) => (manual ? String(rec[k] ?? "") : "")),
      ...SANCTION_FIELDS.map((k) => (rec.form_type === "F10" ? String(rec[k] ?? "") : "")),
      rec.other || "",
    ].map((c) => collapse(c).replace(/\t/g, " "));
  });
}

/** name key -> class year, learned from every form where it is unambiguous. */
export function buildRoster(metas) {
  const roster = new Map();
  for (const m of metas) {
    const f = effectiveFields(m);
    const names = recipientNames(m, singleName(f.recipient_name || ""));
    const raw = String(m.overrides?.class_year || f.class_year || "");
    const years = names.length > 1 ? raw.split(",").map(parseClassYear) : [parseClassYear(raw)];
    if (!names.length || years.length !== names.length) continue;
    names.forEach((n, i) => {
      if (/^20\d{2}$/.test(years[i] || "")) roster.set(nameKey(n), years[i]);
    });
  }
  return roster;
}

export function formTitle(ft) {
  const spec = FORM_TYPES[ft];
  return spec ? `${spec.title} · ${spec.subtitle}` : "Unknown form";
}
