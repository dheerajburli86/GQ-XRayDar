-- Index sets from the owner's workbook New_Index_Creation.xlsx (item 21): one row per set with the member-by-member
-- resolution, so the app can show what is in each set and what could not be found. The series themselves are rows of
-- tas_extra_series (symbol GQSET:<code>). Written by cli/indexSetsJob.mjs; tas_* objects only.
create table if not exists tas_index_set (
  symbol      text primary key,           -- GQSET:<code>
  code        text not null,
  sheet       text not null,              -- exchange | etf
  label       text not null,
  members     jsonb not null,             -- [{raw, code, kind, status, symbol, bars, first, last}]
  n_members   int not null,
  n_resolved  int not null,
  start_date  date,
  last_date   date,
  method      text,
  updated_at  timestamptz default now()
);
alter table tas_index_set enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'tas_index_set' and policyname = 'tas_index_set_read') then
    create policy tas_index_set_read on tas_index_set for select to anon, authenticated using (true);
  end if;
end $$;
