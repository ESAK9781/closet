// Email notifications on generated sample forms (never real paperwork): name formats, reading a
// contact spreadsheet, the registry, the summary email, and the safeguards around sending.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { extractContacts, parseDelimited, readSpreadsheet } from "../src/core/contacts.js";
import { inScope } from "../src/core/notify.js";
import { bestMatch, displayName, nameDistance } from "../src/core/people.js";
import { Store } from "../src/core/store.js";
import { makeSamples } from "../tools/make-samples.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tmp;
let store;
let gmail = null; // what the fake mailer reports; null = nothing connected
let drafts = false; // Outlook in drafts mode: mail is saved, not sent
const outbox = [];
const dir = (...p) => path.join(tmp, ...p);
const snap = () => store.snapshot();

const mailer = {
  status: () => (gmail ? { configured: true, user: gmail, from_name: "", secure: true, drafts, pace: 0 } : { configured: false, reason: "No Gmail account is connected yet." }),
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

test("{first_name}, {last_name} and {name} fill in whatever way a name was written", () => {
  const n = store.notify;
  const fill = (name) => n.personalise("Dear {first_name} / {last_name} / {name} / {LastName}", { name });
  assert.equal(fill("John A. Doe"), "Dear John / Doe / John A. Doe / Doe");
  assert.equal(fill("Doe, John A."), "Dear John / Doe / Doe, John A. / Doe");
  assert.equal(fill("C2C Doe, John"), "Dear John / Doe / C2C Doe, John / Doe");
  assert.equal(fill("John Doe Jr."), "Dear John / Doe / John Doe Jr. / Doe", "a suffix is not the last name");
  assert.equal(fill("Mary O'Brien-Smith"), "Dear Mary / O'Brien-Smith / Mary O'Brien-Smith / O'Brien-Smith");
  assert.equal(fill("DOE, JOHN"), "Dear John / Doe / DOE, JOHN / Doe", "capitals are softened");
  assert.equal(n.personalise("Hi {last_name}", { name: "Cher" }), "Hi Cher", "a one-word name is its own last name");
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
  assert.match(pv.html, /<b>Waiting on: /, "what the reader must act on is bold");
  assert.ok(!/Rewards \/ sanctions/.test(pv.html) || /Rewards \/ sanctions/.test(pv.text), "the rewards column only appears when someone has something");
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

test("Outlook drafts mode: manual sends are reported as drafted, automatic updates refuse to run", async () => {
  const n = store.notify;
  gmail = "first.sergeant@example.mil";
  drafts = true;
  try {
    const p = [...n.people(snap()).values()].find((x) => n.contactsFor(x.key).length);
    const r = await n.send({ keys: [p.key], subject: "Update", message: "Hello" }, snap());
    assert.equal(r.sent, 1);
    assert.equal(r.drafted, true);
    assert.equal(n.state.log.at(-1).drafted, true);
    assert.throws(() => n.setAuto({ enabled: true }), /drafts/);
    drafts = false;
    const r2 = await n.send({ keys: [p.key], subject: "Update", message: "Hello" }, snap());
    assert.equal(r2.drafted, false);
    assert.equal(n.state.log.at(-1).drafted, undefined);
  } finally {
    drafts = false;
  }
});

test("final Form 10 copies: attached only when on, only fully signed, and the email carries no colour or icons", async () => {
  const n = store.notify;
  const ALL = { sqccf_processed: true, cadet_cc_initialed: true, recipient_signed: true, aoc_signed: true };
  const first = [...n.people(snap()).values()].find((x) => n.contactsFor(x.key).length && x.forms.some((f) => f.record.form_type === "F10"));
  assert.ok(first, "a sample cadet with an email and a Form 10");
  const target = first.forms.find((f) => f.record.form_type === "F10");
  store.updateForm(target.id, { overrides: ALL });
  const person = n.people(snap()).get(first.key);
  assert.equal(n.finalCopies(person).files.length, 0, "off by default");
  n.setContent({ attach_final: true });
  try {
    const { files } = n.finalCopies(person);
    const expected = person.forms.filter((f) => f.record.form_type === "F10" && f.record.counted);
    assert.equal(files.length, expected.length);
    assert.ok(files.every((f) => fs.existsSync(f.path) && /\.pdf$/i.test(f.filename)));
    const open = person.forms.find((f) => f.record.form_type === "F10" && !f.record.counted);
    if (open) assert.ok(!files.some((f) => f.filename === open.filename), "an unsigned form is never attached");
    const pv = n.preview({ key: person.key, subject: "s", message: "m" }, snap());
    assert.equal(pv.attachments.length, files.length);
    assert.match(pv.text, /Attached: the final signed copy/);
    assert.doesNotMatch(pv.html, /#[0-9a-f]{6}.*background|background:#|letter-spacing|text-transform|&#10003;/i, "no fills, icons or decorative type");
    gmail = "first.sergeant@example.mil";
    outbox.length = 0;
    await n.send({ keys: [person.key], subject: "s", message: "m" }, snap());
    assert.equal(outbox.at(-1).attachments.length, files.length, "the files travel with the message");
  } finally {
    n.setContent({ attach_final: false });
    store.updateForm(target.id, { overrides: Object.fromEntries(Object.keys(ALL).map((k) => [k, null])) });
  }
});

test("the wizard: the message is remembered, scope picks the forms, and progress is reported", async () => {
  const n = store.notify;
  gmail = "first.sergeant@example.mil";
  n.setDraft({ subject: "Monthly update", message: "Hi {first_name}", scopes: ["negative", "rejected"], content: { totals: false } });
  const back = n.load().manual;
  assert.equal(back.subject, "Monthly update");
  assert.equal(back.message, "Hi {first_name}");
  assert.deepEqual(back.scopes, ["negative", "rejected"], "several kinds at once");
  assert.equal(back.content.totals, false, "saved to disk, so it survives a restart");
  assert.throws(() => n.setDraft({ scopes: ["negative", "nonsense"] }), /Unknown kind/);
  assert.throws(() => n.setDraft({ content: { nope: true } }), /Unknown/);
  assert.throws(() => n.setDraft({ content: { forms: true, date: false, form: false, reason: false, details: false, status: false, steps: false, outcomes: false } }), /at least one column/);

  const v = n.view(snap());
  assert.ok(v.scopes.length === 6 && v.manual.scopes.length === 2);
  const p = v.people[0];
  for (const k of v.scopes.map((x) => x.key)) assert.ok(Number.isInteger(p.rel[k]) && p.out[k] <= p.rel[k], k);
  assert.equal(p.rel.all, p.forms);
  assert.equal(p.fl.length, p.forms, "one entry per form, with the kinds it belongs to");
  assert.ok(p.fl.every((f) => f.in.includes("all")));
  assert.ok(v.people.some((x) => x.rel.positive === 0), "someone has no positive paperwork, so a positive notice would leave them out");

  // the forms listed follow the scope; a person with nothing in it still gets an email (the wizard's "one person")
  const people = [...n.people(snap()).values()].filter((x) => n.contactsFor(x.key).length);
  const none = people.find((x) => !x.forms.some((f) => f.record.rejected));
  assert.ok(none);
  outbox.length = 0;
  const r = await n.send({ keys: [none.key], subject: "s", message: "m", scope: "rejected", content: { attach_final: false } }, snap());
  assert.equal(r.sent, 1);
  assert.match(outbox.at(-1).text, /No paperwork matches this update/);
  // several kinds at once: a form is listed if it fits any of them
  const everyone = [...n.people(snap()).values()];
  const person = everyone.find((x) => x.forms.length > 1) || everyone[0];
  const rows = (scope) => (n.preview({ key: person.key, subject: "s", message: "m", scope }, snap()).html.match(/<tr>/g) || []).length - 1; // minus the header row
  const kinds = ["negative", "positive", "rejected"];
  const per = kinds.map((k) => person.forms.filter((f) => inScope(f.record, k)).length);
  assert.equal(rows(kinds), per.reduce((a, b) => a + b, 0), "the kinds are exclusive of each other, so the lists add up");
  assert.equal(rows(["all", "rejected"]), person.forms.length, "Everything plus another kind is still just everything");
  assert.equal(n.sendProgress.running, false);
  assert.equal(n.sendProgress.done, n.sendProgress.total);
  assert.throws(() => n.send({ keys: [none.key], subject: "s", message: "m", scope: "bogus" }, snap()), /Unknown kind/);
  assert.throws(() => n.send({ keys: [none.key], subject: "s", message: "m", scope: "all", content: { nope: true } }, snap()), /Unknown/);
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
