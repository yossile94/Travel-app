-- Sprint 6, Raz's design review (findings 1 and the flight_alerts default):
-- an alert names the airports and the date and the number as the user typed
-- it (design 3.2), and alerts are off until the user turns them on (design 2,
-- the explainer): no profile gets alerts it never agreed to.

update public.profiles set flight_alerts = false where flight_alerts;
alter table public.profiles alter column flight_alerts set default false;

-- The return type changes, so the function is replaced, not altered.
drop function public.flight_notification_targets(bigint[]);
create function public.flight_notification_targets(p_watch_ids bigint[])
  returns table (
    watch_id bigint, user_id uuid, flight_id uuid, flight_number text, flight_number_input text,
    dep_tz text, arr_tz text, dep_iata text, arr_iata text, dep_date_local date,
    token_id bigint, token text, locale text
  )
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select distinct on (f.watch_id, f.user_id, t.id)
    f.watch_id, f.user_id, f.id, f.flight_number, f.flight_number_input,
    f.dep_tz, f.arr_tz, f.dep_iata, f.arr_iata, f.dep_date_local,
    t.id, t.token, t.locale
  from public.flights f
  join public.profiles p on p.id = f.user_id and p.flight_alerts
  join public.push_tokens t on t.user_id = f.user_id
  where f.watch_id = any (p_watch_ids)
  order by f.watch_id, f.user_id, t.id, f.created_at;
$$;
revoke execute on function public.flight_notification_targets(bigint[]) from public, anon, authenticated;
grant execute on function public.flight_notification_targets(bigint[]) to service_role;
