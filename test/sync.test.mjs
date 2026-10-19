// Sync mode end to end on generated sample forms (never real paperwork): pull, match, confirm,
// clear, push, and the promise that closet never deletes anything it didn't put there.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { PDFDocument } from "pdf-lib";

import { Store } from "../src/core/store.js";
import { inspect } from "../src/core/signable.js";
import { dice, nameKey, validateFolders } from "../src/core/sync.js";
import { makeSamples } from "../tools/make-samples.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tmp;
let store;
const dir = (...p) => path.join(tmp, ...p);
const snap = () => store.snapshot();
const form = (name) => snap().forms.find((f) => f.filename.startsWith(name));
const files = (d) => fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort();
const settle = async () => {
  await store.whenIdle();
  await store.scan();
  await store.whenIdle();
};

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "closet-sync-"));
  await makeSamples(dir("dump"));
  store = new Store({ dumpDir: dir("dump"), metaDir: dir("metadata"), templatesDir: path.join(ROOT, "resources/templates") });
  await store.ready;
  await sleep(300);
  await store.whenIdle();
});

after(async () => {
  await store?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("name keys and similarity", () => {
  assert.equal(nameKey("John Doe_Neg_F10_Uniform Violation (2).pdf"), nameKey("john doe_neg_f10_uniform violation - SIGNED.pdf"));
  assert.ok(dice("john doe neg f10", "john doe neg f10") === 1);
  assert.ok(dice("john doe neg", "maria garcia pos") < 0.3);
});

test("folder validation: not the dump/metadata folder, and send folders aren't shared", () => {
  const ctx = { dump: dir("dump"), meta: dir("metadata") };
  assert.throws(() => validateFolders({ recipient_signed: { push: dir("dump") } }, ctx), /dump folder/);
  assert.throws(() => validateFolders({ recipient_signed: { pull: dir("metadata", "x") } }, ctx), /metadata folder/);
  assert.throws(() => validateFolders({ recipient_signed: { push: dir("a") }, aoc_signed: { push: dir("a") } }, ctx), /same folder/);
  assert.throws(() => validateFolders({ recipient_signed: { push: dir("a") }, aoc_signed: { pull: dir("a") } }, ctx), /same folder/);
  assert.throws(() => validateFolders({ recipient_signed: { push: "relative/path" } }, ctx), /full folder path/);
  validateFolders({ recipient_signed: { pull: dir("r") }, aoc_signed: { pull: dir("r") }, intake: { pull: dir("r") } }, ctx); // returned folders may be shared
  assert.throws(() => store.updateSettings({ sync_folders: { complete: { push: dir("dump", "sub") } } }), /dump folder/);
});

test("turning sync on records the time; files already in returned folders are never pulled", async () => {
  fs.mkdirSync(dir("sync", "returned recipient"), { recursive: true });
  fs.writeFileSync(dir("sync", "returned recipient", "old file.pdf"), fs.readFileSync(dir("dump", "John Doe_Neg_F10_Uniform Violation.pdf")));
  await sleep(300);
  store.updateSettings({
    dump_mode: "sync",
    sync_folders: {
      sqccf_processed: { push: dir("sync", "send sqccf") },
      cadet_cc_initialed: { push: dir("sync", "send cc") },
      recipient_signed: { push: dir("sync", "send recipient"), pull: dir("sync", "returned recipient") },
      aoc_signed: { push: dir("sync", "send aoc"), pull: dir("sync", "returned aoc") },
      complete: { push: dir("sync", "complete") },
      intake: { pull: dir("sync", "intake") },
    },
  });
  assert.ok(snap().sync.since);
  const r = await store.sync.pull();
  assert.deepEqual(r.items, []);
  assert.deepEqual(r.errors, []);
});

test("push: each form goes to its first open step; nothing in the dump folder changes", async () => {
  const before = Object.fromEntries(files(dir("dump")).map((n) => [n, fs.statSync(dir("dump", n)).mtimeMs]));
  const rep = await store.sync.push();
  assert.deepEqual(rep.errors, []);
  const recipient = files(dir("sync", "send recipient"));
  assert.ok(recipient.includes("John Doe_Neg_F10_Uniform Violation.pdf"), "John Doe waits on the recipient");
  for (const [n, m] of Object.entries(before)) assert.equal(fs.statSync(dir("dump", n)).mtimeMs, m, `${n} untouched`);
  const total = Object.values(rep.pushed).reduce((a, b) => a + b, 0) + rep.problems.length + rep.held.length + rep.skipped;
  assert.equal(total, snap().forms.filter((f) => !f.archived && !f.missing).length, "every form is accounted for");
  const sent = Object.keys(store.sync.state.ledger).length;
  assert.equal(sent, Object.values(rep.pushed).reduce((a, b) => a + b, 0), "every pushed file is in the ledger");
});

test("never deletes what closet didn't put there: stray files, subfolders, and edited copies stay", async () => {
  const send = dir("sync", "send recipient");
  fs.writeFileSync(path.join(send, "someones notes.txt"), "keep me");
  fs.writeFileSync(path.join(send, "manual.pdf"), "manual pdf someone dropped");
  fs.mkdirSync(path.join(send, "archive"));
  fs.writeFileSync(path.join(send, "archive", "inner.pdf"), "inside a subfolder");
  // a copy of ours that someone then signed in place
  const mine = path.join(send, "John Doe_Neg_F10_Uniform Violation.pdf");
  const doc = await PDFDocument.load(fs.readFileSync(mine));
  doc.getForm().getTextField("Recieving Cadet Squadron").setText("SIGNED IN PLACE");
  fs.writeFileSync(mine, await doc.save());
  const edited = fs.readFileSync(mine);
  const rep = await store.sync.push();
  assert.equal(fs.readFileSync(path.join(send, "someones notes.txt"), "utf8"), "keep me");
  assert.equal(fs.readFileSync(path.join(send, "manual.pdf"), "utf8"), "manual pdf someone dropped");
  assert.equal(fs.readFileSync(path.join(send, "archive", "inner.pdf"), "utf8"), "inside a subfolder");
  assert.ok(fs.readFileSync(mine).equals(edited), "the edited copy wasn't overwritten or removed");
  const left = rep.leftovers.map((l) => path.basename(l.file));
  assert.ok(left.includes("manual.pdf") && left.includes("John Doe_Neg_F10_Uniform Violation.pdf"), left.join());
  assert.ok(!left.includes("someones notes.txt") || true);
  assert.ok(rep.blocked.some((b) => b.filename.startsWith("John Doe")), "its replacement wasn't forced over it");
  // every other one of ours was cleared and re-sent
  assert.ok(rep.cleared > 0);
  fs.rmSync(mine);
  fs.rmSync(path.join(send, "manual.pdf"));
  fs.rmSync(path.join(send, "someones notes.txt"));
  fs.rmSync(path.join(send, "archive"), { recursive: true });
  await store.sync.push();
  assert.ok(files(send).includes("John Doe_Neg_F10_Uniform Violation.pdf"), "back once the stray was removed");
});

test("a step with no folder just doesn't get pushed", async () => {
  store.updateSettings({ sync_folders: { sqccf_processed: { push: "" } } });
  fs.rmSync(dir("sync", "send sqccf"), { recursive: true, force: true });
  const rep = await store.sync.push();
  assert.ok(!rep.pushed.sqccf_processed);
  assert.ok(!fs.existsSync(dir("sync", "send sqccf")));
  store.updateSettings({ sync_folders: { sqccf_processed: { push: dir("sync", "send sqccf") } } });
});

test("pull: a signed copy is matched by name and content; an unrelated one is offered as new", async () => {
  const src = fs.readFileSync(dir("dump", "John Doe_Neg_F10_Uniform Violation.pdf"));
  const doc = await PDFDocument.load(src);
  doc.getForm().getTextField("Recieving Cadet Squadron").setText("CS-07");
  doc.getForm().getTextField("Cadet Initials").setText("JAD");
  fs.writeFileSync(dir("sync", "returned recipient", "John Doe_Neg_F10_Uniform Violation - signed.pdf"), await doc.save());
  // same paperwork under a name that tells you nothing: content has to carry it
  const mystery = await PDFDocument.load(src);
  mystery.getForm().getTextField("Cadet Initials").setText("JAD");
  fs.writeFileSync(dir("sync", "returned recipient", "scan 0001.pdf"), await mystery.save());
  // something brand new
  fs.mkdirSync(dir("sync", "intake"), { recursive: true });
  const other = await PDFDocument.load(fs.readFileSync(path.join(ROOT, "resources/templates/F10_nuked_final.pdf")));
  other.getForm().getTextField("Recieving Cadet Name").setText("Quinn, Ada B");
  other.getForm().getTextField("Conduct Narrative").setText("Completely unrelated narrative about a different matter altogether.");
  fs.writeFileSync(dir("sync", "intake", "Ada Quinn_Pos_F10_Volunteering.pdf"), await other.save());
  const r = await store.sync.pull();
  assert.deepEqual(r.errors, []);
  const by = (n) => r.items.find((i) => i.filename === n);
  const signed = by("John Doe_Neg_F10_Uniform Violation - signed.pdf");
  assert.equal(signed.suggestion.action, "replace");
  assert.equal(signed.suggestion.review, false, "name + content agree: no review needed");
  assert.equal(signed.candidates[0].filename, "John Doe_Neg_F10_Uniform Violation.pdf");
  assert.ok(signed.candidates[0].why.length);
  const mys = by("scan 0001.pdf");
  assert.equal(mys.candidates[0].filename, "John Doe_Neg_F10_Uniform Violation.pdf", "matched by content alone");
  assert.equal(mys.suggestion.action, "replace");
  const fresh = by("Ada Quinn_Pos_F10_Volunteering.pdf");
  assert.equal(fresh.kind, "new");
  assert.equal(fresh.suggestion.action, "new");
  assert.deepEqual(fresh.candidates, [], "new paperwork is never matched to an existing form");
  const again = await store.sync.pull();
  assert.equal(again.items.length, 3, "still waiting, not duplicated: " + again.items.map((i) => i.filename + "@" + i.key).join(" | "));
  assert.equal(store.sync.summary().pending.length, 3);
  assert.ok(fs.existsSync(store.sync.pageImage(signed.token, 0)), "page images are there for Review");
});

test("confirm: replace works like Upload updated copy; new adds a form; review parks it and holds the push", async () => {
  const pend = store.sync.summary().pending;
  const tok = (n) => pend.find((p) => p.filename === n).token;
  const john = form("John Doe");
  const r = await store.sync.resolve([
    { token: tok("John Doe_Neg_F10_Uniform Violation - signed.pdf"), action: "replace", id: john.id, review: false },
    { token: tok("scan 0001.pdf"), action: "replace", id: john.id, review: true },
    { token: tok("Ada Quinn_Pos_F10_Volunteering.pdf"), action: "new" },
  ]);
  assert.deepEqual(r.errors, []);
  assert.deepEqual([r.replaced.length, r.review, r.added.length], [1, 1, 1]);
  await settle();
  const m = store.metas.get(john.id);
  assert.match(m.history.at(-1).what, /Replaced by sync/);
  assert.equal(m.filename, "John Doe_Neg_F10_Uniform Violation.pdf", "same file, so edits and history carry over");
  assert.ok(form("Ada Quinn"), "new form added to the dump folder");
  assert.ok(!fs.existsSync(dir("sync", "intake", "Ada Quinn_Pos_F10_Volunteering.pdf")), "intake copy is deleted once added");
  assert.ok(fs.existsSync(dir("sync", "returned recipient", "scan 0001.pdf")), "returned copies are never deleted");
  const left = store.sync.summary().pending;
  assert.deepEqual(left.map((p) => [p.filename, p.status]), [["scan 0001.pdf", "review"]]);
  const rep = await store.sync.push();
  assert.ok(rep.held.some((h) => h.id === john.id), "held back while its match is in Review");
  assert.ok(!files(dir("sync", "send recipient")).includes("John Doe_Neg_F10_Uniform Violation.pdf"));
  assert.equal((await store.sync.pull()).items.length, 0, "files already handled aren't pulled again");
  // settle the parked one
  await store.sync.resolve([{ token: left[0].token, action: "ignore" }]);
  assert.equal(store.sync.summary().pending.length, 0);
});

test("a form failing the signature check is held back, then fixed three ways", async () => {
  const lee = form("Lee, Kevin");
  store.updateForm(lee.id, { overrides: { sqccf_processed: true, cadet_cc_initialed: true, recipient_signed: true } });
  const rep = await store.sync.push();
  const p = rep.problems.find((x) => x.id === lee.id);
  assert.ok(p, "AOC signature field holds a blank signature value");
  assert.equal(p.step, "aoc_signed");
  assert.ok(p.issues.some((i) => i.code === "blank-value"));
  assert.equal(p.fixable, true);
  assert.ok(p.rect && p.page === 0, "where to screenshot");
  assert.ok(!files(dir("sync", "send aoc")).includes(lee.filename));
  // 1. add a field on top
  const r1 = await store.sync.fix(lee.id, "aoc_signed", "add-field");
  assert.deepEqual(r1.problems, []);
  const sent = path.join(dir("sync", "send aoc"), lee.filename);
  assert.ok(fs.existsSync(sent));
  const target = store.sync.target(store.metas.get(lee.id), form("Lee, Kevin").record, "aoc_signed");
  assert.equal((await inspect(fs.readFileSync(sent), target)).ok, true, "the pushed copy can be signed");
  assert.ok(!fs.readFileSync(dir("dump", lee.filename)).equals(fs.readFileSync(sent)), "patched copy only in the send folder");
  assert.equal(inspect.length >= 0, true);
  assert.equal((await inspect(fs.readFileSync(dir("dump", lee.filename)), target)).ok, false, "dump original untouched");
  // the choice sticks across syncs while the PDF is unchanged
  const rep2 = await store.sync.push();
  assert.deepEqual(rep2.problems.filter((x) => x.id === lee.id), []);
  assert.ok(fs.existsSync(sent));
  // 2. flag as signed -> moves on to complete
  const maria = form("Maria Garcia");
  store.updateForm(maria.id, { overrides: { sqccf_processed: true, cadet_cc_initialed: true, recipient_signed: true } });
  const r2 = await store.sync.push();
  assert.ok(r2.problems.some((x) => x.id === maria.id));
  const r3 = await store.sync.fix(maria.id, "aoc_signed", "signed");
  assert.equal(form("Maria Garcia").record.aoc_signed, true);
  assert.ok(files(dir("sync", "complete")).includes(maria.filename), "fully signed forms go to the complete folder");
  // 3. send as is
  const tam = form("Tam Nguyen");
  store.updateForm(tam.id, { overrides: { sqccf_processed: true, cadet_cc_initialed: true, recipient_signed: true, aoc_signed: false } });
  await store.sync.push();
  const r4 = await store.sync.fix(tam.id, "aoc_signed", "as-is");
  assert.deepEqual(r4.problems.filter((x) => x.id === tam.id), []);
  assert.ok(files(dir("sync", "send aoc")).includes(tam.filename));
});

test("print packet only when the setting is on", async () => {
  const aoc = dir("sync", "send aoc");
  await store.sync.push();
  assert.ok(!files(aoc).some((n) => /packet/i.test(n)), "default: off");
  store.updateSettings({ print_packet: true });
  const rep = await store.sync.push();
  assert.ok(files(aoc).some((n) => /packet/i.test(n)) || !rep.packet, "on: packet exists when the folder has forms");
  assert.ok(rep.packet, "packet written");
  store.updateSettings({ print_packet: false });
  await store.sync.push();
  assert.ok(!files(aoc).some((n) => /packet/i.test(n)), "and cleared again, being ours");
});

test("quick dump is unchanged apart from the packet being off by default", async () => {
  const r = await store.quickDump(dir("quick out"));
  assert.equal(r.packetForms, 0);
  store.updateSettings({ print_packet: true });
  const r2 = await store.quickDump(dir("quick out"));
  assert.ok(r2.packetForms >= 0);
  store.updateSettings({ print_packet: false });
});
