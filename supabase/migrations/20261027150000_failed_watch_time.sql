-- Sprint 5, Raz's second review (#2): a failed watch keeps the time it failed
-- in next_check_at (the queue reads only active and paused rows), so
-- save_flight's "failed 6 hours ago or more" retry measures from the failure,
-- not from when the watch was created.
-- Rollback: the apply_flight_check of 20261027140000.
create or replace function public.apply_flight_check(
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
  returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
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
    insert into public.flight_events (watch_id, field, old_value, new_value)
    select p_id, e ->> 'field', e ->> 'old', e ->> 'new'
    from jsonb_array_elements(p_events) e;
  end if;
end;
$$;

-- Dudi, second review:
--   #3 without a departure time, the arrival still has to fit the flight's date.
alter table public.flights add constraint flights_arr_sched_day_check check (
  arr_sched is null
  or dep_sched is not null
  or arr_sched between (dep_date_local::timestamp at time zone dep_tz)
                   and (dep_date_local::timestamp at time zone dep_tz) + interval '3 days'
);

--   #4 retention as a function: the cron and the test call the same thing.
create function public.flight_data_retention()
  returns void
  language sql
  security definer
  set search_path = ''
as $$
  delete from public.flight_watch
  where coalesce(landed_at, sched_arr_utc, sched_dep_utc + interval '24 hours',
                 (dep_date_local + 2)::timestamptz) < now() - interval '7 days';
  delete from public.flight_lookups where day < current_date - 2;
$$;
revoke execute on function public.flight_data_retention() from public, anon, authenticated;
select cron.schedule('flight-data-retention', '20 3 * * *', $$select public.flight_data_retention()$$);

--   #6 the 10-flights limit holds across a user's trips saved at once.
create or replace function public.tracked_flights_of(p_user uuid, p_except uuid)
  returns integer
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('tracked_flights:' || p_user::text));
  return (
    select count(*)::integer
    from public.flights f
    join public.flight_watch w on w.id = f.watch_id
    where f.user_id = p_user and f.id <> p_except and w.state in ('active', 'paused')
  );
end;
$$;
revoke execute on function public.tracked_flights_of(uuid, uuid) from public, anon, authenticated;
