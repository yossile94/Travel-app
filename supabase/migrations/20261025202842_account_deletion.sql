-- Sprint 2 F-005 (AC-15 to AC-18): deleting an account, by the user's
-- request or automatically 30 days after a sign-in that never consented.

-- When and why each account was deleted. No foreign key: the user is gone.
-- The consent log's retention period is counted from here (ADR-004). Only
-- the deletion function writes it; clients have no access at all.
create table public.account_deletions (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  deleted_at timestamptz not null default now(),
  reason text not null constraint account_deletions_reason_check
    check (reason in ('user_request', 'no_consent_30d'))
);

comment on table public.account_deletions is
  'Deleted accounts: when and why (sprint 2 AC-16, AC-17). The consent retention period starts here.';

create index account_deletions_user on public.account_deletions (user_id);

alter table public.account_deletions enable row level security;
revoke all on public.account_deletions from anon, authenticated;
revoke all on sequence public.account_deletions_id_seq from anon, authenticated;
revoke truncate on public.account_deletions from service_role;

-- Deletes one user in one transaction: records the deletion, then deletes
-- the auth user, which cascades to the profile and the trips. Returns false
-- when there was no such user (a retry after a lost response, AC-16).
-- Only the server runs it: the delete-account Edge Function with the
-- service role key, and the daily purge below.
create function public.admin_delete_user(target uuid, why text)
  returns boolean
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  delete from auth.users where id = target;
  if not found then
    return false;
  end if;
  insert into public.account_deletions (user_id, reason) values (target, why);
  return true;
end;
$$;

revoke execute on function public.admin_delete_user(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_delete_user(uuid, text) to service_role;

-- AC-17: users who never consented to the terms (in any version) are deleted
-- 30 days after their account was created, in batches of `batch`, until none
-- are left or `max_batches` ran (so a backlog drains instead of growing). A
-- user who consented to an older version and not yet to a newer one is kept.
-- One user whose deletion fails is skipped with a warning (no personal data),
-- never blocking the rest.
create function public.purge_unconsented_users(batch integer default 500, max_batches integer default 20)
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

revoke execute on function public.purge_unconsented_users(integer, integer) from public, anon, authenticated;
grant execute on function public.purge_unconsented_users(integer, integer) to service_role;

-- Every day at 03:17 UTC. cron.schedule replaces a job with the same name.
create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'purge-unconsented-users',
  '17 3 * * *',
  $$ select public.purge_unconsented_users(); $$
);
