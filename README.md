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

On first launch closet uses `Documents/closet/dump` for paperwork, with its `metadata`
folder next to it. Pick a different dump folder in **Settings → Folders**. An existing
`dump`/`metadata` pair from an earlier version carries straight over, edits included. PDFs are
never moved or changed. You can also drag PDFs onto the window, which copies them into the dump
folder.

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

Routing is tracked in four steps: **SQ/CCF processed → Cadet SQ/CC → Recipient → AOC/AMT**. Any
step can be recorded by hand when someone signs later.

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

## The metadata folder

| Path | What it is |
|---|---|
| `forms/<id>.json` | One per PDF: the cached read, **your edits**, review/logged/archive status, history |
| `renders/<id>/` | Page images for the app (safe to delete; rebuilt) |
| `templates/` | Cached template geometry (safe to delete; rebuilt) |
| `names.json` | Name spellings you confirmed |
| `settings.json` | Tracker labels, month format, tolerance, and so on |

**Settings → Clear metadata and rescan** starts over: it erases cached reads and edits (settings
are kept) and reads every PDF again.

## Development

```
npm install          # also patches a pdf.js performance bug (scripts/patch-pdfjs.mjs)
npm start            # run the app
npm test             # unit + engine tests on generated sample forms
npm run test:e2e     # drive the real app window with Playwright
npm run dist         # build installers for this system into dist/
```

`npm run samples -- <folder>` writes realistic sample paperwork with made-up names: fillable,
recreated with shifted fields, flattened, scanned, with an extra page, and badly named. Never point
it at a real dump folder.

Installers for every platform are built by GitHub Actions (`.github/workflows/build.yml`): run it
from the Actions tab, or push a `v*` tag to publish a release.

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
