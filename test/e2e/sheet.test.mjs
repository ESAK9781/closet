// The discipline workbook through the real app: creating one, reading what was served, the Balances
// tab, writing records into it, and the email settings. Generated sample forms and a workbook made
// here only.
//   npm run test:e2e

import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { patchWorkbook, readWorkbook } from "../../src/core/xlsx.js";
import { makeSamples } from "../../tools/make-samples.mjs";
import { launch, settled } from "./launch.mjs";

let tmp;
let app;
let page;
let errors;
const dir = (...p) => path.join(tmp, ...p);
const book = () => dir("book", "Tracker.xlsx");
const api = (method, url, body) => page.evaluate(([m, u, b]) => window.closet.api(m, u, b), [method, url, body]);
const go = async (view) => {
  await page.evaluate((v) => { location.hash = "#/" + v; }, view);
  await page.waitForTimeout(600);
};
const modalTitle = async () => {
  await page.waitForSelector(".modal-scrim", { timeout: 60000 });
  return page.textContent(".modal h2");
};
const click = async (label) => {
  await page.click(`.modal-actions .btn:text-is("${label}")`);
  await page.waitForTimeout(500);
};

before(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "closet-e2e-sheet-"));
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

test("Balances starts empty-handed and says where served counts come from", async () => {
  await go("balances");
  assert.match(await page.textContent("#main"), /no discipline workbook is set/);
  assert.ok(await page.$("#results table"), "everyone with paperwork still has a balance");
  assert.ok((await page.$$eval("#results tbody tr", (r) => r.length)) > 0);
});

test("Settings: Create new workbook makes one and adopts it", async () => {
  await go("settings/sheet");
  await app.evaluate(({ dialog }, f) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: f }); }, book());
  await page.click("#tkCreate");
  await page.waitForTimeout(1500);
  assert.ok(fs.existsSync(book()));
  assert.deepEqual(readWorkbook(book()).map((s) => s.name), ["Conduct Log", "Served Log", "Cadet Balances"]);
  const s = await api("GET", "/api/state");
  assert.equal(s.settings.tracker.path, book());
  assert.match(await page.textContent(".settings"), /Create new workbook/);
});

test("served tours are read from the sheet and the balance shows", async () => {
  const bal = await api("GET", "/api/tracker");
  const owes = bal.balances.find((p) => p.tours.assigned > 0 && p.on_file);
  assert.ok(owes);
  patchWorkbook(book(), [{
    sheet: "Served Log", headerRow: 9,
    columns: [{ header: "Cadet Name", values: [owes.name] }, { header: "Sanction Type", values: ["Tour"] }, { header: "Amount Served", values: [1] }],
  }]);
  await go("settings/sheet");
  await page.click("#tkPull");
  await page.waitForTimeout(1200);
  const after = await api("GET", "/api/tracker");
  assert.equal(after.entries, 1);
  assert.equal(after.balances.find((p) => p.key === owes.key).tours.served, 1);
  await go("balances");
  await page.selectOption("#bf", "all");
  await page.fill("#bq", owes.name.split(" ").at(-1));
  await page.waitForTimeout(300);
  assert.match(await page.textContent("#results"), new RegExp(owes.name));
  assert.match(await page.textContent(".kpis"), /Tours still to serve/);
});

test("writing to the workbook is off until allowed, then replaces the conduct log", async () => {
  await go("settings/sheet");
  assert.ok(await page.$eval("#tkPush", (b) => b.disabled));
  await page.check('[data-tkb="push.enabled"]', { force: true });
  await page.waitForTimeout(1200);
  assert.ok(!(await page.$eval("#tkPush", (b) => b.disabled)));
  await page.click("#tkPush");
  assert.match(await modalTitle(), /Replace the conduct log/);
  await click("Replace the rows");
  await page.waitForTimeout(1500);
  const conduct = readWorkbook(book()).find((s) => s.name === "Conduct Log");
  assert.ok(conduct.rows.size > 5);
  assert.ok([...conduct.rows.values()].some((r) => r.includes("Pos") || r.includes("Neg")));
});

test("the column list is editable and a bad value is explained, not saved", async () => {
  await go("settings/sheet");
  const before = (await api("GET", "/api/state")).settings.tracker.push.columns.length;
  await page.click("#pcAdd");
  await page.waitForTimeout(1000);
  assert.equal((await api("GET", "/api/state")).settings.tracker.push.columns.length, before + 1);
  await page.click('[data-pcx="' + before + '"]');
  await page.waitForTimeout(1000);
  assert.equal((await api("GET", "/api/state")).settings.tracker.push.columns.length, before);
  await page.fill('[data-tk="served.header_row"]', "0");
  await page.dispatchEvent('[data-tk="served.header_row"]', "change");
  await page.waitForTimeout(800);
  assert.match(await page.textContent("#toasts"), /row number/);
  assert.equal((await api("GET", "/api/state")).settings.tracker.served.header_row, 9);
});

test("email settings: what the emails say is a set of switches", async () => {
  await go("settings/notify");
  await page.waitForSelector('[data-ct="balances"]');
  await page.uncheck('[data-ct="balances"]', { force: true });
  await page.waitForTimeout(1000);
  assert.equal((await api("GET", "/api/notify")).content.balances, false);
  await page.waitForSelector('[data-ct="balance_detail"][disabled]');
  await page.check('[data-ct="balances"]', { force: true });
  await page.waitForTimeout(800);
  assert.equal((await api("GET", "/api/notify")).content.balances, true);
  assert.deepEqual(errors, []);
});
