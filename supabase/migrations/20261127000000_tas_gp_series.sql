-- GLOCOM / LOCOM category portfolios (2026-11-27): the price series of each portfolio universe, copied from the
-- heatmap's price_history by cli/gpJob.mjs so the page needs one small read. tas_* only; the heatmap tables are never written.
begin;
create table if not exists tas_gp_series (
  universe   text not null,           -- global_country | global_sector | us_sector | india_sector
  key        text not null,           -- instrument symbol (unique inside the universe)
  label      text not null,
  is_bench   boolean not null default false,
  source     text,
  currency   text,
  dates      date[] not null,
  close      double precision[] not null,
  updated_at timestamptz not null default now(),
  primary key (universe, key)
);
alter table tas_gp_series enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'tas_gp_series' and policyname = 'tas_gp_series_read') then
    create policy tas_gp_series_read on tas_gp_series for select to anon, authenticated using (true);
  end if;
end $$;
commit;
