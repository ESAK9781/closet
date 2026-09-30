// Re-take the landing page's screenshots from the real app, on made-up demo paperwork.
//
//   node tools/make-site-shots.mjs
//
// Writes site/*.webp. Uses tools/make-demo.mjs in a temp folder; never touches a real dump folder.

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { createCanvas, loadImage } from "@napi-rs/canvas";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

import { launch, settled } from "../test/e2e/launch.mjs";
import { makeDemo } from "./make-demo.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SITE = path.join(ROOT, "site");
const W = 1600;
const H = 940;

const tmp = mkdtempSync(path.join(os.tmpdir(), "closet-shots-"));
await makeDemo(path.join(tmp, "dump"));
const { app, page, errors } = await launch(path.join(tmp, "dump"), path.join(tmp, "userdata"));

const api = (method, url, body) => page.evaluate(([m, u, b]) => window.closet.api(m, u, b), [method, url, body]);
const go = async (view) => { await page.evaluate((v) => { location.hash = "#/" + v; }, view); await page.waitForTimeout(500); };

async function webp(png, name) {
  const img = await loadImage(png);
  const c = createCanvas(img.width, img.height);
  c.getContext("2d").drawImage(img, 0, 0);
  writeFileSync(path.join(SITE, name), await c.encode("webp", 90));
  console.log("wrote", name, img.width + "x" + img.height);
}
const shot = async (name) => { await page.evaluate(() => { window.scrollTo(0, 0); document.querySelectorAll("main, #main, .main").forEach((e) => e.scrollTo?.(0, 0)); }); await page.waitForTimeout(450); await webp(await page.screenshot({ type: "png" }), name); };

try {
  await settled(page);
  await app.evaluate(({ BrowserWindow }, [w, h]) => { const win = BrowserWindow.getAllWindows()[0]; win.unmaximize(); win.setContentSize(w, h); }, [W, H]);
  await page.waitForTimeout(600);

  // Realistic bookkeeping: most positives have CDNA/Passes, the oldest forms are already in the tracker.
  let s = await api("GET", "/api/state");
  const forms = s.forms.filter((f) => f.parsed);
  const pos = forms.filter((f) => f.record.form_type === "F10" && f.record.pos_neg === "Pos").sort((a, b) => a.record.date_iso.localeCompare(b.record.date_iso));
  for (const f of pos.slice(0, -2)) await api("PATCH", `/api/forms/${f.id}`, { overrides: { cdna: "No", passes: "None" } });
  const byDate = forms.slice().sort((a, b) => (a.record.date_iso || "").localeCompare(b.record.date_iso || ""));
  await api("POST", "/api/forms/bulk", { ids: byDate.slice(0, 14).map((f) => f.id), patch: { logged: true } });
  const quiet = forms.filter((f) => f.needs_review && !/scan0117|Monroe|Novak/.test(f.filename)).map((f) => f.id);
  if (quiet.length) await api("POST", "/api/forms/bulk", { ids: quiet, patch: { reviewed: true } });
  await page.waitForTimeout(800);
  s = await api("GET", "/api/state");
  console.log("forms:", s.forms.length, "needing review:", s.forms.filter((f) => f.needs_review).length);

  await go("overview");
  await shot("overview.webp");

  await go("paperwork");
  await shot("paperwork.webp");

  await page.click('tr[data-open]:has-text("Priya Raman")');
  await page.waitForSelector("#drawer.open");
  await page.waitForTimeout(900);
  await shot("form.webp");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  await go("review");
  const first = await page.$("[data-rid]:has-text('Missed Accountability')");
  if (first) { await first.click(); await page.waitForTimeout(800); }
  await shot("review.webp");

  await go("export");
  await shot("export.webp");

  // The AOC/AMT print packet's index sheet, rendered from the real quick-dump output.
  const out = path.join(tmp, "quick dump");
  const r = await api("POST", "/api/quick-dump", { out });
  console.log(JSON.stringify(r.folders.map((f) => [f.name, f.count])), "packet pages:", r.packetPages);
} finally {
  await app.close();
}

// Quick dump writes to the app's configured folder (default: next to the demo dump).
const qd = path.join(tmp, "quick dump");
const aoc = readdirSync(qd).find((d) => /AOC-AMT/.test(d));
const pdf = await pdfjs.getDocument({
  data: new Uint8Array(readFileSync(path.join(qd, aoc, "AOC-AMT packet (print).pdf"))), verbosity: 0, disableFontFace: true,
  standardFontDataUrl: path.join(ROOT, "node_modules/pdfjs-dist/standard_fonts").split(path.sep).join("/") + "/",
}).promise;
const pg = await pdf.getPage(1);
const vp = pg.getViewport({ scale: 3 });
const c = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
const ctx = c.getContext("2d");
ctx.fillStyle = "#fff";
ctx.fillRect(0, 0, c.width, c.height);
await pg.render({ canvas: c, canvasContext: ctx, viewport: vp }).promise;
// keep the title and the index lines, trimmed of margin so the text stays readable
const crop = createCanvas(1500, 560);
crop.getContext("2d").drawImage(c, 120, 90, 1500, 560, 0, 0, 1500, 560);
await webp(await crop.encode("png"), "packet.webp");

if (errors.length) console.log("page errors:", errors);
rmSync(tmp, { recursive: true, force: true });
