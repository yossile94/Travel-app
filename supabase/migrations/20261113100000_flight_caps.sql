-- Sprint 15 PR-B (F-048 AC-3 – AC-6; ADR-023): the flight caps.
--   AC-3  a flight deleted and added again isn't checked sooner than 15
--         minutes after the last check of its watch.
--   AC-4  at most 12 tracked flights per trip and 30 tracked future flights
--         per account (they replace the 10 of sprint 5); 20 flights per
--         trip, manual ones included, as before.
--   AC-5  72 tracking adds in 365 days and 24 in 30 days, logged in
--         tracked_flight_adds. One lock per user covers every check.
--   AC-6  a flight past a cap is saved without tracking, with the reason.
-- save_flight_v2 answers {status, reason, renews_at}. save_flight keeps its
-- text answer for the v0.15.0 app, which shows an error on anything it
-- doesn't know: a flight saved without tracking answers 'ok' there.

-- ---------------------------------------------------------- the limits
-- One tier for everyone until the Pro sprint; then only this changes (Raz 4).
create function public.user_tier(p_user uuid)
  returns text
  language sql
  stable
  set search_path = ''
as $$
  select 'interim'::text where p_user is not null;
$$;
revoke execute on function public.user_tier(uuid) from public, anon, authenticated;

-- A missing row is a broken migration, not "no cap": it fails closed.
create function public.usage_limit(p_user uuid, p_key text)
  returns integer
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v integer := (select l.value from public.usage_limits l
                where l.tier = public.user_tier(p_user) and l.limit_key = p_key);
begin
  if v is null then
    raise exception 'usage_limit: no % for this tier', p_key;
  end if;
  return v;
end;
$$;
revoke execute on function public.usage_limit(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------- save_flight_v2
create function public.save_flight_v2(p_id uuid, p_trip_id uuid, p_flight jsonb)
  returns jsonb
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
  v_reason text;
  v_renews timestamptz;
  v_year_limit integer;
  v_month_limit integer;
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

  -- One save at a time per user, across trips, so two saves can't both take
  -- the last place (AC-5). The suspend RPC takes the same lock (PR-G).
  perform pg_advisory_xact_lock(hashtext('tracked_flights:' || uid::text));

  perform 1 from public.trips where id = p_trip_id and user_id = uid for update;
  if not found then
    return jsonb_build_object('status', 'gone');
  end if;
  if (select count(*) from public.flights where trip_id = p_trip_id and id <> p_id)
     >= public.usage_limit(uid, 'flights_per_trip_total') then
    return jsonb_build_object('status', 'limit');
  end if;

  select flight_number, dep_date_local, watch_id into v_prev
  from public.flights where id = p_id and user_id = uid;
  v_over := coalesce(v_arr, v_dep + interval '24 hours', (v_date + 2)::timestamp at time zone v_tz);

  if v_over <= now() then
    -- Over already: nothing to track, and no reason to show (design 6.2).
    v_watch := case when v_prev.watch_id is not null and v_prev.flight_number = v_number
                         and v_prev.dep_date_local = v_date then v_prev.watch_id end;
  elsif exists (select 1 from public.account_suspensions s where s.user_id = uid) then
    v_reason := 'suspended';
  elsif v_prev.watch_id is not null and v_prev.flight_number = v_number and v_prev.dep_date_local = v_date then
    -- Same flight, other details edited, or a retry: it keeps its tracking
    -- and isn't a new add (AC-5).
    v_watch := v_prev.watch_id;
  else
    -- Turnover first: freeing a place doesn't help before the date (AC-5).
    v_year_limit := public.usage_limit(uid, 'tracked_adds_year');
    v_month_limit := public.usage_limit(uid, 'tracked_adds_30d');
    select greatest(
      (select a.added_at + interval '365 days' from public.tracked_flight_adds a
       where a.user_id = uid and a.added_at > now() - interval '365 days'
       order by a.added_at desc offset greatest(v_year_limit - 1, 0) limit 1),
      (select a.added_at + interval '30 days' from public.tracked_flight_adds a
       where a.user_id = uid and a.added_at > now() - interval '30 days'
       order by a.added_at desc offset greatest(v_month_limit - 1, 0) limit 1)
    ) into v_renews;
    -- With a limit of 0 the offset finds the newest add, or none at all.
    if v_renews is null and least(v_year_limit, v_month_limit) = 0 then
      v_renews := 'infinity';
    end if;
    if v_renews is not null then
      v_reason := 'turnover';
    elsif (select count(*) from public.flights fl
           join public.flight_watch w on w.id = fl.watch_id
           where fl.user_id = uid and fl.trip_id = p_trip_id and fl.id <> p_id
             and w.state in ('active', 'paused'))
          >= public.usage_limit(uid, 'flights_per_trip')
       or (select count(*) from public.flights fl
           join public.flight_watch w on w.id = fl.watch_id
           where fl.user_id = uid and fl.id <> p_id and w.state in ('active', 'paused'))
          >= public.usage_limit(uid, 'future_flights') then
      v_reason := 'concurrent';
    else
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
            -- Deleted and added again: not sooner than 15 minutes after the
            -- last check (AC-3, G1).
            next_check_at = case
              when (w.state = 'stopped' and w.stop_reason = 'no_flights')
                or (w.state = 'failed' and coalesce(w.next_check_at, w.created_at) < now() - interval '6 hours')
                then greatest(
                  public.flight_first_check(coalesce(w.sched_dep_utc, excluded.sched_dep_utc), w.dep_date_local, v_tz),
                  w.last_checked_at + interval '15 minutes')
              else w.next_check_at end,
            sched_dep_utc = coalesce(w.sched_dep_utc, excluded.sched_dep_utc),
            sched_arr_utc = coalesce(w.sched_arr_utc, excluded.sched_arr_utc)
      returning id into v_watch;
      insert into public.tracked_flight_adds (user_id, watch_id) values (uid, v_watch);
    end if;
  end if;

  insert into public.flights as fl (
    id, trip_id, user_id, direction, flight_number_input, flight_number, dep_date_local,
    airline_name, dep_iata, dep_tz, dep_country, arr_iata, arr_tz, arr_country, dep_sched, arr_sched,
    dep_terminal, dep_gate, arr_terminal, arr_gate, pnr, seat, cabin, watch_id, untracked_reason
  ) values (
    p_id, p_trip_id, uid, f ->> 'direction', f ->> 'numberInput', v_number, v_date,
    nullif(btrim(f ->> 'airline'), ''), f ->> 'depIata', v_tz, f ->> 'depCountry',
    f ->> 'arrIata', f ->> 'arrTz', f ->> 'arrCountry', v_dep, v_arr,
    nullif(f ->> 'depTerminal', ''), nullif(f ->> 'depGate', ''),
    nullif(f ->> 'arrTerminal', ''), nullif(f ->> 'arrGate', ''),
    nullif(f ->> 'pnr', ''), nullif(f ->> 'seat', ''), nullif(f ->> 'cabin', ''), v_watch, v_reason
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
        untracked_reason = excluded.untracked_reason,
        updated_at = now()
    where fl.user_id = uid and fl.trip_id = p_trip_id;
  if not found then
    raise exception 'flight id already in use' using errcode = '23505';
  end if;

  if v_reason is null then
    return jsonb_build_object('status', 'ok');
  end if;
  return jsonb_build_object(
    'status', 'untracked',
    'reason', v_reason,
    'renews_at', case when v_renews = 'infinity' then null else v_renews end
  );
end;
$$;
revoke execute on function public.save_flight_v2(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_flight_v2(uuid, uuid, jsonb) to authenticated;

-- ---------------------------------------------------- the v0.15.0 answer
-- 'ok', 'gone' or 'limit'. A flight saved without tracking is 'ok' here: the
-- old app knows no other success, and the row is saved (AC-6).
create or replace function public.save_flight(p_id uuid, p_trip_id uuid, p_flight jsonb)
  returns text
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  v_status := public.save_flight_v2(p_id, p_trip_id, p_flight) ->> 'status';
  return case when v_status = 'untracked' then 'ok' else v_status end;
end;
$$;

-- Its only caller was the old save_flight.
drop function public.tracked_flights_of(uuid, uuid);

-- ------------------------------------------------------- flights_for_trips
-- With the reason a flight isn't tracked (design 6.2).
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
      'sameBooking', f.same_booking, 'sameBookingPrev', f.same_booking_prev,
      'untrackedReason', f.untracked_reason,
      'arrMct', case when f.arr_iata is null then null
                     else coalesce(m.minutes, public.connection_mct(f.arr_iata)) end,
      'arrMctDefault', f.arr_iata is not null and m.iata is null,
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
    left join public.min_connection_times m on m.iata = f.arr_iata
    where f.user_id = auth.uid()
      and f.trip_id = any (p_trip_ids[1:50])
  ) rows;
$$;
