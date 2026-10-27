-- Sprint 5, Dudi's review of the flights data:
--   #1 the watch release locks the watch before it looks for flights, so a
--      save committing at the same moment is seen (no stopped watch with a flight).
--   #2 the due index covers both states the queue reads (active, paused).
--   #3 the provider's scheduled times replace a user's on the shared watch.
--   #4 times must fit the flight's date; at most 10 tracked flights per user;
--      only a watch stopped for lack of flights is revived (stop_reason).
--   #5 editing a flight without changing its number or date keeps its watch.
--   #6 identity sequences closed to clients.
--   #7 the search quota row goes with the account.
--   #8 the list read carries 3 changes per flight; a single trip's read, 50.
--   #10 a failed watch is retried when added again 6 hours later.
--   #11 a check is applied only by the run that claimed it.
-- Rollback: restore the functions from 20261027100000/120000/130000, drop
-- the constraints, stop_reason and flight_watch_due_queue.

alter table public.flight_watch add column stop_reason text
  constraint flight_watch_stop_reason_check check (stop_reason in ('no_flights', 'over'));

drop index public.flight_watch_due;
create index flight_watch_due_queue on public.flight_watch (next_check_at)
  where state in ('active', 'paused');

alter table public.flights
  add constraint flights_dep_sched_day_check check (
    dep_sched is null
    or dep_sched between (dep_date_local::timestamp at time zone dep_tz) - interval '1 day'
                     and (dep_date_local::timestamp at time zone dep_tz) + interval '2 days'
  ),
  add constraint flights_duration_check check (
    arr_sched is null or dep_sched is null or arr_sched - dep_sched <= interval '30 hours'
  );

revoke all on sequence public.flight_watch_id_seq, public.flight_events_id_seq from anon, authenticated;

alter table public.flight_lookups
  add constraint flight_lookups_user_fkey foreign key (user_id) references auth.users (id) on delete cascade;

create or replace function public.flights_release_watch()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if old.watch_id is null or (tg_op = 'UPDATE' and new.watch_id is not distinct from old.watch_id) then
    return null;
  end if;
  -- Lock first: a save holding this row commits before the check below runs.
  perform 1 from public.flight_watch where id = old.watch_id for update;
  if not exists (select 1 from public.flights where watch_id = old.watch_id) then
    update public.flight_watch
    set state = 'stopped', next_check_at = null, stop_reason = 'no_flights'
    where id = old.watch_id and state in ('active', 'paused');
  end if;
  return null;
end;
$$;

-- At most this many flights tracked at once per user (#4): the units are shared.
create or replace function public.tracked_flights_of(p_user uuid, p_except uuid)
  returns integer
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select count(*)::integer
  from public.flights f
  join public.flight_watch w on w.id = f.watch_id
  where f.user_id = p_user and f.id <> p_except and w.state in ('active', 'paused');
$$;
revoke execute on function public.tracked_flights_of(uuid, uuid) from public, anon, authenticated;

create or replace function public.save_flight(p_id uuid, p_trip_id uuid, p_flight jsonb)
  returns text
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  f jsonb := coalesce(p_flight, '{}');
  v_number text := f ->> 'number';
  v_date date;
  v_tz text := f ->> 'depTz';
  v_dep timestamptz;
  v_arr timestamptz;
  v_watch bigint;
  v_over timestamptz;
  v_prev record;
begin
  if uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if not public.has_current_consent() then
    raise exception 'consent to the current documents is required'
      using errcode = '42501', hint = 'consent_required';
  end if;
  if jsonb_typeof(f) <> 'object' then
    raise exception 'flight must be an object' using errcode = '22023';
  end if;
  begin
    v_date := (f ->> 'depDateLocal')::date;
    v_dep := (f ->> 'depSched')::timestamptz;
    v_arr := (f ->> 'arrSched')::timestamptz;
    perform now() at time zone v_tz;
    if f ->> 'arrTz' is not null then
      perform now() at time zone (f ->> 'arrTz');
    end if;
  exception when others then
    raise exception 'bad date, time or time zone' using errcode = '22023';
  end;
  if v_date is null or v_date > (now() at time zone v_tz)::date + 355 then
    raise exception 'departure date out of range' using errcode = '22023';
  end if;

  perform 1 from public.trips where id = p_trip_id and user_id = uid for update;
  if not found then
    return 'gone';
  end if;
  if (select count(*) from public.flights where trip_id = p_trip_id and id <> p_id) >= 20 then
    return 'limit';
  end if;

  select flight_number, dep_date_local, watch_id into v_prev
  from public.flights where id = p_id and user_id = uid;
  v_over := coalesce(v_arr, v_dep + interval '24 hours', (v_date + 2)::timestamp at time zone v_tz);
  if v_prev.watch_id is not null and v_prev.flight_number = v_number and v_prev.dep_date_local = v_date then
    -- Same flight, other details edited: it keeps its tracking, landed or not (#5).
    v_watch := v_prev.watch_id;
  elsif v_over > now() then
    if public.tracked_flights_of(uid, p_id) >= 10 then
      return 'track_limit';
    end if;
    insert into public.flight_watch as w (flight_number, dep_date_local, sched_dep_utc, sched_arr_utc, next_check_at)
    values (v_number, v_date, v_dep, v_arr, public.flight_first_check(v_dep, v_date, v_tz))
    on conflict (flight_number, dep_date_local) do update
      set state = case
            when w.state = 'stopped' and w.stop_reason = 'no_flights' then 'active'
            -- A watch that failed 6 hours ago or more gets a new try (#10).
            when w.state = 'failed' and coalesce(w.next_check_at, w.created_at) < now() - interval '6 hours' then 'active'
            else w.state end,
          attempts = case when w.state = 'failed' then 0 else w.attempts end,
          stop_reason = case when w.state = 'stopped' and w.stop_reason = 'no_flights' then null else w.stop_reason end,
          next_check_at = case
            when (w.state = 'stopped' and w.stop_reason = 'no_flights')
              or (w.state = 'failed' and coalesce(w.next_check_at, w.created_at) < now() - interval '6 hours')
              then public.flight_first_check(coalesce(w.sched_dep_utc, excluded.sched_dep_utc), w.dep_date_local, v_tz)
            else w.next_check_at end,
          sched_dep_utc = coalesce(w.sched_dep_utc, excluded.sched_dep_utc),
          sched_arr_utc = coalesce(w.sched_arr_utc, excluded.sched_arr_utc)
    returning id into v_watch;
  end if;

  insert into public.flights as fl (
    id, trip_id, user_id, direction, flight_number_input, flight_number, dep_date_local,
    airline_name, dep_iata, dep_tz, dep_country, arr_iata, arr_tz, arr_country, dep_sched, arr_sched,
    dep_terminal, dep_gate, arr_terminal, arr_gate, pnr, seat, cabin, watch_id
  ) values (
    p_id, p_trip_id, uid, f ->> 'direction', f ->> 'numberInput', v_number, v_date,
    nullif(btrim(f ->> 'airline'), ''), f ->> 'depIata', v_tz, f ->> 'depCountry',
    f ->> 'arrIata', f ->> 'arrTz', f ->> 'arrCountry', v_dep, v_arr,
    nullif(f ->> 'depTerminal', ''), nullif(f ->> 'depGate', ''),
    nullif(f ->> 'arrTerminal', ''), nullif(f ->> 'arrGate', ''),
    nullif(f ->> 'pnr', ''), nullif(f ->> 'seat', ''), nullif(f ->> 'cabin', ''), v_watch
  )
  on conflict (id) do update
    set direction = excluded.direction, flight_number_input = excluded.flight_number_input,
        flight_number = excluded.flight_number, dep_date_local = excluded.dep_date_local,
        airline_name = excluded.airline_name, dep_country = excluded.dep_country,
        arr_country = excluded.arr_country,
        dep_iata = excluded.dep_iata, dep_tz = excluded.dep_tz, arr_iata = excluded.arr_iata,
        arr_tz = excluded.arr_tz, dep_sched = excluded.dep_sched, arr_sched = excluded.arr_sched,
        dep_terminal = excluded.dep_terminal, dep_gate = excluded.dep_gate,
        arr_terminal = excluded.arr_terminal, arr_gate = excluded.arr_gate, pnr = excluded.pnr,
        seat = excluded.seat, cabin = excluded.cabin, watch_id = excluded.watch_id,
        updated_at = now()
    where fl.user_id = uid and fl.trip_id = p_trip_id;
  if not found then
    raise exception 'flight id already in use' using errcode = '23505';
  end if;
  return 'ok';
end;
$$;
revoke execute on function public.save_flight(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_flight(uuid, uuid, jsonb) to authenticated;

drop function public.apply_flight_check(bigint, text, timestamptz, smallint, jsonb, jsonb, timestamptz, jsonb);

-- p_lock: the locked_until the claim set; a run that outlived its claim writes nothing (#11).
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
      stop_reason = case when p_state = 'stopped' then 'over' else stop_reason end,
      last_checked_at = case when p_snapshot is not null then now() else last_checked_at end,
      last_snapshot = coalesce(p_snapshot, last_snapshot),
      last_notified = coalesce(p_notified, last_notified),
      landed_at = coalesce(p_landed, landed_at),
      -- The provider's schedule replaces what a user typed (#3).
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
revoke execute on function public.apply_flight_check(bigint, timestamptz, text, timestamptz, smallint, jsonb, jsonb, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_flight_check(bigint, timestamptz, text, timestamptz, smallint, jsonb, jsonb, timestamptz, jsonb)
  to service_role;

create or replace function public.claim_flight_watches(p_limit integer)
  returns setof public.flight_watch
  language sql
  security definer
  set search_path = ''
as $$
  update public.flight_watch w
  set locked_until = date_trunc('milliseconds', now()) + interval '5 minutes'
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

-- One trip (the row that opened): up to 50 changes each; a list: the last 3 (#8).
create or replace function public.flights_for_trips(p_trip_ids uuid[])
  returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce(jsonb_agg(row order by row ->> 'depDateLocal', row ->> 'depSched'), '[]')
  from (
    select jsonb_build_object(
      'id', f.id, 'tripId', f.trip_id, 'direction', f.direction,
      'numberInput', f.flight_number_input, 'number', f.flight_number,
      'depDateLocal', f.dep_date_local, 'airline', f.airline_name,
      'depIata', f.dep_iata, 'depTz', f.dep_tz, 'depCountry', f.dep_country,
      'arrIata', f.arr_iata, 'arrTz', f.arr_tz, 'arrCountry', f.arr_country,
      'depSched', f.dep_sched, 'arrSched', f.arr_sched,
      'depTerminal', f.dep_terminal, 'depGate', f.dep_gate,
      'arrTerminal', f.arr_terminal, 'arrGate', f.arr_gate,
      'pnr', f.pnr, 'seat', f.seat, 'cabin', f.cabin,
      'watch', case when w.id is null then null else jsonb_build_object(
        'state', w.state, 'checkedAt', w.last_checked_at, 'snapshot', w.last_snapshot,
        'landedAt', w.landed_at,
        'events', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', e.id, 'field', e.field, 'old', e.old_value, 'new', e.new_value, 'at', e.detected_at
          ) order by e.detected_at desc)
          from (select * from public.flight_events where watch_id = w.id
                order by detected_at desc
                limit case when cardinality(p_trip_ids) = 1 then 50 else 3 end) e
        ), '[]')
      ) end
    ) as row
    from public.flights f
    left join public.flight_watch w on w.id = f.watch_id
    where f.user_id = auth.uid()
      and f.trip_id = any (p_trip_ids[1:50])
  ) rows;
$$;
