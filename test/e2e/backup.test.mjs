// Export and import a backup through the real Settings page (native file dialogs are stubbed in
// the main process). Generated sample forms only.
//   npm run test:e2e

import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { makeSamples } from "../../tools/make-samples.mjs";
import { launch, settled, until } from "./launch.mjs";

let tmp;
let app;
let page;
let errors;
const dir = (...p) => path.join(tmp, ...p);
const state = () => page.evaluate(() => window.closet.api("GET", "/api/state"));
const byFile = (s, n) => s.forms.find((f) => f.filename.startsWith(n));
const go = async (view) => {
  await page.evaluate((v) => { location.hash = "#/" + v; }, view);
  await page.waitForTimeout(400);
};
const modalTitle = async () => {
  await page.waitForSelector(".modal-scrim", { timeout: 60000 });
  return page.textContent(".modal h2");
};
const click = async (label) => {
  await page.click(`.modal-actions .btn:text-is("${label}")`);
  await page.waitForTimeout(400);
};
const stubSave = (p) => app.evaluate(({ dialog }, f) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: f }); }, p);
const stubOpen = (p) => app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, p);

before(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "closet-e2e-backup-"));
  await makeSamples(dir("dump"));
  ({ app, page, errors } = await launch(dir("dump"), dir("userdata")));
  await settled(page);
  assert.match(await modalTitle(), /Possible typo/);
  await click("Different people");
});

after(async () => {
  await app?.close();
  rmSync(tmp, { recursive: true, force: true });
});

test("export: one zip file with the data in it", async () => {
  await go("settings/data");
  const out = dir("saved", "my backup.zip");
  await stubSave(out);
  await page.click("#backupExport");
  await page.waitForFunction(() => /Backup saved/.test(document.querySelector("#toasts")?.textContent || ""), null, { timeout: 60000 });
  assert.ok(fs.existsSync(out));
  assert.match(await page.textContent("#toasts"), /9 PDFs/);
  const head = fs.readFileSync(out).subarray(0, 4);
  assert.deepEqual([...head], [0x50, 0x4b, 0x03, 0x04], "a zip");
});

test("import: wrecked data is replaced by the backup after a confirmation", async () => {
  const before = await state();
  const lee = byFile(before, "Lee, Kevin");
  const bytesBefore = fs.readFileSync(dir("dump", lee.filename));
  // wreck: archive a form, change a setting and a file, delete a PDF
  await page.evaluate((id) => window.closet.api("PATCH", `/api/forms/${id}`, { archived: true, notes: "WRECKED" }), lee.id);
  await page.evaluate(() => window.closet.api("PUT", "/api/settings", { month_format: "iso" }));
  fs.writeFileSync(dir("dump", lee.filename), Buffer.concat([bytesBefore, Buffer.from("\n% tampered\n")]));
  fs.rmSync(dir("dump", byFile(before, "scan0042").filename));
  await page.waitForTimeout(800);
  assert.equal((await state()).settings.month_format, "iso");

  await go("settings");
  await stubOpen(dir("saved", "my backup.zip"));
  await page.click("#backupImport");
  assert.equal(await modalTitle(), "Replace everything with this backup?");
  assert.match(await page.textContent(".modal"), /9 PDFs/);
  assert.match(await page.textContent(".modal"), /saved first as a safety backup/);
  await click("Cancel");
  assert.equal((await state()).settings.month_format, "iso", "cancel changes nothing");

  await page.click("#backupImport");
  await modalTitle();
  await click("Replace with this backup");
  assert.equal(await modalTitle(), "Backup restored");
  const msg = await page.textContent(".modal");
  assert.match(msg, /before-restore-/);
  await click("OK");
  await until(page, (s) => s.forms.length === 9 && s.forms.every((f) => f.parsed) && !s.status.queued, 120000);
  const s = await state();
  assert.equal(s.settings.month_format, before.settings.month_format);
  assert.equal(byFile(s, "Lee, Kevin").archived, false);
  assert.equal(byFile(s, "Lee, Kevin").notes, "");
  assert.ok(fs.readFileSync(dir("dump", lee.filename)).equals(bytesBefore), "the tampered PDF is back to the original");
  assert.ok(fs.existsSync(dir("dump", byFile(before, "scan0042").filename)), "the deleted PDF is back");
  const safety = fs.readdirSync(dir("userdata", "backups"));
  assert.equal(safety.length, 1, "a safety backup of the wrecked state was kept");
  assert.match(safety[0], /^before-restore-.*\.zip$/);
});

test("import: a damaged backup is refused and nothing changes", async () => {
  const good = fs.readFileSync(dir("saved", "my backup.zip"));
  const bad = Buffer.from(good);
  bad[Math.floor(bad.length / 2)] ^= 0xff;
  fs.writeFileSync(dir("saved", "bad.zip"), bad);
  await page.evaluate(() => window.closet.api("PUT", "/api/settings", { month_format: "short" }));
  await stubOpen(dir("saved", "bad.zip"));
  await page.click("#backupImport");
  assert.equal(await modalTitle(), "That backup can't be restored");
  assert.match(await page.textContent(".modal"), /damaged|Nothing was changed/);
  await click("OK");
  assert.equal((await state()).settings.month_format, "short", "still the current data");
  assert.equal(fs.readdirSync(dir("userdata", "backups")).length, 1, "no restore was attempted");
});

test("no page errors", () => {
  assert.deepEqual(errors, []);
});
