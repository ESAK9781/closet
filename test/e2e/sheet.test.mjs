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
  assert.match(await page.textContent("#results"), /No one owes/, "unsigned forms assign nothing, so nobody owes yet");
  await page.selectOption("#bf", "all");
  await page.waitForTimeout(300);
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

const ALL = { sqccf_processed: true, cadet_cc_initialed: true, recipient_signed: true, aoc_signed: true };
const john = async () => (await api("GET", "/api/state")).forms.find((f) => f.filename.startsWith("John Doe_Neg_F10"));

test("tours only count once the form is fully signed", async () => {
  const bal = await api("GET", "/api/tracker");
  assert.ok(!bal.balances.some((p) => p.tours.assigned > 0), "nothing is assigned while forms are still unsigned");
  await api("PATCH", `/api/forms/${(await john()).id}`, { overrides: ALL });
  const after = await api("GET", "/api/tracker");
  assert.equal(after.balances.find((p) => p.name === "John A Doe").tours.assigned, 2);
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
  assert.match(await page.textContent(".kpis"), /still to serve/);
  assert.ok(!(await page.$$eval("#results th", (h) => h.map((x) => x.textContent))).includes("Status"), "no Status column to scroll sideways");
});

test("Balances can be limited to sanctions issued before a date, with presets", async () => {
  await go("balances");
  const presets = await page.$$eval("[data-bpreset]", (b) => b.map((x) => x.textContent));
  assert.deepEqual(presets.slice(0, 2), ["1 week ago", "2 weeks ago"]);
  await page.click('[data-bpreset="7"]');
  await page.waitForTimeout(800);
  const d = new Date();
  d.setDate(d.getDate() - 7);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  assert.equal(await page.inputValue("#bb"), iso);
  assert.match(await page.textContent("#main"), /Showing only fully signed sanctions on forms dated before/);
  await page.fill("#bb", "2026-01-01");
  await page.dispatchEvent("#bb", "change");
  await page.waitForTimeout(800);
  assert.equal((await api("GET", "/api/tracker?before=2026-01-01")).totals.tours.assigned, 0, "nothing was issued that early");
  await page.click("#bbClear");
  await page.waitForTimeout(800);
  assert.equal(await page.inputValue("#bb"), "");
});

test("a form can be marked rejected: it stays listed, leaves the process, and stops counting", async () => {
  const f = await john();
  await go(`paperwork?f=${f.id}`);
  await page.waitForSelector('[data-act="reject"]');
  await page.click('[data-act="reject"]');
  assert.match(await modalTitle(), /Mark this form rejected/);
  await click("Mark rejected");
  await page.waitForTimeout(1000);
  assert.ok(await page.$('[data-act="unreject"]'));
  const s = await api("GET", "/api/state");
  const rej = s.forms.find((x) => x.id === f.id);
  assert.equal(rej.rejected, true);
  assert.equal(rej.record.counted, false);
  assert.equal((await api("GET", "/api/tracker")).balances.find((p) => p.name === "John A Doe").tours.assigned, 0);
  await go("paperwork");
  assert.match(await page.textContent("#results"), /Rejected/, "still visible in the list");
  await page.click("#filterBtn");
  await page.click('[data-filter="step"][data-v="rejected"]');
  await page.waitForTimeout(400);
  assert.equal(await page.$$eval("#results tbody tr", (r) => r.length), 1);
  await page.click("#clearFilters");
  // not in the awaiting count, and put back with one click
  await go(`paperwork?f=${f.id}`);
  await page.click('[data-act="unreject"]');
  await page.waitForTimeout(1000);
  assert.equal((await api("GET", "/api/state")).forms.find((x) => x.id === f.id).rejected, false);
});

test("writing to the workbook is off until allowed, then replaces the conduct log", async () => {
  await go("settings/sheet");
  assert.ok(await page.$eval("#tkPush", (b) => b.disabled));
  await page.check('[data-tkb="push.enabled"]', { force: true });
  await page.waitForTimeout(1200);
  assert.ok(!(await page.$eval("#tkPush", (b) => b.disabled)));
  await page.click("#tkPush");
  assert.match(await modalTitle(), /Overwrite the workbook/);
  await click("Overwrite the workbook");
  await page.waitForTimeout(1500);
  const conduct = readWorkbook(book()).find((s) => s.name === "Conduct Log");
  assert.ok(conduct.rows.size > 5);
  assert.ok([...conduct.rows.values()].some((r) => r.includes("Pos") || r.includes("Neg")));
});

test("read and write sit at the top; the rarely edited sections are collapsed and stay open once opened", async () => {
  await go("settings/sheet");
  const top = await page.$$eval(".settings > section:first-child button", (b) => b.map((x) => x.id));
  assert.deepEqual(top, ["tkPull", "tkPush"], "both buttons are in the first panel");
  assert.ok(await page.$eval(".sheet-bar #tkPull", (b) => !b.disabled));
  const folds = await page.$$eval("details.fold", (d) => d.map((x) => [x.dataset.fold, x.open]));
  assert.deepEqual(folds, [["served", false], ["conduct", false], ["balances", false]]);
  assert.ok(!(await page.isVisible("#pcAdd")), "collapsed sections hide their fields");
  await page.click('summary:has-text("Conduct log columns")');
  assert.ok(await page.isVisible("#pcAdd"));
  await page.click('summary:has-text("Serving log and balances sheet")');
  await page.waitForTimeout(200);
  await page.check('[data-tkb="push.served.enabled"]', { force: true });
  await page.waitForTimeout(1000);
  assert.equal(await page.$eval('details[data-fold="conduct"]', (d) => d.open), true, "a save redraws the page but keeps what you opened");
  assert.equal(await page.$eval('details[data-fold="balances"]', (d) => d.open), true);
  await api("PUT", "/api/settings", { tracker: { push: { served: { enabled: true } } } });
});

test("the column list is editable and a bad value is explained, not saved", async () => {
  await go("settings/sheet");
  for (const t of ["Serving log layout", "Conduct log columns"]) {
    if (!(await page.isVisible(t === "Conduct log columns" ? "#pcAdd" : '[data-tk="served.header_row"]'))) await page.click(`summary:has-text("${t}")`);
  }
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
