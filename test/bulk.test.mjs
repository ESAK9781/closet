// Bulk step completion: the same initials (and today's date) written into every form that still
// needs a step, as real PDF edits. Generated sample forms only.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { PDFDocument, PDFHexString, PDFName } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

import { fillSlots, xrefHealth } from "../src/core/signable.js";
import { Store } from "../src/core/store.js";
import { makeSamples } from "../tools/make-samples.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const F10 = fs.readFileSync(path.join(ROOT, "resources/templates/F10_nuked_final.pdf"));
let tmp;
let store;
const dir = (...p) => path.join(tmp, ...p);
const form = (n) => store.snapshot().forms.find((f) => f.filename.startsWith(n));
const detail = (n) => store.detail(form(n).id);
const settle = async () => {
  await store.whenIdle();
  await new Promise((r) => setTimeout(r, 200));
  await store.whenIdle();
};
const todayParts = () => {
  const d = new Date();
  return { y: String(d.getFullYear()).slice(2), d: String(d.getDate()).padStart(2, "0"), m: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()] };
};
const today = () => { const t = todayParts(); return `${t.d} ${t.m} ${t.y}`; };

async function widgetValues(bytes) {
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const doc = await task.promise;
  const out = {};
  for (let i = 1; i <= doc.numPages; i++) for (const a of await (await doc.getPage(i)).getAnnotations()) if (a.subtype === "Widget") (out[a.fieldName] ||= []).push(a.fieldValue);
  task.destroy();
  return out;
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "closet-bulk-"));
  await makeSamples(dir("dump"));
  // a flattened blank F10 (no fields at all) and one whose initials box is read-only
  const flat = await PDFDocument.load(F10);
  flat.getForm().getTextField("Recieving Cadet Name").setText("Flat, Blank");
  flat.getForm().flatten();
  fs.writeFileSync(dir("dump", "Blank Flat_Neg_F10_Test.pdf"), await flat.save());
  const ro = await PDFDocument.load(F10);
  ro.getForm().getTextField("Recieving Cadet Name").setText("Locked, Box");
  ro.getForm().getTextField("SQCCF Initials").enableReadOnly();
  fs.writeFileSync(dir("dump", "Locked Box_Neg_F10_Test.pdf"), await ro.save());
  store = new Store({ dumpDir: dir("dump"), metaDir: dir("metadata"), templatesDir: path.join(ROOT, "resources/templates") });
  await store.ready;
  await new Promise((r) => setTimeout(r, 500));
  await store.whenIdle();
});

after(async () => {
  await store?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("fillSlots: types into an empty field, lays a box on top where there is none, keeps the original bytes", async () => {
  const sq = [152 / 612, 1 - 387 / 792, 360 / 612, 1 - 373 / 792];
  const r = await fillSlots(F10, [{ page: 0, rect: sq, text: "ABC" }, { page: 0, rect: [0.1, 0.02, 0.3, 0.04], text: "XYZ" }]);
  assert.deepEqual(r.how, ["field", "overlay"]);
  assert.equal(r.mode, "incremental");
  assert.ok(r.bytes.subarray(0, F10.length).equals(F10));
  assert.deepEqual(xrefHealth(r.bytes).problems, []);
  const v = await widgetValues(r.bytes);
  assert.deepEqual(v["SQCCF Initials"], ["ABC"]);
  assert.deepEqual(v["closet text"], ["XYZ"]);
});

test("fillSlots: a read-only, already-filled, signature, or shared-name box gets an overlay instead", async () => {
  const doc = await PDFDocument.load(F10);
  doc.getForm().getTextField("SQCCF Initials").enableReadOnly();
  doc.getForm().getTextField("Cadet Initials").setText("OLD");
  const bytes = Buffer.from(await doc.save());
  const sq = [152 / 612, 1 - 387 / 792, 360 / 612, 1 - 373 / 792];
  const ci = [152 / 612, 1 - 345 / 792, 253 / 612, 1 - 331 / 792];
  const sig = [45 / 612, 1 - 166 / 792, 360 / 612, 1 - 152 / 792]; // a Signature field
  const el = [368 / 612, 1 - 387 / 792, 576 / 612, 1 - 373 / 792]; // "Element Lead Initials": one name, two boxes
  const r = await fillSlots(bytes, [sq, ci, sig, el].map((rect) => ({ page: 0, rect, text: "QQ" })));
  assert.deepEqual(r.how, ["overlay", "overlay", "overlay", "overlay"]);
  const v = await widgetValues(r.bytes);
  assert.deepEqual(v["Element Lead Initials"], ["", ""], "the field with two boxes was not typed into");
  assert.deepEqual(v["Cadet Initials"], ["OLD"]);
});

test("fillSlots: special characters can't break the PDF, and a signed PDF keeps its signed bytes", async () => {
  const doc = await PDFDocument.load(F10);
  doc.getForm().getField("AOC Signature").acroField.dict.set(PDFName.of("V"), doc.context.obj({ Type: "Sig", ByteRange: [0, 1, 2, 3], Contents: PDFHexString.of("00") }));
  const signed = Buffer.from(await doc.save());
  const r = await fillSlots(signed, [{ page: 0, rect: [0.2, 0.5, 0.4, 0.52], text: "A(B)\\C" }]);
  assert.ok(r.bytes.subarray(0, signed.length).equals(signed));
  assert.equal(r.mode, "incremental");
  assert.deepEqual((await widgetValues(r.bytes))["closet text"], ["A(B)\\C"]);
});

test("plan: only forms waiting on the step, where the boxes are", () => {
  const plan = store.bulkPlan("sqccf_processed");
  const names = plan.forms.map((f) => f.filename.split("_")[0]);
  assert.ok(names.includes("Lee, Kevin") && names.includes("Blank Flat") && names.includes("Locked Box"), names.join());
  assert.ok(!names.includes("John Doe"), "John Doe's SQ/CCF is done");
  assert.ok(!names.some((n) => /Riya|Alex|Jon Doe/.test(n)), "the 174 has no SQ/CCF step");
  const lee = plan.forms.find((f) => f.filename.startsWith("Lee"));
  assert.deepEqual(lee.items.map((i) => i.key).sort(), ["login_date", "sqccf_initials"]);
  assert.throws(() => store.bulkPlan("aoc_signed"), /bulk/);
});

test("SQ/CCF in bulk: initials and today's date written into every form, flags set, originals backed up", async () => {
  const lee0 = fs.readFileSync(dir("dump", form("Lee, Kevin").filename));
  const john0 = fs.statSync(dir("dump", form("John Doe").filename)).mtimeMs;
  const r = await store.bulkStep("sqccf_processed", "ejs");
  assert.deepEqual(r.failed, []);
  assert.ok(r.done.length >= 3);
  assert.equal(store.settings.bulk_initials.sqccf_processed, "ejs", "remembered");
  await settle();
  for (const n of ["Lee, Kevin", "Blank Flat", "Locked Box"]) {
    const f = form(n);
    assert.equal(f.record.sqccf_processed, true, `${n} flag`);
    const a = detail(n).analysis.slots;
    assert.equal(a.sqccf_initials.value, "ejs", `${n} initials are in the PDF, not just a flag`);
    assert.equal(a.login_date.value, today(), `${n} date`);
    assert.match(detail(n).history.at(-1).what, /Bulk SQ\/CCF processing/);
  }
  assert.ok(fs.readFileSync(dir("dump", form("Lee, Kevin").filename)).subarray(0, lee0.length).equals(lee0), "edit appended to the original");
  assert.equal(fs.statSync(dir("dump", form("John Doe").filename)).mtimeMs, john0, "forms that didn't need it were not touched");
  const backups = fs.readdirSync(dir("metadata", "backups"));
  assert.ok(backups.length >= 3);
  assert.deepEqual(store.bulkPlan("sqccf_processed").forms, [], "nothing left to do");
});

test("the date is only written when the setting is on, and an existing date is kept", async () => {
  store.updateSettings({ first_shirt_fill_date: false });
  const doc = await PDFDocument.load(F10);
  doc.getForm().getTextField("Recieving Cadet Name").setText("Nodate, Nora");
  fs.writeFileSync(dir("dump", "Nora Nodate_Neg_F10_Test.pdf"), await doc.save());
  const doc2 = await PDFDocument.load(F10);
  doc2.getForm().getTextField("Recieving Cadet Name").setText("Hasdate, Hal");
  doc2.getForm().getTextField("Initial Processing Date").setText("01 Jan 26");
  fs.writeFileSync(dir("dump", "Hal Hasdate_Neg_F10_Test.pdf"), await doc2.save());
  store.scan();
  await settle();
  await store.bulkStep("sqccf_processed", "EJS");
  await settle();
  assert.equal(detail("Nora Nodate").analysis.slots.sqccf_initials.value, "EJS");
  assert.equal(detail("Nora Nodate").analysis.slots.login_date.value, "", "setting off: no date");
  // Hal's date box has a date but no initials: initials are added, the date stays
  assert.equal(detail("Hal Hasdate").analysis.slots.login_date.value, "01 Jan 26");
  store.updateSettings({ first_shirt_fill_date: true });
});

test("Cadet Commander in bulk: initials and the date in Section V box 3", async () => {
  const plan = store.bulkPlan("cadet_cc_initialed");
  assert.ok(plan.forms.length >= 3);
  assert.ok(plan.forms.every((f) => f.items.some((i) => i.key === "cadet_sqcc_date")), "dates are always filled for this step");
  const r = await store.bulkStep("cadet_cc_initialed", "RTH");
  assert.deepEqual(r.failed, []);
  await settle();
  for (const n of ["Lee, Kevin", "Blank Flat"]) {
    assert.equal(form(n).record.cadet_cc_initialed, true);
    const s = detail(n).analysis.slots || assert.fail(`${n}: ${JSON.stringify(detail(n).analysis).slice(0, 300)}`);
    assert.equal(s.cadet_sqcc_initials.value, "RTH");
    assert.equal(s.cadet_sqcc_date.value, today());
    assert.match(s.sqccf_initials.value, /^ejs$/i, "the earlier step's initials are still there");
  }
  await assert.rejects(store.bulkStep("recipient_signed", "X"), /bulk/);
});

test("bad initials are refused before anything is written", async () => {
  await assert.rejects(store.bulkStep("sqccf_processed", ""), /Enter the initials/);
  await assert.rejects(store.bulkStep("sqccf_processed", "waytoolonginitials"), /8 printable/);
});

test("a form closet can't edit is reported, not silently skipped, and the rest still go through", async () => {
  const doc = await PDFDocument.load(F10);
  doc.getForm().getTextField("Recieving Cadet Name").setText("Cert, Cy");
  const ref = doc.context.obj({ Type: "SigRef", TransformMethod: "DocMDP", TransformParams: { Type: "TransformParams", P: 1, V: PDFName.of("1.2") } });
  doc.catalog.set(PDFName.of("Perms"), doc.context.obj({ DocMDP: { Type: "Sig", ByteRange: [0, 1, 2, 3], Contents: PDFHexString.of("00"), Reference: [ref] } }));
  fs.writeFileSync(dir("dump", "Cy Cert_Neg_F10_Test.pdf"), await doc.save());
  const doc2 = await PDFDocument.load(F10);
  doc2.getForm().getTextField("Recieving Cadet Name").setText("Fine, Fran");
  fs.writeFileSync(dir("dump", "Fran Fine_Neg_F10_Test.pdf"), await doc2.save());
  store.scan();
  await settle();
  const r = await store.bulkStep("sqccf_processed", "EJS");
  assert.equal(r.failed.length, 1);
  assert.match(r.failed[0].filename, /Cert/);
  assert.match(r.failed[0].error, /certified/);
  assert.ok(r.done.some((id) => id === form("Fran Fine").id));
  assert.equal(form("Cy Cert").record.sqccf_processed, false, "the failed form is not marked done");
});

test("per form: only the chosen form is initialed", async () => {
  const doc = await PDFDocument.load(F10);
  doc.getForm().getTextField("Recieving Cadet Name").setText("Solo, Sam");
  fs.writeFileSync(dir("dump", "Sam Solo_Neg_F10_Test.pdf"), await doc.save());
  const doc2 = await PDFDocument.load(F10);
  doc2.getForm().getTextField("Recieving Cadet Name").setText("Other, Olly");
  fs.writeFileSync(dir("dump", "Olly Other_Neg_F10_Test.pdf"), await doc2.save());
  store.scan();
  await settle();
  const sam = form("Sam Solo");
  assert.deepEqual(store.bulkPlan("sqccf_processed", [sam.id]).forms.map((f) => f.id), [sam.id]);
  const olly0 = fs.statSync(dir("dump", form("Olly Other").filename)).mtimeMs;
  const r = await store.bulkStep("sqccf_processed", "SSG", [sam.id]);
  assert.deepEqual(r.done, [sam.id]);
  await settle();
  assert.equal(form("Sam Solo").record.sqccf_processed, true);
  assert.equal(form("Olly Other").record.sqccf_processed, false);
  assert.equal(fs.statSync(dir("dump", form("Olly Other").filename)).mtimeMs, olly0);
});

test("AOC/AMT approval stamp: the empty box goes, a red stamp and the flags take its place", async () => {
  const lee = form("Lee, Kevin");
  store.updateForm(lee.id, { overrides: { recipient_signed: true } });
  assert.equal(form("Lee, Kevin").record.aoc_signed, false);
  const before = fs.readFileSync(dir("dump", lee.filename));
  const r = await store.approveAoc(lee.id);
  assert.equal(r.removed, true);
  await settle();
  const f = form("Lee, Kevin");
  assert.equal(f.record.aoc_signed, true);
  const slot = detail("Lee, Kevin").analysis.slots.sig_aoc;
  assert.equal(slot.filled, true);
  assert.equal(slot.source, "annotation", "read as marked, from the stamp itself");
  assert.match(detail("Lee, Kevin").history.at(-1).what, /approved by First Sergeant \(unofficial\)/);
  const after = fs.readFileSync(dir("dump", lee.filename));
  assert.ok(after.subarray(0, before.length).equals(before), "appended to the original");
  const w = await widgetValues(after);
  assert.equal(w["AOC Signature"], undefined, "the unfilled signature field is gone");
  const task = pdfjs.getDocument({ data: new Uint8Array(after), verbosity: 0 });
  const stamps = (await (await (await task.promise).getPage(1)).getAnnotations()).filter((a) => a.subtype === "Stamp");
  task.destroy();
  assert.equal(stamps.length, 1);
  assert.match(stamps[0].contentsObj?.str || stamps[0].contents || "", /AOC\/AMT Approved/);
  assert.ok(fs.readdirSync(dir("metadata", "backups")).some((n) => n.startsWith(lee.id)), "original kept");
  await assert.rejects(store.approveAoc(lee.id), /already has its AOC\/AMT/);
});

test("AOC/AMT approval on an AF 174 stamps the commander box and dates the commander date", async () => {
  const jon = form("Jon Doe");
  assert.equal(jon.record.aoc_signed, false);
  const r = await store.approveAoc(jon.id);
  assert.equal(r.dated, 1);
  await settle();
  const s = detail("Jon Doe").analysis.slots;
  assert.equal(form("Jon Doe").record.aoc_signed, true);
  assert.equal(s.sig_commander.filled, true);
  const d = new Date();
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  assert.equal(s.commander_date.value, iso, "this form writes its dates as ISO, so the written date matches");
});

test("approval refuses a box that already holds a digital signature, and an F10 with no AOC step done wrongly", async () => {
  const doc = await PDFDocument.load(F10);
  doc.getForm().getTextField("Recieving Cadet Name").setText("Signed, Sig");
  doc.getForm().getField("AOC Signature").acroField.dict.set(PDFName.of("V"), doc.context.obj({ Type: "Sig", ByteRange: [0, 1, 2, 3], Contents: PDFHexString.of("00") }));
  const bytes = Buffer.from(await doc.save());
  const { approveAoc } = await import("../src/core/signable.js");
  await assert.rejects(approveAoc(bytes, { page: 0, rect: [153 / 612, 1 - 121 / 792, 389 / 612, 1 - 107 / 792], expandDown: 28, small: "x", big: "y", date: "" }), /digital signature/);
});
