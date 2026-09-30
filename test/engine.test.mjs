// Reads a freshly generated set of sample forms (never real paperwork) through the whole pipeline:
// parser threads -> analysis -> records -> sheet rows.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { Store } from "../src/core/store.js";
import { makeSamples } from "../tools/make-samples.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
let tmp;
let store;
let snap;

const byFile = (name) => snap.forms.find((f) => f.filename.startsWith(name));
const row = (name, i = 0) => Object.fromEntries(snap.columns.map((c, j) => [c, byFile(name).rows[i][j]]));
const flags = (name) => ["sqccf_processed", "recipient_signed", "aoc_signed"].map((k) => byFile(name).record[k]);
const ccFlag = (name) => byFile(name).record.cadet_cc_initialed;
const reviewText = (name) => byFile(name).issues.filter((i) => i.level === "review").map((i) => i.text).join(" | ");

before(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "closet-test-"));
  await makeSamples(path.join(tmp, "dump"));
  store = new Store({ dumpDir: path.join(tmp, "dump"), metaDir: path.join(tmp, "metadata"), templatesDir: path.join(ROOT, "resources/templates") });
  await store.ready;
  await new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const done = store.metas.size === 9 && [...store.metas.values()].every((m) => m.analysis) && !store.queue.length && !store.inFlight.size;
      if (done) { clearInterval(iv); resolve(); }
      if (Date.now() - t0 > 120000) { clearInterval(iv); reject(new Error("timed out reading samples")); }
    }, 100);
  });
  snap = store.snapshot();
});

after(async () => {
  await store?.close();
  rmSync(tmp, { recursive: true, force: true });
});

test("fillable F10: every field matched, wet-ink AOC signature found", () => {
  const f = byFile("John Doe");
  assert.equal(f.mode, "fields");
  assert.equal(f.needs_review, false);
  assert.deepEqual(flags("John Doe"), [true, false, true]);
  assert.equal(ccFlag("John Doe"), true, "cadet commander initials (section V box 3) found");
  const r = row("John Doe");
  assert.equal(r.Name, "John A Doe");
  assert.equal(r["Class Year"], "2028");
  assert.equal(r.Date, "2026-09-12");
  assert.equal(r.Issuer, "C/Capt Sarah K Mitchell");
  assert.deepEqual([r.Demerits, r.Tours, r.Confinements, r.Other], ["5", "2", "1", "Loss of pass: 1 weekend"]);
});

test("recreated F10 with renamed, shifted fields and printed labels", () => {
  const f = byFile("Jane Smith");
  assert.equal(f.mode, "fields");
  assert.equal(f.needs_review, false);
  const r = row("Jane Smith");
  assert.equal(r.Name, "Jane Smith", "rank stripped, Last, First reordered");
  assert.deepEqual([r.Demerits, r.Tours, r.Confinements, r.Other], ["0", "0", "0", ""], "blank counts are 0, N/A pass is nothing");
  assert.deepEqual(f.incomplete, ["CDNA", "Passes"], "positive F10 needs CDNA and Passes");
  assert.equal(flags("Jane Smith")[1], true, "recipient signature drawn in ink");
});

test("flattened F10 read from text positions, labels not mistaken for values", () => {
  const r = row("Maria Garcia");
  assert.equal(byFile("Maria Garcia").mode, "text");
  assert.match(reviewText("Maria Garcia"), /flattened/);
  assert.deepEqual([r.Name, r["Class Year"], r.Demerits, r.Tours, r.Confinements, r.Other], ["Maria L Garcia", "2027", "5", "0", "1", "Loss of pass: 1 weekend"]);
  assert.equal(flags("Maria Garcia")[2], false, "the template's SIGN tag isn't a signature");
});

test("scanned F10: aligned to the template, ink found, counts left for a person to type", () => {
  const f = byFile("Tam Nguyen");
  assert.equal(f.mode, "raster");
  assert.match(reviewText("Tam Nguyen"), /Scanned/);
  const a = store.detail(f.id).analysis;
  assert.deepEqual(Object.values(a.registration)[0], [3, 4], "3 pt right, 4 pt down");
  assert.deepEqual(flags("Tam Nguyen"), [true, true, true]);
  assert.equal(a.slots.mfr_no.value, true);
  assert.equal(a.slots.mfr_yes.value, "", "empty checkbox stays empty despite the offset");
  const r = row("Tam Nguyen");
  assert.deepEqual([r.Demerits, r.Tours], ["", ""]);
});

test("F174 with an extra page: form pages found, flagged for review", () => {
  const a = store.detail(byFile("Alex Brown").id).analysis;
  assert.deepEqual(a.page_map, [1, 2]);
  assert.match(reviewText("Alex Brown"), /3 pages/);
  assert.equal(flags("Alex Brown")[1], true);
  assert.deepEqual([row("Alex Brown").Demerits, row("Alex Brown").CDNA], ["", ""], "174s have no sanctions or CDNA");
});

test("F174: ink-annotation signature and commander block", () => {
  assert.deepEqual(flags("Riya Patel"), [null, true, true]);
  assert.equal(ccFlag("Riya Patel"), null, "the 174 has no cadet commander box");
  assert.equal(row("Riya Patel").Name, "Riya Patel");
  assert.equal(row("Riya Patel").Date, "2026-09-20");
});

test("names: comma in filename is one person; near-duplicates are offered for merging", () => {
  assert.equal(byFile("Lee, Kevin").rows.length, 1);
  assert.equal(row("Lee, Kevin").Name, "Kevin Lee");
  assert.deepEqual(snap.name_pairs.map((p) => [p.a, p.b]), [["John A Doe", "Jon A Doe"]]);
});

test("bad filename: form still read from the pages, flagged for Pos/Neg", () => {
  assert.equal(byFile("scan0042").record.form_type, "F10");
  assert.match(reviewText("scan0042"), /Pos\/Neg/);
  assert.equal(row("scan0042").Name, "Daniel Kim");
});

test("edits: typed recipients split into rows; archived forms leave counts and exports", () => {
  const id = byFile("John Doe").id;
  store.updateForm(id, { overrides: { recipients: "John A Doe, Carl Diaz", class_year: "2028, 2029" } });
  let s = store.snapshot();
  assert.deepEqual(s.forms.find((f) => f.id === id).rows.map((r) => `${r[6]}=${r[1]}`), ["John A Doe=2028", "Carl Diaz=2029"]);
  store.updateForm(id, { archived: true });
  assert.ok(!store.exportTsv([], false).includes("John A Doe"));
  store.updateForm(id, { archived: false });
  assert.ok(store.exportTsv([], false).includes("Carl Diaz"));
});

test("printed, signed and scanned back in: earlier read kept, sent back for review", async () => {
  const id = byFile("Jane Smith").id;
  store.updateForm(id, { reviewed: true });
  const before = store.snapshot().forms.find((f) => f.id === id);
  assert.equal(before.mode, "fields");
  store.replaceFile(id, path.join(tmp, "dump", byFile("Tam Nguyen").filename)); // a raster copy
  await new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (store.metas.get(id).scan_replaced_at && !store.inFlight.size && !store.queue.length) { clearInterval(iv); resolve(); }
      if (Date.now() - t0 > 60000) { clearInterval(iv); reject(new Error("timed out re-reading")); }
    }, 100);
  });
  const after = store.snapshot().forms.find((f) => f.id === id);
  assert.equal(after.needs_review, true);
  assert.match(after.issues.map((i) => i.text).join(" | "), /scanned copy/i);
  assert.equal(after.mode, "fields", "not re-read as a scan");
  assert.deepEqual([after.record.recipients, after.record.squadron], [before.record.recipients, before.record.squadron]);
  assert.equal(store.detail(id).analysis.scanned_copy, true);
});

test("quick dump: forms sorted by first open step, AOC/AMT folder gets an indexed print packet", async () => {
  const { PDFDocument } = await import("pdf-lib");
  const fs = await import("node:fs");
  const r = await store.quickDump(path.join(tmp, "quick out"));
  const total = r.folders.reduce((n, f) => n + f.count, 0);
  assert.equal(total + r.skipped, store.snapshot().forms.filter((f) => !f.archived && !f.missing).length);
  const dirOf = (key) => path.join(r.dir, r.folders.find((f) => f.key === key).name);
  assert.ok(fs.existsSync(path.join(dirOf("recipient_signed"), byFile("John Doe").filename)), "John Doe waits on the recipient");
  const packetDir = dirOf("aoc_signed");
  const packet = fs.readdirSync(packetDir).find((n) => /packet/i.test(n));
  assert.ok(r.packetForms === 0 ? !packet : packet, "packet exists exactly when the AOC/AMT folder has forms");
  if (packet) {
    const pdf = await PDFDocument.load(fs.readFileSync(path.join(packetDir, packet)));
    assert.ok(pdf.getPageCount() > r.packetForms, "index sheet plus every form page");
  }
});
