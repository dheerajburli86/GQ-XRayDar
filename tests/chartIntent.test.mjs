import { test } from "node:test";
import assert from "node:assert/strict";
import { parseChartIntent, applyChartIntent, linkToFollow } from "../src/lib/chartIntent.js";

test("chart commands about the OPEN chart are understood; anything naming another stock is left to the agent", () => {
  assert.deepEqual(parseChartIntent("make it candlesticks"), { style: "candles" });
  assert.deepEqual(parseChartIntent("change the chart to Heikin-Ashi"), { style: "ha" });
  assert.deepEqual(parseChartIntent("open RSIMMA"), { screen: "RSIMMA" });
  assert.deepEqual(parseChartIntent("switch to RSCACC weekly and monthly"), { screen: "RSCACC", tf: "W", tf2: "M" });
  assert.deepEqual(parseChartIntent("show weekly"), { tf: "W" });
  assert.equal(parseChartIntent("open RSIMMA for TCS"), null);
  assert.equal(parseChartIntent("why did it fall today?"), null);
  assert.equal(parseChartIntent("US stocks with RSI above 70"), null);
});

test("an intent changes the open chart in place: Chart lab keeps the stock, screens keep the instrument", () => {
  const lab = { page: "chart", instrumentId: "abc", tf: "D" };
  assert.deepEqual(applyChartIntent({ style: "candles" }, lab), { path: "chart/abc", query: { style: "candles" }, style: "candles", label: "Candles" });
  assert.equal(applyChartIntent({ screen: "RSIMMA", tf: "W" }, lab).path, "screens/RSIMMA/s%3Aabc");
  const scr = { page: "screens", mode: "RSIMMA", instKey: "i:CW|USD|G", left: "D", right: "W" };
  assert.deepEqual(applyChartIntent({ tf: "M", tf2: "Q" }, scr), { path: "screens/RSIMMA/i%3ACW%7CUSD%7CG", query: { l: "M", r: "Q" }, label: "RSIMMA · M | Q" });
  assert.equal(applyChartIntent({ style: "candles" }, scr), null, "a house index has no Chart lab");
  assert.equal(applyChartIntent({ style: "candles" }, null), null);
});

test("an agent answer with exactly one in-app link is followed when the person asked to open something", () => {
  const o = "https://gq-xraydar.vercel.app";
  assert.equal(linkToFollow("open SENSEX RSIMMA", `[Open SENSEX RSIMMA](${o}/#/screens/RSIMMA/s%3A71)`, o), "screens/RSIMMA/s%3A71");
  assert.equal(linkToFollow("what is the RSI of TCS", `see [chart](${o}/#/chart/1)`, o), null);
  assert.equal(linkToFollow("show the breakouts", `[a](${o}/#/chart/1) [b](${o}/#/chart/2)`, o), null);
});
