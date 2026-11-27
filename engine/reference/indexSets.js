// The two index sets from the owner's workbook "New_Index_Creation.xlsx" (Alok Sir's item 21):
//   1. "Exchange Major Indices"  -> the FG... / ETOTAL$ sets (country equity indices, commodities, nested composites)
//   2. "US ETF Indices"          -> the ETF... sets (country / region / asset-class ETF baskets)
// Membership comes from the workbook (indexSetsData.js, generated). This file says how each workbook ticker is
// resolved to a series the app holds, what each set is called, and which sheet it belongs to.
// Everything is built in USD (a "$" ticker is the USD version in the old software; futures and ETFs are USD already).
import { EXCHANGE_SETS, EXCHANGE_COUNTRY, ETF_SETS } from "./indexSetsData.js";

export const SET_PREFIX = "GQSET:";
export const SHEETS = {
  exchange: { key: "exchange", title: "Exchange major indices (FG set)", sheet: "Exchange Major Indices" },
  etf: { key: "etf", title: "US ETF indices (ETF set)", sheet: "US ETF Indices" },
};

export const SET_NAMES = {
  "FGALLEQUITY2$": "All equity, by country (incl. US tech / non-tech)", FGAPEC: "Asia-Pacific equity", FGAGRI: "Agriculture commodities",
  FGMETAL: "Metals", FGCMDTY: "All commodities", FGMEAST: "Middle East equity", FGAFRICA: "Africa equity", FGIMTL: "Industrial metals",
  FGPMTL: "Precious metals", FGCMDTY2: "Commodities (agri, industrial metals, precious metals, oil)", FGENERGY: "Energy",
  FGCMDTY1: "Commodities (agri, energy, industrial and precious metals)", "FGEMERGE$": "Emerging-market equity", "ETOTAL$": "Europe equity",
  "FGALLEQUITY$": "All equity (Europe, emerging, Japan, US)", "FGALLASSET$": "All assets (equity, commodities, REIT, US Treasuries)",
  ETFEQ: "Country equity ETFs (all)", ETFEM: "Emerging-market country ETFs", ETFEUROPE: "Europe country ETFs", ETFLATAM: "Latin America ETFs",
  ETFASIA: "Asia, Middle East and emerging ETFs", ETFCOMB: "Combined: Asia, Europe, LatAm, Australia, Japan, US", ETFCOMM: "Commodity ETFs",
  ETFPR: "Precious-metal ETFs", ETFASSET: "Multi-asset ETFs (world equity, bonds, commodities, REIT)",
};

/** Workbook spellings that mean another ticker (typos / the "$"-less name of the same member). */
export const ALIAS = {
  NGASS: "NGAS",                       // FGENERGY says NGASS, FGCMDTY says NGAS
  HK: "HK$", INDONESIA: "INDONESIA$", MALAYSIA: "MALAYSIA$", PHILIPPINESPSE: "PHILIPPINES$", SENSEX: "SENSEX$",
  SEOULKOSPI: "SEOUL$", "SET-BANGKOK": "SET$", SINGAPORESTRAI: "SINGAPORE$", TAIWANSTOCKEX: "TAIWAN$", SAFRICA: "SAFRICA$",
};

const x = (sym) => ({ via: "x", sym });
const etf = (sym, proxy = true) => ({ via: "etf", sym, proxy });
const house = (key) => ({ via: "house", sym: key });
const fut = (sym) => ({ via: "x", sym });

/**
 * Workbook ticker -> candidates, tried in order (first one with at least 20 bars wins).
 * A candidate flagged proxy is a stand-in (an MSCI country ETF for an MSCI index the app cannot hold, a Treasury ETF for "USTBOND"):
 * the set page says so, so nobody reads it as the official index.
 */
export const LEAF = {
  "AEX$": [x("USD:^AEX")], "AUSTRALIAN$": [x("USD:GL:^AXJO")], "BELGIEN$": [x("USD:^BFX")], "BRAZIL$": [x("USD:GL:^BVSP")],
  "CAC$": [x("USD:GL:^FCHI")], "CHINA$": [x("USD:GL:000001.SS")], "DAXI$": [x("USD:GL:^GDAXI")], "DENAMRK$": [x("USD:GL:^OMXC20")],
  "FTSE$": [x("USD:GL:^FTSE")], "HK$": [x("USD:GL:^HSI")], "IBEX$": [x("USD:GL:^IBEX")], "INDONESIA$": [x("USD:GL:^JKSE")],
  "ITALY$": [x("USD:FTSEMIB.MI")], "MALAYSIA$": [x("USD:^KLSE")], "MEXICO$": [x("USD:GL:^MXX")], "NIKKEI$": [x("USD:GL:^N225")],
  "OMX30$": [x("USD:GL:^OMXS30")], "PHILIPPINES$": [x("USD:PSEI.PS"), etf("EPHE")], "RUSSIA$": [x("USD:GL:IMOEX.ME"), x("RTSI.ME")],
  "SAFRICA$": [x("USD:^J203.JO"), etf("EZA")], "SENSEX$": [x("USD:IN:SENSEX")], "SEOUL$": [x("USD:GL:^KS11")], "SET$": [x("USD:^SET.BK")],
  "SINGAPORE$": [x("USD:GL:^STI")], "SMI$": [x("USD:GL:^SSMI")], "TAIWAN$": [x("USD:GL:^TWII")], "TURKEY$": [x("USD:XU100.IS")],
  USTECH: [house("CW|USD|C:United States|T:Technology")], USNONTECH: [house("CW|USD|C:United States|T:Non Technology")],
  USTOTAL: [house("CW|USD|C:United States")],
  // MSCI index levels are licensed and not held: the iShares / Global X MSCI country ETF stands in
  MSCIARGENTINA: [etf("ARGT")], MSCICHILE: [etf("ECH")], MSCICOLOMBIA: [etf("COLO")], MSCIPERU: [etf("EPU")], MSCIFINLAND: [etf("EFNL")],
  MSCIGREECE: [etf("GREK")], MSCINORWAY: [etf("ENOR")], MSCIPOLAND: [etf("EPOL")],
  // Middle East / Africa: only what is held; the rest is reported missing, never invented
  EGYPT: [x("USD:^CASE30")], ISRAEL: [x("USD:^TA125.TA")], QATAR: [etf("QAT")], SAUDI: [x("USD:^TASI.SR"), etf("KSA")], UAE: [etf("UAE")],
  ABU: [], BAHARIN: [], DUBAI: [], JORDAN: [], KUWAIT: [], LEBANON: [], MAURITIUS: [], MUSCAT: [],
  KENYA: [], MOROCCO: [], NAMIBIA: [], NIGERIA: [], TUNISIA: [],
  // commodities: FMP futures (USD)
  ALUM: [fut("ALIUSD")], COPPER: [fut("HGUSD")], GOLD: [fut("GCUSD")], PALLD: [fut("PAUSD")], PLATINUM: [fut("PLUSD")], SILVER: [fut("SIUSD")],
  ZINC: [fut("ZNUSD")], COCOA: [fut("CCUSD")], COFFEE: [fut("KCUSX")], CORN: [fut("ZCUSX")], LUMBER: [fut("LBUSD")], OATS: [fut("ZOUSX")],
  ORANGE: [fut("OJUSX")], RICE: [fut("ZRUSD")], SOYA: [fut("ZSUSX")], SUGAR: [fut("SBUSD")], WHEAT: [fut("KEUSX")],
  HEATINGOIL: [fut("HOUSD")], NGAS: [fut("NGUSD")], OIL: [fut("CLUSD")],
  NICKLE: [], STEELMED: [], HRC: [], LEAD: [], COTTON: [],   // no live series (FMP stale or absent): reported missing
  // the two members the workbook uses but never defines (the ETF sheet's multi-asset set uses the same four asset classes)
  FGREIT: [etf("VNQ")], USTBOND: [etf("IEF")],
};

const NAME_OF = (code) => SET_NAMES[code] || code;
const setLabel = (code) => `${code} · ${NAME_OF(code)} (USD)`;

/** All sets with sheet, label and members; the workbook order is kept. */
export function indexSetDefs() {
  const out = [];
  for (const s of EXCHANGE_SETS) out.push({ sheet: "exchange", code: s.code, symbol: SET_PREFIX + s.code, label: setLabel(s.code), members: s.members });
  for (const s of ETF_SETS) out.push({ sheet: "etf", code: s.code, symbol: SET_PREFIX + s.code, label: setLabel(s.code), members: s.members });
  return out;
}

/**
 * Classify one workbook member of a set: {kind: 'set'|'leaf'|'etf', code, candidates}. Sets of the same sheet are looked up first,
 * then the resolution table, then (ETF sheet) the member is an ETF ticker itself.
 */
export function classifyMember(def, rawMember, byCode) {
  const m = ALIAS[rawMember] || rawMember;
  if (byCode.get(def.sheet)?.has(m) && m !== def.code) return { kind: "set", code: m, raw: rawMember };
  if (def.sheet === "etf") return { kind: "etf", code: m, raw: rawMember, candidates: [etf(m, false)] };
  if (Object.prototype.hasOwnProperty.call(LEAF, m)) return { kind: "leaf", code: m, raw: rawMember, candidates: LEAF[m] };
  return { kind: "leaf", code: m, raw: rawMember, candidates: [], unknown: true };
}

export const COUNTRY_OF = EXCHANGE_COUNTRY;
