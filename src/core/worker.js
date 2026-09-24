// Parser thread: loads the two templates once, then reads PDFs on request.

import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";

import { analyze, buildTemplate } from "./extract.js";
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

parentPort.on("message", async (msg) => {
  if (msg.type !== "analyze") return;
  try {
    const result = await analyze(msg.file, templates, msg.hint, msg.renderDir, msg.tol);
    parentPort.postMessage({ id: msg.id, result });
  } catch (e) {
    parentPort.postMessage({ id: msg.id, error: String(e?.message || e) });
  }
});
