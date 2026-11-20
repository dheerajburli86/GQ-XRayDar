-- Third classification layer for US stocks and US-listed ADRs (owner's workbook). tas_* only.
alter table tas_security add column if not exists sub_industry text;
comment on column tas_security.sub_industry is 'Sub-industry from the owner''s US classification workbook; null where the symbol is not in it.';
