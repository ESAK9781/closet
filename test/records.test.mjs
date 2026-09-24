import assert from "node:assert/strict";
import { test } from "node:test";

import * as R from "../src/core/records.js";

test("dates as people write them on these forms", () => {
  const cases = {
    "12 Sep 26": "2026-09-12", "16SEP2026": "2026-09-16", "16-Sep-26": "2026-09-16", "09/20/2026": "2026-09-20",
    "9/2/26": "2026-09-02", "2026-09-16": "2026-09-16", "20260916": "2026-09-16", "September 16, 2026": "2026-09-16",
    "Sept 3 2026": "2026-09-03", "": null, "N/A": null, "31 Feb 26": null,
  };
  for (const [raw, want] of Object.entries(cases)) assert.equal(R.parseDate(raw), want, raw);
});

test("filename supplies Pos/Neg and the reason", () => {
  const f = R.parseFilename("John Doe_Neg_F10_UniformViolation.pdf");
  assert.equal(f.pos_neg, "Neg");
  assert.equal(f.reason, "Uniform Violation");
  assert.equal(f.valid, true);
  assert.equal(R.parseFilename("scan0042.pdf").pos_neg, "");
  assert.equal(R.parseFilename("Lee, Kevin_Positive_AF174_Late.pdf").pos_neg, "Pos");
});

test("ranks never stay in a name, and look-alikes are left alone", () => {
  const cases = {
    "C4C John Doe": "John Doe", "Cadet Jane Smith": "Jane Smith", "C/Capt Sarah Mitchell": "Sarah Mitchell",
    "C/2d Lt Amy Wu": "Amy Wu", "C3C Doe, John": "John Doe", "Coles, Cadet Mary": "Mary Coles",
    "Ccarter, Cadence": "Cadence Ccarter", "Doe, John, A, Jr": "John A Jr Doe",
  };
  for (const [raw, want] of Object.entries(cases)) assert.equal(R.singleName(raw), want, raw);
});

test("typed recipient lists: commas split people, one-word pieces are surnames", () => {
  assert.deepEqual(R.splitNames("Doe, John, Amy Wu"), ["John Doe", "Amy Wu"]);
  assert.deepEqual(R.splitNames("C4C Doe, John A; Smith, Jane"), ["John A Doe", "Jane Smith"]);
  assert.deepEqual(R.splitNames("John Doe, Amy Wu"), ["John Doe", "Amy Wu"]);
  assert.equal(R.nameKey("C4C John Doe"), R.nameKey("Doe John"));
});

test("confirmed spellings apply everywhere", () => {
  R.ALIASES.set("jon a doe", "John A Doe");
  try {
    assert.equal(R.singleName("Doe, Jon A"), "John A Doe");
    assert.deepEqual(R.splitNames("Jon A Doe, Amy Wu"), ["John A Doe", "Amy Wu"]);
  } finally {
    R.ALIASES.clear();
  }
  assert.equal(R.levenshtein("john a doe", "jon a doe", 2), 1);
  assert.equal(R.levenshtein("john doe", "jane smith", 2), 3);
});

test("sanction counts: blank/N/A are 0, labels are ignored, scans stay blank", () => {
  const cases = { "": "0", 2: "2", "4. TOURS": "0", "4. TOURS 2": "2", "N/A": "0", na: "0", None: "0", "1. DEMERIT(S) 5": "5", "3 tours": "3", "2.0": "2" };
  for (const [raw, want] of Object.entries(cases)) assert.equal(R.sanctionCount(raw), want, raw);
  assert.equal(R.sanctionCount("", { source: "ink" }), "");
  assert.equal(R.sanctionCount("", null, true), "");
  assert.equal(R.otherText("N/A"), "");
  assert.equal(R.otherText("3. LOSS OF PASS PRIV 1 weekend"), "1 weekend");
});

test("CDNA and Passes only for positive F10s, and required there", () => {
  assert.deepEqual(R.missingManual({ form_type: "F10", pos_neg: "Pos", cdna: "", passes: "" }), ["CDNA", "Passes"]);
  assert.deepEqual(R.missingManual({ form_type: "F10", pos_neg: "Pos", cdna: "3", passes: "" }), ["Passes"]);
  assert.deepEqual(R.missingManual({ form_type: "F10", pos_neg: "Neg" }), []);
  assert.deepEqual(R.missingManual({ form_type: "F174", pos_neg: "Pos" }), []);
});

test("sheet rows: one per recipient, CDNA/Passes/Demerits columns follow the rules", () => {
  const settings = { form_type_labels: { F10: "F10" }, pos_label: "Pos", neg_label: "Neg", month_format: "name" };
  const rec = {
    form_type: "F10", pos_neg: "Pos", date_iso: "2026-09-12", class_year: "2028, 2029", reason_category: "Service",
    reason_details: "x".repeat(400), issuer: "C/Capt Mitchell", cdna: "3", passes: "2", demerits: "0", tours: "0",
    confinements: "0", other: "", recipient_list: ["Jane Smith", "Amy Wu"],
  };
  const rows = R.sheetRows(rec, settings, new Map());
  assert.equal(rows.length, 2);
  const byCol = (r) => Object.fromEntries(R.SHEET_COLUMNS.map((c, i) => [c, r[i]]));
  assert.deepEqual([byCol(rows[0])["Class Year"], byCol(rows[1])["Class Year"]], ["2028", "2029"]);
  assert.equal(byCol(rows[0]).CDNA, "3");
  assert.equal(byCol(rows[0]).Passes, "2");
  assert.equal(byCol(rows[0]).Month, "September");
  assert.equal(byCol(rows[0])["Reason Details"].length, 400, "reason details are never trimmed");
  const neg = byCol(R.sheetRows({ ...rec, pos_neg: "Neg", recipient_list: ["Jane Smith"] }, settings, new Map())[0]);
  assert.equal(neg.CDNA, "");
  assert.equal(neg.Passes, "");
  const f174 = byCol(R.sheetRows({ ...rec, form_type: "F174", recipient_list: ["Jane Smith"] }, settings, new Map())[0]);
  assert.deepEqual([f174.Demerits, f174.Tours, f174.Confinements], ["", "", ""]);
});
