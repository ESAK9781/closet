"""Generate realistic test paperwork from the templates into a *separate* folder.

    python tools/make_samples.py <out_dir>

Never point this at the real dump folder.  Variants produced:
  - filled template (fields), wet-ink AOC signature
  - "recreated" form: fields renamed and shifted a few points
  - flattened (fields burned into page text)
  - scanned/rasterized (image only, slightly offset)
  - F174 with an MFR page stapled in front
  - F174 filled, counselee signed with an ink annotation
  - badly named file
"""

import random
import shutil
import sys
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parents[1]
TEMPLATES = ROOT / "dump"


def squiggle(page, rect, annot=False):
    r = pymupdf.Rect(rect)
    pts = []
    x = r.x0 + 6
    while x < min(r.x1 - 6, r.x0 + 150):
        pts.append((x, r.y0 + 2 + random.random() * (r.height - 4)))
        x += 7
    if annot:
        page.add_ink_annot([pts])
    else:
        shape = page.new_shape()
        shape.draw_polyline(pts)
        shape.finish(color=(0.05, 0.05, 0.3), width=1.4)
        shape.commit()


def fill(doc, values: dict):
    for page in doc:
        for w in page.widgets():
            if w.field_name in values:
                v = values[w.field_name]
                if w.field_type == pymupdf.PDF_WIDGET_TYPE_CHECKBOX:
                    w.field_value = w.on_state() if v else "Off"
                else:
                    w.field_value = v
                w.update()


def rect_of(doc, name, nth=0):
    k = 0
    for page in doc:
        for w in page.widgets():
            if w.field_name == name:
                if k == nth:
                    return page.number, pymupdf.Rect(w.rect)
                k += 1
    raise KeyError(name)


F10_VALUES = {
    "Recieving Cadet Name": "Doe, John A",
    "Recieving Cadet Squadron": "CS-07",
    "Recieving Cadet Year": "2028",
    "Date": "12 Sep 26",
    "Reporting Official": "Mitchell, Sarah K",
    "Reporting Grade": "C/Capt",
    "Reporting Org/Office Symbol": "CS07/CCF",
    "RO MFR Attached No": True,
    "Conduct Narrative": "On 11 Sep 2026 at 0650, C4C Doe arrived at morning formation wearing an improperly "
                         "maintained uniform (unshined boots, uneven ribbons). Corrective action: on-the-spot "
                         "correction and re-inspection at 1200.",
    "Initial Processing Date": "13 Sep 26",
    "SQCCF Initials": "EJS",
    "Cadet SQCC Initials": "RTH",
    "Cadet SQCC Date": "14 Sep 26",
    "Demerits": "5",
    "Tours": "2",
    "Confinements": "1",
    "Loss of Pass Priv": "1 weekend",
    "Date Awarded": "15 Sep 26",
}


SANCTION_LABELS = {"Demerits": "1. DEMERIT(S)", "Confinements": "2. CONFINEMENT(S)",
                   "Loss of Pass Priv": "3. LOSS OF PASS PRIV", "Tours": "4. TOURS", "POV Priv": "5. REVOKE POV PRIV"}


def print_labels(page, rects: dict):
    """Recreated forms carry their block labels as real text just above each box."""
    for name, label in SANCTION_LABELS.items():
        r = rects[name]
        page.insert_text((r.x0 + 1, r.y0 - 3), label, fontsize=6.5)


def make(out: Path):
    random.seed(7)
    out.mkdir(parents=True, exist_ok=True)
    for t in ("F10_nuked_final.pdf", "F174_nuked_final.pdf"):
        shutil.copy2(TEMPLATES / t, out / t)
    f10 = TEMPLATES / "F10_nuked_final.pdf"
    f174 = TEMPLATES / "F174_nuked_final.pdf"

    # 1. Plain filled F10, AOC signed in wet ink (drawn), recipient not signed yet
    d = pymupdf.open(f10)
    fill(d, F10_VALUES)
    pn, r = rect_of(d, "AOC Signature")
    squiggle(d[pn], r)
    d.save(out / "John Doe_Neg_F10_Uniform Violation.pdf")

    # 2. Recreated F10: fields renamed + shifted, two recipients, recipient signed
    src = pymupdf.open(f10)
    d = pymupdf.open()
    names = {}
    for i, sp in enumerate(src):
        np_ = d.new_page(width=sp.rect.width, height=sp.rect.height)
        np_.show_pdf_page(np_.rect, src, i)
        for k, w in enumerate(sp.widgets()):
            nw = pymupdf.Widget()
            nw.field_type = w.field_type
            nw.field_name = f"TextField{i}_{k}"
            dx, dy = random.uniform(-7, 7), random.uniform(-6, 6)
            nw.rect = pymupdf.Rect(w.rect) + (dx, dy, dx, dy)
            nw.field_flags = w.field_flags
            val = F10_VALUES.get(w.field_name)
            if w.field_name in ("Demerits", "Tours", "Confinements"):
                val = None  # blank on a positive form -> 0
            if w.field_name == "Loss of Pass Priv":
                val = "N/A"
            if w.field_name == "Recieving Cadet Name":
                val = "Smith, Jane"
            if w.field_name == "Conduct Narrative":
                val = "Led the squadron's food drive, collecting 1,200 lbs of donations for the local shelter."
            if w.field_type == pymupdf.PDF_WIDGET_TYPE_CHECKBOX:
                nw.field_value = False
            elif w.field_type == pymupdf.PDF_WIDGET_TYPE_TEXT and val:
                nw.field_value = str(val)
            np_.add_widget(nw)
            names[w.field_name] = (np_.number, nw.rect)
    print_labels(d[0], {k: names[k][1] for k in SANCTION_LABELS})
    pn, r = names["Recieving Cadet Signature"]
    squiggle(d[pn], r)
    d.save(out / "Jane Smith_Pos_F10_Community Service.pdf")

    # 3. Flattened F10 (values become page text)
    d = pymupdf.open(f10)
    v = dict(F10_VALUES, **{"Recieving Cadet Name": "Garcia, Maria L", "Recieving Cadet Year": "2027",
                              "Conduct Narrative": "Late to SAMI by 4 minutes.", "Tours": "", "POV Priv": "None"})
    fill(d, v)
    print_labels(d[0], {k: rect_of(d, k)[1] for k in SANCTION_LABELS})
    pn, r = rect_of(d, "Recieving Cadet Signature")
    squiggle(d[pn], r)
    d.bake()
    d.save(out / "Maria Garcia_Neg_F10_Late to SAMI.pdf")

    # 4. Scanned F10: render to image, re-embed slightly offset
    d = pymupdf.open(f10)
    fill(d, dict(F10_VALUES, **{"Recieving Cadet Name": "Nguyen, Tam"}))
    pn, r = rect_of(d, "AOC Signature")
    squiggle(d[pn], r)
    pn, r = rect_of(d, "Recieving Cadet Signature")
    squiggle(d[pn], r)
    scan = pymupdf.open()
    for p in d:
        pix = p.get_pixmap(dpi=150, colorspace=pymupdf.csGRAY)
        sp = scan.new_page(width=p.rect.width, height=p.rect.height)
        sp.insert_image(sp.rect + (3, 4, 3, 4), pixmap=pix)
    scan.save(out / "Tam Nguyen_Neg_F10_Room Inspection.pdf")

    # 5. F174 with MFR page in front
    d = pymupdf.open()
    mfr = d.new_page(width=612, height=792)
    mfr.insert_text((72, 90), "MEMORANDUM FOR RECORD", fontsize=14)
    mfr.insert_text((72, 120), "SUBJECT: Statement regarding counseling of C3C Brown", fontsize=11)
    d.insert_pdf(pymupdf.open(f174))
    fill(d, {"Recieving Name": "Brown, Alex", "Recieving Grade": "C3C",
             "Recieving Unit/Office Symbol": "CS-07", "Reason for Counseling": "Repeated lateness to formation",
             "Couseling Summary": "Discussed three late arrivals this month and time-management expectations.",
             "Name Grade and Duty Title of Counselor": "C/SSgt Park, Flight Sergeant",
             "Couseling Date_af_date": "2026-09-18"})
    for p in d:
        for w in p.widgets():
            if w.field_name == "Counselee Signature":
                squiggle(p, w.rect)
    d.save(out / "Alex Brown_Neg_F174_Late to Formation.pdf")

    # 6. F174 positive, counselee signed via ink annotation, commander signed too
    d = pymupdf.open(f174)
    fill(d, {"Recieving Name": "Patel, Riya", "Recieving Grade": "C2C", "Recieving Unit/Office Symbol": "CS-07",
             "Reason for Counseling": "Outstanding performance as element leader",
             "Couseling Summary": "Recognized for leading element to top inspection scores.",
             "Name Grade and Duty Title of Counselor": "C/MSgt Ortiz, First Sergeant",
             "Couseling Date_af_date": "09/20/2026"})
    for p in d:
        for w in p.widgets():
            if w.field_name == "Counselee Signature":
                squiggle(p, w.rect, annot=True)
            if w.field_name == "Commander Signature":
                squiggle(p, w.rect)
    d.save(out / "Riya Patel_Pos_F174_Element Leadership.pdf")

    # 7. Comma in the filename recipient is still ONE person ("Lee, Kevin" -> Kevin Lee)
    d = pymupdf.open(f10)
    fill(d, {"Recieving Cadet Name": "Lee, Kevin", "Recieving Cadet Year": "2026", "Date": "19 Sep 26",
             "Conduct Narrative": "Missed accountability formation."})
    d.save(out / "Lee, Kevin_Neg_F10_Missed Formation.pdf")

    # 8. Badly named file
    d = pymupdf.open(f10)
    fill(d, {"Recieving Cadet Name": "Kim, Daniel", "Date": "21 Sep 26", "Conduct Narrative": "Unsecured room."})
    d.save(out / "scan0042.pdf")
    print("wrote", len(list(out.glob("*.pdf"))), "files to", out)


if __name__ == "__main__":
    make(Path(sys.argv[1]))
