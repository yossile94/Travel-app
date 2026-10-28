-- Sprint 7, Dudi's data review:
--   1. Recipients: the page is chosen first, then the legs around each of its
--      rows (trip_connections ran for every row after p_after before).
--   3. An answer whose leg before is gone is forgotten with it; "not sure"
--      clears an answer even when that leg no longer exists.
--   4. connection_mct runs as the caller (the table is public), and
--      flights_for_trips reads the minimum with one join.
--   5. A malformed time in last_notified never fails a whole page.
--   7. Writes to min_connection_times: service role only, until the admin (sprint 8).

comment on table public.min_connection_times is
  'Minimum connection times with a public source each (ADR-012). Read: everyone. '
  'Write: service role only until the admin panel (sprint 8); no write policy on purpose.';

alter function public.connection_mct(text) security invoker;
alter function public.trip_connections(uuid) rows 5;

-- A time from last_notified, or null when it doesn't read as one.
create function public.try_timestamptz(p_value text)
  returns timestamptz
  language plpgsql
  immutable
  set search_path = ''
as $$
begin
  return p_value::timestamptz;
exception when others then
  return null;
end;
$$;
revoke execute on function public.try_timestamptz(text) from public, anon, authenticated;
grant execute on function public.try_timestamptz(text) to service_role;

create or replace function public.flight_notification_targets(p_watch_id bigint, p_after bigint, p_limit integer)
  returns table (
    watch_id bigint, user_id uuid, flight_id uuid, flight_number text, flight_number_input text,
    dep_tz text, arr_tz text, dep_iata text, arr_iata text, dep_date_local date,
    token_id bigint, token text, locale text,
    prev_flight_id uuid, prev_number text, prev_arr timestamptz, prev_arr_tz text, prev_mct integer,
    next_flight_id uuid, next_number text, next_dep timestamptz, next_mct integer
  )
  language sql
  stable
  security definer
  set search_path = ''
as $$
  with page as (
    -- A token belongs to one user, so one row per token; the user's first flight row speaks.
    select distinct on (t.id) f.*, t.id as t_id, t.token as t_token, t.locale as t_locale
    from public.flights f
    join public.profiles p on p.id = f.user_id and p.flight_alerts
    join public.push_tokens t on t.user_id = f.user_id
    where f.watch_id = p_watch_id and t.id > coalesce(p_after, 0)
    order by t.id, f.created_at
    limit least(greatest(p_limit, 1), 1000)
  )
  select
    page.watch_id, page.user_id, page.id, page.flight_number, page.flight_number_input,
    page.dep_tz, page.arr_tz, page.dep_iata, page.arr_iata, page.dep_date_local,
    page.t_id, page.t_token, page.t_locale,
    pf.id, pf.flight_number_input,
    coalesce(public.try_timestamptz(pw.last_notified ->> 'arrTime'), pf.arr_sched), pf.arr_tz,
    case when pf.id is null then null else public.connection_mct(page.dep_iata) end,
    nf.id, nf.flight_number_input,
    coalesce(public.try_timestamptz(nw.last_notified ->> 'depTime'), nf.dep_sched),
    case when nf.id is null then null else public.connection_mct(page.arr_iata) end
  from page
  left join lateral (
    select (array_agg(c.prev_id) filter (where c.next_id = page.id))[1] as prev_id,
           (array_agg(c.next_id) filter (where c.prev_id = page.id))[1] as next_id
    from public.trip_connections(page.trip_id) c
  ) cx on true
  left join public.flights pf on pf.id = cx.prev_id
  left join public.flight_watch pw on pw.id = pf.watch_id
  left join public.flights nf on nf.id = cx.next_id
  left join public.flight_watch nw on nw.id = nf.watch_id
  order by page.t_id;
$$;

-- The leg before deleted (on delete set null): the answer about it goes too.
create function public.flights_forget_same_booking()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  new.same_booking := null;
  return new;
end;
$$;
create trigger flights_forget_same_booking
  before update of same_booking_prev on public.flights
  for each row
  when (old.same_booking_prev is not null and new.same_booking_prev is null)
  execute function public.flights_forget_same_booking();
-- Answers already orphaned on dev.
update public.flights set same_booking = null
where same_booking is not null and same_booking_prev is null;

create or replace function public.set_same_booking(p_flight_id uuid, p_prev_id uuid, p_value boolean)
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
  if p_value is null then
    -- "Not sure": forget the answer, whatever happened to the leg before.
    update public.flights set same_booking = null, same_booking_prev = null, updated_at = now()
    where id = p_flight_id and user_id = uid;
  else
    update public.flights f
    set same_booking = p_value, same_booking_prev = p_prev_id, updated_at = now()
    where f.id = p_flight_id and f.user_id = uid
      and exists (select 1 from public.flights p
                  where p.id = p_prev_id and p.user_id = uid and p.trip_id = f.trip_id);
  end if;
  get diagnostics n = row_count;
  return case when n = 1 then 'ok' else 'gone' end;
end;
$$;

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
