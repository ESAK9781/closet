// Reading a spreadsheet of names and emails (CSV, TSV or XLSX) into { name, email } pairs.
//
// No column layout is assumed. Every email address is found with a regex, wherever it sits, and the
// cells to its left are scored to pick the name that goes with it. XLSX is read with the zip reader
// the backup code already has, so there is no spreadsheet dependency.

import fs from "node:fs";
import path from "node:path";

import { openZip } from "./backup.js";
import { nameParts } from "./people.js";
import { collapse } from "./records.js";

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_ROWS = 20000;
export const EMAIL_RE = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}/g;
const EMAIL_ONE = new RegExp(EMAIL_RE.source);
export const isEmail = (s) => /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(String(s || "").trim()) && String(s).length <= 254;

// --------------------------------------------------------------------------- reading files

/** RFC 4180-ish: quoted cells may hold the delimiter, quotes ("" -> ") and line breaks. */
export function parseDelimited(text, delim) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const endCell = () => { row.push(cell); cell = ""; };
  const endRow = () => { endCell(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += c;
    } else if (c === '"' && !cell) quoted = true;
    else if (c === delim) endCell();
    else if (c === "\n") endRow();
    else if (c !== "\r") cell += c;
    if (rows.length > MAX_ROWS) throw new Error("That spreadsheet has too many rows");
  }
  if (cell || row.length) endRow();
  return rows;
}

const unxml = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_m, e) => {
  if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[e.toLowerCase()];
});
const textOf = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unxml(m[1])).join("");
const colIndex = (ref) => [...ref.replace(/\d+$/, "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** Every sheet of an .xlsx as arrays of rows of strings. */
export function readXlsx(file) {
  const zip = openZip(file);
  try {
    const byName = new Map(zip.entries.map((e) => [e.name, e]));
    const get = (n) => (byName.has(n) ? zip.read(byName.get(n)).toString("utf8") : "");
    const shared = [...get("xl/sharedStrings.xml").matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
    const sheets = zip.entries.map((e) => e.name).filter((n) => /^xl\/worksheets\/[^/]+\.xml$/.test(n)).sort();
    if (!sheets.length) throw new Error("That workbook has no sheets");
    return sheets.map((name) => {
      const rows = [];
      const xml = get(name);
      for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
        const cells = [];
        for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const ref = /\br="([A-Z]+\d+)"/.exec(c[1]);
          const type = /\bt="([^"]+)"/.exec(c[1])?.[1];
          const inner = c[2] || "";
          const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
          let val = "";
          if (type === "s") val = shared[Number(v)] ?? "";
          else if (type === "inlineStr") val = textOf(inner);
          else if (v !== undefined) val = unxml(v);
          if (ref) cells[colIndex(ref[1])] = val;
          else cells.push(val);
        }
        rows.push(Array.from(cells, (x) => x ?? ""));
        if (rows.length > MAX_ROWS) throw new Error("That spreadsheet has too many rows");
      }
      return rows;
    });
  } finally {
    zip.close();
  }
}

/** A spreadsheet file -> a list of sheets, each a list of rows of strings. */
export function readSpreadsheet(file) {
  const ext = path.extname(file).toLowerCase();
  const st = fs.statSync(file);
  if (st.size > MAX_BYTES) throw new Error("That file is too large to be a contact list");
  if (ext === ".xlsx" || ext === ".xlsm") {
    try {
      return readXlsx(file);
    } catch (e) {
      throw new Error(`Couldn't read that workbook (${e.message}). Try saving it as a CSV from your spreadsheet program.`);
    }
  }
  if (ext === ".xls") throw new Error("Older .xls files can't be read. In your spreadsheet program, use Save As and choose .xlsx or .csv.");
  let text = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  if (text.includes("\u0000")) throw new Error("That doesn't look like a CSV or text file");
  const first = text.split("\n", 1)[0];
  const delim = ext === ".tsv" || (first.split("\t").length > first.split(",").length) ? "\t" : first.split(";").length > first.split(",").length ? ";" : ",";
  return [parseDelimited(text, delim)];
}

// --------------------------------------------------------------------------- finding pairs

/** How much a cell looks like a person's name: 0 means not at all. */
function nameLikeness(cell) {
  const s = collapse(cell);
  if (!s || s.length > 60 || EMAIL_ONE.test(s) || /^[\d\s.,()+\-/:]+$/.test(s)) return 0;
  const p = nameParts(s);
  if (!p.core.length || p.core.length > 5) return 0;
  if (/\b(name|email|e-mail|mail|address|phone|class|year|squadron|flight|rank|grade|title|position|notes?|cadet|id|dod)\b/i.test(s) && p.core.length <= 2 && s.length < 14) return 0; // a header
  let score = p.core.length >= 2 ? 3 : 1;
  if (/^[A-Za-z][A-Za-z'’.\-\s,]*$/.test(s)) score += 1;
  if (/^[A-Z]/.test(s)) score += 0.5;
  return score;
}

/** "john.doe@x.edu" -> "John Doe", only when the address really does spell out a name. */
function nameFromAddress(email) {
  const local = email.split("@")[0].replace(/\d+$/, "");
  const bits = local.split(/[._-]+/).filter((b) => /^[A-Za-z]{2,}$/.test(b));
  return bits.length >= 2 && bits.length <= 3 ? bits.map((b) => b[0].toUpperCase() + b.slice(1).toLowerCase()).join(" ") : "";
}

/**
 * Pull { name, email } pairs out of rows of cells. Each email is located by regex; then the cells to
 * its left (nearest first) are candidates for the name, either alone or as two adjacent cells
 * ("John" | "Doe"). `known` (names already on file) breaks ties: a candidate that resembles
 * someone we know wins over one that merely looks like a name.
 */
export function extractContacts(sheets, { known = [], similarity = () => 3 } = {}) {
  const found = [];
  const seen = new Set();
  let rowsWithEmail = 0;
  for (const rows of sheets) {
    const header = (col, upto) => {
      for (let r = upto - 1; r >= 0; r--) {
        const cells = rows[r] || [];
        if (cells.some((c) => EMAIL_ONE.test(c || ""))) continue;
        if (collapse(cells[col])) return collapse(cells[col]).toLowerCase();
      }
      return "";
    };
    rows.forEach((cells, r) => {
      let any = false;
      cells.forEach((cell, c) => {
        const text = String(cell ?? "");
        const emails = text.match(EMAIL_RE) || [];
        for (const raw of emails) {
          any = true;
          const email = raw.replace(/^['.]+|[.']+$/g, "").toLowerCase();
          if (!isEmail(email) || seen.has(email)) continue;
          seen.add(email);
          // "Jane Doe <jane@x.edu>" in one cell
          let name = collapse(text.replace(raw, " ").replace(/[<>"();,]/g, " ").replace(EMAIL_RE, " "));
          let source = name && nameLikeness(name) ? "cell" : "";
          if (!source) name = "";
          if (!name) {
            const cands = [];
            const left = [];
            for (let k = c - 1; k >= 0 && left.length < 4; k--) if (collapse(cells[k])) left.push({ k, text: collapse(cells[k]) });
            left.forEach((l, i) => {
              const base = nameLikeness(l.text);
              if (base) cands.push({ name: l.text, score: base - i * 0.6, cols: [l.k] });
              const next = left[i + 1];
              if (next && l.k - next.k === 1 && nameLikeness(l.text) && nameLikeness(next.text)
                && !/\s/.test(l.text) && !/\s/.test(next.text)) {
                const lastFirst = /last|sur|family/.test(header(next.k, r)) && /first|given/.test(header(l.k, r));
                const joined = lastFirst ? `${l.text} ${next.text}` : `${next.text} ${l.text}`;
                cands.push({ name: joined, score: 4.5 - i * 0.6, cols: [next.k, l.k] });
              }
            });
            for (const cand of cands) {
              const d = known.length ? Math.min(...known.map((k) => similarity(cand.name, k))) : 3;
              if (d <= 2) cand.score += 6 - d;
            }
            cands.sort((a, b) => b.score - a.score);
            name = cands[0]?.name || "";
            source = name ? "left" : "";
          }
          let guessed = false;
          if (!name) {
            name = nameFromAddress(email);
            guessed = Boolean(name);
          }
          found.push({ name, email, guessed, row: r + 1 });
        }
      });
      if (any) rowsWithEmail++;
    });
  }
  return { pairs: found, rows_with_email: rowsWithEmail };
}
