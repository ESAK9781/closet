// Served tours and confinements: reading the serving log, balances, writing closet's records into a
// workbook, a new workbook from settings, and the email. All on generated sample forms and
// workbooks made here; nothing real.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { Store } from "../src/core/store.js";
import { mergeTracker, TRACKER_DEFAULTS } from "../src/core/tracker.js";
import { isoToSerial, patchWorkbook, readWorkbook, serialToIso } from "../src/core/xlsx.js";
import { makeSamples } from "../tools/make-samples.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tmp;
let store;
const outbox = [];
const dir = (...p) => path.join(tmp, ...p);
const sheetFile = () => dir("sheet", "Tracker.xlsx");
const sheet = (name) => readWorkbook(sheetFile()).find((s) => s.name === name);
const mailer = {
  status: () => ({ configured: true, user: "first.shirt@example.com", from_name: "", secure: true }),
  send: async (m) => { outbox.push(m); },
};

/** Fill the serving log of the workbook the way a person would. */
function serve(rows, cfg = TRACKER_DEFAULTS.served) {
  const col = (k) => cfg.columns[k];
  patchWorkbook(sheetFile(), [{
    sheet: cfg.sheet, headerRow: cfg.header_row,
    columns: [
      { header: col("date"), values: rows.map((r) => (r.date ? { date: isoToSerial(r.date) } : null)) },
      { header: col("cadet"), values: rows.map((r) => r.cadet) },
      { header: col("type"), values: rows.map((r) => r.type) },
      { header: col("amount"), values: rows.map((r) => r.amount) },
      { header: col("notes"), values: rows.map((r) => r.notes || null) },
    ],
  }]);
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "closet-tracker-"));
  await makeSamples(dir("dump"));
  store = new Store({ dumpDir: dir("dump"), metaDir: dir("metadata"), templatesDir: path.join(ROOT, "resources/templates"), mailer });
  await store.ready;
  await sleep(300);
  await store.whenIdle();
});

after(async () => {
  await store?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("Excel dates round-trip", () => {
  assert.equal(isoToSerial("2026-08-17"), 46251);
  assert.equal(serialToIso(46251), "2026-08-17");
  assert.equal(isoToSerial("not a date"), null);
});

test("a new workbook matches the default layout, and can be read back", () => {
  const made = store.tracker.createTemplate(sheetFile());
  assert.deepEqual(made.sheets, ["Conduct Log", "Served Log", "Cadet Balances"]);
  const conduct = sheet("Conduct Log");
  assert.deepEqual(conduct.rows.get(1).slice(0, 4), ["Date", "Class Year", "Form Type", "Reason Category"]);
  assert.equal(conduct.rows.get(1)[14], "Other");
  const served = sheet("Served Log");
  assert.deepEqual(served.rows.get(9).slice(1, 7), ["Date Served", "Cadet Name", "Sanction Type", "Amount Served", "Supervisor / Monitor", "Notes"]);
  assert.equal(served.rows.get(2)[1], "Cadet Disciplinary Serving Log");
  assert.equal(sheet("Cadet Balances").rows.get(9)[10], "Status");
});

test("nothing is read until a sheet is set, and a wrong path is a sentence, not a crash", () => {
  assert.match(store.tracker.pull().error, /No discipline sheet/);
  store.updateSettings({ tracker: { path: dir("sheet", "missing.xlsx") } });
  assert.match(store.tracker.view().error, /isn't there|isn't where/);
  assert.throws(() => store.updateSettings({ tracker: { path: "C:/x/notes.txt" } }), /\.xlsx/);
});

test("the serving log is read: only completed discipline, balances for everyone", () => {
  const snap = store.snapshot();
  const base = store.tracker.balances(snap);
  const owes = base.list.find((p) => p.tours.assigned > 0 && p.on_file);
  assert.ok(owes, "the sample forms assign tours to someone");
  const parts = owes.name.split(" ");
  const [first, last] = [parts.slice(0, -1).join(" "), parts.at(-1)];
  serve([
    { date: "2026-09-02", cadet: `${last}, ${first}`, type: "Tour", amount: 1, notes: "Cleaned the hall" }, // another way of writing the name
    { date: "2026-09-03", cadet: owes.name, type: "tour", amount: 1 },
    { date: "2026-09-03", cadet: owes.name, type: "Confinement", amount: 2 },
    { date: "2026-09-04", cadet: "", type: "Tour", amount: 3 }, // nobody named
    { date: "2026-09-04", cadet: owes.name, type: "Detail", amount: 3 }, // not a tour or confinement
    { date: "2026-09-04", cadet: owes.name, type: "Tour", amount: 0 }, // nothing served
    { date: "2026-09-05", cadet: "Nobody Onfile", type: "Tour", amount: 2 },
  ]);
  store.updateSettings({ tracker: { path: sheetFile() } });
  const r = store.tracker.view();
  assert.equal(r.error, "");
  assert.equal(r.entries, 4);
  assert.deepEqual(r.skipped, { unnamed: 1, unknown_type: 1, bad_amount: 1 });
  const p = r.balances.find((x) => x.key === owes.key);
  assert.equal(p.tours.served, 2);
  assert.equal(p.tours.left, Math.max(0, owes.tours.assigned - 2));
  assert.equal(p.confinements.served, 2);
  assert.equal(p.confinements.left, Math.max(0, owes.confinements.assigned - 2));
  assert.ok(r.unmatched.includes("Nobody Onfile") || r.unmatched.some((n) => /Onfile/.test(n)), "a name with no paperwork is reported, not dropped");
  assert.ok(r.balances.length >= base.list.length, "everyone with paperwork has a balance");
  assert.equal(r.recent[0].date, "2026-09-05");
});

test("the serving log's layout is a setting: other headings, other sheet, another header row", () => {
  const custom = {
    sheet: "Done", header_row: 3, tour_word: "TOUR", confinement_word: "CONF",
    columns: { date: "When", cadet: "Who", type: "What", amount: "How many", supervisor: "", notes: "" },
  };
  const file = dir("sheet", "Other.xlsx");
  store.tracker.createTemplate(file);
  patchWorkbook(file, [{ sheet: "Served Log", headerRow: 9, columns: [] }]); // an untouched round trip keeps the workbook valid
  const t = store.tracker.read(file, TRACKER_DEFAULTS.served);
  assert.equal(t.entries.length, 0);
  assert.throws(() => store.tracker.read(file, custom), /no sheet called “Done”/);
  assert.throws(() => store.tracker.read(file, { ...custom, sheet: "Served Log" }), /Couldn't find the headings/);
  // headings are found even when the header row number is wrong
  const found = store.tracker.read(sheetFile(), { ...TRACKER_DEFAULTS.served, header_row: 2 });
  assert.equal(found.header_row, 9);
  assert.equal(found.entries.length, 4);
});

test("settings are checked", () => {
  const bad = (patch, re) => assert.throws(() => mergeTracker(TRACKER_DEFAULTS, patch), re);
  bad({ served: { header_row: 0 } }, /row number/);
  bad({ served: { sheet: "a/b" } }, /can't contain/);
  bad({ served: { columns: { cadet: "" } } }, /needs a heading/);
  bad({ served: { tour_word: "Same", confinement_word: "same" } }, /different words/);
  bad({ push: { columns: [{ header: "A", source: "date" }, { header: "a", source: "issuer" }] } }, /listed twice/);
  bad({ push: { columns: [{ header: "A", source: "nope" }] } }, /no valid source/);
  const ok = mergeTracker(TRACKER_DEFAULTS, { served: { sheet: "Done" } });
  assert.equal(ok.served.sheet, "Done");
  assert.equal(ok.served.columns.cadet, "Cadet Name", "the rest of the layout is kept");
});

test("push is off until asked for, then replaces the conduct log and leaves the serving log alone", () => {
  assert.throws(() => store.tracker.push(), /Turn on/);
  store.updateSettings({ tracker: { push: { enabled: true, balances: { enabled: true } } } });
  const before = sheet("Served Log").rows.get(10).slice();
  const forms = store.snapshot().forms.filter((f) => f.parsed && !f.archived);
  const expected = forms.reduce((n, f) => n + f.rows.length, 0);
  const r = store.tracker.push();
  assert.equal(r.rows, expected);
  assert.ok(fs.existsSync(r.backup), "a copy of the workbook was saved first");
  const conduct = sheet("Conduct Log");
  const head = conduct.rows.get(1);
  const recipient = head.indexOf("Recipient");
  assert.equal([...conduct.rows.entries()].filter(([n, row]) => n > 1 && row.some(Boolean)).length, expected, "one row per recipient under the heading");
  const tours = head.indexOf("Tours");
  const names = [...conduct.rows.entries()].filter(([n, row]) => n > 1 && row[recipient]).map(([, row]) => row[recipient]);
  assert.ok(names.every(Boolean));
  const sampleRow = [...conduct.rows.entries()].find(([n, row]) => n > 1 && row[tours] !== "");
  assert.ok(sampleRow, "tours are written as values");
  assert.ok(/^\d+$/.test(conduct.rows.get(2)[0]), "dates are Excel dates");
  assert.deepEqual(sheet("Served Log").rows.get(10).slice(), before, "the serving log is never written");
  const bal = [...sheet("Cadet Balances").rows.entries()].filter(([n, row]) => n > 9 && row[1]).map(([, row]) => row[1]);
  assert.ok(bal.length >= 2 && bal.every((n) => names.includes(n)), "cadet names are written for the sheet's own formulas");
  // pushing again with fewer rows leaves no leftovers
  store.updateSettings({ tracker: { push: { columns: [{ header: "Date", source: "date" }, { header: "Recipient", source: "recipient" }] } } });
  const again = store.tracker.push();
  assert.equal(again.rows, expected);
  assert.equal(sheet("Conduct Log").rows.get(1)[14], "Other", "columns that aren't mapped are left as they were");
});

test("push refuses a sheet whose headings aren't where Settings says, and a missing sheet", () => {
  store.updateSettings({ tracker: { push: { header_row: 5 } } });
  assert.throws(() => store.tracker.push(), /Row 5|empty but the sheet has data/);
  store.updateSettings({ tracker: { push: { header_row: 1, sheet: "Nope" } } });
  assert.throws(() => store.tracker.push(), /no sheet called “Nope”/);
  store.updateSettings({ tracker: { push: { sheet: "Conduct Log" } } });
});

test("the email says what's served and what's left, and what it shows is a setting", async () => {
  const snap = store.snapshot();
  const people = store.notify.people(snap);
  const owes = store.tracker.balances(snap).list.find((p) => p.tours.assigned > 0 && p.on_file);
  const person = people.get(owes.key);
  const mail = (opts = {}) => store.notify.compose(person, "Hello", { balances: store.notify.balanceMap(snap), ...opts });
  const c = mail();
  assert.match(c.text, new RegExp(`Tours: ${owes.tours.left} left to serve \\(${owes.tours.served} served of ${owes.tours.assigned} assigned\\)`));
  assert.match(c.text, /Confinements: \d+ left to serve/);
  assert.match(c.html, /left to serve/);

  store.notify.setContent({ balance_detail: false });
  assert.match(mail().text, new RegExp(`Tours: ${owes.tours.left} left to serve\\n`));
  store.notify.setContent({ balances: false, totals: false, footer: false, details: false, steps: false });
  const t = mail().text;
  assert.ok(!/Tours and confinements/.test(t) && !/Totals:/.test(t) && !/Sent by/.test(t) && !/\[[x ]\]/.test(t));
  assert.match(t, /Waiting on|Fully processed/, "status is still on");
  store.notify.setContent({ forms: false });
  assert.ok(!/Your paperwork on file/.test(mail().text));
  store.notify.setContent({ forms: true, only_open: true, positives: false });
  assert.ok(mail().forms <= person.forms.length);
  assert.throws(() => store.notify.setContent({ date: false, form: false, reason: false, details: false, status: false, outcomes: false }), /at least one column/);
  assert.throws(() => store.notify.setContent({ nope: true }), /Unknown/);
  assert.throws(() => store.notify.setContent({ footer: "yes" }), /on or off/);
  store.notify.setContent({ forms: true, date: true, form: true, reason: true, details: true, status: true, steps: true, outcomes: true, only_open: false, positives: true, totals: true, footer: true, balances: true, balance_detail: true });
  // and the sent mail uses it
  store.notify.addContact({ name: owes.name, email: "cadet@example.com", cadet: owes.name }, snap);
  const sent = await store.notify.send({ keys: [owes.key], subject: "Hi", message: "Hello {first_name}" }, snap);
  assert.equal(sent.sent, 1);
  assert.match(outbox.at(-1).text, /left to serve/);
});
