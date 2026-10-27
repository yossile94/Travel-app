-- Sprint 6, Dudi's data review (1, 2, 3, 7, 8): alerts that scale past one
-- page of recipients and never go twice.
--   - Recipients are read one watch at a time, a page at a time (keyset on
--     the token id): PostgREST's max_rows (1000) never cuts a list silently.
--   - A claim holds 10 minutes, longer than a run can last; what a run could
--     not send is released at once for the next run.
--   - The stale sweep locks nothing it can't take and is bounded.
--   - A landed flight's last changes (an arrival gate) are still sent: only
--     the 30-minute rule applies.

create or replace function public.claim_flight_notifications(p_limit integer)
  returns table (id bigint, watch_id bigint, field text, old_value text, new_value text, detected_at timestamptz)
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  update public.flight_events e
  set notify_skipped = true
  where e.id in (
    select x.id from public.flight_events x
    where x.notified_at is null and not x.notify_skipped
      and x.detected_at < now() - interval '30 minutes'
    limit 5000
    for update skip locked
  );
  return query
  update public.flight_events e
  set notify_claimed_at = now()
  where e.id in (
    select x.id from public.flight_events x
    where x.notified_at is null and not x.notify_skipped
      and (x.notify_claimed_at is null or x.notify_claimed_at < now() - interval '10 minutes')
    order by x.detected_at
    limit least(greatest(p_limit, 1), 500)
    for update skip locked
  )
  returning e.id, e.watch_id, e.field, e.old_value, e.new_value, e.detected_at;
end;
$$;

-- What a run claimed and did not get to: free for the next run now.
create function public.release_flight_notifications(p_ids bigint[])
  returns void
  language sql
  security definer
  set search_path = ''
as $$
  update public.flight_events set notify_claimed_at = null
  where id = any (p_ids) and notified_at is null;
$$;
revoke execute on function public.release_flight_notifications(bigint[]) from public, anon, authenticated;
grant execute on function public.release_flight_notifications(bigint[]) to service_role;

-- One watch's recipients, a page at a time after a token id.
drop function public.flight_notification_targets(bigint[]);
create function public.flight_notification_targets(p_watch_id bigint, p_after bigint, p_limit integer)
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
  -- A token belongs to one user, so one row per token; the user's first flight row speaks.
  select distinct on (t.id)
    f.watch_id, f.user_id, f.id, f.flight_number, f.flight_number_input,
    f.dep_tz, f.arr_tz, f.dep_iata, f.arr_iata, f.dep_date_local,
    t.id, t.token, t.locale
  from public.flights f
  join public.profiles p on p.id = f.user_id and p.flight_alerts
  join public.push_tokens t on t.user_id = f.user_id
  where f.watch_id = p_watch_id and t.id > coalesce(p_after, 0)
  order by t.id, f.created_at
  limit least(greatest(p_limit, 1), 1000);
$$;
revoke execute on function public.flight_notification_targets(bigint, bigint, integer) from public, anon, authenticated;
grant execute on function public.flight_notification_targets(bigint, bigint, integer) to service_role;

-- The minute job: an unsent alert whose claim lapsed (10 minutes now).
select cron.schedule(
  'flight-watch',
  '* * * * *',
  $$select public.call_cron_job('flight-watch', '{}'::jsonb)
    where exists (select 1 from public.flight_watch
                  where state in ('active', 'paused') and next_check_at <= now()
                    and (locked_until is null or locked_until < now()))
       or exists (select 1 from public.flight_events
                  where notified_at is null and not notify_skipped
                    and (notify_claimed_at is null or notify_claimed_at < now() - interval '10 minutes'))$$
);
