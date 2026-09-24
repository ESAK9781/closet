// Fix a pdf.js bug that makes large RGB images render in quadratic time outside the browser.
//
// convertRGBToRGBA() finishes each 16-row chunk with a tail loop that starts at `i * 4` instead of
// `srcPos + i * 4`. For every chunk after the first it re-walks all earlier rows (and never writes
// the chunk's last pixels). Browsers mostly take an ImageBitmap path and never notice; in Node
// every scanned-looking form page (one big RGB background image) took ~1.2 s instead of ~0.1 s.
//
// Runs on `npm install` (postinstall). Idempotent; fails loudly if pdf.js changed shape so the
// patch can be revisited rather than silently skipped.

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.dirname(require.resolve("pdfjs-dist/package.json"));
const BUG = "for (let j = i * 4, jj = srcPos + len; j < jj; j += 3)";
const FIX = "for (let j = srcPos + i * 4, jj = srcPos + len; j < jj; j += 3)";

let patched = 0;
for (const rel of ["legacy/build/pdf.mjs", "build/pdf.mjs"]) {
  const file = path.join(root, rel);
  let src;
  try {
    src = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const bugs = src.split(BUG).length - 1;
  const fixes = src.split(FIX).length - 1;
  if (bugs) {
    writeFileSync(file, src.split(BUG).join(FIX));
    patched += bugs;
  } else if (!fixes) {
    console.warn(`patch-pdfjs: ${rel} no longer contains the convertRGBToRGBA tail loop; check whether the upstream fix landed.`);
  }
}
console.log(patched ? `patch-pdfjs: fixed ${patched} quadratic RGB tail loop(s) in pdf.js` : "patch-pdfjs: pdf.js already patched");
