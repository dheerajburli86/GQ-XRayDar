// Alert report card over stored price history (engine/scorecard.js does the maths).
import { ruleScorecard } from "../../engine/scorecard.js";
import { RULES } from "../../engine/rules.js";

export function createScorecard({ data }) {
  const cache = new Map();
  async function card({ rule, params = {}, tf = "D", ids = null, sample = 150 }) {
    if (!RULES[rule]) throw Object.assign(new Error(`unknown rule ${rule}`), { status: 400 });
    if (!["D", "W", "M"].includes(tf)) throw Object.assign(new Error("tf must be D, W or M"), { status: 400 });
    const st = await data.get();
    const pick = (ids?.length ? ids : st.rows.filter((r) => r.sec.assetClass === "Stock").sort((a, b) => (b.sec.capUsdNow || 0) - (a.sec.capUsdNow || 0)).slice(0, sample).map((r) => r.id)).slice(0, 500);
    const key = JSON.stringify([st.run.run_id, rule, params, tf, pick]);
    if (cache.has(key)) return cache.get(key);
    const bars = await data.api.barsMany(pick, "2005-01-01");
    const out = { ...ruleScorecard(bars, { rule, params, tf, maxTrades: 40, symbolOf: (id) => st.secById.get(id)?.symbol || id }), asOf: st.info.asOf };
    out.instrumentsTested = pick.length;
    cache.set(key, out);
    if (cache.size > 100) cache.delete(cache.keys().next().value);
    return out;
  }
  return { card };
}
