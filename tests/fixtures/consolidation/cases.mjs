// The owner's dated examples (WhatsApp table, 2026-11-18) and the price data they are checked on.
// Dates: "YYYY-MM-DD" where he gave a day, "YYYY-MM" where he gave a month. The "End / Breakout date"
// column is `end`. Rows with only a start (HFCL monthly / quarterly 2026) have no end and are not scored.
//
// Data files (<NAME>.txt): one line per timeframe, "d|w|m|q date,close date,close ...", the last close
// of each day / week (Mon-Sun) / month / quarter from the heatmap's price_history, as stored on
// 2026-11-17. Each line was checked byte for byte against the database with md5 when it was copied.
//   KOSPI_USD / TAIWAN_USD = ^KS11 / ^TWII x tas_fx_history (KRW / TWD to USD on the same day).
//   DELL monthly / quarterly start Aug 2016: the stored series before that is the old Dell Inc.
// Benchmarks are the ones on his RSCMMA charts: BSE500 (India), CBOE NASDAQ 100 (Dell, Nvidia),
// iShares MSCI ACWI ETF (KOSPI $, Taiwan $).
export const BENCH = { HFCL: "BSE500", GLENMARK: "BSE500", SANSERA: "BSE500", DELL: "NDX", NVDA: "NDX", KOSPI_USD: "ACWI", TAIWAN_USD: "ACWI" };

const C = [];
const add = (stock, screen, tf, start, end, note) => C.push({ stock, screen, tf, start, end, note });
add("HFCL", "RSIMMA", "M", "2020-04", "2021-01"); add("HFCL", "RSIMMA", "Q", "2019-12", "2020-12");
add("HFCL", "RSIMMA", "D", "2026-02-04", "2026-04-09"); add("HFCL", "RSIMMA", "W", "2026-02-06", "2026-04-10");
add("HFCL", "RSIMMA", "M", "2026-04", null); add("HFCL", "RSIMMA", "Q", "2026-06", null);
add("HFCL", "RSCMMA", "M", "2020-04", "2021-02"); add("HFCL", "RSCMMA", "Q", "2020-06", "2021-03");
add("HFCL", "RSCMMA", "D", "2026-02-04", "2026-03-10"); add("HFCL", "RSCMMA", "W", "2026-02-01", "2026-04-10");
add("HFCL", "RSCMMA", "M", "2026-04", null); add("HFCL", "RSCMMA", "Q", "2026-06", null);
add("GLENMARK", "RSIMMA", "W", "2022-10-14", "2023-03-31"); add("GLENMARK", "RSIMMA", "M", "2023-02-28", "2023-04-28"); add("GLENMARK", "RSIMMA", "Q", "2022-12", "2023-06");
add("GLENMARK", "RSIMMA", "W", "2025-03-28", "2025-06-13");
add("GLENMARK", "RSCMMA", "W", "2022-10-14", "2023-03-24"); add("GLENMARK", "RSCMMA", "M", "2023-02-28", "2023-04-28"); add("GLENMARK", "RSCMMA", "Q", "2022-12", "2023-06");
add("GLENMARK", "RSCMMA", "W", "2025-03-28", "2025-06-06");
add("SANSERA", "RSIMMA", "W", "2022-02-16", "2023-05-12"); add("SANSERA", "RSIMMA", "M", "2022-10", "2023-05"); add("SANSERA", "RSIMMA", "Q", "2022-12", "2023-03");
add("SANSERA", "RSIMMA", "W", "2025-06-13", "2025-09-12"); add("SANSERA", "RSIMMA", "M", "2025-04", "2025-09");
add("SANSERA", "RSCMMA", "W", "2022-09-02", "2023-06-02"); add("SANSERA", "RSCMMA", "M", "2022-10", "2024-05", "the table says May-24; May-23 would fit the other rows");
add("SANSERA", "RSCMMA", "D", "2025-06-13", "2025-09-05"); add("SANSERA", "RSCMMA", "W", "2025-06-13", "2025-09-12"); add("SANSERA", "RSCMMA", "M", "2025-04", "2025-09");
add("DELL", "RSIMMA", "W", "2022-11-04", "2023-04-28"); add("DELL", "RSIMMA", "M", "2022-12", "2023-05"); add("DELL", "RSIMMA", "Q", "2022-12", "2023-06");
add("DELL", "RSIMMA", "D", "2026-01-27", "2026-02-27"); add("DELL", "RSIMMA", "W", "2026-01-30", "2026-02-27"); add("DELL", "RSIMMA", "M", "2026-01", "2026-02"); add("DELL", "RSIMMA", "Q", "2025-12", "2026-03");
add("DELL", "RSCMMA", "W", "2023-03-31", "2023-08-11"); add("DELL", "RSCMMA", "M", "2023-03", "2023-08"); add("DELL", "RSCMMA", "Q", "2023-03", "2023-06");
add("DELL", "RSCMMA", "D", "2026-01-27", "2026-02-27"); add("DELL", "RSCMMA", "W", "2026-02-13", "2026-02-27"); add("DELL", "RSCMMA", "M", "2026-01", "2026-02"); add("DELL", "RSCMMA", "Q", "2025-12", "2026-03");
add("NVDA", "RSIMMA", "M", "2013-01", "2013-09"); add("NVDA", "RSIMMA", "Q", "2013-06", "2013-12");
add("NVDA", "RSCMMA", "M", "2014-01", "2015-08"); add("NVDA", "RSCMMA", "Q", "2014-09", "2015-06");
add("KOSPI_USD", "RSIMMA", "W", "2024-05-31", "2025-05-23"); add("KOSPI_USD", "RSIMMA", "M", "2024-05", "2025-06"); add("KOSPI_USD", "RSIMMA", "Q", "2024-06", "2025-06");
add("KOSPI_USD", "RSCMMA", "W", "2025-01-31", "2025-06-13"); add("KOSPI_USD", "RSCMMA", "M", "2025-04", "2025-09"); add("KOSPI_USD", "RSCMMA", "Q", "2025-06", "2025-09");
add("TAIWAN_USD", "RSIMMA", "M", "2016-04", "2017-01", "our ^TWII history starts in 2015"); add("TAIWAN_USD", "RSIMMA", "Q", "2016-06", "2017-03", "our ^TWII history starts in 2015");
add("TAIWAN_USD", "RSIMMA", "W", "2023-01-13", "2023-11-24", "listed as RSIMMA twice in the table"); add("TAIWAN_USD", "RSIMMA", "M", "2023-01", "2023-12"); add("TAIWAN_USD", "RSIMMA", "Q", "2023-03", "2023-12");
export const CASES = C;

/** "It was continue trend on monthly and quarterly": he saw no consolidation there. */
export const NEGATIVES = [
  { stock: "GLENMARK", screen: "RSIMMA", tf: "M", from: "2025-03", to: "2025-06" }, { stock: "GLENMARK", screen: "RSIMMA", tf: "Q", from: "2025-03", to: "2025-06" },
  { stock: "GLENMARK", screen: "RSCMMA", tf: "M", from: "2025-03", to: "2025-06" }, { stock: "GLENMARK", screen: "RSCMMA", tf: "Q", from: "2025-03", to: "2025-06" },
  { stock: "SANSERA", screen: "RSIMMA", tf: "Q", from: "2025-06", to: "2025-09" }, { stock: "SANSERA", screen: "RSCMMA", tf: "Q", from: "2025-06", to: "2025-09" },
];
