import test from "node:test";
import assert from "node:assert/strict";
import { newDerivBook, placeOrder, positionsOf, markBook, quoteFrom, contractKey } from "../engine/deriv/paperBook.js";

const day = (spot, fut, ce) => ({ date: "2026-11-18", spot, lot: 75, futures: [{ expiry: "2026-11-26", vol: 10, close: fut, settle: fut }], options: [{ expiry: "2026-11-26", strike: 24000, cp: 1, vol: 5, close: ce, settle: ce }] });
const FUT = { und: "NIFTY", kind: "FUT", expiry: "2026-11-26" }, CALL = { und: "NIFTY", kind: "OPT", expiry: "2026-11-26", strike: 24000, cp: 1 };

test("futures long: no cash on entry, P&L on mark", () => {
  let b = newDerivBook();
  const r = placeOrder(b, { ...FUT, side: 1, lots: 2 }, quoteFrom(day(24000, 24100, 150), FUT), { id: "a" });
  b = r.book;
  assert.ok(b.cash < newDerivBook().cash && newDerivBook().cash - b.cash < 200, "only costs leave cash");
  const m = markBook(b, { NIFTY: day(24200, 24200, 160) });
  assert.equal(Math.round(m.futUnreal), 100 * 150);
});
test("option buy pays premium, sell receives it, closing realises the difference", () => {
  let b = newDerivBook();
  b = placeOrder(b, { ...CALL, side: 1, lots: 1 }, quoteFrom(day(24000, 24100, 100), CALL), { id: "a" }).book;
  assert.ok(newDerivBook().cash - b.cash > 7500);
  b = placeOrder(b, { ...CALL, side: -1, lots: 1 }, quoteFrom(day(24000, 24100, 120), CALL), { id: "b" }).book;
  const p = positionsOf(b.trades)[0];
  assert.equal(p.net, 0); assert.equal(p.realised, 20 * 75);
});
test("flipping through zero resets the average", () => {
  const t = (side, qty, price) => ({ ...CALL, side, qty, price, lot: 75, fee: 0 });
  const p = positionsOf([t(1, 75, 100), t(-1, 150, 110)])[0];
  assert.equal(p.realised, 750); assert.equal(p.net, -75); assert.equal(p.avg, 110);
});
test("rejects expired, unknown and unaffordable orders", () => {
  const q = quoteFrom(day(24000, 24100, 100), CALL);
  assert.ok(placeOrder(newDerivBook(), { ...CALL, expiry: "2026-11-18", side: 1, lots: 1 }, q).error);
  assert.ok(placeOrder(newDerivBook(), { ...CALL, side: 1, lots: 1 }, null).error);
  assert.ok(placeOrder({ ...newDerivBook(), cash: 100 }, { ...CALL, side: 1, lots: 1 }, q).error);
  assert.ok(placeOrder(newDerivBook(), { ...CALL, side: 1, lots: 0 }, q).error);
});
test("expired contracts value at intrinsic / spot, not at a stale price", () => {
  const b = placeOrder(newDerivBook(), { ...CALL, side: 1, lots: 1 }, quoteFrom(day(24000, 24100, 100), CALL), { id: "a" }).book;
  const m = markBook(b, { NIFTY: { ...day(24300, 24300, 0), date: "2026-11-27" } });
  assert.equal(m.positions[0].expired, true); assert.equal(m.positions[0].last, 300);
  assert.equal(contractKey(CALL), "NIFTY|OPT|2026-11-26|24000|1");
});
