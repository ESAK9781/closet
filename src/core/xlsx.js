// Just enough of .xlsx for the discipline sheet: read sheets by name, overwrite whole columns of an
// existing workbook in place (everything else in the file is kept byte for byte), and write a new
// workbook. No spreadsheet dependency: an .xlsx is a zip of XML, and backup.js already speaks zip.

import fs from "node:fs";
import path from "node:path";

import { openZip, ZipWriter } from "./backup.js";

const MAX_BYTES = 50 * 1024 * 1024;
const MAX_ROWS = 100000;

const unxml = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_m, e) => {
  if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[e.toLowerCase()];
});
const xml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const attr = (s, n) => new RegExp(`(?:^|\\s)${n}="([^"]*)"`).exec(s)?.[1];
const textOf = (x) => [...x.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unxml(m[1])).join("");

export const colLetter = (i) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
export const colIndex = (ref) => [...ref.replace(/\d+$/, "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** A header compared loosely: case, spacing and punctuation don't matter. */
export const normHeader = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Excel's day 1 is 1900-01-01 and it counts 1900 as a leap year, so day 61 onward is offset by one.
export function isoToSerial(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return null;
  const days = Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000);
  return days > 0 ? days : null;
}
export function serialToIso(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 1 || v > 100000) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000).toISOString().slice(0, 10);
}

// --------------------------------------------------------------------------- workbook structure

function open(file) {
  if (fs.statSync(file).size > MAX_BYTES) throw new Error("That workbook is too large");
  const zip = openZip(file);
  const names = zip.entries.map((e) => e.name);
  const byName = new Map(zip.entries.map((e) => [e.name, e]));
  const get = (n) => (byName.has(n) ? zip.read(byName.get(n)).toString("utf8") : null);
  return { zip, names, byName, get };
}

const resolveTarget = (base, target) => {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
};

/** [{ name, path }] in tab order. */
function sheetList(wb) {
  const book = wb.get("xl/workbook.xml");
  const rels = wb.get("xl/_rels/workbook.xml.rels");
  if (!book || !rels) throw new Error("That doesn't look like an Excel workbook");
  const targets = new Map([...rels.matchAll(/<Relationship\b([^>]*?)\/?>/g)].map((m) => [attr(m[1], "Id"), attr(m[1], "Target")]));
  return [...book.matchAll(/<sheet\b([^>]*?)\/?>/g)].map((m) => {
    const t = targets.get(attr(m[1], "r:id"));
    return { name: unxml(attr(m[1], "name") || ""), path: t ? resolveTarget("xl/workbook.xml", t) : null };
  }).filter((s) => s.path);
}

const ROW_RE = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
const CELL_RE = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;

/** Every sheet as { name, rows: Map<row number, string[]> }; values are the cell text (dates stay as Excel serials). */
export function readWorkbook(file) {
  const wb = open(file);
  try {
    const shared = [...(wb.get("xl/sharedStrings.xml") || "").matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
    return sheetList(wb).map(({ name, path: p }) => {
      const rows = new Map();
      const x = wb.get(p) || "";
      for (const r of x.matchAll(ROW_RE)) {
        const num = Number(attr(r[1], "r"));
        if (!num || !r[2]) continue;
        if (rows.size > MAX_ROWS) throw new Error("That sheet has too many rows");
        const cells = [];
        for (const c of r[2].matchAll(CELL_RE)) {
          const ref = attr(c[1], "r");
          if (!ref) continue;
          const type = attr(c[1], "t");
          const inner = c[2] || "";
          const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
          let val = "";
          if (type === "s") val = shared[Number(v)] ?? "";
          else if (type === "inlineStr") val = textOf(inner);
          else if (type === "e") val = "";
          else if (v !== undefined) val = unxml(v);
          cells[colIndex(ref)] = val;
        }
        rows.set(num, Array.from(cells, (v) => v ?? ""));
      }
      return { name, rows };
    });
  } finally {
    wb.zip.close();
  }
}

// --------------------------------------------------------------------------- overwriting columns

/**
 * Overwrite whole columns of one or more sheets. Each edit:
 *   { sheet, headerRow, columns: [{ header, values }] }
 * A column is found by its heading in the header row (appended to the right when it isn't there).
 * `values` replace everything under the heading; cells in other columns are left alone. Values are
 * a string, a number, a { date: serial }, or null. Styles come from the first data row so the sheet
 * keeps its look. Returns [{ sheet, rows, added }].
 */
export function patchWorkbook(file, edits, { out = file } = {}) {
  const wb = open(file);
  const files = new Map();
  const report = [];
  try {
    for (const n of wb.names) files.set(n, wb.zip.read(wb.byName.get(n)));
  } finally {
    wb.zip.close();
  }
  const text = (n) => (files.has(n) ? files.get(n).toString("utf8") : null);
  const wbView = { get: text };
  const sheets = sheetList(wbView);

  for (const edit of edits) {
    const sh = sheets.find((s) => s.name.toLowerCase() === String(edit.sheet).toLowerCase());
    if (!sh) throw new Error(`The workbook has no sheet called “${edit.sheet}” (it has ${sheets.map((s) => `“${s.name}”`).join(", ")}). Change the sheet name in Settings or add the sheet.`);
    report.push(patchSheet(files, text, sh, edit));
  }

  // cached results and the calculation chain are stale after an edit: have Excel rebuild them
  files.delete("xl/calcChain.xml");
  const ct = text("[Content_Types].xml");
  if (ct) files.set("[Content_Types].xml", Buffer.from(ct.replace(/<Override\b[^>]*calcChain[^>]*\/>/g, "")));
  const rels = text("xl/_rels/workbook.xml.rels");
  if (rels) files.set("xl/_rels/workbook.xml.rels", Buffer.from(rels.replace(/<Relationship\b[^>]*calcChain[^>]*\/>/g, "")));
  let book = text("xl/workbook.xml");
  if (/<calcPr\b/.test(book)) book = book.replace(/<calcPr\b([^>]*?)(\/?)>/, (m, a, s) => (/fullCalcOnLoad/.test(a) ? m : `<calcPr${a} fullCalcOnLoad="1"${s}>`));
  else book = book.replace(/(<extLst\b|<\/workbook>)/, '<calcPr fullCalcOnLoad="1"/>$1');
  files.set("xl/workbook.xml", Buffer.from(book));

  const tmp = `${out}.closet-tmp`;
  const w = new ZipWriter(tmp);
  try {
    for (const [name, data] of files) w.add(name, data);
    w.close();
  } catch (e) {
    w.abort();
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  replaceFile(tmp, out);
  return report;
}

function replaceFile(tmp, dest) {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, dest);
      return;
    } catch (e) {
      if (attempt >= 4 || !["EPERM", "EBUSY", "EACCES"].includes(e.code)) {
        fs.rmSync(tmp, { force: true });
        if (["EPERM", "EBUSY", "EACCES"].includes(e.code)) throw new Error("The workbook is open in another program (Excel?) or is read-only. Close it and try again. Nothing was changed.");
        throw e;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
    }
  }
}

function patchSheet(files, text, sh, edit) {
  const src = text(sh.path);
  if (src === null) throw new Error(`Couldn't read the sheet “${sh.name}”`);
  const m = /<sheetData\s*\/>|<sheetData>([\s\S]*?)<\/sheetData>/.exec(src);
  if (!m) throw new Error(`The sheet “${sh.name}” has no data section`);
  const rows = new Map(); // row number -> { attrs, cells: Map<col, { s, xml }> }
  for (const r of (m[1] || "").matchAll(ROW_RE)) {
    const num = Number(attr(r[1], "r"));
    if (!num) continue;
    const cells = new Map();
    for (const c of (r[2] || "").matchAll(CELL_RE)) {
      const ref = attr(c[1], "r");
      if (ref) cells.set(colIndex(ref), { s: attr(c[1], "s") ?? null, xml: c[0], ref });
    }
    rows.set(num, { attrs: r[1].replace(/\s*\/$/, "").replace(/\sspans="[^"]*"/, ""), cells });
  }

  const hr = edit.headerRow;
  const headerCells = rows.get(hr)?.cells || new Map();
  const sharedStrings = (text("xl/sharedStrings.xml") || "");
  const sst = [...sharedStrings.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((x) => textOf(x[1]));
  const cellText = (c) => {
    if (!c) return "";
    const type = attr(c.xml.match(/<c\b([^>]*)/)[1], "t");
    const v = /<v>([\s\S]*?)<\/v>/.exec(c.xml)?.[1];
    if (type === "s") return sst[Number(v)] ?? "";
    if (type === "inlineStr") return textOf(c.xml);
    return v === undefined ? "" : unxml(v);
  };
  const headers = new Map(); // normalised heading -> column
  for (const [col, c] of headerCells) { const h = normHeader(cellText(c)); if (h && !headers.has(h)) headers.set(h, col); }

  const wanted = edit.columns.map((c) => normHeader(c.header));
  const below = [...rows.keys()].some((n) => n > hr && [...rows.get(n).cells.values()].some((c) => cellText(c) !== ""));
  if (wanted.length && headers.size && !wanted.some((h) => headers.has(h))) {
    throw new Error(`Row ${hr} of “${sh.name}” has none of the column headings closet writes (${edit.columns.map((c) => `“${c.header}”`).join(", ")}). Check the header row number in Settings. Nothing was changed.`);
  }
  if (!headers.size && below) {
    throw new Error(`Row ${hr} of “${sh.name}” is empty but the sheet has data below it. Check the header row number in Settings. Nothing was changed.`);
  }

  let next = headers.size ? Math.max(...headers.values()) + 1 : 0;
  const added = [];
  const hrow = rows.get(hr) || (rows.set(hr, { attrs: `r="${hr}"`, cells: new Map() }), rows.get(hr));
  const cols = edit.columns.map((c) => {
    let col = headers.get(normHeader(c.header));
    if (col === undefined) {
      col = next++;
      const left = hrow.cells.get(col - 1);
      hrow.cells.set(col, { s: left?.s ?? null, xml: cellXml(col, hr, c.header, left?.s ?? null), ref: colLetter(col) + hr });
      added.push(c.header);
    }
    return { col, values: c.values };
  });

  const n = Math.max(0, ...cols.map((c) => c.values.length));
  const last = Math.max(hr, ...rows.keys());
  const styleFor = (col) => {
    for (let r = hr + 1; r <= Math.min(last, hr + 6); r++) { const s = rows.get(r)?.cells.get(col)?.s; if (s) return s; }
    return null;
  };
  for (const { col, values } of cols) {
    const style = styleFor(col);
    for (let r = hr + 1; r <= Math.max(last, hr + n); r++) {
      const v = values[r - hr - 1];
      const row = rows.get(r) || (rows.set(r, { attrs: `r="${r}"`, cells: new Map() }), rows.get(r));
      const blank = v === null || v === undefined || v === "";
      if (blank) {
        if (style && r <= last) row.cells.set(col, { s: style, xml: `<c r="${colLetter(col)}${r}" s="${style}"/>` });
        else row.cells.delete(col);
      } else {
        row.cells.set(col, { s: style, xml: cellXml(col, r, v, style) });
      }
    }
  }

  const body = [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => {
    const cells = [...row.cells.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c.xml).join("");
    return cells ? `<row ${row.attrs.trim()}>${cells}</row>` : `<row ${row.attrs.trim()}/>`;
  }).join("");
  const out = src.slice(0, m.index).replace(/<dimension\b[^>]*\/>/, "") + `<sheetData>${body}</sheetData>` + src.slice(m.index + m[0].length);
  files.set(sh.path, Buffer.from(out));

  // a table over the data has to grow or shrink with it, or Excel offers to repair the file
  const relsName = sh.path.replace(/([^/]+)$/, "_rels/$1.rels");
  for (const rel of (text(relsName) || "").matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const t = attr(rel[1], "Target");
    if (!t || !/table/i.test(attr(rel[1], "Type") || "")) continue;
    const tp = resolveTarget(sh.path, t);
    const tx = text(tp);
    const ref = tx && /<table\b[^>]*?\sref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/.exec(tx);
    if (!ref || Number(ref[2]) !== hr) continue;
    const end = hr + Math.max(1, n);
    files.set(tp, Buffer.from(tx.replace(/(<table\b[^>]*?\sref=")[^"]*(")/, `$1${ref[1]}${hr}:${ref[3]}${end}$2`).replace(/(<autoFilter\b[^>]*?\sref=")[^"]*(")/, `$1${ref[1]}${hr}:${ref[3]}${end}$2`)));
  }
  return { sheet: sh.name, rows: n, added };
}

function cellXml(col, row, v, style) {
  const ref = colLetter(col) + row;
  const s = style ? ` s="${style}"` : "";
  if (v && typeof v === "object" && "date" in v) return style ? `<c r="${ref}"${s}><v>${v.date}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${xml(serialToIso(v.date) || "")}</t></is></c>`;
  if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
}

// --------------------------------------------------------------------------- writing a new workbook

// Style slots a new workbook knows how to draw.
const XF = { plain: 0, title: 1, sub: 2, head: 3, kpiLabel: 4, kpi: 5, text: 6, num: 7, date: 8 };

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/></numFmts>
<fonts count="6">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="18"/><color rgb="FF1F2A44"/><name val="Calibri"/></font>
<font><sz val="11"/><color rgb="FF6B7386"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><b/><sz val="9"/><color rgb="FF4A5265"/><name val="Calibri"/></font>
<font><b/><sz val="16"/><color rgb="FF1F2A44"/><name val="Calibri"/></font>
</fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1F2A44"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFEEF1F6"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFD5D9E2"/></left><right style="thin"><color rgb="FFD5D9E2"/></right><top style="thin"><color rgb="FFD5D9E2"/></top><bottom style="thin"><color rgb="FFD5D9E2"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="9">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="5" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/**
 * A new workbook. Each sheet: { name, widths?: number[], freeze?: row, filter?: "A1:O301", validation?: [{ sqref, list }],
 * cells: [{ r, c, v?, f?, s? }] } where r is 1-based, c 0-based, v a string/number, f a formula, s a key of XF.
 */
export function writeWorkbook(file, sheets) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.closet-tmp`;
  const w = new ZipWriter(tmp);
  const add = (n, s) => w.add(n, Buffer.from(s));
  try {
    add("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`);
    add("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
    add("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets><calcPr calcId="191028" fullCalcOnLoad="1"/></workbook>`);
    add("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
    add("xl/styles.xml", STYLES);
    sheets.forEach((s, i) => add(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)));
    w.close();
  } catch (e) {
    w.abort();
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  replaceFile(tmp, file);
}

function sheetXml(s) {
  const byRow = new Map();
  for (const c of s.cells) {
    if (!byRow.has(c.r)) byRow.set(c.r, []);
    byRow.get(c.r).push(c);
  }
  const rows = [...byRow.entries()].sort((a, b) => a[0] - b[0]).map(([r, cells]) => {
    const body = cells.sort((a, b) => a.c - b.c).map((c) => {
      const ref = colLetter(c.c) + c.r;
      const st = c.s && c.s !== "plain" ? ` s="${XF[c.s]}"` : "";
      if (c.f) return `<c r="${ref}"${st}><f>${xml(c.f)}</f></c>`;
      if (typeof c.v === "number") return `<c r="${ref}"${st}><v>${c.v}</v></c>`;
      if (c.v === undefined || c.v === null || c.v === "") return `<c r="${ref}"${st}/>`;
      return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${xml(c.v)}</t></is></c>`;
    }).join("");
    const ht = s.rowHeights?.[r];
    return `<row r="${r}"${ht ? ` ht="${ht}" customHeight="1"` : ""}>${body}</row>`;
  }).join("");
  const pane = s.freeze ? `<pane ySplit="${s.freeze}" topLeftCell="A${s.freeze + 1}" activePane="bottomLeft" state="frozen"/>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" showGridLines="${s.grid === false ? 0 : 1}">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${s.widths ? `<cols>${s.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : ""}<sheetData>${rows}</sheetData>${s.filter ? `<autoFilter ref="${s.filter}"/>` : ""}${s.validation?.length ? `<dataValidations count="${s.validation.length}">${s.validation.map((v) => `<dataValidation type="list" allowBlank="1" showErrorMessage="0" sqref="${v.sqref}"><formula1>"${xml(v.list.join(","))}"</formula1></dataValidation>`).join("")}</dataValidations>` : ""}</worksheet>`;
}
