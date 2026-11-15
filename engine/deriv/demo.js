// Synthetic derivatives sessions for the DEMO mode only (the app shows the
// "DEMO DATA" banner). Prices come from Black-76 with a skewed smile so every
// page exercises the same calculations it runs on real exchange files.

import { gbs } from "./pricing.js";
import { summarizeDay, withHistory } from "./summary.js";

const UNDS = [
  { und: "NIFTY", kind: "index", spot: 24500, lot: 75, step: 50, iv: 0.13, weekly: true },
  { und: "BANKNIFTY", kind: "index", spot: 52000, lot: 35, step: 100, iv: 0.15 },
  { und: "RELIANCE", kind: "stock", spot: 1420, lot: 500, step: 20, iv: 0.22 },
  { und: "HDFCBANK", kind: "stock", spot: 1700, lot: 550, step: 20, iv: 0.19 },
  { und: "INFY", kind: "stock", spot: 1850, lot: 400, step: 20, iv: 0.24 },
  { und: "TCS", kind: "stock", spot: 4100, lot: 175, step: 50, iv: 0.21 },
  { und: "TATAMOTORS", kind: "stock", spot: 780, lot: 800, step: 10, iv: 0.33 },
  { und: "SBIN", kind: "stock", spot: 820, lot: 750, step: 10, iv: 0.26 },
];

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const gauss = (r) => { const u = Math.max(1e-9, r()), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const lastThursday = (y, m) => { const d = new Date(Date.UTC(y, m + 1, 0)); while (d.getUTCDay() !== 4) d.setUTCDate(d.getUTCDate() - 1); return iso(d); };

function expiriesFor(u, date) {
  const y = +date.slice(0, 4), m = +date.slice(5, 7) - 1;
  const months = [0, 1, 2].map((k) => lastThursday(y + Math.floor((m + k) / 12), (m + k) % 12));
  const monthly = (months[0] >= date ? months : [...months.slice(1), lastThursday(y + Math.floor((m + 3) / 12), (m + 3) % 12)]).slice(0, 3);
  if (!u.weekly) return { all: monthly, monthly };
  const t = Date.parse(date), wk = [];
  for (let k = 0; k < 28 && wk.length < 4; k++) { const d = new Date(t + k * 86400000); if (d.getUTCDay() === 4) wk.push(iso(d)); }
  return { all: [...new Set([...wk, ...monthly])].sort(), monthly };
}

/** Generate `n` weekday sessions ending on `end` for every demo underlying. Returns {dates, days: Map und -> [day]} */
export function demoDerivatives(end = "2026-11-13", n = 70) {
  const dates = [];
  for (let t = Date.parse(end); dates.length < n; t -= 86400000) { const d = new Date(t); if (d.getUTCDay() % 6) dates.unshift(iso(d)); }
  const out = new Map();
  UNDS.forEach((u, ui) => {
    const r = rng(1000 + ui * 77);
    let S = u.spot * (0.92 + 0.16 * r()), iv = u.iv, prev = null;
    const days = [];
    for (const date of dates) {
      const ret = gauss(r) * iv / Math.sqrt(252) + 0.0002;
      const Sprev = S; S *= Math.exp(ret);
      iv = Math.max(0.08, iv * Math.exp(-3 * ret + 0.04 * gauss(r)) * 0.98 + u.iv * 0.02);
      const { all: exps, monthly } = expiriesFor(u, date);
      const day = { date, underlying: u.und, kind: u.kind, spot: +S.toFixed(2), spotPrev: +Sprev.toFixed(2), lot: u.lot, futures: [], options: [] };
      for (const ex of exps) {
        const T = Math.max(0.5 / 365, (Date.parse(ex) - Date.parse(date)) / 86400000 / 365);
        const F = S * Math.exp(0.068 * T);
        if (monthly.includes(ex)) {
          const pf = prev?.futures.find((f) => f.expiry === ex);
          const oi = Math.round((pf?.oi ?? 20000 * (u.kind === "index" ? 8 : 1)) * (1 + 0.04 * gauss(r)));
          day.futures.push({ expiry: ex, close: +F.toFixed(2), settle: +F.toFixed(2), prevClose: pf?.close ?? +(F / Math.exp(ret)).toFixed(2), oi, chgOi: pf ? oi - pf.oi : 0, vol: Math.round(oi * (0.3 + 0.4 * r())) });
        }
        const width = Math.ceil((S * iv * Math.sqrt(T) * 3) / u.step) + 4;
        const atm = Math.round(F / u.step) * u.step;
        for (let k = -width; k <= width; k++) {
          const K = atm + k * u.step;
          if (K <= 0) continue;
          const mny = Math.log(K / F);
          const v = Math.max(0.05, iv * (1 - 1.2 * mny + 3 * mny * mny));
          for (const cp of [1, -1]) {
            const px = gbs(cp, F, K, T, 0.068, 0, v).price;
            if (px < 0.05) continue;
            const otm = cp * (F - K) < 0;
            const base = Math.round((otm ? 60000 : 15000) * Math.exp(-Math.abs(k) / (width / 3)) * (u.kind === "index" ? 3 : 1) * (0.6 + 0.8 * r()));
            const po = prev?.options.find((o) => o.expiry === ex && o.strike === K && o.cp === cp);
            const oi = Math.max(0, Math.round((po?.oi ?? base) * (1 + 0.08 * gauss(r))));
            day.options.push({ expiry: ex, strike: K, cp, close: +px.toFixed(2), settle: +px.toFixed(2), prevClose: po?.close ?? null, oi, chgOi: po ? oi - po.oi : 0, vol: Math.round(oi * (0.2 + r())), turnover: null });
          }
        }
      }
      days.push(day); prev = day;
    }
    out.set(u.und, days);
  });
  return { dates, days: out };
}

/** Demo summaries with history fields, per underlying, oldest first. */
export function demoStats(gen) {
  const out = new Map();
  for (const [und, days] of gen.days) {
    const hist = [];
    for (const d of days) { const s = withHistory(summarizeDay(d), hist); hist.push(s); }
    out.set(und, hist);
  }
  return out;
}

export const DEMO_PARTICIPANTS = (dates) => dates.map((date, i) => {
  const r = rng(9000 + i);
  const mk = (type, scale) => ({ type, "Future Index Long": Math.round(scale * (1 + 0.1 * gauss(r))), "Future Index Short": Math.round(scale * (1.1 + 0.1 * gauss(r))), "Future Stock Long": Math.round(scale * 4), "Future Stock Short": Math.round(scale * 3.8),
    "Option Index Call Long": Math.round(scale * 9), "Option Index Put Long": Math.round(scale * 8), "Option Index Call Short": Math.round(scale * 8.5), "Option Index Put Short": Math.round(scale * 9.5) });
  return { date, rows: [mk("Client", 200000), mk("DII", 60000), mk("FII", 180000), mk("Pro", 120000)] };
});
