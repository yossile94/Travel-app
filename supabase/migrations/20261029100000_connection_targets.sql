-- Sprint 7 AC-4 (Raz 3): each recipient of a flight's alert also gets the
-- legs around that flight in the user's trip (the same rule as the app,
-- trip_connections), with each leg's latest known time (last notified, else
-- the schedule) and the minimum connection time where they meet. The alert
-- itself decides if the wait crossed the minimum (_shared/connection.ts).
-- flights_for_trips also says when a minimum is the general one (Raz design q3).

drop function public.flight_notification_targets(bigint, bigint, integer);
create function public.flight_notification_targets(p_watch_id bigint, p_after bigint, p_limit integer)
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
  -- A token belongs to one user, so one row per token; the user's first flight row speaks.
  select distinct on (t.id)
      f.watch_id, f.user_id, f.id, f.flight_number, f.flight_number_input,
      f.dep_tz, f.arr_tz, f.dep_iata, f.arr_iata, f.dep_date_local,
      t.id, t.token, t.locale,
      pf.id, pf.flight_number_input,
      coalesce((pw.last_notified ->> 'arrTime')::timestamptz, pf.arr_sched), pf.arr_tz,
      case when pf.id is null then null else public.connection_mct(f.dep_iata) end,
      nf.id, nf.flight_number_input,
      coalesce((nw.last_notified ->> 'depTime')::timestamptz, nf.dep_sched),
      case when nf.id is null then null else public.connection_mct(f.arr_iata) end
    from public.flights f
    join public.profiles p on p.id = f.user_id and p.flight_alerts
    join public.push_tokens t on t.user_id = f.user_id
    left join lateral (
      select (array_agg(c.prev_id) filter (where c.next_id = f.id))[1] as prev_id,
             (array_agg(c.next_id) filter (where c.prev_id = f.id))[1] as next_id
      from public.trip_connections(f.trip_id) c
    ) cx on true
    left join public.flights pf on pf.id = cx.prev_id
    left join public.flight_watch pw on pw.id = pf.watch_id
    left join public.flights nf on nf.id = cx.next_id
    left join public.flight_watch nw on nw.id = nf.watch_id
    where f.watch_id = p_watch_id and t.id > coalesce(p_after, 0)
    order by t.id, f.created_at
    limit least(greatest(p_limit, 1), 1000);
$$;
revoke execute on function public.flight_notification_targets(bigint, bigint, integer) from public, anon, authenticated;
grant execute on function public.flight_notification_targets(bigint, bigint, integer) to service_role;

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
      -- The general minimum, not the airport's own (design 3.5, Raz design q3).
      'arrMctDefault', f.arr_iata is not null
        and not exists (select 1 from public.min_connection_times m where m.iata = f.arr_iata),
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
