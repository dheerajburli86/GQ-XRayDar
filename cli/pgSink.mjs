// Pipeline Sink writing to this app's tas_* tables. It never touches a table
// the heatmap dashboard owns.
//
// Persistence rules:
//   - Index values are stored per (index, year). A year row is rewritten only if
//     its content hash changed, and every historical date whose level moved is
//     logged in tas_index_revision first: past values are never silently replaced.
//   - Current-state tables (snapshot, security, ww, breadth, ...) are replaced
//     run by run; rows the run did not produce are removed at the end of a
//     SUCCESSFUL run only.

import { stableStringify, hashString, METHODOLOGY } from "../engine/methodology.js";
import { encodeEvents } from "../engine/eventCodec.js";
import { SCREEN_KEYS } from "../engine/screenRow.js";

const CURRENT_STATE = ["tas_snapshot", "tas_events", "tas_security", "tas_ww", "tas_breadth", "tas_rotation", "tas_glocom_group", "tas_regime", "tas_ewcw", "tas_backtest", "tas_fx"];

async function upsertJson(client, table, rows, conflict, cols) {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const set = cols.filter((c) => !conflict.includes(c)).map((c) => `${c} = excluded.${c}`).join(", ");
    await client.query(
      `insert into ${table} (${cols.join(",")})
       select ${cols.join(",")} from json_populate_recordset(null::${table}, $1::json)
       on conflict (${conflict.join(",")}) do ${set ? `update set ${set}` : "nothing"}`,
      [JSON.stringify(chunk)]);
  }
}

export function pgSink(pool, { log = console.log, dryRun = false } = {}) {
  let runId = null;
  const pendingIdx = [];
  const counts = { indices: 0, yearRowsWritten: 0, yearRowsUnchanged: 0, revisions: 0, snapshots: 0, events: 0, issues: 0 };

  async function flushIndices() {
    if (!pendingIdx.length || dryRun) { pendingIdx.length = 0; return; }
    const batch = pendingIdx.splice(0);
    const client = await pool.connect();
    try {
      await client.query("begin");
      await upsertJson(client, "tas_index", batch.map((b) => b.meta), ["index_key"],
        ["index_key", "family", "ccy", "currency_code", "scope_key", "name", "level", "scope_type", "scope_value", "sector", "cap", "country", "region", "classification", "start_date", "last_date", "last_level", "n_last", "cap_estimated", "run_id"]);
      const keys = batch.map((b) => b.meta.index_key);
      const { rows: existing } = await client.query(`select index_key, year, content_hash from tas_index_values where index_key = any($1)`, [keys]);
      const have = new Map(existing.map((r) => [`${r.index_key}#${r.year}`, r.content_hash]));
      const toWrite = [], changedExisting = [];
      for (const b of batch) for (const y of b.years) {
        const k = `${b.meta.index_key}#${y.year}`;
        const old = have.get(k);
        if (old === y.content_hash) { counts.yearRowsUnchanged++; continue; }
        toWrite.push({ ...y, index_key: b.meta.index_key, run_id: runId });
        if (old) changedExisting.push([b.meta.index_key, y.year, y]);
      }
      // log revisions of historical values before overwriting them
      for (const [key, year, y] of changedExisting) {
        const { rows } = await client.query(`select dates::text[] d, level from tas_index_values where index_key = $1 and year = $2`, [key, year]);
        if (!rows.length) continue;
        const oldMap = new Map(rows[0].d.map((d, i) => [d, rows[0].level[i]]));
        const revs = [];
        y.dates.forEach((d, i) => {
          const o = oldMap.get(d);
          if (o != null && Math.abs(o - y.level[i]) > 1e-9 * Math.max(1, Math.abs(o))) revs.push({ index_key: key, date: d, old_level: o, new_level: y.level[i], run_id: runId });
        });
        if (revs.length) { await upsertJson(client, "tas_index_revision", revs, ["id"], ["index_key", "date", "old_level", "new_level", "run_id"]); counts.revisions += revs.length; }
      }
      await upsertJson(client, "tas_index_values", toWrite, ["index_key", "year"], ["index_key", "year", "dates", "level", "n", "n_stale", "cap_usd", "content_hash", "run_id"]);
      counts.yearRowsWritten += toWrite.length;
      await client.query("commit");
    } catch (e) { await client.query("rollback"); throw e; } finally { client.release(); }
  }

  async function simple(table, rows, conflict, cols) {
    if (dryRun || !rows.length) return;
    const client = await pool.connect();
    try { await client.query("begin"); await upsertJson(client, table, rows, conflict, cols); await client.query("commit"); }
    catch (e) { await client.query("rollback"); throw e; } finally { client.release(); }
  }

  return {
    counts,
    async begin(run, m) {
      runId = run.runId;
      log(`run ${runId} methodology ${run.methodologyVersion} (${run.methodologyHash})${dryRun ? " [DRY RUN - nothing is written]" : ""}`);
      if (dryRun) return;
      await pool.query(`insert into tas_calc_run (run_id, started, mode, methodology_version, methodology_hash, methodology, status)
                        values ($1,$2,$3,$4,$5,$6,'running')`, [runId, run.started, run.mode, run.methodologyVersion, run.methodologyHash, JSON.stringify(m)]);
    },
    async indexSeries(meta, c) {
      counts.indices++;
      const years = new Map();
      c.dates.forEach((d, i) => {
        const y = +d.slice(0, 4);
        if (!years.has(y)) years.set(y, { year: y, dates: [], level: [], n: [], n_stale: [], cap_usd: meta.family === "CW" ? [] : null });
        const r = years.get(y);
        r.dates.push(d); r.level.push(c.level[i]); r.n.push(c.n[i]); r.n_stale.push(c.nStale[i]);
        if (r.cap_usd) r.cap_usd.push(c.cap[i]);
      });
      const ys = [...years.values()].map((y) => ({ ...y, content_hash: hashString(stableStringify([y.dates, y.level, y.n, y.n_stale])) }));
      pendingIdx.push({
        meta: {
          index_key: meta.key, family: meta.family, ccy: meta.ccy, currency_code: meta.currencyCode, scope_key: meta.scopeKey, name: meta.name,
          level: meta.level, scope_type: meta.scopeType, scope_value: meta.scopeValue, sector: meta.sector, cap: meta.cap, country: meta.country,
          region: meta.region, classification: meta.classification, start_date: meta.startDate, last_date: meta.lastDate,
          last_level: meta.lastLevel, n_last: meta.nLast, cap_estimated: true, run_id: runId,
        },
        years: ys,
      });
      if (pendingIdx.length >= 100) await flushIndices();
    },
    async memberships(list) {
      await flushIndices();
      await simple("tas_membership", list.map((m) => ({ country: m.country, rebalance_date: m.date, is_latest: m.latest, members: m.members, run_id: runId })),
        ["country", "rebalance_date", "is_latest"], ["country", "rebalance_date", "is_latest", "members", "run_id"]);
      log(`memberships: ${list.length} rebalance snapshots`);
    },
    async ww(groups) {
      await simple("tas_ww", groups.map((g) => ({ parent_key: g.parentKey, parent_type: g.parentType, child_type: g.childType, dates: g.dates, latest_flags: g.latestFlags, children: g.children, gaps: g.gaps || [], run_id: runId })),
        ["parent_key", "child_type"], ["parent_key", "parent_type", "child_type", "dates", "latest_flags", "children", "gaps", "run_id"]);
      log(`weight watcher: ${groups.length} parent/child groups`);
    },
    async countryResults(country, { snapshots, events, issues }) {
      counts.snapshots += snapshots.length; counts.issues += issues.length;
      await simple("tas_snapshot", snapshots.map((s) => ({ id: s.id, country, as_of: s.snap.asOf, snap: s.snap, f: s.f, ww: s.ww, glocom: s.glocom, rs_rank: s.rsRank, score: s.score, flat: s.flat, run_id: runId })),
        ["id"], ["id", "country", "as_of", "snap", "f", "ww", "glocom", "rs_rank", "score", "flat", "run_id"]);
      // stored window: the most recent storeYears (the backtest summary already used the full history)
      const cutoff = `${new Date().getUTCFullYear() - (METHODOLOGY.events.storeYears || 6)}-01-01`;
      const ev = [...events].map(([id, e]) => ({ id, events: encodeEvents(e.filter((x) => x.date >= cutoff)), run_id: runId }));
      counts.events += ev.reduce((a, x) => a + x.events.length, 0);
      await simple("tas_events", ev, ["id"], ["id", "events", "run_id"]);
      await simple("tas_data_issue", issues.map((x) => ({ run_id: runId, instrument_id: x.id, symbol: x.symbol, country: x.country, severity: x.severity, rule: x.rule, detail: x.detail })),
        ["id"], ["run_id", "instrument_id", "symbol", "country", "severity", "rule", "detail"]);
      log(`  ${country}: ${snapshots.length} snapshots, ${counts.events} events so far, ${issues.length} issues`);
    },
    async globalIssues(list) {
      await simple("tas_data_issue", list.map((x) => ({ run_id: runId, instrument_id: x.id, symbol: x.symbol, country: x.country, severity: x.severity, rule: x.rule, detail: x.detail })),
        ["id"], ["run_id", "instrument_id", "symbol", "country", "severity", "rule", "detail"]);
    },
    async breadth(b) {
      await simple("tas_breadth", Object.values(b).map((r) => ({ scope_key: r.key, light: r.light, data: r, run_id: runId })), ["scope_key"], ["scope_key", "light", "data", "run_id"]);
    },
    async rotation(r) {
      await simple("tas_rotation", Object.entries(r).map(([k, v]) => ({ scope_key: k, sectors: v, run_id: runId })), ["scope_key"], ["scope_key", "sectors", "run_id"]);
    },
    async glocomGroups(g) {
      await simple("tas_glocom_group", Object.entries(g).map(([k, v]) => ({ scope_key: k, data: v, run_id: runId })), ["scope_key"], ["scope_key", "data", "run_id"]);
    },
    async regimes(r) {
      await simple("tas_regime", Object.entries(r).map(([k, v]) => ({ index_key: k, label: v.label, data: v, run_id: runId })), ["index_key"], ["index_key", "label", "data", "run_id"]);
    },
    async ewcw(rows) {
      await simple("tas_ewcw", rows.map((r) => ({ pair_key: r.pairKey, scope_key: r.scopeKey, ccy: r.ccy, name: r.name, level: r.level, as_of: r.asOf, ratio: r.ratio, chg: r.chg, above_trend: r.aboveTrend, label: r.label, run_id: runId })),
        ["pair_key"], ["pair_key", "scope_key", "ccy", "name", "level", "as_of", "ratio", "chg", "above_trend", "label", "run_id"]);
    },
    async backtest(rows) {
      await simple("tas_backtest", rows.map((r) => ({ type: r.type, scope: r.scope, horizon: r.horizon, n: r.n, mean: r.mean, median: r.median, hit_rate: r.hitRate, excess_mean: r.excessMean, excess_hit_rate: r.excessHitRate, mfe: r.mfe, mae: r.mae, run_id: runId })),
        ["type", "scope", "horizon"], ["type", "scope", "horizon", "n", "mean", "median", "hit_rate", "excess_mean", "excess_hit_rate", "mfe", "mae", "run_id"]);
    },
    async fx(rows, { dates, fx }) {
      const start = dates.findIndex((d) => d >= (dates[0]));
      await simple("tas_fx", rows.map((r) => {
        const f = fx(r.currency);
        return { currency: r.currency, source: r.source, estimated: r.estimated, stale_days: r.staleDays, max_stale: r.maxStale, estimated_days: r.estimatedDays, latest: r.latest, latest_date: r.latestDate, dates: dates.slice(start), rate: Array.from(f.rate).slice(start), stale: Array.from(f.stale).slice(start), run_id: runId };
      }), ["currency"], ["currency", "source", "estimated", "stale_days", "max_stale", "estimated_days", "latest", "latest_date", "dates", "rate", "stale", "run_id"]);
    },
    async securities(secs, extra) {
      await flushIndices();
      await simple("tas_security", secs.map((s) => ({
        id: s.id, symbol: s.symbol, name: s.name, universe: s.universe, exchange: s.exchange, isin: s.isin, country: s.country, region: s.region,
        classification: s.classification, geo_assigned: s.geoAssigned, currency: s.currency, currency_major: s.currencyMajor, currency_divisor: s.currencyDivisor,
        country_currency: s.countryCurrency, sector: s.sector, industry_group: s.industryGroup, industry: s.industry, sub_industry: s.subIndustry ?? null, class_source: s.classSource,
        cap_local: s.capLocal, cap_currency: s.capCurrency, cap_usd: s.capUsd, cap_usd_now: extra.get(s.id)?.capUsdNow ?? null, turnover_usd: extra.get(s.id)?.turnoverUsd ?? null, shares_est: null,
        cap_segment: s.capSegment, asset_class: s.assetClass || "Stock", active: s.active, run_id: runId,
      })), ["id"], ["id", "symbol", "name", "universe", "exchange", "isin", "country", "region", "classification", "geo_assigned", "currency", "currency_major",
        "currency_divisor", "country_currency", "sector", "industry_group", "industry", "sub_industry", "class_source", "cap_local", "cap_currency", "cap_usd", "cap_usd_now", "turnover_usd",
        "shares_est", "cap_segment", "asset_class", "active", "run_id"]);
    },
    async finish(run) {
      await flushIndices();
      log(`writes: ${JSON.stringify(counts)}`);
      if (dryRun) return;
      for (const t of CURRENT_STATE) await pool.query(`delete from ${t} where run_id is distinct from $1`, [runId]);
      await pool.query(`delete from tas_data_issue where run_id is distinct from $1`, [runId]);
      await pool.query(`delete from tas_membership where run_id is distinct from $1`, [runId]);
      await pool.query(`update tas_calc_run set finished = $2, status = $3, stats = $4 where run_id = $1`,
        [runId, run.finished, run.status, JSON.stringify({ ...run.stats, writes: counts, screenKeys: SCREEN_KEYS })]);
    },
    async fail(err) {
      if (dryRun || !runId) return;
      await pool.query(`update tas_calc_run set finished = now(), status = 'failed', error = $2 where run_id = $1`, [runId, String(err?.stack || err)]);
    },
  };
}
