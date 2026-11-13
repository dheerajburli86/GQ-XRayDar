// SYNTHETIC demo universe. Deterministic (seeded) so every demo session shows
// the same numbers. It exists so the whole product can be reviewed before the
// heatmap database is connected; every screen shows a "DEMO DATA" banner while
// it is in use, and nothing generated here is ever written anywhere.
//
// It deliberately exercises the awkward cases the real data has: minor-unit
// quotes (GBX, ZAC, ILA), misspelled country names (Hong_kong, United_kingdom),
// country holidays, missing FX fixings, mid-history listings, delistings, a
// split recorded as a corporate action, and one split that was NOT recorded
// (which the data-health page must catch).

import { RAW_TO_INDUSTRY_GROUP, sectorOf, SECTORS } from "../reference/gics.js";
import { weekdays, addDays } from "../calendar.js";

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COUNTRIES = [
  // name as stored, currency, stocks, fx start (USD per unit), fx annual drift, fx vol
  ["United States", "USD", 64, 1, 0, 0],
  ["Japan", "JPY", 26, 0.0085, -0.02, 0.09],
  ["China", "CNY", 26, 0.152, -0.01, 0.04],
  ["India", "INR", 34, 0.0148, -0.025, 0.05],
  ["United_kingdom", "GBX", 22, 1.42, -0.01, 0.08],
  ["Germany", "EUR", 18, 1.09, 0, 0.07],
  ["Switzerland", "CHF", 10, 1.01, 0.01, 0.06],
  ["Canada", "CAD", 14, 0.73, 0, 0.06],
  ["Australia", "AUD", 12, 0.72, -0.005, 0.09],
  ["Taiwan", "TWD", 12, 0.031, 0, 0.05],
  ["Brazil", "BRL", 10, 0.30, -0.05, 0.14],
  ["South_africa", "ZAC", 8, 0.069, -0.04, 0.13],
  ["Hong_kong", "HKD", 12, 0.1288, 0, 0.004],
  ["Israel", "ILA", 6, 0.27, 0.005, 0.07],
];
const MAJOR = { GBX: "GBP", ZAC: "ZAR", ILA: "ILS" };
const NAME_PARTS = ["Apex", "Nova", "Summit", "Harbor", "Crest", "Vertex", "Orion", "Pioneer", "Atlas", "Zenith", "Meridian", "Halcyon", "Sterling", "Boreal", "Cobalt", "Kestrel", "Lumen", "Solace", "Tandem", "Verity"];
const SUFFIX = { "Information Technology": ["Systems", "Semiconductor", "Software"], Financials: ["Bank", "Capital", "Insurance"], "Health Care": ["Therapeutics", "Medical", "Pharma"], "Consumer Discretionary": ["Motors", "Brands", "Retail"], "Consumer Staples": ["Foods", "Beverages", "Consumer"], Industrials: ["Industries", "Aerospace", "Logistics"], Materials: ["Chemicals", "Metals", "Materials"], Energy: ["Energy", "Petroleum", "Resources"], Utilities: ["Power", "Utilities", "Water"], "Real Estate": ["Properties", "Realty", "REIT"], "Communication Services": ["Media", "Telecom", "Digital"] };

const LABELS = {};
for (const [label, ig] of Object.entries(RAW_TO_INDUSTRY_GROUP)) {
  const s = sectorOf(ig);
  if (s === "Others") continue;
  (LABELS[s] ||= []).push(label);
}
for (const s of Object.keys(LABELS)) LABELS[s] = [...new Set(LABELS[s])].sort().slice(0, 6);

function normal(rnd) { let u = 0, v = 0; while (u === 0) u = rnd(); while (v === 0) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

export function generateDemo({ seed = 20261113, from = "2016-01-04", to = "2026-11-12" } = {}) {
  const rnd = mulberry32(seed);
  const N = () => normal(rnd);
  const days = weekdays(from, to);
  const T = days.length;

  // ---- factors ----
  const gF = new Float64Array(T);
  const sectors = SECTORS;
  const secF = Object.fromEntries(sectors.map((s) => [s, new Float64Array(T)]));
  const cF = {};
  let gDrift = 0.0003;
  for (let t = 0; t < T; t++) {
    if (t % 180 === 0) gDrift = 0.00035 + N() * 0.0006;
    const crash = t > 1050 && t < 1080 ? -0.012 : 0; // a 2020-style drawdown for regime/breadth variety
    const vol = t > 1050 && t < 1130 ? 0.022 : 0.0085;
    gF[t] = gDrift + crash + N() * vol;
  }
  for (const s of sectors) {
    let d = 0;
    for (let t = 0; t < T; t++) { if (t % 130 === 0) d = N() * 0.0009; secF[s][t] = d + N() * 0.006; }
  }
  for (const [c] of COUNTRIES) {
    const a = new Float64Array(T); let d = 0;
    for (let t = 0; t < T; t++) { if (t % 160 === 0) d = N() * 0.0005; a[t] = d + N() * 0.005; }
    cF[c] = a;
  }

  // ---- FX ----
  const fxHistory = {}, fxLatest = {};
  for (const [, ccy, , start, drift, vol] of COUNTRIES) {
    const maj = MAJOR[ccy] || ccy;
    if (maj === "USD") continue;
    const dts = [], usd = [];
    let x = start;
    for (let t = 0; t < T; t++) {
      x *= Math.exp(drift / 252 + (vol / Math.sqrt(252)) * N());
      if (rnd() < 0.01) continue; // a missing fixing -> carried forward, flagged stale
      dts.push(days[t]); usd.push(+x.toPrecision(8));
    }
    fxHistory[maj] = { dates: dts, usd, source: "demo" };
    fxLatest[maj] = usd[usd.length - 1];
  }

  // ---- holidays per country ----
  const holidays = {};
  for (const [c] of COUNTRIES) {
    const h = new Set();
    for (let t = 0; t < T; t++) if (rnd() < 9 / 252) h.add(days[t]);
    holidays[c] = h;
  }

  // ---- securities ----
  const rows = [], bars = new Map(), fundamentals = new Map(), corporateActions = new Map();
  let id = 0, splitRecorded = false, splitUnrecorded = false;
  for (const [country, ccy, count] of COUNTRIES) {
    for (let k = 0; k < count; k++) {
      id++;
      const sector = sectors[Math.floor(rnd() * sectors.length)];
      const labels = LABELS[sector];
      const industry = labels[Math.floor(rnd() * labels.length)];
      const nm = `${NAME_PARTS[Math.floor(rnd() * NAME_PARTS.length)]} ${SUFFIX[sector][Math.floor(rnd() * 3)]}`;
      const symbol = `${country.slice(0, 2).toUpperCase().replace(/[^A-Z]/g, "X")}${String(k + 1).padStart(3, "0")}`;
      const sid = `demo-${String(id).padStart(4, "0")}`;
      const capUsdTarget = Math.exp(21.5 + N() * 1.3); // ~1.3bn median, long tail
      const vol = Math.min(0.024, 0.009 + 0.25 / Math.sqrt(capUsdTarget / 1e6));
      const beta = 0.6 + rnd() * 0.9;
      const firstT = rnd() < 0.1 ? Math.floor(300 + rnd() * (T - 900)) : 0;
      const delisted = rnd() < 0.04;
      const lastT = delisted ? Math.floor(firstT + 400 + rnd() * (T - firstT - 600)) : T - 1;
      const idioDrift = N() * 0.0003;
      const tm = { time: [], open: [], high: [], low: [], close: [], volume: [] };
      let p = 20 + rnd() * 180;
      if (ccy === "GBX" || ccy === "ZAC" || ccy === "ILA") p *= 100;
      if (ccy === "JPY" || ccy === "INR" || ccy === "TWD") p *= 30;
      const baseVol = Math.max(1000, Math.round(capUsdTarget / 2e4 / Math.max(1, p / 50)));
      for (let t = firstT; t <= lastT; t++) {
        const d = days[t];
        const r = beta * gF[t] + cF[country][t] * 0.8 + secF[sector][t] + idioDrift + N() * vol;
        if (holidays[country].has(d)) continue;
        const prev = p;
        p = Math.max(0.05, p * Math.exp(r));
        const o = prev * Math.exp(N() * vol * 0.3);
        const hi = Math.max(o, p) * Math.exp(Math.abs(N()) * vol * 0.4);
        const lo = Math.min(o, p) * Math.exp(-Math.abs(N()) * vol * 0.4);
        const v = Math.round(baseVol * Math.exp(N() * 0.35) * (1 + (2.5 * Math.abs(r)) / vol));
        tm.time.push(d); tm.open.push(rd(o)); tm.high.push(rd(hi)); tm.low.push(rd(lo)); tm.close.push(rd(p)); tm.volume.push(v);
      }
      if (tm.time.length < 50) continue;
      // splits: one recorded (and therefore adjusted), one not (data health must flag it)
      if (!splitRecorded && country === "United States" && k === 5) {
        splitRecorded = true;
        const ex = tm.time[Math.floor(tm.time.length * 0.6)];
        for (let i = 0; i < tm.time.length && tm.time[i] < ex; i++) { tm.open[i] *= 2; tm.high[i] *= 2; tm.low[i] *= 2; tm.close[i] *= 2; tm.volume[i] = Math.round(tm.volume[i] / 2); }
        corporateActions.set(sid, [{ exDate: ex, factor: 2, type: "split", source: "demo" }]);
      } else if (!splitUnrecorded && country === "India" && k === 3) {
        splitUnrecorded = true;
        const ex = tm.time[Math.floor(tm.time.length * 0.7)];
        for (let i = 0; i < tm.time.length && tm.time[i] < ex; i++) { tm.open[i] *= 5; tm.high[i] *= 5; tm.low[i] *= 5; tm.close[i] *= 5; }
      }
      bars.set(sid, tm);
      const lastClose = tm.close[tm.close.length - 1];
      const maj = MAJOR[ccy] || ccy;
      const div = MAJOR[ccy] ? 100 : 1;
      const fxL = maj === "USD" ? 1 : fxLatest[maj];
      // the stored cap matches this listing's latest price (shares x price), like the real feed
      const shares = capUsdTarget / ((lastClose / div) * fxL);
      const capLocal = shares * (lastClose / div);
      rows.push({
        id: sid, symbol, name: `${nm}${k % 7 === 0 ? " Holdings" : ""}`, universe: "demo", type: "stock",
        sector: null, industry, country, region: null, currency: ccy, exchange: "DEMO",
        market_cap_local: Math.round(capLocal), market_cap_currency: maj, market_cap_usd: Math.round(capLocal * fxL),
        is_active: !delisted, isin: null,
      });
      fundamentals.set(sid, makeFundamentals(rnd, N, capLocal, maj, days[lastT], shares));
    }
  }
  return { days, rows, bars, fxHistory, fxLatest, fundamentals, corporateActions, generated: new Date().toISOString(), seed };
}

const rd = (v) => Math.round(v * 10000) / 10000;

function makeFundamentals(rnd, N, capLocal, ccy, lastDate, shares) {
  const q = [];
  let rev = (capLocal / (1.5 + rnd() * 4)) / 4;
  let g = 0.02 + N() * 0.02;
  let margin = 0.08 + rnd() * 0.2;
  const quarters = 16;
  const end = lastDate.slice(0, 7);
  let [y, mth] = end.split("-").map(Number);
  mth = Math.floor((mth - 1) / 3) * 3; // last completed quarter-end month
  if (mth === 0) { y -= 1; mth = 12; }
  const qEnds = [];
  for (let i = 0; i < quarters; i++) {
    qEnds.unshift(`${y}-${String(mth).padStart(2, "0")}-${mth === 3 || mth === 12 ? "31" : "30"}`);
    mth -= 3; if (mth <= 0) { mth += 12; y -= 1; }
  }
  for (const d of qEnds) {
    g = Math.max(-0.08, Math.min(0.12, g * 0.8 + N() * 0.02));
    rev *= 1 + g;
    margin = Math.max(-0.1, Math.min(0.45, margin + N() * 0.01));
    const op = rev * margin, ni = op * 0.75;
    q.push({ date: d, filingDate: addDays(d, 35), period: "Q", reportedCurrency: ccy, revenue: Math.round(rev), grossProfit: Math.round(rev * (margin + 0.25)), operatingIncome: Math.round(op), netIncome: Math.round(ni), eps: +(ni / shares).toFixed(4), epsDiluted: +(ni / shares).toFixed(4) });
  }
  const eq = rev * 4 * (0.6 + rnd());
  const bsq = qEnds.map((d) => ({ date: d, totalStockholdersEquity: Math.round(eq), totalDebt: Math.round(eq * rnd() * 1.2), reportedCurrency: ccy }));
  const cfq = q.map((p) => ({ date: p.date, freeCashFlow: Math.round(p.netIncome * (0.6 + rnd() * 0.6)), reportedCurrency: ccy }));
  return { income_statement_q: q.slice().reverse(), balance_sheet_q: bsq.reverse(), cash_flow_q: cfq.reverse(), income_statement: [], balance_sheet: [], cash_flow: [], reported_currency: ccy };
}

/** Pipeline Source over a generated universe (also usable from Node tests). */
export function demoSource(demo = generateDemo()) {
  const byId = demo.bars;
  return {
    mode: "demo",
    demo,
    async calendar(startDate) { return demo.days.filter((d) => d >= startDate); },
    async securities() { return demo.rows; },
    async countryBars(ids) { const m = new Map(); for (const i of ids) if (byId.has(i)) m.set(i, byId.get(i)); return m; },
    async fxHistory() { return { history: demo.fxHistory, latest: demo.fxLatest }; },
    async fundamentals(ids) { const m = new Map(); for (const i of ids) if (demo.fundamentals.has(i)) m.set(i, demo.fundamentals.get(i)); return m; },
    async corporateActions() { return demo.corporateActions; },
    async glocom() { return new Map(); },
  };
}
