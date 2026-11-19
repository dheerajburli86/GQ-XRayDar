-- Instruments the heatmap does not carry, for charting only (owner: "all US indices, global
-- indices, currency"): more global / US indices, bond yields and commodity futures from FMP,
-- and currency pairs built from tas_fx. One row per instrument, closes as arrays.
-- Written by cli/extraJob.mjs (run by the TA server); never part of indices, WW or screens.
create table if not exists tas_extra_series (
  symbol      text primary key,          -- FMP symbol, or FX:<BASE><QUOTE> for a currency pair
  label       text not null,
  category    text not null,             -- Index | Currency | Commodity | Rate
  region      text,
  country     text,
  currency    text,
  source      text,
  dates       date[],
  close       double precision[],
  updated_at  timestamptz default now()
);
alter table tas_extra_series enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'tas_extra_series' and policyname = 'tas_extra_series_read') then
    create policy tas_extra_series_read on tas_extra_series for select to anon, authenticated using (true);
  end if;
end $$;
