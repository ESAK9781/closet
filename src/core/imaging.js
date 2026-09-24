// Small image-processing toolkit on typed arrays (what numpy/scipy did in the Python version).
// Images are { w, h, data } with one byte (gray) or one bit-as-byte (mask) per pixel.

export const THUMB_W = 48;
export const THUMB_H = 62;
export const DARK = 140; // gray level below which a pixel counts as ink
export const DILATE = 3; // px of slack around template ink when diffing

/** RGBA ImageData -> gray image. */
export function toGray({ width, height, data }) {
  const out = new Uint8Array(width * height);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    // alpha-composite onto white, then luma
    const a = data[i + 3] / 255;
    const r = data[i] * a + 255 * (1 - a);
    const g = data[i + 1] * a + 255 * (1 - a);
    const b = data[i + 2] * a + 255 * (1 - a);
    out[j] = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
  }
  return { w: width, h: height, data: out };
}

/** Small, blurred, zero-mean, unit-norm fingerprint of a page's printed layout. */
export function thumbFromGray(g) {
  const t = new Float32Array(THUMB_W * THUMB_H);
  for (let ty = 0; ty < THUMB_H; ty++) {
    const y0 = Math.floor((ty * g.h) / THUMB_H);
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * g.h) / THUMB_H));
    for (let tx = 0; tx < THUMB_W; tx++) {
      const x0 = Math.floor((tx * g.w) / THUMB_W);
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * g.w) / THUMB_W));
      let sum = 0;
      for (let y = y0; y < y1; y++) {
        const row = y * g.w;
        for (let x = x0; x < x1; x++) sum += g.data[row + x];
      }
      t[ty * THUMB_W + tx] = 255 - sum / ((y1 - y0) * (x1 - x0)); // ink is positive
    }
  }
  let mean = 0;
  for (const v of t) mean += v;
  mean /= t.length;
  let norm = 0;
  for (let i = 0; i < t.length; i++) {
    t[i] -= mean;
    norm += t[i] * t[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 1e-6) for (let i = 0; i < t.length; i++) t[i] /= norm;
  return t;
}

export function similarity(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function darkMask(g) {
  const m = new Uint8Array(g.w * g.h);
  for (let i = 0; i < m.length; i++) m[i] = g.data[i] < DARK ? 1 : 0;
  return { w: g.w, h: g.h, data: m };
}

/**
 * Binary dilation by `r` iterations of the 4-connected cross (= L1 ball of radius r), done as a
 * two-pass city-block distance transform so it stays linear in the image size.
 */
export function dilate(mask, r = DILATE) {
  const { w, h, data } = mask;
  const INF = 1 << 20;
  const d = new Int32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = data[i] ? 0 : INF;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x > 0 && d[i - 1] + 1 < d[i]) d[i] = d[i - 1] + 1;
      if (y > 0 && d[i - w] + 1 < d[i]) d[i] = d[i - w] + 1;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (x < w - 1 && d[i + 1] + 1 < d[i]) d[i] = d[i + 1] + 1;
      if (y < h - 1 && d[i + w] + 1 < d[i]) d[i] = d[i + w] + 1;
    }
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = d[i] <= r ? 1 : 0;
  return { w, h, data: out };
}

/** Morphological opening with a 2x2 square: removes isolated scan speckle. */
export function open2x2(mask) {
  const { w, h, data } = mask;
  const e = new Uint8Array(w * h);
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x;
      e[i] = data[i] & data[i + 1] & data[i + w] & data[i + w + 1];
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      out[i] = e[i] | (x > 0 ? e[i - 1] : 0) | (y > 0 ? e[i - w] : 0) | (x > 0 && y > 0 ? e[i - w - 1] : 0);
    }
  }
  return { w, h, data: out };
}

/** Offset k maximising correlation of a[i] with b[i - k] (1-D ink profiles). */
export function profileShift(a, b, maxShift) {
  const n = Math.min(a.length, b.length);
  const ma = mean(a, n);
  const mb = mean(b, n);
  let best = -Infinity;
  let bestK = 0;
  for (let k = -maxShift; k <= maxShift; k++) {
    let v = 0;
    for (let i = Math.max(0, k); i < Math.min(n, n + k); i++) v += (a[i] - ma) * (b[i - k] - mb);
    if (v > best) {
      best = v;
      bestK = k;
    }
  }
  return bestK;
}

function mean(arr, n) {
  let s = 0;
  for (let i = 0; i < n; i++) s += arr[i];
  return s / n;
}

export function columnProfile(mask, W, H) {
  const p = new Float32Array(W);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) p[x] += mask.data[y * mask.w + x];
  return p;
}

export function rowProfile(mask, W, H) {
  const p = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    let s = 0;
    for (let x = 0; x < W; x++) s += mask.data[y * mask.w + x];
    p[y] = s;
  }
  return p;
}

/**
 * Pixels that are dark on the page but not near any dark pixel of the (dilated, shifted) blank
 * template: i.e. whatever someone added to the form.
 */
export function newInk(pageDark, templateDilated, dx, dy) {
  const { w, h } = pageDark;
  const out = new Uint8Array(w * h);
  const tw = templateDilated.w;
  const th = templateDilated.h;
  for (let y = 0; y < h; y++) {
    const ty = y - dy;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!pageDark.data[i]) continue;
      const tx = x - dx;
      const covered = ty >= 0 && ty < th && tx >= 0 && tx < tw && templateDilated.data[ty * tw + tx];
      if (!covered) out[i] = 1;
    }
  }
  return open2x2({ w, h, data: out });
}

/** Fraction and count of set pixels inside a rect given in page points. */
export function regionInk(mask, rect, pxPerPt, insetPt) {
  const x0 = Math.max(0, Math.floor((rect.x0 + insetPt) * pxPerPt));
  const x1 = Math.min(mask.w, Math.floor((rect.x1 - insetPt) * pxPerPt));
  const y0 = Math.max(0, Math.floor((rect.y0 + insetPt) * pxPerPt));
  const y1 = Math.min(mask.h, Math.floor((rect.y1 - insetPt) * pxPerPt));
  if (x1 - x0 < 2 || y1 - y0 < 2) return { ratio: 0, count: 0 };
  let c = 0;
  for (let y = y0; y < y1; y++) {
    const row = y * mask.w;
    for (let x = x0; x < x1; x++) c += mask.data[row + x];
  }
  return { ratio: c / ((x1 - x0) * (y1 - y0)), count: c };
}
