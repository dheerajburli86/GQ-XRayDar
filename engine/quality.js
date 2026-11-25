import { CAP_UNRELIABLE_COUNTRIES } from "./geography.js";
// Data health: problems that would otherwise surface only as a wrong number.
// Each issue names the instrument, the rule and the evidence. Nothing here
// changes data -- it reports.

export const SEVERITY = { error: 3, warn: 2, info: 1 };

/**
 * Per-security checks.
 *   daily                  own bars
 *   ctx.countryLatest      latest session date of the security's country
 *   ctx.countrySessions    Set of dates on which >= 80% of the country's listed stocks traded
 *   ctx.recentFrom         first date of the missing-session look-back window
 */
export function securityIssues(sec, daily, ctx) {
  const out = [];
  const add = (severity, rule, detail) => out.push({ id: sec.id, symbol: sec.symbol, country: sec.country, severity, rule, detail });
  const n = daily?.time?.length || 0;
  if (!n) { add("warn", "no_price_history", "No price bars"); return out; }
  const last = daily.time[n - 1];
  if (sec.active && ctx.countryLatest && last < ctx.countryLatest) {
    const behind = ctx.sessionsBetween ? ctx.sessionsBetween(last, ctx.countryLatest) : null;
    if (behind == null || behind > 5) add("warn", "stale_price", `Last bar ${last}; country latest ${ctx.countryLatest}${behind != null ? ` (${behind} sessions behind)` : ""}`);
  }
  if (ctx.countrySessions && ctx.recentFrom) {
    const have = new Set(daily.time);
    let missing = 0; const sample = [];
    for (const d of ctx.countrySessions) {
      if (d < ctx.recentFrom || d < daily.time[0] || d > last) continue;
      if (!have.has(d)) { missing++; if (sample.length < 5) sample.push(d); }
    }
    if (missing > 10) add("warn", "missing_sessions", `${missing} sessions missing in the last year where most of the country traded (e.g. ${sample.join(", ")})`);
    else if (missing > 0) add("info", "missing_sessions", `${missing} session(s) missing in the last year (e.g. ${sample.join(", ")})`);
  }
  const c = daily.close;
  for (let i = 1; i < n; i++) {
    const r = c[i] / c[i - 1];
    if (r > 1.8 || r < 0.55) {
      const reverted = i + 1 < n && Math.abs(c[i + 1] / c[i - 1] - 1) < 0.1;
      add(reverted ? "warn" : "error", reverted ? "price_spike" : "possible_split",
        `${daily.time[i - 1]} ${c[i - 1]} -> ${daily.time[i]} ${c[i]} (x${r.toFixed(3)})${reverted ? ", reverted next session" : " - check for an unadjusted corporate action"}`);
    }
  }
  for (let i = 0; i < n; i++) {
    if (daily.high && (daily.high[i] < daily.low[i] || daily.close[i] > daily.high[i] * 1.0001 || daily.close[i] < daily.low[i] * 0.9999)) {
      add("info", "ohlc_inconsistent", `${daily.time[i]} close outside high-low range`); break;
    }
  }
  const stock = !sec.assetClass || sec.assetClass === "Stock";
  if (stock && !sec.capLocal && !sec.capUsd && !CAP_UNRELIABLE_COUNTRIES.has(sec.country)) add("warn", "missing_market_cap", "No market cap: excluded from CW and EW indices");
  if (stock && sec.sector === "Others") add("info", "unclassified_sector", `No GICS sector (evidence: ${sec.classSource})`);
  if (!sec.geoAssigned) add("warn", "unassigned_geography", `Country "${sec.country}" has no region / classification mapping`);
  if (sec.countryCurrency && sec.currencyMajor !== sec.countryCurrency) add("info", "foreign_currency_listing", `Quoted in ${sec.currency}; country currency ${sec.countryCurrency} (converted via FX)`);
  return out;
}

/** Corporate-action adjustment: actions [{exDate, factor}] where factor = new shares per old
 *  (2-for-1 split -> 2). Prices before exDate are divided by the factor, volumes multiplied. */
export function applyCorporateActions(daily, actions) {
  if (!actions?.length) return { bars: daily, applied: [] };
  const bars = { ...daily, open: [...daily.open], high: [...daily.high], low: [...daily.low], close: [...daily.close], volume: daily.volume ? [...daily.volume] : null };
  const applied = [];
  for (const a of [...actions].sort((x, y) => (x.exDate < y.exDate ? -1 : 1))) {
    if (!(a.factor > 0) || a.factor === 1) continue;
    let k = 0;
    for (let i = 0; i < bars.time.length && bars.time[i] < a.exDate; i++) {
      bars.open[i] /= a.factor; bars.high[i] /= a.factor; bars.low[i] /= a.factor; bars.close[i] /= a.factor;
      if (bars.volume) bars.volume[i] *= a.factor;
      k++;
    }
    applied.push({ ...a, barsAdjusted: k });
  }
  return { bars, applied };
}

/**
 * Bad prints: a run of 1-5 closes that jumps at least x1.8 (or below x0.55) away from the
 * previous close and then comes back to within 15% of it. Seen in the heatmap's price history,
 * e.g. Quality Houses (Thailand) closing 899,101 on 31 Dec 2021 between two days at 2.26, and
 * LATAM Airlines' alternating x2 prints. Left in, one such bar makes a stock worth more than
 * the whole world for a quarter (Weight Watcher, CW indices, every return through that date).
 * The run is dropped (treated as a missing session) and reported; nothing else is changed.
 * Returns { bars, removed: [{ date, close, prev }] }.
 */
export function removeBadPrints(daily, { jump = 1.8, back = 0.15, maxRun = 5 } = {}) {
  const c = daily?.close, n = c?.length || 0;
  if (n < 3) return { bars: daily, removed: [] };
  const drop = new Uint8Array(n);
  const removed = [];
  let i = 1;
  while (i < n) {
    const p = c[i - 1], r = c[i] / p;
    if (p > 0 && (r >= jump || r <= 1 / jump)) {
      // a unit-sized error (a holiday bar carrying the ADR price in dollars against a price in cents: x0.001)
      // may come back to a level a real move away from the old one, so the return test is wider for those
      const bk = (r >= 5 || r <= 0.2) ? Math.max(back, 0.5) : back;
      let k = -1;
      for (let j = i + 1; j < n && j <= i + maxRun; j++) {
        const q = c[j] / p;
        if (q >= 1 - bk && q <= 1 + bk) { k = j; break; }
        if (q < 1.5 && q > 1 / 1.5) break; // came part-way back: a real move, not a clean bad print
      }
      if (k > 0) {
        for (let j = i; j < k; j++) { drop[j] = 1; removed.push({ date: daily.time[j], close: c[j], prev: p }); }
        i = k + 1;
        continue;
      }
    }
    i++;
  }
  if (!removed.length) return { bars: daily, removed };
  const keep = (a) => (a ? Array.from(a).filter((_, j) => !drop[j]) : a);
  return { bars: { ...daily, time: keep(daily.time), open: keep(daily.open), high: keep(daily.high), low: keep(daily.low), close: keep(daily.close), volume: keep(daily.volume) }, removed };
}

/**
 * Ticker reuse: a ticker that changed hands (Facebook took "META" in June 2022; before that it belonged to a
 * ~$14 company) carries the OLD company's bars in front of the new one. The tell is a calendar gap of a week or
 * more AND a permanent level change of x5 or more across it. Everything before the break is another company, so
 * the series starts at the break. A split or a bad print never trips this: those have no gap, or come back.
 * The newer side must hold at least `minAfter` bars, otherwise the series is left alone.
 */
export function cutAtTickerReuse(daily, { gapDays = 7, factor = 5, minAfter = 20 } = {}) {
  const c = daily?.close, t = daily?.time, n = c?.length || 0;
  if (n < minAfter + 2) return { bars: daily, cut: null };
  const ms = (d) => Date.parse(`${String(d).slice(0, 10)}T00:00:00Z`);
  let at = -1;
  for (let i = 1; i <= n - minAfter; i++) {
    const p = c[i - 1], q = c[i];
    if (!(p > 0) || !(q > 0)) continue;
    const r = q / p;
    if ((r >= factor || r <= 1 / factor) && (ms(t[i]) - ms(t[i - 1])) / 86400000 >= gapDays) at = i;
  }
  if (at < 0) return { bars: daily, cut: null };
  const from = (a) => (a ? Array.from(a).slice(at) : a);
  return {
    bars: { ...daily, time: from(t), open: from(daily.open), high: from(daily.high), low: from(daily.low), close: from(c), volume: from(daily.volume) },
    cut: { date: t[at], bars: at, prev: c[at - 1], next: c[at] },
  };
}

/**
 * Share-count breaks: the close moves at least x3 (or below x1/3) within 10 sessions and does
 * not come back (the next 20 closes stay at least x2 away from the level before). That is what
 * an unadjusted split, a reverse split or a restructuring that issues or cancels most of the
 * shares looks like (LATAM Airlines, Nov 2021 and Sep-Oct 2022). Historical market caps are
 * latest shares x past price, so before such a break they are not usable at all.
 * Returns the bar index from which constant-share caps can be used (0 = all history), and the breaks.
 */
export function shareBreaks(daily, { factor = 3, window = 10, hold = 20, stay = 2 } = {}) {
  const c = daily?.close, n = c?.length || 0;
  const breaks = [];
  let from = 0;
  for (let i = 1; i < n; i++) {
    for (let w = 1; w <= window && i - w >= 0; w++) {
      // the level before the move: median of the 5 closes up to i - w (one odd close is not a level)
      const pre = c.slice(Math.max(0, i - w - 4), i - w + 1).filter((x) => x > 0).sort((a, b) => a - b);
      if (!pre.length) continue;
      // conservative: a fall is measured from the lower median, a rise from the upper one
      const lo = pre[(pre.length - 1) >> 1], hi = pre[pre.length >> 1];
      const p = c[i] / lo <= 1 / factor ? lo : c[i] / hi >= factor ? hi : NaN, r = c[i] / p;
      if (!(p > 0)) continue;
      // did the step undo itself? (then it is a bad print or a squeeze, not a share event)
      let held = true;
      for (let j = i + 1; j < n && j <= i + hold; j++) { const q = c[j] / p; if (q < stay && q > 1 / stay) { held = false; break; } }
      if (held && i + 1 < n) { breaks.push({ date: daily.time[i], ratio: Math.round(r * 10000) / 10000 }); from = i; i += window; }
      break;
    }
  }
  return { from, breaks };
}

// ---- price repairs ---------------------------------------------------------------------------------------
// The heatmap's price_history holds some long runs of impossible prices (SRSN at 0.0003 IDR for ten months
// against 85 now). removeBadPrints only drops short blips, so these runs flowed into returns and group averages.
// cli/priceRepairJob.mjs re-fetches the provider's bars and stores one decision per bad date in tas_price_repair;
// every bar loader applies them here, BEFORE corporate actions and the bad-print filter.

/** Bars more than `factor` x away from the latest close (either way), as [{date, close}]. */
export function farFromLatest(daily, { factor = 50, since = null } = {}) {
  const n = daily.time.length;
  if (!n) return [];
  const last = daily.close[n - 1];
  if (!(last > 0)) return [];
  const out = [];
  for (let i = 0; i < n; i++) {
    if (since && daily.time[i] < since) continue;
    const c = daily.close[i];
    if (c > 0 && (c < last / factor || c > last * factor)) out.push({ date: daily.time[i], close: c });
  }
  return out;
}

/**
 * Decide what to do with each suspect stored bar, given the provider's bars for the same dates.
 *  - provider has the date, differs from the stored close by > 2 %, and its close is within `factor` x of the
 *    latest close -> replace with the provider's bar;
 *  - otherwise, a stored close more than `impossible` x from the latest -> drop (no stock moves 1000x in a year
 *    and back; the provider has nothing usable either);
 *  - otherwise the provider agrees (a real move) -> confirmed, nothing changes.
 * suspects [{date, close}], provider Map(date -> {open, high, low, close, volume}), latest = latest stored close.
 */
export function decideRepairs(suspects, provider, latest, { factor = 50, impossible = 1000 } = {}) {
  const out = [];
  for (const s of suspects) {
    const p = provider.get(s.date);
    const plausible = p && p.close > 0 && p.close >= latest / factor && p.close <= latest * factor;
    if (plausible && Math.abs(p.close / s.close - 1) > 0.02) out.push({ date: s.date, action: "replace", storedClose: s.close, ...p, reason: `provider close ${p.close} vs stored ${s.close}` });
    else if (s.close < latest / impossible || s.close > latest * impossible) out.push({ date: s.date, action: "drop", storedClose: s.close, reason: p ? `provider also implausible (${p.close})` : "provider has no bar for this date" });
    else out.push({ date: s.date, action: "confirmed", storedClose: s.close, reason: p ? "provider agrees" : "no provider bar; within the 1000x limit" });
  }
  return out;
}

/** Apply stored repairs [{date, action, open, high, low, close, volume}] to daily bars. Pure. */
export function applyPriceRepairs(daily, repairs) {
  if (!repairs?.length) return { bars: daily, replaced: 0, dropped: 0 };
  const by = new Map(repairs.filter((r) => r.action === "replace" || r.action === "drop").map((r) => [r.date, r]));
  if (!by.size) return { bars: daily, replaced: 0, dropped: 0 };
  const keys = ["time", "open", "high", "low", "close", "volume"].filter((k) => daily[k]);
  const out = { ...daily }; for (const k of keys) out[k] = [];
  let replaced = 0, dropped = 0;
  for (let i = 0; i < daily.time.length; i++) {
    const r = by.get(daily.time[i]);
    if (r?.action === "drop") { dropped++; continue; }
    for (const k of keys) out[k].push(daily[k][i]);
    if (r?.action === "replace" && r.close > 0) {
      const j = out.time.length - 1, c = +r.close;
      out.close[j] = c;
      if (out.open) out.open[j] = r.open > 0 ? +r.open : c;
      if (out.high) out.high[j] = r.high > 0 ? +r.high : c;
      if (out.low) out.low[j] = r.low > 0 ? +r.low : c;
      if (out.volume && r.volume != null) out.volume[j] = +r.volume;
      replaced++;
    }
  }
  return { bars: out, replaced, dropped };
}
