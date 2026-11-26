-- GLOCOM / LOCOM weekly band history from 2010 (Shankar Sir's backtest ask, 2026-11-26). Same shape as tas_glocom_group
-- (scope_key = 'C:<country>|industry' | ... | 'G|country'), but one column per WEEK (the last session of each week) back
-- to methodology.glocom.weeklyFrom. Each date uses only prices up to that date; the industry mapping is today's.
-- Server-only (the export goes through ta-server): RLS on, no policies.
begin;
create table if not exists tas_glocom_weekly (
  scope_key text primary key,
  data      jsonb not null,
  run_id    text references tas_calc_run(run_id) on delete set null
);
alter table tas_glocom_weekly enable row level security;
commit;
