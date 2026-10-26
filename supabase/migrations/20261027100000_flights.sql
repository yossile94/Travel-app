-- Sprint 5 F-016 and F-017 (ADR-010): a trip's flights, one tracking row per
-- flight number and local date, and the changes it found.
--   flights: the user's own data, owner-only. Written only through
--     save_flight / delete_flight (consent gate, the 20-per-trip limit, and
--     the tracking row in one transaction).
--   flight_watch / flight_events: provider data, no client access. The owner
--     reads them through flights_for_trips. Deleted 7 days after landing
--     (AeroDataBox cache terms); the flight itself stays.

create table public.flight_watch (
  id bigint generated always as identity primary key,
  flight_number text not null constraint flight_watch_number_check
    check (flight_number ~ '^[A-Z0-9]{2}[1-9][0-9]{0,3}$'),
  dep_date_local date not null,
  sched_dep_utc timestamptz,
  sched_arr_utc timestamptz,
  -- active: checked from 6 hours before departure; paused: the month's unit
  -- cap was reached; stopped: landed, cancelled, no flights left, or over;
  -- failed: the provider didn't know it 3 times (AC-7).
  state text not null default 'active'
    constraint flight_watch_state_check check (state in ('active', 'paused', 'stopped', 'failed')),
  next_check_at timestamptz,
  attempts smallint not null default 0,
  locked_until timestamptz,
  last_checked_at timestamptz,
  -- The last provider answer, and the values last shown as a change (AC-7).
  last_snapshot jsonb,
  last_notified jsonb,
  landed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (flight_number, dep_date_local)
);

comment on table public.flight_watch is
  'One tracking row per flight number and local departure date (ADR-010). Service role only.';

-- The worker's queue read (ADR-010): only active rows that are due.
create index flight_watch_due on public.flight_watch (next_check_at) where state = 'active';

create table public.flight_events (
  id bigint generated always as identity primary key,
  watch_id bigint not null references public.flight_watch (id) on delete cascade,
  field text not null constraint flight_events_field_check
    check (field in ('dep_time', 'arr_time', 'dep_gate', 'arr_gate', 'status')),
  old_value text,
  new_value text,
  detected_at timestamptz not null default now()
);

comment on table public.flight_events is
  'Changes found by the tracking (AC-7). No PNR or user data. Service role only; owners read via flights_for_trips.';

create index flight_events_watch on public.flight_events (watch_id, detected_at desc);

alter table public.flight_watch enable row level security;
alter table public.flight_events enable row level security;
revoke all on public.flight_watch, public.flight_events from anon, authenticated;

create table public.flights (
  -- Made on the device: a retried save writes the same row (AC-5).
  id uuid primary key,
  trip_id uuid not null,
  user_id uuid not null default auth.uid(),
  direction text not null constraint flights_direction_check
    check (direction in ('out', 'return', 'internal')),
  -- What the user typed, and the normalised number tracking uses (AC-1).
  flight_number_input text not null constraint flights_number_input_check
    check (char_length(flight_number_input) between 2 and 12 and public.text_is_clean(flight_number_input)),
  flight_number text not null constraint flights_number_check
    check (flight_number ~ '^[A-Z0-9]{2}[1-9][0-9]{0,3}$'),
  -- The local departure date at the origin airport (AC-1).
  dep_date_local date not null,
  dep_iata text not null constraint flights_dep_iata_check check (dep_iata ~ '^[A-Z]{3}$'),
  dep_tz text not null constraint flights_dep_tz_check check (dep_tz ~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+){0,2}$'),
  arr_iata text constraint flights_arr_iata_check check (arr_iata ~ '^[A-Z]{3}$'),
  arr_tz text constraint flights_arr_tz_check check (arr_tz ~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+){0,2}$'),
  dep_sched timestamptz,
  arr_sched timestamptz,
  dep_terminal text constraint flights_dep_terminal_check
    check (char_length(dep_terminal) between 1 and 8 and public.text_is_clean(dep_terminal)),
  dep_gate text constraint flights_dep_gate_check
    check (char_length(dep_gate) between 1 and 8 and public.text_is_clean(dep_gate)),
  arr_terminal text constraint flights_arr_terminal_check
    check (char_length(arr_terminal) between 1 and 8 and public.text_is_clean(arr_terminal)),
  arr_gate text constraint flights_arr_gate_check
    check (char_length(arr_gate) between 1 and 8 and public.text_is_clean(arr_gate)),
  -- Never sent to the provider, never in flight_events or a log (AC-3).
  pnr text constraint flights_pnr_check check (pnr ~ '^[A-Z0-9]{5,8}$'),
  seat text constraint flights_seat_check check (seat ~ '^[A-Z0-9]{1,4}$'),
  cabin text constraint flights_cabin_check
    check (cabin in ('economy', 'premium', 'business', 'first')),
  -- Null: a past flight, or tracking over and deleted (7 days after landing).
  watch_id bigint references public.flight_watch (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint flights_arrival_check check (arr_sched is null or dep_sched is null or arr_sched > dep_sched),
  constraint flights_arr_pair_check check ((arr_iata is null) = (arr_tz is null)),
  foreign key (trip_id, user_id) references public.trips (id, user_id) on delete cascade
);

comment on table public.flights is
  'A trip''s flights (sprint 5 F-016). Owner-only; written through save_flight and delete_flight.';

create index flights_trip on public.flights (trip_id, dep_date_local);
create index flights_user on public.flights (user_id);
create index flights_watch on public.flights (watch_id) where watch_id is not null;

alter table public.flights enable row level security;
create policy "users read their own flights"
  on public.flights for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.flights from anon, authenticated;
grant select on public.flights to authenticated;

-- A tracking row with no flight left stops (AC-6): after a flight, a trip
-- (cascade) or an account is deleted, or a flight moves to another watch.
create function public.flights_release_watch()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if old.watch_id is not null
     and (tg_op = 'DELETE' or new.watch_id is distinct from old.watch_id)
     and not exists (select 1 from public.flights where watch_id = old.watch_id) then
    update public.flight_watch
    set state = 'stopped', next_check_at = null
    where id = old.watch_id and state in ('active', 'paused');
  end if;
  return null;
end;
$$;
revoke execute on function public.flights_release_watch() from public, anon, authenticated;

create trigger flights_release_watch
  after delete or update of watch_id on public.flights
  for each row execute function public.flights_release_watch();

-- When tracking starts (ADR-010, AC-6א): 6 hours before the scheduled
-- departure; without a time, 6 hours before the local day starts.
create function public.flight_first_check(p_dep_sched timestamptz, p_date date, p_tz text)
  returns timestamptz
  language sql
  stable
  set search_path = ''
as $$
  select greatest(now(), coalesce(p_dep_sched, p_date::timestamp at time zone p_tz) - interval '6 hours');
$$;
revoke execute on function public.flight_first_check(timestamptz, date, text) from public, anon, authenticated;

-- Saves one flight (AC-1 to AC-5). Returns 'ok', 'gone' (the trip is not the
-- caller's or was deleted) or 'limit' (20 flights). security definer: it
-- also writes the tracking row, which clients can't see; every check on the
-- caller is explicit here.
create function public.save_flight(p_id uuid, p_trip_id uuid, p_flight jsonb)
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
    dep_iata, dep_tz, arr_iata, arr_tz, dep_sched, arr_sched,
    dep_terminal, dep_gate, arr_terminal, arr_gate, pnr, seat, cabin, watch_id
  ) values (
    p_id, p_trip_id, uid, f ->> 'direction', f ->> 'numberInput', v_number, v_date,
    f ->> 'depIata', v_tz, f ->> 'arrIata', f ->> 'arrTz', v_dep, v_arr,
    nullif(f ->> 'depTerminal', ''), nullif(f ->> 'depGate', ''),
    nullif(f ->> 'arrTerminal', ''), nullif(f ->> 'arrGate', ''),
    nullif(f ->> 'pnr', ''), nullif(f ->> 'seat', ''), nullif(f ->> 'cabin', ''), v_watch
  )
  on conflict (id) do update
    set direction = excluded.direction, flight_number_input = excluded.flight_number_input,
        flight_number = excluded.flight_number, dep_date_local = excluded.dep_date_local,
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

-- Deleting needs no consent, like deleting a trip (sprint 2). 'ok' or 'gone'.
create function public.delete_flight(p_id uuid)
  returns text
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  delete from public.flights where id = p_id and user_id = auth.uid();
  return case when found then 'ok' else 'gone' end;
end;
$$;
revoke execute on function public.delete_flight(uuid) from public, anon;
grant execute on function public.delete_flight(uuid) to authenticated;

-- The owner's flights for up to 50 trips (a page of the trip list), each with
-- its tracking state and its last 10 changes (AC-7). One call, no N+1.
create function public.flights_for_trips(p_trip_ids uuid[])
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
      'depDateLocal', f.dep_date_local, 'depIata', f.dep_iata, 'depTz', f.dep_tz,
      'arrIata', f.arr_iata, 'arrTz', f.arr_tz, 'depSched', f.dep_sched, 'arrSched', f.arr_sched,
      'depTerminal', f.dep_terminal, 'depGate', f.dep_gate,
      'arrTerminal', f.arr_terminal, 'arrGate', f.arr_gate,
      'pnr', f.pnr, 'seat', f.seat, 'cabin', f.cabin,
      'watch', case when w.id is null then null else jsonb_build_object(
        'state', w.state, 'checkedAt', w.last_checked_at, 'snapshot', w.last_snapshot,
        'landedAt', w.landed_at,
        'events', coalesce((
          select jsonb_agg(jsonb_build_object(
            'field', e.field, 'old', e.old_value, 'new', e.new_value, 'at', e.detected_at
          ) order by e.detected_at desc)
          from (select * from public.flight_events where watch_id = w.id
                order by detected_at desc limit 10) e
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

-- Flight search quota (AC-6ב): 10 a day per user, taken by the lookup
-- function with the service role before it calls the provider.
create table public.flight_lookups (
  user_id uuid not null,
  day date not null,
  count smallint not null default 0,
  primary key (user_id, day)
);
alter table public.flight_lookups enable row level security;
revoke all on public.flight_lookups from anon, authenticated;

create function public.take_flight_lookup(p_user uuid)
  returns boolean
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  taken smallint;
begin
  insert into public.flight_lookups as l (user_id, day, count)
  values (p_user, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day) do update set count = l.count + 1 where l.count < 10
  returning count into taken;
  return taken is not null;
end;
$$;
revoke execute on function public.take_flight_lookup(uuid) from public, anon, authenticated;
grant execute on function public.take_flight_lookup(uuid) to service_role;

-- Retention (AC-7א): provider data 7 days after landing, and old quota rows.
select cron.schedule(
  'flight-data-retention',
  '20 3 * * *',
  $$delete from public.flight_watch
    where coalesce(landed_at, sched_arr_utc, sched_dep_utc + interval '24 hours',
                   (dep_date_local + 2)::timestamptz) < now() - interval '7 days';
    delete from public.flight_lookups where day < current_date - 2$$
);
