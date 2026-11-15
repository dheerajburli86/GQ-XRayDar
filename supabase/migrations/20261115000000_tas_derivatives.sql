-- Derivatives (F&O) end-of-day store and the cross-asset table.
-- Written only by this app (server/lib/fo.mjs, cli/xasset.mjs); public SELECT like the other analysis tables.

create table if not exists tas_fo_day (
  date         date primary key,
  status       text not null,                 -- ok | none (no file: holiday or not published yet) | error
  units        text,                          -- how OI / volume were read (contracts, or converted from shares)
  rows         int,
  underlyings  int,
  files        jsonb,                         -- which files loaded and any parse errors
  attempts     int default 1,
  fetched_at   timestamptz default now()
);

-- Full chain per underlying per session (kept for the most recent sessions only: the "time machine").
create table if not exists tas_fo_chain (
  date        date not null,
  und         text not null,
  kind        text,                           -- index | stock
  spot        double precision,
  lot         int,
  data        jsonb not null,                 -- {futures:[...], exp:[...], o:[[expIdx,strike,cp,close,settle,prevClose,oi,chgOi,vol,open,high,low],...]}
  primary key (date, und)
);
create index if not exists tas_fo_chain_und on tas_fo_chain(und, date desc);

-- Daily summary per underlying (kept indefinitely): rankings, screens, history charts.
create table if not exists tas_fo_stats (
  date   date not null,
  und    text not null,
  kind   text,
  s      jsonb not null,
  primary key (date, und)
);
create index if not exists tas_fo_stats_und on tas_fo_stats(und, date);

-- Exchange-published market-wide facts: participant OI, ban list, MWPL.
create table if not exists tas_fo_market (
  date          date primary key,
  participants  jsonb,
  ban           text[],
  mwpl          jsonb
);

-- Cross-asset context: one series per asset (equities, REITs, commodities, crypto, currencies, fixed income).
create table if not exists tas_xasset (
  key          text primary key,
  label        text,
  asset_class  text,
  source       text,                          -- heatmap price_history | house index | fmp (fixed income not in the heatmap)
  currency     text,
  dates        date[],
  close        double precision[],
  updated_at   timestamptz default now()
);
create table if not exists tas_xasset_bars (    -- raw FMP closes for symbols the heatmap does not carry
  symbol  text not null,
  date    date not null,
  close   double precision,
  primary key (symbol, date)
);

do $$ declare t text; begin
  foreach t in array array['tas_fo_day','tas_fo_chain','tas_fo_stats','tas_fo_market','tas_xasset','tas_xasset_bars'] loop
    execute format('alter table %I enable row level security', t);
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_read') then
      execute format('create policy %I on %I for select to anon, authenticated using (true)', t || '_read', t);
    end if;
  end loop;
end $$;
