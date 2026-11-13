// Candlestick patterns. Each pattern needs the context it is defined in (a
// hammer only means something after a decline), measured against a 10-candle
// trend. Doji and spinning tops are recognised but carry no direction, so they
// never drive a screen or an alert on their own.

const body = (o, c) => Math.abs(c - o);
const range = (h, l) => Math.max(1e-12, h - l);

export const CANDLE_PATTERNS = {
  hammer: { label: "Hammer", dir: 1 }, inverted_hammer: { label: "Inverted hammer", dir: 1 },
  bullish_engulfing: { label: "Bullish engulfing", dir: 1 }, piercing: { label: "Piercing line", dir: 1 },
  morning_star: { label: "Morning star", dir: 1 }, three_white_soldiers: { label: "Three white soldiers", dir: 1 },
  shooting_star: { label: "Shooting star", dir: -1 }, hanging_man: { label: "Hanging man", dir: -1 },
  bearish_engulfing: { label: "Bearish engulfing", dir: -1 }, dark_cloud: { label: "Dark cloud cover", dir: -1 },
  evening_star: { label: "Evening star", dir: -1 }, three_black_crows: { label: "Three black crows", dir: -1 },
  doji: { label: "Doji", dir: 0 },
};

/** Patterns completing on candle i. Input: column bars. */
export function candlePatternsAt(b, i) {
  if (i < 12) return [];
  const O = b.open, H = b.high, L = b.low, C = b.close;
  const o = O[i], h = H[i], l = L[i], c = C[i];
  const bd = body(o, c), rg = range(h, l), up = Math.max(o, c), dn = Math.min(o, c);
  const upper = h - up, lower = dn - l;
  const trend = C[i - 1] - C[i - 11]; // prior 10-candle direction
  const down = trend < 0, rise = trend > 0;
  const out = [];
  if (bd <= 0.1 * rg) out.push("doji");
  const smallBody = bd <= 0.35 * rg && bd > 0;
  if (smallBody && lower >= 2 * bd && upper <= 0.6 * bd) { if (down) out.push("hammer"); if (rise) out.push("hanging_man"); }
  if (smallBody && upper >= 2 * bd && lower <= 0.6 * bd) { if (down) out.push("inverted_hammer"); if (rise) out.push("shooting_star"); }
  const po = O[i - 1], pc = C[i - 1];
  const prevBear = pc < po, prevBull = pc > po, curBull = c > o, curBear = c < o;
  if (down && prevBear && curBull && o <= pc && c >= po && bd > body(po, pc)) out.push("bullish_engulfing");
  if (rise && prevBull && curBear && o >= pc && c <= po && bd > body(po, pc)) out.push("bearish_engulfing");
  if (down && prevBear && curBull && o < L[i - 1] && c > (po + pc) / 2 && c < po) out.push("piercing");
  if (rise && prevBull && curBear && o > H[i - 1] && c < (po + pc) / 2 && c > po) out.push("dark_cloud");
  const o2 = O[i - 2], c2 = C[i - 2], mid = body(O[i - 1], C[i - 1]) <= 0.3 * range(H[i - 1], L[i - 1]);
  if (down && c2 < o2 && body(o2, c2) > 0.5 * range(H[i - 2], L[i - 2]) && mid && curBull && c > (o2 + c2) / 2) out.push("morning_star");
  if (rise && c2 > o2 && body(o2, c2) > 0.5 * range(H[i - 2], L[i - 2]) && mid && curBear && c < (o2 + c2) / 2) out.push("evening_star");
  const three = (k) => [i - 2, i - 1, i].every((j, n) => (k > 0 ? C[j] > O[j] : C[j] < O[j]) && body(O[j], C[j]) > 0.5 * range(H[j], L[j]) && (n === 0 || (k > 0 ? C[j] > C[j - 1] : C[j] < C[j - 1])));
  if (three(1) && !rise) out.push("three_white_soldiers");
  if (three(-1) && !down) out.push("three_black_crows");
  return out;
}

/** Latest-candle summary for a snapshot. */
export function candleSummary(b) {
  const i = b.time.length - 1;
  const pats = candlePatternsAt(b, i);
  const bull = pats.filter((p) => CANDLE_PATTERNS[p].dir > 0), bear = pats.filter((p) => CANDLE_PATTERNS[p].dir < 0);
  return { patterns: pats.map((p) => CANDLE_PATTERNS[p].label), bullish: bull.length > 0, bearish: bear.length > 0, keys: pats };
}
