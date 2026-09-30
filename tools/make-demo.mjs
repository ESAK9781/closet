// A bigger, made-up squadron's worth of paperwork for screenshots and demos: about thirty forms
// across a few months, stalled at every routing step, plus a few that need a person's eye.
//
//   node tools/make-demo.mjs <out_dir>
//
// Every name and narrative is invented. Never point this at a real dump folder.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { PDFDocument } from "pdf-lib";

import { F10, F174, fill, load, scanPages, squiggle, widgetRects } from "./make-samples.mjs";

const day0 = Date.UTC(2026, 5, 28); // 28 Jun 2026
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const at = (offset) => new Date(day0 + offset * 864e5);
const dmy = (d) => `${String(d.getUTCDate()).padStart(2, "0")} ${MON[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
const iso = (d) => d.toISOString().slice(0, 10);

const ROS = [
  ["Mitchell, Sarah K", "C/Capt", "CS07/CCF"],
  ["Park, Daniel J", "C/SSgt", "CS07/A"],
  ["Ortiz, Elena M", "C/MSgt", "CS07/FS"],
  ["Hale, Winston R", "C/Lt Col", "CS07/CC"],
];

// name, class year, squadron, type, pos/neg, reason, day offset, narrative, [steps done | counselee, commander]
const FORMS = [
  ["Marcus Aldridge", 2028, "CS-07", "F10", "Neg", "Uniform Violation", 0, "Arrived at formation with boots unshined and ribbons out of order. Corrected on the spot and re-inspected at 1200.", 4],
  ["Priya Raman", 2027, "CS-07", "F10", "Pos", "Community Service", 3, "Organized and ran the squadron's food drive, collecting 1,200 lbs of donations for the local shelter.", 4],
  ["Tobias Kowalski", 2029, "CS-11", "F10", "Neg", "Late to Formation", 6, "Reported to morning formation four minutes after the call to attention. Second occurrence this month.", 4],
  ["Imani Brooks", 2028, "CS-07", "F10", "Neg", "Room Inspection", 9, "Room failed SAMI: dust on surfaces, bed not made to standard, wall locker out of order.", 4],
  ["Declan Rourke", 2027, "CS-03", "F10", "Neg", "Missed Accountability", 12, "Did not report for evening accountability and could not be located for 40 minutes.", 4],
  ["Sofia Marchetti", 2028, "CS-07", "F10", "Pos", "Outstanding Performance", 15, "Earned the highest inspection score in the group as element leader.", 4],
  ["Wei Zhang", 2029, "CS-14", "F10", "Neg", "Uniform Violation", 19, "Wore civilian jewelry with the service uniform during a briefing.", 4],
  ["Harper Lindqvist", 2027, "CS-07", "F10", "Neg", "Failure to Follow Instructions", 22, "Left the study area after being told to remain until the flight sergeant released the element.", 4],
  ["Jamal Okafor", 2028, "CS-11", "F10", "Pos", "Peer Mentorship", 26, "Tutored six fourth-class cadets through the customs and courtesies exam; all passed.", 4],
  ["Elena Vasquez", 2029, "CS-07", "F10", "Neg", "Late to Formation", 30, "Arrived at the flight formation two minutes late without notifying the element leader.", 4],
  ["Nathan Whitfield", 2028, "CS-03", "F10", "Neg", "Room Inspection", 34, "Room inspection deficiencies: floor not swept, trash not emptied.", 4],
  ["Grace Tanaka", 2027, "CS-07", "F10", "Pos", "Inspection Excellence", 38, "Prepared the flight for the wing inspection; zero discrepancies noted.", 4],
  ["Owen Petrakis", 2029, "CS-14", "F10", "Neg", "Unauthorized Absence", 43, "Left the dormitory area during study hours without a pass.", 3],
  ["Amara Diallo", 2028, "CS-07", "F10", "Neg", "Uniform Violation", 47, "Reported to PT formation in the wrong physical training uniform.", 3],
  ["Caleb Sorensen", 2027, "CS-11", "F10", "Neg", "Late to Formation", 52, "Late to Monday morning formation by five minutes.", 4],
  ["Lucia Fernandes", 2029, "CS-07", "F10", "Pos", "Volunteer Leadership", 56, "Led twelve cadets at the base honor-guard practice and the color-guard clinic.", 3],
  ["Isaiah Monroe", 2028, "CS-03", "F10", "Neg", "Missed Accountability", 61, "Missed Sunday accountability; reported forty minutes after the deadline.", 2],
  ["Hannah Novak", 2027, "CS-07", "F10", "Neg", "Room Inspection", 65, "Locker not in order at the weekly room inspection; second discrepancy this month.", 2],
  ["Rafael Quintero", 2029, "CS-14", "F10", "Neg", "Failure to Follow Instructions", 69, "Used a personal phone during formation after the flight commander's instruction to secure devices.", 3],
  ["Chloe Bergstrom", 2028, "CS-07", "F10", "Neg", "Uniform Violation", 73, "Hair out of regulation during an in-ranks inspection.", 1],
  ["Dev Malhotra", 2027, "CS-11", "F10", "Pos", "Community Service", 77, "Volunteered 14 hours at the regional food bank over two weekends.", 2],
  ["Riley Castellano", 2029, "CS-07", "F10", "Neg", "Late to Formation", 80, "Reported to evening formation three minutes late.", 1],
  ["Samuel Abara", 2028, "CS-03", "F10", "Neg", "Disrespect to Upperclass", 83, "Spoke over the element leader during a briefing after being asked to stop.", 1],
  ["Naomi Fischer", 2027, "CS-07", "F10", "Pos", "Outstanding Performance", 86, "Top score on the squadron physical fitness assessment.", 0],
  ["Marcus Aldridge", 2028, "CS-07", "F174", "Neg", "Uniform Follow-up", 4, "Reviewed uniform standards with the cadet following the 28 Jun report; expectations restated.", [true, true]],
  ["Tobias Kowalski", 2029, "CS-11", "F174", "Neg", "Repeated Lateness", 9, "Counseled on three late arrivals this month; agreed to a set wake-up plan.", [true, true]],
  ["Amara Diallo", 2028, "CS-07", "F174", "Neg", "Time Management", 49, "Discussed schedule conflicts between practice and formation; agreed on a plan.", [true, false]],
  ["Priya Raman", 2027, "CS-07", "F174", "Pos", "Element Leadership", 55, "Recognized for leading the element to top inspection scores.", [true, true]],
  ["Grace Tanaka", 2027, "CS-07", "F174", "Pos", "Peer Mentorship", 79, "Recognized for mentoring incoming fourth-class cadets.", [false, false]],
  ["Chloe Bergstrom", 2028, "CS-07", "F174", "Neg", "Uniform Standards", 74, "Counseled on grooming standards; reinspection scheduled.", [true, false]],
];

function f10Values(f, i) {
  const [name, year, sq, , pn, , off, narrative, steps] = f;
  const [last, first] = [name.split(" ").slice(-1)[0], name.split(" ").slice(0, -1).join(" ")];
  const ro = ROS[i % ROS.length];
  const d = at(off);
  const v = {
    "Recieving Cadet Name": `${last}, ${first}`, "Recieving Cadet Squadron": sq, "Recieving Cadet Year": String(year), Date: dmy(d),
    "Reporting Official": ro[0], "Reporting Grade": ro[1], "Reporting Org/Office Symbol": ro[2],
    "RO MFR Attached No": true, "Conduct Narrative": narrative,
  };
  if (pn === "Neg") Object.assign(v, { Demerits: String(3 + (i % 4)), Tours: i % 3 ? "0" : "2", Confinements: i % 5 ? "0" : "1" });
  if (steps >= 1) Object.assign(v, { "Initial Processing Date": dmy(at(off + 1)), "SQCCF Initials": "EJS" });
  if (steps >= 2) Object.assign(v, { "Cadet SQCC Initials": "RTH", "Cadet SQCC Date": dmy(at(off + 2)) });
  if (steps >= 3) Object.assign(v, { "Date Counseled": dmy(at(off + 4)) });
  if (steps >= 4) Object.assign(v, { "Date RO Notified": dmy(at(off + 5)) });
  return v;
}

async function makeF10(f, i) {
  const doc = await load(F10);
  fill(doc, f10Values(f, i));
  const r = widgetRects(doc);
  if (f[8] >= 3) squiggle(doc.getPage(0), r["Recieving Cadet Signature"][0]);
  if (f[8] >= 4) squiggle(doc.getPage(0), r["AOC Signature"][0]);
  return doc;
}

async function makeF174(f, i) {
  const [name, , sq, , , reason, off, narrative, [counselee, commander]] = f;
  const [last, first] = [name.split(" ").slice(-1)[0], name.split(" ").slice(0, -1).join(" ")];
  const ro = ROS[i % ROS.length];
  const doc = await load(F174);
  fill(doc, {
    "Recieving Name": `${last}, ${first}`, "Recieving Grade": ["C4C", "C3C", "C2C"][i % 3], "Recieving Unit/Office Symbol": sq,
    "Reason for Counseling": reason, "Couseling Summary": narrative,
    "Name Grade and Duty Title of Counselor": `${ro[1]} ${ro[0]}, First Sergeant`, "Couseling Date_af_date": iso(at(off)),
  });
  const r = widgetRects(doc);
  const sign = (k) => squiggle(doc.getPage(r[k][0].page), r[k][0]);
  if (counselee) sign("Counselee Signature");
  if (commander) sign("Commander Signature");
  return doc;
}

async function toScan(doc) {
  const scan = await PDFDocument.create();
  for (const png of await scanPages(await doc.save(), 150)) {
    const img = await scan.embedPng(png);
    scan.addPage([612, 792]).drawImage(img, { x: 2, y: -3, width: 612, height: 792 });
  }
  return scan;
}

export async function makeDemo(out) {
  mkdirSync(out, { recursive: true });
  const used = new Set();
  let i = 0;
  for (const f of FORMS) {
    const [name, , , type, pn, reason] = f;
    let doc = type === "F10" ? await makeF10(f, i) : await makeF174(f, i);
    const file = `${name}_${pn}_${type}_${reason}`;
    // a few paperwork problems a first sergeant really sees: a scan, a flattened copy, a bad filename
    let out_name = `${file}.pdf`;
    if (name === "Isaiah Monroe" && type === "F10") doc = await toScan(doc);
    else if (name === "Hannah Novak" && type === "F10") doc.getForm().flatten();
    else if (name === "Riley Castellano") out_name = "scan0117.pdf";
    if (used.has(out_name)) out_name = `${file} (2).pdf`;
    used.add(out_name);
    writeFileSync(path.join(out, out_name), await doc.save());
    i++;
  }
  return FORMS.length;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) {
    console.error("usage: node tools/make-demo.mjs <out_dir>   (never the real dump folder)");
    process.exit(1);
  }
  const n = await makeDemo(path.resolve(process.argv[2]));
  console.log(`wrote ${n} demo forms to ${path.resolve(process.argv[2])}`);
}
