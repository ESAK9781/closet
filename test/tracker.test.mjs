// Served tours and confinements: what counts, reading the serving log, balances (and by date),
// writing the whole workbook with live formulas, a new workbook from settings, OneDrive
// placeholders, and the email. All on generated sample forms and workbooks made here; nothing real.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { openZip } from "../src/core/backup.js";
import { ensureLocal, probe, settle } from "../src/core/cloud.js";
import { Store } from "../src/core/store.js";
import { mergeTracker, TRACKER_DEFAULTS, upgradeTracker } from "../src/core/tracker.js";
import { isoToSerial, patchWorkbook, readWorkbook, serialToIso } from "../src/core/xlsx.js";
import { makeSamples } from "../tools/make-samples.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ALL = { sqccf_processed: true, cadet_cc_initialed: true, recipient_signed: true, aoc_signed: true };
let tmp;
let store;
const outbox = [];
const dir = (...p) => path.join(tmp, ...p);
const sheetFile = () => dir("sheet", "Tracker.xlsx");
const sheet = (name) => readWorkbook(sheetFile()).find((s) => s.name === name);
const xmlOf = (n) => { const z = openZip(sheetFile()); try { return z.read(z.entries.find((e) => e.name === n)).toString("utf8").replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&"); } finally { z.close(); } };
const form = (name) => store.snapshot().forms.find((f) => f.filename.startsWith(name));
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

test("a new workbook matches the default layout, with formulas that add the balances up", () => {
  const made = store.tracker.createTemplate(sheetFile());
  assert.deepEqual(made.sheets, ["Conduct Log", "Served Log", "Cadet Balances"]);
  const conduct = sheet("Conduct Log");
  assert.deepEqual(conduct.rows.get(1).slice(0, 4), ["Date", "Class Year", "Form Type", "Reason Category"]);
  assert.equal(conduct.rows.get(1)[14], "Other");
  assert.equal(conduct.rows.get(1)[15], "Status", "the conduct log says whether a form is complete");
  const served = sheet("Served Log");
  assert.deepEqual(served.rows.get(9).slice(1, 7), ["Date Served", "Cadet Name", "Sanction Type", "Amount Served", "Supervisor / Monitor", "Notes"]);
  assert.equal(served.rows.get(2)[1], "Cadet Disciplinary Serving Log");
  assert.equal(sheet("Cadet Balances").rows.get(9)[10], "Status");
  const f = xmlOf("xl/worksheets/sheet3.xml");
  assert.match(f, /SUMIFS\('Conduct Log'!\$M:\$M,'Conduct Log'!\$G:\$G,\$B10,'Conduct Log'!\$P:\$P,"Complete"\)/, "only fully signed forms are assigned");
  assert.match(f, /SUMIFS\('Served Log'!\$E:\$E,'Served Log'!\$C:\$C,\$B10,'Served Log'!\$D:\$D,"\*Tour\*"\)/);
});

test("nothing is read until a sheet is set, and a wrong path is a sentence, not a crash", () => {
  assert.match(store.tracker.pull().error, /No discipline sheet/);
  store.updateSettings({ tracker: { path: dir("sheet", "missing.xlsx") } });
  assert.match(store.tracker.view().error, /isn't there|isn't where/);
  assert.throws(() => store.updateSettings({ tracker: { path: "C:/x/notes.txt" } }), /\.xlsx/);
});

test("tours and confinements count only once fully signed, and never on a rejected form", () => {
  const john = form("John Doe_Neg_F10");
  assert.equal(john.record.tours, "2");
  const of = (name) => store.tracker.balances().byKey.get(name);
  const key = store.tracker.balances().list.find((p) => p.name === "John A Doe").key;
  assert.equal(john.record.counted, false, "recipient hasn't signed yet");
  assert.equal(of(key).tours.assigned, 0, "an unsigned form assigns nothing");
  store.updateForm(john.id, { overrides: ALL });
  assert.equal(form("John Doe_Neg_F10").record.counted, true);
  assert.deepEqual([of(key).tours.assigned, of(key).confinements.assigned], [2, 1]);
  store.updateForm(john.id, { rejected: true });
  const rej = form("John Doe_Neg_F10");
  assert.equal(rej.rejected, true);
  assert.equal(rej.record.counted, false);
  assert.deepEqual([of(key).tours.assigned, of(key).confinements.assigned], [0, 0], "a rejected form assigns nothing");
  assert.equal(rej.needs_review, false);
  store.updateForm(john.id, { rejected: false });
  assert.deepEqual([of(key).tours.assigned, of(key).confinements.assigned], [2, 1]);
});

test("the serving log is read: only completed discipline, balances for everyone", () => {
  const key = store.tracker.balances().list.find((p) => p.name === "John A Doe").key;
  serve([
    { date: "2026-09-02", cadet: "Doe, John", type: "Tour", amount: 1, notes: "Cleaned the hall" }, // another way of writing the name
    { date: "2026-09-03", cadet: "John Doe", type: "tour", amount: 1 },
    { date: "2026-09-03", cadet: "John Doe", type: "Confinement", amount: 2 },
    { date: "2026-09-04", cadet: "", type: "Tour", amount: 3 }, // nobody named
    { date: "2026-09-04", cadet: "John Doe", type: "Detail", amount: 3 }, // not a tour or confinement
    { date: "2026-09-04", cadet: "John Doe", type: "Tour", amount: 0 }, // nothing served
    { date: "2026-09-05", cadet: "Nobody Onfile", type: "Tour", amount: 2 },
  ]);
  store.updateSettings({ tracker: { path: sheetFile() } });
  const r = store.tracker.view();
  assert.equal(r.error, "");
  assert.equal(r.entries, 4);
  assert.deepEqual(r.skipped, { unnamed: 1, unknown_type: 1, bad_amount: 1 });
  const p = r.balances.find((x) => x.key === key);
  assert.equal(p.tours.served, 2);
  assert.equal(p.tours.left, 0);
  assert.equal(p.confinements.served, 2);
  assert.equal(p.confinements.left, 0);
  assert.equal(p.confinements.over, 1, "served more than was assigned");
  assert.ok(r.unmatched.some((n) => /Onfile/.test(n)), "a name with no paperwork is reported, not dropped");
  assert.equal(r.recent[0].date, "2026-09-05");
});

test("balances can be limited to sanctions issued before a date", () => {
  const key = store.tracker.balances().list.find((p) => p.name === "John A Doe").key;
  store.tracker.state.entries = []; // nothing served, so the whole assignment is owed
  try {
    const at = (before) => store.tracker.balances(undefined, { before }).byKey.get(key);
    assert.deepEqual([at("").tours.left, at("").confinements.left], [2, 1]);
    assert.deepEqual([at("2026-09-13").tours.left, at("2026-09-13").tours.assigned], [2, 2], "the form is dated 12 Sep");
    assert.equal(at("2026-09-12").tours.assigned, 0, "before means strictly earlier");
    assert.equal(at("2026-01-01").tours.left, 0);
    const v = store.tracker.view(undefined, "2026-09-12");
    assert.equal(v.before, "2026-09-12");
    assert.equal(store.tracker.view(undefined, "garbage").before, "");
    // serving applies to the oldest sanctions first: one tour served leaves one old one owed
    store.tracker.state.entries = [{ row: 1, date: "2026-10-01", cadet: "John Doe", type: "tour", amount: 1 }];
    assert.equal(store.tracker.balances(undefined, { before: "2026-09-13" }).byKey.get(key).tours.left, 1);
  } finally {
    store.tracker.pull();
  }
});

test("the serving log's layout is a setting: other headings, other sheet, another header row", () => {
  const custom = {
    sheet: "Done", header_row: 3, tour_word: "TOUR", confinement_word: "CONF",
    columns: { date: "When", cadet: "Who", type: "What", amount: "How many", supervisor: "", notes: "" },
  };
  assert.throws(() => store.tracker.read(sheetFile(), custom), /no sheet called “Done”/);
  assert.throws(() => store.tracker.read(sheetFile(), { ...custom, sheet: "Served Log" }), /Couldn't find the headings/);
  const found = store.tracker.read(sheetFile(), { ...TRACKER_DEFAULTS.served, header_row: 2 }); // headings found even when the row number is wrong
  assert.equal(found.header_row, 9);
  assert.equal(found.entries.length, 4);
  assert.equal(found.raw.length, 7, "every row with anything in it is kept as written");
});

test("settings are checked, and older ones are brought up to date", () => {
  const bad = (patch, re) => assert.throws(() => mergeTracker(TRACKER_DEFAULTS, patch), re);
  bad({ served: { header_row: 0 } }, /row number/);
  bad({ served: { sheet: "a/b" } }, /can't contain/);
  bad({ served: { columns: { cadet: "" } } }, /needs a heading/);
  bad({ served: { tour_word: "Same", confinement_word: "same" } }, /different words/);
  bad({ push: { columns: [{ header: "A", source: "date" }, { header: "a", source: "recipient" }] } }, /listed twice/);
  bad({ push: { columns: [{ header: "A", source: "nope" }] } }, /no valid source/);
  bad({ push: { columns: [{ header: "A", source: "date" }] } }, /needs a column for “Recipient”/);
  bad({ push: { balances: { columns: [{ header: "A", source: "reports" }] } } }, /needs a column for “Cadet name”/);
  bad({ push: { sheet: "Served Log" } }, /three different sheets/);
  const ok = mergeTracker(TRACKER_DEFAULTS, { served: { sheet: "Done" } });
  assert.equal(ok.served.sheet, "Done");
  assert.equal(ok.served.columns.cadet, "Cadet Name", "the rest of the layout is kept");
  assert.equal(mergeTracker(TRACKER_DEFAULTS, { served: { tour_word: 'T"o*ur' } }).served.tour_word, "Tour", "characters that would break a formula are dropped");
  // settings saved by 2.2.0
  const old = { path: "C:/a.xlsx", push: { enabled: true, balances: { enabled: false, header: "Cadet Name" }, columns: TRACKER_DEFAULTS.push.columns.slice(0, 15) } };
  const up = mergeTracker(TRACKER_DEFAULTS, upgradeTracker(old));
  assert.equal(up.push.balances.enabled, true, "the whole workbook is written now");
  assert.equal(up.push.columns.at(-1).source, "status");
  assert.equal(up.path, "C:/a.xlsx");
});

test("push writes the whole workbook: conduct log, serving log and balances with live formulas", () => {
  assert.throws(() => store.tracker.push(), /Turn on/);
  store.updateSettings({ tracker: { push: { enabled: true } } });
  const forms = store.snapshot().forms.filter((f) => f.parsed && !f.archived);
  const expected = forms.reduce((n, f) => n + f.rows.length, 0);
  const r = store.tracker.push();
  assert.equal(r.rows, expected);
  assert.ok(fs.existsSync(r.backup), "a copy of the workbook was saved first");
  assert.deepEqual(r.warnings, []);

  const conduct = sheet("Conduct Log");
  const head = conduct.rows.get(1);
  const col = (h) => head.indexOf(h);
  const body = [...conduct.rows.entries()].filter(([n, row]) => n > 1 && row.some(Boolean)).map(([, row]) => row);
  assert.equal(body.length, expected, "one row per recipient under the heading");
  const johnRow = body.find((row) => row[col("Recipient")] === "John A Doe");
  assert.equal(johnRow[col("Status")], "Complete");
  assert.equal(johnRow[col("Tours")], "2");
  assert.ok(/^\d+$/.test(johnRow[col("Date")]), "dates are Excel dates");
  assert.ok(body.some((row) => row[col("Status")] === "In progress"));

  // the serving log is rewritten from itself: same rows, names spelled the way the balances look them up
  const sl = sheet("Served Log");
  const rows = [...sl.rows.entries()].filter(([n, row]) => n > 9 && row.some(Boolean)).map(([, row]) => row);
  assert.equal(rows.length, 7, "rows closet couldn't use are kept too");
  assert.equal(rows[0][2], "John A Doe", "“Doe, John” becomes the name on the forms");
  assert.equal(rows[0][1], String(isoToSerial("2026-09-02")));
  assert.ok(rows.some((row) => row[3] === "Detail"));
  assert.ok(rows.some((row) => row[2] === "" && row[3] === "Tour"), "the unnamed row is still there");

  // the balances sheet: names, formulas, and the results they give
  const bs = sheet("Cadet Balances");
  const brow = [...bs.rows.entries()].find(([n, row]) => n > 9 && row[1] === "John A Doe")[1];
  assert.deepEqual(brow.slice(4, 11), ["2", "2", "0", "1", "2", "0", "Clear"], "tours assigned, served, left, then confinements");
  const f = xmlOf("xl/worksheets/sheet3.xml");
  assert.match(f, /<f>IF\(\$B10="","",SUMIFS\('Conduct Log'!\$M:\$M/);
  assert.match(f, /<f>IF\(\$B10="","",MAX\(0,E10-F10\)\)<\/f>/);
  assert.match(f, /<f>IF\(\$B10="","",IF\(G10\+J10>0,"Outstanding Balance","Clear"\)\)<\/f>/);
  assert.match(f, /IF\(\$B100="","",/, "formulas wait below the last name for the next cadet");
  assert.equal(readWorkbook(sheetFile()).length, 3);

  // pushing again leaves nothing behind
  const again = store.tracker.push();
  assert.equal(again.rows, expected);
  const sl2 = sheet("Served Log");
  assert.equal([...sl2.rows.entries()].filter(([n, row]) => n > 9 && row.some(Boolean)).length, 7);
});

test("a form that isn't fully signed isn't counted by the sheet's formulas either (Status decides)", () => {
  const bs = () => [...sheet("Cadet Balances").rows.entries()].filter(([n, row]) => n > 9 && row[1]).map(([, row]) => row);
  const maria = bs().find((row) => row[1] === "Maria L Garcia");
  assert.ok(maria, "everyone with paperwork is on the balances sheet");
  assert.equal(maria[7], "0", "an unsigned form assigned no confinement");
  store.updateForm(form("Maria Garcia").id, { overrides: ALL });
  store.tracker.push();
  assert.equal(bs().find((row) => row[1] === "Maria L Garcia")[7], "1", "now it is signed by everyone");
  store.updateForm(form("Maria Garcia").id, { rejected: true });
  store.tracker.push();
  assert.equal(bs().find((row) => row[1] === "Maria L Garcia")[7], "0");
  const conduct = sheet("Conduct Log");
  const head = conduct.rows.get(1);
  assert.ok([...conduct.rows.values()].some((row) => row[head.indexOf("Recipient")] === "Maria L Garcia" && row[head.indexOf("Status")] === "Rejected"), "rejected forms stay in the log, marked");
});

test("push refuses a sheet whose headings aren't where Settings says, and a missing sheet", () => {
  store.updateSettings({ tracker: { push: { header_row: 5 } } });
  assert.throws(() => store.tracker.push(), /Row 5|empty but the sheet has data/);
  store.updateSettings({ tracker: { push: { header_row: 1, sheet: "Nope" } } });
  assert.throws(() => store.tracker.push(), /no sheet called “Nope”/);
  store.updateSettings({ tracker: { push: { sheet: "Conduct Log" } } });
  const before = fs.readFileSync(sheetFile());
  store.updateSettings({ tracker: { served: { sheet: "Nope" } } });
  assert.throws(() => store.tracker.push(), /Couldn't read the serving log first/);
  assert.deepEqual(fs.readFileSync(sheetFile()), before, "nothing was written");
  store.updateSettings({ tracker: { served: { sheet: "Served Log" } } });
});

test("OneDrive placeholders are downloaded before reading, and a stuck one is explained", () => {
  const od = dir("OneDrive - Test Org", "Docs");
  fs.mkdirSync(od, { recursive: true });
  const file = path.join(od, "Book.xlsx");
  fs.writeFileSync(file, "x");
  const real = { ...probe };
  try {
    let hydrated = false;
    probe.supported = () => true; // placeholders only exist on Windows; pretend, so this runs everywhere
    probe.attributes = () => (hydrated ? 0x20 : 0x400000 | 0x20); // RECALL_ON_DATA_ACCESS until its content has been read
    probe.read = () => { hydrated = true; };
    assert.equal(ensureLocal(file), true, "had to be downloaded");
    assert.equal(ensureLocal(file), false, "already here");
    probe.attributes = () => 0x400000;
    probe.read = () => { throw Object.assign(new Error("offline"), { code: "EIO" }); };
    assert.throws(() => ensureLocal(file, { timeoutMs: 100 }), /only in OneDrive.*signed in and not paused/);
    // a plain folder never asks
    probe.attributes = () => { throw new Error("not asked"); };
    assert.equal(ensureLocal(sheetFile()), false);
    assert.equal(settle(sheetFile()), true);
  } finally {
    Object.assign(probe, real);
  }
});

test("a placeholder workbook is hydrated before the serving log is read", () => {
  const od = dir("OneDrive - Test Org", "Tracker");
  fs.mkdirSync(od, { recursive: true });
  const file = path.join(od, "Tracker.xlsx");
  fs.copyFileSync(sheetFile(), file);
  const real = { ...probe };
  const seen = [];
  try {
    let hydrated = false;
    probe.supported = () => true;
    probe.attributes = () => (hydrated ? 0 : 0x400000);
    probe.read = (p) => { seen.push(path.basename(p)); hydrated = true; };
    store.updateSettings({ tracker: { path: file } });
    assert.deepEqual(seen, ["Tracker.xlsx"]);
    assert.equal(store.tracker.view().error, "");
  } finally {
    Object.assign(probe, real);
    store.updateSettings({ tracker: { path: sheetFile() } });
  }
});

test("the email says what's served and what's left, what's pending, and what it shows is a setting", async () => {
  const snap = store.snapshot();
  const people = store.notify.people(snap);
  const john = store.tracker.balances(snap).list.find((p) => p.name === "John A Doe");
  const person = people.get(john.key);
  const mail = (opts = {}) => store.notify.compose(person, "Hello", { balances: store.notify.balanceMap(snap), ...opts });
  const c = mail();
  assert.match(c.text, /Tours: 0 left to serve \(2 served of 2 assigned\)/);
  assert.match(c.html, /left to serve/);
  assert.match(c.text, /Totals: .* 2 tours, 1 confinements/, "the totals count the signed form");

  // a form still in the process shows what it will add, but doesn't count yet
  store.updateForm(form("John Doe_Neg_F10").id, { overrides: { recipient_signed: false } });
  const pending = store.notify.compose(store.notify.people(store.snapshot()).get(john.key), "Hello", { balances: new Map() });
  assert.match(pending.text, /Pending until fully signed: .*Tours: 2/);
  assert.match(pending.text, /0 tours, 0 confinements/);
  store.updateForm(form("John Doe_Neg_F10").id, { overrides: { recipient_signed: true } });

  store.notify.setContent({ balance_detail: false });
  assert.match(mail().text, /Tours: 0 left to serve\n/);
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
  store.notify.addContact({ name: john.name, email: "cadet@example.com", cadet: john.name }, snap);
  const sent = await store.notify.send({ keys: [john.key], subject: "Hi", message: "Hello {first_name}" }, snap);
  assert.equal(sent.sent, 1);
  assert.match(outbox.at(-1).text, /left to serve/);
});

test("a rejected form is out of the process: not sent on, not announced, still listed", async () => {
  const maria = form("Maria Garcia");
  assert.equal(maria.rejected, true);
  const email = store.notify.compose(store.notify.people(store.snapshot()).get(store.tracker.balances().list.find((p) => p.name === "Maria L Garcia").key), "Hello");
  assert.match(email.text, /Rejected: no further signatures needed/);
  assert.match(email.text, /Rejected: nothing from this form counts/);
  assert.equal(store.bulkPlan("cadet_cc_initialed").forms.some((f) => f.id === maria.id), false, "bulk steps skip it");
  assert.equal(maria.incomplete.length, 0);
});
