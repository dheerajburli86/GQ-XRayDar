// Derivatives data for the web app: tas_fo_* tables in Supabase mode, a
// synthetic generator (same calculations) in demo mode.
import { createClient } from "@supabase/supabase-js";
import { DATA_SOURCE } from "./api.js";
import { decodeDay } from "../../engine/deriv/codec.js";

const env = import.meta.env;
let inst = null;
export function getDerivApi() {
  if (!inst) inst = DATA_SOURCE === "demo" ? demoDeriv() : supabaseDeriv(createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } }));
  return inst;
}

const memo = () => { const m = new Map(); return (k, f) => { if (!m.has(k)) m.set(k, f().catch((e) => { m.delete(k); throw e; })); return m.get(k); }; };

function supabaseDeriv(sb) {
  const cache = memo();
  const one = async (q) => { const { data, error } = await q; if (error) throw new Error(error.message); return data; };
  const all = async (build) => { const out = []; for (let f = 0; ; f += 1000) { const d = await one(build().range(f, f + 999)); out.push(...d); if (d.length < 1000) break; } return out; };
  const api = {
    mode: "supabase",
    status: () => cache("status", async () => {
      const days = await all(() => sb.from("tas_fo_day").select("date,status,units,underlyings,files,fetched_at").order("date"));
      const ok = days.filter((d) => d.status === "ok");
      return { days, latest: ok.at(-1)?.date || null, sessions: ok.length };
    }),
    latest: () => cache("latest", async () => {
      const st = await api.status();
      if (!st.latest) return [];
      return (await all(() => sb.from("tas_fo_stats").select("und,kind,s").eq("date", st.latest).order("und"))).map((r) => ({ und: r.und, kind: r.kind, s: r.s }));
    }),
    statsOn: (date) => cache(`son:${date}`, async () => (await all(() => sb.from("tas_fo_stats").select("und,kind,s").eq("date", date).order("und"))).map((r) => ({ und: r.und, kind: r.kind, s: r.s }))),
    history: (und) => cache(`h:${und}`, async () => (await all(() => sb.from("tas_fo_stats").select("date,s").eq("und", und).order("date"))).map((r) => r.s)),
    chainDates: (und) => cache(`cd:${und}`, async () => (await one(sb.from("tas_fo_chain").select("date").eq("und", und).order("date"))).map((r) => r.date)),
    chain: (und, date) => cache(`c:${und}:${date}`, async () => {
      let q = sb.from("tas_fo_chain").select("date,und,kind,spot,lot,data").eq("und", und);
      q = date ? q.eq("date", date) : q.order("date", { ascending: false }).limit(1);
      const rows = await one(q);
      return rows[0] ? decodeDay(rows[0]) : null;
    }),
    market: () => cache("market", async () => (await all(() => sb.from("tas_fo_market").select("date,participants,ban,mwpl").order("date"))).map((r) => ({ date: r.date, participants: r.participants, ban: r.ban || [], mwpl: r.mwpl || [] }))),
    clear: () => { inst = null; },
  };
  return api;
}

function demoDeriv() {
  let gen = null, stats = null;
  const load = async () => {
    if (!gen) {
      const [{ demoDerivatives, demoStats }] = await Promise.all([import("../../engine/deriv/demo.js")]);
      gen = demoDerivatives("2026-11-13", 60); stats = demoStats(gen);
    }
    return { gen, stats };
  };
  return {
    mode: "demo",
    async status() { const { gen } = await load(); return { days: gen.dates.map((date) => ({ date, status: "ok", units: "demo" })), latest: gen.dates.at(-1), sessions: gen.dates.length }; },
    async latest() { const { stats } = await load(); return [...stats.entries()].map(([und, h]) => ({ und, kind: h.at(-1).kind, s: h.at(-1) })); },
    async statsOn(date) { const { stats } = await load(); return [...stats.entries()].map(([und, h]) => { const s = h.find((x) => x.date === date); return s ? { und, kind: s.kind, s } : null; }).filter(Boolean); },
    async history(und) { const { stats } = await load(); return stats.get(und) || []; },
    async chainDates(und) { const { gen } = await load(); return (gen.days.get(und) || []).map((d) => d.date); },
    async chain(und, date) { const { gen } = await load(); const ds = gen.days.get(und) || []; return (date ? ds.find((d) => d.date === date) : ds.at(-1)) || null; },
    async market() {
      const { gen } = await load();
      const { DEMO_PARTICIPANTS } = await import("../../engine/deriv/demo.js");
      return DEMO_PARTICIPANTS(gen.dates).map((p, i) => ({ date: p.date, participants: p.rows, ban: i === gen.dates.length - 1 ? ["TATAMOTORS"] : [], mwpl: [{ symbol: "TATAMOTORS", mwpl: 1e8, oi: 9.6e7, pct: 0.96 }, { symbol: "SBIN", mwpl: 2e8, oi: 1.66e8, pct: 0.83 }, { symbol: "INFY", mwpl: 2e8, oi: 0.9e8, pct: 0.45 }] }));
    },
    clear() {},
  };
}
