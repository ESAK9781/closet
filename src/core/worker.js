// Parser thread: loads the two templates once, then reads PDFs on request (and checks or patches
// them for sync: see signable.js).

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";

import { analyze, buildTemplate } from "./extract.js";
import { addField, approveAoc, fillSlots, inspect } from "./signable.js";
import { FORM_TYPES } from "./templates.js";

const templates = {};
try {
  for (const [ft, spec] of Object.entries(FORM_TYPES)) {
    templates[ft] = await buildTemplate(ft, path.join(workerData.templatesDir, spec.templateFile), workerData.cacheDir);
  }
  parentPort.postMessage({ type: "ready" });
} catch (e) {
  parentPort.postMessage({ type: "ready", error: `Blank templates couldn't be loaded: ${e.message || e}` });
}

const jobs = {
  analyze: (msg) => analyze(msg.file, templates, msg.hint, msg.renderDir, msg.tol),
  inspect: (msg) => inspect(readFileSync(msg.file), msg.target),
  // removes the empty AOC/AMT signature box, stamps "approved (unofficial)", fills dates
  approveAoc: async (msg) => {
    const r = await approveAoc(readFileSync(msg.file), msg.options);
    writeFileSync(msg.out, r.bytes);
    return { mode: r.mode, removed: r.removed };
  },
  // types text into the form (or lays text boxes on it) and writes the result to msg.out
  fillSlots: async (msg) => {
    const r = await fillSlots(readFileSync(msg.file), msg.items);
    writeFileSync(msg.out, r.bytes);
    return { mode: r.mode, how: r.how };
  },
  // writes the patched copy to msg.out, then checks the copy really is signable now
  addField: async (msg) => {
    const fixed = await addField(readFileSync(msg.file), msg.target, msg.label);
    const check = await inspect(fixed.bytes, msg.target);
    if (!check.ok) throw new Error(`The new field still can't be used: ${check.issues.map((i) => i.text).join("; ")}`);
    writeFileSync(msg.out, fixed.bytes);
    return { name: fixed.name, mode: fixed.mode };
  },
};

parentPort.on("message", async (msg) => {
  if (!jobs[msg.type]) return;
  try {
    parentPort.postMessage({ id: msg.id, result: await jobs[msg.type](msg) });
  } catch (e) {
    parentPort.postMessage({ id: msg.id, error: String(e?.message || e) });
  }
});
