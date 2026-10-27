-- Sprint 7 F-019 (ADR-012): connections, worked out from the flights, never
-- stored as a route.
--   min_connection_times: an airport's minimum connection time, each value
--     with its public source; none: 60 minutes (connection_mct).
--   flights.same_booking / same_booking_prev: the user's answer "booked with
--     the leg before?", valid only while that leg is still the one before.
--   trip_connections(): the connection rule in SQL, the same as the app's
--     (tested against supabase/tests/fixtures/connection_cases.json).

create table public.min_connection_times (
  iata text primary key constraint min_connection_times_iata_check check (iata ~ '^[A-Z]{3}$'),
  minutes integer not null constraint min_connection_times_minutes_check check (minutes between 15 and 360),
  -- A public page (the airport's or an airline's); IATA and OAG tables are licensed (Raz 6).
  source_url text not null constraint min_connection_times_source_check check (source_url ~ '^https://'),
  verified_at date not null,
  updated_at timestamptz not null default now()
);
alter table public.min_connection_times enable row level security;
create policy "everyone reads minimum connection times"
  on public.min_connection_times for select to anon, authenticated using (true);
revoke all on public.min_connection_times from anon, authenticated;
grant select on public.min_connection_times to anon, authenticated;

-- The one place the default lives (Raz 5).
create function public.connection_mct(p_iata text)
  returns integer
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce((select minutes from public.min_connection_times where iata = p_iata), 60);
$$;
revoke execute on function public.connection_mct(text) from public;
grant execute on function public.connection_mct(text) to anon, authenticated, service_role;

alter table public.flights
  add column same_booking boolean,
  -- Deleting the leg before clears this; an answer without it means nothing (the app checks).
  add column same_booking_prev uuid references public.flights (id) on delete set null,
  add constraint flights_same_booking_self_check check (same_booking_prev <> id);
-- The set-null on deleting a leg finds its followers fast.
create index flights_same_booking_prev on public.flights (same_booking_prev)
  where same_booking_prev is not null;

-- The answer, on the later leg (Raz 8): both legs the caller's, in one trip.
-- p_value null forgets it ("don't know").
create function public.set_same_booking(p_flight_id uuid, p_prev_id uuid, p_value boolean)
  returns text
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  n integer;
begin
  if uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if p_flight_id = p_prev_id then
    raise exception 'a flight is not its own previous leg' using errcode = '22023';
  end if;
  update public.flights f
  set same_booking = p_value,
      same_booking_prev = case when p_value is null then null else p_prev_id end,
      updated_at = now()
  where f.id = p_flight_id and f.user_id = uid
    and exists (select 1 from public.flights p
                where p.id = p_prev_id and p.user_id = uid and p.trip_id = f.trip_id);
  get diagnostics n = row_count;
  return case when n = 1 then 'ok' else 'gone' end;
end;
$$;
revoke execute on function public.set_same_booking(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_same_booking(uuid, uuid, boolean) to authenticated;

-- AC-1 in SQL: each landing takes the first departure after it (same trip and
-- direction, from the airport it landed at, by the schedule, within 24 hours);
-- a leg has one leg before and one after at most. For the server only.
create function public.trip_connections(p_trip_id uuid)
  returns table (prev_id uuid, next_id uuid, airport text)
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  a record;
  b record;
  taken uuid[] := '{}';
begin
  for a in
    select id, direction, arr_iata, arr_sched from public.flights
    where trip_id = p_trip_id and arr_iata is not null and arr_sched is not null
    order by arr_sched, id
  loop
    select f.id into b from public.flights f
    where f.trip_id = p_trip_id and f.id <> a.id and not (f.id = any (taken))
      and f.direction = a.direction and f.dep_iata = a.arr_iata
      and f.dep_sched > a.arr_sched and f.dep_sched <= a.arr_sched + interval '24 hours'
    order by f.dep_sched, f.id
    limit 1;
    if found then
      taken := taken || b.id;
      prev_id := a.id;
      next_id := b.id;
      airport := a.arr_iata;
      return next;
    end if;
  end loop;
end;
$$;
revoke execute on function public.trip_connections(uuid) from public, anon, authenticated;
grant execute on function public.trip_connections(uuid) to service_role;

-- The owner's flights, now with the answer and the arrival airport's minimum
-- (AC-2, AC-6: both reach the device copy, offline included).
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
      'arrMct', case when f.arr_iata is null then null else public.connection_mct(f.arr_iata) end,
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
