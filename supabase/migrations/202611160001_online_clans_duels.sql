-- Apply in Supabase SQL Editor before enabling public clan pages.
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (char_length(username) between 2 and 24),
  gd_name text not null default '' check (char_length(gd_name) <= 32),
  total_points bigint not null default 0 check (total_points >= 0),
  total_correct bigint not null default 0 check (total_correct >= 0),
  completed_sessions integer not null default 0 check (completed_sessions >= 0),
  best_streak integer not null default 0 check (best_streak between 0 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.clans (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 32),
  tag text not null unique check (char_length(tag) between 2 and 6),
  owner_id uuid not null references public.profiles(user_id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.clan_members (
  clan_id uuid not null references public.clans(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  role text not null default 'member' check (role in ('leader','member')),
  joined_at timestamptz not null default now(),
  primary key (clan_id, user_id),
  unique (user_id)
);

create table if not exists public.clan_invites (
  code text primary key,
  clan_id uuid not null references public.clans(id) on delete cascade,
  created_by uuid not null references public.profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days'
);

create table if not exists public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  points integer not null check (points between 0 and 2500),
  correct integer not null check (correct between 0 and 5),
  best_streak integer not null check (best_streak between 0 and 5),
  created_at timestamptz not null default now()
);

create table if not exists public.duel_results (
  id uuid primary key default gen_random_uuid(),
  seed text not null check (seed ~ '^[A-Z0-9]{6,20}$'),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  points integer not null check (points between 0 and 2500),
  correct integer not null check (correct between 0 and 5),
  created_at timestamptz not null default now(),
  unique (seed, user_id)
);

create unique index if not exists profiles_username_lower_uidx on public.profiles (lower(username));
create index if not exists clan_members_clan_id_idx on public.clan_members(clan_id);
create index if not exists game_sessions_user_created_idx on public.game_sessions(user_id, created_at desc);
create index if not exists duel_results_seed_idx on public.duel_results(seed, points desc);

alter table public.profiles enable row level security;
alter table public.clans enable row level security;
alter table public.clan_members enable row level security;
alter table public.clan_invites enable row level security;
alter table public.game_sessions enable row level security;
alter table public.duel_results enable row level security;

revoke all on public.profiles, public.clans, public.clan_members, public.clan_invites, public.game_sessions, public.duel_results from anon, authenticated;
grant select on public.profiles, public.clans, public.clan_members, public.duel_results to anon, authenticated;
grant update(username, gd_name) on public.profiles to authenticated;

create policy "Public profiles are readable" on public.profiles for select to anon, authenticated using (true);
create policy "Users create own profile" on public.profiles for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update own profile" on public.profiles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "Clans are publicly readable" on public.clans for select to anon, authenticated using (true);
create policy "Clan rosters are publicly readable" on public.clan_members for select to anon, authenticated using (true);
create policy "Duel results are publicly readable" on public.duel_results for select to anon, authenticated using (true);

create or replace function public.create_profile_for_new_user()
returns trigger language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare chosen_name text;
begin
  chosen_name := left(trim(coalesce(new.raw_user_meta_data->>'username', split_part(coalesce(new.email, 'player'), '@', 1))), 24);
  if char_length(chosen_name) < 2 then chosen_name := 'player_' || left(new.id::text, 6); end if;
  if exists (select 1 from public.profiles where lower(username) = lower(chosen_name)) then
    chosen_name := left(chosen_name, 17) || '_' || left(new.id::text, 6);
  end if;
  insert into public.profiles(user_id, username, gd_name)
  values (new.id, chosen_name, left(coalesce(new.raw_user_meta_data->>'gd_name', ''), 32))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile after insert on auth.users
for each row execute procedure public.create_profile_for_new_user();

create or replace function public.create_clan(p_name text, p_tag text)
returns uuid language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare new_clan_id uuid; normalized_tag text;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if exists (select 1 from public.clan_members where user_id = auth.uid()) then raise exception 'Leave your current clan first'; end if;
  normalized_tag := upper(regexp_replace(trim(p_tag), '[^[:alnum:]]', '', 'g'));
  insert into public.clans(name, tag, owner_id) values (trim(p_name), normalized_tag, auth.uid()) returning id into new_clan_id;
  insert into public.clan_members(clan_id, user_id, role) values (new_clan_id, auth.uid(), 'leader');
  return new_clan_id;
end;
$$;

create or replace function public.create_clan_invite(p_clan_id uuid)
returns text language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare invite_code text;
begin
  if not exists (select 1 from public.clan_members where clan_id = p_clan_id and user_id = auth.uid() and role = 'leader') then
    raise exception 'Clan leader required';
  end if;
  invite_code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 32);
  insert into public.clan_invites(code, clan_id, created_by) values (invite_code, p_clan_id, auth.uid());
  return invite_code;
end;
$$;

create or replace function public.join_clan_by_invite(p_code text)
returns uuid language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare target_clan uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if exists (select 1 from public.clan_members where user_id = auth.uid()) then raise exception 'Leave your current clan first'; end if;
  select clan_id into target_clan from public.clan_invites where code = p_code and expires_at > now();
  if target_clan is null then raise exception 'Invite code is invalid or expired'; end if;
  insert into public.clan_members(clan_id, user_id, role) values (target_clan, auth.uid(), 'member');
  return target_clan;
end;
$$;

create or replace function public.leave_clan(p_clan_id uuid)
returns void language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare leaving_role text; next_leader uuid;
begin
  select role into leaving_role from public.clan_members where clan_id = p_clan_id and user_id = auth.uid();
  if leaving_role is null then raise exception 'Not a clan member'; end if;
  if leaving_role = 'leader' then
    select user_id into next_leader from public.clan_members where clan_id = p_clan_id and user_id <> auth.uid() order by joined_at limit 1;
    if next_leader is null then delete from public.clans where id = p_clan_id;
    else
      update public.clan_members set role = 'leader' where clan_id = p_clan_id and user_id = next_leader;
      update public.clans set owner_id = next_leader where id = p_clan_id;
      delete from public.clan_members where clan_id = p_clan_id and user_id = auth.uid();
    end if;
  else delete from public.clan_members where clan_id = p_clan_id and user_id = auth.uid();
  end if;
end;
$$;

create or replace function public.submit_game_session(p_points integer, p_correct integer, p_best_streak integer)
returns void language plpgsql security definer set search_path = public, auth, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if p_points not between 0 and 2500 or p_correct not between 0 and 5 or p_best_streak not between 0 and 5 then raise exception 'Invalid session result'; end if;
  insert into public.game_sessions(user_id, points, correct, best_streak) values (auth.uid(), p_points, p_correct, p_best_streak);
  update public.profiles set total_points = total_points + p_points,
    total_correct = total_correct + p_correct,
    completed_sessions = completed_sessions + 1,
    best_streak = greatest(best_streak, p_best_streak), updated_at = now()
  where user_id = auth.uid();
end;
$$;

create or replace function public.submit_duel_result(p_seed text, p_points integer, p_correct integer)
returns void language plpgsql security definer set search_path = public, auth, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if p_points not between 0 and 2500 or p_correct not between 0 and 5 then raise exception 'Invalid duel result'; end if;
  insert into public.duel_results(seed, user_id, points, correct) values (upper(p_seed), auth.uid(), p_points, p_correct)
  on conflict (seed, user_id) do update set points = excluded.points, correct = excluded.correct, created_at = now();
end;
$$;

revoke all on function public.create_profile_for_new_user() from public, anon, authenticated;

create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare owned record; next_leader uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  for owned in select id from public.clans where owner_id = auth.uid() loop
    select user_id into next_leader from public.clan_members where clan_id = owned.id and user_id <> auth.uid() order by joined_at limit 1;
    if next_leader is null then delete from public.clans where id = owned.id;
    else
      update public.clan_members set role = 'leader' where clan_id = owned.id and user_id = next_leader;
      update public.clans set owner_id = next_leader where id = owned.id;
    end if;
  end loop;
  delete from auth.users where id = auth.uid();
end;
$$;

create or replace view public.clan_leaderboard with (security_invoker = true) as
with totals as (
  select c.id, c.name, c.tag, c.created_at,
    count(m.user_id)::integer as member_count,
    coalesce(sum(p.total_points), 0)::bigint as total_points,
    coalesce(sum(p.total_correct), 0)::bigint as total_correct
  from public.clans c
  left join public.clan_members m on m.clan_id = c.id
  left join public.profiles p on p.user_id = m.user_id
  group by c.id, c.name, c.tag, c.created_at
)
select row_number() over (order by total_points desc, created_at asc)::bigint as world_rank,
  id, name, tag, member_count, total_points, total_correct, created_at
from totals;

create or replace view public.player_leaderboard with (security_invoker = true) as
select row_number() over (order by total_points desc, created_at asc)::bigint as world_rank,
  user_id, username, gd_name, total_points, total_correct, completed_sessions, best_streak
from public.profiles;

grant select on public.clan_leaderboard, public.player_leaderboard to anon, authenticated;
grant execute on function public.create_clan(text,text), public.create_clan_invite(uuid), public.join_clan_by_invite(text), public.leave_clan(uuid), public.submit_game_session(integer,integer,integer), public.submit_duel_result(text,integer,integer), public.delete_my_account() to authenticated;
revoke all on function public.create_clan(text,text), public.create_clan_invite(uuid), public.join_clan_by_invite(text), public.leave_clan(uuid), public.submit_game_session(integer,integer,integer), public.submit_duel_result(text,integer,integer), public.delete_my_account() from public, anon;
