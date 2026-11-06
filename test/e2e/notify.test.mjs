// Email notifications through the real app: the settings sub-tabs, importing a contact sheet, linking
// a cadet to an email, sending, and automatic updates. Mail goes to a folder (CLOSET_MAIL_OUTBOX)
// instead of Gmail. Generated sample forms only.
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
const dir = (...p) => path.join(tmp, ...p);
const state = () => page.evaluate(() => window.closet.api("GET", "/api/state"));
const nv = () => page.evaluate(() => window.closet.api("GET", "/api/notify"));
const byFile = (s, n) => s.forms.find((f) => f.filename.startsWith(n));
const go = async (view) => {
  await page.evaluate((v) => { location.hash = "#/" + v; }, view);
  await page.waitForTimeout(500);
};
const modalTitle = async () => {
  await page.waitForSelector(".modal-scrim", { timeout: 60000 });
  return page.textContent(".modal h2");
};
const click = async (label) => {
  await page.click(`.modal-actions .btn:text-is("${label}")`);
  await page.waitForTimeout(400);
};
const stubOpen = (p) => app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, p);
const mail = () => (fs.existsSync(dir("outbox")) ? fs.readdirSync(dir("outbox")).sort().map((f) => JSON.parse(fs.readFileSync(dir("outbox", f), "utf8"))) : []);

before(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "closet-e2e-notify-"));
  await makeSamples(dir("dump"));
  process.env.CLOSET_MAIL_OUTBOX = dir("outbox");
  ({ app, page, errors } = await launch(dir("dump"), dir("userdata")));
  await settled(page);
  assert.match(await modalTitle(), /Possible typo/);
  await click("Different people");
});

after(async () => {
  delete process.env.CLOSET_MAIL_OUTBOX;
  await app?.close();
  rmSync(tmp, { recursive: true, force: true });
});

test("settings has a bar of sub-tabs fixed to the top, and the tab is in the address", async () => {
  await go("settings");
  const tabs = await page.$$eval(".set-tabs a", (a) => a.map((x) => x.textContent));
  assert.deepEqual(tabs, ["General", "Routing and sync", "Discipline sheet", "Push notifications", "Data and backup", "Updates"]);
  assert.equal(await page.$eval(".set-tabs", (e) => getComputedStyle(e).position), "sticky");
  assert.ok(await page.$('[data-set="month_format"]'), "General has the tracker values");
  assert.equal(await page.$("#backupExport"), null, "and not the backup controls");
  await page.click('.set-tabs a:has-text("Data and backup")');
  await page.waitForSelector("#backupExport");
  assert.match(await page.evaluate(() => location.hash), /settings\/data/);
  await page.click('.set-tabs a:has-text("Updates")');
  await page.waitForSelector("#updBody");
});

test("nothing is connected: the tab explains, sending is disabled, automatic updates can't be turned on", async () => {
  await go("notifications");
  assert.match(await page.textContent("#main"), /No Gmail account is connected/);
  assert.match(await page.textContent("#main"), /Nothing can be sent until then/);
  const err = await page.evaluate(() => window.closet.api("PUT", "/api/notify/auto", { enabled: true }).then(() => "", (e) => e.message));
  assert.match(err, /Set up email first/);
  const sent = await page.evaluate(() => window.closet.api("POST", "/api/notify/send", { keys: ["x"] }).then(() => "", (e) => e.message));
  assert.match(sent, /Gmail/);
  assert.equal(mail().length, 0);
});

test("connect Gmail, then import a sheet: names are matched to the forms' spellings", async () => {
  await go("settings/notify");
  await page.waitForSelector("#gmConnect");
  const bad = await page.evaluate(() => window.closet.gmailSave({ user: "nope", password: "x" }));
  assert.equal(bad.ok, false);
  await page.fill("#gmUser", "first.sergeant@gmail.com");
  await page.fill("#gmPass", "abcd efgh ijkl mnop");
  await page.fill("#gmName", "First Sergeant");
  await page.click("#gmConnect");
  await page.waitForSelector("#mailTest");
  assert.match(await page.textContent("#main"), /first\.sergeant@gmail\.com/);
  assert.ok(!JSON.stringify(await state()).includes("abcdefgh"), "the password never comes back to the page");

  const csv = dir("roster.csv");
  fs.writeFileSync(csv, [
    "Rank,Name,Email,Phone", "C2C,\"Kim, Daniel\",daniel.kim@school.edu,555-0100", "C3C,Kevin Lee,klee@school.edu,555-0101",
    "C4C,Maria L. Garcia,mgarcia@school.edu,", ",Nobody Atall,nobody@school.edu,", ",,orphan.address@school.edu,",
  ].join("\n"));
  await stubOpen(csv);
  await page.click("#ctImport");
  await page.waitForSelector("#contactRows tr[data-cid]");
  const v = await nv();
  const by = Object.fromEntries(v.contacts.map((c) => [c.email, c]));
  assert.equal(v.contacts.length, 5);
  assert.equal(by["daniel.kim@school.edu"].cadet, "Daniel Kim", "Last, First became the form's spelling");
  assert.equal(by["klee@school.edu"].cadet, "Kevin Lee");
  assert.equal(by["mgarcia@school.edu"].cadet, "Maria L Garcia", "middle initial: matched to the form's name");
  assert.equal(by["nobody@school.edu"].cadet, "");
  assert.equal(by["orphan.address@school.edu"].name, "Orphan Address");
  assert.ok(v.contacts.every((c) => c.auto === false), "everyone starts opted out");
  assert.match(await page.textContent(".banner.info"), /Added 5/);
  // correct one in the table
  const row = page.locator('#contactRows tr:has([data-cf="email"][value="nobody@school.edu"])');
  await row.locator('[data-cf="name"]').fill("Riya Patel");
  await row.locator('[data-cf="name"]').press("Tab");
  await page.waitForTimeout(600);
  assert.equal((await nv()).contacts.find((c) => c.email === "nobody@school.edu").cadet, "Riya Patel", "a corrected name finds its cadet");
});

test("a cadet not tied to an email is asked about, and the answer is remembered", async () => {
  const v = await nv();
  const c = v.contacts.find((x) => x.email === "klee@school.edu");
  await page.evaluate((id) => window.closet.api("PATCH", `/api/notify/contacts/${id}`, { cadet: "" }), c.id);
  await go("overview");
  assert.match(await modalTitle(), /Is this their email/);
  assert.match(await page.textContent(".modal"), /Kevin Lee/);
  assert.match(await page.textContent(".modal"), /klee@school\.edu/);
  await click("Yes, link them");
  await page.waitForTimeout(500);
  assert.equal((await nv()).contacts.find((x) => x.id === c.id).cadet, "Kevin Lee");
  assert.equal((await state()).notify.ties.length, 0);
});

test("signature: a switch in settings adds closing lines to the end of the email", async () => {
  await go("settings/notify");
  await page.waitForSelector("#sigOn");
  await page.fill("#sigText", "V/r,\nFirst Sergeant");
  await page.press("#sigText", "Tab");
  await page.waitForTimeout(500);
  await page.locator(".switch").click();
  await page.waitForTimeout(500);
  const sig = (await nv()).signature;
  assert.deepEqual(sig, { enabled: true, text: "V/r,\nFirst Sergeant" });
  assert.match(await page.textContent(".switch .lbl"), /On/);
});

test("the Notifications wizard: message, recipients (five ways), then review and send with progress", async () => {
  await go("notifications");
  await page.waitForSelector("#nSubject");
  assert.equal(await page.$$eval(".wiz-step", (e) => e.length), 3);
  assert.equal(await page.$eval("#nSubject", (e) => e.value), "Conduct paperwork update", "starts from the saved default");
  await page.fill("#nSubject", "Update for {first_name}");
  await page.fill("#nMessage", "Hi {first_name},\nhere is where things stand.");
  await page.check('input[name="nScope"][value="all"]');
  await page.waitForTimeout(900);
  assert.equal((await nv()).manual.subject, "Update for {first_name}", "the message is saved on the server");
  // it survives leaving the screen
  await go("settings");
  await go("notifications");
  assert.equal(await page.$eval("#nMessage", (e) => e.value), "Hi {first_name},\nhere is where things stand.");

  await page.click("#nwNext");
  await page.waitForSelector("[data-nmode]");
  assert.deepEqual(await page.$$eval("[data-nmode]", (b) => b.map((x) => x.textContent)), ["Pick people", "One person", "By class year", "Outstanding paperwork", "Everyone"]);
  assert.ok(await page.$eval('tr:has-text("Alex Brown") [data-nsel]', (c) => c.disabled), "no email on file, so not selectable");
  assert.ok(await page.$eval("#nwNext", (b) => b.disabled), "nobody picked yet");

  // "Everyone" fills the list from whoever has paperwork of the chosen kind
  await page.click('[data-nmode="everyone"]');
  assert.match(await page.textContent("#nwBar"), /\d+ (person|people) will be emailed/);
  await page.click('[data-nmode="outstanding"]');
  assert.ok(await page.$("#nwBar"));
  // by class year: tick several classes at once
  await page.click('[data-nmode="class"]');
  const yearBoxes = await page.$$("[data-nyear]");
  if (yearBoxes.length) {
    assert.match(await page.textContent("#nwBar"), /0 people will be emailed/, "nothing ticked yet");
    await page.click("#nYearAll");
    assert.equal(await page.$$eval("[data-nyear]:checked", (e) => e.length), yearBoxes.length, "every class can be ticked together");
  }
  // "One person" is a search; it picks exactly one
  await page.click('[data-nmode="one"]');
  await page.fill("#nQ", "Daniel");
  await page.check('tr:has-text("Daniel Kim") [data-none]');
  assert.match(await page.textContent("#nwBar"), /1 person will be emailed/);
  // picking by hand
  await page.click('[data-nmode="manual"]');
  await page.check('tr:has-text("Daniel Kim") [data-nsel]');
  await page.check('tr:has-text("Kevin Lee") [data-nsel]');
  assert.match(await page.textContent("#nwBar"), /2 people will be emailed/);
  await page.click("#nwNext");

  await page.waitForSelector("#nSend");
  assert.match(await page.textContent("#nSend"), /Send to 2 people/);
  await page.click('tr:has-text("Daniel Kim") [data-npreview]');
  assert.match(await modalTitle(), /Preview/);
  const html = await page.innerHTML(".mail-preview");
  assert.match(html, /here is where things stand/);
  assert.match(html, /<b>Waiting on/);
  await click("Close");
  await page.click("#nTest");
  await page.waitForFunction(() => /Test sent/.test(document.querySelector("#toasts")?.textContent || ""), null, { timeout: 20000 });
  assert.deepEqual(mail()[0].to, ["first.sergeant@gmail.com"]);
  assert.match(mail()[0].subject, /^\[TEST/);
  await page.click("#nSend");
  assert.match(await modalTitle(), /Email 2 people/);
  await click("Send");
  await page.waitForSelector("#nwAgain", { timeout: 30000 });
  assert.match(await page.textContent("#nwBody"), /Sent/);
  const m = mail().slice(1);
  assert.equal(m.length, 2);
  assert.deepEqual(m.map((x) => x.to[0]).sort(), ["daniel.kim@school.edu", "klee@school.edu"]);
  const dan = m.find((x) => x.to[0] === "daniel.kim@school.edu");
  assert.equal(dan.subject, "Update for Daniel");
  assert.ok(dan.text.startsWith("Hi Daniel,"));
  assert.match(dan.html, /<table/);
  await page.click("#nwAgain");
  await page.waitForSelector("#nSubject");
  assert.equal(await page.$eval("#nMessage", (e) => e.value), "Hi {first_name},\nhere is where things stand.", "the next notification starts from the same message");
  await go("notifications/recent");
  assert.match(await page.textContent("#nLog"), /Sent/);
});

test("Notifications has two sub-tabs: the send wizard and what was recently sent", async () => {
  await go("notifications");
  assert.deepEqual(await page.$$eval(".set-tabs a", (a) => a.map((x) => x.textContent)), ["Send a notification", "Recently sent"]);
  assert.ok(await page.$("#nwBody"));
  assert.equal(await page.$("#nLog"), null, "the log is not on the wizard's page");
  await page.click('.set-tabs a:has-text("Recently sent")');
  await page.waitForSelector("#nLog");
  assert.match(await page.evaluate(() => location.hash), /notifications.recent/);
  assert.equal(await page.$("#nwBody"), null);
});

test("long recipient lists are paginated, and selecting all matching reaches past the page", async () => {
  await go("notifications");
  await page.waitForSelector("#nwBody");
  // pretend the roster is large: 60 people cloned from a real one
  await page.evaluate(() => {
    const base = S.nv.people.find((p) => p.emails.length);
    S.nv.people = Array.from({ length: 60 }, (_, i) => ({ ...base, key: "k" + i, name: "Person " + String(i + 1).padStart(2, "0"), emails: ["p" + i + "@school.edu"] }));
    S.nw = nwFresh();
    S.nw.step = 2;
    renderWizard();
  });
  assert.equal(await page.$$eval("#nwBody tbody tr", (r) => r.length), 25, "one page of names");
  assert.match(await page.textContent(".pager"), /Showing 1.25 of 60/);
  await page.click('.pager button:has-text("Next")');
  assert.match(await page.textContent(".pager"), /Showing 26.50 of 60/);
  assert.match(await page.textContent("#nwBody tbody tr"), /Person 26/);
  await page.click('.pager [aria-label="Page 3"]');
  assert.equal(await page.$$eval("#nwBody tbody tr", (r) => r.length), 10, "the last, shorter page");
  await page.click("#nAll");
  assert.match(await page.textContent("#nwBar"), /60 people will be emailed/, "every match, not just the visible page");
  await page.click("#nwNext");
  await page.waitForSelector("#nSend");
  assert.equal(await page.$$eval("#nwBody tbody tr", (r) => r.length), 25, "the review list is paged too");
  assert.match(await page.textContent(".pager"), /of 60/);
  await go("settings"); // leaving drops the made-up roster; the real one is fetched again
  await go("notifications");
});

test("automatic updates: off for everyone, opt people in, and only a step passing after turning it on is announced", async () => {
  assert.equal((await nv()).auto.enabled, false);
  await go("settings/notify");
  await page.waitForSelector("#autoOn");
  await page.selectOption("#autoOn", "1");
  await page.waitForTimeout(600);
  assert.equal((await nv()).auto.enabled, true);
  // tick only the SQ/CCF step
  await page.check('[data-stage="sqccf_processed"]');
  for (const k of ["issuer_signed", "cadet_cc_initialed", "recipient_signed", "aoc_signed"]) await page.uncheck(`[data-stage="${k}"]`);
  await page.waitForTimeout(500);
  assert.deepEqual((await nv()).auto.stages, ["sqccf_processed"]);
  // opt in Daniel only, with the table's own checkbox
  await page.check('#contactRows tr:has([data-cf="email"][value="daniel.kim@school.edu"]) [data-cauto]');
  await page.waitForTimeout(400);
  assert.deepEqual((await nv()).contacts.filter((c) => c.auto).map((c) => c.email), ["daniel.kim@school.edu"]);
  await page.waitForTimeout(9500); // let the change debounce settle so the baseline is taken
  const before = mail().length;
  const s = await state();
  const dan = s.forms.find((f) => f.record.recipient_list?.includes("Daniel Kim"));
  const kev = byFile(s, "Lee, Kevin");
  assert.equal(dan.record.sqccf_processed, false);
  await page.evaluate(([a, b]) => Promise.all([a, b].map((id) => window.closet.api("PATCH", `/api/forms/${id}`, { overrides: { sqccf_processed: true } }))), [dan.id, kev.id]);
  await until(page, () => mail().length > before, 30000).catch(() => {});
  const t0 = Date.now();
  while (mail().length === before && Date.now() - t0 < 25000) await page.waitForTimeout(500);
  const got = mail().slice(before);
  assert.equal(got.length, 1, "only the opted-in person");
  assert.deepEqual(got[0].to, ["daniel.kim@school.edu"]);
  assert.match(got[0].subject, /SQ\/CCF/);
  assert.match(got[0].text, /Just completed/);
});

test("disconnecting Gmail turns automatic updates off and keeps the contact list", async () => {
  await go("settings/notify");
  await page.click("#gmailOff");
  await click("Disconnect");
  await page.waitForTimeout(700);
  const v = await nv();
  assert.equal(v.ready, false);
  assert.equal(v.auto.enabled, false);
  assert.equal(v.contacts.length, 5);
  await go("notifications");
  assert.match(await page.textContent("#main"), /Nothing can be sent until then/);
});

test("no page errors", () => {
  assert.deepEqual(errors, []);
});
