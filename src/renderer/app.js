/* closet — frontend (no build step). */
"use strict";

// ------------------------------------------------------------------ constants
const FLAGS = [
  ["issuer_signed", "Issuer", "Signed by issuer"],
  ["sqccf_processed", "SQ/CCF", "Processed by SQ/CCF"],
  ["cadet_cc_initialed", "Cadet CC", "Initialed by Cadet Commander"],
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
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>',
  notifications: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
  balances: '<path d="M12 3v18M5 7h14M7 7l-3 7a3 3 0 0 0 6 0zM17 7l-3 7a3 3 0 0 0 6 0z"/>',
};
const icon = (n, cls = "") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n]}</svg>`;

// ------------------------------------------------------------------ state
const S = {
  data: null,
  version: -1,
  view: "overview",
  f: { q: "", type: "all", pn: "all", step: "all" },
  sort: { key: "date", dir: -1 },
  cadetQ: "",
  cadetOpen: null,
  exportMode: "unlogged",
  exportPn: "all",
  exportPicked: new Set(),
  detail: null,      // full detail of the open form
  host: null,        // "drawer" | "review"
  edit: null,        // pending edits for the open form
  page: 0,
  tab: "record",
  boxes: true,
  reviewId: null,
  zoom: { drawer: 1, review: 1 }, // page preview size
  wide: false,       // review: preview takes the whole card (queue and fields tucked away) so print is readable
  syncPick: null,
  stale: false,
  setTab: "general", // Settings sub-tab
  tv: null,          // discipline workbook + balances, fetched when Balances or its settings are open
  balQ: "", balF: "owing", // Balances: search and filter
  nv: null,          // notifications data (contacts, people, log), fetched when a notifications screen is open
  cQ: "", cFilter: "all", cSel: new Set(), importReport: null, // contact list in Settings
  nSel: new Set(), nSubject: "Conduct paperwork update", nMessage: "", nQ: "", nClass: "all", nFilter: "all", sending: false, // Notifications tab
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
// `extra` adds a labelled dropdown under the message; its value is left in `ask.extra` when a button other than Cancel is pressed.
function ask({ title, message = "", input = null, select = null, extra = null, choices = null, danger = false, wide = false }) {
  ask.extra = null;
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const scrim = document.createElement("div");
    scrim.className = "modal-scrim";
    const btns = choices || [{ label: "Cancel", value: null }, { label: "OK", value: true, primary: true }];
    scrim.innerHTML = `<div class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="mTitle">
      <h2 id="mTitle">${esc(title)}</h2>${message ? `<div class="modal-msg">${message}</div>` : ""}
      ${input ? `<input class="input" id="mInput" value="${esc(input.value || "")}" placeholder="${esc(input.placeholder || "")}" autocomplete="off" spellcheck="false"><div class="modal-err" id="mErr" role="alert"></div>` : ""}
      ${select ? `<select class="select" id="mSelect" style="width:100%;margin-top:10px">${select.options.map(([v, l]) => `<option value="${esc(v)}" ${v === select.value ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>` : ""}
      ${extra ? `<label class="modal-extra"><span>${esc(extra.label)}</span><select class="select" id="mExtra">${extra.options.map(([v, l]) => `<option value="${esc(v)}" ${v === extra.value ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>` : ""}
      <div class="modal-actions">${btns.map((b, i) => `<button type="button" class="btn ${b.primary ? (danger ? "danger" : "primary") : "ghost"}" data-i="${i}">${esc(b.label)}</button>`).join("")}</div></div>`;
    document.body.appendChild(scrim);
    const field = $("#mInput", scrim);
    const sel = $("#mSelect", scrim);
    const ex = $("#mExtra", scrim);
    const done = (v) => {
      scrim.remove();
      document.removeEventListener("keydown", onKey, true);
      prev?.focus?.();
      resolve(v);
    };
    const pick = (b) => {
      if (b.value === null) return done(null);
      ask.extra = ex ? ex.value : null;
      if (sel) return done(b.primary ? sel.value : b.value);
      if (!input) return done(b.value);
      const text = field.value.trim();
      const err = input.validate ? input.validate(text) : "";
      if (err) { $("#mErr", scrim).textContent = err; field.focus(); field.select(); return; }
      done(text);
    };
    const primary = btns.find((b) => b.primary) || btns[btns.length - 1];
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(null); }
      if (e.key === "Enter" && (field ? document.activeElement === field : !sel || document.activeElement === sel)) { e.preventDefault(); e.stopPropagation(); pick(primary); }
    };
    document.addEventListener("keydown", onKey, true);
    $$("[data-i]", scrim).forEach((b) => (b.onclick = () => pick(btns[+b.dataset.i])));
    requestAnimationFrame(() => (field || sel || $$(".modal-actions .btn", scrim).at(-1)).focus());
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
const syncReviewItems = () => (S.data?.sync?.pending || []).filter((p) => p.status === "review");

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
  await refreshNotify();
  await refreshTracker();
  renderNav();
  renderFoot(S.data.status);
  const editing = document.activeElement && $("#main").contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (editing) S.stale = true;
  else renderView();
  if (S.detail && S.host === "drawer" && !isDirty()) openForm(S.detail.id, { keepPage: true, silent: true });
  checkNamePairs();
  checkContactTies(); // skips itself while the name-typo question is open
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
  const review = active().filter(inQueue).length + syncReviewItems().length;
  const unlogged = parsed().filter((f) => !f.logged).length;
  const items = [
    ["overview", "Overview", ""],
    ["paperwork", "Paperwork", active().length],
    ["review", "Review", review, review > 0],
    ["cadets", "Cadets", ""],
    ["balances", "Balances", S.data.tracker_owing || ""],
    ["export", "Sheet export", unlogged],
    ["notifications", "Notifications", ""],
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
  const [path, q] = h.split("?");
  const [view, sub] = path.split("/");
  const valid = ["overview", "paperwork", "review", "cadets", "balances", "export", "notifications", "archive", "settings"];
  S.view = valid.includes(view) ? view : "overview";
  if (S.view === "settings" && SET_TABS.some(([k]) => k === sub)) S.setTab = sub;
  if (S.host === "review" && S.view !== "review") closeDetail();
  if (S.host === "drawer" && !(q || "").includes("f=")) {
    if (!(await okToDiscard())) return;
    closeDetail();
  }
  await refreshNotify();
  await refreshTracker();
  renderNav();
  renderView();
  const params = new URLSearchParams(q || "");
  if (params.get("f")) openForm(params.get("f"));
}
window.addEventListener("hashchange", route);

function renderView() {
  if (!S.data) return;
  const views = { overview: viewOverview, paperwork: viewPaperwork, review: viewReview, cadets: viewCadets, balances: viewBalances, export: viewExport, notifications: viewNotifications, archive: viewArchive, settings: viewSettings };
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
      <p>Drag paperwork PDFs onto this window, or use <b>Add files</b> on the Paperwork page. Name them like <b>John Doe_Neg_F10_Uniform Violation.pdf</b>.</p>
      <div style="display:flex;gap:10px;justify-content:center;margin-top:18px">
        <button class="btn primary" type="button" id="emptyAdd">${icon("upload")}Add files</button>
        <button class="btn" type="button" id="emptyChoose">Use a different folder</button></div></div></div>`;
    $("#emptyAdd").onclick = bulkUpload;
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
  $$('[data-status="awaiting"]').forEach((a) => (a.onclick = () => { S.f.step = "open"; }));
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
  openPop = null; // the toolbar is rebuilt below
  $("#main").innerHTML = head("Paperwork", "Every form in the dump folder. Click one to see what was detected, fix anything, or record a new signature.") + banners() + `
    <div class="toolbar">
      <label class="search">${icon("search")}<input class="input" id="q" type="search" placeholder="Search names, reasons, issuers, files" value="${esc(S.f.q)}" aria-label="Search paperwork"></label>
      <span id="filterBox"></span>
      <span class="spacer"></span>
      <button class="btn ghost small" type="button" id="bulkUpload" title="Pick PDFs to add to the dump folder">${icon("upload")}Add files</button>
      ${autoMenuHtml()}
      ${syncMode()
        ? `<button class="btn small" type="button" id="quickDump" ${syncBusy ? "disabled" : ""} title="Pull signed copies back in, then push every form to the folder for its next step">${icon("refresh")}Sync</button>`
        : `<button class="btn ghost small" type="button" id="quickDump" title="Sort every form into a folder by the first step it is still waiting on">${icon("download")}Quick dump</button>`}
    </div>
    <div class="toolbar chips" id="filterChips"></div>
    <div id="results"></div>`;
  $("#q").oninput = (e) => { S.f.q = e.target.value; renderPaperRows(); };
  $("#bulkUpload").onclick = bulkUpload;
  $("#bulkDownload").onclick = () => { closePop(); bulkDownloadBySignature(); };
  $("#bulkSqccf").onclick = () => { closePop(); bulkStep("sqccf_processed"); };
  $("#bulkCc").onclick = () => { closePop(); bulkStep("cadet_cc_initialed"); };
  $("#quickDump").onclick = syncMode() ? runSync : quickDump;
  $("#autoBtn").onclick = () => togglePop("autoBtn", "autoMenu");
  renderPaperRows();
}

// "Complete steps": the automated actions that write initials and dates into every waiting form.
function autoMenuHtml() {
  const waiting = (k) => active().filter((f) => f.parsed && f.record[k] === false).length;
  const item = (id, k, title, tip) => `<button type="button" id="${id}" ${waiting(k) ? "" : "disabled"}><span><b>${title}</b><small>${tip}</small></span><em>${waiting(k)}</em></button>`;
  return `<div class="pop-wrap"><button type="button" class="btn ghost small" id="autoBtn" aria-expanded="false" aria-controls="autoMenu" title="Complete a step for every waiting form, or download forms by signature">${icon("check")}Actions</button>
    <div class="pop-panel menu-panel" id="autoMenu" hidden>
      <div class="menu-head">Complete a step for all waiting forms</div>
      ${item("bulkSqccf", "sqccf_processed", "SQ/CCF initials", "Your initials and today's date on every form waiting for SQ/CCF")}
      ${item("bulkCc", "cadet_cc_initialed", "Cadet Commander initials", "The commander's initials and today's date on every form waiting for them")}
      <div class="menu-sep"></div>
      <button type="button" id="bulkDownload"><span><b>Download by signature…</b><small>Copy every form still waiting on a chosen signature into a folder</small></span></button>
    </div></div>`;
}

// ---- filter presets: one Filter button, one panel. Three groups of presets (how far along a form is,
// which form it is, positive or negative); one choice per group, groups combine. Counts follow the
// other groups, so a preset that would show nothing isn't offered.
const FILTER_OFF = { q: "", type: "all", pn: "all", step: "all" };
const firstOpen = (f) => (f.parsed ? FLAGS.find(([k]) => f.record[k] === false)?.[0] ?? "complete" : null);

function matchesFilters(f, F, skip = "") {
  const r = f.record || {};
  const q = F.q.trim().toLowerCase();
  if (skip !== "type" && F.type !== "all" && r.form_type !== F.type) return false;
  if (skip !== "pn" && F.pn !== "all" && r.pos_neg !== F.pn) return false;
  if (skip !== "step" && F.step !== "all") {
    const st = firstOpen(f);
    if (F.step === "review") { if (!f.needs_review) return false; }
    else if (F.step === "open" ? !st || st === "complete" : st !== F.step) return false;
  }
  if (q) {
    const hay = [f.filename, r.recipients, r.reason_category, r.reason_details, r.issuer, r.class_year, f.notes].join(" ").toLowerCase();
    if (!q.split(/\s+/).every((t) => hay.includes(t))) return false;
  }
  return true;
}

// Popovers (the filter panel and the "Complete steps" menu) close on an outside click or Escape.
let openPop = null;
function closePop() {
  if (!openPop) return;
  $(`#${openPop.panel}`)?.setAttribute("hidden", "");
  $(`#${openPop.btn}`)?.setAttribute("aria-expanded", "false");
  openPop = null;
}
function togglePop(btn, panel) {
  const was = openPop?.panel === panel;
  closePop();
  if (was) return;
  $(`#${panel}`)?.removeAttribute("hidden");
  $(`#${btn}`)?.setAttribute("aria-expanded", "true");
  openPop = { btn, panel };
}
document.addEventListener("click", (e) => { if (openPop && !e.target.closest(".pop-wrap")) closePop(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && openPop && !modalOpen()) closePop(); });

function renderFilters() {
  const box = $("#filterBox");
  const chipsEl = $("#filterChips");
  if (!box || !chipsEl) return;
  const keep = openPop?.panel === "filterPanel";
  const pool = (S.data.forms || []).filter((f) => !f.archived);
  const facet = (key) => pool.filter((f) => matchesFilters(f, S.f, key));
  const stepF = facet("step");
  const steps = [["all", "Any progress", stepF.length], ["review", "Needs review", stepF.filter((f) => f.needs_review).length], ["open", "Still needs a signature", stepF.filter((f) => { const s = firstOpen(f); return s && s !== "complete"; }).length],
    ...FLAGS.map(([k, short]) => [k, `Needs ${short}`, stepF.filter((f) => firstOpen(f) === k).length]), ["complete", "Fully complete", stepF.filter((f) => firstOpen(f) === "complete").length]];
  const typeF = facet("type");
  const types = [["all", "Any form", typeF.length], ["F10", "Form 10", typeF.filter((f) => f.record.form_type === "F10").length], ["F174", "AF 174", typeF.filter((f) => f.record.form_type === "F174").length]];
  const pnF = facet("pn");
  const pns = [["all", "Positive or negative", pnF.length], ["Pos", "Positive", pnF.filter((f) => f.record.pos_neg === "Pos").length], ["Neg", "Negative", pnF.filter((f) => f.record.pos_neg === "Neg").length]];
  const groups = [["step", "Progress", steps], ["type", "Form", types], ["pn", "Result", pns]];
  const on = groups.filter(([k]) => S.f[k] !== "all");
  const section = ([key, label, opts]) => `<div class="fgroup"><h4>${label}</h4>${opts
    .filter(([v, , n]) => v === "all" || v === S.f[key] || n !== 0)
    .map(([v, l, n]) => `<button type="button" data-filter="${key}" data-v="${esc(v)}" aria-pressed="${S.f[key] === v}"><span>${esc(l)}</span><em>${n}</em></button>`).join("")}</div>`;
  box.innerHTML = `<div class="pop-wrap"><button type="button" class="btn small ${on.length ? "" : "ghost"}" id="filterBtn" aria-expanded="${keep}" aria-controls="filterPanel">${icon("search")}Filter${on.length ? ` · ${on.length}` : ""}</button>
    <div class="pop-panel filter-panel" id="filterPanel" ${keep ? "" : "hidden"}>${groups.map(section).join("")}</div></div><span id="countLbl"></span>`;
  chipsEl.innerHTML = on.map(([key, label, opts]) => `<button type="button" class="fchip" data-unfilter="${key}" title="Remove this filter">${esc(opts.find(([v]) => v === S.f[key])?.[1] ?? S.f[key])}${icon("x")}</button>`).join("")
    + (on.length ? `<button type="button" class="btn ghost small" id="clearFilters">${icon("x")}Clear</button>` : "");
  $("#filterBtn").onclick = () => togglePop("filterBtn", "filterPanel");
  $$("[data-filter]", box).forEach((b) => (b.onclick = () => { S.f[b.dataset.filter] = b.dataset.v; renderPaperRows(); }));
  $$("[data-unfilter]", chipsEl).forEach((b) => (b.onclick = () => { S.f[b.dataset.unfilter] = "all"; renderPaperRows(); }));
  const clr = $("#clearFilters");
  if (clr) {
    clr.onclick = () => {
      Object.assign(S.f, FILTER_OFF);
      const q = $("#q");
      if (q) q.value = "";
      renderPaperRows();
    };
  }
}

function filteredForms() {
  let list = (S.data.forms || []).filter((f) => !f.archived && matchesFilters(f, S.f));
  const { key, dir } = S.sort;
  const val = (f) => key === "date" ? (f.record.date_iso || "") : key === "who" ? (f.record.recipients || f.filename).toLowerCase()
    : key === "type" ? (f.record.form_type || "") : key === "issuer" ? (f.record.issuer || "").toLowerCase() : "";
  list.sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * dir || a.filename.localeCompare(b.filename));
  return list;
}

function renderPaperRows() {
  const list = filteredForms();
  renderFilters();
  const total = (S.data.forms || []).filter((f) => !f.archived).length;
  $("#countLbl").textContent = list.length === total ? plural(total, "form") : `${list.length} of ${plural(total, "form")}`;
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
  if (a.scanned_copy) chips.push('<span class="chip warn" title="Printed, signed and scanned back in. The values from the earlier read are kept.">Scanned copy</span>');
  else if (a.mode) chips.push(`<span class="chip ${a.mode === "fields" ? "" : "warn"}">${MODE_LABEL[a.mode]}</span>`);
  if (a.page_count) chips.push(`<span class="chip">${plural(a.page_count, "page")}</span>`);
  if (d.needs_review) chips.push('<span class="chip crit">Needs review</span>');
  else if (d.reviewed) chips.push(`<span class="chip good" title="${esc(fmtStamp(d.reviewed_at))}">Reviewed</span>`);
  if (d.logged) chips.push(`<span class="chip good" title="${esc(fmtStamp(d.logged_at))}">In tracker</span>`);
  if (d.missing) chips.push('<span class="chip crit">File missing from dump</span>');
  if (d.archived) chips.push(`<span class="chip muted" title="${esc(fmtStamp(d.archived_at))}">Archived</span>`);
  return `<header class="d-head"><div style="min-width:0"><h2>${names ? esc(names) : `<span style="color:var(--muted)">${d.parsed ? "No name on the form" : "Reading…"}</span>`}</h2><div class="fn">${esc(d.filename)}</div><div class="chips">${chips.join("")}</div></div>
    <div class="spacer"></div><div class="acts">
      <button class="btn ghost small" type="button" data-act="openpdf" title="Open in your PDF viewer (Shift-click: show in folder)">${icon("ext")}Open PDF</button>
      <button class="btn ghost small" type="button" data-act="download" title="Save a copy of this PDF">${icon("download")}Download</button>
      <button class="btn ghost small" type="button" data-act="upload" title="Replace this PDF with an updated (e.g. signed) copy">${icon("upload")}Upload updated copy</button>
      <button class="btn ghost small" type="button" data-act="copyrows">${icon("copy")}Copy sheet rows</button>
      <button class="btn ghost small" type="button" data-act="reparse" title="Read the PDF again (your edits are kept)">${icon("refresh")}Re-read</button>
      ${d.archived
        ? `<button class="btn ghost small" type="button" data-act="unarchive" title="Count this form again">${icon("archive")}Restore</button>`
        : `<button class="btn ghost small" type="button" data-act="archive" title="Keep the file and its record, but leave it out of stats and exports">${icon("archive")}Archive</button>`}
      ${S.host === "drawer" ? `<button class="icon-btn" type="button" data-act="close" aria-label="Close">${icon("x")}</button>` : ""}
    </div></header>`;
}

const zoomOf = () => S.zoom[S.host === "review" ? "review" : "drawer"];

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
      <span class="seg" role="group" aria-label="Zoom">${[1, 1.5, 2].map((v) => `<button type="button" data-zoom="${v}" aria-pressed="${v === zoomOf()}" title="Preview size">${v === 1 ? "Fit" : v * 100 + "%"}</button>`).join("")}</span>
      ${S.host === "review" ? `<button type="button" class="btn ghost small" data-wide aria-pressed="${S.wide}" title="Give the page the whole width of the card">${S.wide ? "Show fields" : "Expand preview"}</button>` : ""}
      <label><input class="chk" type="checkbox" id="boxToggle" ${S.boxes ? "checked" : ""}> Show detected fields</label></div>
    <div class="sheet ${S.boxes ? "" : "nobox"}" style="aspect-ratio:${cur.w}/${cur.h};width:${zoomOf() * 100}%"><img src="closet://page/${d.id}/${cur.page}?v=${encodeURIComponent(d.parsed_at || "")}" alt="Page ${cur.page + 1} of ${esc(d.filename)}" loading="lazy">${boxes}</div>
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
  const n = FLAGS.length;
  let lastDone = -1;
  vals.forEach((v, i) => { if (v === true && (i === 0 || lastDone === i - 1)) lastDone = i; });
  const span = 100 - 100 / n;
  const fillW = lastDone <= 0 ? 0 : (lastDone / (n - 1)) * span;
  return `<div class="route-lg" style="--n:${n}"><span class="fill" style="width:${fillW}%"></span>${FLAGS.map(([k, short, long], i) => {
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

// One-click completion of a step on this form: the same initials/date the bulk buttons write, or
// (AOC/AMT only, and only ever one form at a time) the unofficial "approved" stamp.
function autoButtons(d) {
  const r = d.record;
  const dirty = isDirty();
  const btn = (k, label, act, tip) => (r[k] === false
    ? `<button class="btn small" type="button" data-act="${act}" ${dirty ? "disabled" : ""} data-tip="${esc(tip)}" title="${esc(dirty ? "Save your changes first" : tip)}">${icon("check")}${label}</button>` : "");
  const html = btn("sqccf_processed", "Initial for SQ/CCF", "auto:sqccf_processed", "Write your SQ/CCF initials (and the date) into this form and mark the step done")
    + btn("cadet_cc_initialed", "Initial for Cadet CC", "auto:cadet_cc_initialed", "Write the Cadet Commander initials and date into this form and mark the step done")
    + btn("aoc_signed", "Mark AOC/AMT approved…", "auto:approve", "The AMT approved it but sent no signed copy: stamp it and mark the step done");
  return html ? `<div class="auto-row"><span class="lbl">Complete a step</span>${html}</div>` : "";
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
    <div class="section-title">Routing</div>${routeBig(d)}${autoButtons(d)}
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
  $$(".auto-row .btn", root).forEach((b) => { b.disabled = isDirty(); b.title = isDirty() ? "Save your changes first" : b.dataset.tip || ""; });
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
  const wide = $("[data-wide]", root);
  if (wide) wide.onclick = () => {
    S.wide = !S.wide;
    wide.setAttribute("aria-pressed", S.wide);
    wide.textContent = S.wide ? "Show fields" : "Expand preview";
    $(".review-layout")?.classList.toggle("wide", S.wide);
    $(".review-card", root)?.classList.toggle("wide", S.wide);
  };
  $$("[data-zoom]", root).forEach((b) => (b.onclick = () => {
    S.zoom[S.host === "review" ? "review" : "drawer"] = +b.dataset.zoom;
    $$("[data-zoom]", root).forEach((x) => x.setAttribute("aria-pressed", x === b));
    const sh = $(".sheet", root);
    if (sh) sh.style.width = b.dataset.zoom * 100 + "%";
  }));
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
  if (a.startsWith("auto:")) return autoProcess(a.slice(5));
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
  if (a === "download") {
    const r = await closet.downloadPdf(d.id);
    if (r?.ok) toast(`Saved a copy to ${r.path}`);
    else if (r?.error) toast(r.error, true);
    return;
  }
  if (a === "upload") {
    const r = await closet.uploadReplacement(d.id);
    if (r?.ok) {
      toast("Replaced with the updated copy. Reading it again…");
      setTimeout(async () => { await load(); if (S.detail?.id === d.id) openForm(d.id, { keepPage: true, silent: true, host: S.host }); }, 1500);
    } else if (r?.error) toast(r.error, true);
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
    const tie = (S.data.notify?.ties || []).find((t) => t.key === nameKey(n)); // a contact that might be this cadet's email
    if (!y || tie) {
      const ans = await ask({
        title: `${y ? "Email for" : "Class year for"} ${n}?`,
        message: `Recipient ${i + 1} of ${names.length}. ${y ? "" : "Leave the class year blank if you don't know it."}`,
        input: y ? null : { placeholder: "e.g. 2028", validate: (t) => (!t || normYear(t) ? "" : `"${t}" isn't a class year. Enter something like 2028.`) },
        extra: tie ? { label: `Is one of these ${n}'s email?`, options: [...tie.candidates.map((c) => [c.id, `Yes: ${c.name} <${c.email}>`]), ["", "Not sure yet"], ["no", "No, none of these"]], value: tie.candidates[0].id } : null,
        choices: [{ label: "Cancel save", value: null }, { label: i + 1 < names.length ? "Next" : "Save", value: true, primary: true }],
      });
      if (ans === null) return false;
      if (!y) y = ans && ans !== true ? normYear(ans) : "";
      const pick = ask.extra;
      if (tie && pick) {
        try {
          if (pick === "no") for (const c of tie.candidates) await api("/api/notify/tie", { method: "POST", body: { id: c.id, cadet: n, yes: false } });
          else await api("/api/notify/tie", { method: "POST", body: { id: pick, cadet: n, yes: true } });
        } catch (err) { toast("Couldn't save the email link: " + err.message, true); }
      }
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
  const syncItems = syncReviewItems();
  if (!queue.length && !done.length && !syncItems.length) {
    $("#main").innerHTML = head("Review", "Forms that don't match their template closely enough to trust, and positive F10s still missing CDNA or Passes.") + `
      <div class="panel"><div class="empty">${icon("inbox0")}<h3>Nothing to review</h3><p>Every form matched its template and every positive F10 has CDNA and Passes. Anything with extra pages, missing fields, a scan, a filename without Pos/Neg, or missing CDNA/Passes will show up here.</p></div></div>`;
    closeDetail();
    return;
  }
  const isSync = (id) => typeof id === "string" && id.startsWith("sync:");
  const valid = isSync(S.reviewId) ? syncItems.some((p) => "sync:" + p.token === S.reviewId) : all.some((f) => f.id === S.reviewId);
  if (!S.reviewId || !valid) S.reviewId = syncItems.length ? "sync:" + syncItems[0].token : (queue[0] || done[0]).id;
  const item = (f) => `<button type="button" data-rid="${f.id}" aria-current="${f.id === S.reviewId}">
      <div class="t">${whoLine(f.record || {}, f.filename)}</div><div class="s">${esc(f.filename)}</div>
      ${f.needs_review ? `<div class="why">${esc((f.issues.find((i) => i.level === "review") || {}).text || "")}</div>`
        : isIncomplete(f) ? `<div class="why" style="color:#ebc673">Positive F10 missing ${esc(f.incomplete.join(" and "))}</div>`
        : `<div class="s" style="color:var(--good)">Reviewed ${esc(fmtStamp(f.reviewed_at))}</div>`}</button>`;
  const syncItem = (p) => {
    const f = (S.data.forms || []).find((x) => x.id === p.review_id);
    return `<button type="button" data-sid="${p.token}" aria-current="${"sync:" + p.token === S.reviewId}">
      <div class="t">${esc(p.filename)}</div><div class="s">${f ? "Matched to " + esc(f.filename) : "Check the match"}</div><div class="why" style="color:#ebc673">Pulled by sync: compare it with the form</div></button>`;
  };
  const todo = queue.length + syncItems.length;
  $("#main").innerHTML = head("Review", `${todo ? plural(todo, "form needs", "forms need") + " a look." : "The queue is clear."} Your corrections are saved with the form, and a reviewed form doesn't come back to the queue.`) + `
    <div class="review-layout ${S.wide ? "wide" : ""}"><nav class="queue" aria-label="Review queue">
      ${syncItems.length ? `<div class="group">Sync matches to check (${syncItems.length})</div>${syncItems.map(syncItem).join("")}` : ""}
      ${waiting.length ? `<div class="group">Needs review (${waiting.length})</div>${waiting.map(item).join("")}` : ""}
      ${incomplete.length ? `<div class="group">Incomplete (${incomplete.length})</div>${incomplete.map(item).join("")}` : ""}
      ${done.length ? `<div class="group">Reviewed (${done.length})</div>${done.map(item).join("")}` : ""}
    </nav><div id="reviewPane"><div class="review-card"><div class="empty">Loading…</div></div></div></div>`;
  $$("[data-rid]").forEach((b) => (b.onclick = async () => {
    if (!(await okToDiscard())) return;
    S.edit = null;
    S.reviewId = b.dataset.rid;
    $$("[data-rid],[data-sid]").forEach((x) => x.setAttribute("aria-current", x === b));
    openForm(S.reviewId, { host: "review" });
  }));
  $$("[data-sid]").forEach((b) => (b.onclick = async () => {
    if (!(await okToDiscard())) return;
    closeDetail();
    S.reviewId = "sync:" + b.dataset.sid;
    $$("[data-rid],[data-sid]").forEach((x) => x.setAttribute("aria-current", x === b));
    renderSyncReview(b.dataset.sid);
  }));
  if (isSync(S.reviewId)) {
    if (S.detail || S.host) closeDetail();
    renderSyncReview(S.reviewId.slice(5));
    return;
  }
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
  pane.innerHTML = `<div class="review-card ${S.wide ? "wide" : ""}">${detailHead(S.detail)}${detailInner(S.detail)}${saveBar()}</div>`;
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
  return list.filter((f) => (S.exportMode !== "unlogged" || !f.logged) && (S.exportPn === "all" || f.record.pos_neg === S.exportPn));
}
function viewExport() {
  const cols = S.data.columns;
  $("#main").innerHTML = head("Sheet export", "Rows in the same column order as the Conduct Log (A to M). Copy them, click the first empty Date cell in the tracker, and paste. A form with several recipients gives one row per person.") + `
    <div class="toolbar"><div class="seg" role="group">
      ${[["unlogged", "Not in tracker yet"], ["all", "All paperwork"]].map(([v, l]) => `<button type="button" data-em="${v}" aria-pressed="${S.exportMode === v}">${l}</button>`).join("")}</div>
      <div class="seg" role="group" aria-label="Positive or negative">
      ${[["Neg", "Negative only"], ["Pos", "Positive only"]].map(([v, l]) => `<button type="button" title="Click again to show both" data-epn="${v}" aria-pressed="${S.exportPn === v}">${l}</button>`).join("")}</div>
      <span class="spacer"></span><button class="btn ghost small" type="button" id="selAll">Select all</button><button class="btn ghost small" type="button" id="selNone">Clear selection</button></div>
    <div id="results"></div>`;
  $$("[data-em]").forEach((b) => (b.onclick = () => { S.exportMode = b.dataset.em; S.exportPicked.clear(); viewExport(); }));
  $$("[data-epn]").forEach((b) => (b.onclick = () => { S.exportPn = S.exportPn === b.dataset.epn ? "all" : b.dataset.epn; S.exportPicked.clear(); viewExport(); }));
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
    $("#results").innerHTML = `<div class="panel"><div class="empty">${icon("check")}<h3>${S.exportPn !== "all" ? `No ${S.exportPn === "Pos" ? "positive" : "negative"} paperwork here` : S.exportMode === "unlogged" ? "The tracker is up to date" : "No paperwork yet"}</h3><p>${S.exportPn !== "all" ? "Click the highlighted filter again, or switch to All paperwork, to see more." : S.exportMode === "unlogged" ? "Every form has been marked as logged. Switch to All paperwork to copy rows again." : ""}</p></div></div>`;
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
// Settings is split into sub-tabs behind a bar fixed to the top of the page, so a setting is one
// click away instead of somewhere down a long scroll. The open tab lives in the URL (#/settings/data).
const SET_TABS = [
  ["general", "General", "Tracker values and how forms are read"],
  ["routing", "Routing and sync", "Bulk initials, quick dump, sync folders"],
  ["sheet", "Discipline sheet", "The workbook that tracks served tours and confinements"],
  ["notify", "Push notifications", "Gmail, the contact list, what the emails say, automatic updates"],
  ["data", "Data and backup", "Folders, backup and restore, start over"],
  ["updates", "Updates", "Automatic updates for closet itself"],
];

const setRow = (title, desc, control) => `<div class="set-row"><div><h3>${title}</h3><p>${desc}</p></div><div>${control}</div></div>`;
const setSelect = (key, opts, cur, bool = false) => `<select class="select" data-set="${key}" ${bool ? 'data-bool="1"' : ""}>${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(cur) === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;

function settingsGeneral(s) {
  return `
    <section class="panel"><div class="panel-head"><h2>Tracker values</h2><span class="sub">match the dropdown options in your sheet</span></div><div class="panel-body">
      ${setRow("Form type labels", "Written in the Form Type column.", `<div class="pair"><input class="input" data-set="form_type_labels.F10" value="${esc(s.form_type_labels.F10)}" aria-label="F10 label"><input class="input" data-set="form_type_labels.F174" value="${esc(s.form_type_labels.F174)}" aria-label="F174 label"></div>`)}
      ${setRow("Pos/Neg labels", "Written in the Pos/Neg column.", `<div class="pair"><input class="input" data-set="pos_label" value="${esc(s.pos_label)}" aria-label="Positive label"><input class="input" data-set="neg_label" value="${esc(s.neg_label)}" aria-label="Negative label"></div>`)}
      ${setRow("Month column", "How the Month column is written.", setSelect("month_format", [["name", "September"], ["short", "Sep"], ["name_year", "September 2026"], ["iso", "2026-09"], ["number", "9"]], s.month_format))}
    </div></section>
    <section class="panel"><div class="panel-head"><h2>Reading forms</h2></div><div class="panel-body">
      ${setRow("AF 174 commander block", "Whether the Commander's Comments block on an AF 174 counts as the AOC/AMT signature.", setSelect("f174_commander_role", [["aoc_signed", "Counts as AOC/AMT"], ["none", "Doesn't count"]], s.f174_commander_role))}
      ${setRow("Position tolerance", "A field counts as matching the template when every edge is within this many points (1 pt ≈ 1 px at 72 dpi). Changing it re-reads every form.", `<input class="input" type="number" min="2" max="40" step="1" data-set="position_tolerance_pt" value="${esc(s.position_tolerance_pt)}">`)}
    </div></section>`;
}

function settingsRouting(s) {
  return `
    <section class="panel"><div class="panel-head"><h2>Bulk initials</h2><span class="sub">for the SQ/CCF and Cadet CC buttons on Paperwork</span></div><div class="panel-body">
      ${setRow("SQ/CCF initials", "Entered once and remembered. Written into the SQ/CCF initials box when you use the SQ/CCF initials button.", `<input class="input" maxlength="8" data-set="bulk_initials.sqccf_processed" value="${esc(s.bulk_initials?.sqccf_processed || "")}" aria-label="SQ/CCF initials">`)}
      ${setRow("Fill in today's date for SQ/CCF", "The SQ/CCF button also writes today's date in the log-in date box when it's empty. A date already on the form is never changed.", setSelect("first_shirt_fill_date", [["1", "Yes, fill it in"], ["0", "No, initials only"]], s.first_shirt_fill_date ? "1" : "0", true))}
      ${setRow("Cadet Commander initials", "Entered once and remembered. The Cadet CC button also dates the box (Section V, box 3) with today's date.", `<input class="input" maxlength="8" data-set="bulk_initials.cadet_cc_initialed" value="${esc(s.bulk_initials?.cadet_cc_initialed || "")}" aria-label="Cadet Commander initials">`)}
    </div></section>
    <section class="panel"><div class="panel-head"><h2>Quick dump and sync</h2><span class="sub">how paperwork gets out for signatures</span></div><div class="panel-body">
      ${setRow("Mode", "Quick dump copies every form into one folder, sorted by the next step it needs. Sync gives each step its own send and returned folders: pressing Sync pulls signed copies back in, then sends everything out again.", setSelect("dump_mode", [["quick", "Quick dump"], ["sync", "Sync"]], s.dump_mode))}
      ${setRow("Combined print packet", "Also write one printable PDF (an index sheet plus every form waiting on AOC/AMT) into the AOC/AMT folder.", setSelect("print_packet", [["0", "Off"], ["1", "On"]], s.print_packet ? "1" : "0", true))}
      ${s.dump_mode === "sync" ? `<p class="sync-note">Sync has been on since ${esc(fmtStamp(S.data.sync?.since) || "just now")}: only files added to a returned folder after that are pulled${S.data.sync?.last_sync ? `. Last sync ${esc(fmtStamp(S.data.sync.last_sync))}` : ""}. A step with no folder is skipped. closet only ever removes copies it put in a send folder itself.</p>` : ""}
    </div></section>
    ${s.dump_mode === "sync" ? `<section class="panel"><div class="panel-head"><h2>Sync folders</h2><span class="sub">send = copies for signing, returned = signed copies come back</span></div><div class="panel-body">
      ${SYNC_STEPS().map(([key, name, desc, hasPush, hasPull]) => {
        const cell = (dir, label) => {
          const path = s.sync_folders?.[key]?.[dir] || "";
          return `<div class="sf"><span class="sf-l">${label}</span><div class="path">${path ? esc(path) : '<span class="dim">Not set, so this is skipped</span>'}</div>
            <div class="pair"><button class="btn small" type="button" data-sfc="${key}|${dir}">${icon("folder")}${path ? "Change…" : "Choose…"}</button>${path ? `<button class="btn small ghost" type="button" data-sfx="${key}|${dir}">Clear</button>` : ""}</div></div>`;
        };
        return setRow(esc(name), esc(desc), (hasPush ? cell("push", "Send") : "") + (hasPull ? cell("pull", "Returned") : ""));
      }).join("")}
    </div></section>` : ""}`;
}

function settingsData(s) {
  return `
    <section class="panel"><div class="panel-head"><h2>Folders</h2></div><div class="panel-body">
      ${setRow("Dump folder", "Where closet keeps your paperwork. By default it's inside the app's data folder, so you never need to open it: add PDFs with Add files or by dragging them onto the window. Nothing is ever moved or changed.",
        `<div class="path">${esc(S.data.dump_dir)}</div><div class="pair" style="margin-top:8px"><button class="btn small" type="button" id="dumpOpen">${icon("folder")}Open</button><button class="btn small" type="button" id="dumpChoose">Change…</button></div>`)}
      ${s.dump_mode === "sync" ? "" : setRow("Quick dump folder", "Where Quick dump writes its sorted folders and the AOC/AMT print packet. Copies only; each run refreshes the five step folders.",
        `<div class="path">${esc(S.data.quick_dump_dir)}</div><div class="pair" style="margin-top:8px"><button class="btn small" type="button" id="quickOpen">${icon("folder")}Open</button><button class="btn small" type="button" id="quickChoose">Change…</button></div>`)}
      ${setRow("Metadata folder", "Cached reads, page images, and your edits. It sits next to the dump folder; back both up together.",
        `<div class="path">${esc(S.data.meta_dir)}</div><div class="pair" style="margin-top:8px"><button class="btn small" type="button" id="metaOpen">${icon("folder")}Open</button></div>`)}
      ${setRow("Templates", "The blank AFCW Form 10 and AF Form 174 every form is compared against. They're built into the app.", `<div class="path">Built in</div>`)}
    </div></section>
    <section class="panel"><div class="panel-head"><h2>Backup and restore</h2><span class="sub">before trying something risky</span></div><div class="panel-body">
      ${setRow("Export a backup", "Saves everything into one zip file: every PDF in the dump folder, your edits, reviews, name answers, the contact list, settings, sync state, and the originals closet kept when it edited a PDF. Page images are left out (they're rebuilt). The Gmail password is never included.",
        `<button class="btn" type="button" id="backupExport">${icon("download")}Export backup…</button>`)}
      ${setRow("Restore from a backup", "Replaces the PDFs in the dump folder and everything in the metadata folder with what's in a backup file. The backup is checked first, and what you have now is saved to a safety backup before anything is replaced.",
        `<button class="btn" type="button" id="backupImport" style="border-color:rgba(226,85,85,.5);color:#f0a3a3">${icon("upload")}Import backup…</button>`)}
    </div></section>
    <section class="panel"><div class="panel-head"><h2>Start over</h2></div><div class="panel-body">
      ${setRow("Clear metadata and rescan", "Forgets everything closet has recorded and reads every PDF in the dump folder again from scratch. This erases your edits, reviews, signatures set by hand, archive choices, and “logged” marks. Settings and the contact list are kept, and the PDFs themselves are never touched.",
        `<button class="btn" type="button" id="resetAll" style="border-color:rgba(226,85,85,.5);color:#f0a3a3">${icon("refresh")}Clear metadata and rescan</button>`)}
    </div></section>`;
}

function settingsUpdates() {
  return `<section class="panel"><div class="panel-head"><h2>Updates</h2></div><div class="panel-body" id="updBody"></div></section>`;
}

function viewSettings() {
  const s = S.data.settings;
  const tab = SET_TABS.some(([k]) => k === S.setTab) ? S.setTab : "general";
  const body = { general: () => settingsGeneral(s), routing: () => settingsRouting(s), sheet: () => settingsSheet(), notify: () => settingsNotify(), data: () => settingsData(s), updates: settingsUpdates }[tab]();
  const [, , blurb] = SET_TABS.find(([k]) => k === tab);
  if (S.lastSetTab !== tab) { window.scrollTo(0, 0); S.lastSetTab = tab; } // a new tab starts at its top, not wherever the last one was scrolled
  $("#main").innerHTML = head("Settings", esc(blurb)) +
    `<nav class="set-tabs" aria-label="Settings sections">${SET_TABS.map(([k, label]) => `<a href="#/settings/${k}" ${k === tab ? 'aria-current="page"' : ""}>${esc(label)}</a>`).join("")}</nav>
    <div class="settings ${tab === "notify" || tab === "sheet" ? "wide" : ""}">${body}</div>`;
  if (tab === "updates") closet.updates.state().then(renderUpdates);
  if (tab === "notify") bindSettingsNotify();
  if (tab === "sheet") bindSettingsSheet();
  const click = (sel, fn) => { const el = $(sel); if (el) el.onclick = fn; };
  click("#dumpOpen", () => closet.openFolder("dump"));
  click("#metaOpen", () => closet.openFolder("meta"));
  click("#quickOpen", () => closet.openFolder("quickdump"));
  click("#quickChoose", async () => {
    const dir = await closet.chooseQuickDumpFolder();
    if (dir) { toast(`Quick dump will use ${dir}`); await load(); }
  });
  $$("[data-sfc]").forEach((b) => (b.onclick = async () => {
    const [key, dir] = b.dataset.sfc.split("|");
    const r = await closet.chooseSyncFolder(key, dir);
    if (r?.ok) { toast("Folder saved"); await load(); } else if (r?.error) toast(r.error, true);
  }));
  $$("[data-sfx]").forEach((b) => (b.onclick = async () => {
    const [key, dir] = b.dataset.sfx.split("|");
    const r = await closet.clearSyncFolder(key, dir);
    if (r?.ok) { toast("Folder cleared. That step is skipped now."); await load(); } else if (r?.error) toast(r.error, true);
  }));
  click("#dumpChoose", chooseDump);
  click("#backupExport", exportBackup);
  click("#backupImport", importBackup);
  click("#resetAll", async () => {
    const all = (S.data.forms || []).filter((f) => !f.missing);
    const n = all.length;
    const edited = all.filter((f) => f.reviewed || f.logged || f.archived || (f.record.overridden || []).length || f.notes).length;
    const msg = `Every one of the ${plural(n, "form")} will be read again from scratch.

` +
      (edited ? `${plural(edited, "form has", "forms have")} edits, reviews, archive, or logged marks. These will be lost.

` : "") +
      "Settings and the contact list are kept. The PDFs in the dump folder are not touched.";
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
  });
  $$("[data-set]").forEach((el) => (el.onchange = async () => {
    const path = el.dataset.set.split(".");
    let v = el.type === "number" ? Number(el.value) : el.dataset.bool ? el.value === "1" : el.value;
    const body = path.length === 2 ? { [path[0]]: { [path[1]]: v } } : { [path[0]]: v };
    try {
      await api("/api/settings", { method: "PUT", body });
      toast(path[0] === "position_tolerance_pt" ? "Saved. Re-reading every form…" : "Setting saved");
      await load();
    } catch (e) { toast("Couldn't save: " + e.message, true); }
  }));
}

// ------------------------------------------------------------------ balances and the discipline workbook
// What was assigned comes from the forms; what was served is read from the serving log of the
// workbook chosen in Settings → Discipline sheet. Balance = assigned - served, never below zero.
const needsTracker = () => S.view === "balances" || (S.view === "settings" && S.setTab === "sheet");
async function refreshTracker() {
  if (!needsTracker()) return;
  try { S.tv = await api("/api/tracker"); } catch (e) { toast("Couldn't load balances: " + e.message, true); }
}
const owe = (b) => (b.left ? `<b class="owe">${b.left}</b>` : '<span class="dim">0</span>');

function viewBalances() {
  const tv = S.tv;
  if (!tv) {
    $("#main").innerHTML = head("Balances", "Tours and confinements assigned, served, and still owed.") + '<p class="dim">Loading…</p>';
    refreshTracker().then(() => { if (S.view === "balances" && S.tv) viewBalances(); });
    return;
  }
  const t = tv.totals;
  const read = tv.pulled_at ? `Served counts read from the sheet ${esc(when(tv.pulled_at))}: ${plural(tv.entries, "serving record")}` : "";
  $("#main").innerHTML = head("Balances", "Tours and confinements assigned on forms, served according to your discipline workbook, and still owed.",
    tv.configured ? `<button class="btn small" type="button" id="tvPull">${icon("refresh")}Read the sheet now</button>` : "") + `
    ${!tv.configured ? `<div class="banner info">${icon("info")}<span>Nothing has been served as far as closet knows: no discipline workbook is set. <a href="#/settings/sheet">Choose one or create a new one</a> and the tours and confinements people have served are read from it.</span></div>` : ""}
    ${tv.error ? `<div class="banner">${icon("alert")}<span>${esc(tv.error)} <a href="#/settings/sheet">Open Discipline sheet settings</a></span></div>` : ""}
    ${tv.unmatched?.length ? `<div class="banner info">${icon("info")}<span>${plural(tv.unmatched.length, "name")} in the serving log ${tv.unmatched.length === 1 ? "has" : "have"} no paperwork in closet (${esc(tv.unmatched.slice(0, 4).join(", "))}${tv.unmatched.length > 4 ? ", …" : ""}). They're listed below as not on file; check the spelling in the sheet if one is a typo.</span></div>` : ""}
    <section class="kpis">
      <div class="kpi accent"><div class="v">${t.tours.left}</div><div class="l">Tours still to serve (${t.tours.served} of ${t.tours.assigned} served)</div></div>
      <div class="kpi accent"><div class="v">${t.confinements.left}</div><div class="l">Confinements still to serve (${t.confinements.served} of ${t.confinements.assigned} served)</div></div>
      <div class="kpi"><div class="v">${tv.balances.filter((p) => p.tours.left || p.confinements.left).length}</div><div class="l">Cadets with a balance</div></div>
    </section>
    <div class="toolbar"><label class="search">${icon("search")}<input class="input" id="bq" type="search" placeholder="Find a cadet" value="${esc(S.balQ)}" aria-label="Find a cadet"></label>
      <select class="select" id="bf" aria-label="Show">${[["owing", "Owing tours or confinements"], ["all", "Everyone"]].map(([v, l]) => `<option value="${v}" ${S.balF === v ? "selected" : ""}>${l}</option>`).join("")}</select>
      <span class="spacer"></span><span class="dim">${read}</span></div>
    <div id="results"></div>`;
  $("#bq").oninput = (e) => { S.balQ = e.target.value; renderBalanceRows(); };
  $("#bf").onchange = (e) => { S.balF = e.target.value; renderBalanceRows(); };
  const pull = $("#tvPull");
  if (pull) pull.onclick = async () => {
    const r = await api("/api/tracker/pull", { method: "POST" });
    if (r.ok) toast(`Read ${plural(r.entries, "serving record")}`); else toast(r.error, true);
    await load();
  };
  renderBalanceRows();
}

function renderBalanceRows() {
  const q = S.balQ.trim().toLowerCase();
  const list = S.tv.balances.filter((p) => (!q || `${p.name} ${p.class_year}`.toLowerCase().includes(q)) && (S.balF === "all" || p.tours.left || p.confinements.left))
    .sort((a, b) => (b.tours.left + b.confinements.left) - (a.tours.left + a.confinements.left) || a.name.localeCompare(b.name));
  if (!list.length) {
    $("#results").innerHTML = `<div class="panel"><div class="empty">${icon("check")}<h3>${S.tv.balances.length ? "Nobody matches" : "No cadets yet"}</h3><p>${S.tv.balances.length ? (S.balF === "owing" && !q ? "No one owes tours or confinements right now." : "Clear the search or show everyone.") : "Cadets appear once their paperwork is in the dump folder."}</p></div></div>`;
    return;
  }
  $("#results").innerHTML = `<div class="table-wrap"><table class="t"><thead><tr><th>Cadet</th><th>Class</th><th class="num" title="Assigned on forms">Tours assigned</th><th class="num">Served</th><th class="num">Left</th><th class="num">Confinements assigned</th><th class="num">Served</th><th class="num">Left</th><th>Status</th></tr></thead><tbody>
    ${list.map((p) => `<tr><td class="who">${esc(p.name)}</td><td>${esc(p.class_year) || '<span class="dim">—</span>'}</td>
      <td class="num">${p.tours.assigned}</td><td class="num">${p.tours.served}</td><td class="num">${owe(p.tours)}</td>
      <td class="num">${p.confinements.assigned}</td><td class="num">${p.confinements.served}</td><td class="num">${owe(p.confinements)}</td>
      <td>${!p.on_file ? '<span class="chip muted" title="Named in the serving log but no paperwork in closet">Not on file</span>' : p.tours.left || p.confinements.left ? '<span class="chip warn">Outstanding</span>' : p.tours.over || p.confinements.over ? '<span class="chip muted" title="Served more than was assigned">Over-served</span>' : '<span class="chip good">Clear</span>'}</td></tr>`).join("")}
    </tbody></table></div>`;
}

// ---- Settings → Discipline sheet
const SERVED_LABELS = { date: "Date served", cadet: "Cadet name", type: "Sanction type", amount: "Amount served", supervisor: "Supervisor", notes: "Notes" };

function settingsSheet() {
  const tv = S.tv;
  if (!tv) {
    refreshTracker().then(() => { if (S.view === "settings" && S.setTab === "sheet" && S.tv) viewSettings(); });
    return '<p class="dim">Loading…</p>';
  }
  const c = S.data.settings.tracker;
  const sv = c.served;
  const p = c.push;
  const txt = (key, val, attrs = "") => `<input class="input" data-tk="${key}" value="${esc(val)}" ${attrs}>`;
  const sw = (key, on, label) => `<label class="switch"><input type="checkbox" data-tkb="${key}" ${on ? "checked" : ""} aria-label="${esc(label)}"><span class="track"></span><span class="lbl">${on ? "On" : "Off"}</span></label>`;
  const status = !c.path ? "" : tv.error ? `<span class="chip crit">${esc(tv.error)}</span>`
    : tv.pulled_at ? `<span class="chip good">Read ${esc(when(tv.pulled_at))}</span> <span class="dim">${plural(tv.entries, "serving record")}${tv.skipped && Object.values(tv.skipped).some(Boolean) ? `, skipped ${esc(Object.entries({ unnamed: "with no name", unknown_type: "that aren't tours or confinements", bad_amount: "with no amount" }).filter(([k]) => tv.skipped[k]).map(([k, l]) => `${tv.skipped[k]} ${l}`).join(", "))}` : ""}</span>` : "";
  return `
    <section class="panel"><div class="panel-head"><h2>Discipline workbook</h2><span class="sub">where served tours and confinements are tracked</span></div><div class="panel-body">
      ${setRow("Excel workbook", "closet reads the serving log in this workbook to learn what each cadet has served, and works out what they still owe. Only completed discipline is read from it: the conduct log is never used to learn about forms. Use File → Download → Microsoft Excel if yours lives in Google Sheets.",
        `<div class="path">${c.path ? esc(c.path) : '<span class="dim">Not set</span>'}</div><div class="pair" style="margin-top:8px"><button class="btn small" type="button" id="tkChoose">${icon("folder")}${c.path ? "Change…" : "Choose…"}</button>${c.path ? '<button class="btn small ghost" type="button" id="tkClear">Clear</button>' : ""}</div>${status ? `<div style="margin-top:8px">${status}</div>` : ""}`)}
      ${setRow("Create a new workbook", "Writes a blank workbook laid out the way the settings below expect: a conduct log, a serving log (with a Tour / Confinement dropdown) and cadet balances that add themselves up. If no workbook is set yet, the new one is used.",
        `<button class="btn" type="button" id="tkCreate">${icon("download")}Create new workbook…</button>`)}
      ${setRow("Keep up to date", "Read the serving log again whenever the file changes (checked every 20 seconds). Reading never changes the workbook.", sw("auto_pull", c.auto_pull, "Read automatically"))}
      ${c.path ? setRow("Read it now", "Read the serving log right away.", `<button class="btn small" type="button" id="tkPull">${icon("refresh")}Read the sheet</button>`) : ""}
    </div></section>

    <section class="panel"><div class="panel-head"><h2>Serving log layout</h2><span class="sub">defaults match the CS07 tracker; change them for another layout</span></div><div class="panel-body">
      ${setRow("Sheet and header row", "The sheet (tab) holding the serving log and the row its column headings are on. If the headings aren't on that row closet looks for them near the top.",
        `<div class="pair">${txt("served.sheet", sv.sheet, 'aria-label="Sheet name"')}${txt("served.header_row", sv.header_row, 'type="number" min="1" max="1000" aria-label="Header row" style="max-width:90px"')}</div>`)}
      ${setRow("Column headings", "The heading text of each column, exactly as the sheet spells it (case and punctuation don't matter). Cadet, type and amount are required; leave date, supervisor or notes blank if the sheet has none.",
        `<div class="stack">${Object.entries(SERVED_LABELS).map(([k, l]) => `<label class="fld" style="width:100%;margin:0"><span>${l}</span>${txt(`served.columns.${k}`, sv.columns[k], `aria-label="${l} heading"`)}</label>`).join("")}</div>`)}
      ${setRow("Words in the type column", "What the sanction type column says for each kind. A cell that contains the word counts (so “Tour” also catches “tours”).",
        `<div class="pair">${txt("served.tour_word", sv.tour_word, 'aria-label="Word for tours"')}${txt("served.confinement_word", sv.confinement_word, 'aria-label="Word for confinements"')}</div>`)}
    </div></section>

    <section class="panel"><div class="panel-head"><h2>Write closet's records into the workbook</h2><span class="sub">replaces what the sheet has now</span></div><div class="panel-body">
      ${setRow("Allow writing", "Off by default. When on, the <b>Write to workbook</b> button below replaces every row of the conduct log with closet's records (one row per recipient). A copy of the workbook is saved first, the serving log is never touched, and other columns and sheets are left as they are. Close the workbook in Excel before writing.", sw("push.enabled", p.enabled, "Allow writing"))}
      ${setRow("Sheet and header row", "Where the conduct log is.", `<div class="pair">${txt("push.sheet", p.sheet, 'aria-label="Conduct log sheet"')}${txt("push.header_row", p.header_row, 'type="number" min="1" max="1000" aria-label="Conduct log header row" style="max-width:90px"')}</div>`)}
      <div class="set-row"><div><h3>Columns</h3><p>Each line is a column in the workbook: its heading, and what closet writes under it. A heading the sheet doesn't have yet is added to the right. Order doesn't matter, columns are found by heading.</p></div><div></div></div>
      <div class="table-wrap"><table class="t"><thead><tr><th>Heading in the sheet</th><th>What closet writes</th><th></th></tr></thead><tbody>
        ${p.columns.map((col, i) => `<tr><td><input class="input cell" data-pc="${i}|header" value="${esc(col.header)}" aria-label="Heading ${i + 1}"></td>
          <td><select class="select" data-pc="${i}|source" aria-label="Source ${i + 1}">${tv.sources.map(([k, l]) => `<option value="${k}" ${col.source === k ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></td>
          <td><button class="icon-btn" type="button" data-pcx="${i}" aria-label="Remove column ${i + 1}">${icon("x")}</button></td></tr>`).join("")}
      </tbody></table></div>
      <div class="pair" style="margin:10px 0 18px"><button class="btn small" type="button" id="pcAdd">Add a column</button><button class="btn small ghost" type="button" id="pcReset">Back to the defaults</button></div>
      ${setRow("Fill in cadet names on the balances sheet", "Also writes each cadet's name under a heading on the balances sheet, so its own formulas can add up that cadet's reports and tours. Nothing else on that sheet is written.", sw("push.balances.enabled", p.balances.enabled, "Write cadet names"))}
      ${p.balances.enabled ? setRow("Balances sheet", "The sheet, its header row, and the heading of the name column.", `<div class="stack"><div class="pair">${txt("push.balances.sheet", p.balances.sheet, 'aria-label="Balances sheet"')}${txt("push.balances.header_row", p.balances.header_row, 'type="number" min="1" max="1000" aria-label="Balances header row" style="max-width:90px"')}</div>${txt("push.balances.header", p.balances.header, 'aria-label="Name column heading"')}</div>`) : ""}
      ${setRow("Write now", tv.push.last ? `Last written ${esc(when(tv.push.last.at))}: ${plural(tv.push.last.rows, "row")}. The workbook as it was before is saved under metadata/sheet-backups.` : "Nothing has been written yet.",
        `<button class="btn" type="button" id="tkPush" ${p.enabled && c.path ? "" : "disabled"} title="${p.enabled ? "" : "Turn on “Allow writing” first"}">${icon("upload")}Write to workbook…</button>`)}
    </div></section>`;
}

function bindSettingsSheet() {
  if (!S.tv) return;
  const click = (sel, fn) => { const el = $(sel); if (el) el.onclick = fn; };
  const save = async (patch, msg = "Setting saved") => {
    try {
      await api("/api/settings", { method: "PUT", body: { tracker: patch } });
      toast(msg);
    } catch (e) { toast("Couldn't save: " + e.message, true); }
    document.activeElement?.blur?.(); // a switch changes what else is shown: redraw now, not on the next click
    await load();
  };
  const nest = (path, v) => path.split(".").reduceRight((acc, k) => ({ [k]: acc }), v);
  $$("[data-tk]").forEach((el) => (el.onchange = () => save(nest(el.dataset.tk, el.type === "number" ? Number(el.value) : el.value))));
  $$("[data-tkb]").forEach((el) => (el.onchange = () => save(nest(el.dataset.tkb, el.checked))));
  const cols = () => S.data.settings.tracker.push.columns.map((c) => ({ ...c }));
  $$("[data-pc]").forEach((el) => (el.onchange = () => {
    const [i, k] = el.dataset.pc.split("|");
    const next = cols();
    next[Number(i)][k] = el.value;
    save({ push: { columns: next } });
  }));
  $$("[data-pcx]").forEach((b) => (b.onclick = () => { const next = cols(); next.splice(Number(b.dataset.pcx), 1); save({ push: { columns: next } }, "Column removed"); }));
  click("#pcAdd", () => save({ push: { columns: [...cols(), { header: `Column ${cols().length + 1}`, source: "other" }] } }, "Column added"));
  click("#pcReset", () => save({ push: { columns: S.tv.defaults.push.columns } }, "Columns reset"));
  click("#tkChoose", async () => {
    const r = await closet.chooseSheet();
    if (r?.ok) { toast(r.pull?.ok ? `Workbook set. Read ${plural(r.pull.entries, "serving record")}.` : "Workbook set"); if (r.pull && !r.pull.ok) toast(r.pull.error, true); await load(); } else if (r?.error) toast(r.error, true);
  });
  click("#tkClear", async () => { await save({ path: "" }, "Workbook cleared"); });
  click("#tkCreate", async () => {
    const r = await closet.createSheet();
    if (r?.ok) {
      toast(r.adopted ? "Workbook created and set as your discipline workbook" : "Workbook created");
      await load();
      if (!r.adopted) await ask({ title: "Workbook created", message: `<p>${esc(r.file)}</p><p class="dim">It isn't your discipline workbook yet. Choose it above if you want closet to use it.</p>`, choices: [{ label: "OK", value: true, primary: true }] });
    } else if (r?.error) toast(r.error, true);
  });
  click("#tkPull", async () => {
    const r = await api("/api/tracker/pull", { method: "POST" });
    if (r.ok) toast(`Read ${plural(r.entries, "serving record")}`); else toast(r.error, true);
    await load();
  });
  click("#tkPush", async () => {
    const c = S.data.settings.tracker;
    const ok = await ask({
      title: "Replace the conduct log in the workbook?",
      message: `<p>Every row under the headings of <b>${esc(c.push.sheet)}</b> will be replaced with closet's records, then the sheet's formulas recalculate when it's opened.</p><p class="dim">${esc(c.path)}</p><p>A copy of the workbook as it is now is saved first. Close it in Excel before continuing.</p>`,
      choices: [{ label: "Cancel", value: null }, { label: "Replace the rows", value: true, primary: true }], danger: true,
    });
    if (!ok) return;
    try {
      const r = await api("/api/tracker/push", { method: "POST" });
      toast(`Wrote ${plural(r.rows, "row")} to the workbook`);
      const added = r.sheets.flatMap((s) => s.added);
      if (added.length) await ask({ title: "Columns were added", message: `<p>These headings weren't in the sheet, so closet added them on the right: ${esc(added.join(", "))}.</p>`, choices: [{ label: "OK", value: true, primary: true }] });
    } catch (e) {
      await ask({ title: "Couldn't write to the workbook", message: `<p>${esc(e.message)}</p>`, choices: [{ label: "OK", value: true, primary: true }] });
    }
    await load();
  });
}

// ------------------------------------------------------------------ notifications (email)
// Contacts live in a registry (Settings → Push notifications); the Notifications tab sends each
// cadet a summary of their own paperwork. Every control that sends is disabled, with the reason
// shown, until a Gmail account is connected, so nothing here can fail on an unconfigured install.
const needsNotify = () => S.view === "notifications" || (S.view === "settings" && S.setTab === "notify");
async function refreshNotify() {
  if (!needsNotify()) return;
  try { S.nv = await api("/api/notify"); } catch (e) { toast("Couldn't load notifications: " + e.message, true); }
}

const stageLabel = (k) => (FLAGS.find(([f]) => f === k) || [])[2] || k;
const when = (s) => (s ? fmtStamp(s.replace(/Z?$/, "Z")) : "");

function tieChip(c) {
  if (c.guessed) return '<span class="chip warn" title="The spreadsheet had no name for this address, so one was made from it. Check it.">Name guessed</span>';
  if (!c.cadet) return '<span class="chip muted" title="Not linked to anyone with paperwork yet">Not linked</span>';
  if (c.match === "close") return '<span class="chip warn" title="Linked by a similar spelling. Check that this is the right person.">Check match</span>';
  return c.on_file ? '<span class="chip good">Linked</span>' : '<span class="chip muted" title="No active paperwork under this name yet">No paperwork yet</span>';
}

// ---- Settings → Push notifications

function settingsNotify() {
  const nv = S.nv;
  if (!nv) {
    refreshNotify().then(() => { if (S.view === "settings" && S.setTab === "notify" && S.nv) viewSettings(); });
    return '<p class="dim">Loading…</p>';
  }
  const m = nv.mail;
  const optedIn = nv.contacts.filter((c) => c.auto && c.cadet).length;
  const years = [...new Set(nv.contacts.map((c) => c.class_year).filter(Boolean))].sort();
  const rep = S.importReport;
  return `
    <section class="panel"><div class="panel-head"><h2>Gmail account<button type="button" class="gm-help" id="gmHelp" aria-label="How to set up Gmail sending" title="How to set up Gmail sending">i</button></h2><span class="sub">emails are sent from this address</span></div><div class="panel-body">
      ${m.configured
        ? setRow("Connected", `Sending as <b>${esc(m.user)}</b>${m.from_name ? `, shown as “${esc(m.from_name)}”` : ""}. The app password is kept encrypted on this computer only. It is never saved in the metadata folder or in backups.`,
          `<div class="pair"><button class="btn small" type="button" id="gmailTest">Send test email</button><button class="btn small ghost" type="button" id="gmailOff">Disconnect</button></div>`)
        : `<div class="banner ${m.secure ? "info" : ""}">${icon(m.secure ? "info" : "alert")}<span>${esc(m.reason)}</span></div>`}
      ${m.secure || m.configured ? setRow(m.configured ? "Use a different account" : "Connect Gmail",
        `Turn on 2-Step Verification for the Gmail account, then create an <b>app password</b> (Google Account → Security → 2-Step Verification → App passwords) and paste it here. A normal Gmail password won't work. The sign-in is checked with Google before it's saved.`,
        `<div class="stack"><input class="input" id="gmUser" type="email" placeholder="you@gmail.com" autocomplete="off" aria-label="Gmail address" value="${esc(m.user || "")}">
          <input class="input" id="gmPass" type="password" placeholder="App password (16 letters)" autocomplete="new-password" aria-label="App password">
          <input class="input" id="gmName" placeholder="Name shown to recipients (optional)" autocomplete="off" aria-label="Sender name" value="${esc(m.from_name || "")}">
          <button class="btn primary small" type="button" id="gmConnect">Check and save</button></div>`) : ""}
    </div></section>

    <section class="panel"><div class="panel-head"><h2>Contact list</h2><span class="sub">${plural(nv.contacts.length, "email address", "email addresses")}, ${plural(nv.contacts.filter((c) => c.cadet && c.on_file).length, "linked to a cadet with paperwork", "linked to cadets with paperwork")}</span></div><div class="panel-body">
      <p class="hint">Import a spreadsheet (.xlsx or .csv) with names and emails in any layout. closet finds every email address, takes the name from the cells to its left, and matches it to the nearest recipient name on your forms. “Doe, John A.”, “C2C John Doe” and “John Doe” count as the same person. Check the matches below; anything you correct is kept.</p>
      <div class="toolbar">
        <button class="btn" type="button" id="ctImport">${icon("upload")}Import spreadsheet…</button>
        <button class="btn ghost" type="button" id="ctAddToggle">Add one by hand</button>
        <span class="spacer"></span>
        <label class="search">${icon("search")}<input class="input" id="ctQ" type="search" placeholder="Find a name or email" value="${esc(S.cQ)}" aria-label="Find a contact"></label>
        <select class="select" id="ctFilter" aria-label="Show">${[["all", "Everyone"], ["unlinked", "Not linked to a cadet"], ["check", "Needs a look"], ["in", "Opted in to automatic updates"], ["out", "Not opted in"]].map(([v, l]) => `<option value="${v}" ${S.cFilter === v ? "selected" : ""}>${l}</option>`).join("")}</select>
      </div>
      ${rep ? `<div class="banner info">${icon("check")}<span>${esc(rep.file)}: found ${plural(rep.found, "address", "addresses")}. Added ${rep.added}${rep.existing ? `, ${rep.existing} already in the list (left as they were)` : ""}. ${rep.tied} linked to a cadet${rep.close ? ` (${rep.close} by a similar spelling, marked “Check match”)` : ""}${rep.untied ? `, ${rep.untied} not linked` : ""}${rep.guessed ? `, ${rep.guessed} with a name guessed from the address` : ""}.</span><button class="icon-btn" type="button" id="ctRepClose" aria-label="Dismiss">${icon("x")}</button></div>` : ""}
      <div class="addrow" id="ctAdd" hidden>
        <input class="input" id="ctaName" placeholder="Name" aria-label="Name" autocomplete="off">
        <input class="input" id="ctaEmail" type="email" placeholder="Email" aria-label="Email" autocomplete="off">
        <button class="btn primary small" type="button" id="ctaGo">Add</button>
      </div>
      <datalist id="cadetList">${nv.cadets.map((n) => `<option value="${esc(n)}">`).join("")}</datalist>
      <div class="toolbar sel-bar">
        <select class="select" id="ctSelect" aria-label="Select contacts"><option value="">Select…</option><option value="shown">All shown</option><option value="none">None</option>${years.map((y) => `<option value="y:${esc(y)}">Class of ${esc(y)}</option>`).join("")}<option value="out">Not opted in</option><option value="in">Opted in</option></select>
        <span class="dim" id="ctSelCount"></span>
        <span class="spacer"></span>
        <button class="btn small" type="button" id="ctOptIn">Opt in selected</button>
        <button class="btn small" type="button" id="ctOptOut">Opt out selected</button>
        <button class="btn small ghost" type="button" id="ctRemove" style="color:#f0a3a3">Remove selected</button>
      </div>
      <div class="table-wrap contacts"><table class="t"><thead><tr><th style="width:34px"></th><th>Name</th><th>Email</th><th>Linked cadet</th><th>Status</th><th class="num">Class</th><th title="Send this person automatic updates">Auto</th><th></th></tr></thead><tbody id="contactRows"></tbody></table></div>
    </div></section>

    <section class="panel"><div class="panel-head"><h2>Signature</h2><span class="sub">closing lines at the end of every email</span></div><div class="panel-body">
      ${setRow("Add a signature", "Appears at the very end of manual and automatic emails, after the table.",
        `<label class="switch"><input type="checkbox" id="sigOn" ${nv.signature.enabled ? "checked" : ""} aria-label="Add a signature"><span class="track"></span><span class="lbl">${nv.signature.enabled ? "On" : "Off"}</span></label>`)}
      <label class="fld" style="margin:6px 0 0"><span>Signature text</span><textarea class="input" id="sigText" rows="4" maxlength="1000" placeholder="V/r,&#10;First Sergeant, CS-07">${esc(nv.signature.text)}</textarea></label>
    </div></section>

    <section class="panel"><div class="panel-head"><h2>What the emails say</h2><span class="sub">applies to manual and automatic emails alike</span></div><div class="panel-body">
      ${(() => {
        const ct = nv.content;
        const chk = (k, label, off = false) => `<label class="check"><input class="chk" type="checkbox" data-ct="${k}" ${ct[k] ? "checked" : ""} ${off ? "disabled" : ""}> ${label}</label>`;
        return setRow("Paperwork table", "A list of the cadet's forms with the columns you pick.", `<div class="stack">${chk("forms", "Include the table")}${[["date", "Date"], ["form", "Form type and positive / negative"], ["reason", "Reason"], ["details", "Reason details"], ["status", "Where it is now"], ["steps", "Step-by-step checklist"], ["outcomes", "Rewards and sanctions"]].map(([k, l]) => chk(k, l, !ct.forms)).join("")}</div>`)
          + setRow("Which forms are listed", "Totals and balances always count every form.", `<div class="stack">${chk("only_open", "Only forms still waiting on a step", !ct.forms)}${chk("positives", "Include positive forms", !ct.forms)}</div>`)
          + setRow("Tours and confinements", "How many each cadet still has to serve, from the assigned counts on their forms and what the discipline workbook says they served. See Settings → Discipline sheet.", `<div class="stack">${chk("balances", "Show what's left to serve")}${chk("balance_detail", "Also show served and assigned counts", !ct.balances)}</div>`)
          + setRow("Extras", "", `<div class="stack">${chk("totals", "Totals line (forms, demerits, tours, confinements)")}${chk("footer", "“Sent by the First Sergeant's paperwork tracker” line")}</div>`);
      })()}
    </div></section>

    <section class="panel"><div class="panel-head"><h2>Automatic updates</h2><span class="sub">email someone when one of their forms passes a step</span></div><div class="panel-body">
      ${setRow("Send automatic updates", `Off by default, for everyone. When on, a person who is opted in (the Auto column above) gets an email as soon as one of their forms passes a step you've ticked below, with the same summary table as a manual notification. Updates go out only while closet is open. Turning this on never announces what has already happened, only what changes from now on.`,
        `<select class="select" id="autoOn" ${m.configured ? "" : "disabled"} aria-label="Automatic updates">${[["0", "Off"], ["1", "On"]].map(([v, l]) => `<option value="${v}" ${(nv.auto.enabled ? "1" : "0") === v ? "selected" : ""}>${l}</option>`).join("")}</select>${m.configured ? "" : '<div class="hint">Connect a Gmail account first.</div>'}`)}
      ${setRow("Which steps", "A form passing any ticked step triggers an update.",
        `<div class="stack">${nv.steps.map(({ key, label }) => `<label class="check"><input class="chk" type="checkbox" data-stage="${key}" ${nv.auto.stages.includes(key) ? "checked" : ""}> ${esc(label)}</label>`).join("")}</div>`)}
      ${setRow("Who", `${plural(optedIn, "person is", "people are")} opted in right now. Tick contacts in the list above and use <b>Opt in selected</b> or <b>Opt out selected</b>, or choose a class year in the Select menu to opt in a whole class at once.`,
        `<button class="btn small" type="button" id="optAllLinked">Opt in everyone linked to a cadet</button>`)}
      ${setRow("A safety limit", `If one change would email more than ${nv.auto_max} people at once (a bulk step, a large sync), nothing is sent and the Notifications tab says why, so a mistake can't flood inboxes.`, "")}
    </div></section>`;
}

// Google makes this part manual on purpose, so the app can only explain it.
function gmailHelp() {
  return ask({
    title: "Setting up Gmail sending", wide: true,
    message: `<p>closet can't do this part for you: Google requires the account owner to create a special password for programs like this one. It takes about two minutes and is done once.</p>
      <ol>
        <li>Sign in at <b>myaccount.google.com</b> with the Gmail account you want to send from.</li>
        <li>Open <b>Security</b> and make sure <b>2-Step Verification</b> is on. App passwords don't exist without it.</li>
        <li>Search the account page for <b>App passwords</b> (or go to myaccount.google.com/apppasswords).</li>
        <li>Name it something like “closet” and choose <b>Create</b>. Google shows a 16-letter password once.</li>
        <li>Paste that password into <b>App password</b> here, with the full Gmail address, and choose <b>Check and save</b>. Spaces don't matter.</li>
      </ol>
      <p class="dim">If App passwords isn't offered: a school or work Google account may have it turned off by an administrator, so use a personal Gmail account or ask the administrator. Your normal Gmail password will not work. Gmail allows roughly 500 messages a day. The app password is stored encrypted on this computer and can be revoked any time from the same Google page.</p>`,
    choices: [{ label: "Got it", value: true, primary: true }],
  });
}

function shownContacts() {
  const q = S.cQ.trim().toLowerCase();
  return S.nv.contacts.filter((c) => {
    if (q && !`${c.name} ${c.email} ${c.cadet}`.toLowerCase().includes(q)) return false;
    if (S.cFilter === "unlinked") return !c.cadet;
    if (S.cFilter === "check") return c.guessed || c.match === "close" || !c.cadet;
    if (S.cFilter === "in") return c.auto;
    if (S.cFilter === "out") return !c.auto;
    return true;
  });
}

function renderContactRows() {
  const body = $("#contactRows");
  if (!body) return;
  const list = shownContacts();
  [...S.cSel].forEach((id) => { if (!S.nv.contacts.some((c) => c.id === id)) S.cSel.delete(id); });
  body.innerHTML = list.length ? list.map((c) => `<tr data-cid="${c.id}">
    <td><input class="chk" type="checkbox" data-csel="${c.id}" ${S.cSel.has(c.id) ? "checked" : ""} aria-label="Select ${esc(c.name || c.email)}"></td>
    <td><input class="input cell" data-cf="name" value="${esc(c.name)}" placeholder="Name" aria-label="Name" title="${c.sheet_name ? `The spreadsheet said: ${esc(c.sheet_name)}` : ""}"></td>
    <td><input class="input cell" data-cf="email" type="email" value="${esc(c.email)}" aria-label="Email"></td>
    <td><input class="input cell" data-cf="cadet" list="cadetList" value="${esc(c.cadet)}" placeholder="Not linked" aria-label="Linked cadet"></td>
    <td data-status>${tieChip(c)}</td>
    <td class="num">${esc(c.class_year) || '<span class="dim">—</span>'}</td>
    <td><input class="chk" type="checkbox" data-cauto ${c.auto ? "checked" : ""} aria-label="Automatic updates for ${esc(c.name || c.email)}"></td>
    <td><button class="icon-btn" type="button" data-cdel aria-label="Remove ${esc(c.email)}">${icon("x")}</button></td></tr>`).join("")
    : `<tr><td colspan="8"><div class="empty" style="padding:28px">${icon("search")}<h3>${S.nv.contacts.length ? "No contacts match" : "No contacts yet"}</h3><p>${S.nv.contacts.length ? "Clear the search or change the filter." : "Import a spreadsheet or add an address by hand."}</p></div></td></tr>`;
  const n = S.cSel.size;
  $("#ctSelCount").textContent = n ? `${n} selected` : "";
  ["#ctOptIn", "#ctOptOut", "#ctRemove"].forEach((s) => { $(s).disabled = !n; });
  $$("[data-csel]", body).forEach((c) => (c.onchange = () => { c.checked ? S.cSel.add(c.dataset.csel) : S.cSel.delete(c.dataset.csel); renderContactRows(); }));
  $$("[data-cauto]", body).forEach((c) => (c.onchange = async () => {
    const id = c.closest("tr").dataset.cid;
    try {
      await api(`/api/notify/contacts/${id}`, { method: "PATCH", body: { auto: c.checked } });
      S.nv.contacts.find((x) => x.id === id).auto = c.checked;
    } catch (e) { c.checked = !c.checked; toast(e.message, true); }
  }));
  $$("[data-cf]", body).forEach((inp) => (inp.onchange = async () => {
    const tr = inp.closest("tr");
    const id = tr.dataset.cid;
    const c = S.nv.contacts.find((x) => x.id === id);
    const field = inp.dataset.cf;
    try {
      const saved = await api(`/api/notify/contacts/${id}`, { method: "PATCH", body: { [field]: inp.value } });
      c.guessed = false;
      if (field === "cadet" || saved.cadet !== c.cadet) { await refreshNotify(); renderContactRows(); return; } // a corrected name may have found its cadet
      c[field] = inp.value.trim();
      if (field === "email") inp.value = c.email.toLowerCase();
      $("[data-status]", tr).innerHTML = tieChip(c);
    } catch (e) { inp.value = c[field]; toast(e.message, true); }
  }));
  $$("[data-cdel]", body).forEach((b) => (b.onclick = async () => {
    const c = S.nv.contacts.find((x) => x.id === b.closest("tr").dataset.cid);
    const ok = await ask({ title: "Remove this contact?", message: `<p>${esc(c.name || c.email)} (${esc(c.email)}) will be removed from the list. Their paperwork is not affected.</p>`, choices: [{ label: "Keep", value: null }, { label: "Remove", value: true, primary: true }], danger: true });
    if (!ok) return;
    await api("/api/notify/contacts/bulk", { method: "POST", body: { ids: [c.id], delete: true } });
    await refreshNotify();
    renderContactRows();
  }));
}

function bindSettingsNotify() {
  if (!S.nv) return;
  const nv = S.nv;
  renderContactRows();
  const click = (sel, fn) => { const el = $(sel); if (el) el.onclick = fn; };
  click("#gmHelp", gmailHelp);
  const saveSig = async (patch) => {
    try { await api("/api/notify/signature", { method: "PUT", body: patch }); toast("Signature saved"); } catch (e) { toast(e.message, true); }
    await refreshNotify();
  };
  $("#sigOn").onchange = async (e) => { await saveSig({ enabled: e.target.checked }); $("#sigOn").parentElement.querySelector(".lbl").textContent = e.target.checked ? "On" : "Off"; };
  $("#sigText").onchange = (e) => saveSig({ text: e.target.value });
  $$("[data-ct]").forEach((el) => (el.onchange = async () => {
    try { await api("/api/notify/content", { method: "PUT", body: { [el.dataset.ct]: el.checked } }); toast("Email setting saved"); } catch (e) { toast(e.message, true); }
    document.activeElement?.blur?.();
    await load();
  }));
  click("#gmConnect", async () => {
    const btn = $("#gmConnect");
    btn.disabled = true;
    btn.textContent = "Checking with Google…";
    const r = await closet.gmailSave({ user: $("#gmUser").value, password: $("#gmPass").value, fromName: $("#gmName").value });
    if (r?.ok) { toast("Gmail connected"); await load(); } else { toast(r?.error || "Couldn't connect", true); btn.disabled = false; btn.textContent = "Check and save"; }
  });
  click("#gmailTest", async () => {
    const btn = $("#gmailTest");
    btn.disabled = true;
    const r = await closet.gmailTest();
    btn.disabled = false;
    if (r?.ok) toast(`Test email sent to ${r.to}`); else toast(r?.error || "The test failed", true);
  });
  click("#gmailOff", async () => {
    const ok = await ask({ title: "Disconnect Gmail?", message: "<p>closet forgets the app password and turns automatic updates off. Your contact list stays.</p>", choices: [{ label: "Cancel", value: null }, { label: "Disconnect", value: true, primary: true }], danger: true });
    if (!ok) return;
    await closet.gmailClear();
    toast("Gmail disconnected");
    await load();
  });
  click("#ctImport", async () => {
    const r = await closet.importContacts();
    if (r?.ok) { S.importReport = r.report; toast(r.report.added ? `Added ${plural(r.report.added, "contact")}` : "No new addresses found"); await load(); }
    else if (r?.error) await ask({ title: "Couldn't read that file", message: `<p>${esc(r.error)}</p>`, choices: [{ label: "OK", value: true, primary: true }] });
  });
  click("#ctRepClose", () => { S.importReport = null; viewSettings(); });
  click("#ctAddToggle", () => { const a = $("#ctAdd"); a.hidden = !a.hidden; if (!a.hidden) $("#ctaName").focus(); });
  click("#ctaGo", async () => {
    try {
      await api("/api/notify/contacts", { method: "POST", body: { name: $("#ctaName").value, email: $("#ctaEmail").value } });
      $("#ctaName").value = ""; $("#ctaEmail").value = "";
      toast("Contact added");
      await refreshNotify();
      renderContactRows();
    } catch (e) { toast(e.message, true); }
  });
  $("#ctaEmail").onkeydown = (e) => { if (e.key === "Enter") $("#ctaGo").click(); };
  $("#ctQ").oninput = (e) => { S.cQ = e.target.value; renderContactRows(); };
  $("#ctFilter").onchange = (e) => { S.cFilter = e.target.value; renderContactRows(); };
  $("#ctSelect").onchange = (e) => {
    const v = e.target.value;
    e.target.value = "";
    if (v === "none") S.cSel.clear();
    else {
      for (const c of shownContacts()) {
        if (v === "shown" || (v === "in" && c.auto) || (v === "out" && !c.auto) || (v.startsWith("y:") && c.class_year === v.slice(2))) S.cSel.add(c.id);
      }
    }
    renderContactRows();
  };
  const bulk = async (patch, msg) => {
    const ids = [...S.cSel];
    if (!ids.length) return;
    try {
      await api("/api/notify/contacts/bulk", { method: "POST", body: { ids, ...patch } });
      toast(msg(ids.length));
      await refreshNotify();
      renderContactRows();
      load();
    } catch (e) { toast(e.message, true); }
  };
  click("#ctOptIn", () => bulk({ auto: true }, (n) => `${plural(n, "person")} opted in`));
  click("#ctOptOut", () => bulk({ auto: false }, (n) => `${plural(n, "person")} opted out`));
  click("#ctRemove", async () => {
    const n = S.cSel.size;
    const ok = await ask({ title: `Remove ${plural(n, "contact")}?`, message: "<p>They're removed from the list. Paperwork is not affected.</p>", choices: [{ label: "Keep", value: null }, { label: "Remove", value: true, primary: true }], danger: true });
    if (ok) { S.cSel.clear(); await bulk({ delete: true }, () => `Removed ${plural(n, "contact")}`); }
  });
  click("#optAllLinked", async () => {
    const ids = nv.contacts.filter((c) => c.cadet && !c.auto).map((c) => c.id);
    if (!ids.length) { toast("Everyone linked to a cadet is already opted in"); return; }
    const ok = await ask({ title: `Opt in ${plural(ids.length, "person", "people")}?`, message: "<p>Each will get an email whenever one of their forms passes a step you've ticked (once automatic updates are on).</p>", choices: [{ label: "Cancel", value: null }, { label: "Opt them in", value: true, primary: true }] });
    if (!ok) return;
    await api("/api/notify/contacts/bulk", { method: "POST", body: { ids, auto: true } });
    await refreshNotify();
    viewSettings();
  });
  const auto = $("#autoOn");
  if (auto) {
    auto.onchange = async () => {
      try {
        await api("/api/notify/auto", { method: "PUT", body: { enabled: auto.value === "1" } });
        toast(auto.value === "1" ? "Automatic updates are on. Only changes from now on are announced." : "Automatic updates are off");
      } catch (e) { toast(e.message, true); auto.value = nv.auto.enabled ? "1" : "0"; }
      await refreshNotify();
    };
  }
  $$("[data-stage]").forEach((c) => (c.onchange = async () => {
    const stages = $$("[data-stage]").filter((x) => x.checked).map((x) => x.dataset.stage);
    try { await api("/api/notify/auto", { method: "PUT", body: { stages } }); toast("Saved"); } catch (e) { c.checked = !c.checked; toast(e.message, true); }
    await refreshNotify();
  }));
}

// ---- Notifications tab

function viewNotifications() {
  const nv = S.nv;
  if (!nv) {
    $("#main").innerHTML = head("Notifications") + '<p class="dim">Loading…</p>';
    refreshNotify().then(() => { if (S.view === "notifications" && S.nv) viewNotifications(); });
    return;
  }
  const years = [...new Set(nv.people.map((p) => p.class_year).filter(Boolean))].sort();
  const warn = !nv.ready
    ? `<div class="banner">${icon("alert")}<span>${esc(nv.mail.reason)} Nothing can be sent until then. <a href="#/settings/notify">Open Push notifications settings</a></span></div>`
    : !nv.contacts.length
      ? `<div class="banner info">${icon("info")}<span>The contact list is empty, so there's no one to email yet. <a href="#/settings/notify">Import a spreadsheet of names and emails</a> or add addresses by hand.</span></div>` : "";
  const held = nv.log.find((l) => l.kind === "auto" && !l.ok && /^Held/.test(l.error || ""));
  $("#main").innerHTML = head("Notifications", "Email each cadet a summary of their own paperwork, or pick a few. Your message comes first, then a table of their forms.") + banners() + warn +
    (held && nv.log[0] === held ? `<div class="banner">${icon("alert")}<span>${esc(held.error)}</span></div>` : "") + `
    <section class="panel compose"><div class="panel-head"><h2>Message</h2><span class="sub">added under it automatically: every active form, where it is in processing, and its rewards or sanctions</span></div><div class="panel-body">
      <label class="fld"><span>Subject</span><input class="input" id="nSubject" value="${esc(S.nSubject)}" maxlength="150" autocomplete="off"></label>
      <label class="fld"><span>Your message</span><textarea class="input" id="nMessage" rows="5" placeholder="Hi {first_name}, here's where your paperwork stands…">${esc(S.nMessage)}</textarea></label>
      <p class="hint">Type <code>{first_name}</code> or <code>{name}</code> and closet fills in each person's own. Plain text only.</p>
    </div></section>
    <div class="toolbar">
      <label class="search">${icon("search")}<input class="input" id="nQ" type="search" placeholder="Find a cadet" value="${esc(S.nQ)}" aria-label="Find a cadet"></label>
      <select class="select" id="nClass" aria-label="Class year"><option value="all">All classes</option>${years.map((y) => `<option value="${esc(y)}" ${S.nClass === y ? "selected" : ""}>Class of ${esc(y)}</option>`).join("")}</select>
      <select class="select" id="nFilter" aria-label="Show">${[["all", "Everyone with paperwork"], ["email", "Has an email on file"], ["noemail", "No email on file"], ["open", "Has a form waiting on a step"]].map(([v, l]) => `<option value="${v}" ${S.nFilter === v ? "selected" : ""}>${l}</option>`).join("")}</select>
      <span class="spacer"></span>
      <button class="btn ghost small" type="button" id="nAll">Select all shown</button><button class="btn ghost small" type="button" id="nNone">Clear selection</button>
    </div>
    <div id="nTable"></div>
    <div class="copybar" id="nBar"></div>
    <section class="panel" style="margin-top:22px"><div class="panel-head"><h2>Recent activity</h2><span class="sub">what was sent, and anything that wasn't</span></div><div class="panel-body" id="nLog"></div></section>`;
  $("#nSubject").oninput = (e) => { S.nSubject = e.target.value; };
  $("#nMessage").oninput = (e) => { S.nMessage = e.target.value; };
  $("#nQ").oninput = (e) => { S.nQ = e.target.value; renderPeople(); };
  $("#nClass").onchange = (e) => { S.nClass = e.target.value; renderPeople(); };
  $("#nFilter").onchange = (e) => { S.nFilter = e.target.value; renderPeople(); };
  $("#nAll").onclick = () => { shownPeople().filter((p) => p.emails.length).forEach((p) => S.nSel.add(p.key)); renderPeople(); };
  $("#nNone").onclick = () => { S.nSel.clear(); renderPeople(); };
  renderPeople();
  renderLog();
}

function shownPeople() {
  const q = S.nQ.trim().toLowerCase();
  return S.nv.people.filter((p) => {
    if (q && !p.name.toLowerCase().includes(q)) return false;
    if (S.nClass !== "all" && p.class_year !== S.nClass) return false;
    if (S.nFilter === "email") return p.emails.length > 0;
    if (S.nFilter === "noemail") return p.emails.length === 0;
    if (S.nFilter === "open") return p.open > 0;
    return true;
  });
}

function renderPeople() {
  const nv = S.nv;
  const list = shownPeople();
  const have = new Set(nv.people.filter((p) => p.emails.length).map((p) => p.key));
  [...S.nSel].forEach((k) => { if (!have.has(k)) S.nSel.delete(k); });
  if (!nv.people.length) {
    $("#nTable").innerHTML = `<div class="panel"><div class="empty">${icon("cadets")}<h3>No paperwork yet</h3><p>Cadets appear here once they have active paperwork on file.</p></div></div>`;
  } else if (!list.length) {
    $("#nTable").innerHTML = `<div class="panel"><div class="empty">${icon("search")}<h3>No one matches</h3><p>Clear the search or change the filters.</p></div></div>`;
  } else {
    $("#nTable").innerHTML = `<div class="table-wrap"><table class="t"><thead><tr><th style="width:34px"></th><th>Cadet</th><th>Class</th><th class="num">Forms</th><th class="num">Waiting</th><th>Email</th><th></th></tr></thead><tbody>
      ${list.map((p) => `<tr class="${S.nSel.has(p.key) ? "sel" : ""}">
        <td><input class="chk" type="checkbox" data-nsel="${esc(p.key)}" ${S.nSel.has(p.key) ? "checked" : ""} ${p.emails.length ? "" : "disabled"} aria-label="Send to ${esc(p.name)}"></td>
        <td class="who">${esc(p.name)}</td><td>${esc(p.class_year) || '<span class="dim">—</span>'}</td>
        <td class="num">${p.forms}</td><td class="num">${p.open || '<span class="dim">0</span>'}</td>
        <td>${p.emails.length ? `<span class="sub" style="max-width:34ch">${esc(p.emails.join(", "))}</span>` : '<span class="chip muted" title="Add this person in Settings → Push notifications">No email on file</span>'}</td>
        <td class="nowrap" style="text-align:right"><button class="icon-btn" type="button" data-npreview="${esc(p.key)}" ${p.emails.length ? "" : "disabled"} title="Preview this person's email" aria-label="Preview email for ${esc(p.name)}">${icon("search")}</button></td></tr>`).join("")}
      </tbody></table></div>`;
  }
  $$("[data-nsel]").forEach((c) => (c.onchange = () => { c.checked ? S.nSel.add(c.dataset.nsel) : S.nSel.delete(c.dataset.nsel); renderPeople(); }));
  $$("[data-npreview]").forEach((b) => (b.onclick = () => previewEmail(b.dataset.npreview)));
  const n = S.nSel.size;
  const can = nv.ready && n > 0 && !S.sending;
  $("#nBar").innerHTML = `<span class="txt"><b>${plural(n, "person", "people")}</b> selected${nv.ready ? "" : `<br><span style="color:#f0a3a3;font-size:12.5px">${esc(nv.mail.reason)}</span>`}</span>
    <button class="btn" type="button" id="nTest" ${can ? "" : "disabled"} title="Sends the first selected person's email to your own Gmail address instead of theirs">Send a test to me</button>
    <button class="btn primary" type="button" id="nSend" ${can ? "" : "disabled"}>${S.sending ? "Sending…" : `Send to ${plural(n, "person", "people")}`}</button>`;
  $("#nTest").onclick = () => sendEmails(true);
  $("#nSend").onclick = () => sendEmails(false);
}

function renderLog() {
  const el = $("#nLog");
  const log = S.nv.log.filter((l) => l.kind !== "import").slice(0, 12);
  el.innerHTML = log.length ? `<table class="t"><thead><tr><th>When</th><th>Kind</th><th>To</th><th>Subject</th><th>Result</th></tr></thead><tbody>${log.map((l) => `<tr>
    <td class="nowrap">${esc(when(l.at))}</td><td>${esc({ manual: "Manual", auto: "Automatic", test: "Test" }[l.kind] || l.kind)}</td>
    <td>${esc(l.person || "")}<div class="sub">${esc((l.to || []).join(", "))}</div></td><td><div class="sub" style="color:var(--text-2)">${esc(l.subject || "")}</div></td>
    <td>${l.ok ? '<span class="chip good">Sent</span>' : `<span class="chip crit" title="${esc(l.error || "")}">Not sent</span><div class="sub" style="white-space:normal">${esc(l.error || "")}</div>`}</td></tr>`).join("")}</tbody></table>`
    : '<p class="dim" style="margin:0">Nothing has been sent yet.</p>';
}

async function previewEmail(key) {
  try {
    const pv = await api("/api/notify/preview", { method: "POST", body: { key, subject: S.nSubject, message: S.nMessage } });
    await ask({
      title: "Preview", wide: true,
      message: `<p class="dim">To ${esc(pv.to.join(", ")) || "(no email on file)"}<br>Subject: ${esc(pv.subject)}</p><div class="mail-preview">${pv.html}</div>`,
      choices: [{ label: "Close", value: true, primary: true }],
    });
  } catch (e) { toast(e.message, true); }
}

async function sendEmails(test) {
  const nv = S.nv;
  if (S.sending) return;
  if (!nv.ready) { toast(nv.mail.reason, true); return; }
  const keys = [...S.nSel];
  if (!keys.length) return;
  if (!test) {
    const names = keys.map((k) => nv.people.find((p) => p.key === k)?.name).filter(Boolean);
    const ok = await ask({
      title: `Email ${plural(keys.length, "person", "people")}?`,
      message: `<p>Each person gets their own email from <b>${esc(nv.mail.user)}</b> with your message and a table of their paperwork, discipline details included.</p>
        <p class="dim">${esc(names.slice(0, 8).join(", "))}${names.length > 8 ? `, and ${names.length - 8} more` : ""}</p>${keys.length > nv.max_batch ? `<p>That is more than ${nv.max_batch}, the most closet sends at once.</p>` : ""}`,
      choices: [{ label: "Cancel", value: null }, { label: "Send", value: true, primary: true }],
    });
    if (!ok) return;
  }
  S.sending = true;
  renderPeople();
  try {
    const r = await api("/api/notify/send", { method: "POST", body: { keys: test ? keys.slice(0, 1) : keys, subject: S.nSubject, message: S.nMessage, test } });
    if (test) toast(r.sent ? `Test sent to ${nv.mail.user}` : "The test wasn't sent", !r.sent);
    else toast(r.sent ? `Sent ${plural(r.sent, "email")}${r.failed.length ? `, ${r.failed.length} failed` : ""}` : "Nothing was sent", !r.sent);
    if (r.failed.length || r.skipped.length || r.aborted) {
      await ask({
        title: "Some emails weren't sent",
        message: `${r.failed.length ? `<p><b>Failed</b></p><ul>${r.failed.map((f) => `<li>${esc(f.name)}: ${esc(f.error)}</li>`).join("")}</ul>` : ""}${r.skipped.length ? `<p><b>Skipped</b></p><ul>${r.skipped.map((f) => `<li>${esc(f.name)}: ${esc(f.reason)}</li>`).join("")}</ul>` : ""}${r.aborted ? "<p>Sending stopped early because every remaining email would have failed the same way.</p>" : ""}`,
        choices: [{ label: "OK", value: true, primary: true }],
      });
    }
    if (!test && !r.failed.length) S.nSel.clear();
  } catch (e) {
    toast(e.message, true);
  } finally {
    S.sending = false;
    await refreshNotify();
    if (S.view === "notifications") { renderPeople(); renderLog(); }
  }
}

// ---- linking a new cadet to a contact that's already in the list
// Asked once per cadet (the answer is saved); "Decide later" only skips it until the app restarts.
let tiesBusy = false;
const tiesSkipped = new Set();
async function checkContactTies() {
  if (tiesBusy || document.visibilityState !== "visible" || modalOpen()) return;
  const ties = (S.data?.notify?.ties || []).filter((t) => !tiesSkipped.has(t.key));
  if (!ties.length) return;
  tiesBusy = true;
  let changed = false;
  try {
    const t = ties[0];
    const one = t.candidates.length === 1;
    const c0 = t.candidates[0];
    const ans = await ask({
      title: "Is this their email?",
      message: `<p><b>${esc(t.cadet)}</b>${t.class_year ? ` (${esc(t.class_year)})` : ""} has paperwork on file and isn't linked to an email address yet.</p>
        <p>${one ? `The contact list has <b>${esc(c0.name)}</b> &lt;${esc(c0.email)}&gt;. Is that the same person?` : "These contacts have a similar name. Pick the one that is the same person."}</p>`,
      select: one ? null : { options: t.candidates.map((c) => [c.id, `${c.name} <${c.email}>`]), value: c0.id },
      choices: [{ label: "Decide later", value: null }, { label: "Different person", value: "no" }, { label: "Yes, link them", value: one ? c0.id : true, primary: true }],
    });
    if (ans === null) tiesSkipped.add(t.key);
    else if (ans === "no") {
      for (const c of t.candidates) await api("/api/notify/tie", { method: "POST", body: { id: c.id, cadet: t.cadet, yes: false } });
      changed = true;
    } else {
      await api("/api/notify/tie", { method: "POST", body: { id: ans, cadet: t.cadet, yes: true } });
      toast(`${t.cadet} is linked to ${t.candidates.find((c) => c.id === ans)?.email}`);
      changed = true;
    }
  } catch (e) {
    toast("Couldn't save that: " + e.message, true);
  } finally {
    tiesBusy = false;
  }
  if (changed) await load();
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkContactTies(); });

// ------------------------------------------------------------------ backup and restore
const fmtBytes = (n) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

async function exportBackup() {
  const btn = $("#backupExport");
  if (btn) btn.disabled = true;
  try {
    const r = await closet.exportBackup();
    if (r?.ok) {
      toast(`Backup saved: ${plural(r.pdfs, "PDF")}, ${plural(r.forms, "record")}, ${fmtBytes(r.bytes)}`);
      closet.showPath(r.path);
    } else if (r?.error) toast("Couldn't save the backup: " + r.error, true);
  } catch (e) {
    toast("Couldn't save the backup: " + e.message, true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function importBackup() {
  if (!(await okToDiscard())) return;
  const pick = await closet.pickBackup();
  if (!pick?.ok) {
    if (pick?.error) await ask({ title: "That backup can't be restored", message: `<p>${esc(pick.error)}</p><p class="dim">Nothing was changed.</p>`, choices: [{ label: "OK", value: true, primary: true }] });
    return;
  }
  const now = (S.data?.forms || []).filter((f) => !f.missing).length;
  const ok = await ask({
    title: "Replace everything with this backup?",
    message: `<p>This backup was made ${esc(fmtStamp(pick.created_at))}${pick.app_version ? ` by closet ${esc(pick.app_version)}` : ""}. It holds <b>${plural(pick.pdfs, "PDF")}</b> and <b>${plural(pick.forms, "form record")}</b> (${fmtBytes(pick.size)}), and was checked and is intact.</p>
      <p>Right now closet has ${plural(now, "form")}. Restoring replaces the PDFs in the dump folder and all your edits, reviews, and settings with the backup's. PDFs in the dump folder that aren't in the backup are removed.</p>
      <p class="dim">What you have now is saved first as a safety backup in <span class="mono">${esc(pick.safety_dir)}</span>, and put back if the restore fails part-way.</p>`,
    choices: [{ label: "Cancel", value: null }, { label: "Replace with this backup", value: true, primary: true }], danger: true, wide: true,
  });
  if (!ok) return;
  toast("Restoring…");
  const r = await closet.importBackup(pick.path);
  if (!r?.ok) {
    await ask({ title: "The restore failed", message: `<p>${esc(r?.error || "Unknown error")}</p>`, choices: [{ label: "OK", value: true, primary: true }], danger: true });
    await load();
    return;
  }
  closeDetail();
  S.reviewId = null;
  S.exportPicked.clear();
  await load();
  await ask({
    title: "Backup restored",
    message: `<p>${plural(r.pdfs, "PDF")} and ${plural(r.forms, "record")} restored. closet is checking the files again in the background.</p><p class="dim">Your previous data is saved at <span class="mono">${esc(r.safety)}</span>. It's a normal backup: restore it the same way to go back.</p>`,
    choices: [{ label: "OK", value: true, primary: true }],
  });
}

// ------------------------------------------------------------------ updates
// The main process owns the schedule; this only shows its state (Settings → Updates) and says so
// once when a downloaded update is waiting.
let lastUpdateStatus = null;
function updateLine(u) {
  if (!u.supported) return u.reason;
  return {
    idle: "Not checked yet this session.",
    checking: "Checking for updates…",
    downloading: `Version ${u.latest} found. Downloading (${u.percent}%)…`,
    ready: `Version ${u.latest} is downloaded. It installs when you close closet, or now with the button.`,
    current: "You're up to date.",
    error: `Couldn't check for updates: ${u.error}`,
  }[u.status] || "";
}
function renderUpdates(u) {
  const host = $("#updBody");
  if (!host) return;
  const row = (title, desc, control) => `<div class="set-row"><div><h3>${title}</h3><p>${desc}</p></div><div>${control}</div></div>`;
  const busy = ["checking", "downloading"].includes(u.status);
  const btns = u.supported
    ? (u.status === "ready" ? `<button class="btn small primary" type="button" id="updInstall">Restart and install</button>` : `<button class="btn small" type="button" id="updCheck" ${busy ? "disabled" : ""}>${icon("refresh")}Check now</button>`)
    : `<button class="btn small" type="button" id="updReleases">Open releases page</button>`;
  host.innerHTML =
    row("Version", `closet ${esc(u.version)}. ${esc(updateLine(u))}`, `<div class="pair">${btns}</div>`) +
    (u.supported ? row("Automatic updates", "Checks GitHub for a newer release when closet starts and every few hours, downloads it in the background, and installs it when you close the app.",
      `<select class="select" id="updAuto"><option value="1" ${u.auto ? "selected" : ""}>On</option><option value="0" ${u.auto ? "" : "selected"}>Off (check manually)</option></select>`) : "");
  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  on("#updCheck", () => closet.updates.check().then(renderUpdates));
  on("#updInstall", async () => { if (await okToDiscard()) closet.updates.install(); });
  on("#updReleases", () => closet.updates.openReleases());
  const auto = $("#updAuto");
  if (auto) auto.onchange = () => closet.updates.setAuto(auto.value === "1").then(renderUpdates);
}
closet.updates.onStatus((u) => {
  renderUpdates(u);
  if (u.status === "ready" && lastUpdateStatus !== "ready") toast(`closet ${u.latest} is ready. It installs when you close the app.`);
  lastUpdateStatus = u.status;
});

// ------------------------------------------------------------------ desktop niceties
async function chooseDump() {
  if (!(await okToDiscard())) return;
  const r = await closet.chooseDumpFolder();
  if (r) toast(`Using ${r.dump}`);
}

// Pick PDFs from anywhere and add them to the dump folder without copying by hand. A name that's
// already in the dump folder pauses for a same-paperwork check instead of silently renaming.
async function bulkUpload() {
  const paths = await closet.pickUploadFiles();
  if (!paths.length) return;
  let res;
  try {
    res = await api("/api/upload/stage", { method: "POST", body: { paths } });
  } catch (e) { toast("Couldn't add those files: " + e.message, true); return; }
  let added = res.added.length;
  for (const c of res.conflicts) {
    const choice = await ask({
      title: `“${c.name}” is already in the dump folder`,
      message: "Is this an updated copy of the same paperwork &mdash; for example, the same form scanned back in now that it's signed?",
      choices: [
        { label: "Skip it", value: "skip" },
        { label: "Different form, keep both", value: "keep-both" },
        { label: "Same form, use this copy", value: "replace", primary: true },
      ],
    });
    if (choice === null || choice === "skip") continue;
    try {
      const r = await api("/api/upload/resolve", { method: "POST", body: { name: c.name, src: c.src, action: choice } });
      if (r.name) added++;
    } catch (e) { toast(`Couldn't add ${c.name}: ${e.message}`, true); }
  }
  if (added) toast(`Added ${plural(added, "PDF")} to the dump folder`);
  else toast("Nothing was added");
  await load();
}

// Initial every form still waiting on a step with the same initials, and date it, writing into the
// PDFs themselves. The initials are remembered (Settings → Bulk initials) so this is one click.
async function bulkStep(step, only = null) {
  if (!only && !(await okToDiscard())) return;
  let plan;
  try { plan = await api(`/api/bulk-step?step=${step}${only ? `&ids=${only}` : ""}`); } catch (e) { toast(e.message, true); return; }
  const n = plan.forms.length;
  if (!n) { toast(only ? `This form can't be initialed for ${plan.label} right now (it may still be being read)` : `Nothing is waiting on ${plan.label}${plan.skipped ? ` (${plan.skipped} still being read)` : ""}`, Boolean(only)); return; }
  const writes = plan.forms.reduce((a, f) => a + f.writes, 0);
  const initials = await ask({
    title: only ? `${plan.label}: initial this form?` : `${plan.label}: initial ${plural(n, "form")}?`,
    message: `<p>The same initials go in the box on ${only ? "this form" : "every form still waiting on this step"}${plan.fill_dates ? `, and today's date in the date box${step === "sqccf_processed" ? " (changeable in Settings)" : ""}` : ""}. Where a form has no fillable box there, a text box is placed on top of the spot. The PDFs are updated (the originals are kept in the metadata folder) and the step is marked done.</p>
      <p class="dim">${plural(n, "form")}, ${plural(writes, "entry", "entries")} to write.${plan.skipped ? ` ${plural(plan.skipped, "form")} still being read will be skipped.` : ""}${plan.fill_dates ? "" : " Dates are not being filled."}</p>`,
    input: { value: plan.initials, placeholder: "Initials", validate: (t) => (!t ? "Enter the initials to use." : t.length > 8 ? "Eight characters at most." : /[^ -~]/.test(t) ? "Plain letters and numbers only." : "") },
    choices: [{ label: "Cancel", value: null }, { label: only ? "Initial this form" : `Initial ${plural(n, "form")}`, value: true, primary: true }],
  });
  if (!initials) return;
  const btn = only ? null : $(step === "sqccf_processed" ? "#bulkSqccf" : "#bulkCc");
  if (btn) btn.disabled = true;
  try {
    toast(`Writing into ${plural(n, "PDF")}…`);
    const r = await api("/api/bulk-step", { method: "POST", body: { step, initials, ids: only ? [only] : undefined } });
    toast(`${plural(r.done.length, "form")} initialed${r.failed.length ? `, ${r.failed.length} couldn't be` : ""}.`, r.failed.length > 0);
    await load();
    if (only && S.detail?.id === only) openForm(only, { keepPage: true, silent: true, host: S.host });
    if (r.failed.length) {
      await ask({
        wide: true, title: "Some forms couldn't be initialed",
        message: `<p>These were left exactly as they were and still need ${esc(r.label)}:</p><ul class="issue-list">${r.failed.map((f) => `<li><span class="mono">${esc(f.filename)}</span><br><span class="dim">${esc(f.error)}</span></li>`).join("")}</ul>`,
        choices: [{ label: "OK", value: true, primary: true }],
      });
    }
  } catch (e) {
    toast("Couldn't initial the forms: " + e.message, true);
  } finally {
    const b = only ? null : $(step === "sqccf_processed" ? "#bulkSqccf" : "#bulkCc");
    if (b) b.disabled = false;
  }
}

async function autoProcess(step) {
  const d = S.detail;
  if (!d) return;
  if (isDirty()) { toast("Save your changes first, then complete the step", true); return; }
  if (step !== "approve") return bulkStep(step, d.id);
  const ok = await ask({
    title: "Mark AOC/AMT approved?",
    message: `<p>Use this when the AMT has told you this form is approved but didn't send a signed copy.</p>
      <p>The empty AOC/AMT signature box is removed and this stamp goes in its place. The PDF is updated (the original is kept in the metadata folder) and the AOC/AMT step is marked done.${d.record.form_type === "F174" ? " The commander date is filled in too." : ""}</p>
      <div class="stamp-demo"><small>Marked AOC/AMT approved by First Sergeant (unofficial)</small><b>AOC/AMT Approved</b></div>
      <p class="dim">This is not a signature. It only records that you were told it's approved.</p>`,
    choices: [{ label: "Cancel", value: null }, { label: "Apply stamp", value: true, primary: true }],
  });
  if (!ok) return;
  try {
    await api(`/api/forms/${d.id}/approve-aoc`, { method: "POST" });
    toast("Stamped and marked AOC/AMT approved");
    await load();
    if (S.detail?.id === d.id) openForm(d.id, { keepPage: true, silent: true, host: S.host });
  } catch (e) { toast("Couldn't stamp it: " + e.message, true); }
}

// Copy every active form still missing a chosen signature into a folder the user picks.
async function bulkDownloadBySignature() {
  const key = await ask({
    title: "Download paperwork missing a signature",
    message: "Every form still awaiting the chosen signature will be copied into a folder you pick next.",
    select: { options: FLAGS.map(([k, , long]) => [k, long]), value: FLAGS[0][0] },
    choices: [{ label: "Cancel", value: null }, { label: "Choose folder…", value: true, primary: true }],
  });
  if (!key) return;
  const [, , long] = FLAGS.find(([k]) => k === key) || [];
  const ids = active().filter((f) => f.parsed && f.record[key] === false).map((f) => f.id);
  if (!ids.length) { toast(`Nothing is awaiting: ${long}`, true); return; }
  const r = await closet.bulkDownload(ids);
  if (r?.ok) toast(`Downloaded ${plural(r.count, "PDF")} to ${r.dir}`);
  else if (r?.error) toast(r.error, true);
}

// Sort copies of every active form into "Quick dump" inside the dump folder, by first open step.
async function quickDump() {
  const btn = $("#quickDump");
  btn.disabled = true;
  try {
    const r = await api("/api/quick-dump", { method: "POST" });
    const parts = r.folders.filter((x) => x.count).map((x) => `${x.count} in ${x.name}`);
    toast(`${parts.join(", ") || "No forms to sort"}${r.skipped ? ` (${r.skipped} still being read, skipped)` : ""}`);
    closet.openFolder("quickdump");
  } catch (e) {
    toast("Quick dump failed: " + e.message, true);
  } finally {
    btn.disabled = false;
  }
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

// ------------------------------------------------------------------ sync
// Settings → "Quick dump" can be switched to Sync: each routing step gets a send folder (copies of
// forms waiting on it) and a returned folder (signed copies come back). The Paperwork button then
// pulls what came back, asks which form each file belongs to, clears closet's old copies, and
// pushes everything out again. The engine is core/sync.js; this is the conversation with the person.
const syncMode = () => S.data?.settings.dump_mode === "sync";
const SYNC_STEPS = () => [
  ...FLAGS.map(([k, short, long]) => [k, `Needs ${short}`, `Forms still waiting on: ${long}.`, true, true]),
  ["complete", "Fully complete", "Forms with every step done. Pushed here; nothing is pulled back.", true, false],
  ["intake", "New paperwork", "Pull new forms in from here (ones closet doesn't have yet). Nothing is pushed.", false, true],
];
let syncBusy = false;

function cropShot(p) {
  if (!p.rect || !p.size || p.page === null) return "";
  const [x0, y0, x1, y1] = p.rect;
  const px = Math.max(0.08, (x1 - x0) * 0.35);
  const py = 0.045;
  const r = [Math.max(0, x0 - px), Math.max(0, y0 - py), Math.min(1, x1 + px), Math.min(1, y1 + py)];
  const rw = r[2] - r[0];
  const rh = r[3] - r[1];
  const pct = (v) => `${(v * 100).toFixed(3)}%`;
  return `<div class="shot" style="aspect-ratio:${(rw * p.size.w) / (rh * p.size.h)}">
    <img src="closet://page/${p.id}/${p.page}?v=${encodeURIComponent(p.parsed_at || "")}" alt="The spot on the form where the field should be" style="width:${pct(1 / rw)};left:${pct(-r[0] / rw)};top:${pct(-r[1] / rh)}">
    <i style="left:${pct((x0 - r[0]) / rw)};top:${pct((y0 - r[1]) / rh)};width:${pct((x1 - x0) / rw)};height:${pct((y1 - y0) / rh)}"></i></div>`;
}

function showModal(html, setup) {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const scrim = document.createElement("div");
    scrim.className = "modal-scrim";
    scrim.innerHTML = html;
    document.body.appendChild(scrim);
    const done = (v) => { scrim.remove(); document.removeEventListener("keydown", onKey, true); prev?.focus?.(); resolve(v); };
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(null); } };
    document.addEventListener("keydown", onKey, true);
    setup(scrim, done);
  });
}

// One row per pulled file: which form it belongs to (best guess first), or new / ignore, and a tick
// to send the match to Review instead of applying it. Resolves with decisions, or null on cancel.
function confirmPulled(items) {
  const rows = items.map((it, i) => {
    const sug = it.suggestion;
    const opts = [...it.candidates.map((c) => `<option value="id:${c.id}" ${sug.action === "replace" && sug.id === c.id ? "selected" : ""}>${esc(`${c.filename}  (${Math.round(c.score * 100)}% match)`)}</option>`),
      `<option value="new" ${sug.action === "new" ? "selected" : ""}>New paperwork (add it as a new form)</option>`, `<option value="ignore">Ignore this file</option>`].join("");
    return `<tr data-i="${i}"><td><div class="who">${esc(it.filename)}</div><div class="sub">from ${esc(it.folder)}${it.error ? ` · <span style="color:#f0a3a3">${esc(it.error)}</span>` : ""}</div></td>
      <td><select class="select" data-pick>${opts}</select><div class="sub why" data-why></div></td>
      <td style="text-align:center"><input class="chk" type="checkbox" data-rev aria-label="Needs further review: ${esc(it.filename)}" ${sug.action === "replace" && sug.review ? "checked" : ""}></td></tr>`;
  }).join("");
  return showModal(`<div class="modal wide" role="dialog" aria-modal="true" aria-labelledby="mTitle">
    <h2 id="mTitle">Match returned paperwork</h2>
    <div class="modal-msg"><p>${plural(items.length, "file")} came back since the last sync. Check which form each one is. A match goes in as an updated copy of that form, like <b>Upload updated copy</b>. Tick <b>Review</b> to look at one more closely in the Review tab first (it's held back from the next push until you decide).</p></div>
    <div class="table-wrap modal-table"><table class="t"><thead><tr><th>File</th><th>Belongs to</th><th>Review</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="modal-actions"><button type="button" class="btn ghost" data-x="cancel">Cancel sync</button><button type="button" class="btn primary" data-x="ok">${icon("check")}Confirm</button></div></div>`, (scrim, done) => {
    $$("tr[data-i]", scrim).forEach((tr) => {
      const it = items[+tr.dataset.i];
      const sel = $("[data-pick]", tr);
      const rev = $("[data-rev]", tr);
      const sync = () => {
        const isForm = sel.value.startsWith("id:");
        rev.disabled = !isForm;
        if (!isForm) rev.checked = false;
        const c = it.candidates.find((x) => "id:" + x.id === sel.value);
        $("[data-why]", tr).textContent = c ? c.why.join("; ") : sel.value === "new" ? "Added to the dump folder as a new form." : "Left where it is and not looked at again.";
      };
      sel.onchange = sync;
      sync();
    });
    $("[data-x=cancel]", scrim).onclick = () => done(null);
    $("[data-x=ok]", scrim).onclick = () => done($$("tr[data-i]", scrim).map((tr) => {
      const it = items[+tr.dataset.i];
      const v = $("[data-pick]", tr).value;
      return v.startsWith("id:") ? { token: it.token, action: "replace", id: v.slice(3), review: $("[data-rev]", tr).checked } : { token: it.token, action: v };
    }));
    setTimeout(() => $("[data-x=ok]", scrim).focus(), 30);
  });
}

async function handleSignProblem(p, rep) {
  const who = p.recipients || p.filename;
  const canAdd = p.fixable && !p.blocked;
  const cannot = p.blocked || p.fix_error || (!p.fixable ? "closet can't add a field to this one." : "");
  const choice = await ask({
    wide: true,
    title: `${who}: the ${p.slot || "signature"} field can't be used`,
    message: `${cropShot(p)}<p style="margin-top:12px">${esc(p.filename)} needs <b>${esc(p.step_label)}</b> next, but the spot above won't work in Adobe:</p>
      <ul class="issue-list">${p.issues.map((i) => `<li>${esc(i.text)}</li>`).join("")}</ul>
      ${cannot ? `<p class="dim">${esc(cannot)}</p>` : ""}
      <p class="dim">It isn't being sent until you choose. <b>Already signed</b> records the step as done (say the signature was flattened into the page) and moves it on. <b>Add a new field</b> puts one on top of that spot in the copy that gets sent; your stored file isn't changed.</p>`,
    choices: [{ label: "Skip for now", value: null }, { label: "Send as it is", value: "as-is" },
      ...(canAdd ? [{ label: "Add a new field", value: "add-field", primary: true }] : []), { label: "Already signed", value: "signed", primary: !canAdd }],
  });
  if (!choice) return;
  try {
    const r = await api("/api/sync/fix", { method: "POST", body: { id: p.id, step: p.step, action: choice } });
    for (const k of ["leftovers", "blocked", "errors"]) rep[k].push(...r[k]);
    for (const [k, n] of Object.entries(r.pushed)) rep.pushed[k] = (rep.pushed[k] || 0) + n;
    const again = r.problems.find((x) => x.id === p.id);
    if (again) toast(`${who} still can't be sent${again.fix_error ? `: ${again.fix_error}` : ""}`, true);
    else rep.problems = rep.problems.filter((x) => x !== p);
  } catch (e) { toast(`Couldn't apply that: ${e.message}`, true); }
}

async function syncNotices(rep) {
  const left = [...new Map(rep.leftovers.map((l) => [l.file, l])).values()];
  const lines = [
    ...left.map((l) => `<li><span class="mono">${esc(l.file)}</span><br><span class="dim">${esc(l.why)}</span></li>`),
    ...rep.blocked.filter((b) => !left.some((l) => l.file === b.file)).map((b) => `<li><span class="mono">${esc(b.file)}</span><br><span class="dim">already there, so ${esc(b.filename)} wasn't copied over it</span></li>`),
  ];
  if (!lines.length) return;
  await ask({
    wide: true, title: "Files left alone",
    message: `<p>closet only removes the copies it put there itself. ${plural(lines.length, "file was", "files were")} left as they are in the send folders. Move or delete them yourself if they're not needed; a copy that was blocked by one is sent next sync.</p><ul class="issue-list">${lines.slice(0, 15).join("")}</ul>${lines.length > 15 ? `<p class="dim">…and ${lines.length - 15} more.</p>` : ""}`,
    choices: [{ label: "OK", value: true, primary: true }],
  });
}

async function runSync() {
  if (syncBusy) return;
  if (!(await okToDiscard())) return;
  syncBusy = true;
  document.body.dataset.syncing = "1";
  const btn = $("#quickDump");
  if (btn) btn.disabled = true;
  try {
    toast("Syncing…");
    const pulled = await api("/api/sync/pull", { method: "POST" });
    pulled.errors.forEach((e) => toast(e, true));
    let note = "";
    if (pulled.items.length) {
      const decisions = await confirmPulled(pulled.items);
      if (decisions === null) { toast("Sync cancelled. Nothing was changed or sent."); await load(); return; }
      const r = await api("/api/sync/resolve", { method: "POST", body: { decisions } });
      r.errors.forEach((e) => toast(e, true));
      const bits = [r.replaced.length && `${plural(r.replaced.length, "form")} updated`, r.added.length && `${r.added.length} new`, r.review && `${r.review} to Review`].filter(Boolean);
      note = bits.length ? `${bits.join(", ")}. ` : "";
    }
    const rep = await api("/api/sync/push", { method: "POST" });
    await load();
    for (const p of [...rep.problems]) await handleSignProblem(p, rep);
    rep.errors.forEach((e) => toast(e, true));
    const sent = Object.values(rep.pushed).reduce((a, b) => a + b, 0);
    toast(`${note}Sent ${plural(sent, "form")}${rep.problems.length ? `, ${rep.problems.length} held back` : ""}${rep.held.length ? `, ${rep.held.length} waiting in Review` : ""}.`);
    await load();
    await syncNotices(rep);
  } catch (e) {
    toast("Sync failed: " + e.message, true);
  } finally {
    syncBusy = false;
    delete document.body.dataset.syncing;
    const b = $("#quickDump");
    if (b) b.disabled = false;
  }
}

// Review tab: a pulled file the person wanted a closer look at, beside the form it might replace.
async function renderSyncReview(token) {
  const pane = $("#reviewPane");
  let p;
  try { p = await api(`/api/sync/pending/${token}`); } catch { S.reviewId = null; renderView(); return; }
  const forms = active().filter((f) => !p.candidates.some((c) => c.id === f.id));
  let formId = S.syncPick?.token === token ? S.syncPick.id : p.review_id;
  const sheet = (src, r) => `<div class="sheet nobox" style="aspect-ratio:${r.w}/${r.h};width:${S.zoom.review * 100}%"><img src="${src}" alt=""></div>`;
  const draw = async () => {
    let d = null;
    try { d = formId ? await api(`/api/forms/${formId}`) : null; } catch { /* the form went away */ }
    const z = S.zoom.review;
    const pages = (renders, mk) => (renders || []).map((r) => `<div class="pg-label">Page ${r.page + 1}</div>${sheet(mk(r), r)}`).join("") || '<div class="empty">No preview</div>';
    const opts = [...p.candidates.map((c) => [c.id, `${c.filename} (${Math.round(c.score * 100)}% match)`]), ...forms.map((f) => [f.id, f.filename])];
    pane.innerHTML = `<div class="review-card sync-compare">
      <header class="d-head"><div style="min-width:0"><h2>${esc(p.filename)}</h2><div class="fn">Came back in the ${esc(p.folder)} folder, ${esc(fmtStamp(p.pulled_at))}</div>
        <div class="chips"><span class="chip warn">Check this match</span>${p.error ? `<span class="chip crit">${esc(p.error)}</span>` : ""}</div></div><div class="spacer"></div>
        <div class="acts"><span class="seg" role="group" aria-label="Zoom">${[1, 1.5, 2].map((v) => `<button type="button" data-z="${v}" aria-pressed="${v === z}">${v === 1 ? "Fit" : v * 100 + "%"}</button>`).join("")}</span>
        <button type="button" class="btn ghost small" data-wide title="Hide the queue so each page gets more room">${S.wide ? "Show list" : "Expand preview"}</button></div></header>
      <div class="cmp-pick"><label for="syncPick">This file belongs to</label><select class="select" id="syncPick">
        ${opts.map(([id, l]) => `<option value="${id}" ${id === formId ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
        <span class="dim">${esc((p.candidates.find((c) => c.id === formId)?.why || []).join("; "))}</span></div>
      <div class="d-body"><div class="d-pane d-left"><div class="cmp-title">Pulled copy</div>${pages(p.analysis.renders, (r) => `closet://syncpage/${token}/${r.page}`)}</div>
        <div class="d-pane d-left"><div class="cmp-title">${d ? `In closet: ${esc(d.filename)}` : "No form chosen"}</div>${d ? pages(d.analysis?.renders, (r) => `closet://page/${d.id}/${r.page}?v=${encodeURIComponent(d.parsed_at || "")}`) : ""}</div></div>
      <div class="review-actions"><span class="note">Using the pulled copy replaces that form's PDF; your edits and history stay.</span>
        <button class="btn ghost" type="button" data-s="ignore">Ignore file</button><button class="btn" type="button" data-s="new">Add as a new form</button>
        <button class="btn primary" type="button" data-s="replace" ${d ? "" : "disabled"}>${icon("check")}Use as updated copy</button></div></div>`;
    $("#syncPick", pane).onchange = (e) => { formId = e.target.value; S.syncPick = { token, id: formId }; draw(); };
    $$("[data-z]", pane).forEach((b) => (b.onclick = () => { S.zoom.review = +b.dataset.z; draw(); }));
    $("[data-wide]", pane).onclick = () => { S.wide = !S.wide; $(".review-layout")?.classList.toggle("wide", S.wide); draw(); };
    $$("[data-s]", pane).forEach((b) => (b.onclick = async () => {
      const action = b.dataset.s;
      try {
        const r = await api("/api/sync/resolve", { method: "POST", body: { decisions: [{ token, action, id: formId, review: false }] } });
        if (r.errors.length) { toast(r.errors[0], true); return; }
        toast(action === "replace" ? "Updated. Reading it again…" : action === "new" ? "Added as a new form" : "Ignored");
        S.reviewId = null;
        S.syncPick = null;
        await load();
      } catch (e) { toast(e.message, true); }
    }));
  };
  await draw();
}

// ------------------------------------------------------------------ go
(async () => {
  document.body.classList.add("desktop", `os-${closet.platform}`);
  await load();
  route();
})();
