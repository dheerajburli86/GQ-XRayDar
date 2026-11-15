// Compact storage form of one underlying's session (tas_fo_chain.data).
const O = ["strike", "cp", "close", "settle", "prevClose", "oi", "chgOi", "vol", "open", "high", "low"];

export function encodeDay(day) {
  const exp = [...new Set(day.options.map((o) => o.expiry))].sort();
  const ei = new Map(exp.map((e, i) => [e, i]));
  return {
    spotEstimated: day.spotEstimated || undefined,
    futures: day.futures.map((f) => ({ expiry: f.expiry, close: f.close, settle: f.settle, prevClose: f.prevClose, oi: f.oi, chgOi: f.chgOi, vol: f.vol, open: f.open, high: f.high, low: f.low })),
    exp,
    o: day.options.map((o) => [ei.get(o.expiry), ...O.map((k) => o[k] ?? null)]),
  };
}

export function decodeDay(row) {
  const d = row.data || {};
  const exp = d.exp || [];
  return {
    date: row.date, underlying: row.und, kind: row.kind, spot: row.spot, lot: row.lot, spotEstimated: !!d.spotEstimated,
    futures: d.futures || [],
    options: (d.o || []).map((a) => { const o = { expiry: exp[a[0]] }; O.forEach((k, i) => { o[k] = a[i + 1]; }); return o; }),
  };
}
