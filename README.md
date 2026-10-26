# closet

A desktop app for the first sergeant. Drop AFCW Form 10s and AF Form 174s into a folder and closet reads them, tracks who has signed, flags anything that needs a person, and gives you rows
ready to paste into the **Conduct Log** tab of the master discipline tracker.

Runs on Windows, macOS, and Linux. Everything stays on your computer. MIT licensed.

**Website and downloads: [esak9781.github.io/closet](https://esak9781.github.io/closet/)** (the
landing page is `index.html`, published with GitHub Pages).

## Install

Download the installer for your system (from the landing page or the repository's Releases):

| System | File |
|---|---|
| Windows | `closet-setup.exe` (installs, adds Desktop and Start Menu shortcuts), or `closet-portable.exe` (no install) |
| macOS | `closet-mac-arm64.dmg` (Apple silicon) or `closet-mac-x64.dmg` (Intel). Not notarized yet: the first time, right-click the app and choose Open. |
| Linux | `closet-linux-x86_64.AppImage`, or `closet-linux-amd64.deb` for Debian/Ubuntu |

## Using it

On a new install closet keeps paperwork in a `dump` folder (with its `metadata` folder next to it)
inside the app's data folder (`%APPDATA%\closet` on Windows, `~/Library/Application Support/closet`
on macOS, `~/.config/closet` on Linux), so there's no reason to open it: add PDFs with **Add files**
or by dragging them on. You can view or change it in **Settings → Folders**. An existing
`dump`/`metadata` pair from an earlier version keeps working, edits included.

**Quick dump** (Paperwork page) copies every active form into six folders by the first routing
step it's still waiting on (the last is fully complete), and puts a print-ready packet with an
index sheet in the AOC/AMT folder. Output goes to the *Quick dump folder* in Settings → Folders
(default `Documents/closet/quick dump`). PDFs are
never moved or changed. You can also drag PDFs onto the window, or click **Add files** in
Paperwork, to copy them into the dump folder. If a name you're adding is already there, closet
asks whether it's an updated copy of the same paperwork (say, scanned back in now that it's
signed) or a different form — no need to sort that out by hand first.

### Sync mode

**Settings → Quick dump and sync → Mode** switches Quick dump to **Sync**. Each routing step then
gets a *send* folder (copies of forms waiting on it) and a *returned* folder (where signed copies
are saved), plus a *Fully complete* send folder and a *New paperwork* returned folder. A step with
no folder set is simply skipped. Pressing **Sync** on Paperwork:

1. **Pulls** files added to a returned folder since the last sync (turning sync on starts the
   clock: nothing already sitting there is pulled). Each is matched to the form it came from by
   content and filename, and you confirm every match in one table. Tick **Review** on a row to
   compare it side by side in the Review tab first. A confirmed match replaces the form's PDF
   exactly like **Upload updated copy**.
2. **Clears** the send folders, removing only copies closet put there itself and never touched
   since. Anything else (a file someone added, a copy that was signed in place, any subfolder) is
   left alone and listed for you.
3. **Pushes** every form to the folder for its next step, after checking the field that step needs
   can really be signed in Adobe (it exists, is a real signature/text field, isn't read-only,
   locked, or already holding a signature value; the file isn't damaged, certified, or secured).
   A form that fails is shown with a picture of where the field should be, and you choose: record
   the step as done (the signature was flattened in), add a new field on top in the copy that's
   sent, or send it as it is. Your stored PDF is never changed by this.

The combined AOC/AMT print packet is off by default; turn it on in the same settings section.

**Missing signatures:** a file that comes back from a step's returned folder is checked for that
step's signature. If it isn't there (or the file can't be read) you get a warning when the sync
matches it, and it is pre-ticked for **Review** so it is held back and shown beside the form until you
decide, in case the signature really is there but wasn't recognised.

### One-click steps

On Paperwork, **SQ/CCF initials** and **Cadet CC initials** write the same initials into every form
still waiting on that step, plus today's date in the date box (SQ/CCF: the log-in date, which can be
turned off in Settings → Bulk initials; Cadet CC: Section V box 3's date). Initials are remembered.
Where a form has no usable box, a text box is placed on top of the spot. The PDFs are updated (the
originals are kept in `metadata/backups`) and the step is marked done. The same two buttons appear on
a single form in the viewer, along with **Mark AOC/AMT approved**: for when the AMT says a form is
approved but sends no signed copy. It removes the empty signature box, stamps the spot in red
("Marked AOC/AMT approved by First Sergeant (unofficial)", "AOC/AMT Approved"), fills the commander
date on an AF 174, and marks the step done. It's a one-form-at-a-time action by design.

### Backup and restore

**Settings → Backup and restore → Export backup** saves everything into one ordinary `.zip`: every
PDF in the dump folder, the whole metadata folder (edits, reviews, name answers, settings, sync
state, `backups/`), and the per-computer settings that matter. Page images are left out (rebuilt).
**Import backup** replaces the dump folder's PDFs and the metadata folder with a backup's. The file
is read and checked in full first (a damaged or foreign zip is refused with nothing touched); your
current data is then saved as `before-restore-<time>.zip` in closet's data folder (`backups/`), and
put back automatically if the restore fails part-way. Other files and subfolders in the dump folder
are left alone. Take a backup before trying anything risky.

### Finding forms

The Paperwork list filters by form type, Pos/Neg, **next step needed**, **attention** (review /
missing CDNA and Passes), tracker status, reason, class year, and month. Each dropdown shows how
many forms a choice would leave given the other filters, and **Clear filters** resets them all.

Open any form and use **Download** to save a copy of its PDF elsewhere, or **Upload updated
copy** to replace it with a newer one (same filename, so your edits and signatures stay put).
**Download by signature** in Paperwork copies every form still awaiting a chosen signature into a
folder you pick, for printing or routing a batch at once.

### Email notifications

**Settings → Push notifications** holds everything for email; the **Notifications** tab sends it.

- **Gmail:** connect a Gmail account with an *app password* (the **i** button next to the heading
  walks through making one; Google requires 2-Step Verification). It's checked with Google before
  it's saved, kept encrypted by the operating system in closet's per-computer config, and never put
  in the metadata folder or in backups.
- **Contact list:** import a spreadsheet (.xlsx, .csv, .tsv) in any layout, or add people by hand.
  closet finds every email address and takes the name from the cells to its left, then matches it
  to the nearest recipient name on your forms ("Doe, John A.", "C2C John Doe" and "John Doe" are one
  person; a name within two letters is a close match, marked "Check match"). Everything is editable
  in the list, and a re-import never overwrites your corrections. When a new cadet shows up who
  isn't linked to an email, closet asks whether a similar-looking contact is theirs (in the class
  year question when it's being asked, or on its own).
- **Sending:** pick everyone with an email, or a few, write a message, and each person gets it
  followed by a table of their active forms: where each is in processing, and its rewards or
  sanctions. Preview, **Send a test to me**, and a recent-activity log are on the tab. An optional
  signature (a switch in settings) is added at the very end.
- **Automatic updates:** off for everyone. Turn them on, tick the steps that count, and opt people
  in (one by one, by class year, or all). Turning them on announces only what changes afterwards,
  they go out only while closet is open, and a change that would email more than 20 people at once is
  held and reported instead of sent.

Nothing breaks without an account: sending is disabled with the reason shown, and automatic
updates can't be turned on.

### Rejected forms

If someone on the route turns a form down, open it and choose **Mark rejected**. It leaves the
process: it isn't sent for signatures (quick dump, sync, bulk steps), gets no automatic emails, and
counts toward nothing. It stays in the Paperwork list, marked **Rejected** (Filter → Progress →
Rejected finds them), unlike archived forms, and **Undo rejection** puts it back.

### Naming paperwork

Name PDFs `Recipient_PosOrNeg_FormType_Reason.pdf`, e.g. `John Doe_Neg_F10_Uniform Violation.pdf`.
Only **Pos/Neg** and the **Reason category** come from the filename. Everything else is read from
the form: recipient, form type (from what the pages look like), date, issuer, reason details,
sanctions, and signatures.

### How forms are read

Field names differ between versions of these forms, so closet matches by **position and field
type** against the blank templates built into the app:

1. Each page is compared with the template pages. This picks the form type and finds the form
   inside a PDF with extra pages (an MFR stapled in front, say).
2. Fillable fields are matched to template boxes by position, size, and type. A field whose edges
   are all within **10 pt** of the template box is a sure match (adjustable in Settings).
3. Flattened copies are read from the text sitting inside each box; printed labels are ignored.
4. Scans are aligned to the template, and ink the blank template doesn't have shows which boxes and
   signatures are filled.

Routing is tracked in five steps: **Issuer signed → SQ/CCF processed → Cadet Commander → Recipient → AOC/AMT**
(the AF 174 has no Cadet Commander box, so that step shows as n/a there). The issuer's signature is
the Awarding Official box on the Form 10 (it has no separate reporting-official box) and the
Counselor signature on the AF 174; a form signed further down the route without it gets a warning.
Any step can be recorded by hand when someone signs later.

### The rules

- **Names** never include rank (C1C–C4C, "Cadet", C/ grades), and "Last, First" becomes "First
  Last". In the Recipient(s) box, commas separate people (a one-word piece is a surname), and each
  person gets their own sheet row. closet asks for any class year it doesn't already know.
- **Typos:** names within two letters of each other prompt a same-person check; the answer is
  remembered in `metadata/names.json`.
- **CDNA** and **Passes** aren't on the form. They're typed in, only apply to positive Form 10s, and
  are required there: until both are entered the form sits in the **Incomplete** group of Review.
- **Demerits, Tours, Confinements** come from Section VI of the F10. A blank, N/A, or None is 0,
  except on scans, where they're left for you to type. AF 174s have none of these.
- **Other** lists Loss of Pass and Revoke POV only when they say something.
- **Reason details** are never shortened.
- **Review** collects forms that can't be trusted as read: extra pages, missing fields, flattened
  or scanned copies, a layout that doesn't match, or a filename without Pos/Neg.
- **Archive** sets redundant paperwork aside: kept, but left out of every count and export.

### Pasting into the tracker

**Sheet export** lists rows in Conduct Log column order: Date, Class Year, Form Type, Reason
Category, Reason Details, Month, Name, Issuer, Pos/Neg, CDNA, Passes, Demerits, Tours,
Confinements, Other. Choose **Copy and mark as logged**, click the first empty Date cell, and paste.

### Served tours and confinements

Tours and confinements are *assigned* on Form 10s; what was *served* is written down by hand, so
closet reads it from a workbook. **Settings → Discipline sheet** holds all of this; the **Balances**
tab shows the result.

- **The workbook:** choose an .xlsx (Google Sheets: File → Download → Microsoft Excel), or press
  **Create new workbook** for a blank one with a conduct log, a serving log (Tour / Confinement
  dropdown) and cadet balances that add themselves up. Only the serving log is read, and only
  completed discipline: a row needs a name, a tour or confinement, and an amount. It's read again
  whenever the file changes, and reading never alters it.
- **What counts:** tours and confinements (and passes and CDNA) count only once a form is **fully
  signed by everyone on the route** and not rejected. Until then they show as pending.
- **Balances:** for every cadet, tours and confinements assigned, served and left (assigned minus
  served, never below zero). Names in the sheet are matched the way names are everywhere else
  ("Doe, John" = "John Doe", small typos tolerated); anyone with no paperwork is listed as *Not on file*.
  **Only sanctions issued before…** (a date, or the *1 week ago* / *2 weeks ago* / 30 / 60 / 90 day
  presets) limits the balance to fully signed forms dated before then, with everything served applied
  to the oldest first, so what's left is what has gone unserved longest.
- **Layout is settings:** the sheet name, header row, every column heading, and the words in the
  type column. Defaults match the CS07 tracker. If the headings aren't on the header row closet
  looks for them near the top.
- **Writing the workbook (off by default):** turn on *Allow writing*, then **Write to workbook**
  overwrites everything: the conduct log with closet's records (one row per recipient, with a
  Status column: Complete / In progress / Rejected), the serving log (read again first so nothing
  typed since the last sync is lost; rows closet can't use are kept, names are respelled to match the
  forms) and the balances sheet, which gets cadet names, class year, report counts and assigned tours/confinements as plain values (worked out by closet, counting only fully signed forms), with formulas only for served tours/confinements and what's left and the status that follow from them,
  so counts update as served tours are typed in. closet never reads the balances sheet. Every
  heading and what goes under it is a setting. A copy is saved first (`metadata/sheet-backups`) and
  the workbook must be closed in Excel.
- **OneDrive:** a workbook (or sync file) that exists only in the cloud is downloaded before
  closet reads it, and after a write closet waits for OneDrive to release and pick up the file. If
  OneDrive can't deliver the file you get a sentence about it, not a half-read file.
- **In emails:** each cadet's email shows tours and confinements left to serve (with the served and
  assigned counts behind them). **Settings → Push notifications → What the emails say** switches the
  table, each of its columns, which forms are listed, the balances, the totals line and the footer.

## The metadata folder

| Path | What it is |
|---|---|
| `forms/<id>.json` | One per PDF: the cached read, **your edits**, review/logged/archive status, history |
| `renders/<id>/` | Page images for the app (safe to delete; rebuilt) |
| `templates/` | Cached template geometry (safe to delete; rebuilt) |
| `names.json` | Name spellings you confirmed |
| `notify.json` | Email contacts, automatic-update choices, signature and send log (never a password) |
| `settings.json` | Tracker labels, month format, tolerance, sync folders, remembered initials, and so on |
| `served.json` | What the discipline workbook's serving log said last time it was read |
| `sheet-backups/` | The last ten copies of the workbook, saved before closet wrote into it |
| `sync.json` | Sync state: when it started, what closet put in the send folders, files waiting for a decision |
| `backups/` | The original of any PDF closet edited (bulk initials, approval stamp) |

**Settings → Clear metadata and rescan** starts over: it erases cached reads and edits (settings
are kept) and reads every PDF again.

## Development

```
npm install          # also patches a pdf.js performance bug (scripts/patch-pdfjs.mjs)
npm start            # run the app
npm test             # unit + engine tests on generated sample forms
npm run test:e2e     # drive the real app window with Playwright
npm run dist         # build installers for this system into dist/
npm run demo -- <folder>   # a made-up squadron's worth of paperwork, for screenshots
npm run shots        # re-take the landing page's screenshots (site/*.webp) from the real app
```

`npm run samples -- <folder>` writes realistic sample paperwork with made-up names: fillable,
recreated with shifted fields, flattened, scanned, with an extra page, and badly named. Never point
it at a real dump folder.

Installers for every platform are built by GitHub Actions (`.github/workflows/build.yml`): run it
from the Actions tab, or push a `v*` tag to publish a release.

**Automatic updates.** The installed app checks this repo's latest GitHub release shortly after it
starts and every six hours, downloads a newer one in the background, and installs it when the app
is closed (or on **Settings → Updates → Restart and install**). It can be switched off there. To
ship an update: bump `version` in `package.json`, commit, then push a tag with the same number
(`v2.1.0`); CI refuses a tag that doesn't match. The release must be public and published (not a
draft) and carries `latest.yml`/`latest-linux.yml` beside the installers. Windows (installer) and
Linux (AppImage) update themselves; the portable build, the `.deb`, and macOS don't (macOS needs a
signed app), and Settings links to the releases page instead.

### Layout

| Path | |
|---|---|
| `src/main/` | Electron main process: window, `closet://` scheme, IPC routes, preload bridge |
| `src/core/` | The engine: PDF analysis (pdf.js), records and sheet rows, the metadata store, parser threads |
| `src/renderer/` | The app UI |
| `resources/` | Blank templates and icons |
| `test/` | Tests; `tools/` sample generator; `site/` landing-page images |

### Privacy and git

Paperwork is personal information. `.gitignore` keeps `dump/`, `metadata/`, the tracker export,
and every PDF except the two blank templates out of git. A pre-commit hook (`.githooks/`, enable
with `git config core.hooksPath .githooks`) refuses them even when force-added.

Built with Electron, pdf.js (Apache-2.0), pdf-lib, and @napi-rs/canvas (MIT). Archivo font (SIL OFL).
