// Fills tas_etf_info (ETF details for the stock page): FMP etf/info, holdings, sector and country
// weightings. Works through the ETFs whose row is missing or older than STALE_DAYS, a slice per call,
// at a gentle request rate so it never crowds the heatmap's FMP quota. India ETFs are asked as
// <SYMBOL>.NS; when FMP has nothing, the heatmap's etf_weights basket gives the holdings.
// Reads instruments / etf_weights (heatmap); writes only tas_etf_info.
import { etfType } from "../engine/etfType.js";

const STALE_DAYS = 14;
const num = (v) => { if (v == null || v === "") return null; const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[%,]/g, "")); return Number.isFinite(n) ? n : null; };

export async function runEtfInfo(pool, { fmpKey = process.env.FMP_API_KEY, log = console.log, fetchImpl = fetch, limit = 500, rps = 3 } = {}) {
  const { rows: etfs } = await pool.query(`
    select i.symbol, i.name, i.universe, i.etf_category
    from instruments i left join tas_etf_info e on e.symbol = i.symbol
    where i.is_active and i.universe in ('us_etfs', 'india_etfs', 'global_etfs')
      and (e.symbol is null or e.updated_at < now() - interval '${STALE_DAYS} days')
    order by (e.symbol is null) desc, e.updated_at nulls first, i.symbol
    limit $1`, [limit]);
  if (!etfs.length) return { done: 0 };
  let last = 0;
  const get = async (path, sym) => {
    if (!fmpKey) return null;
    const wait = last + 1000 / rps - Date.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    const r = await fetchImpl(`https://financialmodelingprep.com/stable/${path}?symbol=${encodeURIComponent(sym)}&apikey=${fmpKey}`, { signal: AbortSignal.timeout(30_000) });
    if (r.status === 429) { await new Promise((res) => setTimeout(res, 20_000)); return get(path, sym); }
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    return Array.isArray(j) ? j : j ? [j] : null;
  };
  let ok = 0, none = 0, err = 0;
  for (const e of etfs) {
    const psym = e.universe === "india_etfs" ? `${e.symbol}.NS` : e.symbol;
    try {
      const info = (await get("etf/info", psym))?.[0] || null;
      let holdings = [], sectors = [], countries = [], source = "FMP";
      if (info) {
        holdings = ((await get("etf/holdings", psym)) || []).map((h) => ({ symbol: h.asset || h.symbol || null, name: h.name || h.asset || null, weight: num(h.weightPercentage ?? h.weight) }))
          .filter((h) => h.weight != null).sort((a, b) => b.weight - a.weight).slice(0, 25);
        sectors = ((await get("etf/sector-weightings", psym)) || []).map((s) => ({ sector: s.sector, weight: num(s.weightPercentage ?? s.weight) })).filter((s) => s.sector && s.weight != null).sort((a, b) => b.weight - a.weight);
        countries = ((await get("etf/country-weightings", psym)) || []).map((s) => ({ country: s.country, weight: num(s.weightPercentage ?? s.weight) })).filter((s) => s.country && s.weight != null).sort((a, b) => b.weight - a.weight);
      }
      if (!holdings.length) {
        // heatmap's constituent basket (India index ETFs): weights as published with the basket
        const { rows: b } = await pool.query(`select stock_symbol, weight_pct from etf_weights where etf_symbol = $1 order by weight_pct desc nulls last limit 25`, [e.symbol]).catch(() => ({ rows: [] }));
        if (b.length) { holdings = b.map((x) => ({ symbol: x.stock_symbol, name: null, weight: num(x.weight_pct) })); source = info ? "FMP + heatmap basket" : "heatmap basket (etf_weights)"; }
      }
      const provider = info?.assetClass || null;
      const typ = etfType({ name: e.name, category: e.etf_category, providerClass: provider });
      const meta = info ? {
        name: info.name || e.name, issuer: info.etfCompany || null, aum: num(info.assetsUnderManagement), expenseRatio: num(info.expenseRatio), inception: info.inceptionDate || null,
        holdingsCount: num(info.holdingsCount), nav: num(info.nav), navCurrency: info.navCurrency || null, domicile: info.domicile || null, website: info.website || null,
        description: info.description ? String(info.description).slice(0, 1500) : null, isin: info.isin || null, avgVolume: num(info.avgVolume), updatedAt: info.updatedAt || null,
      } : { name: e.name };
      const status = info || holdings.length ? "ok" : "no_data";
      await pool.query(`insert into tas_etf_info (symbol, provider_symbol, universe, asset_class, info, holdings, sectors, countries, source, status, updated_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
        on conflict (symbol) do update set provider_symbol = excluded.provider_symbol, universe = excluded.universe, asset_class = excluded.asset_class, info = excluded.info,
          holdings = excluded.holdings, sectors = excluded.sectors, countries = excluded.countries, source = excluded.source, status = excluded.status, updated_at = now()`,
      [e.symbol, psym, e.universe, provider || typ.type, JSON.stringify({ ...meta, type: typ.type, typeSource: typ.source }), JSON.stringify(holdings), JSON.stringify(sectors), JSON.stringify(countries), status === "ok" ? source : null, status]);
      if (status === "ok") ok++; else none++;
    } catch (x) { err++; log(`[etf-info] ${e.symbol}: ${x.message}`); }
  }
  log(`[etf-info] ${etfs.length} ETFs: ${ok} with details, ${none} without provider data, ${err} errors`);
  return { done: etfs.length, ok, none, err };
}
