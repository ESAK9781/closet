// Quick dump: copy every active form into a folder per routing step, by the first step it is
// still waiting on. The originals are only ever read. Each run rebuilds the five step folders in
// the chosen output folder (and nothing else in it, so it can be any folder the user picked).
//
// The last-step folder also gets one combined PDF for printing: an index sheet, then every form's
// pages as the app shows them (the cached page images, so typed field values are on the paper).

import fs from "node:fs";
import path from "node:path";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { FLAG_DEFS } from "./templates.js";

const PACKET_STEP = "aoc_signed";
const PACKET_NAME = "AOC-AMT packet (print).pdf";

const folderNames = [...FLAG_DEFS.map(([k, , short], i) => [k, `${i + 1} - Needs ${short}`]), ["complete", `${FLAG_DEFS.length + 1} - Fully complete`]];

const firstOpenStep = (rec) => FLAG_DEFS.find(([k]) => rec[k] === false)?.[0] ?? "complete"; // null = n/a on this form

export async function quickDump(store, out) {
  if (!out) throw new Error("No quick dump folder is set");
  const counts = {};
  const packet = [];
  let skipped = 0;
  for (const [key, name] of folderNames) {
    fs.rmSync(path.join(out, name), { recursive: true, force: true }); // our own previous output
    fs.mkdirSync(path.join(out, name), { recursive: true });
    counts[key] = 0;
  }
  const dirOf = Object.fromEntries(folderNames);
  const forms = store.snapshot().forms.filter((f) => !f.archived && !f.missing);
  for (const f of forms) {
    const src = store.pdfPath(f.id);
    if (!f.parsed || f.pending || !src) { skipped++; continue; }
    const step = firstOpenStep(f.record);
    fs.copyFileSync(src, path.join(out, dirOf[step], f.filename));
    counts[step]++;
    if (step === PACKET_STEP) packet.push(f);
  }
  let packetPages = 0;
  if (packet.length) {
    packet.sort((a, b) => (a.record.date_iso || "9999").localeCompare(b.record.date_iso || "9999") || a.filename.localeCompare(b.filename));
    const pdf = await buildPacket(store, packet);
    fs.writeFileSync(path.join(out, dirOf[PACKET_STEP], PACKET_NAME), pdf.bytes);
    packetPages = pdf.pages;
  }
  return { dir: out, folders: folderNames.map(([key, name]) => ({ key, name, count: counts[key] })), skipped, packetForms: packet.length, packetPages };
}

async function buildPacket(store, forms) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const body = await PDFDocument.create();
  const starts = [];
  for (const f of forms) {
    starts.push(body.getPageCount() + 1);
    const d = store.detail(f.id).analysis;
    for (const r of d.renders || []) {
      const img = store.pageImage(f.id, r.page);
      if (!img) continue;
      const jpg = await body.embedJpg(fs.readFileSync(img));
      body.addPage([r.w, r.h]).drawImage(jpg, { x: 0, y: 0, width: r.w, height: r.h });
    }
  }

  // index sheet(s): one line per form, page numbers counted after the index itself
  const W = 612, H = 792, M = 48, LINE = 15;
  const perPage = Math.floor((H - 2 * M - 70) / LINE);
  const indexPages = Math.max(1, Math.ceil(forms.length / perPage));
  const safe = (s) => String(s ?? "").replace(/[^\x20-\x7e\xa0-\xff]/g, "?");
  const fit = (s, f, size, width) => {
    s = safe(s);
    if (f.widthOfTextAtSize(s, size) <= width) return s;
    while (s.length > 1 && f.widthOfTextAtSize(s + "...", size) > width) s = s.slice(0, -1);
    return s + "...";
  };
  for (let p = 0; p < indexPages; p++) {
    const page = doc.addPage([W, H]);
    let y = H - M;
    page.drawText(p === 0 ? "AOC/AMT signature packet" : "AOC/AMT signature packet (continued)", { x: M, y, size: 16, font: bold });
    y -= 20;
    page.drawText(`${forms.length} form${forms.length === 1 ? "" : "s"}, prepared ${new Date().toISOString().slice(0, 10)}`, { x: M, y, size: 9, font, color: rgb(0.35, 0.35, 0.35) });
    y -= 26;
    page.drawText("Pg", { x: M, y, size: 8.5, font: bold });
    page.drawText("Date", { x: M + 30, y, size: 8.5, font: bold });
    page.drawText("Original file / recipient", { x: M + 92, y, size: 8.5, font: bold });
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: rgb(0.5, 0.5, 0.5) });
    y -= LINE - 3;
    for (let i = p * perPage; i < Math.min(forms.length, (p + 1) * perPage); i++) {
      const f = forms[i];
      const r = f.record;
      const tag = [r.form_type, r.pos_neg].filter(Boolean).join(" ");
      page.drawText(String(starts[i] + indexPages), { x: M, y, size: 9, font });
      page.drawText(safe(r.date_iso || r.date || "no date"), { x: M + 30, y, size: 9, font });
      const line = `${f.filename}  |  ${r.recipients || "no name"}${tag ? `  |  ${tag}` : ""}`;
      page.drawText(fit(line, font, 9, W - M - (M + 92)), { x: M + 92, y, size: 9, font });
      y -= LINE;
    }
  }
  const bodyPages = await doc.copyPages(body, body.getPageIndices());
  bodyPages.forEach((p) => doc.addPage(p));
  return { bytes: await doc.save(), pages: doc.getPageCount() };
}
