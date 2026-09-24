# The Closet

A paperwork tracker for AFCW Form 10s and AF Form 174s. Drop PDFs into `dump/` and The Closet
reads them, works out what's filled in and who has signed, and gives you rows you can paste
straight into the **Conduct Log** tab of the master discipline tracker.

## Install

**Windows:** double-click **`Install The Closet.bat`**. It finds Python 3.10+ (or installs Python
3.12 for your user account with winget or python.org, no admin rights needed), creates a private
environment in `.venv`, installs the dependencies, and adds a **The Closet** shortcut to the
Desktop and Start Menu. Run it again any time to repair or update. `Uninstall The Closet.bat`
removes the shortcuts and `.venv` and leaves `dump/` and `metadata/` alone.

**macOS / Linux:** `./installer/install.sh` does the same thing, putting a launcher on the
desktop (and in the Linux applications menu). Use `--uninstall` to remove it.

## Start it

Open **The Closet** from the desktop shortcut. It runs without a console window and opens in your
browser. Clicking the shortcut again while it's running just brings it back up. It closes itself
10 minutes after the last browser tab is closed, and a log is kept at `metadata/closet.log`.

For a console instead: `The Closet.bat`, or `python run.py [--port 8765] [--no-browser]`.

## Git and personal information

Paperwork is personal information. `.gitignore` keeps everything in `dump/` out of git except the
two blank templates. The same goes for any PDF elsewhere, `metadata/`, and the tracker HTML
export. A pre-commit hook (`.githooks/pre-commit`, turned on by the installer) refuses such files
even when they're force-added with `git add -f`.

## Filing paperwork

Name every PDF `Recipient_PosOrNeg_FormType_Reason.pdf`, e.g.

```
John Doe_Neg_F10_Uniform Violation.pdf
Alex Brown_Neg_F174_Late to Formation.pdf
```

Only **Pos/Neg** and the **Reason category** come from the filename. Everything else is read from
the form itself: recipient, form type (worked out from what the pages look like), date, issuer,
reason details, sanctions, and signatures.

**Several recipients on one form:** open the form and type a comma-separated list into
Recipient(s), e.g. `John Doe, Amy Wu, Carl Diaz`. On save, the browser asks for each person's
class year in turn. Anyone whose year is already known from another form is filled in without
asking. Each person then gets their own row in the sheet export.

PDFs stay in `dump/` and are never moved or modified. The two blank templates (`F10_nuked_final.pdf`, `F174_nuked_final.pdf`) must
stay there too: they are the reference every form is compared against.

## How forms are read

Field names differ between versions of these forms, so The Closet matches by **position and
field type** instead:

1. Each page is compared with the template pages. This picks the form type when the filename
   doesn't say, and finds the form inside a PDF that has extra pages (an MFR, say).
2. Fillable fields are matched to template boxes by position, size, and type. A field whose edges
   are all within **10 pt** (≈10 px) of the template box counts as a sure match. The tolerance
   is adjustable in Settings.
3. Flattened forms are read from the text sitting inside each box.
4. Scans are aligned to the template, then any ink the blank template doesn't have is detected.
   That is how wet, drawn, or stamped signatures are found.

Routing is tracked as four steps: **SQ/CCF processed → Cadet SQ/CC signed → Recipient signed →
AOC/AMT signed**. On an F10 these come from the SQ/CCF initials, Cadet Commander block, cadet
signature, and AOC/AMT signature. On an F174, the counselee signature is the recipient. By
default the Commander's block counts as the Cadet SQ/CC (Settings can change that). Any step can
be set by hand from a form's page.

## Review queue

A form goes to **Review** when it can't be trusted as read: extra pages, missing fields, a
flattened or scanned copy, a layout that doesn't match, or a filename off the naming pattern. Fix
or fill in whatever is needed and choose **Save and mark reviewed**. The form won't come back to
the queue.

## Archive

A form that's redundant (a duplicate, or one superseded by a corrected copy) can be set aside
with **Archive** on its page or the archive button on its row in Paperwork. The PDF stays in `dump/` and its record and edits are kept, but it
moves to the **Archive** section and no longer counts in the stats, charts, review queue, cadet
totals, or sheet export. **Restore** brings it back.

## The metadata folder

Everything The Closet learns is kept in `metadata/`:

| Path | What it is |
|---|---|
| `forms/<id>.json` | One per PDF: the cached read, **your edits**, review/logged status, and history |
| `renders/<id>/` | Page images for the app (safe to delete; rebuilt) |
| `templates/` | Cached template geometry (safe to delete; rebuilt) |
| `settings.json` | Tracker labels, month format, tolerance, and so on |

To start over, choose **Settings → Clear metadata and rescan**. It erases the cached reads and
all edits (settings are kept), then reads every PDF again. A PDF is otherwise only read again
when its contents change. Renaming a PDF keeps its edits. Back up
`metadata/forms/` along with `dump/`.

## Pasting into the tracker

**Sheet export** lists rows in Conduct Log column order: Date, Class Year, Form Type, Reason
Category, Reason Details, Month, Name, Issuer, Pos/Neg, CDNA, **Passes**, **Demerits**, Tours,
Confinements, Other. Passes and Demerits go between CDNA and Tours, so add those columns to the
sheet there.

- **Reason Category** comes from the Reason part of the filename. **Reason Details** is the full
  narrative (F10) or the Reason for Counseling (F174), never shortened.
- **CDNA** and **Passes** aren't on the form. Type them in on the form's page. They only apply to
  positive Form 10s (blank for everything else), and every positive F10 needs both. Until they're
  entered, the form sits in the **Incomplete** group of the Review list.
- **Name** never includes rank: C1C, C2C, C3C, C4C, "Cadet", and C/ grades (C/Capt, C/2d Lt, and
  so on) are stripped.
- **Names are written first name first.** "Doe, John A" becomes John A Doe. In the Recipient(s)
  box, commas separate people, but a one-word piece is read as a surname: `Doe, John, Amy Wu` is
  John Doe and Amy Wu.
- **Typos:** when two names are within two characters of each other (John A Doe / Jon A Doe), The
  Closet asks whether they're the same person. If they are, it asks for the correct spelling and
  uses it on every form. Each pair is asked about only once; answers are kept in
  `metadata/names.json`.
- **Demerits, Tours, Confinements** are read from Section VI of the F10. A blank box, N/A, or None
  counts as 0. On a scanned copy they're left empty to type in, since a faint number can look
  blank. The AF 174 has no such blocks, so those columns stay blank for it.
- **Other** lists Loss of Pass and Revoke POV only when they actually say something. Blank, N/A,
  NA, and None leave it empty.

Choose
**Copy and mark as logged**, click the first empty Date cell in the Conduct Log, and paste. Each
form's page also has its own copy button. If your sheet's dropdowns use different wording
(e.g. `Negative` instead of `Neg`), set the labels in Settings.

## Testing

`python tools/make_samples.py <some other folder>` writes a set of realistic test forms: filled,
recreated with shifted fields, flattened, scanned, with an extra page, and badly named. Point the
app at that folder with `CLOSET_DUMP=<folder> CLOSET_METADATA=<folder2> python run.py`.
Never aim it at the real dump.
