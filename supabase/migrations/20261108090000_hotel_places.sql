-- Sprint 14 F-043 (AC-2 – AC-4, ADR-021): hotel search with Google Places.
--   hotels.name_local      the hotel's name in the country's language (driver card).
--   hotels.place_id        Google's id: kept, so the point can be refreshed.
--   hotels.place_fetched_at when the point came from Google. Google allows the
--                          point for 30 days: after that it is refreshed by the
--                          app or cleared here, unless the user moved it.
--   hotels.place_edited    the fields the user changed after a pick: a refresh
--                          never writes over them.
--   Text fields the user reviewed and saved are their own entry (ADR-021).
--   There is no table of hotels shared between users.
--
--   places_calls / places_month: the user's daily count and the project's
--   monthly budget, taken in one step by take_places_call (service role only)
--   The English Details call of a pick (Places Details Pro) isn't counted on
--   its own: it is bounded by the 800 picks, under Pro's free 5,000 (Dudi 8).
--   before Google is asked. The caps are rows in provider_caps (Raz #8 of
--   sprint 5): picks 800 of Enterprise's free 1,000 (the phone field), searches
--   9,000 of Autocomplete's free 10,000, refreshes 8,000 of Essentials' 10,000.

-- ------------------------------------------------------------------ hotels
alter table public.hotels
  add column name_local text constraint hotels_name_local_check
    check (char_length(name_local) between 1 and 120 and public.text_is_clean(name_local)),
  add column place_id text constraint hotels_place_id_check
    check (char_length(place_id) between 10 and 300 and place_id ~ '^[A-Za-z0-9_-]+$'),
  add column place_fetched_at timestamptz,
  add column place_edited text[] not null default '{}' constraint hotels_place_edited_check
    check (place_edited <@ array['name', 'nameLocal', 'addressEn', 'addressLocal', 'phone', 'point']),
  add constraint hotels_place_check check ((place_id is null) = (place_fetched_at is null));

comment on column public.hotels.place_fetched_at is
  'When the point came from Google Places; it is kept 30 days unless the user moved it (ADR-021).';

-- The daily clean-up finds Google points past 30 days by this.
create index hotels_place_fetched on public.hotels (place_fetched_at)
  where place_id is not null and lat is not null and not ('point' = any (place_edited));

-- ------------------------------------------------------------- save_hotel
-- Sprint 11's save_hotel with the Places fields. An older app sends none of
-- them and keeps what is saved. A point from Google older than 30 days is not
-- kept, whatever the app sent, unless the user moved it.
create or replace function public.save_hotel(p_id uuid, p_trip_id uuid, p_hotel jsonb)
  returns text
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  h jsonb := coalesce(p_hotel, '{}');
  v_in date;
  v_out date;
  v_fetched timestamptz;
  v_edited text[];
  v_lat double precision;
  v_lng double precision;
  v_trip record;
begin
  if uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if not public.has_current_consent() then
    raise exception 'consent to the current documents is required'
      using errcode = '42501', hint = 'consent_required';
  end if;
  if jsonb_typeof(h) <> 'object' then
    raise exception 'hotel must be an object' using errcode = '22023';
  end if;
  begin
    v_in := (h ->> 'checkIn')::date;
    v_out := (h ->> 'checkOut')::date;
    v_lat := (h ->> 'lat')::double precision;
    v_lng := (h ->> 'lng')::double precision;
    v_fetched := (h ->> 'placeFetchedAt')::timestamptz;
    v_edited := coalesce(
      (select array_agg(distinct e order by e) from jsonb_array_elements_text(h -> 'placeEdited') e),
      '{}'
    );
  exception when others then
    raise exception 'bad date, point or place fields' using errcode = '22023';
  end;
  if (h ->> 'placeId') is null then
    v_fetched := null;
  elsif v_fetched is null or v_fetched > now() + interval '5 minutes' then
    raise exception 'bad place time' using errcode = '22023';
  end if;

  select start_date, end_date into v_trip
  from public.trips where id = p_trip_id and user_id = uid for update;
  if not found then
    return 'gone';
  end if;
  if v_in is null or v_out is null or v_in < v_trip.start_date or v_out > v_trip.end_date then
    return 'dates';
  end if;
  if (select count(*) from public.hotels where trip_id = p_trip_id and id <> p_id) >= 10 then
    return 'limit';
  end if;

  insert into public.hotels as t
    (id, trip_id, user_id, name, address_en, address_local, phone, check_in, check_out,
     booking_ref, lat, lng, name_local, place_id, place_fetched_at, place_edited)
  values (
    p_id, p_trip_id, uid, h ->> 'name', h ->> 'addressEn', nullif(h ->> 'addressLocal', ''),
    nullif(h ->> 'phone', ''), v_in, v_out, nullif(h ->> 'bookingRef', ''), v_lat, v_lng,
    nullif(h ->> 'nameLocal', ''), h ->> 'placeId', v_fetched, v_edited
  )
  on conflict (id) do update
    set name = excluded.name, address_en = excluded.address_en,
        address_local = excluded.address_local, phone = excluded.phone,
        check_in = excluded.check_in, check_out = excluded.check_out,
        booking_ref = excluded.booking_ref,
        -- An older app sends no point and no Places fields: it keeps the saved
        -- ones (Dudi 8 of sprint 11).
        lat = case when h ? 'lat' then excluded.lat else t.lat end,
        lng = case when h ? 'lng' then excluded.lng else t.lng end,
        name_local = case when h ? 'nameLocal' then excluded.name_local else t.name_local end,
        place_id = case when h ? 'placeId' then excluded.place_id else t.place_id end,
        place_fetched_at = case when h ? 'placeId' then excluded.place_fetched_at else t.place_fetched_at end,
        place_edited = case
          when h ? 'placeEdited' then excluded.place_edited
          -- A sprint-11 app that moves a live Google point sends no
          -- placeEdited: the moved point is the user's own (Dudi 3c).
          when h ? 'lat' and t.place_id is not null and t.lat is not null
               and (excluded.lat, excluded.lng) is distinct from (t.lat, t.lng)
            then (select array_agg(distinct e order by e) from unnest(t.place_edited || '{point}'::text[]) e)
          else t.place_edited
        end,
        updated_at = now()
    -- A reused id never moves another user's or another trip's hotel.
    where t.user_id = uid and t.trip_id = p_trip_id;
  if not found then
    raise exception 'hotel id already in use' using errcode = '23505';
  end if;
  -- Google's 30 days, on the row as saved, whatever the app sent (Dudi 3a, 3b).
  update public.hotels set lat = null, lng = null
  where id = p_id and place_id is not null and lat is not null
    and place_fetched_at < now() - interval '30 days'
    and not ('point' = any (place_edited));
  return 'ok';
end;
$$;
revoke execute on function public.save_hotel(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_hotel(uuid, uuid, jsonb) to authenticated;

-- ------------------------------------------------------------ the budget
alter table public.provider_caps drop constraint provider_caps_provider_check;
alter table public.provider_caps add constraint provider_caps_provider_check
  check (provider in ('aerodatabox', 'places_search', 'places_pick', 'places_refresh'));
insert into public.provider_caps (provider, cap)
values ('places_search', 9000), ('places_pick', 800), ('places_refresh', 8000);

create table public.places_calls (
  -- A deleted account's counts go with it (Dudi 1, as flight_lookups).
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  searches smallint not null default 0 check (searches >= 0),
  picks smallint not null default 0 check (picks >= 0),
  refreshes smallint not null default 0 check (refreshes >= 0),
  primary key (user_id, day)
);
alter table public.places_calls enable row level security;
revoke all on public.places_calls from anon, authenticated;

create table public.places_month (
  month date primary key check (extract(day from month) = 1),
  searches integer not null default 0 check (searches >= 0),
  picks integer not null default 0 check (picks >= 0),
  refreshes integer not null default 0 check (refreshes >= 0)
);
alter table public.places_month enable row level security;
revoke all on public.places_month from anon, authenticated;

-- One call of a kind: true while the user's day (100 searches, 20 picks, 20
-- refreshes, UTC) and the project's calendar month (Google's, Pacific time)
-- both have room; both counts move together or not at all. The advisory lock
-- makes the monthly check and add one step for concurrent callers.
create function public.take_places_call(p_user uuid, p_kind text)
  returns boolean
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  today date := (now() at time zone 'utc')::date;
  -- Google bills by calendar month in Pacific time (Dudi 2).
  this_month date := date_trunc('month', now() at time zone 'America/Los_Angeles')::date;
  per_user integer := case p_kind when 'search' then 100 when 'pick' then 20 when 'refresh' then 20 end;
  cap integer := (select c.cap from public.provider_caps c where c.provider = 'places_' || p_kind);
  used integer;
begin
  if p_user is null or per_user is null then
    raise exception 'take_places_call: bad user or kind';
  end if;
  perform pg_advisory_xact_lock(hashtext('places_month:' || p_kind));
  select case p_kind when 'search' then m.searches when 'pick' then m.picks else m.refreshes end
    into used
  from public.places_month m where m.month = this_month;
  if cap is null or coalesce(used, 0) >= cap then
    return false;
  end if;

  insert into public.places_calls (user_id, day) values (p_user, today)
  on conflict (user_id, day) do nothing;
  update public.places_calls c
    set searches = c.searches + (p_kind = 'search')::integer,
        picks = c.picks + (p_kind = 'pick')::integer,
        refreshes = c.refreshes + (p_kind = 'refresh')::integer
  where c.user_id = p_user and c.day = today
    and case p_kind when 'search' then c.searches when 'pick' then c.picks else c.refreshes end
        < per_user;
  if not found then
    return false;
  end if;

  insert into public.places_month as m (month, searches, picks, refreshes)
  values (this_month, (p_kind = 'search')::integer, (p_kind = 'pick')::integer,
          (p_kind = 'refresh')::integer)
  on conflict (month) do update
    set searches = m.searches + excluded.searches,
        picks = m.picks + excluded.picks,
        refreshes = m.refreshes + excluded.refreshes;
  -- Once, by the call that fills the month, not by every refusal after it (Dudi 6).
  if coalesce(used, 0) + 1 = cap then
    raise log 'take_places_call: % reached the monthly cap of %', p_kind, cap;
  end if;
  return true;
end;
$$;
revoke execute on function public.take_places_call(uuid, text) from public, anon, authenticated;
grant execute on function public.take_places_call(uuid, text) to service_role;

-- ------------------------------------------------------------- retention
-- Daily: Google points past 30 days that the user didn't move are cleared
-- (ADR-021; the app refreshes them first when it has a network), and old
-- counter rows go.
create function public.places_retention()
  returns void
  language sql
  security definer
  set search_path = ''
as $$
  update public.hotels
    set lat = null, lng = null
  where place_id is not null
    and place_fetched_at < now() - interval '30 days'
    and lat is not null
    and not ('point' = any (place_edited));
  delete from public.places_calls where day < (now() at time zone 'utc')::date - 2;
  delete from public.places_month where month < (now() at time zone 'utc')::date - interval '13 months';
$$;
revoke execute on function public.places_retention() from public, anon, authenticated;

select cron.schedule('places-retention', '40 3 * * *', $$select public.places_retention()$$);
