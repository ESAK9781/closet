// The issuer-signature step (Awarding Official on the F10, Counselor on the AF 174).
// Generated sample forms only.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { PDFDocument } from "pdf-lib";

import { createBackup, restoreBackup } from "../src/core/backup.js";
import { Store } from "../src/core/store.js";
import { FLAG_DEFS } from "../src/core/templates.js";
import { F10, F174, fill, makeSamples, squiggle, widgetRects } from "../tools/make-samples.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
let tmp;
let store;
const dir = (...p) => path.join(tmp, ...p);
const form = (n) => store.snapshot().forms.find((f) => f.filename.startsWith(n));

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "closet-issuer-"));
  await makeSamples(dir("dump"));
  // an F10 the cadet signed but nobody signed as the issuer, and an AF 174 the same
  let doc = await PDFDocument.load(F10);
  fill(doc, { "Recieving Cadet Name": "Noissuer, Ned", Date: "20 Sep 26", "Conduct Narrative": "Test.", "SQCCF Initials": "EJS" });
  let r = widgetRects(doc);
  squiggle(doc.getPage(0), r["Recieving Cadet Signature"][0]);
  fs.writeFileSync(dir("dump", "Ned Noissuer_Neg_F10_Test.pdf"), await doc.save());
  doc = await PDFDocument.load(F174);
  fill(doc, { "Recieving Name": "Noissuer, Nia", "Reason for Counseling": "Test", "Couseling Summary": "Test.", "Name Grade and Duty Title of Counselor": "C/SSgt Park", "Couseling Date_af_date": "2026-09-18" });
  r = widgetRects(doc);
  squiggle(doc.getPage(r["Counselee Signature"][0].page), r["Counselee Signature"][0]);
  fs.writeFileSync(dir("dump", "Nia Noissuer_Neg_F174_Test.pdf"), await doc.save());
  store = new Store({ dumpDir: dir("dump"), metaDir: dir("metadata"), templatesDir: path.join(ROOT, "resources/templates") });
  await store.ready;
  await new Promise((r2) => setTimeout(r2, 500));
  await store.whenIdle();
});

after(async () => {
  await store?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("the issuer signature is the first step in the route", () => {
  assert.equal(FLAG_DEFS[0][0], "issuer_signed");
  assert.equal(FLAG_DEFS.length, 5);
});

test("signed samples have it; the two without are caught on both form types", () => {
  const snap = store.snapshot();
  for (const f of snap.forms) {
    const unsigned = /Noissuer/.test(f.filename);
    assert.equal(f.record.issuer_signed, !unsigned, `${f.filename}: issuer_signed`);
  }
  assert.equal(form("Ned Noissuer").record.recipient_signed, true);
});

test("a form signed further down without the issuer gets a warning, which goes away once it's marked", () => {
  const ned = form("Ned Noissuer");
  assert.ok(ned.issues.some((i) => i.level === "warn" && /awarding official\) is missing/.test(i.text)), JSON.stringify(ned.issues));
  assert.ok(form("Nia Noissuer").issues.some((i) => /counselor\) is missing/.test(i.text)));
  assert.ok(!form("John Doe").issues.some((i) => /issuer's signature/.test(i.text)));
  store.updateForm(ned.id, { overrides: { issuer_signed: true } });
  assert.equal(form("Ned Noissuer").record.issuer_signed, true);
  assert.ok(!form("Ned Noissuer").issues.some((i) => /issuer's signature/.test(i.text)));
  store.updateForm(ned.id, { overrides: { issuer_signed: null } });
  assert.equal(form("Ned Noissuer").record.issuer_signed, false, "back to what the PDF says");
});

test("quick dump files them under 'Needs Issuer signature', the first folder", async () => {
  const r = await store.quickDump(dir("quick"));
  const first = r.folders[0];
  assert.equal(first.key, "issuer_signed");
  assert.match(first.name, /^1 - Needs Issuer signature$/);
  const names = fs.readdirSync(path.join(r.dir, first.name));
  assert.deepEqual(names.sort(), ["Ned Noissuer_Neg_F10_Test.pdf", "Nia Noissuer_Neg_F174_Test.pdf"]);
});

test("sync pushes them to the issuer folder after checking the box that step needs", async () => {
  store.updateSettings({ dump_mode: "sync", sync_folders: { issuer_signed: { push: dir("sync", "issuer") } } });
  const rep = await store.sync.push();
  assert.deepEqual(rep.problems.filter((p) => p.step === "issuer_signed"), [], "both forms have a usable box there");
  assert.deepEqual(fs.readdirSync(dir("sync", "issuer")).sort(), ["Ned Noissuer_Neg_F10_Test.pdf", "Nia Noissuer_Neg_F174_Test.pdf"]);
});

test("an old backup (made before this step existed) restores, and the issuer flag is worked out from what was already read", async () => {
  await store.close();
  // what an older closet left on disk: same forms and reads, none of the newer settings, no sync state
  const old = { dump: dir("old", "dump"), meta: dir("old", "metadata") };
  fs.cpSync(dir("dump"), old.dump, { recursive: true, preserveTimestamps: true });
  fs.cpSync(dir("metadata"), old.meta, { recursive: true, preserveTimestamps: true });
  fs.rmSync(path.join(old.meta, "sync.json"), { force: true });
  fs.rmSync(path.join(old.meta, "backups"), { recursive: true, force: true });
  const settings = JSON.parse(fs.readFileSync(path.join(old.meta, "settings.json"), "utf8"));
  for (const k of ["first_shirt_fill_date", "bulk_initials", "dump_mode", "print_packet", "sync_folders"]) delete settings[k];
  fs.writeFileSync(path.join(old.meta, "settings.json"), JSON.stringify(settings));
  const zip = dir("old-backup.zip");
  createBackup({ ...old, out: zip });

  const fresh = { dump: dir("restored", "dump"), meta: dir("restored", "metadata") };
  fs.mkdirSync(fresh.dump, { recursive: true });
  restoreBackup(zip, { ...fresh, safety: dir("restored-safety.zip") });
  const parsedAt = Object.fromEntries(fs.readdirSync(path.join(fresh.meta, "forms")).map((n) => [n, JSON.parse(fs.readFileSync(path.join(fresh.meta, "forms", n), "utf8")).parsed_at]));
  const s2 = new Store({ dumpDir: fresh.dump, metaDir: fresh.meta, templatesDir: path.join(ROOT, "resources/templates") });
  await s2.ready;
  await new Promise((r) => setTimeout(r, 600));
  await s2.whenIdle();
  const snap = s2.snapshot();
  for (const m of s2.metas.values()) assert.equal(m.parsed_at, parsedAt[`${m.id}.json`], `${m.filename} was not read again`);
  assert.equal(snap.settings.dump_mode, "quick", "new settings get their defaults");
  assert.equal(snap.settings.first_shirt_fill_date, true);
  assert.deepEqual(snap.settings.bulk_initials, { sqccf_processed: "", cadet_cc_initialed: "" });
  for (const f of snap.forms) assert.equal(f.record.issuer_signed, !/Noissuer/.test(f.filename), `${f.filename}: issuer signature found from the saved read`);
  assert.equal(snap.sync.pending.length, 0);
  await s2.close();
});
