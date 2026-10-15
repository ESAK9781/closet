// Can a PDF actually be signed (or initialed) where a routing step needs it, in Adobe?
//
// Sync pushes copies out for people to sign in Acrobat/Reader. A copy can show a signature box and
// still refuse to sign: the box may be a plain text field, read-only, hidden, already holding a
// (blank) signature value, missing from the form's field list, shared between merged copies, or
// locked by an earlier signature; or the document may forbid it (security settings, certification,
// Reader rights broken by a later edit, an XFA layer, a damaged cross-reference table). This reads
// the PDF's own structure with pdf-lib and checks every one of those.
//
// addField() puts a fresh field on top of the spot as an *incremental update*: the original bytes
// are kept as they are and the change is appended, so signatures already on the form stay valid.

import zlib from "node:zlib";

import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFString, StandardFonts } from "pdf-lib";

const N = (s) => PDFName.of(s);
export const FIELD_PREFIX = "closet "; // fields closet adds are named "closet <step> <n>"

// --------------------------------------------------------------------------- file structure

function lastStartxref(buf) {
  const tail = buf.subarray(Math.max(0, buf.length - 4096)).toString("latin1");
  const m = [...tail.matchAll(/startxref\s+(\d+)/g)].at(-1);
  return m ? Number(m[1]) : null;
}

// Offsets may point at whitespace just before "N G obj"; readers (Adobe included) accept that.
const objAt = (buf, off) => /^\s{0,4}(\d+)\s+(\d+)\s+obj\b/.exec(buf.subarray(off, off + 48).toString("latin1"));

function checkTable(buf, off, problems) {
  const end = buf.indexOf("trailer", off, "latin1");
  if (end < 0) {
    problems.push(`cross-reference table at ${off} has no trailer`);
    return {};
  }
  const tok = buf.subarray(off, end).toString("latin1").trim().split(/\s+/).slice(1);
  let bad = 0;
  let checked = 0;
  for (let i = 0; i + 1 < tok.length;) {
    const start = Number(tok[i]);
    const count = Number(tok[i + 1]);
    if (!Number.isInteger(start) || !Number.isInteger(count)) {
      problems.push(`cross-reference table at ${off} is malformed`);
      return {};
    }
    i += 2;
    for (let k = 0; k < count; k++, i += 3) {
      if (tok[i + 2] === undefined) {
        problems.push(`cross-reference table at ${off} is cut short`);
        return {};
      }
      if (tok[i + 2] !== "n") continue;
      const at = Number(tok[i]);
      if (!at) continue;
      checked++;
      const m = objAt(buf, at);
      if (!m || Number(m[1]) !== start + k) bad++;
    }
  }
  if (bad) problems.push(`${bad} of ${checked} objects aren't where the cross-reference table says`);
  const trailer = buf.subarray(end, Math.min(buf.length, end + 4096)).toString("latin1");
  const dict = trailer.slice(0, trailer.indexOf("startxref") >= 0 ? trailer.indexOf("startxref") : undefined);
  const stm = /\/XRefStm\s+(\d+)/.exec(dict);
  if (stm) checkStream(buf, Number(stm[1]), problems);
  const prev = /\/Prev\s+(\d+)/.exec(dict);
  return { prev: prev ? Number(prev[1]) : null };
}

function unpredict(data, columns) {
  const row = columns + 1;
  const out = Buffer.alloc(Math.floor(data.length / row) * columns);
  const prior = Buffer.alloc(columns);
  for (let r = 0; r * row < data.length - columns; r++) {
    const ft = data[r * row];
    const line = data.subarray(r * row + 1, r * row + row);
    const cur = out.subarray(r * columns, r * columns + columns);
    for (let i = 0; i < columns; i++) {
      const left = i ? cur[i - 1] : 0; // xref-stream predictors work on 1-byte "pixels"
      const up = prior[i];
      const ul = i ? prior[i - 1] : 0;
      let v = line[i];
      if (ft === 1) v += left;
      else if (ft === 2) v += up;
      else if (ft === 3) v += (left + up) >> 1;
      else if (ft === 4) {
        const p = left + up - ul;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - ul);
        v += pa <= pb && pa <= pc ? left : pb <= pc ? up : ul;
      }
      cur[i] = v & 255;
    }
    cur.copy(prior);
  }
  return out;
}

function checkStream(buf, off, problems) {
  const head = objAt(buf, off);
  const s = buf.indexOf("stream", off, "latin1");
  if (!head || s < 0) {
    problems.push(`no cross-reference stream at ${off}`);
    return {};
  }
  const dict = buf.subarray(off, s).toString("latin1");
  if (!/\/Type\s*\/XRef/.test(dict)) {
    problems.push(`object at ${off} isn't a cross-reference stream`);
    return {};
  }
  let a = s + 6;
  if (buf[a] === 13) a++;
  if (buf[a] === 10) a++;
  const e = buf.indexOf("endstream", a, "latin1");
  const len = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
  let raw = buf.subarray(a, len ? a + Number(len[1]) : e);
  let data;
  try {
    data = /\/FlateDecode/.test(dict) ? zlib.inflateSync(raw, { finishFlush: zlib.constants.Z_SYNC_FLUSH }) : raw;
  } catch {
    problems.push(`cross-reference stream at ${off} can't be decompressed`);
    return {};
  }
  const pred = /\/Predictor\s+(\d+)/.exec(dict);
  const w = /\/W\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(dict);
  if (!w) {
    problems.push(`cross-reference stream at ${off} has no /W`);
    return {};
  }
  const W = [Number(w[1]), Number(w[2]), Number(w[3])];
  const rowLen = W[0] + W[1] + W[2];
  if (pred && Number(pred[1]) >= 10) {
    const cols = Number(/\/Columns\s+(\d+)/.exec(dict)?.[1] || 1);
    data = unpredict(data, cols);
  }
  const size = Number(/\/Size\s+(\d+)/.exec(dict)?.[1] || 0);
  const idx = /\/Index\s*\[([\d\s]*)\]/.exec(dict);
  const ranges = idx ? idx[1].trim().split(/\s+/).map(Number) : [0, size];
  const field = (p, n, dflt) => {
    if (!n) return dflt;
    let v = 0;
    for (let i = 0; i < n; i++) v = v * 256 + data[p + i];
    return v;
  };
  let p = 0;
  let bad = 0;
  let checked = 0;
  for (let r = 0; r + 1 < ranges.length; r += 2) {
    for (let k = 0; k < ranges[r + 1]; k++, p += rowLen) {
      if (p + rowLen > data.length) {
        problems.push(`cross-reference stream at ${off} is cut short`);
        return {};
      }
      const type = field(p, W[0], 1);
      if (type !== 1) continue;
      const at = field(p + W[0], W[1], 0);
      checked++;
      const m = objAt(buf, at);
      if (!m || Number(m[1]) !== ranges[r] + k) bad++;
    }
  }
  if (bad) problems.push(`${bad} of ${checked} objects aren't where the cross-reference stream says`);
  const prev = /\/Prev\s+(\d+)/.exec(dict);
  return { prev: prev ? Number(prev[1]) : null };
}

/**
 * Walk every cross-reference section (newest first, following /Prev) and confirm each in-use entry
 * points at the object it names. Adobe silently "repairs" files that fail this, and a repaired file
 * can refuse to be signed (signing appends to the file as it is on disk).
 */
export function xrefHealth(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const problems = [];
  const start = lastStartxref(buf);
  if (start === null) return { ok: false, kind: null, startxref: null, problems: ["no startxref at the end of the file"] };
  let kind = null;
  const seen = new Set();
  for (let off = start, hops = 0; off !== null && off !== undefined && hops < 64; hops++) {
    if (seen.has(off)) {
      problems.push("cross-reference sections loop");
      break;
    }
    seen.add(off);
    if (off >= buf.length) {
      problems.push(`cross-reference offset ${off} is past the end of the file`);
      break;
    }
    let r;
    if (/^\s{0,4}xref\b/.test(buf.subarray(off, off + 12).toString("latin1"))) {
      kind ??= "table";
      r = checkTable(buf, off, problems);
    } else if (objAt(buf, off)) {
      kind ??= "stream";
      r = checkStream(buf, off, problems);
    } else {
      problems.push(`nothing readable at cross-reference offset ${off}`);
      break;
    }
    off = r.prev;
  }
  return { ok: !problems.length, kind, startxref: start, problems };
}

// --------------------------------------------------------------------------- geometry

/** pdf.js's page view: CropBox clipped to MediaBox, plus /Rotate. */
function pageGeometry(node) {
  const box = (a) => {
    if (!(a instanceof PDFArray) || a.size() < 4) return null;
    const v = a.asArray().map((x) => (x instanceof PDFNumber ? x.asNumber() : 0));
    return [Math.min(v[0], v[2]), Math.min(v[1], v[3]), Math.max(v[0], v[2]), Math.max(v[1], v[3])];
  };
  const media = box(node.MediaBox()) || [0, 0, 612, 792];
  const crop = box(node.CropBox()) || media;
  const view = [Math.max(crop[0], media[0]), Math.max(crop[1], media[1]), Math.min(crop[2], media[2]), Math.min(crop[3], media[3])];
  if (view[2] <= view[0] || view[3] <= view[1]) view.splice(0, 4, ...media);
  let rot = ((node.Rotate()?.asNumber() || 0) % 360 + 360) % 360;
  if (rot % 90) rot = 0;
  const [a, b, c, d] = { 0: [1, 0, 0, -1], 90: [0, 1, 1, 0], 180: [-1, 0, 0, 1], 270: [0, -1, -1, 0] }[rot];
  const vw = view[2] - view[0];
  const vh = view[3] - view[1];
  const [W, H] = rot % 180 ? [vh, vw] : [vw, vh];
  return { view, a, b, c, d, W, H, cx: (view[0] + view[2]) / 2, cy: (view[1] + view[3]) / 2 };
}

/** PDF user-space rect -> top-left normalized rect, exactly as the parser's viewport sees it. */
function toNorm(g, r) {
  const pt = (x, y) => [g.a * (x - g.cx) + g.c * (y - g.cy) + g.W / 2, g.b * (x - g.cx) + g.d * (y - g.cy) + g.H / 2];
  const [x0, y0] = pt(r[0], r[1]);
  const [x1, y1] = pt(r[2], r[3]);
  return [Math.min(x0, x1) / g.W, Math.min(y0, y1) / g.H, Math.max(x0, x1) / g.W, Math.max(y0, y1) / g.H];
}

/** The inverse (each rotation matrix here is its own inverse). */
function toUser(g, n) {
  const pt = (vx, vy) => {
    const dx = vx - g.W / 2;
    const dy = vy - g.H / 2;
    return [g.a * dx + g.c * dy + g.cx, g.b * dx + g.d * dy + g.cy];
  };
  const [x0, y0] = pt(n[0] * g.W, n[1] * g.H);
  const [x1, y1] = pt(n[2] * g.W, n[3] * g.H);
  return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
}

const iou = (p, q) => {
  const ix = Math.max(0, Math.min(p[2], q[2]) - Math.max(p[0], q[0]));
  const iy = Math.max(0, Math.min(p[3], q[3]) - Math.max(p[1], q[1]));
  const inter = ix * iy;
  const area = (r) => Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]);
  return inter / Math.max(1e-9, area(p) + area(q) - inter);
};
const centerIn = (p, q) => {
  const cx = (p[0] + p[2]) / 2;
  const cy = (p[1] + p[3]) / 2;
  return cx >= q[0] && cx <= q[2] && cy >= q[1] && cy <= q[3];
};

// --------------------------------------------------------------------------- object helpers

const num = (o) => (o instanceof PDFNumber ? o.asNumber() : null);
const text = (o) => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : o instanceof PDFName ? o.decodeText() : "");
const nums = (arr) => (arr instanceof PDFArray ? arr.asArray().map((x) => num(x) ?? 0) : null);

/** The field chain from a widget up to its root: [{ref, dict}], widget first. */
function chainOf(ctx, ref, dict) {
  const out = [{ ref, dict }];
  const seen = new Set([dict]);
  let cur = dict;
  for (let i = 0; i < 32; i++) {
    const pref = cur.get(N("Parent"));
    const parent = pref instanceof PDFRef ? ctx.lookup(pref) : pref;
    if (!(parent instanceof PDFDict) || seen.has(parent)) break;
    seen.add(parent);
    out.push({ ref: pref instanceof PDFRef ? pref : null, dict: parent });
    cur = parent;
  }
  return out;
}
const inherited = (chain, key) => {
  for (const { dict } of chain) {
    const v = dict.get(N(key));
    if (v !== undefined) return v;
  }
  return undefined;
};
const fqn = (chain) => chain.map(({ dict }) => text(dict.lookup(N("T")))).filter(Boolean).reverse().join(".");

/** Every terminal field reachable from AcroForm /Fields: { name, ftype, dict, widgets }. */
function formFields(ctx, af) {
  const out = [];
  const fields = af?.lookup(N("Fields"));
  if (!(fields instanceof PDFArray)) return out;
  const seen = new Set();
  const walk = (ref, prefix, ftIn, depth) => {
    const dict = ref instanceof PDFRef ? ctx.lookup(ref) : ref;
    if (!(dict instanceof PDFDict) || seen.has(dict) || depth > 32) return;
    seen.add(dict);
    const t = text(dict.lookup(N("T")));
    const name = t ? (prefix ? `${prefix}.${t}` : t) : prefix;
    const ft = dict.get(N("FT")) ?? ftIn;
    const kids = dict.lookup(N("Kids"));
    const kidDicts = kids instanceof PDFArray ? kids.asArray().map((k) => ({ ref: k, dict: k instanceof PDFRef ? ctx.lookup(k) : k })) : [];
    const fieldKids = kidDicts.filter((k) => k.dict instanceof PDFDict && k.dict.get(N("T")) !== undefined);
    if (fieldKids.length) {
      for (const k of fieldKids) walk(k.ref, name, ft, depth + 1);
      return;
    }
    const widgets = kidDicts.length ? kidDicts.filter((k) => k.dict instanceof PDFDict) : [{ ref, dict }];
    out.push({ name, ftype: ft instanceof PDFName ? ft.decodeText() : "", dict, widgets });
  };
  for (const r of fields.asArray()) walk(r, "", undefined, 0);
  return out;
}

function hasSignatureValue(v) {
  return v instanceof PDFDict && (v.has(N("ByteRange")) || v.has(N("Contents")));
}

/** Field names an applied signature has locked (FieldMDP), or "all". */
function signatureLocks(ctx, fields) {
  const names = new Set();
  let all = false;
  for (const f of fields) {
    if (f.ftype !== "Sig") continue;
    const v = f.dict.lookup(N("V"));
    if (!hasSignatureValue(v)) continue;
    const refs = v.lookup(N("Reference"));
    for (const r of refs instanceof PDFArray ? refs.asArray() : []) {
      const sr = r instanceof PDFRef ? ctx.lookup(r) : r;
      if (!(sr instanceof PDFDict) || text(sr.lookup(N("TransformMethod"))) !== "FieldMDP") continue;
      const tp = sr.lookup(N("TransformParams"));
      if (!(tp instanceof PDFDict)) continue;
      const action = text(tp.lookup(N("Action")));
      const listed = tp.lookup(N("Fields"));
      const list = listed instanceof PDFArray ? listed.asArray().map((x) => text(x instanceof PDFRef ? ctx.lookup(x) : x)) : [];
      if (action === "All") all = true;
      else if (action === "Include") list.forEach((n) => names.add(n));
      else if (action === "Exclude") for (const g of fields) if (!list.includes(g.name)) names.add(g.name);
    }
  }
  return { all, names };
}

function docMdpLevel(ctx, perms) {
  const sig = perms?.lookup(N("DocMDP"));
  if (!(sig instanceof PDFDict)) return null;
  const refs = sig.lookup(N("Reference"));
  for (const r of refs instanceof PDFArray ? refs.asArray() : []) {
    const sr = r instanceof PDFRef ? ctx.lookup(r) : r;
    if (sr instanceof PDFDict && text(sr.lookup(N("TransformMethod"))) === "DocMDP") {
      const tp = sr.lookup(N("TransformParams"));
      return (tp instanceof PDFDict ? num(tp.lookup(N("P"))) : null) ?? 2;
    }
  }
  return 2;
}

async function load(bytes) {
  return PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
}

// --------------------------------------------------------------------------- the check

/**
 * @param {Uint8Array} bytes the PDF
 * @param {object} target where the step's field should be
 * @param {number} target.page   PDF page index
 * @param {number[]} target.rect top-left normalized [x0, y0, x1, y1], as the parser reports slots
 * @param {"Signature"|"Text"} target.kind
 * @param {string} [target.fieldName] the field the parser matched there, if any
 * @returns {Promise<{ok: boolean, issues: {code: string, text: string, fixable: boolean}[], fixable: boolean, field: object|null}>}
 */
export async function inspect(bytes, target) {
  const issues = [];
  const add = (code, txt, fixable = true) => issues.push({ code, text: txt, fixable });
  let doc;
  try {
    doc = await load(bytes);
  } catch (e) {
    add("unreadable", `The PDF's structure can't be read (${e.message || e})`, false);
    return { ok: false, issues, fixable: false, field: null };
  }
  const ctx = doc.context;
  const cat = doc.catalog;
  const af = cat.lookup(N("AcroForm"));
  const fields = af instanceof PDFDict ? formFields(ctx, af) : [];
  const signed = fields.some((f) => f.ftype === "Sig" && hasSignatureValue(f.dict.lookup(N("V"))));
  let blocked = null; // why a field can't be added even though every problem is the fixable kind

  // ---- the document as a whole
  const health = xrefHealth(bytes);
  if (!health.ok) {
    add("damaged", `The file is damaged (${health.problems[0]}). Adobe repairs it when opening it and can then refuse to sign`, !signed);
  }
  const enc = ctx.lookup(ctx.trailerInfo.Encrypt);
  if (enc instanceof PDFDict) {
    const P = num(enc.lookup(N("P"))) ?? -1;
    const R = num(enc.lookup(N("R"))) ?? 2;
    const canFill = (P & 32) !== 0 || (R >= 3 && (P & 256) !== 0);
    if (!canFill) add("secured", "Its security settings don't allow filling in or signing", false);
    blocked = "It's encrypted, so closet can't add a field to it";
  }
  const perms = cat.lookup(N("Perms"));
  const mdp = docMdpLevel(ctx, perms instanceof PDFDict ? perms : null);
  if (mdp === 1) add("certified", "It's certified with no changes allowed, so nobody can sign it", false);
  else if (mdp !== null) blocked = "It's certified, and adding a field would break the certification";
  const ur = perms instanceof PDFDict ? perms.lookup(N("UR3")) ?? perms.lookup(N("UR")) : null;
  if (ur instanceof PDFDict) {
    const br = nums(ur.lookup(N("ByteRange")));
    if (!br || br.length < 4 || br[2] + br[3] !== bytes.length) {
      add("rights", "It carries Adobe Reader usage rights that were broken when it was edited outside Acrobat; Reader turns off signing for it");
    }
  }
  if (cat.lookup(N("NeedsRendering"))?.toString() === "true") add("dynamic-xfa", "It's a dynamic XFA form; Adobe draws its own form layer instead of these fields");
  else if (af instanceof PDFDict && af.has(N("XFA"))) add("xfa", "It has an XFA form layer as well as regular fields; Adobe uses the XFA layer, which can disagree with the fields");

  // ---- the field at the spot
  const pages = doc.getPages();
  const page = pages[target.page];
  if (target.page === null || target.page === undefined || !page) {
    add("no-page", "The page this field belongs on wasn't found in the PDF", false);
    return finish(issues, null, blocked);
  }
  const g = pageGeometry(page.node);
  const annots = page.node.lookup(N("Annots"));
  const widgets = [];
  for (const ref of annots instanceof PDFArray ? annots.asArray() : []) {
    const dict = ref instanceof PDFRef ? ctx.lookup(ref) : ref;
    if (!(dict instanceof PDFDict) || text(dict.lookup(N("Subtype"))) !== "Widget") continue;
    const r = nums(dict.lookup(N("Rect")));
    if (!r || r.length < 4) continue;
    const norm = toNorm(g, [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])]);
    widgets.push({ ref: ref instanceof PDFRef ? ref : null, dict, rect: r, norm, overlap: iou(norm, target.rect), inside: centerIn(norm, target.rect) || centerIn(target.rect, norm) });
  }
  // the topmost of the widgets that clearly cover the spot (later in /Annots = drawn on top and
  // clicked first), else the best overlap
  const near = widgets.filter((w) => w.overlap >= 0.5);
  let w = near.at(-1) || widgets.filter((x) => x.inside || x.overlap >= 0.25).sort((a, b) => b.overlap - a.overlap)[0];
  if (!w) {
    add("missing", target.kind === "Signature" ? "There's no signature field here" : "There's no fillable box here");
    return finish(issues, null, blocked);
  }
  const chain = chainOf(ctx, w.ref, w.dict);
  const name = fqn(chain);
  const ftObj = inherited(chain, "FT");
  const ft = ftObj instanceof PDFName ? ftObj.decodeText() : "";
  const field = { name, ftype: ft };
  if (!ft) add("not-a-field", "The box here is a drawing of a field, not a field Adobe can fill");
  else if (target.kind === "Signature" && ft !== "Sig") add("wrong-type", `The box here is a ${ft === "Tx" ? "text box" : "button or list"}, not a signature field`);
  else if (target.kind === "Text" && !["Tx", "Sig"].includes(ft)) add("wrong-type", "The box here is a button or list, not a box you can type initials in");

  const root = chain.at(-1);
  const listed = af instanceof PDFDict ? af.lookup(N("Fields")) : null;
  const inForm = listed instanceof PDFArray && listed.asArray().some((r) => (r instanceof PDFRef ? ctx.lookup(r) : r) === root.dict);
  if (!inForm) add("orphan", "The field isn't in the form's list of fields, so Adobe treats it as a drawing");

  const Ff = num(inherited(chain, "Ff")) ?? 0;
  if (Ff & 1) add("read-only", "The field is read-only (locked)");
  const F = num(w.dict.lookup(N("F"))) ?? 0;
  if (F & 2 || F & 32) add("hidden", "The field is hidden");
  if (F & 64) add("annot-read-only", "The field's box is marked read-only");
  const wPt = Math.abs(w.rect[2] - w.rect[0]);
  const hPt = Math.abs(w.rect[3] - w.rect[1]);
  if (wPt < 6 || hPt < 4) add("tiny", `The field is too small to use (${wPt.toFixed(1)} × ${hPt.toFixed(1)} pt)`);
  const P = w.dict.get(N("P"));
  if (P instanceof PDFRef && page.ref && (P.objectNumber !== page.ref.objectNumber || P.generationNumber !== page.ref.generationNumber)) {
    add("wrong-page", "The field says it belongs on a different page than the one it's drawn on");
  }

  const terminal = chain.find(({ dict }) => dict.get(N("T")) !== undefined)?.dict;
  if (ft === "Sig") {
    const v = terminal?.lookup(N("V")) ?? w.dict.lookup(N("V"));
    if (hasSignatureValue(v)) add("signed", "The field already holds a digital signature, so Adobe won't sign it again");
    else if (v instanceof PDFDict) add("blank-value", "The field holds an empty signature value, so Adobe treats it as already signed and won't sign it");
    else if (v !== undefined && v !== null && v.toString() !== "null") add("bad-value", "The field holds something that isn't a signature, so Adobe can't sign it");
    const kids = terminal?.lookup(N("Kids"));
    const nWidgets = kids instanceof PDFArray ? kids.size() : 1;
    if (nWidgets > 1) add("shared", `This one signature field has ${nWidgets} boxes (copies of the form merged together); Adobe can't sign a field like that`);
    if (name && fields.filter((f) => f.name === name).length > 1) add("duplicate-name", `Another field has the same name ("${name}"), so signing one would collide with the other`);
  }
  if (ft === "Tx") {
    const maxLen = num(inherited(chain, "MaxLen"));
    if (maxLen !== null && maxLen < 2) add("max-length", `The box only allows ${maxLen} character${maxLen === 1 ? "" : "s"}`);
    const da = inherited(chain, "DA") ?? (af instanceof PDFDict ? af.get(N("DA")) : undefined);
    if (!da) add("no-font", "The box has no font set, so Adobe may not show what's typed");
  }
  if (!name.startsWith(FIELD_PREFIX)) {
    const locks = signatureLocks(ctx, fields);
    if (name && (locks.all || locks.names.has(name))) add("locked", "An earlier signature locked this field");
  }
  const ap = w.dict.lookup(N("AP"));
  const n = ap instanceof PDFDict ? ap.lookup(N("N")) : null;
  if (n instanceof PDFRawStream) {
    try {
      decodePDFRawStream(n).decode();
    } catch {
      add("bad-appearance", "The field's drawing is corrupt; Adobe shows an error when it's clicked");
    }
  }
  return finish(issues, field, blocked);
}

function finish(issues, field, blocked) {
  return { ok: !issues.length, issues, fixable: issues.length > 0 && !blocked && issues.every((i) => i.fixable), blocked, field };
}

// --------------------------------------------------------------------------- the fix

function serialize(obj) {
  const b = new Uint8Array(obj.sizeInBytes());
  obj.copyBytesInto(b, 0);
  return Buffer.from(b);
}

/**
 * A copy of the PDF with a new, empty field covering the spot (a signature field, or a text box for
 * initials), on top of whatever is there. Also drops what would stop Adobe from signing anything
 * (an XFA layer, Reader usage rights that the change would break anyway). Written as an incremental
 * update so existing digital signatures stay valid; a damaged file with no signatures is rewritten
 * cleanly instead. Throws when it can't be done safely.
 *
 * @returns {Promise<{bytes: Buffer, name: string, mode: "incremental"|"rewrite"}>}
 */
/** Load a PDF for editing and set up change tracking; throws when it can't be edited safely. */
async function openPatch(bytes, what) {
  const buf = Buffer.from(bytes);
  const doc = await load(buf);
  const ctx = doc.context;
  if (ctx.trailerInfo.Encrypt) throw new Error(`The PDF is encrypted, so ${what}`);
  const cat = doc.catalog;
  const rootRef = ctx.trailerInfo.Root;
  if (!(rootRef instanceof PDFRef)) throw new Error("The PDF has no document catalog");
  const perms0 = cat.lookup(N("Perms"));
  if (perms0 instanceof PDFDict && docMdpLevel(ctx, perms0) !== null) throw new Error("The PDF is certified; changing it would break the certification");
  const health = xrefHealth(buf);
  const af0 = cat.lookup(N("AcroForm"));
  const signed = af0 instanceof PDFDict && formFields(ctx, af0).some((f) => f.ftype === "Sig" && hasSignatureValue(f.dict.lookup(N("V"))));
  const rewrite = !health.ok;
  if (rewrite && signed) throw new Error("The PDF is damaged and already signed; rewriting it would invalidate those signatures");

  // pdf-lib drops object streams and cross-reference streams when it loads a file, so its idea of
  // the largest object number can be too low; new objects must not reuse a number the file has.
  let maxNum = ctx.largestObjectNumber;
  for (const m of buf.toString("latin1").matchAll(/(?:^|[\s>\]])(\d{1,7})\s+\d{1,5}\s+obj/g)) maxNum = Math.max(maxNum, Number(m[1]));
  for (const m of buf.subarray(Math.max(0, health.startxref ?? 0)).toString("latin1").matchAll(/\/Size\s+(\d+)/g)) maxNum = Math.max(maxNum, Number(m[1]) - 1);
  ctx.largestObjectNumber = maxNum;
  const before = maxNum;
  const changed = new Map(); // objectNumber -> ref of an existing object that was modified
  const touch = (ref) => ref instanceof PDFRef && ref.objectNumber <= before && changed.set(ref.objectNumber, ref);
  const holderOf = (dictKey, owner, ownerRef) => {
    // the object a value lives in: itself when indirect, else whatever object contains it
    const raw = owner.get(N(dictKey));
    return raw instanceof PDFRef ? raw : ownerRef;
  };
  return { buf, doc, ctx, cat, rootRef, health, af0, rewrite, before, changed, touch, holderOf };
}

/** Write the edits: appended to the original bytes, or (damaged, unsigned file) a clean rewrite. */
async function finishPatch({ buf, doc, ctx, health, rewrite, before, changed }) {
  if (rewrite) {
    const out = await doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
    return { bytes: Buffer.from(out), mode: "rewrite" };
  }

  // ---- incremental update: changed + new objects, then a cross-reference section for just those
  const objects = [...changed.values()];
  for (const [ref] of ctx.enumerateIndirectObjects()) if (ref.objectNumber > before) objects.push(ref);
  objects.sort((a, b) => a.objectNumber - b.objectNumber);
  const parts = [buf, Buffer.from("\n", "latin1")];
  let pos = buf.length + 1;
  const offsets = new Map();
  for (const ref of objects) {
    const body = serialize(ctx.lookup(ref));
    const head = Buffer.from(`${ref.objectNumber} ${ref.generationNumber} obj\n`, "latin1");
    const tail = Buffer.from("\nendobj\n", "latin1");
    offsets.set(ref.objectNumber, { pos, gen: ref.generationNumber });
    parts.push(head, body, tail);
    pos += head.length + body.length + tail.length;
  }
  const t = ctx.trailerInfo;
  const extra = [["Root", t.Root], ["Info", t.Info], ["ID", t.ID]].filter(([, v]) => v);
  const ser = (v) => serialize(v).toString("latin1");
  const groups = (list) => {
    const out = [];
    for (const n of list) {
      const last = out.at(-1);
      if (last && last[0] + last[1] === n) last[1]++;
      else out.push([n, 1]);
    }
    return out;
  };
  if (health.kind === "table") {
    const nums = [...offsets.keys()].sort((a, b) => a - b);
    let xref = "xref\n";
    let i = 0;
    for (const [start, count] of groups(nums)) {
      xref += `${start} ${count}\n`;
      for (let k = 0; k < count; k++, i++) {
        const o = offsets.get(nums[i]);
        xref += `${String(o.pos).padStart(10, "0")} ${String(o.gen).padStart(5, "0")} n\r\n`;
      }
    }
    const size = Math.max(ctx.largestObjectNumber, before) + 1;
    xref += `trailer\n<< /Size ${size} /Prev ${health.startxref}${extra.map(([k, v]) => ` /${k} ${ser(v)}`).join("")} >>\nstartxref\n${pos}\n%%EOF\n`;
    parts.push(Buffer.from(xref, "latin1"));
  } else {
    const xrefNum = Math.max(ctx.largestObjectNumber, before) + 1;
    offsets.set(xrefNum, { pos, gen: 0 });
    const nums = [...offsets.keys()].sort((a, b) => a - b);
    const rows = Buffer.alloc(nums.length * 7);
    nums.forEach((n, i) => {
      const o = offsets.get(n);
      rows[i * 7] = 1;
      rows.writeUInt32BE(o.pos, i * 7 + 1);
      rows.writeUInt16BE(o.gen, i * 7 + 5);
    });
    const index = groups(nums).flat().join(" ");
    const dict = `<< /Type /XRef /Size ${xrefNum + 1} /W [1 4 2] /Index [${index}] /Prev ${health.startxref}${extra.map(([k, v]) => ` /${k} ${ser(v)}`).join("")} /Length ${rows.length} >>`;
    parts.push(Buffer.from(`${xrefNum} 0 obj\n${dict}\nstream\n`, "latin1"), rows, Buffer.from(`\nendstream\nendobj\nstartxref\n${pos}\n%%EOF\n`, "latin1"));
  }
  return { bytes: Buffer.concat(parts), mode: "incremental" };
}

export async function addField(bytes, target, label = "field") {
  const { buf, doc, ctx, cat, rootRef, health, af0, rewrite, before, changed, touch, holderOf } = await openPatch(bytes, "a field can't be added to it");
  const page = doc.getPages()[target.page];
  if (!page) throw new Error("That page isn't in the PDF");

  const existing = new Set(af0 instanceof PDFDict ? formFields(ctx, af0).map((f) => f.name) : []);
  // The new field replaces the old box instead of sitting on top of it. Anything that holds something
  // (a real signature, typed text) is left alone, and the new field goes over it as before.
  const g0 = pageGeometry(page.node);
  const oldBox = widgetAt(ctx, page, g0, target.rect);
  if (oldBox && !holdsContent(ctx, oldBox)) removeWidget({ ctx, af0, touch, holderOf, cat, rootRef }, page, oldBox);
  let name = `${FIELD_PREFIX}${label}`.replace(/\./g, " ");
  for (let i = 2; existing.has(name); i++) name = `${FIELD_PREFIX}${label} ${i}`.replace(/\./g, " ");

  const g = pageGeometry(page.node);
  const [x0, y0, x1, y1] = toUser(g, target.rect).map((v) => Math.round(v * 1000) / 1000);
  const w = x1 - x0;
  const h = y1 - y0;
  const isSig = target.kind === "Signature";
  const apRef = ctx.register(ctx.stream(`q 0.25 0.45 0.85 RG 0.8 w 0.4 0.4 ${(w - 0.8).toFixed(3)} ${(h - 0.8).toFixed(3)} re S Q`, {
    Type: "XObject", Subtype: "Form", BBox: [0, 0, w, h],
  }));
  const widget = ctx.obj({
    Type: "Annot", Subtype: "Widget", FT: isSig ? "Sig" : "Tx", Rect: [x0, y0, x1, y1], F: 4,
    P: page.ref, AP: { N: apRef }, MK: { BC: [0.25, 0.45, 0.85] }, BS: { W: 1, S: "S" },
  });
  widget.set(N("T"), PDFHexString.fromText(name));
  if (!isSig) widget.set(N("DA"), PDFString.of("/Helv 9 Tf 0 g"));
  const wRef = ctx.register(widget);

  // page /Annots (appended last = drawn on top and clicked first)
  const annotsRaw = page.node.get(N("Annots"));
  const annots = annotsRaw instanceof PDFRef ? ctx.lookup(annotsRaw) : annotsRaw;
  if (annots instanceof PDFArray) {
    annots.push(wRef);
    touch(annotsRaw instanceof PDFRef ? annotsRaw : page.ref);
  } else {
    page.node.set(N("Annots"), ctx.obj([wRef]));
    touch(page.ref);
  }

  // AcroForm /Fields
  let af = af0;
  if (af instanceof PDFDict) {
    touch(holderOf("AcroForm", cat, rootRef));
  } else {
    af = ctx.obj({});
    cat.set(N("AcroForm"), ctx.register(af));
    touch(rootRef);
  }
  const afRef = cat.get(N("AcroForm")) instanceof PDFRef ? cat.get(N("AcroForm")) : rootRef;
  const fieldsRaw = af.get(N("Fields"));
  const fieldsArr = fieldsRaw instanceof PDFRef ? ctx.lookup(fieldsRaw) : fieldsRaw;
  if (fieldsArr instanceof PDFArray) {
    fieldsArr.push(wRef);
    touch(fieldsRaw instanceof PDFRef ? fieldsRaw : afRef);
  } else {
    af.set(N("Fields"), ctx.obj([wRef]));
    touch(afRef);
  }
  if (af.has(N("XFA"))) {
    af.delete(N("XFA"));
    touch(afRef);
  }
  if (!isSig) {
    if (!af.has(N("DA"))) {
      af.set(N("DA"), PDFString.of("/Helv 0 Tf 0 g"));
      touch(afRef);
    }
    const drRaw = af.get(N("DR"));
    let dr = drRaw instanceof PDFRef ? ctx.lookup(drRaw) : drRaw;
    if (!(dr instanceof PDFDict)) {
      dr = ctx.obj({});
      af.set(N("DR"), dr);
      touch(afRef);
    }
    const drHolder = drRaw instanceof PDFRef ? drRaw : afRef;
    const fontRaw = dr.get(N("Font"));
    let font = fontRaw instanceof PDFRef ? ctx.lookup(fontRaw) : fontRaw;
    if (!(font instanceof PDFDict)) {
      font = ctx.obj({});
      dr.set(N("Font"), font);
      touch(drHolder);
    }
    if (!font.has(N("Helv"))) {
      font.set(N("Helv"), ctx.register(ctx.obj({ Type: "Font", Subtype: "Type1", BaseFont: "Helvetica", Encoding: "WinAnsiEncoding" })));
      touch(fontRaw instanceof PDFRef ? fontRaw : drHolder);
    }
  }

  // Reader usage rights are broken by any change, and a broken right switches signing off in Reader
  const permsRaw = cat.get(N("Perms"));
  const perms = permsRaw instanceof PDFRef ? ctx.lookup(permsRaw) : permsRaw;
  if (perms instanceof PDFDict && (perms.has(N("UR3")) || perms.has(N("UR")))) {
    perms.delete(N("UR3"));
    perms.delete(N("UR"));
    if (!perms.keys().length) {
      cat.delete(N("Perms"));
      touch(rootRef);
    } else touch(permsRaw instanceof PDFRef ? permsRaw : rootRef);
  }
  if (cat.has(N("NeedsRendering"))) {
    cat.delete(N("NeedsRendering"));
    touch(rootRef);
  }
  return { ...(await finishPatch({ buf, doc, ctx, health, rewrite, before, changed })), name };
}

// --------------------------------------------------------------------------- filling text in

/** The widget on a page that best covers a spot: { ref, dict, overlap } or null. */
function widgetAt(ctx, page, g, rect) {
  const annots = page.node.lookup(N("Annots"));
  const found = [];
  for (const ref of annots instanceof PDFArray ? annots.asArray() : []) {
    const dict = ref instanceof PDFRef ? ctx.lookup(ref) : ref;
    if (!(dict instanceof PDFDict) || text(dict.lookup(N("Subtype"))) !== "Widget") continue;
    const r = nums(dict.lookup(N("Rect")));
    if (!r || r.length < 4) continue;
    const norm = toNorm(g, [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])]);
    found.push({ ref: ref instanceof PDFRef ? ref : null, dict, overlap: iou(norm, rect), inside: centerIn(norm, rect) || centerIn(rect, norm) });
  }
  return found.filter((w) => w.overlap >= 0.5).at(-1) || found.filter((w) => w.inside || w.overlap >= 0.25).sort((a, b) => b.overlap - a.overlap)[0] || null;
}

/** Does this widget's field hold something worth keeping: a real digital signature, or typed text? */
function holdsContent(ctx, w) {
  const chain = chainOf(ctx, w.ref, w.dict);
  const term = chain.find(({ dict }) => dict.get(N("T")) !== undefined)?.dict ?? w.dict;
  const v = term.lookup(N("V"));
  const ft = inherited(chain, "FT");
  if (hasSignatureValue(v)) return true;
  if (ft instanceof PDFName && ft.decodeText() === "Sig") return false; // a stray value in a signature field is junk
  return v !== undefined && v !== null && !(v instanceof PDFDict) && text(v) !== "";
}

/** Can closet type into this widget's field instead of laying a new box on top? */
function usableTextField(w, ctx, len) {
  if (!w?.ref) return null;
  const chain = chainOf(ctx, w.ref, w.dict);
  const ft = inherited(chain, "FT");
  if (!(ft instanceof PDFName) || ft.decodeText() !== "Tx") return null;
  if ((num(inherited(chain, "Ff")) ?? 0) & (1 | 4096 | 8192 | 1 << 24)) return null; // read-only, multiline, password, comb
  if ((num(w.dict.lookup(N("F"))) ?? 0) & (2 | 32 | 64)) return null; // hidden / no-view / read-only box
  const maxLen = num(inherited(chain, "MaxLen"));
  if (maxLen !== null && maxLen < len) return null;
  const term = chain.find(({ dict }) => dict.get(N("T")) !== undefined);
  if (!term?.ref) return null;
  const kids = term.dict.lookup(N("Kids"));
  if (kids instanceof PDFArray && kids.size() > 1) return null; // one field, several boxes: typing would fill them all
  if (text(inherited(chain, "V")) !== "") return null;
  return term;
}

const pdfText = (t) => String(t).replace(/[^ -~]/g, "?");

/**
 * Put text where a form field should be. For each item { page, rect, text } (rect top-left
 * normalized): type into the existing field there when it's a plain empty text field, else lay a new
 * text box with the text on top of the spot. Written as an incremental update, so digital
 * signatures already on the form stay valid. Throws when the PDF can't be edited safely.
 *
 * @returns {Promise<{bytes: Buffer, mode: string, how: ("field"|"overlay")[]}>}
 */
export async function fillSlots(bytes, items) {
  const P = await openPatch(bytes, "text can't be added to it");
  const { doc, ctx, cat, rootRef, af0, touch } = P;
  const metrics = await doc.embedFont(StandardFonts.Helvetica); // only for measuring text; pdf-lib writes it out on save(), which an incremental update never calls
  const font = { widthOfTextAtSize: (t, sz) => metrics.widthOfTextAtSize(t, sz), ref: ctx.register(ctx.obj({ Type: "Font", Subtype: "Type1", BaseFont: "Helvetica", Encoding: "WinAnsiEncoding" })) };
  const how = [];
  let af = af0;
  const used = new Set(af instanceof PDFDict ? formFields(ctx, af).map((f) => f.name) : []);
  for (const item of items) {
    const page = doc.getPages()[item.page];
    if (!page) throw new Error("A page this goes on isn't in the PDF");
    const g = pageGeometry(page.node);
    if (g.a !== 1 || g.d !== -1) throw new Error("The page is rotated, which closet can't write on yet");
    const t = pdfText(item.text);
    const [x0, y0, x1, y1] = toUser(g, item.rect);
    const w = x1 - x0;
    const h = y1 - y0;
    const size = Math.min(10, Math.max(6, h - 5));
    const tw = font.widthOfTextAtSize(t, size);
    const tx = Math.max(2, (w - tw) / 2);
    const ty = Math.max(1, (h - size * 0.72) / 2);
    const ap = ctx.register(ctx.stream(`/Tx BMC q BT /Helv ${size.toFixed(2)} Tf 0 g ${tx.toFixed(2)} ${ty.toFixed(2)} Td (${t.replace(/[()\\]/g, (c) => "\\" + c)}) Tj ET Q EMC`, {
      Type: "XObject", Subtype: "Form", BBox: [0, 0, w, h], Resources: { Font: { Helv: font.ref } },
    }));
    const existing = usableTextField(widgetAt(ctx, page, g, item.rect), ctx, t.length);
    if (existing) {
      const w2 = widgetAt(ctx, page, g, item.rect);
      existing.dict.set(N("V"), PDFHexString.fromText(t));
      w2.dict.set(N("AP"), ctx.obj({ N: ap }));
      touch(existing.ref);
      touch(w2.ref);
      how.push("field");
      continue;
    }
    let name = "closet text";
    for (let i = 2; used.has(name); i++) name = `closet text ${i}`;
    used.add(name);
    const widget = ctx.obj({ Type: "Annot", Subtype: "Widget", FT: "Tx", Rect: [x0, y0, x1, y1], F: 4, P: page.ref, AP: { N: ap }, DA: PDFString.of(`/Helv ${size.toFixed(0)} Tf 0 g`) });
    widget.set(N("T"), PDFHexString.fromText(name));
    widget.set(N("V"), PDFHexString.fromText(t));
    const wRef = ctx.register(widget);
    const annotsRaw = page.node.get(N("Annots"));
    const annots = annotsRaw instanceof PDFRef ? ctx.lookup(annotsRaw) : annotsRaw;
    if (annots instanceof PDFArray) {
      annots.push(wRef);
      touch(annotsRaw instanceof PDFRef ? annotsRaw : page.ref);
    } else {
      page.node.set(N("Annots"), ctx.obj([wRef]));
      touch(page.ref);
    }
    if (!(af instanceof PDFDict)) {
      af = ctx.obj({});
      cat.set(N("AcroForm"), ctx.register(af));
      touch(rootRef);
    }
    const afRef = cat.get(N("AcroForm")) instanceof PDFRef ? cat.get(N("AcroForm")) : rootRef;
    const fRaw = af.get(N("Fields"));
    const fArr = fRaw instanceof PDFRef ? ctx.lookup(fRaw) : fRaw;
    if (fArr instanceof PDFArray) {
      fArr.push(wRef);
      touch(fRaw instanceof PDFRef ? fRaw : afRef);
    } else {
      af.set(N("Fields"), ctx.obj([wRef]));
      touch(afRef);
    }
    if (af.has(N("XFA"))) {
      af.delete(N("XFA"));
      touch(afRef);
    }
    how.push("overlay");
  }
  // Reader usage rights are broken by any change
  const permsRaw = cat.get(N("Perms"));
  const perms = permsRaw instanceof PDFRef ? ctx.lookup(permsRaw) : permsRaw;
  if (perms instanceof PDFDict && (perms.has(N("UR3")) || perms.has(N("UR")))) {
    perms.delete(N("UR3"));
    perms.delete(N("UR"));
    if (!perms.keys().length) cat.delete(N("Perms"));
    touch(permsRaw instanceof PDFRef ? permsRaw : rootRef);
  }
  return { ...(await finishPatch(P)), how };
}

// --------------------------------------------------------------------------- unofficial approval stamp

const RED = "0.78 0.05 0.05";

/** Remove a widget (and the field it belongs to, once nothing is left in it) from the form. */
function removeWidget(P, page, w) {
  const { ctx, af0, touch } = P;
  const annotsRaw = page.node.get(N("Annots"));
  const annots = annotsRaw instanceof PDFRef ? ctx.lookup(annotsRaw) : annotsRaw;
  if (annots instanceof PDFArray) {
    const i = annots.asArray().findIndex((r) => r === w.dict || r === w.ref || (r instanceof PDFRef && w.ref && r.objectNumber === w.ref.objectNumber));
    if (i >= 0) {
      annots.remove(i);
      touch(annotsRaw instanceof PDFRef ? annotsRaw : page.ref);
    }
  }
  const same = (r, ref) => r instanceof PDFRef && ref instanceof PDFRef && r.objectNumber === ref.objectNumber;
  const dropFrom = (arr, holder, ref) => {
    if (!(arr instanceof PDFArray)) return false;
    const i = arr.asArray().findIndex((r) => same(r, ref));
    if (i < 0) return false;
    arr.remove(i);
    touch(holder);
    return true;
  };
  const chain = chainOf(ctx, w.ref, w.dict);
  for (let k = 0; k < chain.length; k++) {
    const node = chain[k];
    const parent = chain[k + 1];
    if (k > 0) {
      const kids = node.dict.lookup(N("Kids"));
      if (kids instanceof PDFArray && kids.size() > 0) break; // the field still has other boxes
    }
    if (parent) {
      const kRaw = parent.dict.get(N("Kids"));
      dropFrom(kRaw instanceof PDFRef ? ctx.lookup(kRaw) : kRaw, kRaw instanceof PDFRef ? kRaw : parent.ref, node.ref);
    } else if (af0 instanceof PDFDict) {
      const fRaw = af0.get(N("Fields"));
      dropFrom(fRaw instanceof PDFRef ? ctx.lookup(fRaw) : fRaw, fRaw instanceof PDFRef ? fRaw : P.holderOf("AcroForm", P.cat, P.rootRef), node.ref);
    }
  }
}

function dropReaderRights(P) {
  const { ctx, cat, rootRef, touch } = P;
  const permsRaw = cat.get(N("Perms"));
  const perms = permsRaw instanceof PDFRef ? ctx.lookup(permsRaw) : permsRaw;
  if (perms instanceof PDFDict && (perms.has(N("UR3")) || perms.has(N("UR")))) {
    perms.delete(N("UR3"));
    perms.delete(N("UR"));
    if (!perms.keys().length) cat.delete(N("Perms"));
    touch(permsRaw instanceof PDFRef ? permsRaw : rootRef);
  }
}

/**
 * Mark a form's AOC/AMT (or commander) signature as approved without a real signature: removes the
 * unfilled signature box and puts a red "approved by First Sergeant (unofficial)" stamp where it was,
 * extending `expandDown` points below the box into empty page. A box holding a real signature is
 * never touched. Any `dates` ({page, rect, text}) are then typed into their boxes.
 *
 * @param {object} o { page, rect (top-left normalized), expandDown (pt), small, big, date, dates: [] }
 * @returns {Promise<{bytes: Buffer, mode: string, removed: boolean}>}
 */
export async function approveAoc(bytes, o) {
  const P = await openPatch(bytes, "it can't be stamped");
  const { doc, ctx, touch } = P;
  const page = doc.getPages()[o.page];
  if (!page) throw new Error("The page the signature goes on isn't in the PDF");
  const g = pageGeometry(page.node);
  if (g.a !== 1 || g.d !== -1) throw new Error("The page is rotated, which closet can't write on yet");
  const w = widgetAt(ctx, page, g, o.rect);
  let removed = false;
  if (w) {
    const chain = chainOf(ctx, w.ref, w.dict);
    const term = chain.find(({ dict }) => dict.get(N("T")) !== undefined)?.dict ?? w.dict;
    const v = term.lookup(N("V"));
    if (hasSignatureValue(v)) throw new Error("There's already a digital signature in that box");
    const typed = v !== undefined && v !== null && !(v instanceof PDFDict) && text(v) !== "";
    if (!typed) {
      removeWidget(P, page, w);
      removed = true;
    }
  }
  const [x0, y0, x1, y1] = toUser(g, o.rect);
  const lo = Math.max(g.view[1] + 2, y0 - (o.expandDown || 0));
  const W = x1 - x0;
  const H = y1 - lo;
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const small = pdfText(o.small);
  const big = pdfText(o.big);
  const date = o.date ? pdfText(o.date) : "";
  const fit = (f, t, size, max) => { while (size > 4 && f.widthOfTextAtSize(t, size) > max) size -= 0.25; return size; };
  const esc = (t) => t.replace(/[()\\]/g, (c) => "\\" + c);
  // Three layouts, always inside the field itself: a tall box stacks three lines; a medium one two;
  // a short one (the F10's 14 pt AOC/AMT box) puts the big words on the left and the small text and
  // date stacked beside them.
  const mode = H >= 36 ? "tall" : H >= 22 ? "medium" : "compact";
  const txt = (f, name, t, size, x, y) => `q ${RED} rg BT /${name} ${size.toFixed(2)} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${esc(t)}) Tj ET Q`;
  const centered = (f, name, t, size, y) => txt(f, name, t, size, (W - f.widthOfTextAtSize(t, size)) / 2, y);
  const lines = [];
  let border = `q ${RED} RG ${RED} rg 1.3 w 1 1 ${(W - 2).toFixed(2)} ${(H - 2).toFixed(2)} re S 0.4 w 3 3 ${(W - 6).toFixed(2)} ${(H - 6).toFixed(2)} re S Q`;
  if (mode === "compact") {
    border = `q ${RED} RG 0.9 w 0.6 0.6 ${(W - 1.2).toFixed(2)} ${(H - 1.2).toFixed(2)} re S Q`;
    const bigSize = fit(bold, big, Math.min(H - 4.5, 10), W * 0.5);
    const smallSize = Math.min(4.6, fit(reg, small, 4.6, W * 0.62));
    const bigW = bold.widthOfTextAtSize(big, bigSize);
    const sideW = Math.max(reg.widthOfTextAtSize(small, smallSize), date ? reg.widthOfTextAtSize(date, smallSize) : 0);
    const x0b = Math.max(3, (W - (bigW + 7 + sideW)) / 2);
    lines.push(txt(bold, "F1", big, bigSize, x0b, H / 2 - bigSize * 0.35));
    const sx = x0b + bigW + 7;
    if (date) {
      lines.push(txt(reg, "F2", small, smallSize, sx, H / 2 + 1.2));
      lines.push(txt(reg, "F2", date, smallSize, sx, H / 2 - smallSize - 0.2));
    } else lines.push(txt(reg, "F2", small, smallSize, sx, H / 2 - smallSize * 0.35));
  } else {
    const tall = mode === "tall";
    const smallSize = fit(reg, small, tall ? 6 : 4.8, W - 10);
    const bigSize = fit(bold, big, tall ? Math.min(16, H * 0.4) : Math.min(9.5, H - 14), W - 14);
    const bigY = tall ? (H - smallSize - 5 - (date ? 10 : 2)) / 2 + (date ? 10 : 2) - bigSize * 0.33 : 6;
    lines.push(centered(reg, "F2", small, smallSize, H - smallSize - 3.5), centered(bold, "F1", big, bigSize, bigY));
    if (date && tall) lines.push(centered(reg, "F2", date, 6, 5));
  }
  const content = [border, ...lines].join("\n");
  const fontRef = (name) => ctx.register(ctx.obj({ Type: "Font", Subtype: "Type1", BaseFont: name, Encoding: "WinAnsiEncoding" }));
  const ap = ctx.register(ctx.stream(content, {
    Type: "XObject", Subtype: "Form", BBox: [0, 0, W, H], Resources: { Font: { F1: fontRef("Helvetica-Bold"), F2: fontRef("Helvetica") } },
  }));
  const stamp = ctx.obj({
    Type: "Annot", Subtype: "Stamp", Rect: [x0, lo, x1, y1], F: 4, P: page.ref, C: [0.78, 0.05, 0.05], AP: { N: ap },
    Contents: PDFHexString.fromText(`${small}. ${big}${date ? ` ${date}` : ""}`), T: PDFString.of("First Sergeant"),
  });
  const sRef = ctx.register(stamp);
  const annotsRaw = page.node.get(N("Annots"));
  const annots = annotsRaw instanceof PDFRef ? ctx.lookup(annotsRaw) : annotsRaw;
  if (annots instanceof PDFArray) {
    annots.push(sRef);
    touch(annotsRaw instanceof PDFRef ? annotsRaw : page.ref);
  } else {
    page.node.set(N("Annots"), ctx.obj([sRef]));
    touch(page.ref);
  }
  dropReaderRights(P);
  let out = await finishPatch(P);
  if (o.dates?.length) out = { ...(await fillSlots(out.bytes, o.dates)), mode: out.mode };
  return { bytes: out.bytes, mode: out.mode, removed };
}
