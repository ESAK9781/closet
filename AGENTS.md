# AGENTS.md

Guidance for an AI agent (or a human skimming fast) working in this repo. For what the app does
and how a person uses it, read `README.md` first — this file is about how the code is put
together and how to change it safely.

## What this is

**closet** is an Electron desktop app for a first sergeant tracking AFCW Form 10s and AF Form 174s
(cadet discipline paperwork). It reads PDFs from a **dump folder**, matches their fields against
two blank templates by position, and produces rows for a Google Sheets "Conduct Log". PDFs in the
dump folder are never moved, and only changed by the few explicit actions listed under "Editing PDFs and sync safety" (each keeps the original).

## Layout

| Path | Role |
|---|---|
| `src/main/main.js` | Electron main process: window, the `closet://` scheme, all IPC, native dialogs |
| `src/main/updater.js` | Auto-update from GitHub releases (electron-updater); state shown in Settings → Updates |
| `src/main/preload.cjs` | The only bridge into the renderer — a small explicit `window.closet` API, no Node in the page |
| `src/core/store.js` | The metadata store: scanning, the parser-thread queue, settings, edits, file add/replace |
| `src/core/sync.js` | Sync mode: pull / match / clear / push over per-step folders; the ledger that guarantees only closet's own files are ever deleted |
| `src/core/backup.js` | Backup/restore as a hand-written zip: verify first, safety backup, rollback on failure; paths are validated so a backup can only write into the dump/metadata folders |
| `src/core/signable.js` | PDF structure checks ("can Adobe sign here?") and edits as incremental updates: `addField`, `fillSlots`, `approveAoc` |
| `src/core/notify.js` | Email: the contact registry (`metadata/notify.json`), the per-cadet summary email, sending, and automatic stage updates. Talks to Gmail only through the `mailer` the Store is given |
| `src/core/people.js`, `contacts.js` | Name-format matching ("Last, First M", rank, order, typos within two letters); reading a contact spreadsheet (csv/tsv/xlsx via `backup.js`'s zip reader) into name/email pairs |
| `src/core/tracker.js`, `xlsx.js`, `cloud.js` | Served tours/confinements and balances: reads the serving log of the discipline workbook, optionally overwrites its conduct log, builds a blank workbook. Every sheet name, row and heading is a setting (`settings.tracker`). `xlsx.js` edits a workbook in place (other parts of the zip are kept byte for byte) with no spreadsheet dependency |
| `src/main/mailer.js` | Gmail via nodemailer; the app password is encrypted with `safeStorage` in userData `config.json`, never in metadata or backups |
| `src/core/records.js` | Pure functions turning raw slot values + overrides into tracker records and sheet rows |
| `src/core/templates.js` | The *meaning* of each template field (semantic key, label, section) and the routing-flag definitions |
| `src/core/pool.js`, `worker.js`, `extract.js`, `imaging.js`, `assignment.js` | The pdf.js-based parser: template matching, field extraction, worker-thread pool |
| `src/renderer/` | The whole UI: `app.js` (~1500 lines, no build step, no framework), `app.css`, `index.html` |
| `resources/logo/` | The master logo. `npm run icons` builds every icon size from it (installer, window, site, sidebar) |
| `resources/templates/` | The two blank template PDFs everything is compared against |
| `test/` | `engine.test.mjs` and `records.test.mjs` run against generated sample forms; `test/e2e/` drives the real app with Playwright |
| `tools/make-samples.mjs` | Generates realistic fake paperwork for tests — **never point it at a real dump folder** |

## Architecture in one paragraph

The renderer is a single plain-JS file with no bundler and no framework: it renders HTML strings
into `#main` and a slide-out drawer, and rebinds event handlers after every render. All data flows
through one IPC channel (`closet:api`) carrying REST-style `(method, url, body)` calls that
`main.js#route()` dispatches to `Store` methods — this mirrors an earlier Python/HTTP version of
the app, so the shape stuck. Anything that needs a native dialog (open/save file pickers, choosing
a folder) is its own dedicated IPC handler in `main.js`, exposed individually on `window.closet`,
since dialogs don't fit the REST shape. The `Store` pushes a single `"changed"` event (debounced)
instead of the renderer polling; `load()` in `app.js` re-fetches the whole snapshot on that event.

## Key domain concepts

- **Form id**: `sha1(filename.toLowerCase()).slice(0, 14)` (`store.formId`). Metadata is keyed by
  filename, not content, so renaming a *different* file loses
  its history, but **replacing a file's content at the same path keeps everything** — the parser
  detects the sha1 changed and just re-reads it. This is exactly what "upload an updated copy" and
  the bulk-upload duplicate check rely on: overwrite in place, don't create a new id.
- **Overrides**: every value the software reads has a corresponding user edit under
  `meta.overrides`. `null` means "explicitly reset to detected", `undefined`/absent means "use the
  detected value". `records.buildRecord` layers overrides over `autoRecord`'s output.
- **Routing flags** (`templates.FLAG_DEFS`): a small ordered list of signature/processing steps
  tracked per form (`sqccf_processed`, `cadet_cc_initialed`, `recipient_signed`, `aoc_signed` as of this writing). Each
  maps to one or more template slots via `flagSlots()`; a flag can also be set by hand as an
  override. **The UI (`FLAGS` in `app.js`), the settings schema, and `templates.js` must all agree
  on this list** — nothing else hardcodes the count, but check `routeBig()`'s CSS grid (`--n` custom
  property in `app.css`'s `.route-lg` rules) if you ever change how many there are.
- **PARSER_VERSION** (`store.js`): bump it when parsing logic changes in a way that should re-read
  every existing form. Overrides survive a re-read; cached `analysis` does not.
- **Archived** forms are kept (file + metadata) but excluded from every count, chart, and export —
  don't add a feature that silently includes them; check `active()` / `f.archived` like existing
  code does.

## Conventions

- No build step anywhere in `src/`. The renderer is hand-written JS/CSS/HTML — don't introduce a
  bundler, TypeScript, or a framework for a small addition.
- Comments explain *why*, briefly, only where it's non-obvious (see the file headers in `core/` for
  the house style). Don't add comments that restate the code.
- Small, direct functions over abstraction. Don't add a plugin system, config layer, or generic
  "handler registry" for something that's currently one or two call sites.
- IPC additions: data/CRUD operations go through `route()` in `main.js` as a REST-style path and a
  `Store` method; anything that needs `dialog`, `shell`, or another native API gets its own
  `ipcMain.handle("closet:...")` and its own line in `preload.cjs`.
- Renderer state lives in the single `S` object at the top of `app.js`; view functions read `S` and
  re-render whole sections rather than diffing. Follow that pattern rather than introducing
  component state.

## Editing PDFs and sync safety

- `signable.js` writes **incremental updates** (original bytes kept, change appended) so digital
  signatures stay valid; only a damaged, unsigned file is rewritten. Don't swap in `pdf-lib`'s
  `save()` for edits to a user's PDF. Objects it creates must be registered (`ctx.register`): an
  embedded pdf-lib font that is never saved is a dangling reference.
- The dump folder is edited by exactly three things: Upload/sync replacing a form, the bulk step
  buttons, and the AOC/AMT stamp. The last two copy the original to `metadata/backups` first.
- Sync **never deletes a file it didn't create**, with one exception: a New-paperwork (intake) file that was added as a new form is removed from the intake folder, and only if its hash still matches what was pulled. Send folders are cleared only of ledger entries
  whose hash still matches; everything else is reported. Keep it that way: `test/sync.test.mjs`
  asserts it.
- Steps with a bulk action are in `templates.BULK_STEPS`; the AOC/AMT approval is deliberately not
  one of them (single form only).
- Worker jobs (`analyze`, `inspect`, `addField`, `fillSlots`, `approveAoc`) go through
  `pool.run()`; PDF work must stay off the main process.

## Discipline workbook

- Reading is free; **writing is opt-in** (`tracker.push.enabled`) and always saves a copy to `metadata/sheet-backups` first. Pushing only touches the columns it is told to (found by heading), never the serving log, and refuses when the header row doesn't look right rather than guessing.
- The user's real tracker contains names: tests build workbooks with `createTemplate`/`patchWorkbook`; never commit a real one.
- `record.counted` (= fully signed on every applicable routing flag, not rejected, not archived) is the only thing that makes tours, confinements, passes or CDNA count: balances, overview/cadet totals, email totals and the sheet's formulas (via the conduct log's Status column) all follow it. **Rejected** (`meta.rejected`) is a form status like archived but stays visible; it must be excluded from anything that sends a form onward (quickdump, sync push, bulk steps, automatic emails).
- Anything read from or written to a folder the user owns may be a OneDrive placeholder: go through `cloud.js` (`ensureLocal` before reading, `settle` after writing).
- Push overwrites all three sheets; the serving log is re-read first and written back verbatim (`state.raw`), and the balances sheet is names + formulas only, never read back.
- Balance = assigned (from forms) - served (from the sheet), floored at 0, per name key. Email content (`notify.content`) is plain on/off switches; keep `compose()` honoring them.

## Email

- Every send path goes through `Notifier.ready()`; with no account the answer is a sentence, not an exception. Keep it that way, and keep automatic sends from ever throwing into the store.
- Credentials must never enter `metadata/` (backups and sync would carry them). Tests use a fake mailer or `CLOSET_MAIL_OUTBOX` (writes messages to a folder); never send real mail from a test.
- Automatic updates compare each form's routing flags with `notify.json`'s `seen` baseline; enabling, a new form, a parser bump and a reset all re-baseline silently so nothing old is announced.

## Privacy and git

Real paperwork is personal information. `.gitignore` excludes `dump/`, `metadata/`, and every PDF
except the two blank templates; a pre-commit hook (`.githooks/`, enabled with
`git config core.hooksPath .githooks`) refuses them even when force-added. Don't work around this
hook, and don't add sample/test fixtures that resemble real names — `tools/make-samples.mjs`
already generates realistic-looking fake data for that purpose.

## Commands

```
npm install          # also patches a pdf.js perf bug (scripts/patch-pdfjs.mjs)
npm start             # run the app
npm test              # unit + engine tests on generated sample forms
npm run test:e2e       # drive the real app window with Playwright
npm run samples -- <folder>   # write sample paperwork into <folder> (never a real dump folder)
npm run dist          # build installers for this system into dist/
```

Run `npm test` after touching anything in `src/core/`. If you change `FLAG_DEFS`, the routing-flag
slot mapping, or filename/date parsing, also check `test/engine.test.mjs` and
`test/records.test.mjs` for assertions that assume the old shape.
