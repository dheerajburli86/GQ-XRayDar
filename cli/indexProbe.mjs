// Read-only probe: which of the indices / commodities missing from XRayDar can FMP serve?
// Usage: FMP_API_KEY=... node cli/indexProbe.mjs > probe.csv      (needs internet; writes nothing anywhere)
// For each wanted item it tries several candidate FMP symbols and reports the first with real daily history.
const KEY = process.env.FMP_API_KEY;
if (!KEY) { console.error("Set FMP_API_KEY"); process.exit(1); }
const WANT = {
  "Portugal PSI 20": ["^PSI20", "PSI20.LS", "^PSI"], "Poland WIG20": ["^WIG20", "WIG20.WA"], "Poland WIG": ["^WIG", "WIG.WA"],
  "Hungary Budapest BUX": ["^BUX", "BUX.BD"], "RTSI (Russia)": ["^RTSI", "RTSI.ME"], "SZSE Component": ["399001.SZ", "^SZSC"],
  "China A50": ["XIN9.FGI", "^XIN9"], "DJ Shanghai": ["000300.SS", "^CSI300"], "SSE STAR 50": ["000688.SS", "000688.SH"],
  "Hang Seng TECH": ["^HSTECH", "HSTECH.HK"], "Philippines PSEi": ["^PSEI", "PSEI.PS"], "Karachi 100": ["^KSE100", "KSE100.KA"],
  "Vietnam HNX 30": ["^HNX30", "HNX30.HN"], "Vietnam VN-Index": ["^VNINDEX", "VNINDEX.VN"], "Dubai DFM General": ["^DFMGI", "DFMGI.AE"],
  "Qatar DSM 20": ["^QSI", "QSI.QA"], "South Africa Top 40": ["^J200.JO", "^JTOPI", "J200.JO"], "Morocco MASI": ["^MASI", "MASI.CS"],
  "Nigeria All Share": ["^NGSEINDX", "NGSE.LG"], "Tunisia Tunindex": ["^TUNINDEX", "TUNINDEX.TN"], "Jordan Amman General": ["^AMGNRLX", "ASE.AM"],
  "Turkey BIST All Share": ["XUTUM.IS", "^XUTUM"], "Greece Athens General": ["^ATG", "GD.AT", "^ATHEX"], "Israel TA-35": ["^TA35.TA", "TA35.TA"],
  "India 10Y G-sec yield": ["IN10Y", "^IN10Y"], "Platinum futures": ["PLUSD"], "Palladium futures": ["PAUSD"], "Heating oil futures": ["HOUSD"],
  "RBOB gasoline futures": ["RBUSD"], "Aluminum futures": ["ALIUSD", "ALUSD"], "Nickel": ["NIUSD", "NICKEL"], "Zinc": ["ZNUSD", "ZINC"],
  "Lead": ["PBUSD", "LEAD"], "Wheat futures": ["KEUSX", "ZWUSD", "ZW=F"], "Rough rice futures": ["ZRUSD", "ROUSX"], "Corn futures": ["ZCUSD", "ZCUSX"],
  "Soybeans futures": ["ZSUSD", "ZSUSX"], "Soybean oil futures": ["ZLUSD", "ZLUSX"], "Soybean meal futures": ["ZMUSD", "ZMUSX"],
  "Cotton futures": ["CTUSD", "CTUSX"], "Cocoa futures": ["CCUSD", "CCUSX"], "Coffee futures": ["KCUSD", "KCUSX"], "Sugar futures": ["SBUSD", "SBUSX"],
  "Orange juice futures": ["OJUSD", "OJUSX"], "Live cattle": ["LEUSD", "LEUSX"], "Lean hogs": ["HEUSD", "HEUSX"], "Feeder cattle": ["GFUSD", "GFUSX"],
  "Lumber": ["LBUSD", "LBS=F"], "Oats": ["ZOUSD", "ZOUSX"], "London gas oil": ["LGOUSD"], "Newcastle coal": ["MTFUSD", "NCUSD"],
  "Hot-rolled coil steel": ["HRCUSD"], "CRB commodity index": ["^CRB", "TRJEFFCRB"],
  "MSCI World": ["URTH", "^MSCIWORLD"], "MSCI ACWI": ["ACWI", "^MSCIACWI"], "MSCI Emerging": ["EEM", "^MSCIEF"], "MSCI India": ["INDA", "^MSCIIN"],
};
const get = async (u) => { try { const r = await fetch(u); return r.ok ? await r.json() : null; } catch { return null; } };
const rows = [["item", "symbol_tried", "ok", "first_date", "last_date", "bars", "note"]];
for (const [item, cands] of Object.entries(WANT)) {
  let hit = null;
  for (const s of cands) {
    const j = await get(`https://financialmodelingprep.com/stable/historical-price-eod/light?symbol=${encodeURIComponent(s)}&from=2000-01-01&apikey=${KEY}`);
    const a = Array.isArray(j) ? j.filter((x) => Number.isFinite(x.price ?? x.close)) : [];
    if (a.length > 250) { const d = a.map((x) => x.date).sort(); hit = [item, s, "YES", d[0], d[d.length - 1], a.length, ""]; break; }
  }
  rows.push(hit || [item, cands.join(" / "), "NO", "", "", 0, "no usable history from these symbols"]);
}
console.log(rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n"));
