// Email notifications on generated sample forms (never real paperwork): name formats, reading a
// contact spreadsheet, the registry, the summary email, and the safeguards around sending.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { extractContacts, parseDelimited, readSpreadsheet } from "../src/core/contacts.js";
import { bestMatch, displayName, nameDistance } from "../src/core/people.js";
import { Store } from "../src/core/store.js";
import { makeSamples } from "../tools/make-samples.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tmp;
let store;
let gmail = null; // what the fake mailer reports; null = nothing connected
const outbox = [];
const dir = (...p) => path.join(tmp, ...p);
const snap = () => store.snapshot();

const mailer = {
  status: () => (gmail ? { configured: true, user: gmail, from_name: "", secure: true } : { configured: false, reason: "No Gmail account is connected yet." }),
  send: async (m) => {
    if (m.to.some((a) => a.startsWith("bounce@"))) throw new Error("Gmail refused an address");
    outbox.push(m);
  },
};

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "closet-notify-"));
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

test("one person in many formats", () => {
  for (const a of ["Doe, John A.", "C2C John Doe", "Doe John", "john doe", "Cadet John A. Doe Jr.", "DOE, JOHN ALAN", "C/Capt Doe, John"]) {
    assert.equal(nameDistance(a, "John Doe"), 0, a);
  }
  assert.equal(nameDistance("Jon Doe", "John Doe"), 1, "a typo is close");
  assert.ok(nameDistance("Jane Smith", "John Smith") > 2, "different first names are different people");
  assert.ok(nameDistance("Al Li", "Ed Li") > 2, "short names never fuzzy-match");
  assert.equal(displayName("Doe, John A."), "John A Doe");
  const m = bestMatch("Smith, Jane", ["John Smith", "Jane Smyth", "Amy Wu"]);
  assert.equal(m.name, "Jane Smyth");
  assert.equal(bestMatch("Smith, Jane", ["John Smith", "Jane Smyth"], { distinct: (a, b) => b === "Jane Smyth" }), null, "pairs the user ruled different are skipped");
});

test("spreadsheets: emails found by regex, names from the cells to the left", () => {
  assert.deepEqual(parseDelimited('a,"b,c",d\n"x ""y""",2,3\n', ","), [["a", "b,c", "d"], ['x "y"', "2", "3"]]);
  const rows = [
    ["Cadet", "Email", "Class"],
    ["Doe, John A.", "jdoe@school.edu", "2028"],
    ["2028", "Amy", "Wu", "amy.wu@school.edu"],
    ["Jane Q Public <jane@p.com>"],
    ["", "", "someone.else@z.org"],
    ["Lee, Kevin", "kevin@a.com; KEVIN2@A.COM"],
    ["no email on this row"],
  ];
  const { pairs } = extractContacts([rows], { known: ["John Doe", "Amy Wu"], similarity: nameDistance });
  const by = Object.fromEntries(pairs.map((p) => [p.email, p]));
  assert.equal(by["jdoe@school.edu"].name, "Doe, John A.");
  assert.equal(by["amy.wu@school.edu"].name, "Amy Wu", "two cells next to the email join up");
  assert.equal(by["jane@p.com"].name, "Jane Q Public");
  assert.equal(by["someone.else@z.org"].name, "Someone Else");
  assert.equal(by["someone.else@z.org"].guessed, true, "a name taken from the address is marked as a guess");
  assert.equal(by["kevin@a.com"].name, "Lee, Kevin");
  assert.ok(by["kevin2@a.com"], "every email in a cell is kept, lowercased");
  assert.equal(pairs.length, 6);
});

test("the notification safeguards: nothing is connected, nothing breaks", async () => {
  const n = store.notify;
  assert.equal(n.ready().ok, false);
  assert.match(n.summary(snap()).reason, /Gmail/);
  assert.throws(() => n.send({ keys: ["x"], subject: "s", message: "m" }, snap()), /Gmail/);
  assert.throws(() => n.setAuto({ enabled: true }), /Gmail/);
  assert.equal((await n.check(snap())).queued, 0, "auto check with auto off does nothing");
  assert.equal(n.view(snap()).ready, false);
});

test("import: names are tweaked to the nearest recipient on file, and corrections survive a re-import", () => {
  const people = [...store.notify.people(snap()).values()];
  assert.ok(people.length >= 3, "sample forms have recipients");
  const known = people[0].name;
  const [first, ...rest] = known.split(" ");
  const last = rest.pop();
  const typo = `${first.slice(0, -1)}${first.slice(-1) === "n" ? "m" : "n"} ${last}`; // one letter off
  const file = dir("contacts.csv");
  fs.writeFileSync(file, `Name,Email\n"${last}, ${first}",real@school.edu\n${typo},typo@school.edu\nNobody Atall,nobody@school.edu\n`);
  const report = store.notify.importFile(file, snap());
  assert.equal(report.found, 3);
  assert.equal(report.added, 3);
  const by = Object.fromEntries(store.notify.state.contacts.map((c) => [c.email, c]));
  assert.equal(by["real@school.edu"].name, known, "Last, First -> the form's spelling");
  assert.equal(by["real@school.edu"].cadet, known);
  assert.equal(by["real@school.edu"].auto, false, "opted out by default");
  assert.equal(by["typo@school.edu"].cadet, known, "a near miss is tied to the same person");
  assert.equal(by["typo@school.edu"].sheet_name, typo, "what the sheet said is remembered");
  assert.equal(by["nobody@school.edu"].cadet, "", "no match: stored, not tied");
  // the user fixes one; a second import must not undo it
  store.notify.updateContact(by["nobody@school.edu"].id, { name: "Nobody Else" });
  const again = store.notify.importFile(file, snap());
  assert.equal(again.added, 0);
  assert.equal(again.existing, 3);
  assert.equal(store.notify.state.contacts.find((c) => c.email === "nobody@school.edu").name, "Nobody Else");
});

test("a new cadet is offered the untied contact with a matching name, and a no is remembered", () => {
  const n = store.notify;
  const [a, b] = [...n.people(snap()).values()].filter((p) => !n.contactsFor(p.key).length);
  const c = n.addContact({ name: b.name.split(" ").reverse().join(", "), email: "late@school.edu" }, { forms: [] }); // no forms to tie to yet
  assert.equal(c.cadet, "");
  const tie = n.suggestions(snap()).find((s) => s.key === b.key);
  assert.ok(tie, "suggested for the matching cadet");
  assert.equal(tie.candidates[0].email, "late@school.edu");
  assert.ok(!n.suggestions(snap()).some((s) => s.key === a.key && s.candidates.some((x) => x.email === "late@school.edu")), "not offered to someone else");
  n.answerTie(c.id, b.name, false);
  assert.ok(!n.suggestions(snap()).some((s) => s.key === b.key), "declined, so not asked again");
  n.answerTie(c.id, b.name, true);
  assert.equal(n.contactsFor(b.key)[0].email, "late@school.edu");
  assert.throws(() => n.addContact({ name: "X Y", email: "late@school.edu" }, snap()), /already/);
  assert.throws(() => n.addContact({ name: "X Y", email: "not-an-email" }, snap()), /isn't an email/);
});

test("the summary email: custom text first, then every form with its stage and sanctions", () => {
  const n = store.notify;
  const p = [...n.people(snap()).values()].find((x) => n.contactsFor(x.key).length);
  const first = p.name.split(" ")[0];
  const pv = n.preview({ key: p.key, subject: "Hello {first_name}", message: "Hi {first_name} <b>bold</b>\nsecond line" }, snap());
  assert.equal(pv.subject, `Hello ${first}`);
  assert.ok(pv.text.startsWith(`Hi ${first} <b>bold</b>`), "custom text leads");
  assert.ok(pv.html.includes("&lt;b&gt;bold&lt;/b&gt;"), "typed markup is escaped, not rendered");
  assert.ok(!pv.html.includes("<b>bold</b>"));
  assert.match(pv.html, /Rewards \/ sanctions/);
  assert.match(pv.text, /Waiting on:|Fully processed/);
  assert.equal((pv.html.match(/<tbody>[\s\S]*?<\/tbody>/)[0].match(/<tr>/g) || []).length, p.forms.length, "one row per form");
  assert.ok(p.forms.every((f) => !f.archived));
});

test("sending: only people with an email, one failure doesn't stop the rest, everything is logged", async () => {
  const n = store.notify;
  gmail = "first.sergeant@gmail.com";
  const tied = [...n.people(snap()).values()].filter((x) => n.contactsFor(x.key).length);
  const none = [...n.people(snap()).values()].find((x) => !n.contactsFor(x.key).length);
  assert.ok(tied.length >= 2 && none);
  n.removeContacts(n.contactsFor(tied[1].key).map((c) => c.id));
  n.addContact({ name: tied[1].name, email: "bounce@school.edu", cadet: tied[1].name }, snap());
  outbox.length = 0;
  const r = await n.send({ keys: [tied[0].key, tied[1].key, none.key, "ghost"], subject: "Update", message: "Hello" }, snap());
  assert.equal(r.sent, 1);
  assert.equal(r.failed.length, 1);
  assert.equal(r.skipped.length, 2);
  assert.equal(outbox.length, 1);
  assert.deepEqual(outbox[0].to, n.contactsFor(tied[0].key).map((c) => c.email));
  assert.ok(outbox[0].html && outbox[0].text);
  assert.ok(n.state.log.some((l) => l.ok === false && /refused/.test(l.error)));
  assert.throws(() => n.send({ keys: [], subject: "", message: "" }, snap()), /at least one/);
  const t = await n.send({ keys: [tied[0].key], subject: "x", message: "y", test: true }, snap());
  assert.equal(t.sent, 1);
  assert.deepEqual(outbox.at(-1).to, [gmail], "a test goes to the sender, not the cadet");
  assert.match(outbox.at(-1).subject, /^\[TEST/);
});

test("automatic updates: off for everyone, baseline on enabling, only opted-in people, only chosen steps", async () => {
  const n = store.notify;
  gmail = "first.sergeant@gmail.com";
  assert.ok(n.state.contacts.every((c) => c.auto === false), "every contact starts opted out");
  assert.equal(n.state.auto.enabled, false);
  outbox.length = 0;
  n.setAuto({ enabled: true, stages: ["sqccf_processed"] });
  assert.equal((await n.check(snap())).queued, 0, "enabling announces nothing that already happened");
  // opt one person in, then pass a step on one of their forms and on someone else's
  // Daniel Kim and Kevin Lee both have a form waiting on SQ/CCF
  const byName = (nm) => [...n.people(snap()).values()].find((p) => p.name === nm);
  n.addContact({ name: "Daniel Kim", email: "dkim@school.edu", cadet: "Daniel Kim" }, snap());
  n.addContact({ name: "Kevin Lee", email: "klee@school.edu", cadet: "Kevin Lee" }, snap());
  const [a, b] = [byName("Daniel Kim"), byName("Kevin Lee")];
  n.setAutoFor(n.contactsFor(a.key).map((c) => c.id), true);
  const fa = a.forms.find((f) => f.record.sqccf_processed === false);
  const fb = b.forms.find((f) => f.record.sqccf_processed === false);
  store.updateForm(fa.id, { overrides: { sqccf_processed: true } });
  store.updateForm(fb.id, { overrides: { sqccf_processed: true } });
  store.updateForm(fa.id, { overrides: { cadet_cc_initialed: true } }); // a step that isn't switched on
  const r = await n.check(snap());
  assert.equal(r.queued, 1, "only the opted-in person");
  await n.chain;
  assert.equal(outbox.length, 1);
  assert.deepEqual(outbox[0].to, n.contactsFor(a.key).map((c) => c.email));
  assert.match(outbox[0].subject, /SQ\/CCF/);
  assert.match(outbox[0].text, /Just completed/);
  assert.equal((await n.check(snap())).queued, 0, "a step is announced once");
  assert.throws(() => n.setAuto({ stages: ["nonsense"] }), /Unknown/);
});

test("automatic updates with Gmail gone: skipped and logged, nothing thrown", async () => {
  const n = store.notify;
  const a = [...n.people(snap()).values()].find((p) => p.name === "Daniel Kim"); // opted in above; recipient signature still open
  assert.equal(a.forms[0].record.recipient_signed, false);
  n.setAuto({ stages: ["sqccf_processed", "recipient_signed"] });
  gmail = null;
  store.updateForm(a.forms[0].id, { overrides: { recipient_signed: true } });
  assert.equal((await n.check(snap())).queued, 0);
  assert.ok(n.state.log.some((l) => l.kind === "auto" && /Skipped 1 update/.test(l.error || "") && /Gmail/.test(l.error)));
  assert.equal((await n.check(snap())).queued, 0, "and it isn't retried or re-logged");
  assert.equal(n.state.log.filter((l) => /Skipped 1 update/.test(l.error || "")).length, 1);
});

test("tab-separated files are read, and the old .xls format is refused with advice", () => {
  const tsv = dir("c.tsv");
  fs.writeFileSync(tsv, "Name\tEmail\nAmy Wu\tamy@x.edu\n");
  assert.deepEqual(readSpreadsheet(tsv)[0][1], ["Amy Wu", "amy@x.edu"]);
  fs.writeFileSync(dir("old.xls"), "x");
  assert.throws(() => readSpreadsheet(dir("old.xls")), /\.xls/);
});

test("the signature goes last in every email when on, and nowhere when off", () => {
  const n = store.notify;
  const p = [...n.people(snap()).values()].find((x) => n.contactsFor(x.key).length);
  const ask = { key: p.key, subject: "s", message: "m" };
  assert.ok(!n.preview(ask, snap()).text.includes("V/r"), "off by default");
  n.setSignature({ text: "V/r,\nFirst <Sergeant>", enabled: true });
  const pv = n.preview(ask, snap());
  assert.ok(pv.text.trimEnd().endsWith("--\nV/r,\nFirst <Sergeant>"));
  assert.ok(pv.html.includes("V/r,<br>First &lt;Sergeant&gt;"), "escaped, with line breaks");
  assert.ok(pv.html.lastIndexOf("V/r") > pv.html.lastIndexOf("Sent by the First Sergeant"));
  n.setSignature({ enabled: false });
  assert.ok(!n.preview(ask, snap()).text.includes("V/r"));
  assert.throws(() => n.setSignature({ text: "x".repeat(1001) }), /under 1,000/);
});
