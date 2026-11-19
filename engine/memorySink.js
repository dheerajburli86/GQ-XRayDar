// In-memory sink + query layer over pipeline results. Used by the demo Web
// Worker and by tests. The query functions mirror the Supabase data API in
// src/data/supabaseApi.js one for one.

import { lowerBound } from "./calendar.js";

export class MemorySink {
  constructor() {
    this.run = null; this.methodology = null;
    this.indexMeta = new Map(); this.indexData = new Map();
    this.memberships = []; this.ww = []; this.snapshots = new Map(); this.events = new Map();
    this.issues = []; this.breadth = {}; this.rotation = {}; this.glocomGroups = {}; this.regimes = {}; this.ewcw = []; this.backtest = [];
    this.fxRows = []; this.fxSeries = new Map(); this.securities = [];
    this.dates = null;
  }
  begin(run, m) { this.run = run; this.methodology = m; }
  indexSeries(meta, c) {
    this.indexMeta.set(meta.key, meta);
    const n = c.dates.length;
    this.indexData.set(meta.key, {
      start: c.dates[0], dates: c.dates,
      level: Float64Array.from(c.level), n: Uint16Array.from(c.n, (x) => Math.min(65535, x)),
      nStale: Uint16Array.from(c.nStale, (x) => Math.min(65535, x)), cap: meta.family === "CW" ? Float32Array.from(c.cap) : null, length: n,
    });
  }
  setMemberships(list) { this.memberships = list.map((m) => ({ ...m, members: m.members.map((x) => ({ ...x })) })); }
  setWW(ww) { this.ww = ww; }
  countryResults(country, { snapshots, events, issues }) {
    for (const s of snapshots) this.snapshots.set(s.id, s);
    for (const [id, ev] of events) this.events.set(id, ev);
    this.issues.push(...issues);
  }
  globalIssues(list) { this.issues.push(...list); }
  setBreadth(b) { this.breadth = b; }
  setRotation(r) { this.rotation = r; }
  setRegimes(r) { this.regimes = r; }
  setEwcw(r) { this.ewcw = r; }
  setBacktest(r) { this.backtest = r; }
  fx(rows, { dates, fx }) {
    this.fxRows = rows; this.dates = dates;
    for (const r of rows) {
      const f = fx(r.currency);
      this.fxSeries.set(r.currency, { dates, rate: Array.from(f.rate), stale: Array.from(f.stale) });
    }
  }
  setSecurities(secs, extra) {
    this.securities = secs.map((s) => ({ ...s, capUsdNow: extra.get(s.id)?.capUsdNow ?? null, turnoverUsd: extra.get(s.id)?.turnoverUsd ?? null, sharesEst: this.snapshots.get(s.id)?.sharesEst ?? null }));
  }
  finish(run) { this.run = run; }

  // sink interface names used by the pipeline
  get sinkInterface() {
    return {
      begin: (r, m) => this.begin(r, m), indexSeries: (m, c) => this.indexSeries(m, c), memberships: (l) => this.setMemberships(l),
      ww: (w) => this.setWW(w), countryResults: (c, r) => this.countryResults(c, r), globalIssues: (l) => this.globalIssues(l),
      breadth: (b) => this.setBreadth(b), rotation: (r) => this.setRotation(r), glocomGroups: (g) => { this.glocomGroups = g; }, regimes: (r) => this.setRegimes(r),
      ewcw: (r) => this.setEwcw(r), backtest: (r) => this.setBacktest(r), fx: (r, x) => this.fx(r, x),
      securities: (s, e) => this.setSecurities(s, e), finish: (r) => this.finish(r),
    };
  }
}

// ── query helpers (pure, over a MemorySink) ─────────────────────────────────────
export function indexSeriesOut(sink, key) {
  const d = sink.indexData.get(key);
  if (!d) return null;
  return { key, meta: sink.indexMeta.get(key), dates: d.dates, level: Array.from(d.level), n: Array.from(d.n), nStale: Array.from(d.nStale), cap: d.cap ? Array.from(d.cap) : null };
}

export function membershipAt(sink, country, date) {
  const list = sink.memberships.filter((m) => m.country === country && !m.latest).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!list.length) return null;
  const dates = list.map((m) => m.date);
  const i = lowerBound(dates, date);
  const k = i < dates.length && dates[i] === date ? i : Math.max(0, i - 1);
  return list[k];
}
