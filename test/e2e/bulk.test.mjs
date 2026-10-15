// The SQ/CCF and Cadet CC bulk-initial buttons, in the real app, on generated sample forms.
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
const state = () => page.evaluate(() => window.closet.api("GET", "/api/state"));
const byFile = (s, n) => s.forms.find((f) => f.filename.startsWith(n));
const go = async (view) => {
  await page.evaluate((v) => { location.hash = "#/" + v; }, view);
  await page.waitForTimeout(400);
};
const modalTitle = async () => {
  await page.waitForSelector(".modal-scrim", { timeout: 30000 });
  return page.textContent(".modal h2");
};
const click = async (label) => {
  await page.click(`.modal-actions .btn:text-is("${label}")`);
  await page.waitForTimeout(300);
};

before(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "closet-e2e-bulk-"));
  await makeSamples(path.join(tmp, "dump"));
  ({ app, page, errors } = await launch(path.join(tmp, "dump"), path.join(tmp, "userdata")));
  await settled(page);
  assert.match(await modalTitle(), /Possible typo/);
  await click("Different people");
});

after(async () => {
  await app?.close();
  rmSync(tmp, { recursive: true, force: true });
});

test("SQ/CCF button: asks for initials once, writes them and today's date into the PDFs, sets the flag", async () => {
  await go("paperwork");
  const before = await state();
  const lee = byFile(before, "Lee, Kevin");
  assert.equal(lee.record.sqccf_processed, false);
  const file = path.join(tmp, "dump", lee.filename);
  const bytes0 = fs.readFileSync(file);
  await page.click("#bulkSqccf");
  assert.match(await modalTitle(), /SQ\/CCF processing: initial \d+ forms?\?/);
  assert.equal(await page.inputValue("#mInput"), "", "nothing remembered yet");
  await page.fill("#mInput", "");
  await click("Initial " + (await page.textContent(".modal-actions .btn.primary")).replace(/^Initial /, ""));
  assert.match(await page.textContent("#mErr"), /Enter the initials/, "refuses empty initials");
  await page.fill("#mInput", "ejs");
  await page.click(".modal-actions .btn.primary");
  await until(page, (s) => byFile(s, "Lee, Kevin").record.sqccf_processed === true && !s.status.queued, 120000);
  await page.waitForTimeout(600);
  const s = await state();
  assert.ok(s.forms.filter((f) => !f.archived && f.parsed && f.record.form_type === "F10").every((f) => f.record.sqccf_processed === true));
  const d = await page.evaluate((id) => window.closet.api("GET", `/api/forms/${id}`), lee.id);
  assert.equal(d.analysis.slots.sqccf_initials.value, "ejs");
  assert.ok(d.analysis.slots.login_date.value, "log-in date written");
  assert.ok(fs.readFileSync(file).subarray(0, bytes0.length).equals(bytes0), "an edit on top of the original");
  assert.equal(s.settings.bulk_initials.sqccf_processed, "ejs");
  // nothing is left: the next click just says so
  await page.click("#bulkSqccf");
  await page.waitForTimeout(500);
  assert.equal(await page.$(".modal-scrim"), null);
  assert.match(await page.textContent("#toasts"), /Nothing is waiting/);
});

test("Cadet CC button: remembered initials are offered, dated, flag set", async () => {
  await go("settings");
  assert.equal(await page.inputValue('[data-set="bulk_initials.sqccf_processed"]'), "ejs", "shown in Settings");
  await page.fill('[data-set="bulk_initials.cadet_cc_initialed"]', "RTH");
  await page.press('[data-set="bulk_initials.cadet_cc_initialed"]', "Tab");
  await page.waitForTimeout(500);
  await go("paperwork");
  await page.click("#bulkCc");
  assert.match(await modalTitle(), /Cadet Commander initials: initial/);
  assert.equal(await page.inputValue("#mInput"), "RTH", "initials remembered from Settings");
  assert.match(await page.textContent(".modal"), /today's date/);
  await page.click(".modal-actions .btn.primary");
  await until(page, (s) => byFile(s, "Lee, Kevin").record.cadet_cc_initialed === true && !s.status.queued, 120000);
  await page.waitForTimeout(600);
  const lee = byFile(await state(), "Lee, Kevin");
  const d = await page.evaluate((id) => window.closet.api("GET", `/api/forms/${id}`), lee.id);
  assert.equal(d.analysis.slots.cadet_sqcc_initials.value, "RTH");
  assert.ok(d.analysis.slots.cadet_sqcc_date.value);
  assert.equal(d.analysis.slots.sqccf_initials.value, "ejs", "the earlier step is intact");
});

test("the date setting: off means initials only", async () => {
  await go("settings");
  await page.selectOption('[data-set="first_shirt_fill_date"]', "0");
  await page.waitForTimeout(400);
  assert.equal((await state()).settings.first_shirt_fill_date, false);
  await page.selectOption('[data-set="first_shirt_fill_date"]', "1");
  await page.waitForTimeout(400);
});

test("no page errors", () => {
  assert.deepEqual(errors, []);
});
