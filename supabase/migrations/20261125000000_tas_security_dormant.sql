-- India stocks the heatmap marks "no trade in the last 5 sessions": analysed and shown with a flag, kept out of indices.
alter table tas_security add column if not exists dormant boolean not null default false;
comment on column tas_security.dormant is 'Heatmap marker NO_RECENT_TRADES: no trade in the last 5 sessions. Shown with a flag; not in indices, breadth or back-tests.';
