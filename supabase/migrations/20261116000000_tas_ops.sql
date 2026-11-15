-- GQ XRayDar: roles, API tokens, the immutable audit log and the AI output log.
-- Touches only tas_* objects. RLS on with no policies: the browser reaches these
-- only through the TA server.

alter table tas_user add column if not exists role text not null default 'analyst'; -- admin | analyst | viewer

create table if not exists tas_api_token (
  id            bigserial primary key,
  user_id       uuid not null references tas_user(id) on delete cascade,
  name          text not null,
  prefix        text not null,                  -- first characters, shown in the list
  token_hash    text not null unique,           -- sha256 of the token; the token itself is never stored
  scopes        text[] not null default array['market','deriv','indices'],
  rate_per_min  int not null default 60,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  uses          bigint not null default 0,
  revoked_at    timestamptz
);
create index if not exists tas_api_token_user on tas_api_token(user_id);

-- Append-only audit trail: data queries over the API, AI / model outputs,
-- risk-limit overrides, role changes, token changes.
create table if not exists tas_audit (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  user_id     uuid,
  actor       text not null,                    -- email, "agent", "api:<token prefix>", "system"
  category    text not null,                    -- api | ai | risk | admin | token
  action      text not null,
  detail      jsonb not null default '{}'::jsonb
);
create index if not exists tas_audit_at on tas_audit(at desc);
create index if not exists tas_audit_cat on tas_audit(category, at desc);

-- Model / AI outputs with the versions, inputs and parameters behind them.
create table if not exists tas_ai_audit (
  id             bigserial primary key,
  at             timestamptz not null default now(),
  user_id        uuid,
  kind           text not null,                 -- agent_chat | assistant | recommender | monte_carlo | coach | brief
  source         text,                          -- gq-agent | built-in | engine
  model_version  text,
  engine_version text,
  params         jsonb,
  features       jsonb,                         -- feature snapshot the output was computed from
  features_hash  text,
  output         jsonb,
  took_ms        int
);
create index if not exists tas_ai_audit_at on tas_ai_audit(at desc);

create or replace function tas_audit_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'tas audit rows are append-only';
end $$;
drop trigger if exists tas_audit_no_change on tas_audit;
create trigger tas_audit_no_change before update or delete on tas_audit for each row execute function tas_audit_immutable();
drop trigger if exists tas_ai_audit_no_change on tas_ai_audit;
create trigger tas_ai_audit_no_change before update or delete on tas_ai_audit for each row execute function tas_audit_immutable();

alter table tas_api_token enable row level security;
alter table tas_audit enable row level security;
alter table tas_ai_audit enable row level security;
