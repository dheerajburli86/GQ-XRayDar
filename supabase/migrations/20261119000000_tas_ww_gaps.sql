-- Weight Watcher: observation dates left empty because a country in the parent had too few
-- stocks with prices on that date (thin early history). [{date, countries:[...]}]
alter table if exists tas_ww add column if not exists gaps jsonb;
