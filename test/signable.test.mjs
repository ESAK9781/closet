// The "can this really be signed in Adobe?" check, and the field closet adds on top when it can't.
// Every case is built from the blank template (never real paperwork).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { degrees, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

import { addField, inspect, xrefHealth } from "../src/core/signable.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const F10 = readFileSync(path.join(ROOT, "resources/templates/F10_nuked_final.pdf"));
const N = (s) => PDFName.of(s);
const SIG = "Recieving Cadet Signature";

const load = (b) => PDFDocument.load(b, { updateMetadata: false });
const fieldDict = (doc, name) => doc.getForm().getField(name).acroField.dict;
const refOf = (doc, name) => doc.getForm().getField(name).acroField.ref;

/** Top-left normalized rect of a template field, the way the parser reports slot positions. */
async function targetOf(name, kind = "Signature") {
  const doc = await load(F10);
  const field = doc.getForm().getField(name);
  const w = field.acroField.getWidgets()[0];
  const r = w.getRectangle();
  const pages = doc.getPages();
  const page = pages.findIndex((p) => p.node.Annots()?.asArray().some((a) => String(a) === String(doc.context.getObjectRef(w.dict))));
  const { width: W, height: H } = pages[page].getSize();
  return { page, rect: [r.x / W, 1 - (r.y + r.height) / H, (r.x + r.width) / W, 1 - r.y / H], kind };
}

async function mutate(fn) {
  const doc = await load(F10);
  await fn(doc);
  return Buffer.from(await doc.save({ updateFieldAppearances: false }));
}

const codes = (r) => r.issues.map((i) => i.code);

async function pdfjsWidgets(bytes) {
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const doc = await task.promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    for (const a of await page.getAnnotations()) {
      if (a.subtype !== "Widget") continue;
      const [x0, y0] = vp.convertToViewportPoint(a.rect[0], a.rect[1]);
      const [x1, y1] = vp.convertToViewportPoint(a.rect[2], a.rect[3]);
      out.push({ page: i - 1, name: a.fieldName, type: a.fieldType, readOnly: a.readOnly,
        norm: [Math.min(x0, x1) / vp.width, Math.min(y0, y1) / vp.height, Math.max(x0, x1) / vp.width, Math.max(y0, y1) / vp.height] });
    }
  }
  task.destroy();
  return out;
}

const near = (a, b, eps = 0.002) => a.every((v, i) => Math.abs(v - b[i]) < eps);

test("the blank template: recipient signature and initials boxes are usable", async () => {
  for (const [name, kind] of [[SIG, "Signature"], ["SQCCF Initials", "Text"], ["Cadet SQCC Initials", "Text"]]) {
    const r = await inspect(F10, await targetOf(name, kind));
    assert.equal(r.ok, true, `${name}: ${codes(r)}`);
    assert.equal(r.field.name, name);
  }
  assert.deepEqual(xrefHealth(F10).problems, []);
});

test("the blank template's AOC signature holds an empty signature value: Adobe won't sign it", async () => {
  const r = await inspect(F10, await targetOf("AOC Signature"));
  assert.deepEqual(codes(r), ["blank-value"]);
  assert.equal(r.fixable, true);
});

const CASES = [
  ["read-only flag", "read-only", (doc) => fieldDict(doc, SIG).set(N("Ff"), PDFNumber.of(1))],
  ["hidden", "hidden", (doc) => fieldDict(doc, SIG).set(N("F"), PDFNumber.of(2 | 4))],
  ["box marked read-only", "annot-read-only", (doc) => fieldDict(doc, SIG).set(N("F"), PDFNumber.of(4 | 64))],
  ["text box where the signature goes", "wrong-type", (doc) => fieldDict(doc, SIG).set(N("FT"), N("Tx"))],
  ["no field type at all", "not-a-field", (doc) => fieldDict(doc, SIG).delete(N("FT"))],
  ["a real signature already in it", "signed", (doc) => fieldDict(doc, SIG).set(N("V"), doc.context.obj({ Type: "Sig", ByteRange: [0, 10, 20, 30], Contents: PDFHexString.of("00") }))],
  ["something odd as its value", "bad-value", (doc) => fieldDict(doc, SIG).set(N("V"), PDFString.of("x"))],
  ["says it's on another page", "wrong-page", (doc) => fieldDict(doc, SIG).set(N("P"), doc.getPages()[1].ref)],
  ["not in the form's field list", "orphan", (doc) => {
    const fields = doc.catalog.lookup(N("AcroForm")).lookup(N("Fields"));
    const i = fields.asArray().findIndex((r) => String(r) === String(refOf(doc, SIG)));
    fields.remove(i);
  }],
  ["no field there at all", "missing", (doc) => {
    const ref = refOf(doc, SIG);
    const fields = doc.catalog.lookup(N("AcroForm")).lookup(N("Fields"));
    fields.remove(fields.asArray().findIndex((r) => String(r) === String(ref)));
    for (const p of doc.getPages()) {
      const a = p.node.Annots();
      const i = a?.asArray().findIndex((r) => String(r) === String(ref)) ?? -1;
      if (i >= 0) a.remove(i);
    }
  }],
  ["two root fields with the same name", "duplicate-name", (doc) => {
    const copy = fieldDict(doc, SIG).clone(doc.context);
    copy.set(N("Rect"), doc.context.obj([20, 20, 120, 40]));
    const ref = doc.context.register(copy);
    doc.catalog.lookup(N("AcroForm")).lookup(N("Fields")).push(ref);
    doc.getPages()[0].node.Annots().push(ref);
  }],
  ["one signature field with two boxes (merged copies)", "shared", (doc) => {
    const ctx = doc.context;
    const ref = refOf(doc, SIG);
    const w1 = fieldDict(doc, SIG);
    const w2 = w1.clone(ctx);
    const parent = ctx.obj({ FT: "Sig", Kids: [] });
    parent.set(N("T"), PDFString.of(SIG));
    const pRef = ctx.register(parent);
    for (const w of [w1, w2]) for (const k of ["T", "FT", "Ff", "V"]) w.delete(N(k));
    w1.set(N("Parent"), pRef);
    w2.set(N("Parent"), pRef);
    w2.set(N("Rect"), ctx.obj([20, 20, 120, 40]));
    const w2Ref = ctx.register(w2);
    parent.lookup(N("Kids")).push(ref);
    parent.lookup(N("Kids")).push(w2Ref);
    doc.getPages()[0].node.Annots().push(w2Ref);
    const fields = doc.catalog.lookup(N("AcroForm")).lookup(N("Fields"));
    fields.set(fields.asArray().findIndex((r) => String(r) === String(ref)), pRef);
  }],
  ["locked by an earlier signature (FieldMDP)", "locked", (doc) => {
    const ctx = doc.context;
    const lock = ctx.obj({ Type: "SigRef", TransformMethod: "FieldMDP", TransformParams: { Type: "TransformParams", Action: "Include", Fields: [PDFString.of(SIG)] } });
    fieldDict(doc, "Awarding Official Signature").set(N("V"), ctx.obj({ Type: "Sig", ByteRange: [0, 1, 2, 3], Contents: PDFHexString.of("00"), Reference: [lock] }));
  }],
  ["corrupt appearance stream", "bad-appearance", (doc) => {
    const bad = doc.context.flateStream("q Q");
    const raw = doc.context.stream(Buffer.from("this is not deflate data"), { Filter: "FlateDecode", Type: "XObject", Subtype: "Form", BBox: [0, 0, 10, 10] });
    void bad;
    fieldDict(doc, SIG).set(N("AP"), doc.context.obj({ N: doc.context.register(raw) }));
  }],
  ["Reader usage rights broken by a later edit", "rights", (doc) => {
    doc.catalog.set(N("Perms"), doc.context.obj({ UR3: { Type: "Sig", ByteRange: [0, 10, 20, 30] } }));
  }],
  ["an XFA layer", "xfa", (doc) => doc.catalog.lookup(N("AcroForm")).set(N("XFA"), doc.context.obj([]))],
];

for (const [what, code, fn] of CASES) {
  test(`caught: ${what}; a field added on top fixes it`, async () => {
    const bytes = await mutate(fn);
    const target = await targetOf(SIG);
    const r = await inspect(bytes, target);
    assert.equal(r.ok, false);
    assert.ok(codes(r).includes(code), `expected ${code}, got ${codes(r)}`);
    assert.equal(r.fixable, true, codes(r).join());
    const fixed = await addField(bytes, target, "Recipient signature");
    assert.equal(fixed.mode, "incremental");
    assert.ok(fixed.bytes.subarray(0, bytes.length).equals(bytes), "original bytes kept as they were");
    assert.deepEqual(xrefHealth(fixed.bytes).problems, []);
    const after = await inspect(fixed.bytes, target);
    assert.equal(after.ok, true, after.issues.map((i) => i.text).join("; "));
    assert.equal(after.field.name, fixed.name);
    const w = (await pdfjsWidgets(fixed.bytes)).find((x) => x.name === fixed.name);
    assert.ok(w, "pdf.js sees the new field");
    assert.deepEqual([w.type, w.readOnly, w.page], ["Sig", false, target.page]);
    assert.ok(near(w.norm, target.rect), `placed on the spot: ${w.norm} vs ${target.rect}`);
  });
}

test("initials box limited to one character, and a fresh text box on top", async () => {
  const bytes = await mutate((doc) => fieldDict(doc, "SQCCF Initials").set(N("MaxLen"), PDFNumber.of(1)));
  const target = await targetOf("SQCCF Initials", "Text");
  assert.deepEqual(codes(await inspect(bytes, target)), ["max-length"]);
  const fixed = await addField(bytes, target, "SQ-CCF processing");
  assert.equal((await inspect(fixed.bytes, target)).ok, true);
  const w = (await pdfjsWidgets(fixed.bytes)).find((x) => x.name === fixed.name);
  assert.equal(w.type, "Tx");
});

test("security settings that forbid signing can't be fixed; allowed ones aren't a problem", async () => {
  const enc = (P) => mutate((doc) => {
    doc.context.trailerInfo.Encrypt = doc.context.register(doc.context.obj({ Filter: "Standard", V: 2, R: 3, Length: 128, P, O: PDFHexString.of("00"), U: PDFHexString.of("00") }));
  });
  const target = await targetOf(SIG);
  const locked = await inspect(await enc(-3904), target);
  assert.deepEqual(codes(locked), ["secured"]);
  assert.equal(locked.fixable, false);
  const allowed = await inspect(await enc(-3904 | 32 | 256), target);
  assert.equal(allowed.ok, true, codes(allowed).join());
  assert.match(allowed.blocked, /encrypted/);
  await assert.rejects(addField(await enc(-3904 | 32 | 256), target), /encrypted/);
});

test("certified documents: no-changes can't be signed; others can't take a new field", async () => {
  const cert = (P) => mutate((doc) => {
    const ref = doc.context.obj({ Type: "SigRef", TransformMethod: "DocMDP", TransformParams: { Type: "TransformParams", P, V: N("1.2") } });
    doc.catalog.set(N("Perms"), doc.context.obj({ DocMDP: { Type: "Sig", ByteRange: [0, 1, 2, 3], Contents: PDFHexString.of("00"), Reference: [ref] } }));
  });
  const target = await targetOf(SIG);
  const r1 = await inspect(await cert(1), target);
  assert.deepEqual(codes(r1), ["certified"]);
  assert.equal(r1.fixable, false);
  const r2 = await inspect(await cert(2), target);
  assert.equal(r2.ok, true);
  const r2aoc = await inspect(await cert(2), await targetOf("AOC Signature"));
  assert.deepEqual([codes(r2aoc), r2aoc.fixable], [["blank-value"], false]);
  await assert.rejects(addField(await cert(2), target), /certified/);
});

test("damaged cross-reference table: caught, and an unsigned file is rewritten cleanly", async () => {
  const at = F10.indexOf("\n") + 1;
  const bytes = Buffer.concat([F10.subarray(0, at), Buffer.from("% junk that shifts every object\n"), F10.subarray(at)]);
  const h = xrefHealth(bytes);
  assert.equal(h.ok, false);
  assert.match(h.problems[0], /aren't where|nothing readable|cross-reference/);
  const target = await targetOf(SIG);
  const r = await inspect(bytes, target);
  assert.deepEqual(codes(r), ["damaged"]);
  const fixed = await addField(bytes, target, "Recipient signature");
  assert.equal(fixed.mode, "rewrite");
  assert.deepEqual(xrefHealth(fixed.bytes).problems, []);
  assert.equal((await inspect(fixed.bytes, target)).ok, true);
});

test("damaged and already signed: left for a person (rewriting would void the signature)", async () => {
  const signed = await mutate((doc) => fieldDict(doc, "Awarding Official Signature").set(N("V"), doc.context.obj({ Type: "Sig", ByteRange: [0, 1, 2, 3], Contents: PDFHexString.of("00") })));
  const fresh = await PDFDocument.load(signed);
  const resaved = Buffer.from(await fresh.save({ useObjectStreams: false, updateFieldAppearances: false })); // classic table
  const at = resaved.indexOf("\n") + 1;
  const bytes = Buffer.concat([resaved.subarray(0, at), Buffer.from("%junk\n"), resaved.subarray(at)]);
  const r = await inspect(bytes, await targetOf("AOC Signature"));
  assert.ok(codes(r).includes("damaged"));
  assert.equal(r.fixable, false);
  await assert.rejects(addField(bytes, await targetOf("AOC Signature")), /damaged and already signed/);
});

test("a field added to a signed form keeps the signed bytes intact (incremental update)", async () => {
  const signed = await mutate((doc) => fieldDict(doc, "Awarding Official Signature").set(N("V"), doc.context.obj({ Type: "Sig", ByteRange: [0, 1, 2, 3], Contents: PDFHexString.of("00") })));
  const target = await targetOf("AOC Signature");
  const fixed = await addField(signed, target, "AOC-AMT signature");
  assert.equal(fixed.mode, "incremental");
  assert.ok(fixed.bytes.subarray(0, signed.length).equals(signed));
  assert.equal((await inspect(fixed.bytes, target)).ok, true);
  // and the classic-table template itself, fixed twice (a second update on top of the first)
  const once = await addField(F10, target, "AOC-AMT signature");
  const twice = await addField(once.bytes, await targetOf("SQCCF Initials", "Text"), "SQ-CCF processing");
  assert.notEqual(once.name, twice.name);
  assert.deepEqual(xrefHealth(twice.bytes).problems, []);
  const names = (await pdfjsWidgets(twice.bytes)).map((w) => w.name);
  assert.ok(names.includes(once.name) && names.includes(twice.name));
});

test("rotated and cropped pages: the new field lands exactly on the spot", async () => {
  for (const rot of [0, 90, 180, 270]) {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    page.setRotation(degrees(rot));
    page.setCropBox(20, 30, 560, 700);
    const bytes = Buffer.from(await doc.save());
    const target = { page: 0, rect: [0.12, 0.31, 0.47, 0.36], kind: "Signature" };
    const fixed = await addField(bytes, target, "Recipient signature");
    const w = (await pdfjsWidgets(fixed.bytes)).find((x) => x.name === fixed.name);
    assert.ok(near(w.norm, target.rect), `rotation ${rot}: ${w.norm.map((v) => v.toFixed(3))} vs ${target.rect}`);
    assert.equal((await inspect(fixed.bytes, target)).ok, true, `rotation ${rot}`);
  }
});

test("a PDF that isn't one", async () => {
  const r = await inspect(Buffer.from("not a pdf at all"), await targetOf(SIG));
  assert.equal(r.ok, false);
  assert.equal(r.fixable, false);
});

test("Reader rights and XFA are dropped by the fix; the field is listed in the form", async () => {
  const bytes = await mutate((doc) => {
    doc.catalog.set(N("Perms"), doc.context.obj({ UR3: { Type: "Sig", ByteRange: [0, 10, 20, 30] } }));
    doc.catalog.lookup(N("AcroForm")).set(N("XFA"), doc.context.obj([]));
  });
  const fixed = await addField(bytes, await targetOf(SIG), "Recipient signature");
  const doc = await PDFDocument.load(fixed.bytes);
  assert.equal(doc.catalog.get(N("Perms")), undefined);
  const af = doc.catalog.lookup(N("AcroForm"));
  assert.equal(af.get(N("XFA")), undefined);
  const listed = af.lookup(N("Fields")).asArray().map((r) => doc.context.lookup(r)).filter((d) => d instanceof PDFDict);
  assert.ok(listed.some((d) => d.lookup(N("T"))?.decodeText?.() === fixed.name));
  assert.ok(af.lookup(N("Fields")) instanceof PDFArray);
});

/** How many boxes on the pages are named `name` (by their own /T or their parent's). */
async function boxesNamed(bytes, name) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  let n = 0;
  for (const page of doc.getPages()) {
    for (const ref of page.node.Annots()?.asArray() ?? []) {
      const d = doc.context.lookup(ref);
      if (!(d instanceof PDFDict) || String(d.lookup(N("Subtype"))) !== "/Widget") continue;
      const own = d.lookup(N("T")) ?? d.lookup(N("Parent"))?.lookup?.(N("T"));
      if (own?.decodeText?.() === name) n++;
    }
  }
  return n;
}

test("adding a field replaces the old box; a real signature or typed text is never removed", async () => {
  const target = await targetOf(SIG);
  // the template's own empty box: gone, one new box in its place
  assert.equal(await boxesNamed(F10, SIG), 1);
  const fixed = await addField(F10, target, "Recipient signature");
  assert.equal(await boxesNamed(fixed.bytes, SIG), 0, "the old empty signature box is deleted");
  assert.equal(await boxesNamed(fixed.bytes, fixed.name), 1);
  assert.equal((await inspect(fixed.bytes, target)).ok, true);
  // several kinds of broken box are all replaced
  for (const fn of [(d) => fieldDict(d, SIG).set(N("Ff"), PDFNumber.of(1)), (d) => fieldDict(d, SIG).set(N("FT"), N("Tx")), (d) => fieldDict(d, SIG).set(N("V"), PDFString.of("junk"))]) {
    const bytes = await mutate(fn);
    const r = await addField(bytes, target, "Recipient signature");
    assert.equal(await boxesNamed(r.bytes, SIG), 0);
  }
  // a digital signature already in the box stays, and so does typed text
  const signed = await mutate((d) => fieldDict(d, SIG).set(N("V"), d.context.obj({ Type: "Sig", ByteRange: [0, 1, 2, 3], Contents: PDFHexString.of("00") })));
  assert.equal(await boxesNamed((await addField(signed, target, "Recipient signature")).bytes, SIG), 1, "signature kept");
  const typed = await mutate((d) => { d.getForm().getTextField("SQCCF Initials").setText("EJS"); });
  const tt = await targetOf("SQCCF Initials", "Text");
  assert.equal(await boxesNamed((await addField(typed, tt, "SQ-CCF")).bytes, "SQCCF Initials"), 1, "typed text kept");
  // the stored original is untouched: this works on a copy of the bytes
  assert.equal(await boxesNamed(F10, SIG), 1);
});

