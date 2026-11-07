-- Sprint 14 AC-12 (Raz 9, v0.14.1 review): the add-flight search answers a
-- flight already tracked and checked in the last 30 minutes from our copy,
-- free (sprint 5 AC-6ב). The copy held only the leg its users track, so a
-- flight number with a stop came back with one leg. The worker now keeps
-- every passenger leg of its last answer; the search answers with all of
-- them, still without a provider call. No change to the units spent.

alter table public.flight_watch
  add column last_legs jsonb constraint flight_watch_last_legs_check
    check (last_legs is null or (jsonb_typeof(last_legs) = 'array' and jsonb_array_length(last_legs) between 1 and 8));

comment on column public.flight_watch.last_legs is
  'Every passenger leg of the last provider answer, for the add-flight search (sprint 14 AC-12).';

drop function public.apply_flight_check(bigint, timestamptz, text, timestamptz, smallint, jsonb, jsonb, timestamptz, jsonb);
-- 20261028090000_push.sql's, with p_legs; a worker that doesn't send it keeps the saved legs.
create function public.apply_flight_check(
  p_id bigint,
  p_lock timestamptz,
  p_state text,
  p_next timestamptz,
  p_attempts smallint,
  p_snapshot jsonb,
  p_notified jsonb,
  p_landed timestamptz,
  p_events jsonb,
  p_legs jsonb default null
)
  returns bigint[]
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  ids bigint[] := array[]::bigint[];
begin
  update public.flight_watch
  set state = p_state,
      next_check_at = case
        when p_state in ('active', 'paused') then p_next
        when p_state = 'failed' then now()
      end,
      attempts = p_attempts,
      locked_until = null,
      stop_reason = case when p_state = 'stopped' then 'over' else stop_reason end,
      last_checked_at = case when p_snapshot is not null then now() else last_checked_at end,
      last_snapshot = coalesce(p_snapshot, last_snapshot),
      -- Legs only with a snapshot, so the two always come from the same answer.
      last_legs = case when p_snapshot is not null then p_legs else last_legs end,
      last_notified = coalesce(p_notified, last_notified),
      landed_at = coalesce(p_landed, landed_at),
      sched_dep_utc = coalesce((p_snapshot -> 'departure' ->> 'scheduledUtc')::timestamptz, sched_dep_utc),
      sched_arr_utc = coalesce((p_snapshot -> 'arrival' ->> 'scheduledUtc')::timestamptz, sched_arr_utc)
  where id = p_id and state <> 'stopped' and locked_until = p_lock;
  if found and jsonb_typeof(p_events) = 'array' then
    with added as (
      insert into public.flight_events (watch_id, field, old_value, new_value)
      select p_id, e ->> 'field', e ->> 'old', e ->> 'new'
      from jsonb_array_elements(p_events) e
      returning id
    )
    select coalesce(array_agg(id), '{}') into ids from added;
  end if;
  return ids;
end;
$$;
revoke execute on function public.apply_flight_check(bigint, timestamptz, text, timestamptz, smallint, jsonb, jsonb, timestamptz, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_flight_check(bigint, timestamptz, text, timestamptz, smallint, jsonb, jsonb, timestamptz, jsonb, jsonb)
  to service_role;
