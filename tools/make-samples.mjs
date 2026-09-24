// Generate realistic test paperwork from the templates into a *separate* folder.
//
//   node tools/make-samples.mjs <out_dir>
//
// Never point this at a real dump folder. The names are made up. Variants:
//   - filled template (fields), wet-ink AOC signature
//   - "recreated" form: fields renamed and shifted a few points, printed labels as real text
//   - flattened (fields burned into page text)
//   - scanned (image only, slightly offset)
//   - F174 with an MFR page stapled in front
//   - F174 signed with an ink annotation + drawn commander signature
//   - a comma in the filename recipient, a near-duplicate name (typo), a badly named file

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument, PDFName, rgb, StandardFonts } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const F10 = readFileSync(path.join(ROOT, "resources/templates/F10_nuked_final.pdf"));
const F174 = readFileSync(path.join(ROOT, "resources/templates/F174_nuked_final.pdf"));

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const F10_VALUES = {
  "Recieving Cadet Name": "Doe, John A",
  "Recieving Cadet Squadron": "CS-07",
  "Recieving Cadet Year": "2028",
  Date: "12 Sep 26",
  "Reporting Official": "Mitchell, Sarah K",
  "Reporting Grade": "C/Capt",
  "Reporting Org/Office Symbol": "CS07/CCF",
  "RO MFR Attached No": true,
  "Conduct Narrative": "On 11 Sep 2026 at 0650, C4C Doe arrived at morning formation wearing an improperly maintained uniform (unshined boots, uneven ribbons). Corrective action: on-the-spot correction and re-inspection at 1200.",
  "Initial Processing Date": "13 Sep 26",
  "SQCCF Initials": "EJS",
  "Cadet SQCC Initials": "RTH",
  "Cadet SQCC Date": "14 Sep 26",
  Demerits: "5",
  Tours: "2",
  Confinements: "1",
  "Loss of Pass Priv": "1 weekend",
  "Date Awarded": "15 Sep 26",
};

const SANCTION_LABELS = {
  Demerits: "1. DEMERIT(S)", Confinements: "2. CONFINEMENT(S)", "Loss of Pass Priv": "3. LOSS OF PASS PRIV",
  Tours: "4. TOURS", "POV Priv": "5. REVOKE POV PRIV",
};

/** Widget rectangles by field name: { name: [{ page, x, y, width, height }] } (PDF coordinates). */
function widgetRects(doc) {
  const pages = doc.getPages();
  const out = {};
  for (const field of doc.getForm().getFields()) {
    for (const w of field.acroField.getWidgets()) {
      const ref = doc.context.getObjectRef(w.dict);
      const page = pages.findIndex((p) => p.node.Annots()?.asArray().some((a) => a === ref || String(a) === String(ref)));
      (out[field.getName()] ||= []).push({ page: Math.max(0, page), ...w.getRectangle() });
    }
  }
  return out;
}

function fill(doc, values) {
  const form = doc.getForm();
  for (const [name, v] of Object.entries(values)) {
    const f = form.getFieldMaybe(name);
    if (!f) continue;
    if (typeof v === "boolean") v ? f.check() : f.uncheck();
    else setText(f, v);
  }
}

// pdf-lib auto-sizes text to fill the box; real forms use a normal size
function setText(field, v) {
  field.setFontSize(9);
  field.setText(String(v));
}

// pdf-lib gives new fields a white background, which would paint over the printed form
function clearBackground(field) {
  for (const w of field.acroField.getWidgets()) w.getAppearanceCharacteristics()?.dict.delete(PDFName.of("BG"));
}

function squiggle(page, r) {
  let d = "";
  for (let x = 6, i = 0; x < Math.min(r.width - 6, 150); x += 7, i++) {
    d += `${i ? "L" : "M"} ${x} ${2 + rand() * (r.height - 4)} `;
  }
  page.drawSvgPath(d, { x: r.x, y: r.y + r.height, borderColor: rgb(0.05, 0.05, 0.3), borderWidth: 1.4 });
}

function inkAnnot(doc, page, r) {
  const pts = [];
  for (let x = 6; x < Math.min(r.width - 6, 150); x += 7) pts.push(r.x + x, r.y + 2 + rand() * (r.height - 4));
  const annot = doc.context.obj({
    Type: "Annot", Subtype: "Ink", F: 4, C: [0.05, 0.05, 0.3], BS: { W: 1.4 },
    Rect: [r.x, r.y, r.x + r.width, r.y + r.height], InkList: [pts],
  });
  page.node.addAnnot(doc.context.register(annot));
}

async function printLabels(doc, page, rects) {
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const [name, label] of Object.entries(SANCTION_LABELS)) {
    const r = rects[name][0];
    page.drawText(label, { x: r.x + 1, y: r.y + r.height + 3, size: 6.5, font });
  }
}

async function load(bytes) {
  return PDFDocument.load(bytes, { updateMetadata: false });
}

/** Render every page to a grayscale PNG with pdf.js, like a scanner would. */
async function scanPages(bytes, dpi) {
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0, disableFontFace: true, isEvalSupported: false,
    standardFontDataUrl: path.join(ROOT, "node_modules/pdfjs-dist/standard_fonts").split(path.sep).join("/") + "/" });
  const pdf = await task.promise;
  const out = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: dpi / 72 });
    const c = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvas: c, canvasContext: ctx, viewport: vp }).promise;
    const img = ctx.getImageData(0, 0, c.width, c.height);
    for (let p = 0; p < img.data.length; p += 4) {
      const g = 0.299 * img.data[p] + 0.587 * img.data[p + 1] + 0.114 * img.data[p + 2];
      img.data[p] = img.data[p + 1] = img.data[p + 2] = g;
    }
    ctx.putImageData(img, 0, 0);
    out.push(await c.encode("png"));
  }
  task.destroy();
  return out;
}

export async function makeSamples(out) {
  mkdirSync(out, { recursive: true });
  const save = async (doc, name) => writeFileSync(path.join(out, name), await doc.save());

  // 1. Plain filled F10, AOC signed in wet ink (drawn), recipient not signed yet
  let doc = await load(F10);
  fill(doc, F10_VALUES);
  let rects = widgetRects(doc);
  squiggle(doc.getPage(0), rects["AOC Signature"][0]);
  await save(doc, "John Doe_Neg_F10_Uniform Violation.pdf");

  // 2. Recreated F10: page redrawn, every field renamed and shifted a few points, labels as text,
  //    positive paperwork with no sanctions (blank -> 0) and N/A pass
  const tpl = await load(F10);
  const trects = widgetRects(tpl);
  doc = await PDFDocument.create();
  const [bg] = await doc.embedPdf(F10, [0]);
  const page = doc.addPage([612, 792]);
  page.drawPage(bg);
  await doc.embedPdf(F10, [1]).then(([p2]) => doc.addPage([612, 792]).drawPage(p2));
  const form = doc.getForm();
  const jane = { ...F10_VALUES, "Recieving Cadet Name": "C2C Smith, Jane", Demerits: "", Tours: "", Confinements: "", "Loss of Pass Priv": "N/A",
    "Conduct Narrative": "Led the squadron's food drive, collecting 1,200 lbs of donations for the local shelter." };
  let k = 0;
  const newRects = {};
  for (const [name, list] of Object.entries(trects)) {
    for (const r of list) {
      const dx = rand() * 14 - 7;
      const dy = rand() * 12 - 6;
      const at = { x: r.x + dx, y: r.y + dy, width: r.width, height: r.height, borderWidth: 0 };
      const isBox = name.includes("Attached");
      const f = isBox ? form.createCheckBox(`CheckBox${k++}`) : form.createTextField(`TextField${k++}`);
      f.addToPage(doc.getPage(r.page), at);
      clearBackground(f);
      if (!isBox && jane[name] && typeof jane[name] === "string") setText(f, jane[name]);
      (newRects[name] ||= []).push({ ...at, page: r.page });
    }
  }
  squiggle(doc.getPage(0), newRects["Recieving Cadet Signature"][0]);
  await printLabels(doc, doc.getPage(0), trects);
  await save(doc, "Jane Smith_Pos_F10_Community Service.pdf");

  // 3. Flattened F10 (values become page text), recipient signed, labels printed as text
  doc = await load(F10);
  fill(doc, { ...F10_VALUES, "Recieving Cadet Name": "Garcia, Maria L", "Recieving Cadet Year": "2027",
    "Conduct Narrative": "Late to SAMI by 4 minutes.", Tours: "", "POV Priv": "None" });
  rects = widgetRects(doc);
  squiggle(doc.getPage(0), rects["Recieving Cadet Signature"][0]);
  await printLabels(doc, doc.getPage(0), rects);
  doc.getForm().flatten();
  await save(doc, "Maria Garcia_Neg_F10_Late to SAMI.pdf");

  // 4. Scanned F10: rendered to a grayscale image and re-embedded slightly offset
  doc = await load(F10);
  fill(doc, { ...F10_VALUES, "Recieving Cadet Name": "Nguyen, Tam" });
  rects = widgetRects(doc);
  squiggle(doc.getPage(0), rects["AOC Signature"][0]);
  squiggle(doc.getPage(0), rects["Recieving Cadet Signature"][0]);
  const pngs = await scanPages(await doc.save(), 150);
  const scan = await PDFDocument.create();
  for (const png of pngs) {
    const img = await scan.embedPng(png);
    scan.addPage([612, 792]).drawImage(img, { x: 3, y: -4, width: 612, height: 792 });
  }
  await save(scan, "Tam Nguyen_Neg_F10_Room Inspection.pdf");

  // 5. F174 with an MFR page in front
  doc = await load(F174);
  fill(doc, {
    "Recieving Name": "Brown, Alex", "Recieving Grade": "C3C", "Recieving Unit/Office Symbol": "CS-07",
    "Reason for Counseling": "Repeated lateness to formation",
    "Couseling Summary": "Discussed three late arrivals this month and time-management expectations.",
    "Name Grade and Duty Title of Counselor": "C/SSgt Park, Flight Sergeant", "Couseling Date_af_date": "2026-09-18",
  });
  rects = widgetRects(doc);
  squiggle(doc.getPage(rects["Counselee Signature"][0].page), rects["Counselee Signature"][0]);
  const mfr = doc.insertPage(0, [612, 792]);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  mfr.drawText("MEMORANDUM FOR RECORD", { x: 72, y: 702, size: 14, font: helv });
  mfr.drawText("SUBJECT: Statement regarding counseling of C3C Brown", { x: 72, y: 672, size: 11, font: helv });
  await save(doc, "Alex Brown_Neg_F174_Late to Formation.pdf");

  // 6. Positive F174: counselee signed with an ink annotation, commander signed in ink
  doc = await load(F174);
  fill(doc, {
    "Recieving Name": "Cadet Patel, Riya", "Recieving Grade": "C2C", "Recieving Unit/Office Symbol": "CS-07",
    "Reason for Counseling": "Outstanding performance as element leader",
    "Couseling Summary": "Recognized for leading element to top inspection scores.",
    "Name Grade and Duty Title of Counselor": "C/MSgt Ortiz, First Sergeant", "Couseling Date_af_date": "09/20/2026",
  });
  rects = widgetRects(doc);
  const cs = rects["Counselee Signature"][0];
  inkAnnot(doc, doc.getPage(cs.page), cs);
  const cm = rects["Commander Signature"][0];
  squiggle(doc.getPage(cm.page), cm);
  await save(doc, "Riya Patel_Pos_F174_Element Leadership.pdf");

  // 7. Comma in the filename recipient is still ONE person ("Lee, Kevin" -> Kevin Lee)
  doc = await load(F10);
  fill(doc, { "Recieving Cadet Name": "Lee, Kevin", "Recieving Cadet Year": "2026", Date: "19 Sep 26", "Conduct Narrative": "Missed accountability formation." });
  await save(doc, "Lee, Kevin_Neg_F10_Missed Formation.pdf");

  // 8. Same cadet as #1 with a one-letter typo ("Jon" vs "John"): the app asks if they're the same
  doc = await load(F174);
  fill(doc, {
    "Recieving Name": "C4C Doe, Jon A", "Reason for Counseling": "Follow-up on uniform standards",
    "Couseling Summary": "Reviewed uniform standards after the 11 Sep report.",
    "Name Grade and Duty Title of Counselor": "C/SSgt Park, Flight Sergeant", "Couseling Date_af_date": "2026-09-16",
  });
  await save(doc, "Jon Doe_Neg_F174_Uniform Follow-up.pdf");

  // 9. Badly named file
  doc = await load(F10);
  fill(doc, { "Recieving Cadet Name": "Kim, Daniel", Date: "21 Sep 26", "Conduct Narrative": "Unsecured room." });
  await save(doc, "scan0042.pdf");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) {
    console.error("usage: node tools/make-samples.mjs <out_dir>   (never the real dump folder)");
    process.exit(1);
  }
  await makeSamples(path.resolve(process.argv[2]));
  console.log(`wrote 9 sample forms to ${path.resolve(process.argv[2])}`);
}
