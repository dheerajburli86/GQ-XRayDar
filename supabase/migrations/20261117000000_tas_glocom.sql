-- GLOCOM / LOCOM group rank history (engine/glocom.js). One row per scope and level:
-- scope_key = 'C:<country>|industry' | 'C:<country>|sector' | 'G|industry' | 'G|sector',
-- data = { dates, of, groups: { name: { rank, code, label, score, n, w, m6, y, pW, p6m, p1y } } }
-- (arrays over the last methodology.glocom.historySessions sessions). Written by the batch engine only.
begin;
create table if not exists tas_glocom_group (
  scope_key text primary key,
  data      jsonb not null,
  run_id    text references tas_calc_run(run_id) on delete set null
);
alter table tas_glocom_group enable row level security;
drop policy if exists tas_glocom_group_read on tas_glocom_group;
create policy tas_glocom_group_read on tas_glocom_group for select to anon, authenticated using (true);
grant select on tas_glocom_group to anon, authenticated;
commit;
