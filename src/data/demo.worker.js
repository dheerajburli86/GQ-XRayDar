// Demo data host: generates the synthetic universe and runs the SAME pipeline
// the batch engine runs, then answers the data-API calls the app makes.
import { generateDemo, demoSource } from "../../engine/demo/generator.js";
import { runPipeline } from "../../engine/pipeline.js";
import { MemorySink, indexSeriesOut, membershipAt } from "../../engine/memorySink.js";
import { applyCorporateActions } from "../../engine/quality.js";
import { SCREEN_KEYS } from "../../engine/screenRow.js";
import { METHODOLOGY } from "../../engine/methodology.js";

let sink = null, demo = null, ready = null;

function build() {
  if (ready) return ready;
  ready = (async () => {
    demo = generateDemo();
    sink = new MemorySink();
    await runPipeline(demoSource(demo), sink.sinkInterface, {
      onProgress: (p) => postMessage({ type: "progress", ...p }),
    });
    postMessage({ type: "ready" });
  })();
  return ready;
}

const api = {
  async clearCache() { return true; },
  async info() {
    const r = sink.run;
    return { mode: "demo", run: r, runs: [r], methodology: sink.methodology || METHODOLOGY, asOf: r?.stats?.dates?.to, screenKeys: SCREEN_KEYS, generated: demo.generated, seed: demo.seed };
  },
  async securities() { return sink.securities; },
  async screenRows() {
    const out = [];
    for (const s of sink.snapshots.values()) out.push({ id: s.id, flat: s.flat, rsRank: s.rsRank });
    return out;
  },
  async snapshot(id) {
    const s = sink.snapshots.get(id);
    return s ? { id, snap: s.snap, f: s.f, ww: s.ww, glocom: s.glocom, rsRank: s.rsRank, score: s.score } : null;
  },
  async indexList() { return [...sink.indexMeta.values()]; },
  async indexSeries(key) { return indexSeriesOut(sink, key); },
  async bars(id) {
    const b = demo.bars.get(id);
    if (!b) return null;
    const ca = demo.corporateActions.get(id);
    const adj = ca ? applyCorporateActions(b, ca).bars : b;
    const sec = sink.securities.find((s) => s.id === id);
    return { ...adj, currency: sec?.currency, adjustments: ca || [] };
  },
  async fxSummary() { return sink.fxRows; },
  async fxSeries(ccy) { const s = sink.fxSeries.get(ccy); return s || null; },
  async wwGroups() { return sink.ww.map((g) => ({ parentKey: g.parentKey, parentType: g.parentType, childType: g.childType, children: g.children.length })); },
  async ww(parentKey, childType) { return sink.ww.find((g) => g.parentKey === parentKey && g.childType === childType) || null; },
  async membership(country, date) { return membershipAt(sink, country, date || "9999-12-31"); },
  async membershipDates(country) { return sink.memberships.filter((m) => m.country === country && !m.latest).map((m) => m.date).sort(); },
  async breadthKeys() { return Object.values(sink.breadth).map((b) => ({ key: b.key, light: b.light })); },
  async breadth(key) { return sink.breadth[key] || null; },
  async rotationScopes() { return Object.keys(sink.rotation); },
  async rotation(key) { return sink.rotation[key] || null; },
  async etiRows() { return []; },
  async etiChanges() { return []; },
  async etiFor() { return []; },
  async etfInfo() { return null; },
  async glocomScopes() { return Object.keys(sink.glocomGroups || {}); },
  async glocomGroups(key) { return sink.glocomGroups?.[key] || null; },
  async regimes() { return sink.regimes; },
  async ewcw() { return sink.ewcw; },
  async events(id) { return sink.events.get(id) || []; },
  async eventsMany(ids) { const o = {}; for (const id of ids) o[id] = sink.events.get(id) || []; return o; },
  async backtestSummary() { return sink.backtest; },
  async issues() { return sink.issues; },
  async revisions() { return []; },
  async corporateActions() { return [...demo.corporateActions].flatMap(([id, a]) => a.map((x) => ({ instrumentId: id, ...x }))); },
};

self.onmessage = async (e) => {
  const { id, method, args } = e.data;
  try {
    await build();
    if (!api[method]) throw new Error(`unknown method ${method}`);
    const result = await api[method](...(args || []));
    postMessage({ id, result });
  } catch (err) {
    postMessage({ id, error: String(err?.stack || err) });
  }
};
build();
