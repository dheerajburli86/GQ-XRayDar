// Multi-condition alerts. A rule fires for a security when ALL its conditions
// hold on the latest data; the inbox records the first time each
// (rule, security, as-of date) matched, so a condition that persists does not
// re-notify every refresh. Delivery here is in-app; Telegram / the GQ agent
// plug into `deliver` later.

import { testCondition } from "./fields.js";

export const ALERT_TEMPLATES = [
  { id: "rsc_mma", name: "RSC + MMA", desc: "Weekly RSC vs country rising AND weekly MMA in bullish alignment",
    conditions: [{ field: "rscRising_country_W", op: "is true" }, { field: "mmaBullW", op: "is true" }] },
  { id: "ww_rsc", name: "WW + RSC", desc: "Weight in its sector rising (or turning up from a low) AND weekly RSC vs country rising",
    conditions: [{ field: "wwTrend", op: "in", value: "rising,turn_up_from_low" }, { field: "rscRising_country_W", op: "is true" }] },
  { id: "high52_volume", name: "52-week high + volume", desc: "At a 52-week high on volume at least 1.5x its 50-day average",
    conditions: [{ field: "atHigh52", op: "is true" }, { field: "volRatio", op: ">=", value: 1.5 }] },
  { id: "fund_breakout", name: "Fundamentals + breakout", desc: "Fundamentals improving AND a daily or weekly breakout in the last 5 bars",
    conditions: [{ field: "fundImproving", op: "is true" }, { field: "breakoutW", op: "is true" }], any2: [{ field: "breakoutD", op: "is true" }] },
  { id: "sector_rsc_ewcw", name: "Sector RSC + EWCW", desc: "A sector index whose RSC vs its market is Leading/Improving AND whose EW/CW ratio is broadening", scope: "sector" },
];

export const templateById = (id) => ALERT_TEMPLATES.find((t) => t.id === id);

function matchesRule(row, rule) {
  const t = templateById(rule.template);
  const conds = rule.template === "custom" ? rule.conditions || [] : t?.conditions || [];
  if (!conds.length) return false;
  if (t?.any2) {
    // the last condition may be satisfied by an alternative (daily OR weekly breakout)
    const base = conds.slice(0, -1).every((c) => testCondition(row, c));
    return base && (testCondition(row, conds[conds.length - 1]) || t.any2.some((c) => testCondition(row, c)));
  }
  return conds.every((c) => testCondition(row, c)) && (rule.extra || []).every((c) => testCondition(row, c));
}

/**
 * rules:   [{id, name, template, conditions?, universe:{watchlistIds?:[], country?, region?, sector?}, enabled}]
 * rows:    screen rows ({sec, flat})
 * sectorCtx: { rotation: {scopeKey: [...]}, ewcw: [...] } for the sector template
 * Returns current matches: [{ruleId, key, id, symbol, name, asOf, detail}]
 */
export function evaluateAlerts(rules, rows, watchlists = {}, sectorCtx = null, asOf = null) {
  const out = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.template === "sector_rsc_ewcw") {
      if (!sectorCtx) continue;
      const ew = new Map((sectorCtx.ewcw || []).filter((e) => e.ccy === (e.scopeKey.startsWith("C:") ? "LCL" : "USD")).map((e) => [e.scopeKey, e]));
      for (const [scope, list] of Object.entries(sectorCtx.rotation || {})) {
        if (rule.universe?.scope && rule.universe.scope !== scope) continue;
        for (const s of list) {
          if (!["Leading", "Improving"].includes(s.quadrant)) continue;
          const e = ew.get(`${scope}|S:${s.name}`);
          if (!e || !(e.chg?.["3M"] > 0)) continue;
          out.push({ ruleId: rule.id, key: `${rule.id}|${scope}|${s.name}|${asOf}`, id: null, symbol: s.name, name: `${s.name} in ${scope}`, asOf,
            detail: `${s.quadrant} (RS-Ratio ${s.ratio}, RS-Mom ${s.mom}); EW/CW ${e.chg["3M"] > 0 ? "+" : ""}${e.chg["3M"]}% over 3M` });
        }
      }
      continue;
    }
    const wlIds = rule.universe?.watchlistIds || [];
    const allowed = wlIds.length ? new Set(wlIds.flatMap((w) => watchlists[w]?.ids || [])) : null;
    for (const r of rows) {
      if (allowed && !allowed.has(r.sec.id)) continue;
      const u = rule.universe || {};
      if (u.country && r.sec.country !== u.country) continue;
      if (u.region && r.sec.region !== u.region) continue;
      if (u.sector && r.sec.sector !== u.sector) continue;
      if (!matchesRule(r, rule)) continue;
      const d = r.flat?.asOf || asOf;
      out.push({ ruleId: rule.id, key: `${rule.id}|${r.sec.id}|${d}`, id: r.sec.id, symbol: r.sec.symbol, name: r.sec.name, asOf: d, detail: rule.name });
    }
  }
  return out;
}
