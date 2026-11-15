import { test } from "node:test";
import assert from "node:assert/strict";
import { groupEti, matchEti, etiAnswer, ETI_CHARACTERISTICS } from "../engine/eti.js";
import { FIELD } from "../engine/fields.js";

test("ten characteristics, six IMB and four ETI gates", () => {
  assert.equal(ETI_CHARACTERISTICS.length, 10);
  assert.equal(ETI_CHARACTERISTICS.filter((c) => c.framework === "imb").length, 6);
  for (const c of ETI_CHARACTERISTICS) assert.ok(FIELD[`eti_${c.key}`], c.key);
});

test("null is unknown, never no", () => {
  assert.equal(etiAnswer(true), "yes"); assert.equal(etiAnswer(false), "no"); assert.equal(etiAnswer(null), "unknown");
  const m = groupEti([
    { company_id: 1, characteristic: "imb_cagr", meets: true, instrument_id: 77, company_name: "A", as_of: "2026-11-13" },
    { company_id: 1, characteristic: "imb_quiet_base", meets: null, note: "no inflection", as_of: "2026-11-13" },
    { company_id: 2, characteristic: "imb_cagr", meets: false },
  ]);
  const a = m.get(1);
  assert.equal(a.instrumentId, "77");
  assert.equal(a.flags.imb_cagr, "yes");
  assert.equal(a.flags.imb_quiet_base, "unknown");
  assert.equal(a.flags.eti_g4_legacy_valuation, "unknown"); // not computed yet
  assert.ok(matchEti(a, { imb_cagr: "yes", imb_quiet_base: "unknown" }));
  assert.ok(!matchEti(a, { imb_quiet_base: "no" }));
  assert.ok(matchEti(m.get(2), { imb_cagr: "no", imb_history_5y: "" }));
});
