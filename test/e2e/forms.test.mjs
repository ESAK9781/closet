// One-click steps in the form viewer (incl. the unofficial AOC/AMT stamp) and the paperwork filters,
// in the real app on generated sample forms.
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
const openForm = async (text) => {
  await go("paperwork");
  await page.click(`tr[data-open]:has-text("${text}")`);
  await page.waitForSelector("#drawer.open .auto-row, #drawer.open .route-lg");
  await page.waitForTimeout(300);
};
const rowsShown = () => page.$$eval("#results tbody tr[data-open]", (r) => r.length);
const setFilter = async (key, value) => {
  if (await page.$eval("#filterPanel", (p) => p.hidden)) await page.click("#filterBtn");
  await page.click(`[data-filter="${key}"][data-v="${value}"]`);
  await page.waitForTimeout(150);
};
const choices = (key) => page.$$eval(`[data-filter="${key}"]`, (b) => b.map((x) => x.textContent));

before(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "closet-e2e-forms-"));
  await makeSamples(path.join(tmp, "dump"));
  ({ app, page, errors } = await launch(path.join(tmp, "dump"), path.join(tmp, "userdata")));
  await settled(page);
  assert.match(await modalTitle(), /Possible typo/);
  await page.click('.modal-actions .btn:text-is("Different people")');
  await page.waitForTimeout(400);
});

after(async () => {
  await app?.close();
  rmSync(tmp, { recursive: true, force: true });
});

test("viewer: Initial for SQ/CCF touches only this form, then its button goes away", async () => {
  const s0 = await state();
  const lee = byFile(s0, "Lee, Kevin");
  assert.equal(lee.record.sqccf_processed, false);
  await openForm("Missed Formation");
  const labels = await page.$$eval("#drawer .auto-row .btn", (b) => b.map((x) => x.textContent.trim()));
  assert.deepEqual(labels, ["Initial for SQ/CCF", "Initial for Cadet CC", "Mark AOC/AMT approved…"]);
  await page.click('#drawer [data-act="auto:sqccf_processed"]');
  assert.match(await modalTitle(), /SQ\/CCF processing: initial this form\?/);
  await page.fill("#mInput", "ABC");
  await page.click(".modal-actions .btn.primary");
  await until(page, (s) => byFile(s, "Lee, Kevin").record.sqccf_processed === true && !s.status.queued, 120000);
  await page.waitForTimeout(700);
  const s1 = await state();
  for (const f of s1.forms) {
    if (f.id === lee.id) continue;
    assert.equal(f.record.sqccf_processed, s0.forms.find((x) => x.id === f.id).record.sqccf_processed, `${f.filename} unchanged`);
  }
  const d = await page.evaluate((id) => window.closet.api("GET", `/api/forms/${id}`), lee.id);
  assert.equal(d.analysis.slots.sqccf_initials.value, "ABC");
  const labels2 = await page.$$eval("#drawer .auto-row .btn", (b) => b.map((x) => x.textContent.trim()));
  assert.ok(!labels2.includes("Initial for SQ/CCF"));
  assert.ok(labels2.includes("Initial for Cadet CC"));
});

test("viewer: unsaved edits disable the one-click buttons", async () => {
  await page.fill('#drawer [data-rec="issuer"]', "Somebody Else");
  assert.equal(await page.$eval('#drawer [data-act="auto:cadet_cc_initialed"]', (b) => b.disabled), true);
  await page.click('#drawer .d-foot [data-act="discard"]');
  assert.equal(await page.$eval('#drawer [data-act="auto:cadet_cc_initialed"]', (b) => b.disabled), false);
});

test("viewer: AOC/AMT approval stamp, with a confirmation first; flags set; one form only", async () => {
  await page.click('#drawer [data-act="auto:approve"]');
  assert.equal(await modalTitle(), "Mark AOC/AMT approved?");
  assert.match(await page.textContent(".modal .stamp-demo"), /Marked AOC\/AMT approved by First Sergeant \(unofficial\)\s*AOC\/AMT Approved/);
  await page.click('.modal-actions .btn:text-is("Cancel")');
  await page.waitForTimeout(300);
  assert.equal(byFile(await state(), "Lee, Kevin").record.aoc_signed, false, "cancel changes nothing");
  await page.click('#drawer [data-act="auto:approve"]');
  await page.click('.modal-actions .btn:text-is("Apply stamp")');
  await until(page, (s) => byFile(s, "Lee, Kevin").record.aoc_signed === true && !s.status.queued, 120000);
  await page.waitForTimeout(700);
  const lee = byFile(await state(), "Lee, Kevin");
  const d = await page.evaluate((id) => window.closet.api("GET", `/api/forms/${id}`), lee.id);
  assert.equal(d.analysis.slots.sig_aoc.filled, true);
  assert.equal(d.analysis.slots.sig_aoc.source, "annotation");
  assert.match(d.history.at(-1).what, /unofficial/);
  assert.ok(!(await page.$$eval("#drawer .auto-row .btn", (b) => b.map((x) => x.textContent))).some((t) => /AOC/.test(t)));
  assert.equal(await page.$("#bulkAoc"), null, "no bulk AOC/AMT button");
  const r = await page.evaluate(() => window.closet.api("POST", "/api/bulk-step", { step: "aoc_signed", initials: "X" }).then(() => "ok", (e) => e.message));
  assert.match(r, /bulk/, "the engine refuses it too");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
});

test("filters: one Filter button with presets for progress, form, and result", async () => {
  await go("paperwork");
  const s = await state();
  const live = s.forms.filter((f) => !f.archived);
  const first = (f) => ["issuer_signed", "sqccf_processed", "cadet_cc_initialed", "recipient_signed", "aoc_signed"].find((k) => f.record[k] === false) || "complete";
  assert.equal(await rowsShown(), live.length);
  assert.equal((await page.$$("#main select")).length, 0, "no dropdown menus: one Filter control");
  assert.equal(await page.$$eval("[data-seg]", (b) => b.length), 0, "the separate type and Pos/Neg toggles are gone");
  assert.match(await page.textContent("#countLbl"), new RegExp(`${live.length} forms?`));

  // progress presets: one per completion level, plus fully complete
  await setFilter("step", "recipient_signed");
  assert.equal(await rowsShown(), live.filter((f) => f.parsed && first(f) === "recipient_signed").length);
  assert.match(await page.textContent("#countLbl"), /of \d+ forms/);
  const progress = await page.$$eval('[data-filter="step"]', (b) => b.map((x) => x.querySelector("span").textContent));
  assert.deepEqual(progress.filter((t) => /^Needs /.test(t)).slice(0, 5).length > 0, true, progress.join(" | "));
  assert.ok(progress.includes("Any progress") && progress.includes("Still needs a signature") && progress.includes("Needs Recipient"));
  assert.match(await page.textContent("#filterBtn"), /Filter · 1/);
  assert.match(await page.textContent(".fchip"), /Needs Recipient/);

  // form and result presets combine with it, and counts follow the other groups
  await setFilter("step", "all");
  await setFilter("type", "F174");
  assert.equal(await rowsShown(), live.filter((f) => f.record.form_type === "F174").length);
  await setFilter("pn", "Neg");
  assert.equal(await rowsShown(), live.filter((f) => f.record.form_type === "F174" && f.record.pos_neg === "Neg").length);
  assert.match(await page.textContent("#filterBtn"), /Filter · 2/);
  await setFilter("type", "F10");
  assert.equal(await rowsShown(), live.filter((f) => f.record.form_type === "F10" && f.record.pos_neg === "Neg").length);
  await setFilter("pn", "Pos");
  assert.equal(await rowsShown(), live.filter((f) => f.record.form_type === "F10" && f.record.pos_neg === "Pos").length);
  assert.equal(await page.$('[data-filter="step"][data-v="complete"]'), null, "a preset that would show nothing isn't offered");
  await setFilter("step", "open");
  assert.equal(await rowsShown(), live.filter((f) => f.parsed && f.record.form_type === "F10" && f.record.pos_neg === "Pos" && first(f) !== "complete").length);

  // a chip removes one; Clear removes everything, search included
  await page.click('[data-unfilter="step"]');
  await page.fill("#q", "smith");
  await page.click("#clearFilters");
  await page.waitForTimeout(250);
  assert.equal(await rowsShown(), live.length);
  assert.equal(await page.inputValue("#q"), "");
  assert.equal(await page.$("#clearFilters"), null, "the button goes away when nothing is filtered");
  await page.keyboard.press("Escape");
});

test("the Actions menu holds the automated actions and the download", async () => {
  await go("paperwork");
  assert.equal(await page.$$eval("#autoMenu #bulkSqccf, #autoMenu #bulkCc, #autoMenu #bulkDownload", (e) => e.length), 3, "both automated actions and the download live inside the menu");
  assert.equal(await page.$$eval(".toolbar > .btn", (b) => b.map((x) => x.textContent.trim()).join("|")), "Add files|Quick dump", "the bar itself stays short");
  assert.equal(await page.$eval("#autoMenu", (m) => m.hidden), true, "closed until asked for");
  await page.click("#autoBtn");
  assert.equal(await page.$eval("#autoMenu", (m) => m.hidden), false);
  assert.match(await page.textContent("#autoMenu"), /SQ\/CCF initials[\s\S]*Cadet Commander initials/);
  await page.click("#filterBtn");
  assert.equal(await page.$eval("#autoMenu", (m) => m.hidden), true, "opening the filter closes the menu");
  await page.keyboard.press("Escape");
  assert.equal(await page.$eval("#filterPanel", (m) => m.hidden), true, "Escape closes it");
});

test("the overview's 'awaiting a signature' tile lands on the matching filter", async () => {
  await go("overview");
  await page.click('[data-status="awaiting"]');
  await page.waitForTimeout(400);
  assert.match(await page.textContent(".fchip"), /Still needs a signature/);
  const s = await state();
  assert.equal(await rowsShown(), s.forms.filter((f) => !f.archived && f.parsed && ["issuer_signed", "sqccf_processed", "cadet_cc_initialed", "recipient_signed", "aoc_signed"].some((k) => f.record[k] === false)).length);
  await page.click("#clearFilters");
});

test("no page errors", () => {
  assert.deepEqual(errors, []);
});
