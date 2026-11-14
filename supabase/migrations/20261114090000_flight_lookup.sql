-- Sprint 15 PR-C (F-048 AC-7, AC-8; ADR-023): the flight search.
--   AC-7  a search made in the last 24 hours, by anyone, answers from a copy
--         (flight_lookup_cache, no user id) for 0 units, "not found" too.
--         150 provider searches in 30 days per user, and 10 a day as before;
--         an answer from a copy isn't counted. A search spends the units cap
--         and its own slice of it (aerodatabox/lookup). At 85% of the units
--         cap the search answers only from a copy; at 95% it is off.
--   AC-8  begin_flight_lookup names what stopped a search, so the function
--         tells a spent budget from a database that didn't answer.
--   Design 6.3: a suspended account can't search.
-- begin_flight_lookup replaces take_flight_lookup: every check in one call.
-- Deploy flight-lookup right after this migration; until then the old
-- function answers "unavailable", and the form opens for manual entry.
-- Rollback: restore take_flight_lookup (20261027100000) and
-- flight_data_retention (20261113090000); drop begin_flight_lookup,
-- put_flight_lookup, flight_lookup_cache and provider_usage.lookup_units.

-- ------------------------------------------------------------- the copy
create table public.flight_lookup_cache (
  flight_number text not null constraint flight_lookup_cache_number_check
    check (flight_number ~ '^[A-Z0-9]{2}[1-9][0-9]{0,3}$'),
  dep_date_local date not null,
  -- The passenger legs as the search answered; [] is "not found".
  legs jsonb not null constraint flight_lookup_cache_legs_check
    check (jsonb_typeof(legs) = 'array'
           and case when jsonb_typeof(legs) = 'array' then jsonb_array_length(legs) <= 8 end
           and pg_column_size(legs) <= 32768),
  fetched_at timestamptz not null default now(),
  primary key (flight_number, dep_date_local)
);
comment on table public.flight_lookup_cache is
  'The last provider answer per flight number and date, for 24 hours (sprint 15 AC-7). No user id. Server only.';
create index flight_lookup_cache_fetched on public.flight_lookup_cache (fetched_at);
alter table public.flight_lookup_cache enable row level security;
revoke all on public.flight_lookup_cache from anon, authenticated;

-- ----------------------------------------------------- the search's slice
-- Units the search spent each day, within the day's units (Raz and Dudi:
-- a slice of the units cap, not a second budget).
alter table public.provider_usage
  add column lookup_units integer not null default 0,
  add constraint provider_usage_lookup_units_check check (lookup_units between 0 and units);

-- ---------------------------------------------------- begin_flight_lookup
-- What a search may do, in this order: a suspended account can't search;
-- at 95% of the units cap nothing answers; a tracked flight checked in the
-- last 30 minutes, or any search in the last 24 hours, answers for free;
-- at 85% only those answer; then the user's day and 30-day caps; then the
-- units cap and the search's slice. 'go' has taken the search and its units.
create function public.begin_flight_lookup(p_user uuid, p_number text, p_date date, p_units integer)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  today date := (now() at time zone 'utc')::date;
  v_cap integer := (select c.hard_cap from public.provider_catalog c
                    where c.provider = 'aerodatabox' and c.metric = 'units');
  v_slice integer := (select c.hard_cap from public.provider_catalog c
                      where c.provider = 'aerodatabox' and c.metric = 'lookup');
  v_used integer;
  v_used_lookup integer;
  v_load numeric;
  v_legs jsonb;
  v_day integer;
  v_30d integer;
begin
  if p_user is null or p_number is null or p_date is null
     or p_units is null or p_units < 1 or p_units > 10 then
    raise exception 'begin_flight_lookup: bad arguments' using errcode = '22023';
  end if;
  if exists (select 1 from public.account_suspensions s where s.user_id = p_user) then
    return jsonb_build_object('status', 'suspended');
  end if;

  select coalesce(sum(u.units), 0), coalesce(sum(u.lookup_units), 0)
    into v_used, v_used_lookup
  from public.provider_usage u
  where u.provider = 'aerodatabox' and u.day > today - 31;
  -- No cap, or a cap of 0, is full.
  v_load := case when coalesce(v_cap, 0) = 0 then 100 else v_used * 100.0 / v_cap end;
  if v_load >= 95 then
    return jsonb_build_object('status', 'off');
  end if;

  select coalesce(nullif(w.last_legs, '[]'::jsonb), jsonb_build_array(w.last_snapshot))
    into v_legs
  from public.flight_watch w
  where w.flight_number = p_number and w.dep_date_local = p_date
    and w.last_snapshot is not null and w.last_checked_at > now() - interval '30 minutes';
  if v_legs is not null then
    return jsonb_build_object('status', 'copy', 'from', 'tracked', 'legs', v_legs);
  end if;
  select c.legs into v_legs
  from public.flight_lookup_cache c
  where c.flight_number = p_number and c.dep_date_local = p_date
    and c.fetched_at > now() - interval '24 hours';
  if found then
    return jsonb_build_object('status', 'copy', 'from', 'cache', 'legs', v_legs);
  end if;
  if v_load >= 85 then
    return jsonb_build_object('status', 'off');
  end if;

  -- One search at a time per user, so two can't both take the last one.
  perform pg_advisory_xact_lock(1516, hashtext(p_user::text));
  select coalesce(sum(l.count) filter (where l.day = today), 0), coalesce(sum(l.count), 0)
    into v_day, v_30d
  from public.flight_lookups l
  where l.user_id = p_user and l.day > today - 30;
  if v_day >= public.usage_limit(p_user, 'lookups_day') then
    return jsonb_build_object('status', 'lookups_day');
  end if;
  if v_30d >= public.usage_limit(p_user, 'lookups_30d') then
    return jsonb_build_object('status', 'lookups_30d');
  end if;

  -- spend_provider_units' lock: the check and the add are one step.
  perform pg_advisory_xact_lock(hashtext('provider_units:aerodatabox'));
  select coalesce(sum(u.units), 0), coalesce(sum(u.lookup_units), 0)
    into v_used, v_used_lookup
  from public.provider_usage u
  where u.provider = 'aerodatabox' and u.day > today - 31;
  if v_used + p_units > coalesce(v_cap, 0) or v_used_lookup + p_units > coalesce(v_slice, 0) then
    raise log 'begin_flight_lookup: the units cap or the search slice is spent';
    return jsonb_build_object('status', 'budget');
  end if;
  insert into public.provider_usage as u (day, provider, units, lookup_units)
  values (today, 'aerodatabox', p_units, p_units)
  on conflict (provider, day) do update
    set units = u.units + excluded.units, lookup_units = u.lookup_units + excluded.lookup_units;
  insert into public.flight_lookups as l (user_id, day, count)
  values (p_user, today, 1)
  on conflict (user_id, day) do update set count = l.count + 1;
  return jsonb_build_object('status', 'go');
end;
$$;
revoke execute on function public.begin_flight_lookup(uuid, text, date, integer) from public, anon, authenticated;
grant execute on function public.begin_flight_lookup(uuid, text, date, integer) to service_role;

-- The provider's answer, for the next 24 hours; a failure isn't kept.
create function public.put_flight_lookup(p_number text, p_date date, p_legs jsonb)
  returns void
  language sql
  security definer
  set search_path = ''
as $$
  insert into public.flight_lookup_cache as c (flight_number, dep_date_local, legs)
  values (p_number, p_date, p_legs)
  on conflict (flight_number, dep_date_local) do update
    set legs = excluded.legs, fetched_at = now();
$$;
revoke execute on function public.put_flight_lookup(text, date, jsonb) from public, anon, authenticated;
grant execute on function public.put_flight_lookup(text, date, jsonb) to service_role;

drop function public.take_flight_lookup(uuid);

-- --------------------------------------------------------------- retention
-- 20261113090000's, and copies older than 24 hours.
create or replace function public.flight_data_retention()
  returns void
  language sql
  security definer
  set search_path = ''
as $$
  delete from public.flight_watch
  where coalesce(landed_at, sched_arr_utc, sched_dep_utc + interval '24 hours',
                 (dep_date_local + 2)::timestamptz) < now() - interval '7 days';
  delete from public.flight_lookups where day < current_date - 31;
  delete from public.flight_lookup_cache where fetched_at < now() - interval '24 hours';
  delete from public.push_receipts where created_at < now() - interval '24 hours';
  delete from public.push_tokens where last_seen_at < now() - interval '90 days';
  delete from public.tracked_flight_adds where added_at < now() - interval '400 days';
$$;
