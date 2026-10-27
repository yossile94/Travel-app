-- Sprint 7, Raz's code review 1: the alert compares the wait before and
-- after the whole claim, both legs' changes included. Each recipient now
-- also gets the watch of the leg before and after, so the sender can find
-- that leg's own changes in the same claim.

drop function public.flight_notification_targets(bigint, bigint, integer);
create function public.flight_notification_targets(p_watch_id bigint, p_after bigint, p_limit integer)
  returns table (
    watch_id bigint, user_id uuid, flight_id uuid, flight_number text, flight_number_input text,
    dep_tz text, arr_tz text, dep_iata text, arr_iata text, dep_date_local date,
    token_id bigint, token text, locale text,
    prev_flight_id uuid, prev_watch_id bigint, prev_number text, prev_arr timestamptz, prev_arr_tz text, prev_mct integer,
    next_flight_id uuid, next_watch_id bigint, next_number text, next_dep timestamptz, next_mct integer
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
    pf.id, pf.watch_id, pf.flight_number_input,
    coalesce(public.try_timestamptz(pw.last_notified ->> 'arrTime'), pf.arr_sched), pf.arr_tz,
    case when pf.id is null then null else public.connection_mct(page.dep_iata) end,
    nf.id, nf.watch_id, nf.flight_number_input,
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
revoke execute on function public.flight_notification_targets(bigint, bigint, integer) from public, anon, authenticated;
grant execute on function public.flight_notification_targets(bigint, bigint, integer) to service_role;
