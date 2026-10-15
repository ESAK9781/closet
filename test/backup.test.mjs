// Backup export / restore on generated sample forms (never real paperwork).

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { createBackup, openZip, restoreBackup, verifyBackup, ZipWriter } from "../src/core/backup.js";
import { Store } from "../src/core/store.js";
import { makeSamples } from "../tools/make-samples.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
let tmp;
let store;
const dir = (...p) => path.join(tmp, ...p);
const near = (a, b) => Math.abs(a - b) < 1; // ms: copying times through floating point isn't exact to the last bit
const sameTree = (a, b, label) => {
  assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), `${label}: same files`);
  for (const k of Object.keys(a)) {
    assert.equal(a[k].bytes, b[k].bytes, `${label}/${k}: same bytes`);
    assert.ok(near(a[k].mtimeMs, b[k].mtimeMs), `${label}/${k}: same modified time (${a[k].mtimeMs} vs ${b[k].mtimeMs})`);
  }
};
const tree = (root, skip = []) => {
  const out = {};
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (!rel && skip.includes(e.name)) continue;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else out[r] = { bytes: fs.readFileSync(path.join(d, e.name)).toString("base64"), mtimeMs: fs.statSync(path.join(d, e.name)).mtimeMs };
    }
  };
  walk(root, "");
  return out;
};
const SKIP = ["renders", "templates", "bulk", "sync"];
const ctx = () => ({ dump: dir("dump"), meta: dir("metadata") });

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "closet-backup-"));
  await makeSamples(dir("dump"));
  store = new Store({ dumpDir: dir("dump"), metaDir: dir("metadata"), templatesDir: path.join(ROOT, "resources/templates") });
  await store.ready;
  await new Promise((r) => setTimeout(r, 500));
  await store.whenIdle();
  const john = store.snapshot().forms.find((f) => f.filename.startsWith("John Doe"));
  store.updateForm(john.id, { overrides: { recipient_signed: true }, notes: "keep this note", reviewed: true });
  store.updateSettings({ month_format: "short", bulk_initials: { sqccf_processed: "EJS" } });
  await store.close(); // the files on disk are what a backup captures
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("export: one zip with the PDFs, the metadata, a manifest; page images and caches left out", () => {
  const r = createBackup({ ...ctx(), config: { dumpDir: "X", quickDumpDir: "Q", autoUpdate: false, bounds: { x: 1 } }, appVersion: "9.9.9", out: dir("out", "b1.zip") });
  assert.equal(r.pdfs, 9);
  assert.equal(r.forms, 9);
  assert.ok(fs.existsSync(dir("out", "b1.zip")));
  assert.ok(!fs.existsSync(dir("out", "b1.zip.partial")));
  const z = openZip(dir("out", "b1.zip"));
  const names = z.entries.map((e) => e.name);
  z.close();
  assert.ok(names.includes("manifest.json") && names.includes("config.json"));
  assert.ok(names.includes("metadata/settings.json"));
  assert.equal(names.filter((n) => n.startsWith("dump/")).length, 9);
  assert.ok(!names.some((n) => /^metadata\/(renders|templates|bulk|sync)\//.test(n)), "rebuildable folders excluded");
  const { manifest, config } = verifyBackup(dir("out", "b1.zip"));
  assert.equal(manifest.app_version, "9.9.9");
  assert.deepEqual(config, { quickDumpDir: "Q", autoUpdate: false }, "only the per-computer settings, not window bounds or the dump path");
});

test("the file is an ordinary zip other tools can open", () => {
  let py = null;
  for (const c of ["python", "python3"]) {
    try { execFileSync(c, ["--version"], { stdio: "ignore" }); py = c; break; } catch { /* next */ }
  }
  if (!py) return;
  const out = execFileSync(py, ["-m", "zipfile", "-t", dir("out", "b1.zip")], { encoding: "utf8" });
  assert.match(out, /Done testing|no errors/i);
});

test("restore: everything comes back exactly, even after the data is wrecked", () => {
  const before = { dump: tree(dir("dump")), meta: tree(dir("metadata"), SKIP) };
  // wreck it: delete PDFs, damage records, change settings, add a stranger file and a subfolder
  for (const n of fs.readdirSync(dir("dump")).slice(0, 4)) fs.rmSync(dir("dump", n));
  fs.writeFileSync(dir("dump", "stranger.txt"), "not a pdf");
  fs.mkdirSync(dir("dump", "sub"));
  fs.writeFileSync(dir("dump", "sub", "keep.pdf"), "inside a subfolder");
  fs.writeFileSync(dir("dump", "extra_Neg_F10_New.pdf"), "a pdf that isn't in the backup");
  fs.rmSync(dir("metadata", "forms"), { recursive: true });
  fs.writeFileSync(dir("metadata", "settings.json"), "{}");
  fs.writeFileSync(dir("metadata", "names.json"), "garbage");
  const r = restoreBackup(dir("out", "b1.zip"), { ...ctx(), safety: dir("safety", "before.zip") });
  const after = { dump: tree(dir("dump")), meta: tree(dir("metadata"), SKIP) };
  const extra = Object.keys(after.dump).filter((k) => !(k in before.dump)).sort();
  assert.deepEqual(extra, ["stranger.txt", "sub/keep.pdf"], "only the files that aren't the app's are left over");
  for (const k of extra) delete after.dump[k];
  sameTree(after.dump, before.dump, "dump");
  sameTree(after.meta, before.meta, "metadata");
  assert.equal(fs.readFileSync(dir("dump", "stranger.txt"), "utf8"), "not a pdf", "non-PDF files in the dump folder are not touched");
  assert.equal(fs.readFileSync(dir("dump", "sub", "keep.pdf"), "utf8"), "inside a subfolder", "nor are subfolders");
  assert.ok(!fs.existsSync(dir("dump", "extra_Neg_F10_New.pdf")), "PDFs that weren't in the backup are replaced away");
  assert.equal(r.manifest.pdfs, 9);
  // the safety backup holds the state from just before, wrecked parts included
  const safe = verifyBackup(dir("safety", "before.zip")).manifest;
  assert.ok(safe.files["dump/extra_Neg_F10_New.pdf"]);
  fs.rmSync(dir("dump", "stranger.txt"));
  fs.rmSync(dir("dump", "sub"), { recursive: true });
});

test("a restored app opens with the same data and reads nothing again", async () => {
  const parsedAt = Object.fromEntries(fs.readdirSync(dir("metadata", "forms")).map((n) => [n, JSON.parse(fs.readFileSync(dir("metadata", "forms", n), "utf8")).parsed_at]));
  const s = new Store({ dumpDir: dir("dump"), metaDir: dir("metadata"), templatesDir: path.join(ROOT, "resources/templates") });
  await s.ready;
  await new Promise((r) => setTimeout(r, 600));
  await s.whenIdle();
  for (const m of s.metas.values()) assert.equal(m.parsed_at, parsedAt[`${m.id}.json`], `${m.filename} was not read again`);
  const snap = s.snapshot();
  assert.equal(snap.forms.length, 9);
  assert.equal(snap.settings.month_format, "short");
  assert.equal(snap.settings.bulk_initials.sqccf_processed, "EJS");
  const john = snap.forms.find((f) => f.filename.startsWith("John Doe"));
  assert.equal(john.notes, "keep this note");
  assert.equal(john.record.recipient_signed, true);
  assert.equal(john.reviewed, true);
  assert.equal(snap.status.queued, 0, "same size and modified time, so no PDF needed reading again");
  assert.ok(snap.forms.every((f) => f.parsed));
  await s.close();
});

test("a damaged backup is refused before anything is touched", () => {
  const good = fs.readFileSync(dir("out", "b1.zip"));
  const bad = Buffer.from(good);
  bad[Math.floor(bad.length / 3)] ^= 0xff; // flip a byte inside some file's data
  fs.writeFileSync(dir("out", "bad.zip"), bad);
  const before = tree(dir("dump"));
  assert.throws(() => restoreBackup(dir("out", "bad.zip"), { ...ctx(), safety: dir("safety", "never.zip") }), /damaged|unreadable|index|unexpected/);
  assert.deepEqual(tree(dir("dump")), before, "dump untouched");
  assert.ok(!fs.existsSync(dir("safety", "never.zip")), "didn't even start");
  fs.writeFileSync(dir("out", "cut.zip"), good.subarray(0, good.length - 200));
  assert.throws(() => verifyBackup(dir("out", "cut.zip")), /cut short|isn't a backup|index/);
  fs.writeFileSync(dir("out", "tiny.zip"), "PK");
  assert.throws(() => verifyBackup(dir("out", "tiny.zip")), /too small/);
  fs.writeFileSync(dir("out", "notzip.zip"), Buffer.alloc(5000, 7));
  assert.throws(() => verifyBackup(dir("out", "notzip.zip")), /isn't a backup/);
});

function craft(name, entries) {
  const z = new ZipWriter(dir("out", name));
  for (const [n, d] of entries) z.add(n, Buffer.from(d));
  z.close();
  return dir("out", name);
}
const manifest = (extra = {}) => JSON.stringify({ app: "closet", format: 1, files: {}, ...extra });

test("paths that point outside the app folders are refused", () => {
  for (const evil of ["metadata/../../evil.txt", "dump/../evil.pdf", "/etc/passwd", "C:/evil.txt", "metadata\\..\\evil", "dump/sub/inner.pdf", "dump/notes.txt", "other/file", "metadata/", "metadata//x"]) {
    const f = craft("evil.zip", [["manifest.json", manifest()], [evil, "x"]]);
    assert.throws(() => verifyBackup(f), /unexpected|not restored/, evil);
  }
  assert.ok(!fs.existsSync(dir("evil.txt")) && !fs.existsSync(dir("evil.pdf")));
});

test("zips that aren't closet backups, or are from a newer format, are refused", () => {
  assert.throws(() => verifyBackup(craft("a.zip", [["hello.txt", "x"]])), /no manifest/);
  assert.throws(() => verifyBackup(craft("b.zip", [["manifest.json", JSON.stringify({ app: "other", format: 1 })]])), /isn't a closet backup/);
  assert.throws(() => verifyBackup(craft("c.zip", [["manifest.json", manifest({ format: 2 })]])), /different version/);
  assert.throws(() => verifyBackup(craft("d.zip", [["manifest.json", manifest({ files: { "dump/gone.pdf": {} } })]])), /missing "dump\/gone.pdf"/);
});

test("a failure part-way puts the previous data back", () => {
  // a backup whose metadata can't be written (a file where a folder is needed)
  const f = craft("clash.zip", [["manifest.json", manifest()], ["dump/new_Neg_F10_X.pdf", "%PDF new"], ["metadata/a", "file"], ["metadata/a/b", "clash"]]);
  const before = { dump: tree(dir("dump")), meta: tree(dir("metadata"), SKIP) };
  assert.throws(() => restoreBackup(f, { ...ctx(), safety: dir("safety", "rollback.zip") }), /previous data was put back/);
  sameTree(tree(dir("dump")), before.dump, "dump");
  sameTree(tree(dir("metadata"), SKIP), before.meta, "metadata");
});

test("export: a failed write never replaces an existing file or leaves a partial one", () => {
  const target = dir("out", "keep.zip");
  fs.writeFileSync(target, "previous backup");
  assert.throws(() => createBackup({ dump: dir("dump"), meta: dir("metadata"), out: path.join(target, "nested.zip") }));
  assert.equal(fs.readFileSync(target, "utf8"), "previous backup");
  assert.ok(!fs.readdirSync(dir("out")).some((n) => n.endsWith(".partial")));
});
