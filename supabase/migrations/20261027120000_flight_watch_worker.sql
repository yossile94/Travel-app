-- Sprint 5 F-017 (ADR-010): the Flight Watch queue. pg_cron calls the
-- flight-watch function each minute, only when a row is due; the function
-- claims rows with skip locked, checks the provider, and writes the result
-- back in one call. All service role only.

-- Claims up to p_limit due rows for 5 minutes. Paused rows (the unit cap)
-- are retried too, so tracking resumes when units free up.
create function public.claim_flight_watches(p_limit integer)
  returns setof public.flight_watch
  language sql
  security definer
  set search_path = ''
as $$
  update public.flight_watch w
  set locked_until = now() + interval '5 minutes'
  where w.id in (
    select id from public.flight_watch
    where state in ('active', 'paused')
      and next_check_at <= now()
      and (locked_until is null or locked_until < now())
    order by next_check_at
    limit least(greatest(p_limit, 1), 50)
    for update skip locked
  )
  returning w.*;
$$;
revoke execute on function public.claim_flight_watches(integer) from public, anon, authenticated;
grant execute on function public.claim_flight_watches(integer) to service_role;

-- Writes one check: the state, the next time, the snapshot, the values last
-- shown, and the changes found. A row stopped meanwhile (no flight left)
-- stays stopped.
create function public.apply_flight_check(
  p_id bigint,
  p_state text,
  p_next timestamptz,
  p_attempts smallint,
  p_snapshot jsonb,
  p_notified jsonb,
  p_landed timestamptz,
  p_events jsonb
)
  returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  update public.flight_watch
  set state = p_state,
      next_check_at = case when p_state in ('active', 'paused') then p_next end,
      attempts = p_attempts,
      locked_until = null,
      last_checked_at = case when p_snapshot is not null then now() else last_checked_at end,
      last_snapshot = coalesce(p_snapshot, last_snapshot),
      last_notified = coalesce(p_notified, last_notified),
      landed_at = coalesce(p_landed, landed_at)
  where id = p_id and state <> 'stopped';
  if found and jsonb_typeof(p_events) = 'array' then
    insert into public.flight_events (watch_id, field, old_value, new_value)
    select p_id, e ->> 'field', e ->> 'old', e ->> 'new'
    from jsonb_array_elements(p_events) e;
  end if;
end;
$$;
revoke execute on function public.apply_flight_check(bigint, text, timestamptz, smallint, jsonb, jsonb, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_flight_check(bigint, text, timestamptz, smallint, jsonb, jsonb, timestamptz, jsonb)
  to service_role;

-- Each minute, a call only when something is due: most minutes cost nothing.
select cron.schedule(
  'flight-watch',
  '* * * * *',
  $$select public.call_cron_job('flight-watch', '{}'::jsonb)
    where exists (select 1 from public.flight_watch
                  where state in ('active', 'paused') and next_check_at <= now()
                    and (locked_until is null or locked_until < now()))$$
);
