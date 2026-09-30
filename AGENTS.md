# AGENTS.md

Guidance for an AI agent (or a human skimming fast) working in this repo. For what the app does
and how a person uses it, read `README.md` first — this file is about how the code is put
together and how to change it safely.

## What this is

**closet** is an Electron desktop app for a first sergeant tracking AFCW Form 10s and AF Form 174s
(cadet discipline paperwork). It reads PDFs from a **dump folder**, matches their fields against
two blank templates by position, and produces rows for a Google Sheets "Conduct Log". PDFs in the
dump folder are read-only from the app's point of view: never moved, never modified.

## Layout

| Path | Role |
|---|---|
| `src/main/main.js` | Electron main process: window, the `closet://` scheme, all IPC, native dialogs |
| `src/main/updater.js` | Auto-update from GitHub releases (electron-updater); state shown in Settings → Updates |
| `src/main/preload.cjs` | The only bridge into the renderer — a small explicit `window.closet` API, no Node in the page |
| `src/core/store.js` | The metadata store: scanning, the parser-thread queue, settings, edits, file add/replace |
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
