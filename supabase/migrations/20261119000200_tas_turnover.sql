-- Traded value ranking for stocks without a reliable market cap (India). tas_* only.
alter table tas_security add column if not exists turnover_usd double precision;
comment on column tas_security.turnover_usd is 'Median daily close x volume in USD over the last 60 sessions with volume. A liquidity measure, not a market cap.';
