// Sync mode: a folder pair per routing step, plus one folder for new paperwork and one for
// finished paperwork.
//
//   pull   Copies of forms that people signed come back into a step's "returned" folder (new
//          paperwork into the intake folder). Only files added since the last sync are picked up.
//          Each is read and matched to the form it came from, by content and by filename; the
//          person confirms the matches (or sends one to Review for a side-by-side look), and a
//          confirmed copy replaces the form's PDF exactly like "Upload updated copy".
//   clear  Each "send" folder is emptied of the copies closet put there last time. Only those:
//          the ledger records every file closet writes, with its hash, and anything else -- a file
//          someone added, or one of ours that was changed since (signed in place?) -- is left
//          alone and reported. Subfolders are never touched.
//   push   Every active form is copied into the send folder of the first step it's still waiting
//          on, after checking that the field that step needs really can be signed (signable.js).
//          A form that fails is held back for the person to decide: record the step as done, add a
//          fresh field on top, or send it as it is.
//
// A step with no folder set simply isn't pulled from or pushed to. PDFs in the dump folder are
// never modified: a patched copy is written to the send folder, never back.

import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { buildPacket, firstOpenStep, PACKET_NAME, PACKET_STEP } from "./quickdump.js";
import * as R from "./records.js";
import { writeJson } from "./store.js";
import { FLAG_DEFS, flagSlots } from "./templates.js";

export const STAGES = FLAG_DEFS.map(([k]) => k);
export const SYNC_KEYS = [...STAGES, "complete", "intake"];
export const HAS = { push: [...STAGES, "complete"], pull: [...STAGES, "intake"] };
export const LABELS = Object.fromEntries([...FLAG_DEFS.map(([k, , short]) => [k, short]), ["complete", "Fully complete"], ["intake", "New paperwork"]]);

const now = () => new Date().toISOString().slice(0, 19);
const CASELESS = process.platform === "win32" || process.platform === "darwin";
export const norm = (p) => (CASELESS ? path.resolve(p).toLowerCase() : path.resolve(p));
const inside = (base, p) => {
  const rel = path.relative(base, p);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};
const sha1File = (f) => createHash("sha1").update(fs.readFileSync(f)).digest("hex");
const folderName = (key, dir) => `${LABELS[key]} ${dir === "push" ? "send" : "returned"} folder`;

/**
 * Sync folders must not be (or be inside) the dump or metadata folder, and a send folder can't be
 * shared with any other folder (it gets cleared). Returned folders may share with each other.
 */
export function validateFolders(folders, { dump, meta }) {
  const seen = new Map();
  for (const key of SYNC_KEYS) {
    for (const dir of ["push", "pull"]) {
      const p = folders?.[key]?.[dir];
      if (!p || !HAS[dir].includes(key)) continue;
      const name = folderName(key, dir);
      if (typeof p !== "string" || !path.isAbsolute(p)) throw new Error(`The ${name} must be a full folder path`);
      const n = norm(p);
      for (const [base, what] of [[dump, "the dump folder"], [meta, "the metadata folder"]]) {
        if (inside(norm(base), n)) throw new Error(`The ${name} can't be ${what} or a folder inside it`);
      }
      const other = seen.get(n);
      if (other && (dir === "push" || other.dir === "push")) throw new Error(`The ${name} and the ${other.name} can't be the same folder`);
      seen.set(n, { dir, name });
    }
  }
}

// --------------------------------------------------------------------------- matching

const normText = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** A filename reduced to what identifies the paperwork: no copy counters or "signed"/"final" tags. */
export function nameKey(filename) {
  return normText(String(filename).replace(/\.pdf$/i, "").replace(/\(\d+\)/g, " "))
    .replace(/\b(copy|signed|sign|sig|final|updated|update|scan|scanned|new|returned|done|completed?|rev\d*|v\d+)\b/g, " ")
    .replace(/\s+/g, " ").trim();
}

/** Sørensen–Dice on character bigrams: 1 = same text. */
export function dice(a, b) {
  if (a === b) return a ? 1 : 0;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = new Map();
  for (let i = 0; i < a.length - 1; i++) grams.set(a.slice(i, i + 2), (grams.get(a.slice(i, i + 2)) || 0) + 1);
  let hit = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    const n = grams.get(g);
    if (n) {
      hit++;
      grams.set(g, n - 1);
    }
  }
  return (2 * hit) / (a.length + b.length - 2);
}

// [slot key, weight, what a match means in words]
const CONTENT = [
  ["recipient_name", 3, "recipient"], ["narrative", 3, "narrative"], ["reason", 2, "reason"], ["date", 2, "date"],
  ["issuer", 1.5, "issuer"], ["counselee_name", 1, "counselee"], ["squadron", 0.5, "squadron"], ["class_year", 0.5, "class year"],
];

function contentScore(slots, fields) {
  let sum = 0;
  let weight = 0;
  const same = [];
  const differ = [];
  for (const [k, w, words] of CONTENT) {
    const a = normText(slots?.[k]?.value === true ? "" : slots?.[k]?.value);
    const b = normText(fields?.[k] === true ? "" : fields?.[k]);
    if (!a || !b) continue;
    const s = dice(a, b);
    sum += s * w;
    weight += w;
    if (s >= 0.9) same.push(words);
    else if (s < 0.5 && w >= 2) differ.push(words);
  }
  if (weight < 2) return { score: null, why: [] };
  const why = [];
  if (same.length) why.push(`same ${same.join(", ")}`);
  if (differ.length) why.push(`different ${differ.join(", ")}`);
  return { score: sum / weight, why };
}

function slim(a) {
  if (!a || a.error) return { error: a?.error || "Couldn't read it", page_count: a?.page_count ?? 0, renders: [], slots: {} };
  const slots = {};
  for (const [k, s] of Object.entries(a.slots || {})) {
    slots[k] = { key: k, label: s.label, ftype: s.ftype, value: s.value, filled: s.filled, page: s.page, rect: s.rect, source: s.source };
  }
  return { form_type: a.form_type, mode: a.mode, page_count: a.page_count, page_map: a.page_map, renders: a.renders || [], slots };
}

// --------------------------------------------------------------------------- the sync

export class Sync {
  constructor(store) {
    this.store = store;
    this.file = path.join(store.meta, "sync.json");
    this.stageDir = path.join(store.meta, "sync", "incoming");
    this.fixDir = path.join(store.meta, "sync", "patched");
    let saved = {};
    try {
      saved = JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch { /* first use */ }
    this.state = { since: null, last_sync: null, ledger: {}, sent: {}, handled: {}, pending: [], ...saved };
    this.busy = false;
  }

  save() {
    writeJson(this.file, this.state);
  }

  folders() {
    const f = this.store.settings.sync_folders || {};
    return Object.fromEntries(SYNC_KEYS.map((k) => [k, {
      push: HAS.push.includes(k) ? f[k]?.push || "" : "",
      pull: HAS.pull.includes(k) ? f[k]?.pull || "" : "",
    }]));
  }

  /** Sync turned on: files already sitting in the returned folders are never pulled. */
  activate() {
    if (this.state.since) return;
    this.state.since = Date.now();
    this.save();
  }

  async exclusive(fn) {
    if (this.busy) throw new Error("A sync is already running");
    this.busy = true;
    try {
      await this.store.ready;
      if (this.store.templateError) throw new Error(this.store.templateError);
      return await fn();
    } finally {
      this.busy = false;
    }
  }

  brief(p) {
    return {
      token: p.token, key: p.key, folder: LABELS[p.key], kind: p.kind, filename: p.filename, src: p.src,
      pulled_at: p.pulled_at, status: p.status, candidates: p.candidates, suggestion: p.suggestion, review_id: p.review_id ?? null,
      form_type: p.analysis?.form_type ?? null, mode: p.analysis?.mode ?? null, error: p.analysis?.error ?? null,
    };
  }

  summary() {
    return {
      since: this.state.since ? new Date(this.state.since).toISOString().slice(0, 19) : null,
      last_sync: this.state.last_sync,
      pending: this.state.pending.map((p) => this.brief(p)),
    };
  }

  /** One pulled file in full (page images, what was read), for the side-by-side review. */
  pendingDetail(token) {
    const p = this.state.pending.find((x) => x.token === token);
    if (!p) return null;
    return { ...this.brief(p), analysis: p.analysis };
  }

  pageImage(token, n) {
    if (!/^[0-9a-f]+$/.test(token)) return null;
    const f = path.join(this.stageDir, token, "renders", `p${n}.jpg`);
    return fs.existsSync(f) ? f : null;
  }

  // ------------------------------------------------------------------ pull
  async pull() {
    return this.exclusive(async () => {
      if (!this.state.since) {
        this.activate();
        return { first: true, items: [], errors: [] };
      }
      const started = Date.now();
      const errors = [];
      const fresh = [];
      const known = new Set(this.state.pending.map((p) => p.file_key));
      for (const [k, h] of Object.entries(this.state.handled)) if (!h?.path || !fs.existsSync(h.path)) delete this.state.handled[k];
      const folders = this.folders();
      for (const key of HAS.pull) {
        const dir = folders[key].pull;
        if (!dir) continue;
        let names;
        try {
          names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile() && /\.pdf$/i.test(d.name)).map((d) => d.name);
        } catch (e) {
          if (e.code !== "ENOENT") errors.push(`Couldn't read the ${folderName(key, "pull")} (${dir}): ${e.code || e.message}`);
          continue;
        }
        for (const name of names) {
          const src = path.join(dir, name);
          let st;
          try {
            st = fs.statSync(src);
          } catch {
            continue;
          }
          // "added" = written, created, or moved in (a move keeps the other two times but not ctime)
          if (Math.max(st.mtimeMs, st.birthtimeMs || 0, st.ctimeMs || 0) <= this.state.since) continue;
          const fileKey = `${norm(src)}|${st.size}|${Math.round(st.mtimeMs)}`;
          if (this.state.handled[fileKey] || known.has(fileKey)) continue;
          known.add(fileKey);
          const led = this.state.ledger[norm(src)];
          if (led && led.size === st.size && sha1File(src) === led.sha1) continue; // a copy closet pushed
          fresh.push({ key, src, name, size: st.size, fileKey });
        }
      }
      const items = await Promise.all(fresh.map((f) => this.stageFile(f).catch((e) => {
        errors.push(`Couldn't pull ${f.name}: ${e.message || e}`);
        return null;
      })));
      for (const it of items) if (it) this.state.pending.push(it);
      this.state.since = started;
      this.save();
      this.store.bump();
      return { first: false, items: this.state.pending.filter((p) => p.status === "unconfirmed").map((p) => this.brief(p)), errors };
    });
  }

  /** Copy a pulled file out of the shared folder (it may move before it's confirmed) and read it. */
  async stageFile({ key, src, name, size, fileKey }) {
    const token = randomBytes(6).toString("hex");
    const dir = path.join(this.stageDir, token);
    fs.mkdirSync(dir, { recursive: true });
    const staged = path.join(dir, name);
    fs.copyFileSync(src, staged);
    let analysis;
    try {
      analysis = await this.store.pool.analyze({
        file: staged, hint: null, renderDir: path.join(dir, "renders"), tol: Number(this.store.settings.position_tolerance_pt) || 10,
      });
    } catch (e) {
      analysis = { error: `Could not read PDF: ${e.message || e}`, page_count: 0 };
    }
    const item = {
      token, key, kind: key === "intake" ? "new" : "returned", filename: name, src, file_key: fileKey, size,
      sha1: sha1File(staged), staged, pulled_at: now(), status: "unconfirmed", analysis: slim(analysis),
    };
    item.candidates = this.candidates(item);
    item.suggestion = this.suggest(item);
    return item;
  }

  candidates(item) {
    const a = item.analysis || {};
    const mine = nameKey(item.filename);
    const out = [];
    for (const m of this.store.metas.values()) {
      if (m.missing || m.archived || !m.analysis) continue;
      const why = [];
      let score;
      if (m.sha1 && m.sha1 === item.sha1) {
        score = 1;
        why.push("identical to the copy closet has");
      } else {
        const ns = dice(mine, nameKey(m.filename));
        if (ns >= 0.999) why.push("same file name");
        else if (ns >= 0.6) why.push("similar file name");
        const cs = contentScore(a.slots, R.effectiveFields(m));
        why.push(...cs.why);
        score = cs.score === null ? ns * 0.9 : 0.45 * ns + 0.55 * cs.score;
        if (a.form_type && m.analysis.form_type && a.form_type !== m.analysis.form_type) {
          score *= 0.4;
          why.push(`it's an ${a.form_type === "F10" ? "F10" : "F174"}`);
        }
        const sent = this.state.sent[m.id];
        if (item.kind === "returned" && sent?.key === item.key) {
          score = Math.min(1, score + 0.15);
          why.push(`was sent for ${LABELS[item.key]}`);
        }
      }
      if (score >= 0.3) out.push({ id: m.id, filename: m.filename, score: Math.round(score * 100) / 100, why });
    }
    return out.sort((x, y) => y.score - x.score || x.filename.localeCompare(y.filename)).slice(0, 6);
  }

  /** The default choice in the confirm table. */
  suggest(item) {
    const [c1, c2] = item.candidates;
    if (c1 && c1.score >= 0.7 && (!c2 || c1.score - c2.score >= 0.1)) return { action: "replace", id: c1.id, review: false };
    if (c1 && c1.score >= 0.4) return { action: "replace", id: c1.id, review: true };
    return { action: "new", id: null, review: false };
  }

  /**
   * Settle pulled files: [{token, action: "replace"|"new"|"ignore", id, review}]. "replace" with
   * review:true parks it in Review for a side-by-side look instead of applying it now.
   */
  async resolve(decisions) {
    return this.exclusive(async () => {
      const out = { replaced: [], added: [], review: 0, ignored: 0, errors: [] };
      for (const d of decisions || []) {
        const p = this.state.pending.find((x) => x.token === d?.token);
        if (!p) continue;
        try {
          if (d.action === "replace") {
            if (!this.store.metas.has(d.id)) throw new Error("that form isn't in closet any more");
            if (d.review) {
              Object.assign(p, { status: "review", review_id: d.id });
              out.review++;
              continue;
            }
            this.store.replaceFile(d.id, p.staged, `Replaced by sync with ${p.filename} from the ${folderName(p.key, "pull")}`);
            out.replaced.push(d.id);
          } else if (d.action === "new") {
            out.added.push(...this.store.addFiles([p.staged]));
          } else if (d.action === "ignore") {
            out.ignored++;
          } else {
            throw new Error(`unknown choice "${d.action}"`);
          }
          this.finish(p);
        } catch (e) {
          out.errors.push(`${p.filename}: ${e.message || e}`);
        }
      }
      this.save();
      this.store.bump();
      return out;
    });
  }

  finish(p) {
    this.state.handled[p.file_key] = { path: p.src, at: now() };
    this.state.pending = this.state.pending.filter((x) => x !== p);
    fs.rmSync(path.join(this.stageDir, p.token), { recursive: true, force: true });
  }

  // ------------------------------------------------------------------ clear + push
  async push() {
    return this.exclusive(async () => {
      await this.store.whenIdle();
      const folders = this.folders();
      const report = { cleared: 0, pushed: {}, problems: [], leftovers: [], blocked: [], held: [], skipped: 0, packet: null, errors: [] };
      for (const key of HAS.push) if (folders[key].push) this.clear(folders[key].push, key, report);
      for (const [k, l] of Object.entries(this.state.ledger)) if (!fs.existsSync(l.path)) delete this.state.ledger[k];

      const held = new Set(this.state.pending.filter((p) => p.status === "review" && p.review_id).map((p) => p.review_id));
      const forms = this.store.snapshot().forms.filter((f) => !f.archived && !f.missing);
      const packet = [];
      await Promise.all(forms.map(async (f) => {
        if (!f.parsed || f.pending) return void report.skipped++;
        if (held.has(f.id)) return void report.held.push({ id: f.id, filename: f.filename });
        const step = await this.pushForm(f, folders, report);
        if (step === PACKET_STEP) packet.push(f);
      }));
      if (packet.length && this.store.settings.print_packet && folders[PACKET_STEP].push) {
        try {
          const pdf = await buildPacket(this.store, packet);
          const tmp = path.join(this.fixDir, PACKET_NAME);
          fs.mkdirSync(this.fixDir, { recursive: true });
          fs.writeFileSync(tmp, pdf.bytes);
          if (this.place(tmp, folders[PACKET_STEP].push, PACKET_NAME, null, PACKET_STEP, report)) report.packet = { forms: packet.length, pages: pdf.pages };
          fs.rmSync(tmp, { force: true });
        } catch (e) {
          report.errors.push(`Couldn't build the print packet: ${e.message || e}`);
        }
      }
      this.state.last_sync = now();
      this.save();
      this.store.bump();
      return report;
    });
  }

  /** Remove only what closet put in a send folder, unchanged since. Everything else stays. */
  clear(dir, key, report) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      if (e.code !== "ENOENT") report.errors.push(`Couldn't read the ${folderName(key, "push")} (${dir}): ${e.code || e.message}`);
      return;
    }
    for (const d of entries) {
      if (!d.isFile()) continue; // subfolders are never touched
      const file = path.join(dir, d.name);
      const led = this.state.ledger[norm(file)];
      if (!led) {
        if (/\.pdf$/i.test(d.name)) report.leftovers.push({ file, key, why: "closet didn't put it there" });
        continue;
      }
      let same = false;
      try {
        same = fs.statSync(file).size === led.size && sha1File(file) === led.sha1;
      } catch { /* vanished meanwhile */ }
      if (!same) {
        led.changed = true;
        report.leftovers.push({ file, key, why: "it was changed after closet put it there (signed in place?)" });
        continue;
      }
      try {
        fs.unlinkSync(file);
        delete this.state.ledger[norm(file)];
        report.cleared++;
      } catch (e) {
        report.leftovers.push({ file, key, why: `closet couldn't remove its old copy (${e.code === "EBUSY" || e.code === "EPERM" ? "open in another program?" : e.code || e.message})` });
      }
    }
  }

  /** Where the step's field is on this form (from the last read), for the signability check. */
  target(m, rec, step) {
    const ft = rec.form_type || m.analysis?.form_type;
    const key = (flagSlots(ft, this.store.settings)[step] || [])[0];
    const s = key && m.analysis?.slots?.[key];
    if (!s) return null;
    return { slot: key, label: s.label, page: s.page, rect: s.rect, kind: s.ftype === "Signature" ? "Signature" : "Text", fieldName: s.field_name || null };
  }

  async check(m, step, target, src) {
    const key = [m.sha1, step, target.page, target.rect.join(","), target.kind, 1].join("|");
    if (m.sign_check?.key === key) return m.sign_check.result;
    const result = await this.store.pool.run("inspect", { file: src, target });
    m.sign_check = { key, result };
    this.store.save(m);
    return result;
  }

  /**
   * Push one form to the send folder of its first open step. Returns the step it went to, or null.
   * `force` sends the PDF as it is even if the check fails (the person chose "send anyway").
   */
  async pushForm(f, folders, report, { force = false } = {}) {
    const step = firstOpenStep(f.record);
    const dir = folders[step]?.push;
    if (!dir) return null; // no folder for this step: that push just doesn't happen
    const m = this.store.metas.get(f.id);
    const src = this.store.pdfPath(f.id);
    if (!m || !src) return null;
    let from = src;
    let patched = null;
    if (step !== "complete" && !force) {
      const target = this.target(m, f.record, step);
      const problem = (check, fixError = null) => ({
        id: f.id, filename: f.filename, recipients: f.record.recipients || "", step, step_label: LABELS[step],
        slot: target?.label || "", page: target?.page ?? null, rect: target?.rect || null, kind: target?.kind || "Signature",
        size: (m.analysis?.renders || []).find((r) => r.page === target?.page) || null, parsed_at: m.parsed_at || "",
        issues: check.issues, fixable: check.fixable, blocked: check.blocked || null, fix_error: fixError,
      });
      if (!target) {
        report.problems.push(problem({ issues: [{ code: "no-slot", text: "closet doesn't know where this step's field is on this form", fixable: false }], fixable: false }));
        return null;
      }
      let check;
      try {
        check = await this.check(m, step, target, src);
      } catch (e) {
        check = { ok: false, issues: [{ code: "check-failed", text: `The check itself failed: ${e.message || e}`, fixable: false }], fixable: false };
      }
      if (!check.ok) {
        const fix = m.sync_fix?.[step];
        if (!(fix && fix.sha1 === m.sha1 && check.fixable)) {
          report.problems.push(problem(check));
          return null;
        }
        patched = path.join(this.fixDir, `${m.id}-${step}.pdf`);
        fs.mkdirSync(this.fixDir, { recursive: true });
        try {
          await this.store.pool.run("addField", { file: src, target, label: LABELS[step], out: patched });
        } catch (e) {
          report.problems.push(problem({ ...check, fixable: false }, e.message || String(e)));
          return null;
        }
        from = patched;
      }
    }
    const ok = this.place(from, dir, f.filename, f.id, step, report);
    if (patched) fs.rmSync(patched, { force: true });
    return ok ? step : null;
  }

  place(src, dir, filename, id, key, report) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const dest = path.join(dir, filename);
      if (fs.existsSync(dest)) {
        // something closet didn't clear (already reported as a leftover): never overwrite it
        report.blocked.push({ id, filename, key, file: dest });
        return false;
      }
      fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
      const st = fs.statSync(dest);
      this.state.ledger[norm(dest)] = { path: dest, sha1: sha1File(dest), size: st.size, id, key, at: now() };
      if (id) this.state.sent[id] = { key, filename, at: now() };
      report.pushed[key] = (report.pushed[key] || 0) + 1;
      return true;
    } catch (e) {
      report.errors.push(`Couldn't copy ${filename} to the ${folderName(key, "push")}: ${e.code || e.message}`);
      return false;
    }
  }

  /**
   * Settle a form that failed the check. "signed": record the step as done by hand (the signature is
   * there, just not as a field) and push it on to its next step. "add-field": from now on its copies
   * get a fresh field on top for this step (until the PDF changes). "as-is": send it unchanged, once.
   */
  async fix(id, step, action) {
    return this.exclusive(async () => {
      const m = this.store.metas.get(id);
      if (!m) throw new Error("No such form");
      if (!STAGES.includes(step)) throw new Error("No such step");
      if (action === "signed") {
        this.store.updateForm(id, { overrides: { [step]: true } });
      } else if (action === "add-field") {
        m.sync_fix = { ...(m.sync_fix || {}), [step]: { sha1: m.sha1, at: now() } };
        m.history = [...(m.history || []), { at: now(), what: `Sync: a new ${LABELS[step]} field will be added on top of its copies` }].slice(-60);
        this.store.save(m);
      } else if (action !== "as-is") {
        throw new Error(`Unknown choice "${action}"`);
      }
      const report = { cleared: 0, pushed: {}, problems: [], leftovers: [], blocked: [], held: [], skipped: 0, packet: null, errors: [] };
      const f = this.store.snapshot().forms.find((x) => x.id === id);
      await this.pushForm(f, this.folders(), report, { force: action === "as-is" });
      this.save();
      this.store.bump();
      return report;
    });
  }
}
