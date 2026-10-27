-- Sprint 5, Sharona's design (4.1, 7.1, 20.7) and Raz's answers: the airline
-- name, each airport's country (no Israel time in brackets for an airport in
-- Israel, decided by country and not by time zone), "premium_economy", and up
-- to 50 changes for the flight sheet (design 10.1).

alter table public.flights
  add column airline_name text constraint flights_airline_check
    check (char_length(airline_name) between 1 and 60 and public.text_is_clean(airline_name)),
  add column dep_country text constraint flights_dep_country_check check (dep_country ~ '^[A-Z]{2}$'),
  add column arr_country text constraint flights_arr_country_check check (arr_country ~ '^[A-Z]{2}$');

alter table public.flights drop constraint flights_cabin_check;
alter table public.flights add constraint flights_cabin_check
  check (cabin in ('economy', 'premium_economy', 'business', 'first'));

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
  -- More than 355 days ahead is refused (AC-1); providers have no schedule yet.
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

  -- Tracked unless the flight is over: landed, or a day after it left (AC-1).
  v_over := coalesce(v_arr, v_dep + interval '24 hours', (v_date + 2)::timestamp at time zone v_tz);
  if v_over > now() then
    insert into public.flight_watch as w (flight_number, dep_date_local, sched_dep_utc, sched_arr_utc, next_check_at)
    values (v_number, v_date, v_dep, v_arr, public.flight_first_check(v_dep, v_date, v_tz))
    on conflict (flight_number, dep_date_local) do update
      -- A watch that stopped for lack of flights starts again; the provider's
      -- times, once known, win over a user's.
      set state = case when w.state = 'stopped' and w.landed_at is null then 'active' else w.state end,
          next_check_at = case
            when w.state = 'stopped' and w.landed_at is null
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
    -- A reused id never moves another user's flight, or a flight between trips.
    where fl.user_id = uid and fl.trip_id = p_trip_id;
  if not found then
    raise exception 'flight id already in use' using errcode = '23505';
  end if;
  return 'ok';
end;
$$;
revoke execute on function public.save_flight(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_flight(uuid, uuid, jsonb) to authenticated;

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
      'arrIata', f.arr_iata, 'arrTz', f.arr_tz, 'arrCountry', f.arr_country, 'depSched', f.dep_sched, 'arrSched', f.arr_sched,
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
                order by detected_at desc limit 50) e
        ), '[]')
      ) end
    ) as row
    from public.flights f
    left join public.flight_watch w on w.id = f.watch_id
    where f.user_id = auth.uid()
      and f.trip_id = any (p_trip_ids[1:50])
  ) rows;
$$;
revoke execute on function public.flights_for_trips(uuid[]) from public, anon;
grant execute on function public.flights_for_trips(uuid[]) to authenticated;
