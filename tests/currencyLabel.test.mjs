import test from "node:test";
import assert from "node:assert/strict";
import { labelIndexSecurity, labelExtra, withCurrency } from "../src/lib/currencyLabel.js";

test("item 19: the local and USD versions of an index read differently", () => {
  const kospi = labelIndexSecurity({ assetClass: "Index", name: "KOSPI Composite Index", country: "South Korea" });
  assert.equal(kospi.name, "KOSPI Composite Index (KRW)");
  const usd = labelExtra({ category: "Index", label: "KOSPI Composite Index (USD)", currency: "USD" });
  assert.equal(usd.label, "KOSPI Composite Index (USD)");
  assert.equal(labelExtra({ category: "Index", label: "FTSE MIB (Italy)", currency: "EUR" }).label, "FTSE MIB (Italy) (EUR)");
});
test("names already carrying a currency, stocks and unknown countries are left alone", () => {
  assert.equal(withCurrency("United States CW (USD)", "USD"), "United States CW (USD)");
  assert.equal(labelIndexSecurity({ assetClass: "Stock", name: "Apple", country: "United States" }).name, "Apple");
  assert.equal(labelIndexSecurity({ assetClass: "Index", name: "Odd index", country: "Nowhere" }).name, "Odd index");
  assert.equal(labelExtra({ category: "Commodity", label: "Gold", currency: "USD" }).label, "Gold");
});
