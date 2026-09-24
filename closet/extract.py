"""PDF analysis: figure out what kind of form a PDF is and what is filled in.

Field names on real-world copies are unreliable (forms get recreated, flattened,
printed-and-scanned), so everything here keys off *geometry* and *field type*:

1. Every page is shrunk to a small grayscale thumbnail and correlated against
   the template pages.  That picks the form type when the filename is unclear
   and finds the form pages inside a PDF with extra pages stapled on.
2. Widgets on the aligned pages are matched to template slots with a
   Hungarian assignment on (position, size, field type).
3. Slots with no widget fall back to flattened text sitting inside the slot's
   box, then to "ink" – dark pixels in the box beyond what the blank template
   has there.  Ink is what catches wet/drawn/stamped signatures.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pymupdf
from scipy import ndimage
from scipy.optimize import linear_sum_assignment

from .templates import FORM_TYPES

pymupdf.TOOLS.mupdf_display_errors(False)

THUMB_W, THUMB_H = 48, 62
INK_SCALE = 2.0
RENDER_SCALE = 1.6
MAX_PAGES = 30
DARK = 140          # gray level below which a pixel counts as ink
DILATE = 3          # px of slack around template ink when diffing
MAX_SHIFT_PT = 18   # largest page offset searched when registering scans

TYPE_MAP = {
    pymupdf.PDF_WIDGET_TYPE_TEXT: "Text",
    pymupdf.PDF_WIDGET_TYPE_CHECKBOX: "CheckBox",
    pymupdf.PDF_WIDGET_TYPE_SIGNATURE: "Signature",
    pymupdf.PDF_WIDGET_TYPE_RADIOBUTTON: "Radio",
    pymupdf.PDF_WIDGET_TYPE_COMBOBOX: "Text",
    pymupdf.PDF_WIDGET_TYPE_LISTBOX: "Text",
}


# --------------------------------------------------------------------------- helpers

def file_sha1(path: Path) -> str:
    h = hashlib.sha1()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _gray(page: pymupdf.Page, scale: float, annots: bool = True) -> np.ndarray:
    pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), colorspace=pymupdf.csGRAY,
                          alpha=False, annots=annots)
    return np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.stride)[:, : pix.width]


def page_thumb(page: pymupdf.Page) -> np.ndarray:
    """Small, blurred, normalised grayscale fingerprint of a page's printed layout."""
    g = _gray(page, 0.5, annots=False).astype(np.float32)
    h, w = g.shape
    ys = np.linspace(0, h, THUMB_H + 1).astype(int)
    xs = np.linspace(0, w, THUMB_W + 1).astype(int)
    # block-average downsample (acts as a blur so small offsets don't matter)
    t = np.add.reduceat(np.add.reduceat(g, ys[:-1], axis=0), xs[:-1], axis=1)
    t /= np.outer(np.diff(ys), np.diff(xs))
    t = 255.0 - t  # ink is positive
    t -= t.mean()
    n = np.linalg.norm(t)
    return (t / n) if n > 1e-6 else t


def similarity(a: np.ndarray, b: np.ndarray) -> float:
    return float((a * b).sum())


def norm_rect(r, page_rect) -> list[float]:
    W, H = page_rect.width, page_rect.height
    x0, y0 = page_rect.x0, page_rect.y0
    return [(r.x0 - x0) / W, (r.y0 - y0) / H, (r.x1 - x0) / W, (r.y1 - y0) / H]


def _norm_name(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def ink_ratio(gray: np.ndarray, nrect: list[float], inset_pt: float, page_w_pt: float) -> float:
    h, w = gray.shape
    inset = inset_pt / page_w_pt  # normalised
    x0 = int((nrect[0] + inset) * w)
    x1 = int((nrect[2] - inset) * w)
    y0 = int((nrect[1] + inset * w / h) * h)
    y1 = int((nrect[3] - inset * w / h) * h)
    if x1 - x0 < 3 or y1 - y0 < 3:
        return 0.0
    reg = gray[max(0, y0):min(h, y1), max(0, x0):min(w, x1)]
    if reg.size == 0:
        return 0.0
    return float((reg < 140).mean())


# --------------------------------------------------------------------------- templates

@dataclass
class Slot:
    key: str
    label: str
    section: str
    ftype: str
    page: int
    rect: list[float]
    name: str
    baseline_ink: float = 0.0
    baseline_words: list[str] = field(default_factory=list)


@dataclass
class TemplateModel:
    form_type: str
    page_count: int
    slots: list[Slot]
    thumbs: list[np.ndarray]
    path: str = ""
    _masks: dict = field(default_factory=dict, repr=False)

    def slots_on(self, page: int) -> list[Slot]:
        return [s for s in self.slots if s.page == page]

    def mask(self, page: int) -> tuple[np.ndarray, np.ndarray, tuple[float, float]]:
        """(dark mask, dilated dark mask, page size in pt) of a blank template page."""
        if page not in self._masks:
            doc = pymupdf.open(self.path)
            pg = doc[page]
            dark = _gray(pg, INK_SCALE) < DARK
            self._masks[page] = (dark, ndimage.binary_dilation(dark, iterations=DILATE),
                                 (pg.rect.width, pg.rect.height))
        return self._masks[page]


def build_template(form_type: str, pdf_path: Path, cache_dir: Path) -> TemplateModel:
    """Load a template's slot geometry, cached against the template file's hash."""
    spec = FORM_TYPES[form_type]
    sha = file_sha1(pdf_path)
    cache = cache_dir / f"{form_type}.json"
    if cache.exists():
        try:
            data = json.loads(cache.read_text("utf-8"))
            if data.get("sha1") == sha and data.get("version") == 3:
                return TemplateModel(
                    path=str(pdf_path),
                    form_type=form_type,
                    page_count=data["page_count"],
                    slots=[Slot(**s) for s in data["slots"]],
                    thumbs=[np.array(t, dtype=np.float32).reshape(THUMB_H, THUMB_W) for t in data["thumbs"]],
                )
        except Exception:
            pass

    doc = pymupdf.open(pdf_path)
    pages = list(doc)
    widgets = []
    for p in pages:
        for w in p.widgets():
            widgets.append((p, w))
    specs = spec["slots"]
    if len(widgets) != len(specs):
        raise RuntimeError(f"Template {pdf_path.name} has {len(widgets)} widgets, expected {len(specs)}")

    grays = {p.number: _gray(p, INK_SCALE) for p in pages}
    words = {p.number: p.get_text("words") for p in pages}
    slots = []
    for (p, w), (tname, key, label, section) in zip(widgets, specs):
        if w.field_name != tname:
            raise RuntimeError(f"Template field order changed: got {w.field_name!r}, expected {tname!r}")
        nr = norm_rect(w.rect, p.rect)
        bw = [t[4] for t in words[p.number] if _center_in(t[:4], w.rect, 2)]
        slots.append(Slot(key=key, label=label, section=section, ftype=TYPE_MAP.get(w.field_type, "Text"),
                          page=p.number, rect=nr, name=w.field_name,
                          baseline_ink=ink_ratio(grays[p.number], nr, 1.5, p.rect.width),
                          baseline_words=bw))
    thumbs = [page_thumb(p) for p in pages]
    model = TemplateModel(form_type, len(pages), slots, thumbs, path=str(pdf_path))
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps({
        "version": 3, "sha1": sha, "page_count": len(pages),
        "slots": [s.__dict__ for s in slots],
        "thumbs": [t.round(5).ravel().tolist() for t in thumbs],
    }), "utf-8")
    return model


def _center_in(bbox, rect, pad=0.0) -> bool:
    cx = (bbox[0] + bbox[2]) / 2
    cy = (bbox[1] + bbox[3]) / 2
    return rect.x0 - pad <= cx <= rect.x1 + pad and rect.y0 - pad <= cy <= rect.y1 + pad


# --------------------------------------------------------------------------- registration

def _profile_shift(a: np.ndarray, b: np.ndarray, max_shift: int) -> int:
    """Offset k maximising correlation of a[i] with b[i - k] (1-D ink profiles)."""
    a = a - a.mean()
    b = b - b.mean()
    best, best_k = -np.inf, 0
    n = len(a)
    for k in range(-max_shift, max_shift + 1):
        if k >= 0:
            v = float(np.dot(a[k:], b[: n - k]))
        else:
            v = float(np.dot(a[: n + k], b[-k:]))
        if v > best:
            best, best_k = v, k
    return best_k


def register_page(page: pymupdf.Page, tm: TemplateModel, tpage: int):
    """Render ``page`` at the template's resolution and align it to the template.

    Returns (new_ink_mask, dx_pt, dy_pt, px_per_pt) where new_ink_mask marks dark
    pixels on the page that are not near any dark pixel of the blank template,
    in *document page* pixel coordinates.
    """
    tdark, tdil, (tw, th) = tm.mask(tpage)
    scale = INK_SCALE * tw / page.rect.width
    dark = _gray(page, scale) < DARK
    H = min(dark.shape[0], tdark.shape[0])
    W = min(dark.shape[1], tdark.shape[1])
    ms = int(MAX_SHIFT_PT * INK_SCALE)
    dx = _profile_shift(dark[:H, :W].sum(0).astype(np.float32), tdark[:H, :W].sum(0).astype(np.float32), ms)
    dy = _profile_shift(dark[:H, :W].sum(1).astype(np.float32), tdark[:H, :W].sum(1).astype(np.float32), ms)
    shifted = np.zeros_like(dark)
    src = tdil[max(0, -dy): tdil.shape[0], max(0, -dx): tdil.shape[1]]
    oy, ox = max(0, dy), max(0, dx)
    hh = min(src.shape[0], dark.shape[0] - oy)
    ww = min(src.shape[1], dark.shape[1] - ox)
    shifted[oy: oy + hh, ox: ox + ww] = src[:hh, :ww]
    new_ink = dark & ~shifted
    new_ink = ndimage.binary_opening(new_ink, structure=np.ones((2, 2)))  # drop scan speckle
    return new_ink, dx / scale, dy / scale, scale


def region_ink(mask: np.ndarray, rect: pymupdf.Rect, page_rect: pymupdf.Rect, px_per_pt: float,
               inset_pt: float) -> tuple[float, int]:
    x0 = max(0, int((rect.x0 - page_rect.x0 + inset_pt) * px_per_pt))
    x1 = min(mask.shape[1], int((rect.x1 - page_rect.x0 - inset_pt) * px_per_pt))
    y0 = max(0, int((rect.y0 - page_rect.y0 + inset_pt) * px_per_pt))
    y1 = min(mask.shape[0], int((rect.y1 - page_rect.y0 - inset_pt) * px_per_pt))
    if x1 - x0 < 2 or y1 - y0 < 2:
        return 0.0, 0
    reg = mask[y0:y1, x0:x1]
    c = int(reg.sum())
    return c / reg.size, c


def _assign_words(words: list, rects: list[pymupdf.Rect], skip: list[list[str]], pad: float) -> list[list]:
    """Give every word to the one slot box it sits in (or the nearest within ``pad``)."""
    out = [[] for _ in rects]
    skip = [list(x) for x in skip]
    for wd in words:
        cx, cy = (wd[0] + wd[2]) / 2, (wd[1] + wd[3]) / 2
        best, best_d = None, None
        for i, r in enumerate(rects):
            ddx = max(r.x0 - cx, 0, cx - r.x1)
            ddy = max(r.y0 - cy, 0, cy - r.y1)
            d = (ddx * ddx + ddy * ddy) ** 0.5
            if d <= pad and (best_d is None or d < best_d
                             or (d == best_d and r.get_area() < rects[best].get_area())):
                best, best_d = i, d
        if best is None:
            continue
        if wd[4] in skip[best]:
            skip[best].remove(wd[4])
            continue
        out[best].append(wd)
    for lst in out:
        lst.sort(key=lambda t: (t[5], t[6], t[7]))
    return out


# --------------------------------------------------------------------------- analysis

def _widget_info(doc, page, w) -> dict:
    ftype = TYPE_MAP.get(w.field_type, "Text")
    val = w.field_value
    digital = False
    if ftype == "Signature":
        try:
            kind, v = doc.xref_get_key(w.xref, "V")
            if kind == "xref":
                obj = doc.xref_object(int(v.split()[0]))
                digital = "/ByteRange" in obj or "/Contents" in obj
            elif kind == "dict":
                digital = "/ByteRange" in v or "/Contents" in v
        except Exception:
            digital = False
        val = ""
    if ftype in ("CheckBox", "Radio"):
        val = bool(val) and str(val) not in ("Off", "False", "0", "")
    elif not isinstance(val, bool):
        val = (str(val) if val is not None else "").strip()
    return {"name": w.field_name or "", "ftype": ftype, "rect": norm_rect(w.rect, page.rect),
            "value": val, "digital": digital, "abs": tuple(w.rect)}


def _align_pages(doc_thumbs: list[np.ndarray], tmpl: TemplateModel) -> tuple[list[int], list[float]]:
    """Choose one document page per template page, in increasing order, maximising similarity."""
    n, t = len(doc_thumbs), tmpl.page_count
    sims = np.array([[similarity(d, tp) for tp in tmpl.thumbs] for d in doc_thumbs]) if n else np.zeros((0, t))
    # dynamic programming over increasing assignments; template pages may be "absent" (-1)
    best = {}

    def solve(ti: int, start: int):
        if ti == t:
            return 0.0, []
        key = (ti, start)
        if key in best:
            return best[key]
        # option: template page missing
        s_skip, a_skip = solve(ti + 1, start)
        res = (s_skip, [-1] + a_skip)
        for j in range(start, n):
            s, a = solve(ti + 1, j + 1)
            s += sims[j, ti]
            if s > res[0]:
                res = (s, [j] + a)
        best[key] = res
        return res

    _, assign = solve(0, 0)
    scores = [float(sims[j, i]) if j >= 0 else 0.0 for i, j in enumerate(assign)]
    return assign, scores


def _match_widgets(slots: list[Slot], widgets: list[dict], page_w: float, page_h: float,
                   tol_pt: float) -> tuple[dict[int, int], set[int]]:
    """Assign widgets to slots.  Returns (slot→widget, slots matched within tolerance).

    A widget whose every edge sits within ``tol_pt`` points of the template slot
    is a confident match regardless of name.  Further-off widgets can still be
    assigned by the global optimisation, but only if nothing better fits.
    """
    if not slots or not widgets:
        return {}, set()
    cost = np.full((len(slots), len(widgets)), 9.0)
    within = np.zeros(cost.shape, dtype=bool)
    for i, s in enumerate(slots):
        scx, scy = (s.rect[0] + s.rect[2]) / 2, (s.rect[1] + s.rect[3]) / 2
        sw, sh = s.rect[2] - s.rect[0], s.rect[3] - s.rect[1]
        for j, w in enumerate(widgets):
            r = w["rect"]
            compat = 0.0
            if w["ftype"] != s.ftype:
                pair = {w["ftype"], s.ftype}
                if pair == {"Text", "Signature"}:
                    compat = 0.035
                elif pair == {"CheckBox", "Radio"}:
                    compat = 0.0
                else:
                    continue
            wcx, wcy = (r[0] + r[2]) / 2, (r[1] + r[3]) / 2
            d = ((scx - wcx) ** 2 + (scy - wcy) ** 2) ** 0.5
            sz = abs(sw - (r[2] - r[0])) + abs(sh - (r[3] - r[1]))
            edge_pt = max(abs(s.rect[0] - r[0]) * page_w, abs(s.rect[2] - r[2]) * page_w,
                          abs(s.rect[1] - r[1]) * page_h, abs(s.rect[3] - r[3]) * page_h)
            if edge_pt <= tol_pt:
                within[i, j] = True
                c = 0.1 * (d + 0.35 * sz) + compat  # within tolerance: effectively a sure match
            else:
                c = 0.01 + d + 0.35 * sz + compat
            if _norm_name(w["name"]) == _norm_name(s.name):
                c -= 0.02
            cost[i, j] = c
    rows, cols = linear_sum_assignment(cost)
    out = {int(i): int(j) for i, j in zip(rows, cols) if cost[i, j] <= 0.075}
    return out, {i for i, j in out.items() if within[i, j]}


def analyze(pdf_path: Path, templates: dict[str, TemplateModel], hinted_type: str | None,
            render_dir: Path | None, tol_pt: float = 10.0) -> dict:
    doc = pymupdf.open(pdf_path)
    if doc.needs_pass and not doc.authenticate(""):
        return {"error": "PDF is password protected", "page_count": 0}
    pages = [doc[i] for i in range(min(doc.page_count, MAX_PAGES))]
    thumbs = [page_thumb(p) for p in pages]

    # ---- form type: filename hint vs. what the pages look like
    per_type = {}
    for ft, tm in templates.items():
        assign, scores = _align_pages(thumbs, tm)
        weighted = [s for s, sl in zip(scores, range(tm.page_count)) if tm.slots_on(sl)] or scores
        per_type[ft] = {"assign": assign, "scores": scores, "score": float(np.mean(weighted)) if weighted else 0.0}
    visual_type = max(per_type, key=lambda k: per_type[k]["score"]) if per_type else None
    type_notes = []
    form_type = hinted_type if hinted_type in templates else None
    if form_type and visual_type and visual_type != form_type:
        if per_type[visual_type]["score"] - per_type[form_type]["score"] > 0.2 and per_type[form_type]["score"] < 0.5:
            type_notes.append(f"Labeled {form_type} but the pages look like {visual_type}")
    if form_type is None:
        # try widget-name / text anchors before trusting visual only
        text0 = " ".join(p.get_text() for p in pages[:2]).upper()
        for ft, spec in FORM_TYPES.items():
            if ft in templates and any(a in text0 for a in spec["anchor_text"][:1]):
                form_type = ft
        form_type = form_type or visual_type
    if form_type is None:
        return {"error": "No templates available", "page_count": doc.page_count}

    tm = templates[form_type]
    assign = per_type[form_type]["assign"]
    layout_scores = per_type[form_type]["scores"]

    # ---- per-page material
    all_widgets = {p.number: [_widget_info(doc, p, w) for w in p.widgets()] for p in pages}
    annots = {}

    def annots_of(pn):
        if pn not in annots:
            p = doc[pn]
            annots[pn] = [pymupdf.Rect(x.rect) for x in p.annots()
                          if x.type[0] not in (pymupdf.PDF_ANNOT_WIDGET, pymupdf.PDF_ANNOT_LINK, pymupdf.PDF_ANNOT_POPUP)]
        return annots[pn]

    slot_results: dict[str, dict] = {}
    matched_widgets = 0
    used_widget_ids: set[tuple[int, int]] = set()
    registration = {}
    for ti in range(tm.page_count):
        slots = tm.slots_on(ti)
        dp = assign[ti] if ti < len(assign) else -1
        if not slots:
            continue
        if dp < 0:
            for s in slots:
                slot_results[s.key] = _slot_result(s, None, located=False)
            continue
        page = doc[dp]
        pr = page.rect
        pw, ph = pr.width, pr.height
        wlist = all_widgets.get(dp, [])
        m, tight = _match_widgets(slots, wlist, pw, ph, tol_pt)
        matched_widgets += len(m)
        new_ink, sdx, sdy, ppp = register_page(page, tm, ti)
        registration[dp] = [round(sdx, 1), round(sdy, 1)]
        # where each slot lives on this page: its matched widget, else the template box moved by registration
        rects, widgets_for = [], []
        for i, s in enumerate(slots):
            wi = wlist[m[i]] if i in m else None
            if wi is not None:
                used_widget_ids.add((dp, m[i]))
                r = pymupdf.Rect(wi["abs"])
            else:
                r = pymupdf.Rect(pr.x0 + s.rect[0] * pw + sdx, pr.y0 + s.rect[1] * ph + sdy,
                                 pr.x0 + s.rect[2] * pw + sdx, pr.y0 + s.rect[3] * ph + sdy)
            rects.append(r)
            widgets_for.append(wi)
        # Only text sitting inside the input box counts. The position tolerance is for matching
        # fields; applying it here pulled in printed labels just above boxes ("4. TOURS").
        words_per_slot = _assign_words(page.get_text("words"), rects, [s.baseline_words for s in slots],
                                       pad=1.5)
        for i, s in enumerate(slots):
            wi, r = widgets_for[i], rects[i]
            flat_text = " ".join(t[4] for t in words_per_slot[i]).strip()
            inset = 2.0 if s.ftype == "CheckBox" else 1.0
            ratio, count = region_ink(new_ink, r, pr, ppp, inset)
            has_annot = any(x.intersects(r) and (x & r).get_area() > 0.2 * r.get_area() for x in annots_of(dp))
            slot_results[s.key] = _slot_result(s, wi, located=True, flat_text=flat_text, ink=ratio, ink_px=count,
                                               has_annot=has_annot, doc_page=dp, rect=norm_rect(r, pr),
                                               from_raster=wi is None, within_tol=i in tight)

    total = len(tm.slots)
    located_by_widget = sum(1 for r in slot_results.values() if r["source_widget"])
    has_any_widgets = any(all_widgets.values())
    has_text = any(r["value"] and r["source"] == "text" for r in slot_results.values())
    if located_by_widget >= 0.5 * total:
        mode = "fields"
    elif has_text:
        mode = "text"
    else:
        mode = "raster"

    extra_widgets = [
        {"page": pn, **{k: v for k, v in w.items() if k != "abs"}}
        for pn, wl in all_widgets.items() for j, w in enumerate(wl)
        if (pn, j) not in used_widget_ids and (w["value"] not in ("", False, None))
    ]

    # ---- renders for the UI (cached next to the metadata)
    renders = []
    if render_dir is not None:
        render_dir.mkdir(parents=True, exist_ok=True)
        for old in render_dir.glob("p*.png"):
            old.unlink()
        for p in pages:
            out = render_dir / f"p{p.number}.png"
            p.get_pixmap(matrix=pymupdf.Matrix(RENDER_SCALE, RENDER_SCALE), alpha=False).save(out)
            renders.append({"page": p.number, "w": p.rect.width, "h": p.rect.height})

    return {
        "form_type": form_type,
        "visual_type": visual_type,
        "type_scores": {k: round(v["score"], 3) for k, v in per_type.items()},
        "type_notes": type_notes,
        "page_count": doc.page_count,
        "template_pages": tm.page_count,
        "page_map": assign,
        "layout_scores": [round(s, 3) for s in layout_scores],
        "mode": mode,
        "has_widgets": has_any_widgets,
        "widget_total": sum(len(v) for v in all_widgets.values()),
        "matched_widgets": matched_widgets,
        "registration": registration,
        "slot_total": total,
        "slots": slot_results,
        "extra_widgets": extra_widgets[:60],
        "renders": renders,
    }


def _slot_result(s: Slot, wi: dict | None, located: bool, flat_text: str = "", ink: float = 0.0, ink_px: int = 0,
                 has_annot: bool = False, doc_page: int | None = None, rect=None, from_raster: bool = False,
                 within_tol: bool = False) -> dict:
    value = ""
    source = None
    if wi is not None and wi["value"] not in ("", None, False):
        value = wi["value"]
        source = "field"
    elif flat_text:
        value = flat_text if s.ftype != "CheckBox" else True
        source = "text"
    signed_digital = bool(wi and wi.get("digital"))
    # "new ink" = dark pixels the blank template doesn't have near that spot
    if s.ftype == "CheckBox":
        ink_hit = ink > 0.12 and ink_px >= 10
    else:
        ink_hit = ink > 0.004 and ink_px >= 30
    if s.ftype == "CheckBox" and source is None and ink_hit:
        value, source = True, "ink"
    filled = bool(value) or signed_digital or has_annot or (s.ftype == "Signature" and ink_hit)
    if s.ftype == "Text" and not value and ink_hit:
        # something is written there but we can't read it (scan / handwriting)
        filled = True
        source = "ink"
    if s.ftype == "Signature":
        if signed_digital:
            source = "digital"
        elif has_annot:
            source = source or "annotation"
        elif ink_hit:
            source = source or "ink"
    return {
        "key": s.key, "label": s.label, "section": s.section, "ftype": s.ftype,
        "located": located, "source_widget": wi is not None, "within_tolerance": within_tol,
        "field_name": wi["name"] if wi else None,
        "value": value, "filled": filled, "source": source if filled else None,
        "ink": round(float(ink), 4), "ink_px": int(ink_px), "digital": signed_digital,
        "page": doc_page, "rect": [round(x, 5) for x in (rect or s.rect)],
    }
