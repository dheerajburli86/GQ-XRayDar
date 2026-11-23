// Every chart study checked against independent references on 800 random-walk candles:
// TA-Lib and pandas-ta, or TradingView's own formula where a library's convention differs
// (OBV starts at 0, PPO / KST / Keltner / Supertrend as TradingView defines them).
// The fixture is produced by tests/fixtures/makeIndicatorReference.py; the last 120 values of
// every series must agree to 1e-6 of the series' size.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as S from "../engine/studies.js";
import * as I from "../engine/indicators.js";

const { bars, ref } = JSON.parse(fs.readFileSync(new URL("./fixtures/indicatorReference.json", import.meta.url)));
const { o, h, l, c, v } = bars;

function ours() {
const r = {};
r.SMA20 = I.sma(c, 20); r.EMA20 = S.movingAverage("EMA", c, 20); r.WMA20 = S.wma(c, 20); r.HMA20 = S.hma(c, 20); r.DEMA20 = S.dema(c, 20); r.TEMA20 = S.tema(c, 20);
r.RSI14 = I.rsi(c, 14, "wilder"); r.RSI14h = I.rsi(c, 14, "house");
const m = I.macd(c, 12, 26, 9); r.MACD = m.macd ?? m.line; r.MACDs = m.signal; r.MACDh = m.hist ?? m.histogram;
const bb = S.bollinger(c, 20, 2); r.BBu = bb.upper; r.BBm = bb.mid; r.BBl = bb.lower; r.BBp = bb.pctB;
const st = S.stochastic(h, l, c, 14, 3, 3); r.STOCHk = st.slowK; r.STOCHd = st.slowD; r.STOCHFk = st.fastK; r.STOCHFd = st.fastD;
const sr = S.stochRsi(c, 14, 14, 3, 3); r.SRSIk = sr.k; r.SRSId = sr.d;
const a = S.adx(h, l, c, 14); r.ADX = a.adx; r.PDI = a.plusDI; r.MDI = a.minusDI;
r.ATR = I.atr(h, l, c, 14); r.ATRw = S.atrW ? S.atrW(h, l, c, 14) : null;
r.OBV = S.obv(c, v); r.AD = S.adLine(h, l, c, v); r.ADOSC = S.chaikinOscillator(h, l, c, v, 3, 10); r.CMF = S.cmf(h, l, c, v, 20);
r.CCI = S.cci(h, l, c, 20); r.WILLR = S.williamsR(h, l, c, 14); r.MFI = S.mfi(h, l, c, v, 14);
const ar = S.aroon(h, l, 25); r.AROONu = ar.up; r.AROONd = ar.down; r.AROONo = ar.osc;
const tx = S.trix(c, 15, 9); r.TRIX = tx.trix; r.CMO = S.cmo(c, 9); r.UO = S.ultimateOscillator(h, l, c);
const pp = S.ppo(c, 12, 26, 9); r.PPO = pp.ppo; r.PPOs = pp.signal; r.ROC = S.roc(c, 12); r.MOM = S.momentum(c, 10);
r.SAR = S.parabolicSar(h, l, 0.02, 0.2).sar; r.STDDEV = S.stdDev(c, 20);
const lr = S.linearRegression(c, 14); r.LINREG = lr.value; r.LRSLOPE = lr.slope;
const kc = S.keltner(h, l, c, 20, 10, 2); r.KCu = kc.upper; r.KCm = kc.mid; r.KCl = kc.lower;
const dc = S.donchian(h, l, 20); r.DCu = dc.upper; r.DCl = dc.lower; r.DCm = dc.mid;
const vx = S.vortex(h, l, c, 14); r.VIp = vx.plus; r.VIm = vx.minus;
r.MASS = S.massIndex(h, l, 9, 25); r.COPP = S.coppock(c, 14, 11, 10); r.DPO = S.dpo(c, 20);
r.AO = S.awesomeOscillator(h, l, 5, 34); const ts = S.tsi(c, 25, 13, 13); r.TSI = ts.tsi; r.TSIs = ts.signal;
r.FORCE = S.forceIndex(c, v, 13); r.EOM = S.easeOfMovement(h, l, v, 14, 1e8);
const er = S.elderRay(h, l, c, 13); r.BULL = er.bull; r.BEAR = er.bear;
r.CHOP = S.choppiness(h, l, c, 14); r.ULCER = S.ulcerIndex(c, 14);
const k = S.kst(c, {}); r.KST = k.kst; r.KSTs = k.signal;
const su = S.supertrend(h, l, c, 10, 3); r.SUPERT = su.line; r.SUPERTd = su.dir;
const ic = S.ichimoku(h, l, c, {}); r.TENKAN = ic.tenkan; r.KIJUN = ic.kijun;
r.VOSC = S.volumeOscillator(v, 5, 10);
r.DPO = S.dpo(c, 20); r.KAMA = S.kama(c, 10, 2, 30); const fi = S.fisherTransform(h, l, 9); r.FISH = fi.fisher; r.FISHt = fi.trigger;
const rv = S.rvi(o, h, l, c, 10); r.RVI = rv.rvi; r.RVIs = rv.signal; const kv = S.klinger(h, l, c, v); r.KVO = kv.kvo; r.KVOs = kv.signal;
r.PVT = S.pvt(c, v); r.BOP = S.balanceOfPower(o, h, l, c, 1); r.BOP14 = S.balanceOfPower(o, h, l, c, 14);
const ce = S.chandelierExit(h, l, c, 22, 3); r.CEl = ce.long; r.CEs = ce.short; const al = S.alligator(h, l); r.JAW = al.jaw; r.TEETH = al.teeth; r.LIPS = al.lips;
  return r;
}

test("indicators: every study matches TA-Lib / pandas-ta / TradingView on the reference candles", () => {
  const r = ours();
  const bad = [];
  for (const [key, want] of Object.entries(ref)) {
    const got = (r[key] || []).slice(-want.length);
    assert.equal(got.length, want.length, `${key}: no series`);
    let scale = 0, n = 0, err = 0;
    want.forEach((x) => { if (x != null) scale = Math.max(scale, Math.abs(x)); });
    want.forEach((x, i) => { const y = got[i]; if (x == null || y == null) return; n++; err = Math.max(err, Math.abs(x - y) / (scale || 1)); });
    if (n < 60 || err > 1e-6) bad.push(`${key} (n=${n}, err=${err.toExponential(2)})`);
  }
  assert.deepEqual(bad, [], `out of line with the reference: ${bad.join(", ")}`);
  assert.ok(Object.keys(ref).length >= 80);
});
