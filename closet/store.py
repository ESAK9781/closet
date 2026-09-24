"""The metadata folder: settings, template cache, one JSON per PDF, page renders.

PDFs are never moved or modified.  Each PDF in the dump folder gets
``metadata/forms/<id>.json`` where ``id`` is derived from the filename.  A PDF
is only re-parsed when its size/mtime *and* content hash change, or when the
parser version is bumped.  User edits live under ``overrides`` and survive
re-parses (and renames: a renamed file with the same content inherits them).
"""

from __future__ import annotations

import copy
import hashlib
import json
import os
import shutil
import threading
import time
import traceback
from datetime import datetime
from pathlib import Path

from . import records
from .extract import analyze, build_template, file_sha1
from .templates import FORM_TYPES

PARSER_VERSION = 11

DEFAULT_SETTINGS = {
    "form_type_labels": {"F10": "F10", "F174": "F174"},
    "pos_label": "Pos",
    "neg_label": "Neg",
    "month_format": "name",
    "f174_commander_role": "cadet_sqcc_signed",
    "template_files": {"F10": "F10_nuked_final.pdf", "F174": "F174_nuked_final.pdf"},
    "include_header": False,
    "position_tolerance_pt": 10,
}


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=1, ensure_ascii=False), "utf-8")
    for attempt in range(20):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:  # Windows: file briefly held by antivirus / OneDrive / a reader
            if attempt == 19:
                raise
            time.sleep(0.05 * (attempt + 1))


def form_id(filename: str) -> str:
    return hashlib.sha1(filename.lower().encode("utf-8")).hexdigest()[:14]


class Store:
    def __init__(self, dump_dir: Path, meta_dir: Path):
        self.dump = Path(dump_dir)
        self.meta = Path(meta_dir)
        self.forms_dir = self.meta / "forms"
        self.renders_dir = self.meta / "renders"
        self.tmpl_dir = self.meta / "templates"
        for d in (self.forms_dir, self.renders_dir, self.tmpl_dir):
            d.mkdir(parents=True, exist_ok=True)
        readme = self.meta / "README.txt"
        if not readme.exists():
            readme.write_text(
                "The Closet - metadata folder\n\n"
                "forms/<id>.json   one file per PDF in the dump folder: parse cache + your edits (overrides)\n"
                "renders/<id>/     cached page images used by the app\n"
                "templates/        cached geometry of the blank template forms\n"
                "settings.json     app settings\n\n"
                "Deleting renders/ or templates/ is safe (they are rebuilt).  forms/ holds your edits.\n",
                "utf-8")
        self.lock = threading.RLock()
        self.metas: dict[str, dict] = {}
        self.templates = {}
        self.template_error = None
        self.queue: list[str] = []
        self.status = {"state": "idle", "done": 0, "total": 0, "current": None, "last_scan": None}
        self.version = 0  # bumps whenever anything visible changes
        self.generation = 0  # bumps on reset; stale parses from before a reset are dropped
        self._wake = threading.Event()
        self.settings = self._load_settings()
        self.names_path = self.meta / "names.json"
        self.names = self._load_names()
        self._load_all()
        self._load_templates()
        threading.Thread(target=self._worker, daemon=True).start()

    # ------------------------------------------------------------------ settings
    def _load_settings(self) -> dict:
        p = self.meta / "settings.json"
        s = copy.deepcopy(DEFAULT_SETTINGS)
        if p.exists():
            try:
                user = json.loads(p.read_text("utf-8"))
                user.pop("details_chars", None)  # reason details are never trimmed
                for k, v in user.items():
                    if isinstance(v, dict) and isinstance(s.get(k), dict):
                        s[k].update(v)
                    else:
                        s[k] = v
            except Exception:
                pass
        _write_json(p, s)
        return s

    def update_settings(self, patch: dict) -> dict:
        with self.lock:
            for k, v in patch.items():
                if k not in DEFAULT_SETTINGS:
                    continue
                if isinstance(v, dict) and isinstance(self.settings.get(k), dict):
                    self.settings[k].update(v)
                else:
                    self.settings[k] = v
            _write_json(self.meta / "settings.json", self.settings)
            self.version += 1
            return self.settings

    # ------------------------------------------------------------------ name spellings
    def _load_names(self) -> dict:
        data = {"aliases": {}, "distinct": []}
        if self.names_path.exists():
            try:
                data.update(json.loads(self.names_path.read_text("utf-8")))
            except Exception:
                pass
        records.ALIASES.clear()
        records.ALIASES.update(data["aliases"])
        return data

    def name_pairs(self, forms: list[dict]) -> list[dict]:
        """Different names within two characters of each other that the user hasn't ruled on."""
        counts: dict[str, int] = {}
        for f in forms:
            if f["missing"] or not f["parsed"]:
                continue
            for n in f["record"].get("recipient_list") or []:
                counts[n] = counts.get(n, 0) + 1
        distinct = {tuple(sorted(x)) for x in self.names.get("distinct", [])}
        names = sorted(counts)
        pairs = []
        for i, a in enumerate(names):
            la = a.lower()
            if len(la) < 4:
                continue
            for b in names[i + 1:]:
                lb = b.lower()
                if la == lb or len(lb) < 4 or tuple(sorted((la, lb))) in distinct:
                    continue
                if records.levenshtein(la, lb, 2) <= 2:
                    pairs.append({"a": a, "b": b, "a_forms": counts[a], "b_forms": counts[b]})
        return pairs

    def resolve_names(self, a: str, b: str, same: bool, correct: str = "") -> None:
        with self.lock:
            la, lb = records.collapse(a).lower(), records.collapse(b).lower()
            if same:
                correct = records.collapse(correct) or a
                aliases = self.names["aliases"]
                for old in list(aliases):  # anything that pointed at either spelling follows along
                    if aliases[old].lower() in (la, lb):
                        aliases[old] = correct
                for n in (la, lb):
                    if n != correct.lower():
                        aliases[n] = correct
                aliases.pop(correct.lower(), None)
            else:
                self.names["distinct"].append(sorted((la, lb)))
            _write_json(self.names_path, self.names)
            records.ALIASES.clear()
            records.ALIASES.update(self.names["aliases"])
            self.version += 1

    # ------------------------------------------------------------------ templates
    def template_names(self) -> set[str]:
        return {v.lower() for v in self.settings.get("template_files", {}).values()}

    def _load_templates(self):
        self.templates = {}
        errs = []
        for ft, fname in self.settings.get("template_files", {}).items():
            if ft not in FORM_TYPES:
                continue
            p = self.dump / fname
            if not p.exists():
                errs.append(f"Template {fname} not found in the dump folder")
                continue
            try:
                self.templates[ft] = build_template(ft, p, self.tmpl_dir)
            except Exception as e:  # pragma: no cover - surfaced in UI
                errs.append(f"Template {fname}: {e}")
        self.template_error = "; ".join(errs) or None

    # ------------------------------------------------------------------ load / scan
    def _load_all(self):
        for p in self.forms_dir.glob("*.json"):
            try:
                m = json.loads(p.read_text("utf-8"))
                self.metas[m["id"]] = m
            except Exception:
                continue

    def _save(self, m: dict):
        _write_json(self.forms_dir / f"{m['id']}.json", m)

    def scan(self) -> dict:
        """Cheap stat pass. Queues new/changed PDFs for the background parser."""
        with self.lock:
            seen = set()
            changed = False
            tnames = self.template_names()
            files = sorted([p for p in self.dump.iterdir() if p.is_file() and p.suffix.lower() == ".pdf"],
                           key=lambda p: p.name.lower()) if self.dump.exists() else []
            for p in files:
                if p.name.lower() in tnames:
                    continue
                fid = form_id(p.name)
                seen.add(fid)
                st = p.stat()
                m = self.metas.get(fid)
                if m is None:
                    m = self._new_meta(fid, p)
                    self.metas[fid] = m
                    self._save(m)
                    changed = True
                if m.get("missing"):
                    m["missing"] = False
                    changed = True
                stale = (m.get("size") != st.st_size or m.get("mtime") != st.st_mtime
                         or m.get("parser_version") != PARSER_VERSION or m.get("analysis") is None)
                if stale and fid not in self.queue:
                    self.queue.append(fid)
            for fid, m in self.metas.items():
                if fid not in seen and not m.get("missing"):
                    m["missing"] = True
                    self._save(m)
                    changed = True
            self.status["last_scan"] = _now()
            if self.queue:
                self.status["total"] = self.status["done"] + len(self.queue)
                self._wake.set()
            if changed:
                self.version += 1
            return {"queued": len(self.queue), "changed": changed}

    def _new_meta(self, fid: str, p: Path) -> dict:
        m = {
            "id": fid, "filename": p.name, "added_at": _now(),
            "size": None, "mtime": None, "sha1": None, "parser_version": None,
            "analysis": None, "filename_info": records.parse_filename(p.name),
            "issues": [], "overrides": {}, "reviewed": False, "reviewed_at": None,
            "logged": False, "logged_at": None, "notes": "", "history": [],
        }
        return m

    def reset(self) -> dict:
        """Forget everything learned about the paperwork and read the dump folder from scratch.

        Deletes cached reads, page images, the template cache and all edits (reviews, signatures
        set by hand, logged status). Settings are kept. PDFs are never touched.
        """
        with self.lock:
            self.generation += 1
            self.queue.clear()
            n = len(self.metas)
            self.metas.clear()
            for d in (self.forms_dir, self.renders_dir, self.tmpl_dir):
                shutil.rmtree(d, ignore_errors=True)
                d.mkdir(parents=True, exist_ok=True)
            self.names_path.unlink(missing_ok=True)
            self.names = self._load_names()
            self.status.update(state="idle", done=0, total=0, current=None)
            self._load_templates()
            self.version += 1
        r = self.scan()
        return {"cleared": n, **r}

    def reparse(self, fid: str):
        with self.lock:
            m = self.metas.get(fid)
            if not m:
                return
            m["parser_version"] = None
            if fid not in self.queue:
                self.queue.insert(0, fid)
                self.status["total"] = self.status["done"] + len(self.queue)
            self._wake.set()

    def _worker(self):
        self.scan()
        while True:
            self._wake.wait(timeout=5)
            self._wake.clear()
            while True:
                with self.lock:
                    if not self.queue:
                        if self.status["state"] != "idle":
                            self.status.update(state="idle", done=0, total=0, current=None)
                            self.version += 1
                        break
                    fid = self.queue.pop(0)
                    m = self.metas.get(fid)
                    gen = self.generation
                    self.status.update(state="parsing", current=m["filename"] if m else None)
                if m:
                    self._parse(m)
                with self.lock:
                    if gen == self.generation:
                        self.status["done"] += 1
                    self.version += 1

    def _parse(self, m: dict):
        path = self.dump / m["filename"]
        if not path.exists():
            return
        st = path.stat()
        try:
            sha = file_sha1(path)
        except OSError:
            return
        # content unchanged and parser current → just refresh stat info
        if sha == m.get("sha1") and m.get("parser_version") == PARSER_VERSION and m.get("analysis"):
            with self.lock:
                m.update(size=st.st_size, mtime=st.st_mtime)
                self._save(m)
            return
        # renamed file? inherit edits from a missing record with identical content
        if not m.get("sha1") and not m.get("overrides"):
            with self.lock:
                for other in list(self.metas.values()):
                    if other is not m and other.get("missing") and other.get("sha1") == sha:
                        for k in ("overrides", "reviewed", "reviewed_at", "logged", "logged_at", "archived",
                                  "archived_at", "notes", "history"):
                            m[k] = copy.deepcopy(other.get(k))
                        m["history"] = (m.get("history") or []) + [{"at": _now(), "what": f"Renamed from {other['filename']}"}]
                        self.metas.pop(other["id"], None)
                        (self.forms_dir / f"{other['id']}.json").unlink(missing_ok=True)
                        shutil.rmtree(self.renders_dir / other["id"], ignore_errors=True)
                        break
        fn = records.parse_filename(m["filename"])
        gen = self.generation
        t0 = time.time()
        try:
            hint = (m.get("overrides") or {}).get("form_type") or None  # form type comes from the pages, not the name
            a = analyze(path, self.templates, hint, self.renders_dir / m["id"],
                        float(self.settings.get("position_tolerance_pt", 10) or 10))
        except Exception as e:
            a = {"error": f"Could not read PDF: {e}", "trace": traceback.format_exc(limit=3), "page_count": 0}
        a["parse_seconds"] = round(time.time() - t0, 2)
        with self.lock:
            if gen != self.generation or self.metas.get(m["id"]) is not m:
                return  # metadata was cleared while this file was being read
            m.update(size=st.st_size, mtime=st.st_mtime, sha1=sha, parser_version=PARSER_VERSION,
                     analysis=a, filename_info=fn, parsed_at=_now())
            m["issues"] = self._issues(m)
            self._save(m)

    # ------------------------------------------------------------------ review classification
    def _issues(self, m: dict) -> list[dict]:
        a = m.get("analysis") or {}
        fn = m.get("filename_info") or {}
        out = []

        def review(msg):
            out.append({"level": "review", "text": msg})

        def warn(msg):
            out.append({"level": "warn", "text": msg})

        if a.get("error"):
            review(a["error"])
            return out
        if not fn.get("pos_neg"):
            review("Filename has no Pos/Neg part, so it can't tell positive from negative")
        if not fn.get("reason"):
            warn("Filename has no reason part, so Reason Category is blank")
        for n in a.get("type_notes", []):
            review(n)
        tp = a.get("template_pages", 0)
        pc = a.get("page_count", 0)
        if pc > tp:
            review(f"{pc} pages; the {a.get('form_type')} template has {tp}")
        pm = a.get("page_map", [])
        slots = a.get("slots", {})
        missing_pages = [i + 1 for i, j in enumerate(pm) if j < 0 and any(s.get("page") is None for s in slots.values())]
        if missing_pages:
            review("Template page " + ", ".join(map(str, missing_pages)) + " not found in the PDF")
        mode = a.get("mode")
        total = a.get("slot_total") or 1
        by_widget = sum(1 for s in slots.values() if s.get("source_widget"))
        if mode == "fields" and by_widget < 0.8 * total:
            review(f"Only {by_widget} of {total} form fields found")
        elif mode == "text":
            review("No fillable fields – values were read from flattened text positions")
        elif mode == "raster":
            review("Scanned/rasterized form – text can't be read automatically")
        scored = [s for s, j in zip(a.get("layout_scores", []), pm) if j >= 0]
        if scored and min(scored) < 0.45:
            review("Page layout differs noticeably from the template")
        ft = a.get("form_type")
        core = FORM_TYPES.get(ft, {}).get("core", [])
        lost = [slots[k]["label"] for k in core if k in slots and not slots[k].get("located")]
        if lost:
            review("Couldn't locate: " + ", ".join(lost))
        unreadable = [s["label"] for s in slots.values() if s.get("source") == "ink" and s.get("ftype") == "Text"]
        if unreadable and mode != "raster":
            warn("Handwriting detected but not readable: " + ", ".join(unreadable[:6]))
        if not any(slots.get(k, {}).get("filled") for k in ("date", "date_awarded")):
            warn("No date on the form")
        loose = [s["label"] for s in slots.values() if s.get("source_widget") and not s.get("within_tolerance")]
        if loose:
            tol = self.settings.get("position_tolerance_pt", 10)
            warn(f"{len(loose)} field(s) matched but sit more than {tol} pt from the template position: "
                 + ", ".join(loose[:5]))
        if a.get("extra_widgets"):
            warn(f"{len(a['extra_widgets'])} filled field(s) didn't match any template slot")
        return out

    # ------------------------------------------------------------------ edits
    def update_form(self, fid: str, patch: dict) -> dict | None:
        with self.lock:
            m = self.metas.get(fid)
            if not m:
                return None
            ov = m.setdefault("overrides", {})
            changes = []
            for k, v in (patch.get("overrides") or {}).items():
                if k not in records.RECORD_FIELDS + records.FLAG_KEYS:
                    continue
                if v is None:
                    if k in ov:
                        ov.pop(k)
                        changes.append(f"{k} reset to detected")
                else:
                    if ov.get(k) != v:
                        ov[k] = v
                        changes.append(f"{k} → {v if not isinstance(v, bool) else ('yes' if v else 'no')}")
            fields = ov.setdefault("fields", {})
            for k, v in (patch.get("fields") or {}).items():
                if v is None:
                    if fields.pop(k, None) is not None:
                        changes.append(f"field {k} reset")
                elif fields.get(k) != v:
                    fields[k] = v
                    changes.append(f"field {k} edited")
            if not fields:
                ov.pop("fields", None)
            words = {"reviewed": ("marked reviewed", "unmarked reviewed"),
                     "logged": ("marked logged to sheet", "unmarked logged to sheet"),
                     "archived": ("archived", "restored from archive")}
            for k, (on, off) in words.items():
                if k in patch and bool(patch[k]) != bool(m.get(k)):
                    m[k] = bool(patch[k])
                    m[f"{k}_at"] = _now() if patch[k] else None
                    changes.append(on if patch[k] else off)
            if "notes" in patch and patch["notes"] != m.get("notes"):
                m["notes"] = patch["notes"]
                changes.append("notes edited")
            if "form_type" in (patch.get("overrides") or {}):
                # read the PDF again against the template the user says it is
                m["parser_version"] = None
                if fid not in self.queue:
                    self.queue.insert(0, fid)
                    self.status["total"] = self.status["done"] + len(self.queue)
                self._wake.set()
            if changes:
                m.setdefault("history", []).append({"at": _now(), "what": "; ".join(changes)})
                m["history"] = m["history"][-60:]
                self._save(m)
                self.version += 1
            return m

    # ------------------------------------------------------------------ views
    def snapshot(self) -> dict:
        with self.lock:
            metas = [m for m in self.metas.values()]
            roster = records.build_roster([m for m in metas if not m.get("missing")])
            forms = []
            for m in metas:
                forms.append(self.summary(m, roster))
            forms.sort(key=lambda f: (f["record"].get("date_iso") or "", f["filename"].lower()), reverse=True)
            return {
                "version": self.version,
                "status": dict(self.status, queued=len(self.queue)),
                "template_error": self.template_error,
                "settings": self.settings,
                "columns": records.SHEET_COLUMNS,
                "roster": roster,
                "name_pairs": self.name_pairs(forms),
                "forms": forms,
                "dump_dir": str(self.dump.resolve()),
                "meta_dir": str(self.meta.resolve()),
            }

    def summary(self, m: dict, roster: dict) -> dict:
        rec = records.build_record(m, self.settings, roster) if m.get("analysis") else None
        issues = m.get("issues") or []
        needs_review = any(i["level"] == "review" for i in issues)
        a = m.get("analysis") or {}
        return {
            "id": m["id"],
            "filename": m["filename"],
            "missing": bool(m.get("missing")),
            "parsed": m.get("analysis") is not None,
            "pending": m["id"] in self.queue,
            "mode": a.get("mode"),
            "page_count": a.get("page_count"),
            "issues": issues,
            "needs_review": needs_review and not m.get("reviewed") and not m.get("archived"),
            # a positive F10 without CDNA/Passes stays on the incomplete list until they're entered
            "incomplete": (records.missing_manual(rec) if rec and not m.get("archived") and not m.get("missing") else []),
            "archived": bool(m.get("archived")),
            "archived_at": m.get("archived_at"),
            "flagged": needs_review,
            "reviewed": bool(m.get("reviewed")),
            "reviewed_at": m.get("reviewed_at"),
            "logged": bool(m.get("logged")),
            "logged_at": m.get("logged_at"),
            "notes": m.get("notes", ""),
            "added_at": m.get("added_at"),
            "record": rec or {},
            "rows": records.sheet_rows(rec, self.settings, roster) if rec else [],
        }

    def detail(self, fid: str) -> dict | None:
        with self.lock:
            m = self.metas.get(fid)
            if not m:
                return None
            roster = records.build_roster([x for x in self.metas.values() if not x.get("missing")])
            d = self.summary(m, roster)
            a = m.get("analysis") or {}
            d["analysis"] = {k: v for k, v in a.items() if k not in ("trace",)}
            d["filename_info"] = m.get("filename_info")
            d["overrides"] = m.get("overrides", {})
            d["fields"] = records.effective_fields(m)
            d["history"] = m.get("history", [])
            d["sha1"] = m.get("sha1")
            d["parsed_at"] = m.get("parsed_at")
            return d
