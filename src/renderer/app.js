/* closet — frontend (no build step). */
"use strict";

// ------------------------------------------------------------------ constants
const FLAGS = [
  ["sqccf_processed", "SQ/CCF", "Processed by SQ/CCF"],
  ["cadet_sqcc_signed", "Cadet SQ/CC", "Signed by Cadet SQ/CC"],
  ["recipient_signed", "Recipient", "Signed by recipient"],
  ["aoc_signed", "AOC/AMT", "Signed by AOC/AMT"],
];
const REC_FIELDS = [
  ["recipients", "Recipient(s)", "wide", "Separate several people with commas; each gets their own sheet row"],
  ["date", "Date", "", "YYYY-MM-DD"],
  ["class_year", "Class year", "", "e.g. 2028 (one per recipient, same order)"],
  ["form_type", "Form type", "select:F10,F174", ""],
  ["pos_neg", "Pos / Neg", "select:Pos,Neg", ""],
  ["reason_category", "Reason category", "", "The F10 has no reason box; type one"],
  ["issuer", "Issuer", "", ""],
  ["reason_details", "Reason details", "wide textarea", ""],
  ["cdna", "CDNA", "", "Not on the form; type it in"],
  ["passes", "Passes", "", "Not on the form; type it in"],
  ["demerits", "Demerits", "", "Blank on the form = 0"],
  ["tours", "Tours", "", "Blank on the form = 0"],
  ["confinements", "Confinements", "", "Blank on the form = 0"],
  ["squadron", "Squadron", "", ""],
  ["other", "Other", "wide", "Loss of pass, POV, etc."],
];
const MODE_LABEL = { fields: "Fillable fields", text: "Flattened text", raster: "Scanned image" };
const SRC_LABEL = { field: "form field", text: "page text", ink: "handwriting", digital: "digital sig", annotation: "ink markup", edited: "edited" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const I = {
  overview: '<path d="M3 13h8V3H3zm10 8h8V11h-8zM3 21h8v-6H3zm10-18v6h8V3z"/>',
  paperwork: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
  review: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  cadets: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  export: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
  settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  ext: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  inbox0: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>',
  chev: '<path d="m9 18 6-6-6-6"/>',
  archive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
};
const icon = (n, cls = "") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n]}</svg>`;

// ------------------------------------------------------------------ state
const S = {
  data: null,
  version: -1,
  view: "overview",
  f: { q: "", type: "all", pn: "all", status: "all" },
  sort: { key: "date", dir: -1 },
  cadetQ: "",
  cadetOpen: null,
  exportMode: "unlogged",
  exportPicked: new Set(),
  detail: null,      // full detail of the open form
  host: null,        // "drawer" | "review"
  edit: null,        // pending edits for the open form
  page: 0,
  tab: "record",
  boxes: true,
  reviewId: null,
  stale: false,
};

const blankEdit = () => ({ overrides: {}, fields: {}, notes: undefined, logged: undefined });

// ------------------------------------------------------------------ utils
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const plural = (n, w, p) => `${n} ${n === 1 ? w : (p || w + "s")}`;
const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const cdnaApplies = (ft, pn) => ft === "F10" && pn === "Pos"; // CDNA + Passes: typed by hand, positive F10s only
// Ranks aren't part of a name (mirrors records.strip_rank on the server)
const stripRank = (n) => {
  const out = [];
  let skip = false;
  for (const tok of String(n || "").trim().split(/\s+/)) {
    const bare = tok.replace(/^[,.]+|[,.]+$/g, "");
    if (skip && /^(lt|col|gen|sgt|capt|maj)$/i.test(bare)) { skip = false; continue; }
    skip = false;
    if (/^(c[1-4]c|cadet)$/i.test(bare)) continue;
    if (/^c\//i.test(bare)) { skip = true; continue; }
    out.push(tok);
  }
  return out.join(" ").replace(/^[\s,]+|[\s,]+$/g, "");
};
const colIdx = (name) => (S.data?.columns || []).indexOf(name);
const nameKey = (n) => stripRank(n).toLowerCase().split(/[^a-z]+/).filter((t) => t.length > 1).sort().join(" ");

// All data calls go to the app's main process (same REST-style paths as ever, over IPC).
// `closet` is the bridge the preload script exposes as a global.
async function api(path, opts = {}) {
  return closet.api(opts.method || "GET", path, opts.body);
}

function toast(msg, err = false) {
  const t = document.createElement("div");
  t.className = "toast" + (err ? " err" : "");
  t.innerHTML = icon(err ? "alert" : "check") + `<span>${esc(msg)}</span>`;
  $("#toasts").appendChild(t);
  setTimeout(() => { t.style.transition = "opacity .3s"; t.style.opacity = 0; setTimeout(() => t.remove(), 300); }, 2600);
}

// ------------------------------------------------------------------ in-app dialogs
// Electron has no window.prompt(), and confirm() is a blocking native box, so questions are asked
// in the page. Resolves with the chosen value, the typed text, or null when dismissed (Esc).
function ask({ title, message = "", input = null, choices = null, danger = false }) {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const scrim = document.createElement("div");
    scrim.className = "modal-scrim";
    const btns = choices || [{ label: "Cancel", value: null }, { label: "OK", value: true, primary: true }];
    scrim.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="mTitle">
      <h2 id="mTitle">${esc(title)}</h2>${message ? `<div class="modal-msg">${message}</div>` : ""}
      ${input ? `<input class="input" id="mInput" value="${esc(input.value || "")}" placeholder="${esc(input.placeholder || "")}" autocomplete="off" spellcheck="false"><div class="modal-err" id="mErr" role="alert"></div>` : ""}
      <div class="modal-actions">${btns.map((b, i) => `<button type="button" class="btn ${b.primary ? (danger ? "danger" : "primary") : "ghost"}" data-i="${i}">${esc(b.label)}</button>`).join("")}</div></div>`;
    document.body.appendChild(scrim);
    const field = $("#mInput", scrim);
    const done = (v) => {
      scrim.remove();
      document.removeEventListener("keydown", onKey, true);
      prev?.focus?.();
      resolve(v);
    };
    const pick = (b) => {
      if (b.value === null) return done(null);
      if (!input) return done(b.value);
      const text = field.value.trim();
      const err = input.validate ? input.validate(text) : "";
      if (err) { $("#mErr", scrim).textContent = err; field.focus(); field.select(); return; }
      done(text);
    };
    const primary = btns.find((b) => b.primary) || btns[btns.length - 1];
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(null); }
      if (e.key === "Enter" && (field ? document.activeElement === field : true)) { e.preventDefault(); e.stopPropagation(); pick(primary); }
    };
    document.addEventListener("keydown", onKey, true);
    $$("[data-i]", scrim).forEach((b) => (b.onclick = () => pick(btns[+b.dataset.i])));
    requestAnimationFrame(() => (field || $$(".modal-actions .btn", scrim).at(-1)).focus());
  });
}
const modalOpen = () => Boolean($(".modal-scrim"));
async function okToDiscard(what = "the open form") {
  if (!isDirty()) return true;
  return Boolean(await ask({
    title: "Discard unsaved changes?", message: `You have changes to ${what} that haven't been saved.`,
    choices: [{ label: "Keep editing", value: null }, { label: "Discard", value: true, primary: true }], danger: true,
  }));
}

async function copyText(text) {
  await closet.copy(text); // native clipboard: works even when the window isn't focused
}

function fmtDate(iso, raw) {
  if (!iso) return raw ? esc(raw) : '<span class="dim">No date</span>';
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${String(y).slice(2)}`;
}
function fmtStamp(s) {
  if (!s) return "";
  const d = new Date(s);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ------------------------------------------------------------------ derived data
// Archived forms keep their file and metadata but drop out of every count, chart, queue and export.
const active = () => (S.data?.forms || []).filter((f) => !f.missing && !f.archived);
const archived = () => (S.data?.forms || []).filter((f) => f.archived);
const isIncomplete = (f) => (f.incomplete || []).length > 0;
const inQueue = (f) => f.needs_review || isIncomplete(f);
const parsed = () => active().filter((f) => f.parsed);

function flagState(rec, key) {
  const v = rec?.[key];
  return v === true ? "done" : v === false ? "todo" : "na";
}
function awaiting(f) {
  return f.parsed && FLAGS.some(([k]) => f.record[k] === false);
}
function missingFlags(f) {
  return FLAGS.filter(([k]) => f.record[k] === false).map(([, s]) => s);
}
function routeMini(rec) {
  let h = '<span class="route" aria-label="Routing">';
  FLAGS.forEach(([k, short, long], i) => {
    const st = flagState(rec, k);
    if (i) h += `<span class="wire ${st === "done" && flagState(rec, FLAGS[i - 1][0]) === "done" ? "done" : ""}"></span>`;
    h += `<span class="stop ${st === "done" ? "done" : st === "na" ? "na" : ""}" title="${esc(long)}: ${st === "done" ? "yes" : st === "na" ? "not on this form – set by hand" : "not yet"}"></span>`;
  });
  return h + "</span>";
}
function pnChip(pn) {
  if (pn === "Pos") return '<span class="chip pos"><span class="dot"></span>Positive</span>';
  if (pn === "Neg") return '<span class="chip neg"><span class="dot"></span>Negative</span>';
  return '<span class="chip muted">Pos/Neg?</span>';
}
function whoLine(rec, fallback) {
  const list = rec.recipient_list || [];
  if (!list.length) return `<span class="dim">${esc(fallback)}</span>`;
  if (list.length === 1) return esc(list[0]);
  return `${esc(list[0])} <span class="more">+${list.length - 1}</span>`;
}

// ------------------------------------------------------------------ boot / polling
async function load() {
  try {
    S.data = await api("/api/state");
    S.version = S.data.version;
  } catch (e) {
    $("#main").innerHTML = `<div class="banner">${icon("alert")}<span>closet couldn't load its data: ${esc(e.message)}</span></div>`;
    return;
  }
  renderNav();
  renderFoot(S.data.status);
  const editing = document.activeElement && $("#main").contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (editing) S.stale = true;
  else renderView();
  if (S.detail && S.host === "drawer" && !isDirty()) openForm(S.detail.id, { keepPage: true, silent: true });
  checkNamePairs();
}

// Two recipient names within two characters of each other are probably one cadet with a typo.
// Ask once per pair; the answer is saved, so the same pair never comes up again.
let namesBusy = false;
const namesSkipped = new Set();
async function checkNamePairs() {
  if (namesBusy || document.visibilityState !== "visible") return;
  const pairs = (S.data?.name_pairs || []).filter((x) => !namesSkipped.has(x.a + "|" + x.b));
  if (!pairs.length) return;
  namesBusy = true;
  let changed = false;
  try {
    for (const { a, b, a_forms, b_forms } of pairs) {
      const same = await ask({
        title: "Possible typo: are these the same person?",
        message: `<div class="namepair"><div><b>${esc(a)}</b><span>${plural(a_forms, "form")}</span></div><div><b>${esc(b)}</b><span>${plural(b_forms, "form")}</span></div></div>
          <p>The names are within two letters of each other. If one is a misspelling, they'll be merged under the spelling you choose.</p>`,
        choices: [{ label: "Decide later", value: null }, { label: "Different people", value: "no" }, { label: "Same person", value: "yes", primary: true }],
      });
      if (same === null) { namesSkipped.add(a + "|" + b); continue; }
      if (same === "yes") {
        const guess = a_forms !== b_forms ? (a_forms > b_forms ? a : b) : (a.length >= b.length ? a : b);
        const correct = await ask({
          title: "What's the correct spelling?", message: "It will be used on every form for this cadet.",
          input: { value: guess, validate: (t) => (t ? "" : "Enter the cadet's name.") },
          choices: [{ label: "Cancel", value: null }, { label: "Use this spelling", value: true, primary: true }],
        });
        if (correct === null) { namesSkipped.add(a + "|" + b); continue; }
        await api("/api/names/resolve", { method: "POST", body: { a, b, same: true, correct: correct.trim() } });
        toast(`Using “${correct.trim()}” for both spellings`);
      } else {
        await api("/api/names/resolve", { method: "POST", body: { a, b, same: false } });
      }
      changed = true;
      // one decision can settle others (e.g. three spellings of one name), so re-check from fresh data
      break;
    }
  } catch (e) {
    toast("Couldn't save the name decision: " + e.message, true);
  } finally {
    namesBusy = false;
  }
  if (changed) await load();
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkNamePairs(); });

// The app pushes a notice whenever anything changes (new PDF, a form finished reading, an edit),
// so there's no polling. Bursts of notices are coalesced into one reload.
let reloadQueued = false;
let reloading = false;
async function reloadSoon() {
  if (reloading) { reloadQueued = true; return; }
  reloading = true;
  try { await load(); } finally {
    reloading = false;
    if (reloadQueued) { reloadQueued = false; reloadSoon(); }
  }
}
closet.onChanged((v) => {
  if (v === -1) { closeDetail(); S.reviewId = null; } // switched to another dump folder
  if (v !== S.version) reloadSoon();
});
document.addEventListener("focusout", () => setTimeout(() => {
  if (S.stale && !($("#main").contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) {
    S.stale = false;
    renderView();
  }
}, 50));

// ------------------------------------------------------------------ chrome
function renderNav() {
  const review = active().filter(inQueue).length;
  const unlogged = parsed().filter((f) => !f.logged).length;
  const items = [
    ["overview", "Overview", ""],
    ["paperwork", "Paperwork", active().length],
    ["review", "Review", review, review > 0],
    ["cadets", "Cadets", ""],
    ["export", "Sheet export", unlogged],
    ["archive", "Archive", archived().length || ""],
    ["settings", "Settings", ""],
  ];
  $("#nav").innerHTML = items.map(([k, label, count, hot]) =>
    `<a href="#/${k}" ${S.view === k ? 'aria-current="page"' : ""}>${icon(k)}<span class="lbl">${label}</span>${count !== "" && count !== undefined ? `<span class="count ${hot ? "hot" : ""}">${count}</span>` : ""}</a>`).join("");
}

function renderFoot(st) {
  if (!st) return;
  const busy = st.state === "parsing" || st.queued > 0;
  $("#railFoot").innerHTML = `
    <div class="row"><span class="pulse ${busy ? "busy" : ""}"></span>
      <span>${busy ? `Reading ${Math.min(st.done + 1, st.total || 1)} of ${Math.max(st.total, st.done + 1)}…` : "Watching the dump folder"}</span></div>
    ${busy && st.current ? `<div class="row" style="color:var(--faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(st.current)}</div>` : ""}
    <div class="row"><button type="button" id="rescan" title="Check the dump folder for changes now">Rescan</button><button type="button" id="openDump" title="Open the dump folder">Open folder</button></div>`;
  $("#rescan").onclick = async () => { await api("/api/scan", { method: "POST" }); toast("Dump folder rescanned"); reloadSoon(); };
  $("#openDump").onclick = () => closet.openFolder("dump");
}

async function route() {
  const h = location.hash.replace(/^#\/?/, "");
  const [view, q] = h.split("?");
  const valid = ["overview", "paperwork", "review", "cadets", "export", "archive", "settings"];
  S.view = valid.includes(view) ? view : "overview";
  if (S.host === "review" && S.view !== "review") closeDetail();
  if (S.host === "drawer" && !(q || "").includes("f=")) {
    if (!(await okToDiscard())) return;
    closeDetail();
  }
  renderNav();
  renderView();
  const params = new URLSearchParams(q || "");
  if (params.get("f")) openForm(params.get("f"));
}
window.addEventListener("hashchange", route);

function renderView() {
  if (!S.data) return;
  const views = { overview: viewOverview, paperwork: viewPaperwork, review: viewReview, cadets: viewCadets, export: viewExport, archive: viewArchive, settings: viewSettings };
  views[S.view]();
}

function head(title, sub, right = "") {
  return `<header class="page-head"><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ""}</div><div class="spacer"></div>${right}</header>`;
}
function banners() {
  let h = "";
  if (S.data.template_error) h += `<div class="banner">${icon("alert")}<span>${esc(S.data.template_error)}. Forms can't be read until both blank templates are back in the dump folder.</span></div>`;
  return h;
}

// ------------------------------------------------------------------ overview
function viewOverview() {
  const forms = parsed();
  const all = active();
  const neg = forms.filter((f) => f.record.pos_neg === "Neg").length;
  const pos = forms.filter((f) => f.record.pos_neg === "Pos").length;
  const waiting = forms.filter(awaiting);
  const review = all.filter(inQueue).length;
  const unlogged = forms.filter((f) => !f.logged);
  const rows = forms.flatMap((f) => f.rows);
  const tours = rows.reduce((a, r) => a + num(r[colIdx("Tours")]), 0);
  const conf = rows.reduce((a, r) => a + num(r[colIdx("Confinements")]), 0);
  const dem = rows.reduce((a, r) => a + num(r[colIdx("Demerits")]), 0);
  const tot = Math.max(1, neg + pos);

  if (!all.length) {
    $("#main").innerHTML = head("Overview") + banners() + `
      <div class="panel"><div class="empty">${icon("folder")}<h3>No paperwork yet</h3>
      <p>Drag paperwork PDFs onto this window, or put them in <b>${esc(S.data.dump_dir)}</b>. Name them like <b>John Doe_Neg_F10_Uniform Violation.pdf</b>.</p>
      <div style="display:flex;gap:10px;justify-content:center;margin-top:18px">
        <button class="btn primary" type="button" id="emptyOpen">${icon("folder")}Open dump folder</button>
        <button class="btn" type="button" id="emptyChoose">Use a different folder</button></div></div></div>`;
    $("#emptyOpen").onclick = () => closet.openFolder("dump");
    $("#emptyChoose").onclick = chooseDump;
    return;
  }

  $("#main").innerHTML = head("Overview", `${plural(all.length, "form")} in the dump folder, issued to ${plural(new Set(rows.map((r) => nameKey(r[6]))).size, "cadet")}.`) + banners() + `
    <section class="kpis">
      <a class="kpi" href="#/paperwork"><div class="v">${forms.length}</div><div class="l">${neg} negative, ${pos} positive</div>
        <div class="split" aria-hidden="true"><span style="width:${(neg / tot) * 100}%;background:var(--neg)"></span><span style="width:${(pos / tot) * 100}%;background:var(--pos)"></span></div></a>
      <a class="kpi accent" href="#/paperwork" data-status="awaiting"><div class="v">${waiting.length}</div><div class="l">Awaiting a signature</div></a>
      <a class="kpi" href="#/review"><div class="v" style="${review ? "color:var(--crit)" : ""}">${review}</div><div class="l">Need review or are incomplete</div></a>
      <a class="kpi" href="#/export"><div class="v">${unlogged.length}</div><div class="l">Not in the tracker yet</div></a>
      <div class="kpi"><div class="v">${tours}</div><div class="l">Tours issued, plus ${conf} confinements and ${dem} demerits</div></div>
    </section>
    <div class="grid-2">
      <section class="panel"><div class="panel-head"><h2>Paperwork by month</h2><span class="spacer"></span>
        <div class="legend"><span><i style="background:var(--neg)"></i>Negative</span><span><i style="background:var(--pos)"></i>Positive</span></div></div>
        <div class="panel-body"><div class="chart" id="monthChart"></div></div></section>
      <section class="panel"><div class="panel-head"><h2>Routing</h2><span class="sub">forms where each step is done</span></div>
        <div class="panel-body">${FLAGS.map(([k, , long]) => {
          const app = forms.filter((f) => f.record[k] !== null && f.record[k] !== undefined);
          const done = app.filter((f) => f.record[k] === true).length;
          const pct = app.length ? (done / app.length) * 100 : 0;
          return `<div class="stage"><div class="name">${long}</div><div class="bar"><span style="width:${pct}%"></span></div><div class="num"><b>${done}</b> / ${app.length}</div></div>`;
        }).join("")}</div></section>
    </div>
    <div class="grid-2b">
      <section class="panel"><div class="panel-head"><h2>Waiting on signatures</h2><span class="sub">${plural(waiting.length, "form")}</span></div>
        <div class="panel-body"><div class="mini-list">${waiting.slice(0, 7).map((f) => `
          <button type="button" data-open="${f.id}"><span class="t">${whoLine(f.record, f.filename)}</span>
          <span class="s">Needs ${esc(missingFlags(f).join(", "))}</span><span class="r">${routeMini(f.record)}</span></button>`).join("") ||
          '<p style="color:var(--muted);margin:0">Everything that can be signed is signed.</p>'}</div></div></section>
      <section class="panel"><div class="panel-head"><h2>Top reasons</h2></div>
        <div class="panel-body" id="reasons"></div></section>
    </div>`;
  drawMonthChart($("#monthChart"), forms);
  drawReasons($("#reasons"), forms);
  $$("[data-open]").forEach((b) => (b.onclick = () => openForm(b.dataset.open)));
  $$('[data-status="awaiting"]').forEach((a) => (a.onclick = () => { S.f.status = "awaiting"; }));
}

function drawMonthChart(el, forms) {
  const byMonth = new Map();
  forms.forEach((f) => {
    const iso = f.record.date_iso;
    if (!iso) return;
    const k = iso.slice(0, 7);
    const b = byMonth.get(k) || { Neg: 0, Pos: 0 };
    if (f.record.pos_neg === "Pos") b.Pos++; else b.Neg++;
    byMonth.set(k, b);
  });
  if (!byMonth.size) { el.innerHTML = '<p style="color:var(--muted);margin:0">No dated paperwork yet.</p>'; return; }
  const keys = [...byMonth.keys()].sort();
  // continuous month range, last 12
  const [y0, m0] = keys[0].split("-").map(Number);
  const [y1, m1] = keys[keys.length - 1].split("-").map(Number);
  let months = [];
  for (let y = y0, m = m0; y < y1 || (y === y1 && m <= m1); m === 12 ? (y++, m = 1) : m++) months.push(`${y}-${String(m).padStart(2, "0")}`);
  months = months.slice(-12);
  while (months.length < 6) {
    const [y, m] = months[0].split("-").map(Number);
    months.unshift(m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`);
  }
  const W = 640, H = 220, pl = 28, pb = 26, pt = 8;
  const max = Math.max(1, ...months.map((k) => { const b = byMonth.get(k); return b ? b.Neg + b.Pos : 0; }));
  const step = max <= 4 ? 1 : max <= 10 ? 2 : Math.ceil(max / 5);
  const top = Math.ceil(max / step) * step;
  const y = (v) => pt + (H - pt - pb) * (1 - v / top);
  const bw = (W - pl) / months.length;
  const barW = Math.min(34, bw * 0.56);
  let g = '<g class="grid">';
  for (let v = 0; v <= top; v += step) g += `<line x1="${pl}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/>`;
  g += '</g><g class="axis">';
  for (let v = 0; v <= top; v += step) g += `<text x="${pl - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  months.forEach((k, i) => {
    const [yy, mm] = k.split("-").map(Number);
    g += `<text x="${pl + bw * i + bw / 2}" y="${H - 6}" text-anchor="middle">${MONTHS[mm - 1]}${mm === 1 || i === 0 ? ` ’${String(yy).slice(2)}` : ""}</text>`;
  });
  g += "</g>";
  let bars = "";
  const rr = (x, yt, w, h, r) => h <= 0 ? "" : `M${x},${yt + h}V${yt + Math.min(r, h)}Q${x},${yt} ${x + Math.min(r, w / 2)},${yt}H${x + w - Math.min(r, w / 2)}Q${x + w},${yt} ${x + w},${yt + Math.min(r, h)}V${yt + h}Z`;
  months.forEach((k, i) => {
    const b = byMonth.get(k) || { Neg: 0, Pos: 0 };
    const x = pl + bw * i + (bw - barW) / 2;
    const yNeg = y(b.Neg);
    const hNeg = y(0) - yNeg;
    const yPos = y(b.Neg + b.Pos);
    const hPos = yNeg - yPos - (b.Neg && b.Pos ? 2 : 0);
    if (b.Neg) bars += `<path d="${b.Pos ? `M${x},${yNeg}h${barW}v${hNeg}h${-barW}Z` : rr(x, yNeg, barW, hNeg, 4)}" fill="var(--neg)"/>`;
    if (b.Pos) bars += `<path d="${rr(x, yPos, barW, hPos, 4)}" fill="var(--pos)"/>`;
    bars += `<rect class="hit" x="${pl + bw * i}" y="${pt}" width="${bw}" height="${H - pt - pb}" data-k="${k}" data-neg="${b.Neg}" data-pos="${b.Pos}"/>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Paperwork per month, negative and positive">${g}${bars}</svg>`;
  const tip = getTip();
  $$(".hit", el).forEach((r) => {
    r.addEventListener("mousemove", (e) => {
      const [yy, mm] = r.dataset.k.split("-").map(Number);
      tip.innerHTML = `<b>${MONTHS[mm - 1]} ${yy}</b><div class="r"><i style="background:var(--neg)"></i>Negative<em>${r.dataset.neg}</em></div><div class="r"><i style="background:var(--pos)"></i>Positive<em>${r.dataset.pos}</em></div>`;
      placeTip(tip, e);
    });
    r.addEventListener("mouseleave", () => tip.classList.remove("on"));
  });
}
function getTip() {
  let t = $("#tip");
  if (!t) { t = document.createElement("div"); t.id = "tip"; t.className = "tip"; document.body.appendChild(t); }
  return t;
}
function placeTip(t, e) {
  t.classList.add("on");
  const r = t.getBoundingClientRect();
  let x = e.clientX + 14, y = e.clientY - r.height - 10;
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
  if (y < 8) y = e.clientY + 16;
  t.style.left = x + "px";
  t.style.top = y + "px";
}

function drawReasons(el, forms) {
  const m = new Map();
  forms.forEach((f) => {
    const k = (f.record.reason_category || "Unspecified").trim();
    const b = m.get(k) || { Neg: 0, Pos: 0 };
    f.record.pos_neg === "Pos" ? b.Pos++ : b.Neg++;
    m.set(k, b);
  });
  const list = [...m.entries()].sort((a, b) => b[1].Neg + b[1].Pos - (a[1].Neg + a[1].Pos)).slice(0, 7);
  if (!list.length) { el.innerHTML = '<p style="color:var(--muted);margin:0">No reasons yet.</p>'; return; }
  const max = Math.max(...list.map(([, b]) => b.Neg + b.Pos));
  el.innerHTML = list.map(([k, b]) => `
    <div class="hbar" data-tipk="${esc(k)}" data-neg="${b.Neg}" data-pos="${b.Pos}"><span class="name" title="${esc(k)}">${esc(k)}</span>
      <span class="track">${b.Neg ? `<span style="width:${(b.Neg / max) * 100}%;background:var(--neg)"></span>` : ""}${b.Pos ? `<span style="width:${(b.Pos / max) * 100}%;background:var(--pos)"></span>` : ""}</span>
      <span class="n">${b.Neg + b.Pos}</span></div>`).join("");
  const tip = getTip();
  $$(".hbar", el).forEach((r) => {
    r.addEventListener("mousemove", (e) => {
      tip.innerHTML = `<b>${esc(r.dataset.tipk)}</b><div class="r"><i style="background:var(--neg)"></i>Negative<em>${r.dataset.neg}</em></div><div class="r"><i style="background:var(--pos)"></i>Positive<em>${r.dataset.pos}</em></div>`;
      placeTip(tip, e);
    });
    r.addEventListener("mouseleave", () => tip.classList.remove("on"));
  });
}

// ------------------------------------------------------------------ paperwork list
function viewPaperwork() {
  const seg = (name, opts) => `<div class="seg" role="group">${opts.map(([v, l]) => `<button type="button" data-seg="${name}" data-v="${v}" aria-pressed="${S.f[name] === v}">${l}</button>`).join("")}</div>`;
  $("#main").innerHTML = head("Paperwork", "Every form in the dump folder. Click one to see what was detected, fix anything, or record a new signature.") + banners() + `
    <div class="toolbar">
      <label class="search">${icon("search")}<input class="input" id="q" type="search" placeholder="Search names, reasons, issuers, files" value="${esc(S.f.q)}" aria-label="Search paperwork"></label>
      ${seg("type", [["all", "All forms"], ["F10", "F10"], ["F174", "F174"]])}
      ${seg("pn", [["all", "Both"], ["Neg", "Negative"], ["Pos", "Positive"]])}
      <select class="select" id="status" style="width:auto" aria-label="Status filter">
        ${[["all", "Any status"], ["awaiting", "Awaiting a signature"], ["complete", "Fully routed"], ["review", "Needs review"], ["incomplete", "Missing CDNA/Passes"], ["unlogged", "Not in the tracker"], ["logged", "In the tracker"]]
          .map(([v, l]) => `<option value="${v}" ${S.f.status === v ? "selected" : ""}>${l}</option>`).join("")}
      </select>
      <span class="spacer"></span><span id="countLbl" style="color:var(--muted);font-size:13px"></span>
    </div>
    <div id="results"></div>`;
  $("#q").oninput = (e) => { S.f.q = e.target.value; renderPaperRows(); };
  $("#status").onchange = (e) => { S.f.status = e.target.value; renderPaperRows(); };
  $$("[data-seg]").forEach((b) => (b.onclick = () => {
    S.f[b.dataset.seg] = b.dataset.v;
    $$(`[data-seg="${b.dataset.seg}"]`).forEach((x) => x.setAttribute("aria-pressed", x === b));
    renderPaperRows();
  }));
  renderPaperRows();
}

function filteredForms() {
  const q = S.f.q.trim().toLowerCase();
  let list = (S.data.forms || []).filter((f) => {
    if (f.archived) return false;
    const r = f.record || {};
    if (S.f.type !== "all" && r.form_type !== S.f.type) return false;
    if (S.f.pn !== "all" && r.pos_neg !== S.f.pn) return false;
    const st = S.f.status;
    if (st === "awaiting" && !awaiting(f)) return false;
    if (st === "complete" && (!f.parsed || awaiting(f))) return false;
    if (st === "review" && !f.needs_review) return false;
    if (st === "incomplete" && !isIncomplete(f)) return false;
    if (st === "unlogged" && (f.logged || !f.parsed)) return false;
    if (st === "logged" && !f.logged) return false;
    if (q) {
      const hay = [f.filename, r.recipients, r.reason_category, r.reason_details, r.issuer, r.class_year, f.notes].join(" ").toLowerCase();
      if (!q.split(/\s+/).every((t) => hay.includes(t))) return false;
    }
    return true;
  });
  const { key, dir } = S.sort;
  const val = (f) => key === "date" ? (f.record.date_iso || "") : key === "who" ? (f.record.recipients || f.filename).toLowerCase()
    : key === "type" ? (f.record.form_type || "") : key === "issuer" ? (f.record.issuer || "").toLowerCase() : "";
  list.sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * dir || a.filename.localeCompare(b.filename));
  return list;
}

function renderPaperRows() {
  const list = filteredForms();
  $("#countLbl").textContent = plural(list.length, "form");
  const th = (k, l) => `<th class="sortable" data-sort="${k}" aria-sort="${S.sort.key === k ? (S.sort.dir > 0 ? "ascending" : "descending") : "none"}">${l}${S.sort.key === k ? `<span class="arr">${S.sort.dir > 0 ? "↑" : "↓"}</span>` : ""}</th>`;
  if (!list.length) {
    $("#results").innerHTML = `<div class="panel"><div class="empty">${icon("search")}<h3>No paperwork matches</h3><p>Clear the search or pick a different filter.</p></div></div>`;
    return;
  }
  $("#results").innerHTML = `<div class="table-wrap"><table class="t"><thead><tr>
    ${th("date", "Date")}${th("who", "Recipient")}${th("type", "Form")}<th>Pos/Neg</th>${th("issuer", "Issuer")}<th>Routing</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
    ${list.map((f) => {
      const r = f.record || {};
      let status = [];
      if (f.missing) status.push('<span class="chip crit">File missing</span>');
      if (!f.parsed) status.push('<span class="chip muted">Reading…</span>');
      if (f.needs_review) status.push('<span class="chip crit">Needs review</span>');
      if (isIncomplete(f)) status.push(`<span class="chip warn" title="Positive F10 missing ${esc(f.incomplete.join(" and "))}">Incomplete</span>`);
      if (f.logged) status.push(`<span class="logged" title="Logged ${esc(fmtStamp(f.logged_at))}">${icon("check")}In tracker</span>`);
      return `<tr class="click" data-open="${f.id}" tabindex="0">
        <td class="nowrap">${f.parsed ? fmtDate(r.date_iso, r.date) : ""}</td>
        <td><div class="who">${whoLine(r, f.filename)}</div><div class="sub">${esc(r.reason_category || f.filename)}</div></td>
        <td>${r.form_type ? `<span class="chip type">${esc(r.form_type)}</span>` : ""}</td>
        <td>${f.parsed ? pnChip(r.pos_neg) : ""}</td>
        <td><div class="sub" style="color:var(--text-2)">${esc(r.issuer || "")}</div></td>
        <td>${f.parsed ? routeMini(r) : ""}</td>
        <td><div class="status-cell">${status.join("")}</div></td>
        <td class="nowrap" style="text-align:right"><button class="icon-btn" type="button" data-archive="${f.id}" title="Archive: keep the file and record, leave it out of stats and exports" aria-label="Archive ${esc(f.filename)}">${icon("archive")}</button></td></tr>`;
    }).join("")}</tbody></table></div>`;
  $$("[data-sort]").forEach((t) => (t.onclick = () => {
    S.sort = { key: t.dataset.sort, dir: S.sort.key === t.dataset.sort ? -S.sort.dir : t.dataset.sort === "date" ? -1 : 1 };
    renderPaperRows();
  }));
  $$("[data-archive]").forEach((b) => (b.onclick = async (e) => {
    e.stopPropagation();
    const f = (S.data.forms || []).find((x) => x.id === b.dataset.archive);
    await api(`/api/forms/${b.dataset.archive}`, { method: "PATCH", body: { archived: true } });
    toast(`Archived ${f ? (f.record.recipient_list || [])[0] || f.filename : "form"}. Restore it from Archive.`);
    await load();
  }));
  bindOpenRows($("#results"));
}
function bindOpenRows(root) {
  $$("[data-open]", root).forEach((row) => {
    row.onclick = (e) => { if (e.target.closest("button, input, a")) return; openForm(row.dataset.open); };
    row.onkeydown = (e) => { if (e.key === "Enter") openForm(row.dataset.open); };
  });
}

// ------------------------------------------------------------------ detail (drawer or review pane)
async function openForm(id, opt = {}) {
  if (S.detail && S.detail.id !== id && !(await okToDiscard())) return;
  let d;
  try { d = await api(`/api/forms/${id}`); } catch { toast("That form is no longer available", true); return; }
  const same = S.detail && S.detail.id === id;
  S.detail = d;
  if (!same || !opt.silent) {
    S.edit = blankEdit();
    S.tab = same ? S.tab : "record";
  }
  if (!same || !opt.keepPage) S.page = firstPage(d);
  if (opt.host === "review" || (S.view === "review" && !opt.host && S.host === "review")) {
    S.host = "review";
    renderReviewPane();
  } else {
    S.host = "drawer";
    renderDrawer();
  }
}
function firstPage(d) {
  const pm = d.analysis?.page_map || [];
  const p = pm.find((x) => x >= 0);
  return p ?? 0;
}
function isDirty() {
  const e = S.edit;
  return !!e && (Object.keys(e.overrides).length > 0 || Object.keys(e.fields).length > 0 || e.notes !== undefined || e.logged !== undefined);
}
function closeDetail() {
  if (S.host === "drawer") {
    $("#drawer").classList.remove("open");
    $("#drawer").setAttribute("aria-hidden", "true");
    $("#scrim").hidden = true;
  }
  S.detail = null;
  S.host = null;
  S.edit = null;
}
async function requestClose() {
  if (!(await okToDiscard())) return;
  closeDetail();
  if (location.hash.includes("?f=")) history.replaceState(null, "", location.hash.split("?")[0]);
}

function currentValue(k) {
  if (k in S.edit.overrides) return S.edit.overrides[k] === null ? S.detail.record.auto[k] : S.edit.overrides[k];
  return S.detail.record[k];
}
function currentField(k) {
  if (k in S.edit.fields) return S.edit.fields[k] === null ? S.detail.analysis?.slots?.[k]?.value : S.edit.fields[k];
  return S.detail.fields[k];
}

function detailHead(d) {
  const r = d.record || {};
  const names = (r.recipient_list || []).join(", ");
  const a = d.analysis || {};
  const chips = [];
  if (r.form_type) chips.push(`<span class="chip type">${esc(r.form_type === "F10" ? "AFCW Form 10" : r.form_type === "F174" ? "AF Form 174" : r.form_type)}</span>`);
  if (d.parsed) chips.push(pnChip(r.pos_neg));
  if (a.mode) chips.push(`<span class="chip ${a.mode === "fields" ? "" : "warn"}">${MODE_LABEL[a.mode]}</span>`);
  if (a.page_count) chips.push(`<span class="chip">${plural(a.page_count, "page")}</span>`);
  if (d.needs_review) chips.push('<span class="chip crit">Needs review</span>');
  else if (d.reviewed) chips.push(`<span class="chip good" title="${esc(fmtStamp(d.reviewed_at))}">Reviewed</span>`);
  if (d.logged) chips.push(`<span class="chip good" title="${esc(fmtStamp(d.logged_at))}">In tracker</span>`);
  if (d.missing) chips.push('<span class="chip crit">File missing from dump</span>');
  if (d.archived) chips.push(`<span class="chip muted" title="${esc(fmtStamp(d.archived_at))}">Archived</span>`);
  return `<header class="d-head"><div style="min-width:0"><h2>${names ? esc(names) : `<span style="color:var(--muted)">${d.parsed ? "No name on the form" : "Reading…"}</span>`}</h2><div class="fn">${esc(d.filename)}</div><div class="chips">${chips.join("")}</div></div>
    <div class="spacer"></div><div class="acts">
      <button class="btn ghost small" type="button" data-act="openpdf" title="Open in your PDF viewer (Shift-click: show in folder)">${icon("ext")}Open PDF</button>
      <button class="btn ghost small" type="button" data-act="copyrows">${icon("copy")}Copy sheet rows</button>
      <button class="btn ghost small" type="button" data-act="reparse" title="Read the PDF again (your edits are kept)">${icon("refresh")}Re-read</button>
      ${d.archived
        ? `<button class="btn ghost small" type="button" data-act="unarchive" title="Count this form again">${icon("archive")}Restore</button>`
        : `<button class="btn ghost small" type="button" data-act="archive" title="Keep the file and its record, but leave it out of stats and exports">${icon("archive")}Archive</button>`}
      ${S.host === "drawer" ? `<button class="icon-btn" type="button" data-act="close" aria-label="Close">${icon("x")}</button>` : ""}
    </div></header>`;
}

function sheetPane(d) {
  const a = d.analysis || {};
  const renders = a.renders || [];
  if (!renders.length) return `<div class="empty">${icon("paperwork")}<h3>${d.parsed ? "No preview" : "Reading this PDF…"}</h3><p>${esc(a.error || "")}</p></div>`;
  const pm = a.page_map || [];
  const pageRole = (p) => { const t = pm.indexOf(p); return t >= 0 ? `template page ${t + 1}` : "extra page"; };
  const cur = renders.find((r) => r.page === S.page) || renders[0];
  const slots = Object.values(a.slots || {}).filter((s) => s.page === cur.page);
  const boxes = slots.map((s) => {
    const edited = s.key in (d.overrides?.fields || {}) || s.key in S.edit.fields;
    const cls = !s.located ? "b-lost" : s.source === "ink" && s.ftype === "Text" && !edited ? "b-ink" : s.filled || edited ? "b-filled" : "b-empty";
    const [x0, y0, x1, y1] = s.rect;
    return `<div class="box ${cls}" data-slot="${s.key}" title="${esc(s.label)}" style="left:${x0 * 100}%;top:${y0 * 100}%;width:${(x1 - x0) * 100}%;height:${(y1 - y0) * 100}%"></div>`;
  }).join("");
  return `<div class="pager">
      ${renders.length > 1 ? `<div class="seg" role="group" aria-label="Page">${renders.map((r) => `<button type="button" data-page="${r.page}" aria-pressed="${r.page === cur.page}" title="${pageRole(r.page)}">Page ${r.page + 1}</button>`).join("")}</div>` : `<span>Page 1</span>`}
      <span>${renders.length > 1 ? esc(pageRole(cur.page)) : ""}</span><span class="spacer"></span>
      <label><input class="chk" type="checkbox" id="boxToggle" ${S.boxes ? "checked" : ""}> Show detected fields</label></div>
    <div class="sheet ${S.boxes ? "" : "nobox"}" style="aspect-ratio:${cur.w}/${cur.h}"><img src="closet://page/${d.id}/${cur.page}?v=${encodeURIComponent(d.parsed_at || "")}" alt="Page ${cur.page + 1} of ${esc(d.filename)}" loading="lazy">${boxes}</div>
    <div class="boxkey"><span><i style="background:rgba(207,174,107,.35);box-shadow:inset 0 0 0 1.5px #b08a32"></i>Filled</span>
      <span><i style="background:rgba(250,178,25,.3);box-shadow:inset 0 0 0 1.5px #d68c00"></i>Handwriting, needs a value</span>
      <span><i style="box-shadow:inset 0 0 0 1px rgba(60,90,140,.8)"></i>Empty</span>
      <span><i style="background:rgba(226,85,85,.2);box-shadow:inset 0 0 0 1.5px #e25555"></i>Not found</span></div>`;
}

function issuesBlock(d) {
  const list = [...(d.issues || [])];
  if (isIncomplete(d)) list.unshift({ level: "warn", text: `Positive F10: enter ${d.incomplete.join(" and ")} (not on the form). Until then it stays on the incomplete list.` });
  if (!list.length) return d.parsed ? `<div class="issues"><div class="issue ok">${icon("check")}<span>Matches the ${esc(d.record.form_type)} template. Every field was found where it belongs.</span></div></div>` : "";
  return `<div class="issues">${list.map((i) => `<div class="issue ${i.level}">${icon(i.level === "review" ? "alert" : "info")}<span>${esc(i.text)}</span></div>`).join("")}</div>`;
}

function routeBig(d) {
  const vals = FLAGS.map(([k]) => currentValue(k));
  let lastDone = -1;
  vals.forEach((v, i) => { if (v === true && (i === 0 || lastDone === i - 1)) lastDone = i; });
  const fillW = lastDone <= 0 ? 0 : (lastDone / 3) * 75;
  return `<div class="route-lg"><span class="fill" style="width:${fillW}%"></span>${FLAGS.map(([k, short, long], i) => {
    const v = vals[i];
    const auto = d.record.auto[k];
    const overridden = (k in S.edit.overrides) ? S.edit.overrides[k] !== null : d.record.overridden.includes(k);
    const how = overridden ? "set by hand" : auto === null ? "not on form" : auto ? "found on form" : "blank on form";
    const st = v === true ? "done" : v === null || v === undefined ? "na" : "";
    return `<button type="button" class="${st}" data-flag="${k}" aria-pressed="${v === true}" title="${esc(long)}. Click to toggle.">
      <span class="gem">${icon("check")}</span><span class="lbl">${esc(short)}</span><span class="how ${overridden ? "man" : ""}">${how}</span></button>`;
  }).join("")}</div>
  <div style="display:flex;justify-content:space-between;align-items:center;margin-top:2px">
    <span style="font-size:12px;color:var(--faint)">Click a step when someone signs after the fact.</span>
    ${FLAGS.some(([k]) => (k in S.edit.overrides ? S.edit.overrides[k] !== null : d.record.overridden.includes(k))) ? '<button type="button" class="btn ghost small" data-act="resetflags">Use detected</button>' : ""}</div>`;
}

function recordTab(d) {
  const r = d.record;
  const ft = currentValue("form_type");
  const pn = currentValue("pos_neg");
  const fields = REC_FIELDS.filter(([k]) => {
    if (k === "cdna" || k === "passes") return cdnaApplies(ft, pn);
    if (["demerits", "tours", "confinements"].includes(k)) return ft !== "F174"; // the 174 has no sanctions
    return true;
  }).map(([k, label, kind, hint]) => {
    const val = currentValue(k) ?? "";
    const auto = r.auto[k] ?? "";
    const overridden = k in S.edit.overrides ? S.edit.overrides[k] !== null : r.overridden.includes(k);
    const changed = k in S.edit.overrides;
    const missing = !String(val).trim() && ["recipients", "date", "pos_neg", "form_type", "reason_category", "cdna", "passes"].includes(k);
    const cls = `field ${kind.includes("wide") ? "wide" : ""} ${changed ? "changed" : ""} ${missing ? "missing" : ""}`;
    let input;
    if (kind.startsWith("select:")) {
      const opts = kind.slice(7).split(",");
      input = `<select class="select" data-rec="${k}"><option value="">—</option>${opts.map((o) => `<option ${val === o ? "selected" : ""}>${o}</option>`).join("")}</select>`;
    } else if (kind.includes("textarea")) {
      input = `<textarea class="input autogrow" data-rec="${k}" rows="${Math.min(16, Math.max(3, Math.ceil(String(val).length / 62) + 1))}" placeholder="${esc(hint)}">${esc(val)}</textarea>`;
    } else {
      input = `<input class="input" data-rec="${k}" value="${esc(val)}" placeholder="${esc(hint)}">`;
    }
    const det = overridden ? `<span class="det" title="${esc(auto)}">Detected: ${auto === "" ? "nothing" : esc(auto)}</span>` : "";
    return `<div class="${cls}"><label>${label}${overridden ? '<span class="ov">edited</span><button type="button" class="reset" data-reset="' + k + '">Use detected</button>' : ""}</label>${input}${det}</div>`;
  }).join("");
  const notes = S.edit.notes !== undefined ? S.edit.notes : d.notes;
  const logged = S.edit.logged !== undefined ? S.edit.logged : d.logged;
  return `${issuesBlock(d)}
    <div class="section-title">Routing</div>${routeBig(d)}
    <div class="section-title">Tracker record <span class="hint">what gets pasted into the Conduct Log</span></div>
    <div class="fields">${fields}
      <div class="field wide"><label>Notes</label><textarea class="input" data-notes rows="2" placeholder="Private notes, not exported">${esc(notes)}</textarea></div>
    </div>
    <label style="display:flex;gap:9px;align-items:center;margin-top:16px;cursor:pointer;color:var(--text-2)"><input class="chk" type="checkbox" data-logged ${logged ? "checked" : ""}> Already logged in the master tracker</label>`;
}

function slotsTab(d) {
  const slots = Object.values(d.analysis?.slots || {});
  if (!slots.length) return `<p style="color:var(--muted)">${d.parsed ? "No template fields to show." : "Still reading this PDF…"}</p>`;
  const groups = new Map();
  slots.forEach((s) => { if (!groups.has(s.section)) groups.set(s.section, []); groups.get(s.section).push(s); });
  const extra = d.analysis.extra_widgets || [];
  return `<p style="color:var(--muted);margin:0 0 14px;font-size:13px">Every box on the ${esc(d.record.form_type)} template and what was found in it. Type into any box to correct or fill it; the tracker record updates from these.</p>
  ${[...groups.entries()].map(([sec, list]) => `<div class="slot-group"><h4>Section ${esc(sec)}</h4>${list.map((s) => {
    const edited = s.key in S.edit.fields ? S.edit.fields[s.key] !== null : s.key in (d.overrides?.fields || {});
    const v = currentField(s.key);
    let input;
    if (s.ftype === "CheckBox") {
      input = `<label class="sigv"><input class="chk" type="checkbox" data-field="${s.key}" data-kind="bool" ${v ? "checked" : ""}> ${v ? "Checked" : "Not checked"}</label>`;
    } else if (s.ftype === "Signature") {
      input = `<div class="sigv">${s.filled ? `<span class="chip good">${icon("check")}Signed</span>` : '<span class="chip muted">No signature</span>'}<span style="color:var(--faint);font-size:12px">set signatures on the Routing track</span></div>`;
    } else {
      const long = ["narrative", "counselee_comment", "commander_comments", "recommendations", "reason", "referrals", "other_info"].includes(s.key);
      const ph = !s.located ? "not found on this PDF" : s.source === "ink" ? "handwritten, type what it says" : "";
      input = long ? `<textarea class="input" rows="2" data-field="${s.key}" placeholder="${ph}">${esc(v ?? "")}</textarea>`
        : `<input class="input" data-field="${s.key}" value="${esc(v === true ? "✓" : v ?? "")}" placeholder="${ph}">`;
    }
    const src = edited ? "edited" : s.source;
    return `<div class="slot" data-slotrow="${s.key}"><span class="k">${esc(s.label)}</span>${input}
      <span class="src ${src || ""}">${src ? SRC_LABEL[src] : s.located ? "empty" : "not found"}</span></div>`;
  }).join("")}</div>`).join("")}
  ${extra.length ? `<div class="slot-group"><h4>Filled fields that aren't on the template</h4>${extra.map((w) => `<div class="slot"><span class="k">${esc(w.name || "(unnamed)")}</span><span style="padding-top:6px">${esc(w.value === true ? "✓" : w.value)}</span><span class="src">page ${w.page + 1}</span></div>`).join("")}</div>` : ""}`;
}

function rowsTab(d) {
  const cols = S.data.columns;
  const rows = d.rows || [];
  if (!rows.length) return '<p style="color:var(--muted)">No rows yet.</p>';
  return `<p style="color:var(--muted);margin:0 0 12px;font-size:13px">${rows.length > 1 ? `${rows.length} recipients, so ${rows.length} rows. ` : ""}Paste into the Conduct Log with column A (Date) selected. Save any edits first.</p>
    <div class="rowprev"><table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>
    ${rows.map((r) => `<tr>${r.map((c) => `<td class="${c ? "" : "blank"}" title="${esc(c)}">${c ? esc(c) : "—"}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
    <div style="display:flex;gap:10px;margin-top:14px"><button class="btn primary" type="button" data-act="copyrows">${icon("copy")}Copy ${plural(rows.length, "row")}</button>
    ${d.logged ? "" : `<button class="btn" type="button" data-act="copylog">Copy and mark as logged</button>`}</div>`;
}

function historyTab(d) {
  const a = d.analysis || {};
  const ts = a.type_scores || {};
  return `<dl class="meta-grid">
    <dt>File</dt><dd>${esc(d.filename)}</dd>
    <dt>Added</dt><dd>${esc(fmtStamp(d.added_at))}</dd>
    <dt>Last read</dt><dd>${esc(fmtStamp(d.parsed_at))}${a.parse_seconds ? ` (${a.parse_seconds}s)` : ""}</dd>
    <dt>How it was read</dt><dd>${esc(MODE_LABEL[a.mode] || "—")}; ${a.matched_widgets ?? 0} of ${a.slot_total ?? 0} fields matched by position</dd>
    <dt>Template match</dt><dd>${Object.entries(ts).map(([k, v]) => `${k} ${(Math.max(0, v) * 100).toFixed(0)}%`).join(", ")}</dd>
    <dt>Pages used</dt><dd>${(a.page_map || []).map((p, i) => `template ${i + 1} → ${p >= 0 ? "PDF page " + (p + 1) : "missing"}`).join(", ")}</dd>
    <dt>From the filename</dt><dd>${d.filename_info?.pos_neg ? `Pos/Neg: ${esc(d.filename_info.pos_neg)}` : "Nothing (no Pos/Neg part)"}. Everything else is read from the form.</dd>
    <dt>Content hash</dt><dd style="color:var(--faint)">${esc((d.sha1 || "").slice(0, 16))}</dd>
  </dl>
  <div class="section-title" style="margin-top:24px">Edit history</div>
  ${(d.history || []).length ? `<ul class="history">${[...d.history].reverse().map((h) => `<li><time>${esc(fmtStamp(h.at))}</time><span>${esc(h.what)}</span></li>`).join("")}</ul>` : '<p style="color:var(--muted);margin:0">No edits yet.</p>'}`;
}

function detailInner(d) {
  const nSlots = Object.keys(d.analysis?.slots || {}).length;
  const tabs = [["record", "Record"], ["slots", `Detected fields<span class="n">${nSlots}</span>`], ["rows", `Sheet rows<span class="n">${(d.rows || []).length}</span>`], ["history", "Details"]];
  const body = { record: recordTab, slots: slotsTab, rows: rowsTab, history: historyTab }[S.tab](d);
  return `<div class="d-body"><div class="d-pane d-left">${sheetPane(d)}</div>
    <div class="d-pane d-right"><div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${S.tab === k}">${l}</button>`).join("")}</div>
    <div id="tabBody">${body}</div></div></div>`;
}

function saveBar() {
  const dirty = isDirty();
  if (S.host === "review") {
    const hint = S.detail.needs_review ? "Check the guesses, fill in what's missing, then save. This form won't come back to the queue."
      : isIncomplete(S.detail) ? `Enter ${S.detail.incomplete.join(" and ")} to take this form off the list.` : "";
    return `<div class="review-actions"><span class="note ${dirty ? "dirty" : ""}">${dirty ? "Unsaved changes" : hint}</span>
      ${dirty ? '<button class="btn ghost" type="button" data-act="discard">Discard</button>' : ""}
      ${S.detail.needs_review
        ? `<button class="btn" type="button" data-act="save" ${dirty ? "" : "disabled"}>Save</button>
           <button class="btn primary" type="button" data-act="savereview">${icon("check")}Save and mark reviewed</button>`
        : `<button class="btn primary" type="button" data-act="save" ${dirty ? "" : "disabled"}>${icon("check")}Save</button>`}</div>`;
  }
  return `<div class="d-foot"><span class="note ${dirty ? "dirty" : ""}">${dirty ? "Unsaved changes" : ""}</span>
    ${dirty ? '<button class="btn ghost" type="button" data-act="discard">Discard</button>' : ""}
    ${S.detail.needs_review ? '<button class="btn" type="button" data-act="savereview">Save and mark reviewed</button>' : ""}
    <button class="btn primary" type="button" data-act="save" ${dirty ? "" : "disabled"}>Save changes</button></div>`;
}

function renderDrawer() {
  if (!S.edit) S.edit = blankEdit();
  const dr = $("#drawer");
  const scroll = $(".d-right", dr)?.scrollTop || 0;
  dr.innerHTML = detailHead(S.detail) + detailInner(S.detail) + saveBar();
  $(".d-right", dr).scrollTop = scroll;
  if (!dr.classList.contains("open")) {
    $("#scrim").hidden = false;
    dr.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => dr.classList.add("open"));
    setTimeout(() => $(".d-right", dr)?.focus?.(), 50);
  }
  bindDetail(dr);
}
$("#scrim").onclick = requestClose;
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && S.host === "drawer" && !modalOpen()) requestClose();
  if ((e.ctrlKey || e.metaKey) && e.key === "s" && S.detail) { e.preventDefault(); save(false); }
});

function refreshSaveBar(root) {
  const old = $(".d-foot, .review-actions", root);
  if (old) { old.outerHTML = saveBar(); bindActs(root); }
}

function bindDetail(root) {
  bindActs(root);
  $$("[data-tab]", root).forEach((b) => (b.onclick = () => { S.tab = b.dataset.tab; rerenderDetail(); }));
  $$("[data-page]", root).forEach((b) => (b.onclick = () => { S.page = +b.dataset.page; rerenderDetail(); }));
  const bt = $("#boxToggle", root);
  if (bt) bt.onchange = () => { S.boxes = bt.checked; $(".sheet", root).classList.toggle("nobox", !S.boxes); };
  $$("[data-rec]", root).forEach((el) => {
    el.addEventListener(el.tagName === "SELECT" ? "change" : "input", () => {
      const k = el.dataset.rec;
      const auto = S.detail.record.auto[k] ?? "";
      S.edit.overrides[k] = el.value === String(auto) ? null : el.value;
      if (S.edit.overrides[k] === null && !S.detail.record.overridden.includes(k)) delete S.edit.overrides[k];
      el.closest(".field").classList.toggle("changed", k in S.edit.overrides);
      if (k === "form_type" || k === "pos_neg") { rerenderDetail(); return; }
      refreshSaveBar(root);
    });
  });
  $$("textarea.autogrow", root).forEach((ta) => {
    const fit = () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight + 2, 420) + "px"; };
    ta.addEventListener("input", fit);
    requestAnimationFrame(fit);
  });
  $$("[data-reset]", root).forEach((b) => (b.onclick = () => {
    const k = b.dataset.reset;
    if (S.detail.record.overridden.includes(k)) S.edit.overrides[k] = null; else delete S.edit.overrides[k];
    rerenderDetail();
  }));
  $$("[data-flag]", root).forEach((b) => (b.onclick = () => {
    const k = b.dataset.flag;
    const next = !(currentValue(k) === true);
    const auto = S.detail.record.auto[k];
    if (next === auto) {
      if (S.detail.record.overridden.includes(k)) S.edit.overrides[k] = null; else delete S.edit.overrides[k];
    } else S.edit.overrides[k] = next;
    rerenderDetail();
  }));
  const notes = $("[data-notes]", root);
  if (notes) notes.oninput = () => { S.edit.notes = notes.value === S.detail.notes ? undefined : notes.value; refreshSaveBar(root); };
  const lg = $("[data-logged]", root);
  if (lg) lg.onchange = () => { S.edit.logged = lg.checked === S.detail.logged ? undefined : lg.checked; refreshSaveBar(root); };
  $$("[data-field]", root).forEach((el) => {
    const handler = () => {
      const k = el.dataset.field;
      const v = el.dataset.kind === "bool" ? el.checked : el.value;
      const auto = S.detail.analysis.slots[k]?.value ?? "";
      const ovExists = k in (S.detail.overrides?.fields || {});
      if (v === auto || (auto === "" && v === "")) { if (ovExists) S.edit.fields[k] = null; else delete S.edit.fields[k]; }
      else S.edit.fields[k] = v;
      const src = el.closest(".slot").querySelector(".src");
      if (k in S.edit.fields && S.edit.fields[k] !== null) { src.className = "src edited"; src.textContent = "edited"; }
      const box = $(`.box[data-slot="${k}"]`, root);
      if (box && S.edit.fields[k]) { box.className = "box b-filled hl"; }
      refreshSaveBar(root);
    };
    el.addEventListener(el.dataset.kind === "bool" ? "change" : "input", handler);
  });
  // link list rows <-> page boxes
  $$("[data-slotrow]", root).forEach((row) => {
    const k = row.dataset.slotrow;
    row.addEventListener("mouseenter", () => $(`.box[data-slot="${k}"]`, root)?.classList.add("hl"));
    row.addEventListener("mouseleave", () => $(`.box[data-slot="${k}"]`, root)?.classList.remove("hl"));
    row.addEventListener("focusin", () => {
      const s = S.detail.analysis.slots[k];
      if (s && s.page !== null && s.page !== S.page) { S.page = s.page; const p = $(".d-left", root); p.innerHTML = sheetPane(S.detail); bindDetailLeft(root); }
      $$(".box.hl", root).forEach((b) => b.classList.remove("hl"));
      $(`.box[data-slot="${k}"]`, root)?.classList.add("hl");
    });
  });
  bindDetailLeft(root);
}
function bindDetailLeft(root) {
  $$("[data-page]", root).forEach((b) => (b.onclick = () => { S.page = +b.dataset.page; rerenderDetail(); }));
  const bt = $("#boxToggle", root);
  if (bt) bt.onchange = () => { S.boxes = bt.checked; $(".sheet", root).classList.toggle("nobox", !S.boxes); };
  $$(".box", root).forEach((b) => (b.onclick = () => {
    const k = b.dataset.slot;
    if (S.tab !== "slots") { S.tab = "slots"; rerenderDetail(); }
    const row = $(`[data-slotrow="${k}"]`, S.host === "drawer" ? $("#drawer") : $("#main"));
    if (row) { row.scrollIntoView({ block: "center", behavior: "smooth" }); row.classList.add("hl"); setTimeout(() => row.classList.remove("hl"), 1400); $("input, textarea", row)?.focus({ preventScroll: true }); }
  }));
}
function bindActs(root) {
  $$("[data-act]", root).forEach((b) => (b.onclick = () => act(b.dataset.act)));
}

function rerenderDetail() {
  if (S.host === "drawer") renderDrawer();
  else if (S.host === "review") renderReviewPane();
}

async function act(a) {
  const d = S.detail;
  if (!d) return;
  if (a === "close") return requestClose();
  if (a === "discard") { S.edit = blankEdit(); rerenderDetail(); return; }
  if (a === "save") return save(false);
  if (a === "savereview") return save(true);
  if (a === "resetflags") {
    FLAGS.forEach(([k]) => { if (d.record.overridden.includes(k)) S.edit.overrides[k] = null; else delete S.edit.overrides[k]; });
    rerenderDetail();
    return;
  }
  if (a === "copyrows" || a === "copylog") {
    if (isDirty()) { toast("Save your changes first so the rows include them", true); return; }
    const text = (d.rows || []).map((r) => r.join("\t")).join("\n");
    await copyText(text);
    if (a === "copylog") {
      await api(`/api/forms/${d.id}`, { method: "PATCH", body: { logged: true } });
      toast(`Copied ${plural(d.rows.length, "row")} and marked as logged`);
      await load();
      openForm(d.id, { keepPage: true, silent: true, host: S.host });
    } else toast(`Copied ${plural(d.rows.length, "row")}. Paste into the Conduct Log.`);
    return;
  }
  if (a === "openpdf") {
    if (window.event?.shiftKey) { closet.showPdf(d.id); return; }
    const err = await closet.openPdf(d.id);
    if (err) toast(err, true);
    return;
  }
  if (a === "archive" || a === "unarchive") {
    if (!(await okToDiscard("this form"))) return;
    const on = a === "archive";
    await api(`/api/forms/${d.id}`, { method: "PATCH", body: { archived: on } });
    toast(on ? "Archived. It no longer counts in stats or exports." : "Restored. It counts again.");
    const host = S.host;
    S.edit = blankEdit();
    await load();
    if (host === "review") { S.reviewId = null; renderView(); }
    else openForm(d.id, { keepPage: true, silent: true, host });
    return;
  }
  if (a === "reparse") {
    await api(`/api/forms/${d.id}/reparse`, { method: "POST" });
    toast("Reading the PDF again. Your edits are kept.");
    setTimeout(async () => { await load(); if (S.detail?.id === d.id) openForm(d.id, { keepPage: true, silent: true, host: S.host }); }, 1500);
  }
}

// Commas separate people, but a one-word piece is a surname written "Last, First" (mirrors records.split_names)
const splitNames = (s) => {
  const chunks = String(s || "").split(/[,;\n]/).map((x) => stripRank(x.trim().replace(/\s+/g, " "))).filter(Boolean);
  const out = [];
  for (let i = 0; i < chunks.length; i++) {
    if (!chunks[i].includes(" ") && i + 1 < chunks.length) { out.push(`${chunks[i + 1]} ${chunks[i]}`); i++; }
    else out.push(chunks[i]);
  }
  return out;
};
const normYear = (t) => { t = String(t || "").trim().replace(/^['’]|^c/i, ""); return /^\d{2}$/.test(t) ? "20" + t : /^20\d{2}$/.test(t) ? t : null; };

// A comma-separated recipient list means several people got this paperwork. Each needs a class
// year for their own sheet row: use what earlier forms (or this one) already say, ask for the rest.
async function collectClassYears() {
  const e = S.edit;
  if (!("recipients" in e.overrides)) return true;
  const typed = e.overrides.recipients;
  const names = typed === null ? [S.detail.record.auto.recipients].filter(Boolean) : splitNames(typed);
  const roster = S.data.roster || {};
  const known = {};
  const oldNames = S.detail.record.recipient_list || [];
  const oldYears = String(S.detail.record.class_year || "").split(",").map((y) => y.trim());
  oldNames.forEach((n, i) => {
    const y = oldNames.length === 1 ? String(S.detail.record.class_year || "").trim() : oldYears.length === oldNames.length ? oldYears[i] : "";
    if (normYear(y)) known[nameKey(n)] = normYear(y);
  });
  const typedYears = "class_year" in e.overrides && e.overrides.class_year !== null ? String(e.overrides.class_year).split(",").map((y) => y.trim()) : [];
  if (names.length <= 1) {
    if (String(currentValue("class_year") || "").includes(",")) {
      const k = nameKey(names[0] || "");
      e.overrides.class_year = roster[k] || known[k] || "";
    }
    return true;
  }
  const years = [];
  for (const [i, n] of names.entries()) {
    const k = nameKey(n);
    let y = (typedYears.length === names.length && normYear(typedYears[i])) || roster[k] || known[k];
    if (!y) {
      const ans = await ask({
        title: `Class year for ${n}?`,
        message: `Recipient ${i + 1} of ${names.length}. Leave it blank if you don't know it.`,
        input: { placeholder: "e.g. 2028", validate: (t) => (!t || normYear(t) ? "" : `"${t}" isn't a class year. Enter something like 2028.`) },
        choices: [{ label: "Cancel save", value: null }, { label: i + 1 < names.length ? "Next" : "Save", value: true, primary: true }],
      });
      if (ans === null) return false;
      y = ans ? normYear(ans) : "";
    }
    years.push(y);
  }
  e.overrides.class_year = years.join(", ");
  return true;
}

async function save(markReviewed) {
  const d = S.detail;
  const e = S.edit;
  if (!(await collectClassYears())) { toast("Save cancelled. Nothing was changed.", true); return; }
  const patch = {};
  if (Object.keys(e.overrides).length) patch.overrides = e.overrides;
  if (Object.keys(e.fields).length) patch.fields = e.fields;
  if (e.notes !== undefined) patch.notes = e.notes;
  if (e.logged !== undefined) patch.logged = e.logged;
  if (markReviewed) patch.reviewed = true;
  if (!Object.keys(patch).length) return;
  try {
    await api(`/api/forms/${d.id}`, { method: "PATCH", body: patch });
  } catch (err) { toast("Couldn't save: " + err.message, true); return; }
  S.edit = blankEdit();
  toast(markReviewed ? "Saved and marked reviewed" : "Changes saved");
  const host = S.host;
  await load();
  const still = active().find((f) => f.id === d.id);
  if (host === "review" && (markReviewed || (still && !inQueue(still)))) {
    const next = active().find((f) => inQueue(f) && f.id !== d.id);
    S.reviewId = next ? next.id : d.id;
    renderView();
  } else if (S.detail) {
    openForm(d.id, { keepPage: true, silent: true, host });
  }
}

// ------------------------------------------------------------------ review
function viewReview() {
  const all = active();
  const waiting = all.filter((f) => f.needs_review);
  const incomplete = all.filter((f) => !f.needs_review && isIncomplete(f));
  const queue = [...waiting, ...incomplete];
  const done = all.filter((f) => f.flagged && f.reviewed && !isIncomplete(f));
  if (!queue.length && !done.length) {
    $("#main").innerHTML = head("Review", "Forms that don't match their template closely enough to trust, and positive F10s still missing CDNA or Passes.") + `
      <div class="panel"><div class="empty">${icon("inbox0")}<h3>Nothing to review</h3><p>Every form matched its template and every positive F10 has CDNA and Passes. Anything with extra pages, missing fields, a scan, a filename without Pos/Neg, or missing CDNA/Passes will show up here.</p></div></div>`;
    closeDetail();
    return;
  }
  if (!S.reviewId || !all.some((f) => f.id === S.reviewId)) S.reviewId = (queue[0] || done[0]).id;
  const item = (f) => `<button type="button" data-rid="${f.id}" aria-current="${f.id === S.reviewId}">
      <div class="t">${whoLine(f.record || {}, f.filename)}</div><div class="s">${esc(f.filename)}</div>
      ${f.needs_review ? `<div class="why">${esc((f.issues.find((i) => i.level === "review") || {}).text || "")}</div>`
        : isIncomplete(f) ? `<div class="why" style="color:#ebc673">Positive F10 missing ${esc(f.incomplete.join(" and "))}</div>`
        : `<div class="s" style="color:var(--good)">Reviewed ${esc(fmtStamp(f.reviewed_at))}</div>`}</button>`;
  $("#main").innerHTML = head("Review", `${queue.length ? plural(queue.length, "form needs", "forms need") + " a look." : "The queue is clear."} Your corrections are saved with the form, and a reviewed form doesn't come back to the queue.`) + `
    <div class="review-layout"><nav class="queue" aria-label="Review queue">
      ${waiting.length ? `<div class="group">Needs review (${waiting.length})</div>${waiting.map(item).join("")}` : ""}
      ${incomplete.length ? `<div class="group">Incomplete (${incomplete.length})</div>${incomplete.map(item).join("")}` : ""}
      ${done.length ? `<div class="group">Reviewed (${done.length})</div>${done.map(item).join("")}` : ""}
    </nav><div id="reviewPane"><div class="review-card"><div class="empty">Loading…</div></div></div></div>`;
  $$("[data-rid]").forEach((b) => (b.onclick = async () => {
    if (!(await okToDiscard())) return;
    S.edit = null;
    S.reviewId = b.dataset.rid;
    $$("[data-rid]").forEach((x) => x.setAttribute("aria-current", x === b));
    openForm(S.reviewId, { host: "review" });
  }));
  if (S.host === "drawer") closeDetail();
  if (S.detail && S.detail.id === S.reviewId && S.host === "review") {
    renderReviewPane();
    if (!isDirty()) openForm(S.reviewId, { host: "review", keepPage: true, silent: true });
  } else { S.edit = null; openForm(S.reviewId, { host: "review" }); }
}
function renderReviewPane() {
  const pane = $("#reviewPane");
  if (!pane || !S.detail) return;
  if (!S.edit) S.edit = blankEdit();
  const scroll = $(".d-right", pane)?.scrollTop || 0;
  pane.innerHTML = `<div class="review-card">${detailHead(S.detail)}${detailInner(S.detail)}${saveBar()}</div>`;
  const r = $(".d-right", pane);
  if (r) r.scrollTop = scroll;
  bindDetail(pane);
}

// ------------------------------------------------------------------ cadets
function cadetIndex() {
  const m = new Map();
  parsed().forEach((f) => {
    f.rows.forEach((row) => {
      const name = row[6] || "(no name)";
      const k = nameKey(name) || name;
      const c = m.get(k) || { name, year: "", forms: [], neg: 0, pos: 0, dem: 0, tours: 0, conf: 0, last: "" };
      c.forms.push(f);
      if (row[1] && !c.year) c.year = row[1];
      row[8] === S.data.settings.pos_label ? c.pos++ : c.neg++;
      c.dem += num(row[colIdx("Demerits")]); c.tours += num(row[colIdx("Tours")]); c.conf += num(row[colIdx("Confinements")]);
      if ((f.record.date_iso || "") > c.last) c.last = f.record.date_iso || "";
      m.set(k, c);
    });
  });
  return [...m.entries()];
}
function viewCadets() {
  $("#main").innerHTML = head("Cadets", "Everyone who has received paperwork, with totals across all of their forms.") + `
    <div class="toolbar"><label class="search">${icon("search")}<input class="input" id="cq" type="search" placeholder="Find a cadet" value="${esc(S.cadetQ)}" aria-label="Find a cadet"></label>
    <span class="spacer"></span><div class="legend"><span><i style="background:var(--neg)"></i>Negative</span><span><i style="background:var(--pos)"></i>Positive</span></div></div>
    <div id="results"></div>`;
  $("#cq").oninput = (e) => { S.cadetQ = e.target.value; renderCadetRows(); };
  renderCadetRows();
}
function renderCadetRows() {
  const q = S.cadetQ.trim().toLowerCase();
  const list = cadetIndex().filter(([, c]) => !q || (c.name + " " + c.year).toLowerCase().includes(q))
    .sort((a, b) => b[1].neg - a[1].neg || b[1].forms.length - a[1].forms.length || a[1].name.localeCompare(b[1].name));
  if (!list.length) { $("#results").innerHTML = `<div class="panel"><div class="empty">${icon("cadets")}<h3>No cadets yet</h3><p>Cadets appear here once their paperwork is in the dump folder.</p></div></div>`; return; }
  const maxN = Math.max(...list.map(([, c]) => c.neg + c.pos));
  $("#results").innerHTML = `<div class="table-wrap"><table class="t"><thead><tr><th>Cadet</th><th>Class</th><th>Paperwork</th><th class="num">Negative</th><th class="num">Positive</th><th class="num">Demerits</th><th class="num">Tours</th><th class="num">Confinements</th><th>Latest</th></tr></thead><tbody>
    ${list.map(([k, c]) => `<tr class="click" data-cadet="${esc(k)}" tabindex="0" aria-expanded="${S.cadetOpen === k}">
      <td class="who">${esc(c.name)}</td><td>${esc(c.year) || '<span class="dim">—</span>'}</td>
      <td><span class="bar-inline" style="width:${Math.max(8, ((c.neg + c.pos) / maxN) * 110)}px">${c.neg ? `<span style="flex:${c.neg};background:var(--neg)"></span>` : ""}${c.pos ? `<span style="flex:${c.pos};background:var(--pos)"></span>` : ""}</span></td>
      <td class="num">${c.neg}</td><td class="num">${c.pos}</td><td class="num">${c.dem || '<span class="dim">0</span>'}</td><td class="num">${c.tours || '<span class="dim">0</span>'}</td><td class="num">${c.conf || '<span class="dim">0</span>'}</td>
      <td class="nowrap">${fmtDate(c.last)}</td></tr>
      ${S.cadetOpen === k ? c.forms.map((f) => `<tr class="click cadet-forms" data-open="${f.id}" tabindex="0"><td colspan="2" style="padding-left:30px">${fmtDate(f.record.date_iso, f.record.date)}</td>
        <td colspan="3">${pnChip(f.record.pos_neg)} <span style="margin-left:8px">${esc(f.record.reason_category || f.filename)}</span></td><td colspan="3">${routeMini(f.record)}</td><td><span class="chip type">${esc(f.record.form_type)}</span></td></tr>`).join("") : ""}`).join("")}
    </tbody></table></div>`;
  $$("[data-cadet]").forEach((r) => {
    const tog = () => { S.cadetOpen = S.cadetOpen === r.dataset.cadet ? null : r.dataset.cadet; renderCadetRows(); };
    r.onclick = tog;
    r.onkeydown = (e) => { if (e.key === "Enter") tog(); };
  });
  bindOpenRows($("#results"));
}

// ------------------------------------------------------------------ export
function exportForms() {
  const list = parsed().slice().sort((a, b) => (a.record.date_iso || "9").localeCompare(b.record.date_iso || "9") || a.filename.localeCompare(b.filename));
  if (S.exportMode === "unlogged") return list.filter((f) => !f.logged);
  return list;
}
function viewExport() {
  const cols = S.data.columns;
  $("#main").innerHTML = head("Sheet export", "Rows in the same column order as the Conduct Log (A to M). Copy them, click the first empty Date cell in the tracker, and paste. A form with several recipients gives one row per person.") + `
    <div class="toolbar"><div class="seg" role="group">
      ${[["unlogged", "Not in tracker yet"], ["all", "All paperwork"]].map(([v, l]) => `<button type="button" data-em="${v}" aria-pressed="${S.exportMode === v}">${l}</button>`).join("")}</div>
      <span class="spacer"></span><button class="btn ghost small" type="button" id="selAll">Select all</button><button class="btn ghost small" type="button" id="selNone">Clear selection</button></div>
    <div id="results"></div>`;
  $$("[data-em]").forEach((b) => (b.onclick = () => { S.exportMode = b.dataset.em; S.exportPicked.clear(); viewExport(); }));
  $("#selAll").onclick = () => { exportForms().forEach((f) => S.exportPicked.add(f.id)); renderExportRows(); };
  $("#selNone").onclick = () => { S.exportPicked.clear(); renderExportRows(); };
  if (!S.exportPicked.size) exportForms().forEach((f) => S.exportPicked.add(f.id));
  renderExportRows(cols);
}
function renderExportRows() {
  const cols = S.data.columns;
  const list = exportForms();
  const ids = new Set(list.map((f) => f.id));
  [...S.exportPicked].forEach((id) => { if (!ids.has(id)) S.exportPicked.delete(id); });
  if (!list.length) {
    $("#results").innerHTML = `<div class="panel"><div class="empty">${icon("check")}<h3>${S.exportMode === "unlogged" ? "The tracker is up to date" : "No paperwork yet"}</h3><p>${S.exportMode === "unlogged" ? "Every form has been marked as logged. Switch to All paperwork to copy rows again." : ""}</p></div></div>`;
    return;
  }
  const picked = list.filter((f) => S.exportPicked.has(f.id));
  const nRows = picked.reduce((a, f) => a + f.rows.length, 0);
  $("#results").innerHTML = `<div class="table-wrap"><table class="t export-rows"><thead><tr><th style="width:34px"></th>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}<th></th></tr></thead><tbody>
    ${list.map((f) => f.rows.map((r, i) => `<tr class="${f.rows.length > 1 ? "split" : ""} ${S.exportPicked.has(f.id) ? "sel" : ""}">
      <td>${i === 0 ? `<input class="chk" type="checkbox" data-pick="${f.id}" ${S.exportPicked.has(f.id) ? "checked" : ""} aria-label="Include ${esc(f.filename)}">` : ""}</td>
      ${r.map((c) => `<td class="${c ? "" : "blank"}" title="${esc(c)}">${esc(c)}</td>`).join("")}
      <td class="nowrap">${i === 0 ? `<button class="icon-btn" type="button" data-copyone="${f.id}" title="Copy this form's rows" aria-label="Copy rows">${icon("copy")}</button><button class="icon-btn" type="button" data-openx="${f.id}" title="Open form" aria-label="Open form">${icon("chev")}</button>` : ""}</td></tr>`).join("")).join("")}
    </tbody></table></div>
    <div class="copybar"><span class="txt"><b>${plural(nRows, "row")}</b> from ${plural(picked.length, "form")} selected${picked.some(isIncomplete)
      ? `<br><span style="color:#ebc673;font-size:12.5px">${plural(picked.filter(isIncomplete).length, "positive F10 is", "positive F10s are")} missing CDNA or Passes</span>` : ""}</span>
      <label><input class="chk" type="checkbox" id="hdr" ${S.data.settings.include_header ? "checked" : ""}> Include header row</label>
      <button class="btn" type="button" id="copySel" ${nRows ? "" : "disabled"}>${icon("copy")}Copy rows</button>
      <button class="btn primary" type="button" id="copyLog" ${nRows ? "" : "disabled"}>Copy and mark as logged</button></div>`;
  $$("[data-pick]").forEach((c) => (c.onchange = () => { c.checked ? S.exportPicked.add(c.dataset.pick) : S.exportPicked.delete(c.dataset.pick); renderExportRows(); }));
  $$("[data-copyone]").forEach((b) => (b.onclick = async () => {
    const f = list.find((x) => x.id === b.dataset.copyone);
    await copyText(f.rows.map((r) => r.join("\t")).join("\n"));
    toast(`Copied ${plural(f.rows.length, "row")}`);
  }));
  $$("[data-openx]").forEach((b) => (b.onclick = () => openForm(b.dataset.openx)));
  $("#hdr").onchange = async (e) => { await api("/api/settings", { method: "PUT", body: { include_header: e.target.checked } }); S.data.settings.include_header = e.target.checked; };
  const text = () => {
    const lines = picked.flatMap((f) => f.rows.map((r) => r.join("\t")));
    if ($("#hdr").checked) lines.unshift(cols.join("\t"));
    return lines.join("\n");
  };
  $("#copySel").onclick = async () => { await copyText(text()); toast(`Copied ${plural(nRows, "row")}. Paste into the Conduct Log.`); };
  $("#copyLog").onclick = async () => {
    await copyText(text());
    await api("/api/forms/bulk", { method: "POST", body: { ids: picked.map((f) => f.id), patch: { logged: true } } });
    toast(`Copied ${plural(nRows, "row")} and marked ${plural(picked.length, "form")} as logged`);
    S.exportPicked.clear();
    await load();
  };
}

// ------------------------------------------------------------------ archive
function viewArchive() {
  const list = archived().slice().sort((a, b) => (b.archived_at || "").localeCompare(a.archived_at || ""));
  $("#main").innerHTML = head("Archive", "Redundant paperwork you've set aside. The PDFs stay in the dump folder and their records are kept, but they don't count toward any stats, the review queue, or the sheet export.") +
    (list.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Date</th><th>Recipient</th><th>Form</th><th>Pos/Neg</th><th>Archived</th><th></th></tr></thead><tbody>
      ${list.map((f) => `<tr class="click" data-open="${f.id}" tabindex="0">
        <td class="nowrap">${f.parsed ? fmtDate(f.record.date_iso, f.record.date) : ""}</td>
        <td><div class="who">${whoLine(f.record || {}, f.filename)}</div><div class="sub">${esc(f.filename)}</div></td>
        <td>${f.record.form_type ? `<span class="chip type">${esc(f.record.form_type)}</span>` : ""}</td>
        <td>${f.parsed ? pnChip(f.record.pos_neg) : ""}</td>
        <td class="nowrap" style="color:var(--muted)">${esc(fmtStamp(f.archived_at))}</td>
        <td class="nowrap" style="text-align:right"><button class="btn ghost small" type="button" data-restore="${f.id}">${icon("archive")}Restore</button></td></tr>`).join("")}
      </tbody></table></div>`
    : `<div class="panel"><div class="empty">${icon("archive")}<h3>Nothing archived</h3><p>To set a redundant form aside, open it and choose Archive. It stays in the dump folder and can be restored at any time.</p></div></div>`);
  $$("[data-restore]").forEach((b) => (b.onclick = async (e) => {
    e.stopPropagation();
    await api(`/api/forms/${b.dataset.restore}`, { method: "PATCH", body: { archived: false } });
    toast("Restored. It counts again.");
    await load();
  }));
  bindOpenRows($("#main"));
}

// ------------------------------------------------------------------ settings
function viewSettings() {
  const s = S.data.settings;
  const row = (title, desc, control) => `<div class="set-row"><div><h3>${title}</h3><p>${desc}</p></div><div>${control}</div></div>`;
  $("#main").innerHTML = head("Settings", "How rows are written for the tracker and how forms are read.") + `
    <div class="settings">
    <section class="panel"><div class="panel-head"><h2>Tracker values</h2><span class="sub">match the dropdown options in your sheet</span></div><div class="panel-body">
      ${row("Form type labels", "Written in the Form Type column.", `<div class="pair"><input class="input" data-set="form_type_labels.F10" value="${esc(s.form_type_labels.F10)}" aria-label="F10 label"><input class="input" data-set="form_type_labels.F174" value="${esc(s.form_type_labels.F174)}" aria-label="F174 label"></div>`)}
      ${row("Pos/Neg labels", "Written in the Pos/Neg column.", `<div class="pair"><input class="input" data-set="pos_label" value="${esc(s.pos_label)}" aria-label="Positive label"><input class="input" data-set="neg_label" value="${esc(s.neg_label)}" aria-label="Negative label"></div>`)}
      ${row("Month column", "How the Month column is written.", `<select class="select" data-set="month_format">${[["name", "September"], ["short", "Sep"], ["name_year", "September 2026"], ["iso", "2026-09"], ["number", "9"]].map(([v, l]) => `<option value="${v}" ${s.month_format === v ? "selected" : ""}>${l}</option>`).join("")}</select>`)}
    </div></section>
    <section class="panel"><div class="panel-head"><h2>Reading forms</h2></div><div class="panel-body">
      ${row("AF 174 commander block", "Whose signature the Commander's Comments block on an AF 174 counts as.", `<select class="select" data-set="f174_commander_role">${[["cadet_sqcc_signed", "Cadet SQ/CC"], ["aoc_signed", "AOC/AMT"], ["none", "Neither"]].map(([v, l]) => `<option value="${v}" ${s.f174_commander_role === v ? "selected" : ""}>${l}</option>`).join("")}</select>`)}
      ${row("Position tolerance", "A field counts as matching the template when every edge is within this many points (1 pt ≈ 1 px at 72 dpi). Changing it re-reads every form.", `<input class="input" type="number" min="2" max="40" step="1" data-set="position_tolerance_pt" value="${esc(s.position_tolerance_pt)}">`)}
    </div></section>
    <section class="panel"><div class="panel-head"><h2>Start over</h2></div><div class="panel-body">
      ${row("Clear metadata and rescan", "Forgets everything closet has recorded and reads every PDF in the dump folder again from scratch. This erases your edits, reviews, signatures set by hand, archive choices, and “logged” marks. Settings are kept, and the PDFs themselves are never touched.",
        `<button class="btn" type="button" id="resetAll" style="border-color:rgba(226,85,85,.5);color:#f0a3a3">${icon("refresh")}Clear metadata and rescan</button>`)}
    </div></section>
    <section class="panel"><div class="panel-head"><h2>Folders</h2></div><div class="panel-body">
      ${row("Dump folder", "Put every PDF here and leave it there. Nothing is ever moved or changed. You can also drag PDFs onto the window.",
        `<div class="path">${esc(S.data.dump_dir)}</div><div class="pair" style="margin-top:8px"><button class="btn small" type="button" id="dumpOpen">${icon("folder")}Open</button><button class="btn small" type="button" id="dumpChoose">Change…</button></div>`)}
      ${row("Metadata folder", "Cached reads, page images, and your edits. It sits next to the dump folder; back both up together.",
        `<div class="path">${esc(S.data.meta_dir)}</div><div class="pair" style="margin-top:8px"><button class="btn small" type="button" id="metaOpen">${icon("folder")}Open</button></div>`)}
      ${row("Templates", "The blank AFCW Form 10 and AF Form 174 every form is compared against. They're built into the app.", `<div class="path">Built in</div>`)}
    </div></section></div>`;
  $("#dumpOpen").onclick = () => closet.openFolder("dump");
  $("#metaOpen").onclick = () => closet.openFolder("meta");
  $("#dumpChoose").onclick = chooseDump;
  $("#resetAll").onclick = async () => {
    const all = (S.data.forms || []).filter((f) => !f.missing);
    const n = all.length;
    const edited = all.filter((f) => f.reviewed || f.logged || f.archived || (f.record.overridden || []).length || f.notes).length;
    const msg = `Every one of the ${plural(n, "form")} will be read again from scratch.

` +
      (edited ? `${plural(edited, "form has", "forms have")} edits, reviews, archive, or logged marks. These will be lost.

` : "") +
      "Settings are kept. The PDFs in the dump folder are not touched.";
    const ok = await ask({
      title: "Clear all metadata and read everything again?",
      message: `<p>${esc(msg).replace(/\n\n/g, "</p><p>")}</p>`,
      choices: [{ label: "Cancel", value: null }, { label: "Clear and rescan", value: true, primary: true }], danger: true,
    });
    if (!ok) return;
    try {
      const r = await api("/api/reset", { method: "POST", body: { confirm: "clear" } });
      closeDetail();
      S.reviewId = null;
      S.exportPicked.clear();
      toast(`Metadata cleared. Reading ${plural(r.queued, "form")} again.`);
      await load();
    } catch (e) { toast("Couldn't clear metadata: " + e.message, true); }
  };
  $$("[data-set]").forEach((el) => (el.onchange = async () => {
    const path = el.dataset.set.split(".");
    let v = el.type === "number" ? Number(el.value) : el.value;
    const body = path.length === 2 ? { [path[0]]: { [path[1]]: v } } : { [path[0]]: v };
    try {
      await api("/api/settings", { method: "PUT", body });
      toast(path[0] === "position_tolerance_pt" ? "Saved. Re-reading every form…" : "Setting saved");
      await load();
    } catch (e) { toast("Couldn't save: " + e.message, true); }
  }));
}

// ------------------------------------------------------------------ desktop niceties
async function chooseDump() {
  if (!(await okToDiscard())) return;
  const r = await closet.chooseDumpFolder();
  if (r) toast(`Using ${r.dump}`);
}

// Drag PDFs onto the window: they're copied (never moved) into the dump folder.
let dragDepth = 0;
const dropZone = () => $("#drop");
window.addEventListener("dragenter", (e) => {
  if (![...(e.dataTransfer?.types || [])].includes("Files")) return;
  e.preventDefault();
  if (++dragDepth === 1) dropZone().hidden = false;
});
window.addEventListener("dragover", (e) => { if (dragDepth) e.preventDefault(); });
window.addEventListener("dragleave", () => { if (dragDepth && --dragDepth === 0) dropZone().hidden = true; });
window.addEventListener("drop", async (e) => {
  if (!dragDepth) return;
  e.preventDefault();
  dragDepth = 0;
  dropZone().hidden = true;
  const files = [...e.dataTransfer.files].filter((f) => /\.pdf$/i.test(f.name));
  if (!files.length) { toast("Only PDF files can be added", true); return; }
  try {
    const added = await closet.addFiles(files);
    toast(added.length ? `Added ${plural(added.length, "PDF")} to the dump folder` : "Those PDFs are already in the dump folder");
  } catch (err) { toast("Couldn't add those files: " + err.message, true); }
});

// Ctrl/Cmd+F jumps to the search box on pages that have one
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
    const q = $("#q") || $("#cq");
    if (q) { e.preventDefault(); q.focus(); q.select(); }
  }
});

// ------------------------------------------------------------------ go
(async () => {
  document.body.classList.add("desktop", `os-${closet.platform}`);
  await load();
  route();
})();
