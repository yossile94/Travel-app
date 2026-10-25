-- Sprint 2 F-004 (AC-11, AC-12): the user's profile. Only a display name on
-- the server (Yossi, 2026-10-25): the name as in the passport stays on the
-- device with the passport (spec 6), and the language follows the device.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null
    constraint profiles_display_name_check
    check (
      display_name = btrim(display_name)
      and display_name !~ '^\s|\s$'
      and char_length(display_name) between 1 and 60
    ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'One row per user: the display name shown in the account area (sprint 2 AC-12). Deleted with the user.';

alter table public.profiles enable row level security;

create policy "users read their own profile"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()));

-- The app creates a missing profile itself (upsert, AC-12), only for itself.
create policy "users create their own profile"
  on public.profiles for insert
  to authenticated
  with check (id = (select auth.uid()));

create policy "users rename themselves"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Users write only the name; the server keeps the times. UPDATE on id is
-- granted because supabase-js's upsert sets every sent column on conflict
-- ("id" = EXCLUDED."id", checked when the statement is planned); WITH CHECK
-- and the foreign key keep it the user's own id.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant insert (id, display_name), update (id, display_name) on public.profiles to authenticated;

-- A display name from Google (or the part of the email before the @), tidied
-- to fit the check: whitespace collapsed, trimmed, at most 60 characters.
create function public.profile_name_from(meta jsonb, email text)
  returns text
  language sql
  immutable
  set search_path = ''
as $$
  select coalesce(
    nullif(btrim(left(btrim(regexp_replace(coalesce(meta ->> 'full_name', meta ->> 'name', ''), '\s+', ' ', 'g')), 60)), ''),
    nullif(btrim(left(btrim(regexp_replace(split_part(coalesce(email, ''), '@', 1), '\s+', ' ', 'g')), 60)), '')
  );
$$;

revoke execute on function public.profile_name_from(jsonb, text) from public, anon, authenticated;

-- Creates the profile with the user. It must never break a sign-up: a
-- failure only logs a warning, and the app creates the profile later (AC-12).
create function public.profiles_after_user_insert()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  name text;
begin
  begin
    name := public.profile_name_from(new.raw_user_meta_data, new.email);
    if name is not null then
      insert into public.profiles (id, display_name) values (new.id, name)
      on conflict (id) do nothing;
    end if;
  exception when others then
    raise warning 'profile for % not created: %', new.id, sqlstate;
  end;
  return new;
end;
$$;

revoke execute on function public.profiles_after_user_insert() from public, anon, authenticated;

create trigger profiles_after_user_insert
  after insert on auth.users
  for each row execute function public.profiles_after_user_insert();

create function public.profiles_before_update()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.profiles_before_update() from public, anon, authenticated;

create trigger profiles_before_update
  before update on public.profiles
  for each row execute function public.profiles_before_update();

-- Users who signed in during sprint 1 get a profile now.
insert into public.profiles (id, display_name)
select u.id, public.profile_name_from(u.raw_user_meta_data, u.email)
from auth.users u
where public.profile_name_from(u.raw_user_meta_data, u.email) is not null
on conflict (id) do nothing;
