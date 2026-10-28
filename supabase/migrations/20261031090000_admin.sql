-- Sprint 10 F-027, F-028 (ADR-015): the admin panel's roles, its audit log,
-- and what the content editors may write.
--   admin_roles: who holds which role. Read by has_role() on every request,
--     with AAL2 (MFA), so a removed role stops at once (no token claim).
--   admin_audit_log: every change made by a signed-in person to the edited
--     tables, written by a trigger only; never updated or deleted.
--   country_advisories: editors write only entry_* and passport_validity_months.
--   min_connection_times: editors insert and update.
-- Neither table has a delete for anyone but migrations, on purpose (Raz,
-- design approval: no MCT row deletion). The log keeps no one's email after
-- their account is deleted (Dudi 7; ADR-015).

-- ------------------------------------------------------------------ roles
create table public.admin_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null constraint admin_roles_role_check
    check (role in ('admin', 'content_editor', 'support', 'moderator')),
  granted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);
create index admin_roles_granted_by on public.admin_roles (granted_by);

comment on table public.admin_roles is
  'Admin panel roles (sprint 10 F-027). Written by admin_grant_role / admin_revoke_role only.';

alter table public.admin_roles enable row level security;
revoke all on public.admin_roles from anon, authenticated;

-- True when the caller holds the role (or admin) and signed in with MFA.
create function public.has_role(p_role text)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal') = 'aal2', false)
    and exists (
      select 1 from public.admin_roles r
      where r.user_id = (select auth.uid()) and r.role in (p_role, 'admin')
    );
$$;
revoke execute on function public.has_role(text) from public, anon;
grant execute on function public.has_role(text) to authenticated;

-- The caller's own roles, for the panel's screens. Empty without AAL2.
create function public.my_roles()
  returns text[]
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select case when coalesce((select auth.jwt() ->> 'aal') = 'aal2', false)
    then coalesce(
      (select array_agg(r.role order by r.role) from public.admin_roles r
       where r.user_id = (select auth.uid())),
      '{}'::text[])
    else '{}'::text[] end;
$$;
revoke execute on function public.my_roles() from public, anon;
grant execute on function public.my_roles() to authenticated;

create policy "admins read roles"
  on public.admin_roles for select to authenticated
  using ((select public.has_role('admin')));
grant select on public.admin_roles to authenticated;

-- Granting by email: the panel never lists auth.users (Raz, design approval).
create function public.admin_grant_role(p_email text, p_role text)
  returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  target uuid;
  matches integer;
begin
  -- The lock first: an admin removed a moment ago can't still act (Dudi 8).
  lock table public.admin_roles in share row exclusive mode;
  if not public.has_role('admin') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- GoTrue keeps emails in lower case; only a confirmed address, and only one account (Dudi 9).
  select count(*), min(id::text)::uuid into matches, target
    from auth.users
    where email = lower(trim(p_email)) and email_confirmed_at is not null;
  if matches <> 1 then
    raise exception 'no such user' using errcode = 'P0002';
  end if;
  if target = (select auth.uid()) then
    raise exception 'cannot change own role' using errcode = '42501';
  end if;
  insert into public.admin_roles (user_id, role, granted_by)
  values (target, p_role, (select auth.uid()))
  on conflict do nothing;
end;
$$;
revoke execute on function public.admin_grant_role(text, text) from public, anon;
grant execute on function public.admin_grant_role(text, text) to authenticated;

create function public.admin_revoke_role(p_user uuid, p_role text)
  returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  -- The lock first, then the check: two admins removing each other run one
  -- after the other, and the second is no longer an admin (Dudi 8).
  lock table public.admin_roles in share row exclusive mode;
  if not public.has_role('admin') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_user = (select auth.uid()) then
    raise exception 'cannot change own role' using errcode = '42501';
  end if;
  -- The last admin is kept by admin_roles_keep_last_admin.
  delete from public.admin_roles where user_id = p_user and role = p_role;
end;
$$;
revoke execute on function public.admin_revoke_role(uuid, text) from public, anon;
grant execute on function public.admin_revoke_role(uuid, text) to authenticated;

-- The last admin stays, whoever deletes (D12): the function, or the cascade
-- of an account deletion (Dudi 6). That account can't be deleted until another
-- admin exists.
create function public.admin_roles_keep_last_admin()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if old.role = 'admin'
     and not exists (
       select 1 from public.admin_roles where role = 'admin' and user_id <> old.user_id
     ) then
    raise exception 'last admin' using errcode = '23514';
  end if;
  return old;
end;
$$;
create trigger admin_roles_keep_last_admin
  before delete on public.admin_roles
  for each row execute function public.admin_roles_keep_last_admin();

-- The admins and their emails, for the roles screen (admin only).
create function public.admin_role_list()
  returns table (user_id uuid, email text, role text, created_at timestamptz)
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  if not public.has_role('admin') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select r.user_id, u.email::text, r.role, r.created_at
    from public.admin_roles r join auth.users u on u.id = r.user_id
    order by u.email, r.role;
end;
$$;
revoke execute on function public.admin_role_list() from public, anon;
grant execute on function public.admin_role_list() to authenticated;

-- ------------------------------------------------------------------- audit
create table public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  actor_email text,
  action text not null constraint admin_audit_log_action_check
    check (action in ('insert', 'update', 'delete')),
  entity text not null,
  entity_id text not null,
  -- Only the columns that changed: {"col": {"old": .., "new": ..}}.
  diff jsonb not null,
  created_at timestamptz not null default now()
);

comment on table public.admin_audit_log is
  'Every change made in the admin panel (sprint 10 AC-18). Insert by trigger only; never updated or deleted.';

create index admin_audit_log_created on public.admin_audit_log (created_at desc, id desc);
create index admin_audit_log_entity on public.admin_audit_log (entity, entity_id, created_at desc);

alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from anon, authenticated;
create policy "admins read the audit log"
  on public.admin_audit_log for select to authenticated
  using ((select public.has_role('admin')));
grant select on public.admin_audit_log to authenticated;

-- No one rewrites history, service_role included (D11).
create function public.admin_audit_log_frozen()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  -- The one exception (Dudi 7): admin_audit_forget clears a deleted
  -- account's email, and changes nothing else.
  if tg_op = 'UPDATE'
     and current_setting('app.audit_forget', true) = 'on'
     and new.actor_email is null
     and (to_jsonb(new) - 'actor_email') = (to_jsonb(old) - 'actor_email') then
    return new;
  end if;
  raise exception 'the audit log is append-only' using errcode = '42501';
end;
$$;
create trigger admin_audit_log_frozen
  before update or delete on public.admin_audit_log
  for each row execute function public.admin_audit_log_frozen();
-- An account deleted: its email leaves the log; the id stays as a pseudonym.
create function public.admin_audit_forget()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  perform set_config('app.audit_forget', 'on', true);
  update public.admin_audit_log set actor_email = null
    where actor_id = old.id and actor_email is not null;
  perform set_config('app.audit_forget', 'off', true);
  return old;
end;
$$;
revoke execute on function public.admin_audit_forget() from public, anon, authenticated;
create trigger admin_audit_forget
  after delete on auth.users
  for each row execute function public.admin_audit_forget();

create trigger admin_audit_log_no_truncate
  before truncate on public.admin_audit_log
  for each statement execute function public.admin_audit_log_frozen();

-- One trigger for every edited table. Only a signed-in person is logged, so
-- the daily jobs (service_role, no auth.uid()) don't fill the log.
-- TG_ARGV[0]: the key column.
create function public.admin_audit()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  old_row jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  new_row jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  changed jsonb;
begin
  -- The daily jobs (no person) aren't logged; a role is, whoever removes it (Dudi 6).
  if actor is null and tg_table_name <> 'admin_roles' then
    return null;
  end if;
  select coalesce(jsonb_object_agg(k, jsonb_build_object('old', old_row -> k, 'new', new_row -> k)), '{}')
    into changed
    from jsonb_object_keys(coalesce(new_row, old_row)) as k
    where (old_row -> k) is distinct from (new_row -> k);
  if changed = '{}' then
    return null;
  end if;
  insert into public.admin_audit_log (actor_id, actor_email, action, entity, entity_id, diff)
  values (
    actor,
    (select auth.jwt() ->> 'email'),
    lower(tg_op),
    tg_table_name,
    coalesce(new_row, old_row) ->> tg_argv[0],
    changed
  );
  return null;
end;
$$;
revoke execute on function public.admin_audit() from public, anon, authenticated;

create trigger admin_roles_audit
  after insert or update or delete on public.admin_roles
  for each row execute function public.admin_audit('user_id');
create trigger country_advisories_audit
  after insert or update or delete on public.country_advisories
  for each row execute function public.admin_audit('adm0');
create trigger min_connection_times_audit
  after insert or update or delete on public.min_connection_times
  for each row execute function public.admin_audit('iata');

-- ------------------------------------------------------------ advisories
-- Sprint 10 AC-14 (D10): months of passport validity the destination asks
-- for; null: the default of 6.
alter table public.country_advisories
  add column passport_validity_months smallint
    constraint country_advisories_passport_validity_check
    check (passport_validity_months between 0 and 12);

-- Editors write the hand-kept columns only; the daily job keeps the rest (D13).
create policy "editors update entry"
  on public.country_advisories for update to authenticated
  using ((select public.has_role('content_editor')))
  with check ((select public.has_role('content_editor')));
grant update (entry_status, entry_note, entry_source_url, entry_verified_at, passport_validity_months)
  on public.country_advisories to authenticated;

-- ------------------------------------------------------------------- MCT
comment on table public.min_connection_times is
  'Minimum connection times with a public source (sprint 7). Read by all; content editors insert and update in the admin panel (sprint 10); no deletes.';

create policy "editors insert connection times"
  on public.min_connection_times for insert to authenticated
  with check ((select public.has_role('content_editor')));
create policy "editors update connection times"
  on public.min_connection_times for update to authenticated
  using ((select public.has_role('content_editor')))
  with check ((select public.has_role('content_editor')));
grant insert (iata, minutes, source_url, verified_at),
  update (minutes, source_url, verified_at)
  on public.min_connection_times to authenticated;

-- updated_at follows every edit.
create function public.touch_updated_at()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  -- A save with nothing changed changes nothing, and logs nothing (Dudi 5).
  if (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    new.updated_at := now();
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;
create trigger min_connection_times_touch
  before update on public.min_connection_times
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------ the no-consent purge
-- A person with a role is staff, not a user who never agreed (D12).
create or replace function public.purge_unconsented_users(batch integer default 500, max_batches integer default 20)
  returns integer
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  target uuid;
  deleted integer := 0;
  found_in_batch integer;
  failed uuid[] := '{}'::uuid[];
begin
  for run in 1..max_batches loop
    found_in_batch := 0;
    for target in
      select u.id
      from auth.users u
      where u.created_at < now() - interval '30 days'
        and u.id <> all (failed)
        and not exists (
          select 1 from public.consents c
          where c.user_id = u.id and c.doc_type = 'terms' and c.action = 'granted'
        )
        and not exists (select 1 from public.admin_roles r where r.user_id = u.id)
      order by u.created_at
      limit batch
    loop
      found_in_batch := found_in_batch + 1;
      begin
        if public.admin_delete_user(target, 'no_consent_30d') then
          deleted := deleted + 1;
        end if;
      exception when others then
        raise warning 'purge skipped one user: %', sqlstate;
        failed := failed || target;
      end;
    end loop;
    exit when found_in_batch < batch;
  end loop;
  return deleted;
end;
$$;
