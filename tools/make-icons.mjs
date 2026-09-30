// Build every icon the app and site use from the one master logo.
//
//   node tools/make-icons.mjs
//
// Master: resources/logo/closet_icon.png. It has opaque black corners, so the first step turns
// the black that touches the image border transparent (soft edge, no dark fringe). Outputs:
//   resources/icon.png     1024 px, installers, macOS, Linux, window icon off Windows
//   resources/icon.ico     16-256 px, Windows exe, installer, taskbar
//   site/icon.png          256 px, landing page (favicon + header mark)
//   src/renderer/icon.png  128 px, the in-app sidebar mark and tab icon

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createCanvas, loadImage } from "@napi-rs/canvas";

const ROOT = path.resolve(import.meta.dirname, "..");
const master = await loadImage(readFileSync(path.join(ROOT, "resources/logo/closet_icon.png")));

/** Master pixels with the corner background made transparent. */
function cutOut() {
  const { width: w, height: h } = master;
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");
  ctx.drawImage(master, 0, 0);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const peak = (i) => Math.max(d[i], d[i + 1], d[i + 2]);
  const bg = new Uint8Array(w * h);
  const stack = [];
  const push = (x, y) => {
    const p = y * w + x;
    if (x < 0 || y < 0 || x >= w || y >= h || bg[p] || peak(p * 4) > 6) return;
    bg[p] = 1;
    stack.push(p);
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const p = stack.pop();
    const x = p % w;
    const y = (p - x) / w;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
  // Soft edge: a pixel next to the removed background gets the share of its 3x3 neighbourhood that
  // is icon as its opacity. Colours stay untouched (the body is nearly black at the bottom, so
  // guessing opacity from brightness would eat real pixels).
  const cover = (x, y) => {
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && !bg[ny * w + nx]) n++;
    }
    return n / 9;
  };
  for (let p = 0; p < w * h; p++) {
    const x = p % w;
    const y = (p - x) / w;
    if (bg[p]) { d[p * 4 + 3] = 0; continue; }
    const c = cover(x, y);
    if (c < 1) d[p * 4 + 3] = Math.round(Math.min(1, c * 1.35) * 255);
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const clean = cutOut();

/** Scale in halving steps so downsizing stays smooth. */
function resize(size) {
  let cur = clean;
  let w = cur.width;
  while (w / 2 > size) {
    w = Math.round(w / 2);
    const c = createCanvas(w, w);
    const x = c.getContext("2d");
    x.imageSmoothingQuality = "high";
    x.drawImage(cur, 0, 0, w, w);
    cur = c;
  }
  const out = createCanvas(size, size);
  const x = out.getContext("2d");
  x.imageSmoothingQuality = "high";
  x.drawImage(cur, 0, 0, size, size);
  return out;
}

const png = (size) => resize(size).encode("png");

writeFileSync(path.join(ROOT, "resources/icon.png"), await png(1024));
writeFileSync(path.join(ROOT, "site/icon.png"), await png(256));
writeFileSync(path.join(ROOT, "src/renderer/icon.png"), await png(128));

// .ico: a small header, one directory entry per size, then the PNG images themselves
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = await Promise.all(sizes.map(png));
const head = Buffer.alloc(6 + 16 * sizes.length);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(sizes.length, 4);
let offset = head.length;
sizes.forEach((s, i) => {
  const e = 6 + 16 * i;
  head[e] = s === 256 ? 0 : s;
  head[e + 1] = s === 256 ? 0 : s;
  head.writeUInt16LE(1, e + 4);
  head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(images[i].length, e + 8);
  head.writeUInt32LE(offset, e + 12);
  offset += images[i].length;
});
writeFileSync(path.join(ROOT, "resources/icon.ico"), Buffer.concat([head, ...images]));
console.log("icons written");
