-- GQ AI-Powered Technical Analysis Software: its OWN tables.
--
-- Every object here is prefixed tas_ and is new. Nothing in this file alters,
-- drops or writes to a table the heatmap dashboard owns (instruments,
-- price_history, returns_latest, fundamentals, fx_rates, glocom_latest ...);
-- those are only READ by the calculation engine.
--
-- Write path: the engine (cli/run.mjs) connects with the database connection
-- string, which bypasses RLS. Read path: the web app uses the anon key, so
-- every table gets RLS with a single SELECT policy -- market analytics are
-- public-read, the same as the heatmap's market tables.

begin;

-- ── audit trail ────────────────────────────────────────────────────────────────
create table if not exists tas_calc_run (
  run_id               text primary key,
  started              timestamptz not null,
  finished             timestamptz,
  mode                 text not null,                 -- 'supabase' (demo never writes)
  methodology_version  text not null,
  methodology_hash     text not null,
  methodology          jsonb not null,
  status               text not null default 'running', -- running | ok | failed | dry_run
  stats                jsonb not null default '{}'::jsonb,
  error                text
);

-- ── historical FX (requirement 22) ─────────────────────────────────────────────
create table if not exists tas_fx_history (
  currency      text not null,                 -- major ISO code (GBP, never GBX)
  date          date not null,
  usd_per_unit  double precision not null,     -- quotation: USD per ONE unit of currency
  provider_pair text not null,                 -- what the provider quoted (EURUSD, or USDJPY inverted)
  inverted      boolean not null default false,
  source        text not null,
  fetched_at    timestamptz not null default now(),
  primary key (currency, date)
);

-- FX as used by a run: rates aligned to the index calendar with stale flags
create table if not exists tas_fx (
  currency       text primary key,
  source         text,
  estimated      boolean not null default false,
  stale_days     int,
  max_stale      int,
  estimated_days int,
  latest         double precision,
  latest_date    date,
  dates          date[],
  rate           double precision[],
  stale          int[],
  run_id         text references tas_calc_run(run_id) on delete set null,
  updated_at     timestamptz not null default now()
);

-- ── corporate actions (input; adjust history before any calculation) ─────────
create table if not exists tas_corporate_action (
  id             bigserial primary key,
  instrument_id  text not null,
  ex_date        date not null,
  factor         double precision not null check (factor > 0), -- new shares per old (2-for-1 split = 2)
  type           text not null default 'split',               -- split | bonus | consolidation
  source         text not null,
  note           text,
  created_at     timestamptz not null default now(),
  unique (instrument_id, ex_date, type)
);

-- ── security master (normalised view of the heatmap's instruments) ────────────
create table if not exists tas_security (
  id              text primary key,             -- instruments.id
  symbol          text not null,
  name            text,
  universe        text,
  exchange        text,
  isin            text,
  country         text,
  region          text,
  classification  text,
  geo_assigned    boolean,
  currency        text,
  currency_major  text,
  currency_divisor int,
  country_currency text,
  sector          text,
  industry_group  text,
  industry        text,
  class_source    text,
  cap_local       double precision,
  cap_currency    text,
  cap_usd         double precision,
  cap_usd_now     double precision,
  shares_est      double precision,
  cap_segment     text,
  asset_class     text,                         -- Stock | ETF | Index (ETFs and indices are analysed, never inside CW / EW)
  active          boolean,
  run_id          text references tas_calc_run(run_id) on delete set null,
  updated_at      timestamptz not null default now()
);
create index if not exists tas_security_country on tas_security(country);
create index if not exists tas_security_sector  on tas_security(sector);

-- ── indices ───────────────────────────────────────────────────────────────────
create table if not exists tas_index (
  index_key      text primary key,              -- FAMILY|CCY|scope (e.g. CW|USD|R:Asia|S:Financials)
  family         text not null check (family in ('CW','EW')),
  ccy            text not null check (ccy in ('LCL','USD')),
  currency_code  text not null,
  scope_key      text not null,
  name           text not null,
  level          text not null,                 -- 1 .. 6 and supplementary 1s/4s/5s/6s
  scope_type     text not null,
  scope_value    text,
  sector         text,
  cap            text,
  country        text,
  region         text,
  classification text,
  start_date     date,
  last_date      date,
  last_level     double precision,
  n_last         int,
  cap_estimated  boolean not null default true, -- historical caps use constant (estimated) shares
  run_id         text references tas_calc_run(run_id) on delete set null,
  updated_at     timestamptz not null default now()
);
create index if not exists tas_index_scope on tas_index(scope_type, scope_value);

-- Daily values, one row per index per calendar year (arrays keep the table at
-- ~100k rows instead of ~25M). A year row is rewritten only when its content
-- changes; every changed historical value is logged in tas_index_revision.
create table if not exists tas_index_values (
  index_key  text not null references tas_index(index_key) on delete cascade,
  year       int  not null,
  dates      date[] not null,
  level      double precision[] not null,       -- daily return = level / previous level - 1 (see tas_index_series)
  n          int[] not null,
  n_stale    int[] not null,
  cap_usd    double precision[],
  content_hash text not null,
  run_id     text references tas_calc_run(run_id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (index_key, year)
);

create table if not exists tas_index_revision (
  id         bigserial primary key,
  index_key  text not null,
  date       date not null,
  old_level  double precision,
  new_level  double precision,
  run_id     text,
  revised_at timestamptz not null default now()
);
create index if not exists tas_index_revision_key on tas_index_revision(index_key, date);

-- Flat read API for exports / external consumers
create or replace function tas_index_series(p_key text)
returns table(date date, level double precision, ret double precision, n int, n_stale int, cap_usd double precision)
language sql stable as $$
  select u.d, u.l, u.l / nullif(lag(u.l) over (order by u.d), 0) - 1, u.n, u.s, u.c
  from tas_index_values v,
       unnest(v.dates, v.level, v.n, v.n_stale, coalesce(v.cap_usd, array_fill(null::double precision, array[cardinality(v.dates)])))
         as u(d, l, n, s, c)
  where v.index_key = p_key
  order by u.d
$$;

-- Point-in-time constituents at every rebalance (plus the latest observation)
create table if not exists tas_membership (
  country        text not null,
  rebalance_date date not null,
  is_latest      boolean not null default false,
  members        jsonb not null,                -- [{id, sector, ig, seg, capUsd}]
  run_id         text references tas_calc_run(run_id) on delete set null,
  primary key (country, rebalance_date, is_latest)
);

-- ── Weight Watcher ────────────────────────────────────────────────────────────
create table if not exists tas_ww (
  parent_key   text not null,
  parent_type  text not null,
  child_type   text not null,
  dates        date[] not null,
  latest_flags boolean[] not null,
  children     jsonb not null,                  -- [{key, weights:[...], caps:[...]}]
  run_id       text references tas_calc_run(run_id) on delete set null,
  primary key (parent_key, child_type)
);

-- ── per-security analytics ────────────────────────────────────────────────────
create table if not exists tas_snapshot (
  id        text primary key,
  country   text,
  as_of     date,
  snap      jsonb not null,
  f         jsonb,
  ww        jsonb,
  glocom    jsonb,
  rs_rank   int,
  score     jsonb,                              -- AI setup score with component evidence
  flat      jsonb,                              -- positional screen row; keys in tas_calc_run.stats.screenKeys
  run_id    text references tas_calc_run(run_id) on delete set null,
  updated_at timestamptz not null default now()
);
create index if not exists tas_snapshot_country on tas_snapshot(country);

create table if not exists tas_events (
  id      text primary key,
  events  jsonb not null,
  run_id  text references tas_calc_run(run_id) on delete set null
);

create table if not exists tas_backtest (
  type text not null, scope text not null, horizon text not null,
  n int, mean double precision, median double precision, hit_rate double precision,
  excess_mean double precision, excess_hit_rate double precision, mfe double precision, mae double precision,
  run_id text references tas_calc_run(run_id) on delete set null,
  primary key (type, scope, horizon)
);

-- ── market-level analytics ────────────────────────────────────────────────────
create table if not exists tas_breadth (
  scope_key text primary key,
  light     boolean not null default false,
  data      jsonb not null,                     -- {dates, n, adv, dec, adLine, pct20, pct50, pct200, newHigh, newLow, pctBullMma}
  run_id    text references tas_calc_run(run_id) on delete set null
);

create table if not exists tas_rotation (
  scope_key text primary key,
  sectors   jsonb not null,
  run_id    text references tas_calc_run(run_id) on delete set null
);

create table if not exists tas_regime (
  index_key text primary key,
  label     text,
  data      jsonb not null,
  run_id    text references tas_calc_run(run_id) on delete set null
);

create table if not exists tas_ewcw (
  pair_key    text primary key,
  scope_key   text, ccy text, name text, level text,
  as_of       date, ratio double precision, chg jsonb, above_trend boolean, label text,
  run_id      text references tas_calc_run(run_id) on delete set null
);

create table if not exists tas_data_issue (
  id            bigserial primary key,
  run_id        text references tas_calc_run(run_id) on delete cascade,
  instrument_id text, symbol text, country text,
  severity      text not null, rule text not null, detail text
);
create index if not exists tas_data_issue_run on tas_data_issue(run_id);

-- ── read access ───────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['tas_calc_run','tas_fx_history','tas_fx','tas_corporate_action','tas_security','tas_index',
    'tas_index_values','tas_index_revision','tas_membership','tas_ww','tas_snapshot','tas_events','tas_backtest',
    'tas_breadth','tas_rotation','tas_regime','tas_ewcw','tas_data_issue']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format('create policy %I on %I for select to anon, authenticated using (true)', t || '_read', t);
    execute format('grant select on %I to anon, authenticated', t);
  end loop;
end $$;

commit;
alter table tas_security add column if not exists asset_class text;
