import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTilesCommand, selectTiles, pickBenchmark, isTilesCommand } from "../engine/tiles.js";

const secs = [
  { id: "n", symbol: "NVDA", name: "NVIDIA", country: "United States", sector: "Information Technology", industryGroup: "Semiconductors and Semiconductor Equipment", industry: "Semiconductors", capUsdNow: 4e12, assetClass: "Stock" },
  { id: "a", symbol: "AVGO", name: "Broadcom", country: "United States", sector: "Information Technology", industryGroup: "Semiconductors and Semiconductor Equipment", industry: "Semiconductors", capUsdNow: 1.5e12, assetClass: "Stock" },
  { id: "m", symbol: "MSFT", name: "Microsoft", country: "United States", sector: "Information Technology", industryGroup: "Software and Services", industry: "Software", capUsdNow: 3.5e12, assetClass: "Stock" },
  { id: "t", symbol: "2330", name: "TSMC", country: "Taiwan", sector: "Information Technology", industryGroup: "Semiconductors and Semiconductor Equipment", industry: "Semiconductors", capUsdNow: 1e12, assetClass: "Stock" },
  { id: "h", symbol: "HDFCBANK", name: "HDFC Bank", country: "India", sector: "Financials", industryGroup: "Banks", industry: "Banks", capUsdNow: 1.6e11, assetClass: "Stock" },
  { id: "sox", symbol: "I:SOX", name: "PHLX Semiconductor", country: "United States", sector: "Index", assetClass: "Index" },
  { id: "spx", symbol: "^GSPC", name: "S&P 500", country: "United States", sector: "Index", assetClass: "Index" },
];

test("the owner's sentence: US semiconductors, top 8 by cap, relative to the sector index, daily, MMA", () => {
  const c = parseTilesCommand("Show us the Semiconductor sector in US, top 8 market cap companies relative to the semiconductor sector index, daily charts in MMA format.", { secs });
  assert.equal(c.country, "United States");
  assert.equal(c.n, 8);
  assert.equal(c.tf, "D");
  assert.equal(c.format, "MMA");
  assert.equal(c.relative, true);
  assert.ok(c.group && /Semiconductor/.test(c.group.name));
  assert.deepEqual(selectTiles(secs, c).map((s) => s.symbol), ["NVDA", "AVGO"]);
  const b = pickBenchmark(secs, [], c);
  assert.equal(b.ref.id, "sox");
});
test("absolute weekly charts of Indian banks; words and numbers for the count", () => {
  const c = parseTilesCommand("show me six largest indian banks weekly", { secs });
  assert.equal(c.country, "India"); assert.equal(c.n, 6); assert.equal(c.tf, "W"); assert.equal(c.relative, false);
  assert.equal(c.group.name, "Banks");
  assert.ok(isTilesCommand("show me six largest indian banks weekly"));
  assert.ok(!isTilesCommand("strongest weekly IT stocks"));
});
test("no listed index with the group's name: falls back to the house country-sector index", () => {
  const c = parseTilesCommand("top 4 US software companies relative to the sector", { secs });
  const b = pickBenchmark(secs, [{ key: "CW|LCL|C:United States|S:Information Technology" }], c);
  assert.equal(b.ref.key, "CW|LCL|C:United States|S:Information Technology");
});
