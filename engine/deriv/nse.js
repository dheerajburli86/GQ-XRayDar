// Parsers for the exchange's end-of-day derivatives files (pure, no I/O).
//
//   F&O bhavcopy (UDiFF)  content/fo/BhavCopy_NSE_FO_0_0_0_<YYYYMMDD>_F_0000.csv.zip
//   participant-wise OI   content/nsccl/fao_participant_oi_<DDMMYYYY>.csv
//   securities in ban     content/fo/fo_secban_<DDMMYYYY>.csv
//   MWPL / combined OI    archives/nsccl/mwpl/combineoi_<DDMMYYYY>.zip
//
// Columns are found by NAME, not position, and a file whose header lacks a
// required column is rejected with the header it had, so a format change is a
// loud error rather than silently shifted numbers.

export const NSE_INDEX_UNDERLYINGS = { NIFTY: "NIFTY 50", BANKNIFTY: "NIFTY BANK", FINNIFTY: "NIFTY FIN SERVICE", MIDCPNIFTY: "NIFTY MID SELECT", NIFTYNXT50: "NIFTY NEXT 50" };

export function splitCsvLine(line) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const MON = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };
/** "2026-11-13" | "13-Nov-2026" | "13-NOV-26" | "13/11/2026" -> "2026-11-13" */
export function isoDate(s) {
  if (!s) return null;
  s = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  let m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${MON[m[2].toUpperCase()]}-${m[1].padStart(2, "0")}`; }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

const num = (x) => { if (x == null || x === "" || x === "-") return null; const v = Number(String(x).replace(/,/g, "")); return Number.isFinite(v) ? v : null; };

/**
 * UDiFF F&O bhavcopy -> { date, units, days: Map underlying -> day } in the
 * shape engine/deriv/chain.js expects. OI and volume are converted to
 * CONTRACTS when the file quotes them in shares (detected: >= 90% of rows
 * divisible by the lot size), and the decision is returned in `units`.
 */
export function parseFoBhavcopy(text, { segment = "FO" } = {}) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const head = splitCsvLine(lines[0]);
  const col = (n) => head.findIndex((h) => h.toLowerCase() === n.toLowerCase());
  const need = ["TradDt", "FinInstrmTp", "TckrSymb", "XpryDt", "StrkPric", "OptnTp", "ClsPric", "SttlmPric", "PrvsClsgPric", "UndrlygPric", "OpnIntrst", "ChngInOpnIntrst", "TtlTradgVol", "NewBrdLotQty"];
  const idx = Object.fromEntries(need.map((n) => [n, col(n)]));
  const missing = need.filter((n) => idx[n] < 0);
  if (missing.length) throw new Error(`F&O bhavcopy header missing ${missing.join(", ")}. Header was: ${head.join(",")}`);
  const opt = { open: col("OpnPric"), high: col("HghPric"), low: col("LwPric"), last: col("LastPric"), turnover: col("TtlTrfVal"), sgmt: col("Sgmt") };
  const recs = [];
  let date = null, divisible = 0, checked = 0;
  for (let i = 1; i < lines.length; i++) {
    const c = splitCsvLine(lines[i]);
    const tp = c[idx.FinInstrmTp];
    if (!["IDF", "IDO", "STF", "STO"].includes(tp)) continue;
    if (opt.sgmt >= 0 && c[opt.sgmt] && c[opt.sgmt] !== segment) continue;
    date = date || isoDate(c[idx.TradDt]);
    const lot = num(c[idx.NewBrdLotQty]) || 1, oi = num(c[idx.OpnIntrst]) || 0, vol = num(c[idx.TtlTradgVol]) || 0;
    if (oi > 0 && lot > 1) { checked++; if (oi % lot === 0) divisible++; }
    recs.push({ tp, und: c[idx.TckrSymb], expiry: isoDate(c[idx.XpryDt]), strike: num(c[idx.StrkPric]), optType: c[idx.OptnTp], close: num(c[idx.ClsPric]), settle: num(c[idx.SttlmPric]),
      prevClose: num(c[idx.PrvsClsgPric]), spot: num(c[idx.UndrlygPric]), oi, chgOi: num(c[idx.ChngInOpnIntrst]) || 0, vol, lot,
      open: opt.open >= 0 ? num(c[opt.open]) : null, high: opt.high >= 0 ? num(c[opt.high]) : null, low: opt.low >= 0 ? num(c[opt.low]) : null, turnover: opt.turnover >= 0 ? num(c[opt.turnover]) : null });
  }
  const inShares = checked > 50 && divisible / checked >= 0.9;
  const days = new Map();
  for (const r of recs) {
    const k = inShares && r.lot > 0 ? r.lot : 1;
    let d = days.get(r.und);
    if (!d) { d = { date, underlying: r.und, kind: r.tp.startsWith("ID") ? "index" : "stock", spot: null, lot: r.lot, futures: [], options: [] }; days.set(r.und, d); }
    if (r.spot > 0 && !d.spot) d.spot = r.spot;
    const base = { expiry: r.expiry, open: r.open, high: r.high, low: r.low, close: r.close, settle: r.settle, prevClose: r.prevClose, oi: r.oi / k, chgOi: r.chgOi / k, vol: r.vol / k, turnover: r.turnover };
    if (r.tp.endsWith("F")) d.futures.push(base);
    else {
      if (!(r.oi > 0 || r.vol > 0)) continue; // a strike nobody holds or traded carries no information
      d.options.push({ ...base, strike: r.strike, cp: /^C/i.test(r.optType) ? 1 : -1 });
    }
  }
  for (const d of days.values()) if (!(d.spot > 0)) { const f = d.futures.sort((a, b) => (a.expiry < b.expiry ? -1 : 1))[0]; d.spot = f?.close || null; d.spotEstimated = true; }
  return { date, units: inShares ? "contracts (converted from shares)" : "as published", rows: recs.length, days };
}

/** Participant-wise OI (contracts) by client type. */
export function parseParticipantOi(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const h = lines.findIndex((l) => /client type/i.test(l));
  if (h < 0) throw new Error(`participant OI: no "Client Type" header. First line: ${lines[0]}`);
  const head = splitCsvLine(lines[h]).map((x) => x.replace(/\s+/g, " ").trim());
  const rows = [];
  for (const l of lines.slice(h + 1)) {
    const c = splitCsvLine(l);
    if (!c[0]) continue;
    const o = { type: c[0] };
    head.forEach((name, i) => { if (i > 0) o[name] = num(c[i]); });
    rows.push(o);
  }
  return rows;
}

/** Symbols in the F&O ban for the trade date. */
export function parseSecBan(text) {
  const out = [];
  for (const l of text.split(/\r?\n/)) { const m = l.trim().match(/^\d+\s*,\s*([A-Z0-9&\-_.]+)/); if (m) out.push(m[1]); }
  return out;
}

/** Combined OI vs market-wide position limit, per stock. */
export function parseCombineOi(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const head = splitCsvLine(lines[0]).map((x) => x.toLowerCase());
  const find = (re) => head.findIndex((h) => re.test(h));
  const sym = find(/symbol/), mw = find(/mwpl/), oi = find(/open interest/), lim = find(/limit/);
  if (sym < 0 || mw < 0 || oi < 0) throw new Error(`combineoi header not recognised: ${lines[0]}`);
  return lines.slice(1).map((l) => {
    const c = splitCsvLine(l);
    const m = num(c[mw]), o = num(c[oi]);
    return { symbol: c[sym], mwpl: m, oi: o, pct: m > 0 && o != null ? o / m : null, nextLimit: lim >= 0 ? num(c[lim]) : null };
  }).filter((r) => r.symbol);
}

/** Archive URLs for a session date. */
export function nseUrls(date) {
  const [y, m, d] = date.split("-");
  return {
    bhav: `https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_${y}${m}${d}_F_0000.csv.zip`,
    participant: `https://nsearchives.nseindia.com/content/nsccl/fao_participant_oi_${d}${m}${y}.csv`,
    secban: `https://nsearchives.nseindia.com/content/fo/fo_secban_${d}${m}${y}.csv`,
    combineoi: `https://nsearchives.nseindia.com/archives/nsccl/mwpl/combineoi_${d}${m}${y}.zip`,
  };
}
