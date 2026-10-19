// Matching people across spellings and formats: "Doe, John A.", "C2C John Doe" and "john doe" are
// one person, and a name within two letters of another is a probable typo (the same threshold the
// new-form name check uses). Pure functions; no I/O.

import { collapse, levenshtein, stripRank } from "./records.js";

const SUFFIX = /^(jr|sr|ii|iii|iv|v)$/;
const HONORIFIC = /^(mr|mrs|ms|miss|dr)$/;

const titleCase = (s) => s.replace(/(^|[\s-])([a-z])/g, (_m, a, b) => a + b.toUpperCase());

/**
 * A name broken into given names and a family name, whatever order it was written in.
 * "Doe, John A" and "John A. Doe" both give given ["john"], family "doe".
 */
export function nameParts(raw) {
  let s = stripRank(String(raw ?? "").replace(/<[^>]*>|\([^)]*\)|"[^"]*"/g, " "));
  s = s.replace(/[’']/g, "").replace(/[^A-Za-z,\-\s]/g, " ");
  const clean = (str) => collapse(str).toLowerCase().split(" ")
    .map((t) => t.replace(/^-+|-+$/g, "")).filter((t) => t && !SUFFIX.test(t) && !HONORIFIC.test(t));
  const chunks = s.split(",").map(clean).filter((c) => c.length);
  const comma = s.includes(",") && chunks.length >= 2;
  const tokens = comma ? [...chunks[1], ...chunks[0]] : clean(s.replace(/,/g, " ")); // "Last, First M" -> First M Last
  const core = tokens.filter((t) => t.length > 1); // initials never decide who someone is
  return {
    tokens, core, comma,
    given: core.length > 1 ? core.slice(0, -1) : core,
    family: core.length > 1 ? core[core.length - 1] : "",
  };
}

/** "doe, john a" -> "John A Doe": the way recipient names are written everywhere else in closet. */
export function displayName(raw) {
  const p = nameParts(raw);
  return p.tokens.length ? titleCase(p.tokens.join(" ")) : collapse(raw);
}

/** Letters a token may be off by: none for short ones, so "Al" never matches "Ed". */
const slack = (a, b) => Math.floor(Math.min(a.length, b.length) / 3);

function tokenDist(a, b) {
  if (a === b) return 0;
  const d = levenshtein(a, b, 2);
  return d <= slack(a, b) ? d : 3;
}

/** The ways a name could be read: as written, and (with no comma to say) family name first. */
function readings(p) {
  const out = [{ given: p.given, family: p.family }];
  if (!p.comma && p.core.length > 1) out.push({ given: p.core.slice(1), family: p.core[0] });
  return out;
}

/**
 * How many letters apart two names are, counting a different order, a middle name or initial, a
 * rank, or "Last, First" as no difference at all. 3 means "not the same person".
 */
export function nameDistance(a, b) {
  const pa = nameParts(a);
  const pb = nameParts(b);
  if (!pa.tokens.length || !pb.tokens.length) return 3;
  if (pa.core.length < 2 || pb.core.length < 2) {
    // a lone word only matches an identical lone word
    return pa.core.join(" ") === pb.core.join(" ") && pa.core.length ? 0 : 3;
  }
  let best = 3;
  for (const x of readings(pa)) {
    for (const y of readings(pb)) {
      const fd = tokenDist(x.family, y.family);
      if (fd > 2) continue;
      let gd = 3;
      for (const g1 of x.given) for (const g2 of y.given) gd = Math.min(gd, tokenDist(g1, g2));
      if (fd + gd <= 2) best = Math.min(best, fd + gd);
    }
  }
  return best;
}

/**
 * The nearest of `candidates` (strings) to `name`, or null. `distinct(a, b)` lets the caller
 * exclude pairs the user already ruled are different people. Different people at the same
 * distance come back `ambiguous`, so nothing is linked on a coin flip.
 */
export function bestMatch(name, candidates, { distinct = () => false, max = 2 } = {}) {
  let best = null;
  let tied = false;
  for (const c of candidates) {
    if (distinct(name, c)) continue;
    const d = nameDistance(name, c);
    if (d > max) continue;
    if (!best || d < best.dist) { best = { name: c, dist: d }; tied = false; }
    else if (d === best.dist && nameDistance(best.name, c) > 0) tied = true;
  }
  return best ? { ...best, ambiguous: tied } : null;
}
