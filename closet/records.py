"""Turning raw slot values + user edits into tracker records and sheet rows."""

from __future__ import annotations

import re
from datetime import date, datetime

from dateutil import parser as dparser

from .templates import FLAG_DEFS, FORM_TYPES, flag_slots

SHEET_COLUMNS = ["Date", "Class Year", "Form Type", "Reason Category", "Reason Details", "Month",
                 "Name", "Issuer", "Pos/Neg", "CDNA", "Passes", "Demerits", "Tours", "Confinements", "Other"]

# Record fields the user can edit (in addition to the four flags)
RECORD_FIELDS = ["recipients", "form_type", "pos_neg", "date", "class_year", "squadron",
                 "reason_category", "reason_details", "issuer", "cdna", "passes", "demerits", "tours",
                 "confinements", "other"]

# Typed in by hand, and only for positive Form 10s -- where they're required.
MANUAL_POS_F10 = ["cdna", "passes"]

# Section VI counts on the F10. Blank means none given (0); the F174 has no such blocks.
SANCTION_FIELDS = ["demerits", "tours", "confinements"]
FLAG_KEYS = [k for k, _ in FLAG_DEFS]

MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
          "October", "November", "December"]


# --------------------------------------------------------------------------- filename

_POS = re.compile(r"^(pos|positive|\+)$", re.I)
_NEG = re.compile(r"^(neg|negative|-)$", re.I)
_FT = re.compile(r"^(?:af|afcw)?\s*(?:imt|form|frm|f)?\s*-?\s*(10|174)$", re.I)


def split_camel(s: str) -> str:
    s = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", s)
    s = re.sub(r"[-\s]+", " ", s)
    return s.strip()


def parse_filename(filename: str) -> dict:
    """Recipient_PosOrNeg_FormType_Reason  →  parts (lenient about order and spelling)."""
    stem = re.sub(r"\.pdf$", "", filename, flags=re.I)
    parts = [p.strip() for p in stem.split("_")]
    pn_idx = next((i for i, p in enumerate(parts) if _POS.match(p) or _NEG.match(p)), None)
    ft_idx = next((i for i, p in enumerate(parts) if _FT.match(p.replace(" ", ""))), None)
    info = {"recipient": "", "pos_neg": "", "form_type": "", "reason": "", "valid": False, "problems": []}
    if pn_idx is not None:
        info["pos_neg"] = "Pos" if _POS.match(parts[pn_idx]) else "Neg"
    else:
        info["problems"].append("no Pos/Neg part")
    if ft_idx is not None:
        info["form_type"] = "F" + _FT.match(parts[ft_idx].replace(" ", "")).group(1)
    else:
        info["problems"].append("no form type part (F10 / F174)")
    first_marker = min([i for i in (pn_idx, ft_idx) if i is not None], default=None)
    last_marker = max([i for i in (pn_idx, ft_idx) if i is not None], default=None)
    if first_marker is not None:
        info["recipient"] = " ".join(p for p in parts[:first_marker] if p)
        info["reason"] = split_camel(" ".join(p for p in parts[last_marker + 1:] if p))
    if not info["recipient"]:
        info["problems"].append("no recipient part")
    if not info["reason"] and first_marker is not None:
        info["problems"].append("no reason part")
    info["valid"] = (pn_idx == 1 and ft_idx == 2 and len(parts) >= 4 and bool(info["recipient"]))
    if not info["valid"] and not info["problems"]:
        info["problems"].append("parts out of order")
    return info


# --------------------------------------------------------------------------- normalisers

def collapse(s) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip()


_RANK = re.compile(r"(?i)^(c[1-4]c|cadet)$")
_RANK_AFTER_C = re.compile(r"(?i)^(lt|col|gen|sgt|capt|maj)$")


def strip_rank(name: str) -> str:
    """Ranks aren't part of a name: drop C1C-C4C, 'Cadet', and C/ grades (C/Capt, C/2d Lt, ...)."""
    out, skip_next = [], False
    for tok in collapse(name).split(" "):
        bare = tok.strip(",.")
        if skip_next and _RANK_AFTER_C.match(bare):
            skip_next = False
            continue
        skip_next = False
        if _RANK.match(bare):
            continue
        if bare.lower().startswith("c/"):
            skip_next = True  # "C/2d Lt": the grade can run into a second word
            continue
        out.append(tok)
    return collapse(" ".join(out)).strip(" ,")


def split_names(s: str) -> list[str]:
    """Typed recipient list. Commas separate people, but a one-word piece can't be a whole name,
    so it's a surname written "Last, First": 'Doe, John, Amy Wu' -> John Doe, Amy Wu."""
    chunks = [strip_rank(n) for n in re.split(r"[,;\n]", s or "")]
    chunks = [c for c in chunks if c]
    out, i = [], 0
    while i < len(chunks):
        c = chunks[i]
        if len(c.split(" ")) == 1 and i + 1 < len(chunks):
            out.append(collapse(f"{chunks[i + 1]} {c}"))
            i += 2
        else:
            out.append(c)
            i += 1
    return [canon(n) for n in out]


# Spellings the user confirmed are the same person: lowercased name -> correct name.
ALIASES: dict[str, str] = {}


def canon(name: str) -> str:
    return ALIASES.get(collapse(name).lower(), collapse(name))


def levenshtein(a: str, b: str, cap: int = 3) -> int:
    """Edit distance, giving up early once it exceeds ``cap``."""
    if abs(len(a) - len(b)) > cap:
        return cap + 1
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        if min(cur) > cap:
            return cap + 1
        prev = cur
    return prev[-1]


def single_name(name: str) -> str:
    """A detected recipient is always one person: 'Doe, John' → 'John Doe', never a list."""
    name = form_name_to_display(strip_rank(name))
    return canon(strip_rank(name.replace(",", " ")))


def recipient_names(meta: dict, auto_recipients: str) -> list[str]:
    """Several recipients only exist when the user typed a comma-separated list."""
    typed = (meta.get("overrides") or {}).get("recipients")
    if typed is not None:
        return split_names(typed)
    return [auto_recipients] if collapse(auto_recipients) else []


def form_name_to_display(name: str) -> str:
    """'Doe, John A' → 'John A Doe' (forms ask for Last, First, MI)."""
    name = collapse(name)
    parts = [p.strip() for p in name.split(",") if p.strip()]
    if len(parts) >= 2:
        last, rest = parts[0], " ".join(parts[1:])
        return collapse(f"{rest} {last}")
    return name


def parse_date(raw) -> str | None:
    s = collapse(raw)
    if not s:
        return None
    s = s.replace("_", " ")
    m = re.fullmatch(r"(\d{4})(\d{2})(\d{2})", s)
    try:
        if m:
            d = date(int(m[1]), int(m[2]), int(m[3]))
        else:
            m = re.fullmatch(r"(\d{1,2})\s*([A-Za-z]{3,9})\.?\s*,?\s*(\d{2,4})", s)
            if m:
                s = f"{m[1]} {m[2]} {m[3]}"
            d = dparser.parse(s, fuzzy=True, dayfirst=bool(m), default=datetime(2000, 1, 1)).date()
            if d.year < 100:
                d = d.replace(year=2000 + d.year)
    except (ValueError, OverflowError, TypeError):
        return None
    if not (2000 <= d.year <= 2100):
        return None
    return d.isoformat()


def parse_class_year(raw) -> str:
    s = collapse(raw)
    m = re.search(r"\b(20\d{2})\b", s)
    if m:
        return m[1]
    m = re.search(r"(?:'|’|C\s*)(\d{2})\b", s) or re.fullmatch(r"(\d{2})", s)
    if m:
        return "20" + m[1]
    return s


NOTHING = re.compile(r"(?i)^(n\.?\s*/?\s*a\.?|none|nil|null|no|-+|—|0)$")
# Printed block labels that can bleed into a box's text on recreated/flattened copies
LABEL_WORDS = re.compile(r"(?i)^(\d{1,2}\.|demerits?|demerit\(s\)|confinements?|confinement\(s\)|tours?|loss|of|pass|"
                         r"priv(ilege)?s?|revoke|pov|\(s\))$")


def strip_label(raw) -> str:
    """Drop printed-label words (e.g. '4. TOURS') that surround a handwritten/typed value."""
    toks = collapse(raw).split(" ")
    while toks and LABEL_WORDS.match(toks[0]):
        toks.pop(0)
    while toks and LABEL_WORDS.match(toks[-1]):
        toks.pop()
    return " ".join(toks)


def sanction_count(raw, slot: dict | None = None, scanned: bool = False) -> str:
    """Demerits / tours / confinements: a number, and blank or N/A means 0.

    Returns "" when the box can't actually be read: handwriting, or any box on a scanned copy
    (a faint "1" can look blank), so the number gets typed in rather than silently becoming 0.
    """
    s = strip_label(raw)
    if not s or NOTHING.match(s):
        if not collapse(raw) and (scanned or (slot and slot.get("source") == "ink")):
            return ""
        return "0"
    m = re.search(r"(?<![\d.])(\d+(?:\.\d+)?)(?![\d.])", s)
    if m:
        v = m[1]
        return v[:-2] if v.endswith(".0") else v
    return s


def other_text(raw) -> str:
    s = strip_label(raw)
    return "" if not s or NOTHING.match(s) else s


def cdna_applies(form_type: str, pos_neg: str) -> bool:
    """CDNA and Passes are entered by hand, and only for positive Form 10s."""
    return form_type == "F10" and pos_neg == "Pos"


def missing_manual(rec: dict) -> list[str]:
    """Required hand-entered values still blank (a positive F10 needs CDNA and Passes)."""
    if not cdna_applies(rec.get("form_type", ""), rec.get("pos_neg", "")):
        return []
    labels = {"cdna": "CDNA", "passes": "Passes"}
    return [labels[k] for k in MANUAL_POS_F10 if not collapse(rec.get(k))]


def month_label(iso: str | None, fmt: str) -> str:
    if not iso:
        return ""
    y, m = int(iso[:4]), int(iso[5:7])
    if fmt == "short":
        return MONTHS[m - 1][:3]
    if fmt == "iso":
        return f"{y}-{m:02d}"
    if fmt == "name_year":
        return f"{MONTHS[m - 1]} {y}"
    if fmt == "number":
        return str(m)
    return MONTHS[m - 1]


def name_key(n: str) -> str:
    n = strip_rank(n)
    """Order-insensitive key so 'Doe John' and 'John Doe' land on the same cadet."""
    toks = sorted(t for t in re.split(r"[^a-z]+", n.lower()) if len(t) > 1)
    return " ".join(toks)


# --------------------------------------------------------------------------- record

def effective_fields(meta: dict) -> dict:
    auto = {k: v.get("value", "") for k, v in (meta.get("analysis") or {}).get("slots", {}).items()}
    auto.update({k: v for k, v in (meta.get("overrides", {}).get("fields") or {}).items()})
    return auto


def auto_record(meta: dict, settings: dict, roster: dict) -> dict:
    """What the software believes, before user overrides."""
    a = meta.get("analysis") or {}
    fn = meta.get("filename_info") or {}
    ft = meta.get("overrides", {}).get("form_type") or a.get("form_type") or ""
    f = effective_fields(meta)
    slots = a.get("slots", {})

    # Only Pos/Neg comes from the filename; everything else is read off the form itself.
    recipients = single_name(f.get("recipient_name", ""))
    date_raw = ""
    date_fields = ["date", "date_awarded", "date_counseled", "login_date"] if ft == "F10" else ["date", "counselee_date", "commander_date"]
    for k in date_fields:
        if collapse(f.get(k)):
            date_raw = f.get(k)
            break
    iso = parse_date(date_raw)

    class_year = parse_class_year(f.get("class_year", ""))
    if not class_year:
        class_year = roster.get(name_key(recipients), "")

    if ft == "F174":
        details = collapse(f.get("reason")) or collapse(f.get("narrative"))
        issuer = collapse(f.get("issuer"))
    else:
        details = collapse(f.get("narrative"))
        issuer = form_name_to_display(f.get("issuer", ""))
        grade = collapse(f.get("issuer_grade"))
        if grade and issuer and not issuer.lower().startswith(grade.lower()):
            issuer = f"{grade} {issuer}"

    other_bits = []
    if ft == "F10":
        if other_text(f.get("loss_of_pass")):
            other_bits.append(f"Loss of pass: {other_text(f.get('loss_of_pass'))}")
        if other_text(f.get("pov_priv")):
            other_bits.append(f"POV revoked: {other_text(f.get('pov_priv'))}")

    flags = {}
    fslots = flag_slots(ft, settings)
    for key in FLAG_KEYS:
        keys = fslots.get(key, [])
        if not keys:
            flags[key] = None  # not on this form; only tracked by hand
        else:
            flags[key] = any(_filled(slots.get(k), f.get(k)) for k in keys)

    return {
        "recipients": collapse(recipients),
        "form_type": ft,
        "pos_neg": fn.get("pos_neg", ""),
        "date": iso or collapse(date_raw),
        "class_year": class_year,
        "squadron": collapse(f.get("squadron")),
        "reason_category": fn.get("reason", ""),
        "reason_details": details,
        "issuer": issuer,
        "cdna": "",  # never on the form: typed in by hand (positive F10s only)
        "passes": "",  # same as CDNA
        **{k: sanction_count(f.get(k), slots.get(k), a.get("mode") == "raster") if ft == "F10" else ""
           for k in SANCTION_FIELDS},
        "other": "; ".join(other_bits),
        **flags,
    }


def _filled(slot: dict | None, value) -> bool:
    if value not in (None, "", False) and collapse(value) not in ("", "False"):
        return True
    return bool(slot and slot.get("filled"))


def build_record(meta: dict, settings: dict, roster: dict) -> dict:
    auto = auto_record(meta, settings, roster)
    ov = meta.get("overrides") or {}
    rec = dict(auto)
    for k in RECORD_FIELDS + FLAG_KEYS:
        if k in ov and ov[k] is not None and k != "fields":
            rec[k] = ov[k]
    rec["date_iso"] = parse_date(rec["date"]) if rec.get("date") else None
    rec["recipient_list"] = recipient_names(meta, auto["recipients"])
    rec["auto"] = auto
    rec["overridden"] = sorted(k for k in RECORD_FIELDS + FLAG_KEYS if k in ov and ov[k] is not None)
    return rec


def sheet_rows(rec: dict, settings: dict, roster: dict) -> list[list[str]]:
    """One Conduct Log row per recipient."""
    labels = settings.get("form_type_labels", {})
    pn = rec.get("pos_neg", "")
    pn_label = settings.get("pos_label", "Pos") if pn == "Pos" else settings.get("neg_label", "Neg") if pn == "Neg" else pn
    names = rec.get("recipient_list") or [""]
    years = [collapse(y) for y in str(rec.get("class_year") or "").split(",")]
    rows = []
    for i, name in enumerate(names):
        if len(names) == 1:
            cy = collapse(rec.get("class_year"))
        elif len(years) == len(names):  # one year per recipient, as collected when the list was entered
            cy = years[i] or roster.get(name_key(name), "")
        else:
            cy = roster.get(name_key(name), "")
        rows.append([
            rec.get("date_iso") or rec.get("date", ""),
            cy,
            labels.get(rec.get("form_type", ""), rec.get("form_type", "")),
            rec.get("reason_category", ""),
            rec.get("reason_details", ""),  # always the full text
            month_label(rec.get("date_iso"), settings.get("month_format", "name")),
            name,
            rec.get("issuer", ""),
            pn_label,
            *[str(rec.get(k, "") or "") if cdna_applies(rec.get("form_type", ""), pn) else "" for k in MANUAL_POS_F10],
            *[str(rec.get(k, "") or "") if rec.get("form_type") == "F10" else "" for k in SANCTION_FIELDS],
            rec.get("other", ""),
        ])
    return [[collapse(c).replace("\t", " ") for c in r] for r in rows]


def build_roster(metas: list[dict]) -> dict:
    """name key → class year, learned from every form where it is unambiguous."""
    roster = {}
    for m in metas:
        ov = m.get("overrides") or {}
        f = effective_fields(m)
        names = recipient_names(m, single_name(f.get("recipient_name", "")))
        raw = str(ov.get("class_year") or f.get("class_year") or "")
        years = [parse_class_year(y) for y in raw.split(",")] if len(names) > 1 else [parse_class_year(raw)]
        if not names or len(years) != len(names):
            continue
        pairs = zip(names, years)
        for n, y in pairs:
            if re.fullmatch(r"20\d{2}", y or ""):
                roster[name_key(n)] = y
    return roster


def form_title(ft: str) -> str:
    spec = FORM_TYPES.get(ft)
    return f"{spec['title']} · {spec['subtitle']}" if spec else "Unknown form"
