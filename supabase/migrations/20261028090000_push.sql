-- Sprint 6 F-018 (ADR-011): Push on flight changes.
--   push_tokens: a device's Expo push token, owner-only; written through
--     register_push_token / unregister_push_token. One row per token (moves
--     to whoever signs in on the device), at most 5 per user.
--   profiles.flight_alerts: the switch in the account sheet (AC-7), checked
--     before every send.
--   flight_events outbox (AC-3, AC-6): claimed, then marked sent or skipped,
--     so a run that dies halfway never loses or doubles an alert.
--   push_receipts: Expo tickets to read back (DeviceNotRegistered → the
--     token goes, AC-2). Deleted after 24 hours.
-- Rollback: drop the new tables, columns and functions; restore
-- apply_flight_check from 20261027150000 (it returned void).

create table public.push_tokens (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  token text not null unique
    constraint push_tokens_token_check check (token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,100}\]$'),
  platform text not null constraint push_tokens_platform_check check (platform in ('android', 'ios')),
  locale text not null default 'he' constraint push_tokens_locale_check check (locale in ('he', 'en')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index push_tokens_user on public.push_tokens (user_id, last_seen_at);
alter table public.push_tokens enable row level security;
create policy "users read their own push tokens"
  on public.push_tokens for select to authenticated
  using (user_id = (select auth.uid()));
create policy "users delete their own push tokens"
  on public.push_tokens for delete to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.push_tokens from anon, authenticated;
grant select, delete on public.push_tokens to authenticated;
revoke all on sequence public.push_tokens_id_seq from anon, authenticated;

-- Registers this device's token for the caller: a token signed in by someone
-- else before moves here (a shared device, an offline sign-out). The sixth
-- device replaces the oldest (Raz 11).
create function public.register_push_token(p_token text, p_platform text, p_locale text)
  returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  insert into public.push_tokens as t (user_id, token, platform, locale)
  values (uid, p_token, p_platform, coalesce(p_locale, 'he'))
  on conflict (token) do update
    set user_id = uid, platform = excluded.platform, locale = excluded.locale, last_seen_at = now();
  delete from public.push_tokens
  where user_id = uid and id not in (
    select id from public.push_tokens where user_id = uid order by last_seen_at desc limit 5
  );
end;
$$;
revoke execute on function public.register_push_token(text, text, text) from public, anon;
grant execute on function public.register_push_token(text, text, text) to authenticated;

create function public.unregister_push_token(p_token text)
  returns void
  language sql
  security definer
  set search_path = ''
as $$
  delete from public.push_tokens where token = p_token and user_id = auth.uid();
$$;
revoke execute on function public.unregister_push_token(text) from public, anon;
grant execute on function public.unregister_push_token(text) to authenticated;

alter table public.profiles add column flight_alerts boolean not null default true;
grant update (flight_alerts) on public.profiles to authenticated;

-- The outbox on the changes themselves.
alter table public.flight_events
  add column notify_claimed_at timestamptz,
  add column notified_at timestamptz,
  add column notify_skipped boolean not null default false;
create index flight_events_unsent on public.flight_events (detected_at)
  where notified_at is null and not notify_skipped;

create table public.push_receipts (
  ticket_id text primary key check (char_length(ticket_id) between 1 and 100),
  token_id bigint not null references public.push_tokens (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index push_receipts_created on public.push_receipts (created_at);
create index push_receipts_token on public.push_receipts (token_id);
alter table public.push_receipts enable row level security;
revoke all on public.push_receipts from anon, authenticated;

-- apply_flight_check now answers with the ids of the changes it wrote (Raz 1).
drop function public.apply_flight_check(bigint, timestamptz, text, timestamptz, smallint, jsonb, jsonb, timestamptz, jsonb);
create function public.apply_flight_check(
  p_id bigint,
  p_lock timestamptz,
  p_state text,
  p_next timestamptz,
  p_attempts smallint,
  p_snapshot jsonb,
  p_notified jsonb,
  p_landed timestamptz,
  p_events jsonb
)
  returns bigint[]
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  ids bigint[] := '{}';
begin
  update public.flight_watch
  set state = p_state,
      next_check_at = case
        when p_state in ('active', 'paused') then p_next
        when p_state = 'failed' then now()
      end,
      attempts = p_attempts,
      locked_until = null,
      stop_reason = case when p_state = 'stopped' then 'over' else stop_reason end,
      last_checked_at = case when p_snapshot is not null then now() else last_checked_at end,
      last_snapshot = coalesce(p_snapshot, last_snapshot),
      last_notified = coalesce(p_notified, last_notified),
      landed_at = coalesce(p_landed, landed_at),
      sched_dep_utc = coalesce((p_snapshot -> 'departure' ->> 'scheduledUtc')::timestamptz, sched_dep_utc),
      sched_arr_utc = coalesce((p_snapshot -> 'arrival' ->> 'scheduledUtc')::timestamptz, sched_arr_utc)
  where id = p_id and state <> 'stopped' and locked_until = p_lock;
  if found and jsonb_typeof(p_events) = 'array' then
    with added as (
      insert into public.flight_events (watch_id, field, old_value, new_value)
      select p_id, e ->> 'field', e ->> 'old', e ->> 'new'
      from jsonb_array_elements(p_events) e
      returning id
    )
    select coalesce(array_agg(id), '{}') into ids from added;
  end if;
  return ids;
end;
$$;
revoke execute on function public.apply_flight_check(bigint, timestamptz, text, timestamptz, smallint, jsonb, jsonb, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_flight_check(bigint, timestamptz, text, timestamptz, smallint, jsonb, jsonb, timestamptz, jsonb)
  to service_role;

-- Claims the unsent changes for 5 minutes (Raz 1): ones older than 30
-- minutes, or of a landed flight, are skipped, never sent late.
create function public.claim_flight_notifications(p_limit integer)
  returns table (id bigint, watch_id bigint, field text, old_value text, new_value text, detected_at timestamptz)
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  update public.flight_events e
  set notify_skipped = true
  from public.flight_watch w
  where w.id = e.watch_id and e.notified_at is null and not e.notify_skipped
    and (e.detected_at < now() - interval '30 minutes' or w.landed_at is not null);
  return query
  update public.flight_events e
  set notify_claimed_at = now()
  where e.id in (
    select x.id from public.flight_events x
    where x.notified_at is null and not x.notify_skipped
      and (x.notify_claimed_at is null or x.notify_claimed_at < now() - interval '5 minutes')
    order by x.detected_at
    limit least(greatest(p_limit, 1), 500)
    for update skip locked
  )
  returning e.id, e.watch_id, e.field, e.old_value, e.new_value, e.detected_at;
end;
$$;
revoke execute on function public.claim_flight_notifications(integer) from public, anon, authenticated;
grant execute on function public.claim_flight_notifications(integer) to service_role;

-- Who gets a watch's alert: each user once (one flight row each, Raz 2),
-- alerts on, with each of their devices. The time zones come from the
-- user's own flight row.
create function public.flight_notification_targets(p_watch_ids bigint[])
  returns table (
    watch_id bigint, user_id uuid, flight_id uuid, flight_number text,
    dep_tz text, arr_tz text, token_id bigint, token text, locale text
  )
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select distinct on (f.watch_id, f.user_id, t.id)
    f.watch_id, f.user_id, f.id, f.flight_number, f.dep_tz, f.arr_tz, t.id, t.token, t.locale
  from public.flights f
  join public.profiles p on p.id = f.user_id and p.flight_alerts
  join public.push_tokens t on t.user_id = f.user_id
  where f.watch_id = any (p_watch_ids)
  order by f.watch_id, f.user_id, t.id, f.created_at;
$$;
revoke execute on function public.flight_notification_targets(bigint[]) from public, anon, authenticated;
grant execute on function public.flight_notification_targets(bigint[]) to service_role;

create function public.mark_flight_notifications(p_ids bigint[], p_receipts jsonb)
  returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  update public.flight_events set notified_at = now() where id = any (p_ids);
  if jsonb_typeof(p_receipts) = 'array' then
    insert into public.push_receipts (ticket_id, token_id)
    select r ->> 'ticket', (r ->> 'tokenId')::bigint
    from jsonb_array_elements(p_receipts) r
    where exists (select 1 from public.push_tokens t where t.id = (r ->> 'tokenId')::bigint)
    on conflict (ticket_id) do nothing;
  end if;
end;
$$;
revoke execute on function public.mark_flight_notifications(bigint[], jsonb) from public, anon, authenticated;
grant execute on function public.mark_flight_notifications(bigint[], jsonb) to service_role;

-- The secret goes to one more task of the same function.
create or replace function public.call_cron_job(p_function text, p_body jsonb)
  returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  base text := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url');
  secret text := (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret');
begin
  if p_function not in ('flight-coverage', 'flight-watch') then
    raise exception 'call_cron_job: % is not a cron function', p_function;
  end if;
  if base is null or secret is null then
    raise warning 'call_cron_job: project_url or cron_secret missing in Vault';
    return;
  end if;
  perform net.http_post(
    url := base || '/functions/v1/' || p_function,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := p_body,
    timeout_milliseconds := 60000
  );
end;
$$;
revoke execute on function public.call_cron_job(text, jsonb) from public, anon, authenticated, service_role;

-- Receipts each 30 minutes, only when some are 15 minutes old (Expo's advice).
select cron.schedule(
  'push-receipts',
  '*/30 * * * *',
  $$select public.call_cron_job('flight-watch', '{"task":"receipts"}'::jsonb)
    where exists (select 1 from public.push_receipts where created_at < now() - interval '15 minutes')$$
);

-- Unsent alerts (a run that died) are picked up by the next run within a minute.
select cron.schedule(
  'flight-watch',
  '* * * * *',
  $$select public.call_cron_job('flight-watch', '{}'::jsonb)
    where exists (select 1 from public.flight_watch
                  where state in ('active', 'paused') and next_check_at <= now()
                    and (locked_until is null or locked_until < now()))
       or exists (select 1 from public.flight_events
                  where notified_at is null and not notify_skipped
                    and (notify_claimed_at is null or notify_claimed_at < now() - interval '5 minutes'))$$
);

-- Retention: receipts after a day, devices unseen for 90 days (Raz 11).
create or replace function public.flight_data_retention()
  returns void
  language sql
  security definer
  set search_path = ''
as $$
  delete from public.flight_watch
  where coalesce(landed_at, sched_arr_utc, sched_dep_utc + interval '24 hours',
                 (dep_date_local + 2)::timestamptz) < now() - interval '7 days';
  delete from public.flight_lookups where day < current_date - 2;
  delete from public.push_receipts where created_at < now() - interval '24 hours';
  delete from public.push_tokens where last_seen_at < now() - interval '90 days';
$$;
