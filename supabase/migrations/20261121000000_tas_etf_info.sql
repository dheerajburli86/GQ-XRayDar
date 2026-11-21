-- ETF details for the stock page (owner, Nov 2026): asset class (Equity / Fixed Income / Commodity /
-- Currency / Real Estate / Alternative ...), AUM, expense ratio, issuer, top holdings, sector and
-- country weights. Filled by cli/etfInfoJob.mjs (run by the TA server) from FMP's ETF endpoints;
-- India ETFs fall back to the heatmap's etf_weights basket. Writes only this table.
create table if not exists tas_etf_info (
  symbol        text primary key,          -- the instrument symbol as stored (heatmap)
  provider_symbol text,                    -- the symbol asked of FMP (e.g. NIFTYBEES.NS)
  universe      text,
  asset_class   text,                      -- as reported by the provider; null if unknown
  info          jsonb,                     -- name, issuer, AUM, expense ratio, inception, holdings count, description, NAV
  holdings      jsonb,                     -- [{symbol, name, weight}] top 25 by weight
  sectors       jsonb,                     -- [{sector, weight}]
  countries     jsonb,                     -- [{country, weight}]
  source        text,
  status        text,                      -- ok | no_data | error
  updated_at    timestamptz default now()
);
alter table tas_etf_info enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'tas_etf_info' and policyname = 'tas_etf_info_read') then
    create policy tas_etf_info_read on tas_etf_info for select to anon, authenticated using (true);
  end if;
end $$;
