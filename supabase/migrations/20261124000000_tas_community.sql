-- Accounts for everyone, per-person agent access, sharing levels, community rooms / boards and chat.
-- (owner + Shankar Sir, 2026-11-24)
--
-- Every table here is SERVER-ONLY, like tas_user_doc: RLS on, NO policies, so the anon and authenticated keys
-- read and write nothing; the TA server (database connection) checks the login and the membership first.
-- Nothing in this file touches a heatmap-owned table. auth.users is touched only through the two SECURITY
-- DEFINER functions below, which the browser cannot call (execute is revoked from anon / authenticated).

begin;

-- ---------------------------------------------------------------- accounts
-- Who may use the agent and which sources it may read: decided per person by an admin. Off by default.
alter table tas_user add column if not exists agent_access jsonb not null default '{"enabled": false, "sources": []}'::jsonb;
alter table tas_user add column if not exists created_via text;           -- 'signup' | 'login'
alter table tas_user add column if not exists display_name text;          -- shown to other people (never the email)

-- Creates a confirmed email + password account in the SAME shape GoTrue writes, so the browser can sign in with
-- supabase.auth.signInWithPassword at once. No confirmation email: Supabase's built-in mailer only reaches the
-- project's own team, which would lock every outside user out.
create or replace function public.tas_create_account(p_email text, p_password text, p_name text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, auth
as $$
declare
  v_id uuid := gen_random_uuid();
  v_email text := lower(trim(p_email));
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid email' using errcode = '22023'; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'password too short' using errcode = '22023'; end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then raise exception 'account exists' using errcode = '23505'; end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
          crypt(p_password, gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb,
          jsonb_build_object('name', p_name, 'full_name', p_name), now(), now(), '', '', '', '');
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (v_id::text, v_id,
          jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
          'email', now(), now(), now());
  return v_id;
end;
$$;

-- An admin sets a temporary password (there is no outgoing email for "forgot password" yet).
create or replace function public.tas_set_password(p_user uuid, p_password text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, auth
as $$
begin
  if length(coalesce(p_password, '')) < 8 then raise exception 'password too short' using errcode = '22023'; end if;
  update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now() where id = p_user;
  return found;
end;
$$;

revoke all on function public.tas_create_account(text, text, text) from public, anon, authenticated;
revoke all on function public.tas_set_password(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- sharing levels
-- A share points at one item a person keeps in their workspace (a watchlist, a saved screen, a formula, ...).
-- payload is the item itself, refreshed by the server whenever the owner saves that document, so people it is
-- shared with always see the current version.
create table if not exists tas_share (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references tas_user(id) on delete cascade,
  kind         text not null,
  source_key   text not null,
  source_item  text not null,
  title        text not null,
  payload      jsonb not null,
  visibility   text not null check (visibility in ('private', 'people', 'everyone')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (owner_id, source_key, source_item)
);
create index if not exists tas_share_vis on tas_share (visibility, updated_at desc);

create table if not exists tas_share_member (
  share_id  uuid not null references tas_share(id) on delete cascade,
  user_id   uuid not null references tas_user(id) on delete cascade,
  primary key (share_id, user_id)
);
create index if not exists tas_share_member_user on tas_share_member (user_id);

-- ---------------------------------------------------------------- rooms, boards and chats
--   room   a chat room;        board  a message board (threads with replies)
--   group  a private group chat; dm   a conversation between two people (dm_key = the two ids, sorted)
create table if not exists tas_room (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('room', 'board', 'group', 'dm')),
  name         text,
  description  text,
  visibility   text not null default 'private' check (visibility in ('public', 'private')),
  dm_key       text unique,
  created_by   uuid references tas_user(id) on delete set null,
  created_at   timestamptz not null default now(),
  last_msg_at  timestamptz not null default now()
);
create index if not exists tas_room_public on tas_room (visibility, kind, last_msg_at desc);

create table if not exists tas_room_member (
  room_id       uuid not null references tas_room(id) on delete cascade,
  user_id       uuid not null references tas_user(id) on delete cascade,
  role          text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at     timestamptz not null default now(),
  last_read_id  bigint not null default 0,
  primary key (room_id, user_id)
);
create index if not exists tas_room_member_user on tas_room_member (user_id);

create table if not exists tas_message (
  id           bigserial primary key,
  room_id      uuid not null references tas_room(id) on delete cascade,
  user_id      uuid references tas_user(id) on delete set null,
  parent_id    bigint references tas_message(id) on delete cascade,   -- a reply in a board thread
  title        text,                                                  -- a board thread's title
  body         text not null default '',
  attachments  jsonb not null default '[]'::jsonb,                    -- [{type: chart|share|file|link, ...}]
  created_at   timestamptz not null default now(),
  edited_at    timestamptz,
  deleted_at   timestamptz
);
create index if not exists tas_message_room on tas_message (room_id, id);
create index if not exists tas_message_parent on tas_message (parent_id) where parent_id is not null;

-- Files shared in chats (documents, chart pictures). Kept in the database, 10 MB each, read only through the
-- server after a membership check.
create table if not exists tas_file (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid references tas_user(id) on delete set null,
  room_id     uuid references tas_room(id) on delete cascade,
  name        text not null,
  mime        text not null,
  size        integer not null check (size > 0 and size <= 10485760),
  data        bytea not null,
  created_at  timestamptz not null default now()
);
create index if not exists tas_file_room on tas_file (room_id);

alter table tas_share enable row level security;
alter table tas_share_member enable row level security;
alter table tas_room enable row level security;
alter table tas_room_member enable row level security;
alter table tas_message enable row level security;
alter table tas_file enable row level security;

commit;
