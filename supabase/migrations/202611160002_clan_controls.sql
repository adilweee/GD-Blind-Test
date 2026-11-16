alter table public.clans
  add column if not exists join_policy text not null default 'invite',
  add column if not exists member_limit integer not null default 50;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'clans_join_policy_check' and conrelid = 'public.clans'::regclass) then
    alter table public.clans add constraint clans_join_policy_check check (join_policy in ('invite','open'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'clans_member_limit_check' and conrelid = 'public.clans'::regclass) then
    alter table public.clans add constraint clans_member_limit_check check (member_limit between 2 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'clan_members_role_check' and conrelid = 'public.clan_members'::regclass) then
    alter table public.clan_members add constraint clan_members_role_check check (role in ('leader','co_owner','member'));
  end if;
end $$;

alter table public.clan_members drop constraint if exists clan_members_role_check;
alter table public.clan_members add constraint clan_members_role_check check (role in ('leader','co_owner','member'));

create or replace function public.create_clan_invite(p_clan_id uuid)
returns text language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare invite_code text;
begin
  if not exists (select 1 from public.clan_members where clan_id = p_clan_id and user_id = auth.uid() and role in ('leader','co_owner')) then
    raise exception 'Clan leader or co-owner required';
  end if;
  invite_code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 32);
  insert into public.clan_invites(code, clan_id, created_by) values (invite_code, p_clan_id, auth.uid());
  return invite_code;
end;
$$;

create or replace function public.join_clan_by_invite(p_code text)
returns uuid language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare target_clan uuid; max_members integer; current_members integer;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if exists (select 1 from public.clan_members where user_id = auth.uid()) then raise exception 'Leave your current clan first'; end if;
  select c.id, c.member_limit into target_clan, max_members
  from public.clan_invites i join public.clans c on c.id = i.clan_id
  where i.code = p_code and i.expires_at > now() for update of c;
  if target_clan is null then raise exception 'Invite code is invalid or expired'; end if;
  select count(*) into current_members from public.clan_members where clan_id = target_clan;
  if current_members >= max_members then raise exception 'Clan is full'; end if;
  insert into public.clan_members(clan_id, user_id, role) values (target_clan, auth.uid(), 'member');
  return target_clan;
end;
$$;

create or replace function public.join_open_clan(p_clan_id uuid)
returns uuid language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare max_members integer; current_members integer;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if exists (select 1 from public.clan_members where user_id = auth.uid()) then raise exception 'Leave your current clan first'; end if;
  select member_limit into max_members from public.clans where id = p_clan_id and join_policy = 'open' for update;
  if max_members is null then raise exception 'Clan is not open for joining'; end if;
  select count(*) into current_members from public.clan_members where clan_id = p_clan_id;
  if current_members >= max_members then raise exception 'Clan is full'; end if;
  insert into public.clan_members(clan_id, user_id, role) values (p_clan_id, auth.uid(), 'member');
  return p_clan_id;
end;
$$;

create or replace function public.update_clan_settings(p_clan_id uuid, p_join_policy text, p_member_limit integer)
returns void language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare current_members integer;
begin
  if not exists (select 1 from public.clan_members where clan_id = p_clan_id and user_id = auth.uid() and role in ('leader','co_owner')) then
    raise exception 'Clan leader or co-owner required';
  end if;
  if p_join_policy not in ('invite','open') or p_member_limit not between 2 and 100 then raise exception 'Invalid clan settings'; end if;
  select count(*) into current_members from public.clan_members where clan_id = p_clan_id;
  if p_member_limit < current_members then raise exception 'Capacity cannot be lower than current member count'; end if;
  update public.clans set join_policy = p_join_policy, member_limit = p_member_limit where id = p_clan_id;
end;
$$;

create or replace function public.set_clan_member_role(p_clan_id uuid, p_member_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare target_role text;
begin
  if not exists (select 1 from public.clan_members where clan_id = p_clan_id and user_id = auth.uid() and role = 'leader') then raise exception 'Clan leader required'; end if;
  if p_member_id = auth.uid() then raise exception 'You cannot change your own role'; end if;
  if p_role not in ('co_owner','member') then raise exception 'Invalid role'; end if;
  select role into target_role from public.clan_members where clan_id = p_clan_id and user_id = p_member_id for update;
  if target_role is null or target_role = 'leader' then raise exception 'Member not found'; end if;
  update public.clan_members set role = p_role where clan_id = p_clan_id and user_id = p_member_id;
end;
$$;

create or replace function public.remove_clan_member(p_clan_id uuid, p_member_id uuid)
returns void language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare caller_role text; target_role text;
begin
  select role into caller_role from public.clan_members where clan_id = p_clan_id and user_id = auth.uid();
  select role into target_role from public.clan_members where clan_id = p_clan_id and user_id = p_member_id for update;
  if caller_role is null or caller_role not in ('leader','co_owner') or target_role is null or p_member_id = auth.uid() or target_role = 'leader' then raise exception 'Member cannot be removed'; end if;
  if caller_role = 'co_owner' and target_role <> 'member' then raise exception 'Co-owners can only remove regular members'; end if;
  delete from public.clan_members where clan_id = p_clan_id and user_id = p_member_id;
end;
$$;

create or replace view public.clan_leaderboard with (security_invoker = true) as
with totals as (
  select c.id, c.name, c.tag, c.created_at, c.join_policy, c.member_limit,
    count(m.user_id)::integer as member_count,
    coalesce(sum(p.total_points), 0)::bigint as total_points,
    coalesce(sum(p.total_correct), 0)::bigint as total_correct
  from public.clans c
  left join public.clan_members m on m.clan_id = c.id
  left join public.profiles p on p.user_id = m.user_id
  group by c.id, c.name, c.tag, c.created_at, c.join_policy, c.member_limit
)
select row_number() over (order by total_points desc, created_at asc)::bigint as world_rank,
  id, name, tag, member_count, total_points, total_correct, created_at, join_policy, member_limit
from totals;

grant execute on function public.create_clan_invite(uuid), public.join_clan_by_invite(text), public.join_open_clan(uuid), public.update_clan_settings(uuid,text,integer), public.set_clan_member_role(uuid,uuid,text), public.remove_clan_member(uuid,uuid) to authenticated;
revoke all on function public.create_clan_invite(uuid), public.join_clan_by_invite(text), public.join_open_clan(uuid), public.update_clan_settings(uuid,text,integer), public.set_clan_member_role(uuid,uuid,text), public.remove_clan_member(uuid,uuid) from public, anon;


