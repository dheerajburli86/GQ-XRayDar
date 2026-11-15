-- IMB / ETI characteristics copied from the ETI project for GQ XRayDar (engine/eti.js).
-- yes / no / null (= not enough data); no scores, no ranks. The ETI project stays the source of truth.
--
-- Prerequisites, set up once by hand and NOT kept in git (they hold a password):
--   ETI project:     role xraydar_reader (login, read-only) with SELECT + RLS select policies on
--                    companies and company_characteristics, SELECT on company_characteristics_latest.
--   heatmap project: create extension dblink with schema extensions;
--                    a Vault secret named 'eti_src_conn' holding the libpq connection string to the ETI session
--                    pooler (host, port 5432, dbname, sslmode=require, user xraydar_reader.<eti ref>, password).
--                    (A dblink foreign server is not possible here: dblink_fdw is owned by supabase_admin.)
begin;

create table if not exists tas_eti_characteristic (
  company_id     bigint not null,
  characteristic text not null,
  framework      text not null,
  isin           text, nse_symbol text, bse_code text, company_name text,
  instrument_id  bigint,              -- heatmap instruments.id (india_stocks), matched by ISIN then NSE symbol
  as_of          date,
  meets          boolean,
  value          jsonb,
  note           text,
  method_version text,
  computed_at    timestamptz,
  synced_at      timestamptz not null default now(),
  primary key (company_id, characteristic)
);
create index if not exists tas_eti_characteristic_inst on tas_eti_characteristic(instrument_id);

-- every change of an answer after the first sight (first sight is recorded silently)
create table if not exists tas_eti_change (
  id             bigserial primary key,
  company_id     bigint not null,
  instrument_id  bigint,
  characteristic text not null,
  from_meets     boolean,
  to_meets       boolean,
  as_of          date,
  at             timestamptz not null default now(),
  unique (company_id, characteristic, as_of, to_meets)
);
create index if not exists tas_eti_change_at on tas_eti_change(at desc);

create or replace function tas_eti_sync() returns jsonb language plpgsql security definer set search_path = public, extensions, vault as $$
declare n int; ch int;
begin
  create temp table _eti on commit drop as
  select * from extensions.dblink((select decrypted_secret from vault.decrypted_secrets where name = 'eti_src_conn'), $q$
    select c.id, cc.characteristic, cc.framework, c.isin, c.nse_symbol, c.bse_code, c.name, cc.as_of, cc.meets, cc.value, cc.note, cc.method_version, cc.computed_at
      from company_characteristics_latest cc join companies c on c.id = cc.company_id
     where coalesce(c.hidden, false) = false
  $q$) as t(company_id bigint, characteristic text, framework text, isin text, nse_symbol text, bse_code text, company_name text,
          as_of date, meets boolean, value jsonb, note text, method_version text, computed_at timestamptz);
  select count(*) into n from _eti;
  if n = 0 then return jsonb_build_object('ok', false, 'reason', 'source returned no rows; kept the previous copy'); end if;

  -- instrument match: ISIN first (active row first), then the bare NSE symbol
  create temp table _map on commit drop as
  select distinct on (e.company_id) e.company_id, i.id instrument_id
    from (select distinct company_id, isin, nse_symbol from _eti) e
    join instruments i on i.universe = 'india_stocks' and (i.isin = e.isin or (e.nse_symbol is not null and i.symbol = e.nse_symbol))
   order by e.company_id, (i.isin = e.isin) desc, i.is_active desc nulls last, i.id;

  insert into tas_eti_change (company_id, instrument_id, characteristic, from_meets, to_meets, as_of)
  select e.company_id, m.instrument_id, e.characteristic, o.meets, e.meets, e.as_of
    from _eti e join tas_eti_characteristic o using (company_id, characteristic)
    left join _map m using (company_id)
   where o.meets is distinct from e.meets
  on conflict do nothing;
  get diagnostics ch = row_count;

  delete from tas_eti_characteristic;
  insert into tas_eti_characteristic (company_id, characteristic, framework, isin, nse_symbol, bse_code, company_name, instrument_id, as_of, meets, value, note, method_version, computed_at)
  select e.company_id, e.characteristic, e.framework, e.isin, e.nse_symbol, e.bse_code, e.company_name, m.instrument_id, e.as_of, e.meets, e.value, e.note, e.method_version, e.computed_at
    from _eti e left join _map m using (company_id);
  return jsonb_build_object('ok', true, 'rows', n, 'changes', ch,
    'unmatched', (select count(distinct company_id) from tas_eti_characteristic where instrument_id is null));
end $$;
revoke all on function tas_eti_sync() from public, anon, authenticated;

alter table tas_eti_characteristic enable row level security;
alter table tas_eti_change enable row level security;
drop policy if exists tas_eti_characteristic_read on tas_eti_characteristic;
create policy tas_eti_characteristic_read on tas_eti_characteristic for select to anon, authenticated using (true);
drop policy if exists tas_eti_change_read on tas_eti_change;
create policy tas_eti_change_read on tas_eti_change for select to anon, authenticated using (true);
grant select on tas_eti_characteristic, tas_eti_change to anon, authenticated;

-- hourly copy (pg_cron)
select cron.unschedule('tas-eti-sync') where exists (select 1 from cron.job where jobname = 'tas-eti-sync');
select cron.schedule('tas-eti-sync', '17 * * * *', 'select public.tas_eti_sync()');

commit;
