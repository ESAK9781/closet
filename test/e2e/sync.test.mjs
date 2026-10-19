// Drives the real app through sync mode on generated sample forms (never real paperwork).
//   npm run test:e2e

import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { PDFDocument } from "pdf-lib";

import { inspect } from "../../src/core/signable.js";
import { makeSamples } from "../../tools/make-samples.mjs";
import { launch, settled, until } from "./launch.mjs";

let tmp;
let app;
let page;
let errors;
const dir = (...p) => path.join(tmp, ...p);
const state = () => page.evaluate(() => window.closet.api("GET", "/api/state"));
const byFile = (s, n) => s.forms.find((f) => f.filename.startsWith(n));
const files = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name) : []);
const go = async (view) => {
  await page.evaluate((v) => { location.hash = "#/" + v; }, view);
  await page.waitForTimeout(400);
};
const modalTitle = async () => {
  await page.waitForSelector(".modal-scrim", { timeout: 30000 });
  return page.textContent(".modal h2");
};
const modalClick = async (label) => {
  await page.click(`.modal-actions .btn:text-is("${label}")`);
  await page.waitForTimeout(350);
};

/** Next dialog whose title matches; other signature alerts on the way are skipped, notices dismissed. */
async function nextModal(want) {
  for (;;) {
    const t = await modalTitle();
    if (want.test(t)) return t;
    if (/can't be used/.test(t)) await modalClick("Skip for now");
    else if (/Files left alone/.test(t)) await modalClick("OK");
    else throw new Error(`unexpected dialog: ${t}`);
  }
}
/** After a sync: dismiss whatever alerts are left until the sync finishes. */
async function finishSync() {
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(400);
    if (await page.$(".modal-scrim")) {
      const t = await page.textContent(".modal h2");
      await modalClick(/can't be used/.test(t) ? "Skip for now" : "OK");
    } else if (!(await page.evaluate(() => document.body.dataset.syncing))) return;
  }
  throw new Error("sync never finished");
}

before(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "closet-e2e-sync-"));
  await makeSamples(dir("dump"));
  ({ app, page, errors } = await launch(dir("dump"), dir("userdata")));
  await settled(page);
  // the typo prompt isn't what this file is about
  assert.match(await modalTitle(), /Possible typo/);
  await modalClick("Different people");
  await page.waitForTimeout(600);
});

after(async () => {
  await app?.close();
  rmSync(tmp, { recursive: true, force: true });
});

test("settings: quick dump is the default, the packet is off, and sync folders only show in sync mode", async () => {
  await go("settings/routing");
  assert.equal(await page.inputValue('[data-set="dump_mode"]'), "quick");
  assert.equal(await page.inputValue('[data-set="print_packet"]'), "0");
  assert.equal((await page.$$("[data-sfc]")).length, 0, "no folder pickers in quick mode");
  await go("settings/data");
  assert.ok(await page.$("#quickChoose"), "quick dump folder shown in quick mode");
  await go("paperwork");
  assert.match(await page.textContent("#quickDump"), /Quick dump/);
  await go("settings/routing");
  await page.selectOption('[data-set="dump_mode"]', "sync");
  await page.waitForSelector("[data-sfc]");
  assert.equal((await page.$$("[data-sfc]")).length, 12, "five steps (send + returned), complete (send), new paperwork (returned)");
  await go("settings/data");
  assert.equal(await page.$("#quickChoose"), null, "quick dump folder hidden in sync mode");
  await go("paperwork");
  assert.match(await page.textContent("#quickDump"), /Sync/);
  assert.equal((await state()).sync.pending.length, 0);
});

test("folders: the dump folder can't be used; the rest are saved", async () => {
  const bad = await page.evaluate((d) => window.closet.api("PUT", "/api/settings", { sync_folders: { complete: { push: d } } }).then(() => "saved", (e) => e.message), dir("dump"));
  assert.match(bad, /dump folder/);
  await page.evaluate((root) => window.closet.api("PUT", "/api/settings", { sync_folders: {
    sqccf_processed: { push: root + "/send sqccf" },
    cadet_cc_initialed: { push: root + "/send cc" },
    recipient_signed: { push: root + "/send recipient", pull: root + "/back recipient" },
    aoc_signed: { push: root + "/send aoc", pull: root + "/back aoc" },
    complete: { push: root + "/complete" },
    intake: { pull: root + "/intake" },
  } }), dir("sync").split(path.sep).join("/"));
  for (const d of ["back recipient", "back aoc", "intake"]) fs.mkdirSync(dir("sync", d), { recursive: true });
  await go("settings/routing");
  assert.match(await page.textContent(".settings"), /send recipient/);
});

test("Sync: pushes every form to its first open step and leaves strangers alone", async () => {
  fs.mkdirSync(dir("sync", "send recipient"), { recursive: true });
  fs.writeFileSync(dir("sync", "send recipient", "someone put this here.pdf"), "not ours");
  await go("paperwork");
  await page.click("#quickDump");
  // the flattened sample has no AOC/AMT field at all: it's reported, with a picture of where it should be
  assert.match(await modalTitle(), /Maria L Garcia: the AOC\/AMT signature field can't be used/);
  assert.match(await page.textContent(".modal"), /no signature field here/i);
  assert.ok(await page.$(".modal .shot img"));
  await modalClick("Skip for now");
  await nextModal(/Files left alone/);
  assert.match(await page.textContent(".modal"), /someone put this here\.pdf/);
  await modalClick("OK");
  await finishSync();
  assert.ok(files(dir("sync", "send recipient")).includes("John Doe_Neg_F10_Uniform Violation.pdf"));
  assert.equal(fs.readFileSync(dir("sync", "send recipient", "someone put this here.pdf"), "utf8"), "not ours");
  fs.rmSync(dir("sync", "send recipient", "someone put this here.pdf"));
});

test("a field that can't be signed: shown with a screenshot; adding a field on top fixes the sent copy", async () => {
  const s = await state();
  const lee = byFile(s, "Lee, Kevin");
  await page.evaluate((id) => window.closet.api("PATCH", `/api/forms/${id}`, { overrides: { sqccf_processed: true, cadet_cc_initialed: true, recipient_signed: true } }), lee.id);
  await page.waitForTimeout(400);
  await page.click("#quickDump");
  assert.match(await nextModal(/Lee|Kevin/), /can't be used/);
  assert.ok(await page.$(".modal .shot img"), "screenshot of the spot");
  const shot = await page.$eval(".modal .shot", (e) => [e.clientWidth, e.clientHeight]);
  assert.ok(shot[0] > 150 && shot[1] > 20, `screenshot has size: ${shot}`);
  assert.match(await page.textContent(".modal"), /empty signature value/);
  assert.ok(!files(dir("sync", "send aoc")).includes(lee.filename), "held back until chosen");
  await modalClick("Add a new field");
  await page.waitForTimeout(600);
  const sent = dir("sync", "send aoc", lee.filename);
  assert.ok(fs.existsSync(sent));
  const st = await state();
  const target = { page: 0, rect: st.forms.find((f) => f.id === lee.id) && (await page.evaluate((id) => window.closet.api("GET", `/api/forms/${id}`), lee.id)).analysis.slots.sig_aoc.rect, kind: "Signature" };
  assert.equal((await inspect(fs.readFileSync(sent), target)).ok, true, "the pushed copy is signable");
  await finishSync();
});

test("a signed copy comes back: the confirm table matches it by name and content", async () => {
  const src = fs.readFileSync(dir("dump", "John Doe_Neg_F10_Uniform Violation.pdf"));
  const doc = await PDFDocument.load(src);
  doc.getForm().getTextField("Cadet Initials").setText("JAD");
  await new Promise((r) => setTimeout(r, 300));
  fs.writeFileSync(dir("sync", "back recipient", "John Doe_Neg_F10_Uniform Violation (signed).pdf"), await doc.save());
  const other = await PDFDocument.load(fs.readFileSync(dir("dump", "Tam Nguyen_Neg_F10_Room Inspection.pdf")));
  other.setTitle("returned");
  fs.writeFileSync(dir("sync", "back recipient", "scan0099.pdf"), await other.save());
  await go("paperwork");
  await page.click("#quickDump");
  assert.equal(await modalTitle(), "Match returned paperwork");
  const rows = await page.$$eval(".modal tr[data-i]", (trs) => trs.map((tr) => ({
    file: tr.querySelector(".who").textContent, pick: tr.querySelector("[data-pick] option:checked").textContent, rev: tr.querySelector("[data-rev]").checked,
  })));
  assert.equal(rows.length, 2);
  const signed = rows.find((r) => r.file.includes("(signed)"));
  assert.match(signed.pick, /^John Doe_Neg_F10_Uniform Violation\.pdf/);
  assert.equal(signed.rev, false, "confident match: not sent to review");
  // send the second one to Review instead of applying it
  const idx = rows.findIndex((r) => r.file === "scan0099.pdf");
  await page.check(`tr[data-i="${idx}"] [data-rev]`);
  await modalClick("Confirm");
  await finishSync();
  await until(page, (s) => s.sync.pending.some((p) => p.status === "review") && !s.status.queued, 120000);
  const st = await state();
  const john = byFile(st, "John Doe");
  assert.match((await page.evaluate((id) => window.closet.api("GET", `/api/forms/${id}`), john.id)).history.at(-1).what, /Replaced by sync/);
  assert.deepEqual(st.sync.pending.map((p) => p.filename), ["scan0099.pdf"]);
});

test("Review: the held-back match shows both versions side by side, expandable and zoomable", async () => {
  await go("review");
  await page.waitForSelector(".sync-compare .sheet");
  const open = await page.evaluate(() => document.querySelector(".modal h2")?.textContent || "");
  assert.equal(open, "", `unexpected dialog: ${open}`);
  assert.equal((await page.$$(".sync-compare .sheet")).length >= 2, true, "pulled copy and the stored form");
  const w0 = await page.$eval(".sync-compare .sheet", (e) => e.clientWidth);
  await page.click(".sync-compare [data-wide]");
  await page.waitForTimeout(300);
  const w1 = await page.$eval(".sync-compare .sheet", (e) => e.clientWidth);
  assert.ok(w1 >= 400 && w1 > w0 * 1.25, `expanded: ${w0} -> ${w1}`);
  await page.click('.sync-compare [data-z="2"]');
  await page.waitForTimeout(300);
  assert.ok((await page.$eval(".sync-compare .sheet", (e) => e.clientWidth)) > w1 * 1.8, "zoom enlarges the page");
  await page.click('.sync-compare [data-z="1"]');
  await page.click(".sync-compare [data-wide]"); // back to normal for the next test
  await page.click('.review-actions [data-s="ignore"]');
  await until(page, (s) => s.sync.pending.length === 0);
});

test("Review pane form preview: wider than before (~316px), zoomable, and expandable to the full card", async () => {
  await go("review");
  assert.ok((await page.$$("[data-rid]")).length, "something to review");
  await page.waitForSelector(".review-card .sheet");
  const w1 = await page.$eval(".review-card .sheet", (e) => e.clientWidth);
  const dims = await page.evaluate(() => ({ win: innerWidth, card: document.querySelector(".review-card").clientWidth, left: document.querySelector(".review-card .d-left").clientWidth, z: document.querySelector(".review-card .sheet").getAttribute("style") }));
  assert.ok(w1 >= 380, `review preview is ${w1}px wide ${JSON.stringify(dims)}`);
  await page.click('.review-card [data-zoom="2"]');
  assert.ok((await page.$eval(".review-card .sheet", (e) => e.clientWidth)) > w1 * 1.8, "zoom doubles it");
  await page.click('.review-card [data-zoom="1"]');
  await page.click("[data-wide]");
  const w2 = await page.$eval(".review-card .sheet", (e) => e.clientWidth);
  assert.ok(w2 >= 800, `expanded preview is ${w2}px wide`);
  assert.equal(await page.$eval(".review-card .d-right", (e) => getComputedStyle(e).display), "none");
  await page.click("[data-wide]");
  assert.equal(await page.$eval(".review-card .d-right", (e) => getComputedStyle(e).display) !== "none", true, "fields come back");
  assert.ok(await page.$eval(".queue", (e) => getComputedStyle(e).display !== "none"), "so does the queue");
});

test("switching back to Quick dump restores the old button", async () => {
  await go("settings/routing");
  await page.selectOption('[data-set="dump_mode"]', "quick");
  await go("settings/data");
  await page.waitForSelector("#quickChoose");
  await go("paperwork");
  assert.match(await page.textContent("#quickDump"), /Quick dump/);
});

test("no page errors", () => {
  assert.deepEqual(errors, []);
});
