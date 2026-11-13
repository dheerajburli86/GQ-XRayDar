// Fundamental metrics derived from FMP-format statements (the heatmap's
// `fundamentals` table: income_statement[_q], balance_sheet[_q], cash_flow[_q],
// each an array of periods with `date`, `filingDate`, `reportedCurrency`).
//
// Every ratio is computed from reported figures here, never taken from a
// vendor's pre-computed field, and each carries the period it came from.

const num = (v) => (v == null || v === "" ? null : Number.isFinite(+v) ? +v : null);
const byDateDesc = (a) => [...(a || [])].filter((p) => p && p.date).sort((x, y) => (x.date < y.date ? 1 : -1));
const pct = (a, b) => (a != null && b != null && b !== 0 ? ((a - b) / Math.abs(b)) * 100 : null);
const r2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const ttm = (rows, k, off = 0) => {
  const s = rows.slice(off, off + 4);
  if (s.length < 4 || s.some((p) => num(p[k]) == null)) return null;
  return s.reduce((a, p) => a + num(p[k]), 0);
};

/**
 * f: { income_statement, income_statement_q, balance_sheet, balance_sheet_q, cash_flow, cash_flow_q, reported_currency }
 * price: latest close in `priceCurrency` major units; fxToReported: multiply price by this to get reported currency (or null)
 */
export function fundamentalMetrics(f, price = null, fxToReported = 1) {
  if (!f) return null;
  const iq = byDateDesc(f.income_statement_q), ia = byDateDesc(f.income_statement);
  const bq = byDateDesc(f.balance_sheet_q), ba = byDateDesc(f.balance_sheet);
  const cq = byDateDesc(f.cash_flow_q), ca = byDateDesc(f.cash_flow);
  const out = { asOf: iq[0]?.date || ia[0]?.date || null, basis: iq.length >= 4 ? "TTM (quarterly)" : "Annual", currency: f.reported_currency || iq[0]?.reportedCurrency || ia[0]?.reportedCurrency || null };

  // growth: latest quarter vs the same quarter a year earlier; acceleration vs the prior quarter's YoY
  if (iq.length >= 5) {
    out.revenueGrowthYoY = r2(pct(num(iq[0].revenue), num(iq[4].revenue)));
    out.epsGrowthYoY = r2(pct(num(iq[0].epsDiluted ?? iq[0].eps), num(iq[4].epsDiluted ?? iq[4].eps)));
    if (iq.length >= 6) {
      const prevYoY = pct(num(iq[1].revenue), num(iq[5].revenue));
      out.revenueGrowthAccel = out.revenueGrowthYoY != null && prevYoY != null ? r2(out.revenueGrowthYoY - prevYoY) : null;
    }
  } else if (ia.length >= 2) {
    out.revenueGrowthYoY = r2(pct(num(ia[0].revenue), num(ia[1].revenue)));
    out.epsGrowthYoY = r2(pct(num(ia[0].epsDiluted ?? ia[0].eps), num(ia[1].epsDiluted ?? ia[1].eps)));
  }

  const useQ = iq.length >= 4;
  const rev = useQ ? ttm(iq, "revenue") : num(ia[0]?.revenue);
  const gp = useQ ? ttm(iq, "grossProfit") : num(ia[0]?.grossProfit);
  const op = useQ ? ttm(iq, "operatingIncome") : num(ia[0]?.operatingIncome);
  const ni = useQ ? ttm(iq, "netIncome") : num(ia[0]?.netIncome);
  const eps = useQ ? ttm(iq, "epsDiluted") ?? ttm(iq, "eps") : num(ia[0]?.epsDiluted ?? ia[0]?.eps);
  out.revenueTTM = rev; out.netIncomeTTM = ni;
  out.grossMargin = rev ? r2((gp / rev) * 100) : null;
  out.operatingMargin = rev ? r2((op / rev) * 100) : null;
  out.netMargin = rev ? r2((ni / rev) * 100) : null;
  if (useQ && iq.length >= 8) {
    const rev4 = ttm(iq, "revenue", 4), op4 = ttm(iq, "operatingIncome", 4);
    out.operatingMarginChange = rev && rev4 && op4 != null ? r2((op / rev - op4 / rev4) * 100) : null;
  }
  const bs = bq[0] || ba[0];
  const eq = num(bs?.totalStockholdersEquity), debt = num(bs?.totalDebt);
  out.roe = eq && eq > 0 && ni != null ? r2((ni / eq) * 100) : null;
  out.debtToEquity = eq && eq > 0 && debt != null ? r2(debt / eq) : null;
  const fcf = cq.length >= 4 ? ttm(cq, "freeCashFlow") : num(ca[0]?.freeCashFlow);
  out.fcfMargin = rev && fcf != null ? r2((fcf / rev) * 100) : null;
  out.pe = price != null && fxToReported != null && eps && eps > 0 ? r2((price * fxToReported) / eps) : null;

  out.improving = !!((out.revenueGrowthAccel != null && out.revenueGrowthAccel > 0 && (out.operatingMarginChange ?? 0) >= 0)
    || (out.epsGrowthYoY != null && out.epsGrowthYoY >= 15 && (out.revenueGrowthYoY ?? 0) > 0));
  out.deteriorating = !!((out.revenueGrowthYoY != null && out.revenueGrowthYoY < 0 && (out.operatingMarginChange ?? 0) < 0));

  // result dates for the earnings overlay
  out.results = iq.slice(0, 12).map((p, k) => ({
    period: p.date, filed: p.filingDate || p.acceptedDate?.slice(0, 10) || p.date,
    revenue: num(p.revenue), eps: num(p.epsDiluted ?? p.eps),
    revenueYoY: iq[k + 4] ? r2(pct(num(p.revenue), num(iq[k + 4].revenue))) : null,
  }));
  return out;
}

/** Percentile ranks (0..100) of selected metrics across a population. */
export function fundamentalPercentiles(rows, keys = ["revenueGrowthYoY", "epsGrowthYoY", "operatingMargin", "roe", "fcfMargin"]) {
  const out = new Map();
  for (const k of keys) {
    const vals = rows.map((r) => r.f?.[k]).filter((v) => v != null && Number.isFinite(v)).sort((a, b) => a - b);
    for (const r of rows) {
      const v = r.f?.[k];
      if (v == null || !vals.length) continue;
      let lo = 0, hi = vals.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (vals[mid] <= v) lo = mid + 1; else hi = mid; }
      if (!out.has(r.id)) out.set(r.id, {});
      out.get(r.id)[k] = Math.round((lo / vals.length) * 100);
    }
  }
  return out;
}
