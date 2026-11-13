// Compact storage form for events (tas_events): one array per event instead of
// an object, ~3x smaller over millions of rows. decodeEvents() restores the
// object form the app and the backtester use.
const H = ["1M", "3M", "6M", "12M"];
export function encodeEvents(events) {
  return events.map((e) => [e.type, e.tf, e.date, e.entryDate ?? null, ...H.map((h) => e.fwd?.[h] ?? null), ...H.map((h) => e.excess?.[h] ?? null), e.mfe ?? null, e.mae ?? null, e.complete ? 1 : 0]);
}
export function decodeEvents(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => (Array.isArray(r) ? {
    type: r[0], tf: r[1], date: r[2], entryDate: r[3],
    fwd: Object.fromEntries(H.map((h, i) => [h, r[4 + i]])), excess: Object.fromEntries(H.map((h, i) => [h, r[8 + i]])),
    mfe: r[12], mae: r[13], complete: r[14] === 1,
  } : r));
}
