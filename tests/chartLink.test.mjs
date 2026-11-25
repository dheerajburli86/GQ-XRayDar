import test from "node:test";
import assert from "node:assert/strict";
import { createAnalysis } from "../server/lib/analysis.mjs";

const secs = [
  { id: "r1", symbol: "RELIANCE", name: "Reliance Industries", country: "India", capUsdNow: null },
  { id: "n50", symbol: "NIFTY 50", name: "Nifty 50", country: "India" },
  { id: "t1", symbol: "TCS", name: "Tata Consultancy", country: "India" },
  { id: "t2", symbol: "TCS", name: "TCS Group Holding", country: "Russia" },
];
const data = { resolve: async (q) => { const u = String(q).toUpperCase(); const ex = secs.filter((s) => s.symbol === u); return ex.length ? ex : secs.filter((s) => s.name.toLowerCase().includes(String(q).toLowerCase())); } };
const A = createAnalysis(data, { appUrl: "https://app.test" });

test("chart link: Chart lab with a period", async () => {
  assert.equal((await A.chartLink({ ref: "reliance", tf: "w" })).url, "https://app.test/#/chart/r1?tf=W");
});
test("chart link: RSC screen with periods and an index to compare against", async () => {
  const r = await A.chartLink({ ref: "RELIANCE", screen: "rscmma", tf: "W", tf2: "M", bench: "Nifty 50" });
  assert.equal(r.url, "https://app.test/#/screens/RSCMMA/s%3Ar1?l=W&r=M&bench=n50");
});
test("chart link: house index as comparison, and as the instrument", async () => {
  assert.equal((await A.chartLink({ ref: "RELIANCE", screen: "RSCACC", bench: "CW|USD|G" })).url, "https://app.test/#/screens/RSCACC/s%3Ar1?bench=idx%3ACW%7CUSD%7CG");
  assert.match((await A.chartLink({ ref: "i:EW|LCL|C:India" })).url, /#\/screens\/RSIMMA\/i%3AEW%7CLCL%7CC%3AIndia$/);
});
test("chart link: same symbol in two countries asks which, unless the country is given", async () => {
  assert.equal((await A.chartLink({ ref: "TCS" })).ambiguous, true);
  assert.equal((await A.chartLink({ ref: "TCS", country: "India" })).url, "https://app.test/#/chart/t1");
  assert.ok((await A.chartLink({ ref: "nothing-like-this" })).error);
  assert.ok((await A.chartLink({ ref: "RELIANCE", screen: "pie" })).error);
});
