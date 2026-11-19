// Confluence: how many independent signals point the same way on one timeframe. A COUNT of agreeing
// signals with every vote shown and its reason; it is not a forecast, a rating or a buy / sell call.
// Input is the stored timeframe state (snap.tf.D / snap.tf.W): mma, rsi, macd, studies{...}.
// A signal that cannot be read (null) is left out of the count, never voted neutral.
export const CONFLUENCE_VERSION = "1";

const vote = (key, label, v, why) => ({ key, label, vote: v, why });

export function confluence(t) {
  if (!t) return null;
  const s = t.studies || {};
  const items = [];
  if (t.mma) items.push(vote("mma", "Yellow / red averages", t.mma === "bull" || t.mma === "above" ? 1 : t.mma === "bear" || t.mma === "below" ? -1 : 0,
    { bull: "short group above long, fully aligned", above: "short group above long", bear: "short group below long, fully aligned", below: "short group below long", mixed: "mixed" }[t.mma]));
  if (t.rsi != null) items.push(vote("rsi", "RSI", t.rsi > 55 ? 1 : t.rsi < 45 ? -1 : 0, `RSI ${Number(t.rsi).toFixed(1)} (above 55 = +1, below 45 = -1)`));
  if (t.macd) items.push(vote("macd", "MACD", t.macd === "bull" ? 1 : -1, t.macd === "bull" ? "line above signal" : "line below signal"));
  if (s.st != null) items.push(vote("supertrend", "Supertrend", s.st > 0 ? 1 : -1, s.st > 0 ? "trend up" : "trend down"));
  if (s.sar != null) items.push(vote("sar", "Parabolic SAR", s.sar > 0 ? 1 : -1, s.sar > 0 ? "below price" : "above price"));
  if (s.cloud) items.push(vote("cloud", "Ichimoku cloud", s.cloud === "above" ? 1 : s.cloud === "below" ? -1 : 0, `price ${s.cloud} the cloud`));
  if (s.adx != null && s.diBull != null) items.push(vote("adx", "ADX / DI", s.adx >= 20 ? (s.diBull ? 1 : -1) : 0, s.adx >= 20 ? `ADX ${s.adx}: +DI ${s.diBull ? "above" : "below"} -DI` : `ADX ${s.adx} below 20: no trend to vote on`));
  if (s.stochK != null && s.stochD != null) items.push(vote("stoch", "Stochastic", s.stochK > s.stochD ? 1 : s.stochK < s.stochD ? -1 : 0, `%K ${s.stochK} ${s.stochK > s.stochD ? "above" : s.stochK < s.stochD ? "below" : "level with"} %D ${s.stochD}`));
  if (s.cmf != null) items.push(vote("cmf", "Chaikin money flow", s.cmf > 5 ? 1 : s.cmf < -5 ? -1 : 0, `CMF ${s.cmf} (above +5 = +1, below -5 = -1)`));
  const bull = items.filter((x) => x.vote > 0).length, bear = items.filter((x) => x.vote < 0).length, counted = items.length;
  const top = Math.max(bull, bear);
  const lean = counted < 4 ? "too few signals" : bull > bear ? "bullish" : bear > bull ? "bearish" : "mixed";
  const agreement = counted ? top / counted : null;
  return { bull, bear, neutral: counted - bull - bear, counted, net: bull - bear, agreement, lean,
    strength: counted < 4 ? null : agreement >= 0.75 && bull !== bear ? "strong" : agreement >= 0.5 && bull !== bear ? "moderate" : "weak", items,
    note: "A count of signals that agree; not a forecast or a recommendation." };
}

/** Daily and weekly together: aligned when both lean the same way. */
export function confluenceAcross(tf) {
  const d = confluence(tf?.D), w = confluence(tf?.W);
  const aligned = d && w && d.lean === w.lean && (d.lean === "bullish" || d.lean === "bearish");
  return { D: d, W: w, aligned: !!aligned, text: !d || !w ? "not enough candles" : aligned ? `daily and weekly both ${d.lean}` : `daily ${d.lean}, weekly ${w.lean}` };
}
