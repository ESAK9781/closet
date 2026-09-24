// Drives the real Electron app over a freshly generated set of sample forms (never real paperwork).
//   npm run test:e2e

import assert from "node:assert/strict";
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
const row = (s, n, i = 0) => Object.fromEntries(s.columns.map((c, j) => [c, byFile(s, n).rows[i][j]]));
const go = async (view) => {
  await page.evaluate((v) => { location.hash = "#/" + v; }, view);
  await page.waitForTimeout(350);
};
const openForm = async (text) => {
  await go("paperwork");
  await page.click(`tr[data-open]:has-text("${text}")`);
  await page.waitForSelector("#drawer.open");
  await page.waitForTimeout(250);
};
const closeDrawer = async () => {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(350);
};

/** Answer the in-app dialog: optionally type into it, then click a button by its label. */
async function respond(button, text) {
  await page.waitForSelector(".modal-scrim", { timeout: 15000 });
  const title = await page.textContent(".modal h2");
  if (text !== undefined) await page.fill("#mInput", text);
  await page.click(`.modal-actions .btn:text-is("${button}")`);
  await page.waitForTimeout(300);
  return title;
}
const modalCount = () => page.$$eval(".modal-scrim", (m) => m.length);

before(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "closet-e2e-"));
  await makeSamples(path.join(tmp, "dump"));
  ({ app, page, errors } = await launch(path.join(tmp, "dump"), path.join(tmp, "userdata")));
  await settled(page);
});

after(async () => {
  await app?.close();
  rmSync(tmp, { recursive: true, force: true });
});

test("near-duplicate names: asked once, merged under the corrected spelling", async () => {
  assert.match(await respond("Same person"), /Possible typo/);
  assert.match(await respond("Use this spelling", "John A Doe"), /correct spelling/);
  const s = await state();
  assert.equal(row(s, "Jon Doe").Name, "John A Doe");
  assert.equal(row(s, "Jon Doe")["Class Year"], "2028", "picks up the class year from the other form");
  assert.equal(s.name_pairs.length, 0);
  await page.reload();
  await page.waitForTimeout(1200);
  assert.equal(await modalCount(), 0, "not asked again");
});

test("review queue: fill in a scanned form and mark it reviewed", async () => {
  await go("review");
  await page.click('[data-rid]:has-text("Room Inspection")');
  await page.waitForTimeout(500);
  await page.fill('[data-rec="recipients"]', "Tam Nguyen");
  await page.fill('[data-rec="date"]', "2026-09-14");
  await page.fill('[data-rec="class_year"]', "2029");
  await page.fill('[data-rec="tours"]', "3");
  await page.click('[data-act="savereview"]');
  await page.waitForTimeout(900);
  const s = await state();
  const f = byFile(s, "Tam Nguyen");
  assert.ok(f.reviewed && !f.needs_review);
  const r = row(s, "Tam Nguyen");
  assert.deepEqual([r.Name, r.Date, r["Class Year"], r.Tours], ["Tam Nguyen", "2026-09-14", "2029", "3"]);
});

test("positive F10 stays incomplete until CDNA and Passes are both entered", async () => {
  await go("review");
  const groups = await page.$$eval(".queue .group", (g) => g.map((x) => x.textContent));
  assert.ok(groups.some((g) => g.startsWith("Incomplete")), groups.join(" | "));
  await page.click('[data-rid]:has-text("Jane Smith")');
  await page.waitForTimeout(500);
  await page.fill('[data-rec="cdna"]', "3");
  await page.click('.review-actions [data-act="save"]');
  await page.waitForTimeout(800);
  assert.deepEqual(byFile(await state(), "Jane Smith").incomplete, ["Passes"]);
  await page.fill('[data-rec="passes"]', "2");
  await page.click('.review-actions [data-act="save"]');
  await page.waitForTimeout(800);
  const s = await state();
  assert.deepEqual(byFile(s, "Jane Smith").incomplete, []);
  assert.deepEqual([row(s, "Jane Smith").CDNA, row(s, "Jane Smith").Passes], ["3", "2"]);
});

test("several recipients: class year asked only for people not seen before", async () => {
  await openForm("Missed Formation");
  await page.fill('[data-rec="recipients"]', "Kevin Lee, Maria L Garcia, Carl Diaz");
  await page.click('.d-foot [data-act="save"]');
  assert.equal(await respond("Save", "abc"), "Class year for Carl Diaz?");
  assert.match(await page.textContent("#mErr"), /isn't a class year/, "bad input is explained in the dialog");
  await respond("Save", "2030");
  await page.waitForTimeout(600);
  assert.equal(await modalCount(), 0, "only the unknown recipient was asked about");
  const s = await state();
  assert.deepEqual(byFile(s, "Lee, Kevin").rows.map((r) => `${r[6]}=${r[1]}`), ["Kevin Lee=2026", "Maria L Garcia=2027", "Carl Diaz=2030"]);
  await closeDrawer();
});

test("unsaved changes: closing asks first, and Keep editing keeps them", async () => {
  await openForm("Uniform Violation");
  await page.fill('[data-rec="issuer"]', "Somebody Else");
  await page.keyboard.press("Escape");
  assert.match(await respond("Keep editing"), /Discard unsaved changes/);
  assert.ok(await page.$("#drawer.open"), "still open");
  await page.click('.d-foot [data-act="discard"]');
  await closeDrawer();
});

test("routing: a signature recorded after the fact", async () => {
  await openForm("Uniform Violation");
  await page.click('[data-flag="recipient_signed"]');
  await page.click('.d-foot [data-act="save"]');
  await page.waitForTimeout(700);
  assert.equal(byFile(await state(), "John Doe").record.recipient_signed, true);
  await closeDrawer();
});

test("archive from the list, restore from the Archive view", async () => {
  await go("paperwork");
  await page.click('tr:has-text("Daniel Kim") [data-archive]');
  await page.waitForTimeout(700);
  let s = await state();
  assert.ok(byFile(s, "scan0042").archived);
  assert.equal(await page.$("#drawer.open"), null, "archiving from the row doesn't open the form");
  await go("archive");
  await page.click("[data-restore]");
  await page.waitForTimeout(700);
  s = await state();
  assert.ok(!byFile(s, "scan0042").archived);
});

test("sheet export copies tab-separated rows and marks them logged", async () => {
  await go("export");
  await page.click("#copyLog");
  await page.waitForTimeout(900);
  const clip = await app.evaluate(({ clipboard }) => clipboard.readText());
  const lines = clip.split("\n");
  assert.ok(lines.length >= 11, `${lines.length} rows`);
  assert.ok(lines.every((l) => l.split("\t").length === 15), "15 columns");
  const s = await state();
  assert.ok(s.forms.filter((f) => !f.archived).every((f) => f.logged));
});

test("clear metadata and rescan", async () => {
  await go("settings");
  await page.click("#resetAll");
  assert.match(await respond("Clear and rescan"), /Clear all metadata/);
  // wait for the reset itself to land (edits gone) before waiting for the re-read to finish
  await until(page, (s) => s.forms.length && s.forms.every((f) => !f.logged));
  await settled(page);
  const s = await state();
  assert.ok(s.forms.every((f) => !f.logged && !f.reviewed));
  assert.equal(s.name_pairs.length, 1, "typo answers are cleared too");
});

test("no page errors", () => {
  assert.deepEqual(errors, []);
});
