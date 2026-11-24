-- Minimal stand-in for the heatmap dashboard's tables, used ONLY by
-- scripts/local-integration.mjs to exercise the engine against a local
-- Postgres. Never run this against the real database.
create extension if not exists pgcrypto;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create table if not exists instruments (
  id uuid primary key, symbol text, name text, universe text, type text, sector text, industry text, country text,
  region text, currency text, exchange text, isin text, is_active boolean, market_cap_local numeric, market_cap_currency text,
  market_cap_usd bigint, market_cap_inr bigint, etf_category text);
create table if not exists price_history (instrument_id uuid, date date, open numeric, high numeric, low numeric, close numeric, volume bigint, primary key (instrument_id, date));
create table if not exists fundamentals (instrument_id uuid primary key, income_statement jsonb, income_statement_q jsonb, balance_sheet jsonb, balance_sheet_q jsonb, cash_flow jsonb, cash_flow_q jsonb, reported_currency text);
create table if not exists fx_rates (currency text primary key, usd_per_unit numeric);
create table if not exists glocom_latest (instrument_id uuid primary key, glocom_code int, glocom_label text, sort_score numeric, pctile_1m numeric, pctile_3m numeric, pctile_6m numeric, pctile_1y numeric, as_of timestamptz);
grant usage on schema public to anon, authenticated;
grant select on instruments, price_history to anon, authenticated;
alter table instruments add column if not exists etf_category text;
alter table fundamentals add column if not exists profile jsonb;
