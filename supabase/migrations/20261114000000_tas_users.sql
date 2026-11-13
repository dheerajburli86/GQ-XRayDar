-- Per-user state for the GQ Technical Analysis server: profiles and Telegram
-- links, user documents (watchlists, alert rules, notes, layouts, paper
-- portfolio), alert events, tasks, web-push subscriptions and digest logs.
--
-- Only the TA server touches these tables (database connection string, RLS
-- bypassed). RLS is ON with NO policies, so the anon and authenticated keys can
-- read or write nothing here: every user request goes through the server, which
-- checks the Supabase login and the @gquants.com allow-list first.
-- Nothing in this file touches a heatmap-owned table.

begin;

create table if not exists tas_user (
  id                uuid primary key,          -- auth.users.id
  email             text not null,
  name              text,
  telegram_user_id  text unique,
  telegram_chat_id  text,
  telegram_name     text,
  settings          jsonb not null default '{}'::jsonb,   -- {morningSummary, weeklySummary, alertsPaused, push}
  created_at        timestamptz not null default now(),
  last_seen_at      timestamptz
);

create table if not exists tas_link_code (
  code        text primary key,
  user_id     uuid not null references tas_user(id) on delete cascade,
  expires_at  timestamptz not null
);

create table if not exists tas_user_doc (
  user_id     uuid not null references tas_user(id) on delete cascade,
  key         text not null,                   -- watchlists, alerts.rules, notes, screens, layout.*, workspaces, paper, settings
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  primary key (user_id, key)
);

create table if not exists tas_alert_event (
  id            bigserial primary key,
  user_id       uuid not null references tas_user(id) on delete cascade,
  rule_id       text not null,
  instrument_id text not null default '',
  bar_key       text not null,
  fired_at      timestamptz not null default now(),
  payload       jsonb not null,
  delivered     jsonb not null default '{}'::jsonb,  -- {telegram: ts | error, push: ts | error}
  unique (user_id, rule_id, instrument_id, bar_key)
);
create index if not exists tas_alert_event_user on tas_alert_event(user_id, fired_at desc);

create table if not exists tas_task (
  id          bigserial primary key,
  user_id     uuid not null references tas_user(id) on delete cascade,
  title       text not null,
  kind        text not null,                   -- review_list | screen | summary | compare | analyze
  params      jsonb not null default '{}'::jsonb,
  schedule    text,                            -- null = run once; "daily 08:30", "weekdays 09:15", "weekly mon 08:00" (IST)
  status      text not null default 'pending', -- pending | running | done | failed | paused
  progress    int not null default 0,
  result      jsonb,
  error       text,
  source      text not null default 'web',     -- web | telegram | agent
  next_run    timestamptz not null default now(),
  last_run    timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists tas_task_due on tas_task(status, next_run);

create table if not exists tas_push_sub (
  id          bigserial primary key,
  user_id     uuid not null references tas_user(id) on delete cascade,
  endpoint    text not null unique,
  keys        jsonb not null,
  created_at  timestamptz not null default now()
);

create table if not exists tas_digest_log (
  user_id     uuid not null references tas_user(id) on delete cascade,
  kind        text not null,                   -- morning | weekly
  period_key  text not null,
  sent_at     timestamptz not null default now(),
  primary key (user_id, kind, period_key)
);

do $$
declare t text;
begin
  foreach t in array array['tas_user','tas_link_code','tas_user_doc','tas_alert_event','tas_task','tas_push_sub','tas_digest_log']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);
  end loop;
end $$;

commit;
