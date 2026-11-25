-- Price repairs for bars the heatmap's price_history holds wrongly (SRSN at 0.0003 for months, CBDG at 0.014, ...).
-- price_history is heatmap-owned and never written here: the repair job (cli/priceRepairJob.mjs) re-fetches the
-- provider's bars and records a decision per bad date; every bar loader applies 'replace' / 'drop' on read.
create table if not exists tas_price_repair (
  instrument_id text not null,
  date date not null,
  action text not null check (action in ('replace', 'drop', 'confirmed')),
  stored_close numeric,
  open numeric, high numeric, low numeric, close numeric, volume bigint,
  provider text, provider_symbol text,
  reason text,
  checked_at timestamptz not null default now(),
  primary key (instrument_id, date)
);
create index if not exists tas_price_repair_action on tas_price_repair (action);
alter table tas_price_repair enable row level security;
drop policy if exists tas_price_repair_read on tas_price_repair;
create policy tas_price_repair_read on tas_price_repair for select to anon, authenticated using (true);
grant select on tas_price_repair to anon, authenticated;
