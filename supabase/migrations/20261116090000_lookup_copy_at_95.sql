-- Sprint 15 AC-7 (Yossi, 16.11, Raz's note on PR-C): at 95% of the units cap
-- a search still answers from a copy, as at 85%: a copy costs no units, and
-- turning it off only hurts the user. A search without a copy stays off.
-- 20261114090000's begin_flight_lookup without the 95% stop; nothing else changes.
-- No deploy order: flight-lookup reads the same answers.
-- Rollback: restore begin_flight_lookup from 20261114090000.

create or replace function public.begin_flight_lookup(p_user uuid, p_number text, p_date date, p_units integer)
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
  v_load numeric;
  v_used integer;
  v_used_lookup integer;
  v_tracked jsonb;
  v_tracked_at timestamptz;
  v_cached jsonb;
  v_cached_at timestamptz;
  v_day integer;
  v_30d integer;
begin
  -- The function checks these too; a bad call spends nothing (Dudi 5).
  if p_user is null or p_number is null or p_date is null
     or p_number !~ '^[A-Z0-9]{2}[1-9][0-9]{0,3}$'
     or p_date < today - 2 or p_date > today + 355
     or p_units is null or p_units < 1 or p_units > 10 then
    raise exception 'begin_flight_lookup: bad arguments' using errcode = '22023';
  end if;
  if exists (select 1 from public.account_suspensions s where s.user_id = p_user) then
    return jsonb_build_object('status', 'suspended');
  end if;

  v_load := public.aerodatabox_load();

  select coalesce(nullif(w.last_legs, '[]'::jsonb), jsonb_build_array(w.last_snapshot)), w.last_checked_at
    into v_tracked, v_tracked_at
  from public.flight_watch w
  where w.flight_number = p_number and w.dep_date_local = p_date
    and w.last_snapshot is not null and w.last_checked_at > now() - interval '24 hours';
  select c.legs, c.fetched_at into v_cached, v_cached_at
  from public.flight_lookup_cache c
  where c.flight_number = p_number and c.dep_date_local = p_date
    and c.fetched_at > now() - interval '24 hours';
  if v_tracked is not null and (v_cached_at is null or v_tracked_at >= v_cached_at) then
    return jsonb_build_object('status', 'copy', 'from', 'tracked', 'legs', v_tracked);
  end if;
  if v_cached_at is not null then
    return jsonb_build_object('status', 'copy', 'from', 'cache', 'legs', v_cached);
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
  -- The 85% again, under the lock: searches at once can't pass it (Dudi 1).
  if coalesce(v_cap, 0) = 0 or v_used * 100.0 / v_cap >= 85 then
    return jsonb_build_object('status', 'off');
  end if;
  if v_used + p_units > v_cap or v_used_lookup + p_units > coalesce(v_slice, 0) then
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
