// PDF analysis: work out what kind of form a PDF is and what is filled in.
//
// Field names on real-world copies are unreliable (forms get recreated, flattened, printed and
// scanned), so everything here keys off *geometry* and *field type*:
//
// 1. Every page is shrunk to a small grayscale thumbnail and correlated against the template
//    pages. That picks the form type and finds the form pages inside a PDF with extra pages.
// 2. Widgets on the aligned pages are matched to template slots with a minimum-cost assignment
//    on (position, size, field type).
// 3. Slots with no widget fall back to flattened text inside the slot's box, then to "ink": dark
//    pixels the blank template doesn't have there. Ink is what catches wet/drawn signatures.
//
// Engine: pdf.js (Apache-2.0) for parsing/rendering, @napi-rs/canvas (MIT) as its canvas,
// pdf-lib (MIT) to read signature dictionaries.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { createCanvas } from "@napi-rs/canvas";
import { PDFDict, PDFDocument, PDFName, PDFSignature } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

import { linearSumAssignment } from "./assignment.js";
import {
  columnProfile, darkMask, dilate, newInk, profileShift, regionInk, rowProfile, similarity,
  thumbFromGray, toGray, THUMB_H, THUMB_W,
} from "./imaging.js";
import { FORM_TYPES } from "./templates.js";

const require = createRequire(import.meta.url);
const PDFJS_DIR = path.dirname(require.resolve("pdfjs-dist/package.json"));
// pdf.js wants these as "URLs" with forward slashes and a trailing slash, even for local folders
const slashDir = (d) => d.split(path.sep).join("/") + "/";
const STANDARD_FONTS = slashDir(path.join(PDFJS_DIR, "standard_fonts"));
const CMAPS = slashDir(path.join(PDFJS_DIR, "cmaps"));

export const INK_SCALE = 2.0; // also the scale of the page images shown in the app (crisp on hi-DPI)
const MAX_PAGES = 30;
const MAX_SHIFT_PT = 18; // largest page offset searched when registering scans
const TEMPLATE_CACHE_VERSION = 6;

// --------------------------------------------------------------------------- helpers

export function fileSha1(file) {
  return createHash("sha1").update(readFileSync(file)).digest("hex");
}

const round = (x, d = 5) => Math.round(x * 10 ** d) / 10 ** d;

class Rect {
  constructor(x0, y0, x1, y1) {
    Object.assign(this, { x0, y0, x1, y1 });
  }
  get width() { return this.x1 - this.x0; }
  get height() { return this.y1 - this.y0; }
  area() { return Math.max(0, this.width) * Math.max(0, this.height); }
  intersect(o) {
    return new Rect(Math.max(this.x0, o.x0), Math.max(this.y0, o.y0), Math.min(this.x1, o.x1), Math.min(this.y1, o.y1));
  }
  intersects(o) { return this.x0 < o.x1 && o.x0 < this.x1 && this.y0 < o.y1 && o.y0 < this.y1; }
  toArray() { return [this.x0, this.y0, this.x1, this.y1]; }
}

const normRect = (r, W, H) => [r.x0 / W, r.y0 / H, r.x1 / W, r.y1 / H];
const normName = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** One open PDF, with lazily computed per-page material. All coordinates are top-left points. */
class Pdf {
  static async open(file) {
    const data = new Uint8Array(readFileSync(file));
    const task = pdfjs.getDocument({
      data: data.slice(), verbosity: 0, standardFontDataUrl: STANDARD_FONTS, cMapUrl: CMAPS, cMapPacked: true,
      isEvalSupported: false, disableFontFace: true,
    });
    const pdf = new Pdf(await task.promise, task);
    pdf.signed = await signedFieldNames(data);
    return pdf;
  }

  constructor(doc, task) {
    this.doc = doc;
    this.task = task;
    this.pageCount = doc.numPages;
    this.cache = new Map();
  }

  async page(i) {
    const k = "p" + i;
    if (!this.cache.has(k)) {
      const page = await this.doc.getPage(i + 1);
      const vp = page.getViewport({ scale: 1 });
      this.cache.set(k, { page, vp, w: vp.width, h: vp.height });
    }
    return this.cache.get(k);
  }

  toRect(vp, pdfRect) {
    const [x0, y0] = vp.convertToViewportPoint(pdfRect[0], pdfRect[1]);
    const [x1, y1] = vp.convertToViewportPoint(pdfRect[2], pdfRect[3]);
    return new Rect(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1));
  }

  /** Render to gray (and optionally keep the canvas for a PNG). */
  async render(i, scale, { annots = true, keepCanvas = false } = {}) {
    const { page } = await this.page(i);
    const vp = page.getViewport({ scale });
    const canvas = createCanvas(Math.max(1, Math.ceil(vp.width)), Math.max(1, Math.ceil(vp.height)));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({
      canvas, canvasContext: ctx, viewport: vp,
      annotationMode: annots ? pdfjs.AnnotationMode.ENABLE : pdfjs.AnnotationMode.DISABLE,
    }).promise;
    const gray = toGray(ctx.getImageData(0, 0, canvas.width, canvas.height));
    return keepCanvas ? { gray, canvas } : { gray };
  }

  async annotations(i) {
    const k = "a" + i;
    if (!this.cache.has(k)) {
      const { page, vp } = await this.page(i);
      const list = await page.getAnnotations({ intent: "display" });
      const widgets = [];
      const marks = [];
      for (const a of list) {
        if (a.subtype === "Widget") {
          const w = widgetInfo(a, this.toRect(vp, a.rect), this.signed);
          if (w) widgets.push(w);
        } else if (!["Link", "Popup"].includes(a.subtype) && a.rect) {
          marks.push(this.toRect(vp, a.rect));
        }
      }
      this.cache.set(k, { widgets, marks });
    }
    return this.cache.get(k);
  }

  /** Words with top-left boxes, in reading order: [x0, y0, x1, y1, text, line]. */
  async words(i) {
    const k = "w" + i;
    if (!this.cache.has(k)) {
      const { page, vp } = await this.page(i);
      const tc = await page.getTextContent();
      const out = [];
      for (const it of tc.items) {
        if (!it.str || !it.str.trim()) continue;
        const [, , c, d, e, f] = it.transform;
        const size = it.height || Math.hypot(c, d) || 10;
        const [bx, by] = vp.convertToViewportPoint(e, f);
        const len = it.str.length;
        for (const m of it.str.matchAll(/\S+/g)) {
          const x0 = bx + (it.width * m.index) / len;
          const x1 = bx + (it.width * (m.index + m[0].length)) / len;
          out.push([x0, by - size * 0.8, x1, by + size * 0.2, m[0], Math.round(by / 3)]);
        }
      }
      out.sort((a, b) => a[5] - b[5] || a[0] - b[0]);
      this.cache.set(k, out);
    }
    return this.cache.get(k);
  }


  async text(i) {
    return (await this.words(i)).map((w) => w[4]).join(" ");
  }

  destroy() {
    this.task.destroy();
  }
}

/** Names of signature fields that carry an actual digital signature (/V with /ByteRange). */
async function signedFieldNames(bytes) {
  const out = new Set();
  // Loading the whole file with pdf-lib costs ~0.5 s; skip it unless a signature is present at all.
  if (Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).indexOf("/ByteRange") < 0) return out;
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
    for (const f of doc.getForm().getFields()) {
      if (!(f instanceof PDFSignature)) continue;
      const v = f.acroField.dict.lookup(PDFName.of("V"));
      if (v instanceof PDFDict && (v.has(PDFName.of("ByteRange")) || v.has(PDFName.of("Contents")))) out.add(f.getName());
    }
  } catch {
    /* unusual structure: no digital signatures detectable, ink detection still applies */
  }
  return out;
}

function widgetInfo(a, rect, signed) {
  let ftype;
  let value;
  if (a.fieldType === "Sig") {
    ftype = "Signature";
    value = "";
  } else if (a.fieldType === "Btn") {
    if (a.pushButton) return null;
    ftype = a.radioButton ? "Radio" : "CheckBox";
    const v = a.fieldValue;
    value = a.radioButton ? v === a.buttonValue : Boolean(v) && !["Off", "False", "0", ""].includes(String(v));
  } else {
    ftype = "Text";
    const v = a.fieldValue;
    value = (Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v)).trim();
  }
  return {
    name: a.fieldName || "", ftype, rect, value,
    digital: ftype === "Signature" && signed.has(a.fieldName),
  };
}

// --------------------------------------------------------------------------- templates

export class TemplateModel {
  constructor(formType, file, data) {
    this.formType = formType;
    this.file = file;
    this.pageCount = data.page_count;
    this.slots = data.slots;
    this.thumbs = data.thumbs.map((t) => Float32Array.from(t));
    this.sizes = data.sizes;
    this.masks = new Map();
  }

  slotsOn(page) {
    return this.slots.filter((s) => s.page === page);
  }

  /** Dark mask + dilated dark mask of a blank template page at INK_SCALE. */
  async mask(page) {
    if (!this.masks.has(page)) {
      const pdf = await Pdf.open(this.file);
      const { gray } = await pdf.render(page, INK_SCALE, { annots: false });
      pdf.destroy();
      const dark = darkMask(gray);
      this.masks.set(page, { dark, dil: dilate(dark) });
    }
    return this.masks.get(page);
  }
}

/** Load a template's slot geometry, cached against the template file's hash. */
export async function buildTemplate(formType, file, cacheDir) {
  const spec = FORM_TYPES[formType];
  const sha = fileSha1(file);
  const cache = path.join(cacheDir, `${formType}.json`);
  if (existsSync(cache)) {
    try {
      const data = JSON.parse(readFileSync(cache, "utf8"));
      if (data.sha1 === sha && data.version === TEMPLATE_CACHE_VERSION) return new TemplateModel(formType, file, data);
    } catch { /* rebuild */ }
  }
  const pdf = await Pdf.open(file);
  const widgets = [];
  const sizes = [];
  for (let i = 0; i < pdf.pageCount; i++) {
    const { w, h } = await pdf.page(i);
    sizes.push([w, h]);
    for (const wi of (await pdf.annotations(i)).widgets) widgets.push({ page: i, ...wi });
  }
  if (widgets.length !== spec.slots.length) {
    throw new Error(`Template ${path.basename(file)} has ${widgets.length} fields, expected ${spec.slots.length}`);
  }
  const slots = [];
  for (let k = 0; k < widgets.length; k++) {
    const w = widgets[k];
    const [tname, key, label, section] = spec.slots[k];
    if (w.name !== tname) throw new Error(`Template field order changed: got "${w.name}", expected "${tname}"`);
    const [W, H] = sizes[w.page];
    const words = await pdf.words(w.page);
    const baseline = words.filter((t) => centerIn(t, w.rect, 2)).map((t) => t[4]);
    slots.push({ key, label, section, ftype: w.ftype, page: w.page, rect: normRect(w.rect, W, H), name: w.name, baseline_words: baseline });
  }
  const thumbs = [];
  for (let i = 0; i < pdf.pageCount; i++) {
    const { gray } = await pdf.render(i, INK_SCALE, { annots: false });
    thumbs.push(Array.from(thumbFromGray(gray), (v) => round(v)));
  }
  pdf.destroy();
  const data = { version: TEMPLATE_CACHE_VERSION, sha1: sha, page_count: sizes.length, sizes, slots, thumbs };
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cache, JSON.stringify(data));
  return new TemplateModel(formType, file, data);
}

function centerIn(b, r, pad = 0) {
  const cx = (b[0] + b[2]) / 2;
  const cy = (b[1] + b[3]) / 2;
  return r.x0 - pad <= cx && cx <= r.x1 + pad && r.y0 - pad <= cy && cy <= r.y1 + pad;
}

// --------------------------------------------------------------------------- matching

/** Choose one document page per template page, in increasing order, maximising similarity. */
function alignPages(docThumbs, tm) {
  const n = docThumbs.length;
  const t = tm.pageCount;
  const sims = docThumbs.map((d) => tm.thumbs.map((tp) => similarity(d, tp)));
  const memo = new Map();
  const solve = (ti, start) => {
    if (ti === t) return [0, []];
    const key = ti * 1000 + start;
    if (memo.has(key)) return memo.get(key);
    const [sSkip, aSkip] = solve(ti + 1, start); // template page missing
    let res = [sSkip, [-1, ...aSkip]];
    for (let j = start; j < n; j++) {
      const [s, a] = solve(ti + 1, j + 1);
      if (s + sims[j][ti] > res[0]) res = [s + sims[j][ti], [j, ...a]];
    }
    memo.set(key, res);
    return res;
  };
  const assign = solve(0, 0)[1];
  const scores = assign.map((j, i) => (j >= 0 ? sims[j][i] : 0));
  return { assign, scores };
}

/**
 * Assign widgets to slots. A widget whose every edge sits within `tolPt` points of the template
 * slot is a confident match regardless of name. Further-off widgets can still be assigned by the
 * global optimisation, but only if nothing better fits.
 */
function matchWidgets(slots, widgets, W, H, tolPt) {
  if (!slots.length || !widgets.length) return { match: new Map(), tight: new Set() };
  const cost = slots.map(() => new Array(widgets.length).fill(9));
  const within = slots.map(() => new Array(widgets.length).fill(false));
  slots.forEach((s, i) => {
    const scx = (s.rect[0] + s.rect[2]) / 2;
    const scy = (s.rect[1] + s.rect[3]) / 2;
    const sw = s.rect[2] - s.rect[0];
    const sh = s.rect[3] - s.rect[1];
    widgets.forEach((w, j) => {
      const r = normRect(w.rect, W, H);
      let compat = 0;
      if (w.ftype !== s.ftype) {
        const pair = [w.ftype, s.ftype].sort().join("|");
        if (pair === "Signature|Text") compat = 0.035;
        else if (pair !== "CheckBox|Radio") return;
      }
      const d = Math.hypot(scx - (r[0] + r[2]) / 2, scy - (r[1] + r[3]) / 2);
      const sz = Math.abs(sw - (r[2] - r[0])) + Math.abs(sh - (r[3] - r[1]));
      const edgePt = Math.max(Math.abs(s.rect[0] - r[0]) * W, Math.abs(s.rect[2] - r[2]) * W,
        Math.abs(s.rect[1] - r[1]) * H, Math.abs(s.rect[3] - r[3]) * H);
      let c;
      if (edgePt <= tolPt) {
        within[i][j] = true;
        c = 0.1 * (d + 0.35 * sz) + compat; // within tolerance: effectively a sure match
      } else {
        c = 0.01 + d + 0.35 * sz + compat;
      }
      if (normName(w.name) === normName(s.name)) c -= 0.02;
      cost[i][j] = c;
    });
  });
  const match = new Map();
  const tight = new Set();
  for (const [i, j] of linearSumAssignment(cost)) {
    if (cost[i][j] <= 0.075) {
      match.set(i, j);
      if (within[i][j]) tight.add(i);
    }
  }
  return { match, tight };
}

/** Give every word to the one slot box it sits in (or the nearest within `pad`). */
function assignWords(words, rects, skip, pad) {
  const out = rects.map(() => []);
  const left = skip.map((s) => [...s]);
  for (const wd of words) {
    const cx = (wd[0] + wd[2]) / 2;
    const cy = (wd[1] + wd[3]) / 2;
    let best = -1;
    let bestD = Infinity;
    rects.forEach((r, i) => {
      const ddx = Math.max(r.x0 - cx, 0, cx - r.x1);
      const ddy = Math.max(r.y0 - cy, 0, cy - r.y1);
      const d = Math.hypot(ddx, ddy);
      if (d <= pad && (d < bestD || (d === bestD && r.area() < rects[best].area()))) {
        best = i;
        bestD = d;
      }
    });
    if (best < 0) continue;
    const k = left[best].indexOf(wd[4]);
    if (k >= 0) {
      left[best].splice(k, 1); // printed on the blank template itself
      continue;
    }
    out[best].push(wd);
  }
  return out;
}

// --------------------------------------------------------------------------- analysis

export async function analyze(file, templates, hintedType, renderDir, tolPt = 10) {
  let pdf;
  try {
    pdf = await Pdf.open(file);
  } catch (e) {
    const msg = e?.name === "PasswordException" ? "PDF is password protected" : `Could not read PDF: ${e?.message || e}`;
    return { error: msg, page_count: 0 };
  }
  try {
    return await analyzeOpen(pdf, templates, hintedType, renderDir, tolPt);
  } finally {
    pdf.destroy();
  }
}

async function analyzeOpen(pdf, templates, hintedType, renderDir, tolPt) {
  const n = Math.min(pdf.pageCount, MAX_PAGES);
  // Analysis looks at the page *without* form-field appearances, so big typed text in a field can't
  // distort the layout comparison or count as ink (field values are read from the fields). Wet ink
  // is page content; ink/stamp annotations are caught by position. The page image shown in the app
  // is a second render with everything drawn.
  if (renderDir) {
    mkdirSync(renderDir, { recursive: true });
    for (const f of readdirSync(renderDir)) if (/^p\d+\.(png|jpg)$/.test(f)) unlinkSync(path.join(renderDir, f));
  }
  const grays = [];
  const thumbs = [];
  const renders = [];
  for (let i = 0; i < n; i++) {
    const { w, h } = await pdf.page(i);
    const r = await pdf.render(i, INK_SCALE, { annots: false });
    grays.push(r.gray);
    thumbs.push(thumbFromGray(r.gray));
    if (renderDir) {
      const shown = await pdf.render(i, INK_SCALE, { keepCanvas: true });
      writeFileSync(path.join(renderDir, `p${i}.jpg`), await shown.canvas.encode("jpeg", 88));
      renders.push({ page: i, w, h });
    }
  }

  // ---- form type: what the pages look like (an explicit user choice wins, with a note)
  const perType = {};
  for (const [ft, tm] of Object.entries(templates)) {
    const { assign, scores } = alignPages(thumbs, tm);
    const weighted = scores.filter((_, i) => tm.slotsOn(i).length);
    const use = weighted.length ? weighted : scores;
    perType[ft] = { assign, scores, score: use.length ? use.reduce((a, b) => a + b, 0) / use.length : 0 };
  }
  const types = Object.keys(perType);
  const visualType = types.length ? types.reduce((a, b) => (perType[b].score > perType[a].score ? b : a)) : null;
  const typeNotes = [];
  let formType = hintedType && templates[hintedType] ? hintedType : null;
  if (formType && visualType && visualType !== formType &&
      perType[visualType].score - perType[formType].score > 0.2 && perType[formType].score < 0.5) {
    typeNotes.push(`Labeled ${formType} but the pages look like ${visualType}`);
  }
  if (!formType) {
    const text = ((await pdf.text(0)) + " " + (n > 1 ? await pdf.text(1) : "")).toUpperCase();
    for (const [ft, spec] of Object.entries(FORM_TYPES)) {
      if (templates[ft] && text.includes(spec.anchorText[0])) formType = ft;
    }
    formType = formType || visualType;
  }
  if (!formType) return { error: "No templates available", page_count: pdf.pageCount };

  const tm = templates[formType];
  const { assign, scores: layoutScores } = perType[formType];


  const slotResults = {};
  let matchedWidgets = 0;
  const usedWidgets = new Set();
  const registration = {};
  const allWidgets = {};
  for (let i = 0; i < n; i++) allWidgets[i] = (await pdf.annotations(i)).widgets;

  for (let ti = 0; ti < tm.pageCount; ti++) {
    const slots = tm.slotsOn(ti);
    const dp = ti < assign.length ? assign[ti] : -1;
    if (!slots.length) continue;
    if (dp < 0) {
      for (const s of slots) slotResults[s.key] = slotResult(s, null, { located: false });
      continue;
    }
    const { w: pw, h: ph } = await pdf.page(dp);
    const wlist = allWidgets[dp] || [];
    const { match, tight } = matchWidgets(slots, wlist, pw, ph, tolPt);
    matchedWidgets += match.size;

    // register the page against the blank template (scans are shifted/skewed a little)
    const tmask = await tm.mask(ti);
    let gray = grays[dp];
    const scale = (INK_SCALE * tm.sizes[ti][0]) / pw;
    if (Math.abs(scale - INK_SCALE) > 0.01) gray = (await pdf.render(dp, scale, { annots: false })).gray;
    const dark = darkMask(gray);
    const W = Math.min(dark.w, tmask.dark.w);
    const H = Math.min(dark.h, tmask.dark.h);
    const ms = Math.round(MAX_SHIFT_PT * INK_SCALE);
    const dx = profileShift(columnProfile(dark, W, H), columnProfile(tmask.dark, W, H), ms);
    const dy = profileShift(rowProfile(dark, W, H), rowProfile(tmask.dark, W, H), ms);
    const ink = newInk(dark, tmask.dil, dx, dy);
    const sdx = dx / scale;
    const sdy = dy / scale;
    registration[dp] = [round(sdx, 1), round(sdy, 1)];

    // where each slot lives on this page: its matched widget, else the template box moved by registration
    const rects = [];
    const widgetsFor = [];
    slots.forEach((s, i) => {
      const wi = match.has(i) ? wlist[match.get(i)] : null;
      if (wi) usedWidgets.add(`${dp}:${match.get(i)}`);
      rects.push(wi ? wi.rect : new Rect(s.rect[0] * pw + sdx, s.rect[1] * ph + sdy, s.rect[2] * pw + sdx, s.rect[3] * ph + sdy));
      widgetsFor.push(wi);
    });
    // Only text sitting inside the input box counts: the position tolerance is for matching fields,
    // and applying it here pulled in printed labels just above boxes ("4. TOURS").
    const wordsPerSlot = assignWords(await pdf.words(dp), rects, slots.map((s) => s.baseline_words || []), 1.5);
    const { marks } = await pdf.annotations(dp);
    slots.forEach((s, i) => {
      const r = rects[i];
      const flat = wordsPerSlot[i].map((t) => t[4]).join(" ").trim();
      const { ratio, count } = regionInk(ink, r, scale, s.ftype === "CheckBox" ? 2 : 1);
      const hasAnnot = marks.some((a) => a.intersects(r) && a.intersect(r).area() > 0.2 * r.area());
      slotResults[s.key] = slotResult(s, widgetsFor[i], {
        located: true, flat, ink: ratio, inkPx: count, hasAnnot, page: dp,
        rect: normRect(r, pw, ph), fromRaster: !widgetsFor[i], withinTol: tight.has(i),
      });
    });
  }

  const total = tm.slots.length;
  const byWidget = Object.values(slotResults).filter((r) => r.source_widget).length;
  const hasText = Object.values(slotResults).some((r) => r.value && r.source === "text");
  const mode = byWidget >= 0.5 * total ? "fields" : hasText ? "text" : "raster";
  const extra = [];
  for (const [pn, wl] of Object.entries(allWidgets)) {
    wl.forEach((w, j) => {
      if (!usedWidgets.has(`${pn}:${j}`) && !["", false, null].includes(w.value)) {
        extra.push({ page: Number(pn), name: w.name, ftype: w.ftype, value: w.value, rect: normRect(w.rect, 1, 1), digital: w.digital });
      }
    });
  }
  return {
    form_type: formType,
    visual_type: visualType,
    type_scores: Object.fromEntries(Object.entries(perType).map(([k, v]) => [k, round(v.score, 3)])),
    type_notes: typeNotes,
    page_count: pdf.pageCount,
    template_pages: tm.pageCount,
    page_map: assign,
    layout_scores: layoutScores.map((s) => round(s, 3)),
    mode,
    has_widgets: Object.values(allWidgets).some((l) => l.length),
    widget_total: Object.values(allWidgets).reduce((a, l) => a + l.length, 0),
    matched_widgets: matchedWidgets,
    registration,
    slot_total: total,
    slots: slotResults,
    extra_widgets: extra.slice(0, 60),
    renders,
    render_scale: INK_SCALE,
  };
}

function slotResult(s, wi, { located, flat = "", ink = 0, inkPx = 0, hasAnnot = false, page = null, rect = null, fromRaster = false, withinTol = false }) {
  let value = "";
  let source = null;
  // the templates print a small red "SIGN" tag in every signature box; it isn't a signature
  if (s.ftype === "Signature") flat = flat.split(" ").filter((t) => !/^sign$/i.test(t)).join(" ");
  if (wi && !["", null, false].includes(wi.value)) {
    value = wi.value;
    source = "field";
  } else if (flat) {
    value = s.ftype !== "CheckBox" ? flat : true;
    source = "text";
  }
  const digital = Boolean(wi && wi.digital);
  // "new ink" = dark pixels the blank template doesn't have near that spot
  const inkHit = s.ftype === "CheckBox" ? ink > 0.12 && inkPx >= 10 : ink > 0.004 && inkPx >= 30;
  if (s.ftype === "CheckBox" && source === null && inkHit) {
    value = true;
    source = "ink";
  }
  let filled = Boolean(value) || digital || hasAnnot || (s.ftype === "Signature" && inkHit);
  if (s.ftype === "Text" && !value && inkHit) {
    filled = true; // something is written there but it can't be read (scan / handwriting)
    source = "ink";
  }
  if (s.ftype === "Signature") {
    if (digital) source = "digital";
    else if (hasAnnot) source = source || "annotation";
    else if (inkHit) source = source || "ink";
  }
  return {
    key: s.key, label: s.label, section: s.section, ftype: s.ftype,
    located, source_widget: Boolean(wi), within_tolerance: withinTol,
    field_name: wi ? wi.name : null,
    value, filled, source: filled ? source : null,
    ink: round(ink, 4), ink_px: inkPx, digital,
    page, rect: (rect || s.rect).map((x) => round(x)),
  };
}
