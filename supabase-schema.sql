-- Familiebudsjett – household sync (FREE Supabase tier)
-- Run once in Supabase → SQL Editor.
--
-- Auth model: username + password (no e-mail / magic link).
-- App maps username → {username}@familie-local.invalid for GoTrue.
-- REQUIRED (dashboard, free): Authentication → Providers → Email
--   → turn OFF "Confirm email" (otherwise signup has no session).
-- Site URL / redirect (optional): https://mathiashav123.github.io/familie-budsjett/

create extension if not exists "pgcrypto";

-- ——— Profiles (username directory) ———
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  created_at timestamptz not null default now(),
  constraint profiles_username_format check (
    username ~ '^[a-z0-9][a-z0-9._-]{2,31}$'
  )
);

create index if not exists profiles_username_idx on public.profiles (username);

-- ——— Households ———
create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Familie',
  invite_code text not null unique,
  updated_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create table if not exists public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create index if not exists households_invite_code_idx on public.households (invite_code);
create index if not exists household_members_user_id_idx on public.household_members (user_id);

-- ——— RLS ———
alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_upsert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "members_select_household" on public.households;
drop policy if exists "members_update_household" on public.households;
drop policy if exists "members_select_own" on public.household_members;

create policy "profiles_select_own"
  on public.profiles for select to authenticated
  using (user_id = auth.uid());

create policy "profiles_upsert_own"
  on public.profiles for insert to authenticated
  with check (user_id = auth.uid());

create policy "profiles_update_own"
  on public.profiles for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "members_select_household"
  on public.households for select to authenticated
  using (
    exists (
      select 1 from public.household_members m
      where m.household_id = households.id and m.user_id = auth.uid()
    )
  );

create policy "members_update_household"
  on public.households for update to authenticated
  using (
    exists (
      select 1 from public.household_members m
      where m.household_id = households.id and m.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.household_members m
      where m.household_id = households.id and m.user_id = auth.uid()
    )
  );

create policy "members_select_own"
  on public.household_members for select to authenticated
  using (user_id = auth.uid());

-- ——— Invite code helper ———
create or replace function public._familie_invite_code()
returns text
language plpgsql
as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  out text := '';
  i int;
begin
  for i in 1..8 loop
    out := out || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return out;
end;
$$;

-- Create household + owner; upload initial local payload (PC → sky)
create or replace function public.create_household(p_name text default 'Familie', p_payload jsonb default '{}'::jsonb)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  code text;
  h public.households;
  tries int := 0;
begin
  if uid is null then
    raise exception 'Ikke innlogget';
  end if;

  select hh.* into h
  from public.households hh
  join public.household_members m on m.household_id = hh.id
  where m.user_id = uid
  limit 1;
  if found then
    return json_build_object(
      'id', h.id,
      'name', h.name,
      'invite_code', h.invite_code,
      'updated_at', h.updated_at,
      'payload', h.payload,
      'existing', true
    );
  end if;

  loop
    tries := tries + 1;
    code := public._familie_invite_code();
    begin
      insert into public.households (name, invite_code, payload, updated_at)
      values (coalesce(nullif(trim(p_name), ''), 'Familie'), code, coalesce(p_payload, '{}'::jsonb), now())
      returning * into h;
      exit;
    exception when unique_violation then
      if tries > 8 then raise; end if;
    end;
  end loop;

  insert into public.household_members (household_id, user_id, role)
  values (h.id, uid, 'owner');

  return json_build_object(
    'id', h.id,
    'name', h.name,
    'invite_code', h.invite_code,
    'updated_at', h.updated_at,
    'payload', h.payload,
    'existing', false
  );
end;
$$;

-- Second device / partner: join with invite code → same payload
create or replace function public.join_household_by_code(p_code text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  code text := upper(trim(coalesce(p_code, '')));
  h public.households;
begin
  if uid is null then
    raise exception 'Ikke innlogget';
  end if;
  if length(code) < 4 then
    raise exception 'Ugyldig invitasjonskode';
  end if;

  select * into h from public.households where invite_code = code;
  if not found then
    raise exception 'Fant ingen husstand med den koden';
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (h.id, uid, 'member')
  on conflict (household_id, user_id) do nothing;

  return json_build_object(
    'id', h.id,
    'name', h.name,
    'invite_code', h.invite_code,
    'updated_at', h.updated_at,
    'payload', h.payload,
    'existing', true
  );
end;
$$;

revoke all on function public.create_household(text, jsonb) from public;
revoke all on function public.join_household_by_code(text) from public;
grant execute on function public.create_household(text, jsonb) to authenticated;
grant execute on function public.join_household_by_code(text) to authenticated;

grant select, insert, update on table public.profiles to authenticated;
grant select, update on table public.households to authenticated;
grant select on table public.household_members to authenticated;

notify pgrst, 'reload schema';
