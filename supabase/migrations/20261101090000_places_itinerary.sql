-- Sprint 11 F-029 – F-032 (ADR-016, Raz D2–D9): places, curated places,
-- a trip's saved places and its daily itinerary.
--   places: from Wikidata (CC0), written only by data migrations; read by all.
--   curated_places: "recommended for Israelis", by adm0; published rows read
--     by all; content editors read and write all (has_role), logged.
--   trip_saved_places, itinerary_items: the user's own, owner-only, written
--     only through the RPCs below (consent gate, limits, one transaction).
--   hotels.lat/lng: a point picked on the map (D9); never logged.
--
-- Rollback (dev): drop the four tables and the seven functions below, restore
-- save_hotel from 20261030090000_travel_kit.sql, and drop hotels.lat/lng.

-- ------------------------------------------------------------------ places
create table public.places (
  wikidata_id text not null constraint places_qid_check check (wikidata_id ~ '^Q[0-9]{1,12}$'),
  adm0 text not null constraint places_adm0_check check (adm0 ~ '^[A-Z0-9]{3}$'),
  name_he text constraint places_name_he_check
    check (char_length(name_he) between 1 and 120 and public.text_is_clean(name_he)),
  name_en text not null constraint places_name_en_check
    check (char_length(name_en) between 1 and 120 and public.text_is_clean(name_en)),
  lat double precision not null constraint places_lat_check check (lat between -90 and 90),
  lng double precision not null constraint places_lng_check check (lng between -180 and 180),
  category text not null constraint places_category_check
    check (category in ('attraction', 'nature', 'culture', 'family', 'food', 'shopping')),
  popularity integer not null constraint places_popularity_check check (popularity >= 0),
  -- No longer in Wikidata's answer: hidden, kept for itinerary snapshots (D10).
  hidden boolean not null default false,
  -- A place in two countries (Niagara Falls) is a row in each (Dudi, blocker 1; D24).
  primary key (adm0, wikidata_id)
);
comment on table public.places is
  'Places for "What to see" (sprint 11 F-029), from Wikidata (CC0) by scripts/build-places.mjs. Read by all.';
create index places_area on public.places (adm0, popularity desc, wikidata_id) where not hidden;

alter table public.places enable row level security;
create policy "anyone reads places" on public.places for select to anon, authenticated using (not hidden);
revoke all on public.places from anon, authenticated;
grant select on public.places to anon, authenticated;

-- ---------------------------------------------------------- curated places
create table public.curated_places (
  id uuid primary key default gen_random_uuid(),
  adm0 text not null constraint curated_places_adm0_check check (adm0 ~ '^[A-Z0-9]{3}$'),
  category text not null constraint curated_places_category_check
    check (category in ('kosher', 'chabad', 'memorial', 'attraction', 'nature', 'culture', 'family', 'food', 'shopping')),
  name_he text not null constraint curated_places_name_he_check
    check (char_length(name_he) between 1 and 120 and public.text_is_clean(name_he)),
  name_en text not null constraint curated_places_name_en_check
    check (char_length(name_en) between 1 and 120 and public.text_is_clean(name_en)),
  body text constraint curated_places_body_check
    check (char_length(body) between 1 and 280 and public.text_is_clean(body)),
  lat double precision not null constraint curated_places_lat_check check (lat between -90 and 90),
  lng double precision not null constraint curated_places_lng_check check (lng between -180 and 180),
  source_url text not null constraint curated_places_source_check check (source_url ~ '^https://'),
  verified_at date not null,
  -- The same place in Wikidata: the app hides that row (Raz, Sharona's question 4).
  wikidata_qid text constraint curated_places_qid_check check (wikidata_qid ~ '^Q[0-9]{1,12}$'),
  status text not null default 'draft' constraint curated_places_status_check
    check (status in ('draft', 'published', 'hidden')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.curated_places is
  '"Recommended for Israelis" (sprint 11 F-032), by adm0. Published rows read by all; content editors write (has_role), logged.';
create index curated_places_published on public.curated_places (adm0) where status = 'published';
-- The panel's list by country and status (Raz, Sharona's question 10).
create index curated_places_area_status on public.curated_places (adm0, status);

alter table public.curated_places enable row level security;
-- Two policies: anon may not execute has_role, so it can't be in anon's
-- expression even behind an "or" (Dudi, blocker 2).
create policy "anon reads published curated places"
  on public.curated_places for select to anon
  using (status = 'published');
create policy "users read published curated places, editors all"
  on public.curated_places for select to authenticated
  using (status = 'published' or (select public.has_role('content_editor')));
create policy "editors insert curated places"
  on public.curated_places for insert to authenticated
  with check ((select public.has_role('content_editor')));
create policy "editors update curated places"
  on public.curated_places for update to authenticated
  using ((select public.has_role('content_editor')))
  with check ((select public.has_role('content_editor')));
revoke all on public.curated_places from anon, authenticated;
grant select on public.curated_places to anon, authenticated;
grant insert (adm0, category, name_he, name_en, body, lat, lng, source_url, verified_at, wikidata_qid, status),
  update (adm0, category, name_he, name_en, body, lat, lng, source_url, verified_at, wikidata_qid, status)
  on public.curated_places to authenticated;
create trigger curated_places_touch
  before update on public.curated_places
  for each row execute function public.touch_updated_at();
create trigger curated_places_audit
  after insert or update or delete on public.curated_places
  for each row execute function public.admin_audit('id');

-- ----------------------------------------------------------- hotel points
alter table public.hotels
  add column lat double precision constraint hotels_lat_check check (lat between -90 and 90),
  add column lng double precision constraint hotels_lng_check check (lng between -180 and 180),
  add constraint hotels_point_check check ((lat is null) = (lng is null));

-- ------------------------------------------------------- saved places
create table public.trip_saved_places (
  id uuid primary key,
  trip_id uuid not null,
  user_id uuid not null default auth.uid(),
  -- 'wd:Q123' or 'cu:<uuid>'; no foreign key: the snapshot outlives a hidden place (D4).
  place_ref text not null constraint trip_saved_places_ref_check
    check (place_ref ~ '^(wd:Q[0-9]{1,12}|cu:[0-9a-f-]{36})$'),
  name text not null constraint trip_saved_places_name_check
    check (char_length(name) between 1 and 120 and public.text_is_clean(name)),
  lat double precision not null constraint trip_saved_places_lat_check check (lat between -90 and 90),
  lng double precision not null constraint trip_saved_places_lng_check check (lng between -180 and 180),
  created_at timestamptz not null default now(),
  constraint trip_saved_places_once unique (trip_id, place_ref),
  foreign key (trip_id, user_id) references public.trips (id, user_id) on delete cascade
);
comment on table public.trip_saved_places is
  'A trip''s saved places (sprint 11 AC-6), up to 100. Owner-only; written through save_place and unsave_place.';
create index trip_saved_places_trip on public.trip_saved_places (trip_id, created_at);
create index trip_saved_places_user on public.trip_saved_places (user_id);

alter table public.trip_saved_places enable row level security;
create policy "users read their own saved places"
  on public.trip_saved_places for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.trip_saved_places from anon, authenticated;
grant select on public.trip_saved_places to authenticated;

-- ---------------------------------------------------------- itinerary
create table public.itinerary_items (
  id uuid primary key,
  trip_id uuid not null,
  user_id uuid not null default auth.uid(),
  day_date date not null,
  time_of_day time,
  title text not null constraint itinerary_items_title_check
    check (char_length(title) between 1 and 120 and public.text_is_clean(title)),
  note text constraint itinerary_items_note_check
    check (char_length(note) between 1 and 500 and public.text_is_clean(note)),
  place_ref text constraint itinerary_items_ref_check
    check (place_ref ~ '^(wd:Q[0-9]{1,12}|cu:[0-9a-f-]{36})$'),
  place_name text constraint itinerary_items_place_name_check
    check (char_length(place_name) between 1 and 120 and public.text_is_clean(place_name)),
  lat double precision constraint itinerary_items_lat_check check (lat between -90 and 90),
  lng double precision constraint itinerary_items_lng_check check (lng between -180 and 180),
  source text not null default 'manual' constraint itinerary_items_source_check
    check (source in ('manual', 'auto')),
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint itinerary_items_place_check check (
    (place_ref is null and place_name is null and lat is null and lng is null)
    or (place_ref is not null and place_name is not null and lat is not null and lng is not null)
  ),
  foreign key (trip_id, user_id) references public.trips (id, user_id) on delete cascade
);
comment on table public.itinerary_items is
  'A trip''s daily plan (sprint 11 F-030, F-031). Owner-only; written through the itinerary RPCs.';
create index itinerary_items_day on public.itinerary_items (trip_id, day_date, sort_order);
create index itinerary_items_user on public.itinerary_items (user_id);

alter table public.itinerary_items enable row level security;
create policy "users read their own itinerary"
  on public.itinerary_items for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.itinerary_items from anon, authenticated;
grant select on public.itinerary_items to authenticated;

-- ------------------------------------------------------------- the RPCs
-- Shared opening: signed in, consented, and the trip is the caller's (locked).
-- 'ok', 'gone' (no such trip of yours), 'limit', 'day' (outside the trip).
create function public.itinerary_gate(p_trip_id uuid)
  returns public.trips
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_trip public.trips;
begin
  if auth.uid() is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if not public.has_current_consent() then
    raise exception 'consent to the current documents is required'
      using errcode = '42501', hint = 'consent_required';
  end if;
  -- No such trip of yours: a row of nulls (callers say 'gone').
  select * into v_trip from public.trips where id = p_trip_id and user_id = auth.uid() for update;
  return v_trip;
end;
$$;
revoke execute on function public.itinerary_gate(uuid) from public, anon, authenticated;

-- One call for a new item or a change, a new day included (Raz design
-- approval 2-3). A new item with a time goes before the first later-timed
-- item of its day; without one, at the end. A day change goes to the end of
-- the new day. The order and the 30-a-day limit are decided here, under the
-- trip's lock. 'ok', 'gone', 'limit', 'day' (outside the trip).
create function public.save_itinerary_item(p_id uuid, p_trip_id uuid, p_item jsonb)
  returns text
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  i jsonb := coalesce(p_item, '{}');
  v_trip public.trips := public.itinerary_gate(p_trip_id);
  v_day date;
  v_time time;
  v_old record;
  v_order integer;
  v_ids uuid[];
begin
  if v_trip.id is null then
    return 'gone';
  end if;
  if jsonb_typeof(i) <> 'object' then
    raise exception 'item must be an object' using errcode = '22023';
  end if;
  begin
    v_day := (i ->> 'day')::date;
    v_time := nullif(i ->> 'time', '')::time;
    perform (i ->> 'lat')::double precision, (i ->> 'lng')::double precision;
  exception when others then
    raise exception 'bad day, time or point' using errcode = '22023';
  end;
  if v_day is null or v_day < v_trip.start_date or v_day > v_trip.end_date then
    return 'day';
  end if;
  select day_date, title, time_of_day, source, user_id, trip_id into v_old
  from public.itinerary_items where id = p_id;
  if found and (v_old.user_id <> uid or v_old.trip_id <> p_trip_id) then
    raise exception 'item id already in use' using errcode = '23505';
  end if;
  if (not found or v_old.day_date <> v_day)
     and (select count(*) from public.itinerary_items where trip_id = p_trip_id and day_date = v_day) >= 30 then
    return 'limit';
  end if;
  if not found and (select count(*) from public.itinerary_items where trip_id = p_trip_id) >= 600 then
    return 'limit';
  end if;

  if found then
    update public.itinerary_items set
      title = i ->> 'title', time_of_day = v_time, note = nullif(i ->> 'note', ''),
      place_ref = nullif(i ->> 'placeRef', ''), place_name = nullif(i ->> 'placeName', ''),
      lat = (i ->> 'lat')::double precision, lng = (i ->> 'lng')::double precision,
      -- An edit of the title or time makes an automatic item a manual one (D13).
      source = case when v_old.title = i ->> 'title' and v_old.time_of_day is not distinct from v_time
                    then v_old.source else 'manual' end,
      day_date = v_day,
      sort_order = case when v_old.day_date <> v_day
        then (select coalesce(max(sort_order), 0) + 1024 from public.itinerary_items
              where trip_id = p_trip_id and day_date = v_day)
        else sort_order end,
      updated_at = now()
    where id = p_id;
    return 'ok';
  end if;

  select coalesce(max(sort_order), 0) + 1024 into v_order
  from public.itinerary_items where trip_id = p_trip_id and day_date = v_day;
  insert into public.itinerary_items
    (id, trip_id, user_id, day_date, time_of_day, title, note, place_ref, place_name, lat, lng, source, sort_order)
  values (
    p_id, p_trip_id, uid, v_day, v_time, i ->> 'title', nullif(i ->> 'note', ''),
    nullif(i ->> 'placeRef', ''), nullif(i ->> 'placeName', ''),
    (i ->> 'lat')::double precision, (i ->> 'lng')::double precision, 'manual', v_order
  );
  if v_time is not null then
    -- Before the first item of the day with a later time; the day renumbered.
    select array_agg(id order by
      case when id = p_id then
        coalesce((select min(sort_order) - 1 from public.itinerary_items
                  where trip_id = p_trip_id and day_date = v_day and id <> p_id and time_of_day > v_time),
                 v_order)
      else sort_order end, id)
    into v_ids
    from public.itinerary_items where trip_id = p_trip_id and day_date = v_day;
    update public.itinerary_items t set sort_order = n.pos * 1024
    from unnest(v_ids) with ordinality as n(id, pos) where t.id = n.id;
  end if;
  return 'ok';
end;
$$;
revoke execute on function public.save_itinerary_item(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_itinerary_item(uuid, uuid, jsonb) to authenticated;

-- Moves an item to a day and a position (0 = first); renumbers that day.
create function public.move_itinerary_item(p_id uuid, p_day date, p_position integer)
  returns text
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_item record;
  v_trip public.trips;
  v_ids uuid[];
begin
  select trip_id, day_date into v_item from public.itinerary_items where id = p_id and user_id = uid;
  if not found then
    return 'gone';
  end if;
  v_trip := public.itinerary_gate(v_item.trip_id);
  if v_trip.id is null then
    return 'gone';
  end if;
  -- Read again under the trip's lock: another device may have moved it (Dudi 6).
  select trip_id, day_date into v_item
  from public.itinerary_items where id = p_id and user_id = uid for update;
  if not found or v_item.trip_id <> v_trip.id then
    return 'gone';
  end if;
  if p_day is null or p_day < v_trip.start_date or p_day > v_trip.end_date then
    return 'day';
  end if;
  if p_day <> v_item.day_date
     and (select count(*) from public.itinerary_items where trip_id = v_item.trip_id and day_date = p_day) >= 30 then
    return 'limit';
  end if;
  select coalesce(array_agg(id order by sort_order, id), '{}') into v_ids
  from public.itinerary_items where trip_id = v_item.trip_id and day_date = p_day and id <> p_id;
  v_ids := v_ids[1:greatest(0, least(coalesce(p_position, 0), cardinality(v_ids)))] || p_id
    || v_ids[greatest(0, least(coalesce(p_position, 0), cardinality(v_ids))) + 1:];
  update public.itinerary_items t
    set day_date = p_day, sort_order = n.pos * 1024, updated_at = now()
  from unnest(v_ids) with ordinality as n(id, pos)
  where t.id = n.id;
  return 'ok';
end;
$$;
revoke execute on function public.move_itinerary_item(uuid, date, integer) from public, anon;
grant execute on function public.move_itinerary_item(uuid, date, integer) to authenticated;

create function public.delete_itinerary_item(p_id uuid)
  returns text
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  delete from public.itinerary_items where id = p_id and user_id = auth.uid();
  return case when found then 'ok' else 'gone' end;
end;
$$;
revoke execute on function public.delete_itinerary_item(uuid) from public, anon;
grant execute on function public.delete_itinerary_item(uuid) to authenticated;

-- D2 (Raz design approval 1): the planner's items go only into days that are
-- still empty here. Each skipped day comes back with its reason:
-- filled_meanwhile (another device added to it) or out_of_range (the trip's
-- dates changed). result: ok, gone (no such trip of yours), limit (600 a trip,
-- 30 a day). Every item is checked before anything is written (Dudi 3).
create function public.apply_auto_plan(p_trip_id uuid, p_items jsonb)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_trip public.trips := public.itinerary_gate(p_trip_id);
  v_skipped jsonb := '[]';
  v_skip_days date[] := '{}';
  v_inserted integer := 0;
  v_day date;
  i jsonb;
begin
  if v_trip.id is null then
    return jsonb_build_object('result', 'gone');
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 300 then
    raise exception 'items must be an array of at most 300' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) x
    where jsonb_typeof(x) <> 'object' or x ->> 'day' is null
       or jsonb_typeof(x -> 'order') is distinct from 'number'
  ) then
    raise exception 'each item needs a day and an order' using errcode = '22023';
  end if;
  begin
    perform (x ->> 'id')::uuid, (x ->> 'day')::date, nullif(x ->> 'time', '')::time,
      (x ->> 'lat')::double precision, (x ->> 'lng')::double precision
    from jsonb_array_elements(p_items) x;
  exception when others then
    raise exception 'bad item' using errcode = '22023';
  end;
  if exists (
    select 1 from jsonb_array_elements(p_items) x
    where (x ->> 'order')::numeric not between 0 and 29
       or (x ->> 'order')::numeric <> trunc((x ->> 'order')::numeric)
  ) then
    raise exception 'an order is from 0 to 29' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) x group by x ->> 'day' having count(*) > 30
  ) then
    return jsonb_build_object('result', 'limit');
  end if;
  for v_day in
    select distinct (x ->> 'day')::date from jsonb_array_elements(p_items) x order by 1
  loop
    if v_day < v_trip.start_date or v_day > v_trip.end_date then
      v_skip_days := v_skip_days || v_day;
      v_skipped := v_skipped || jsonb_build_object('date', v_day, 'reason', 'out_of_range');
    elsif exists (select 1 from public.itinerary_items where trip_id = p_trip_id and day_date = v_day) then
      v_skip_days := v_skip_days || v_day;
      v_skipped := v_skipped || jsonb_build_object('date', v_day, 'reason', 'filled_meanwhile');
    end if;
  end loop;
  if (select count(*) from public.itinerary_items where trip_id = p_trip_id)
     + (select count(*) from jsonb_array_elements(p_items) x
        where not ((x ->> 'day')::date = any (v_skip_days))) > 600 then
    return jsonb_build_object('result', 'limit');
  end if;
  for i in select * from jsonb_array_elements(p_items) loop
    if (i ->> 'day')::date = any (v_skip_days) then
      continue;
    end if;
    insert into public.itinerary_items
      (id, trip_id, user_id, day_date, time_of_day, title, place_ref, place_name, lat, lng, source, sort_order)
    values (
      (i ->> 'id')::uuid, p_trip_id, uid, (i ->> 'day')::date, nullif(i ->> 'time', '')::time,
      i ->> 'title', nullif(i ->> 'placeRef', ''), nullif(i ->> 'placeName', ''),
      (i ->> 'lat')::double precision, (i ->> 'lng')::double precision, 'auto',
      ((i ->> 'order')::integer + 1) * 1024
    );
    v_inserted := v_inserted + 1;
  end loop;
  return jsonb_build_object('result', 'ok', 'inserted', v_inserted, 'skipped', v_skipped);
end;
$$;
revoke execute on function public.apply_auto_plan(uuid, jsonb) from public, anon;
grant execute on function public.apply_auto_plan(uuid, jsonb) to authenticated;

create function public.save_place(p_id uuid, p_trip_id uuid, p_place jsonb)
  returns text
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  p jsonb := coalesce(p_place, '{}');
  v_trip public.trips := public.itinerary_gate(p_trip_id);
begin
  if v_trip.id is null then
    return 'gone';
  end if;
  if jsonb_typeof(p) <> 'object' then
    raise exception 'place must be an object' using errcode = '22023';
  end if;
  begin
    perform (p ->> 'lat')::double precision, (p ->> 'lng')::double precision;
  exception when others then
    raise exception 'bad point' using errcode = '22023';
  end;
  if exists (select 1 from public.trip_saved_places where trip_id = p_trip_id and place_ref = p ->> 'placeRef') then
    return 'ok';
  end if;
  if (select count(*) from public.trip_saved_places where trip_id = p_trip_id) >= 100 then
    return 'limit';
  end if;
  insert into public.trip_saved_places (id, trip_id, user_id, place_ref, name, lat, lng)
  values (p_id, p_trip_id, uid, p ->> 'placeRef', p ->> 'name',
          (p ->> 'lat')::double precision, (p ->> 'lng')::double precision);
  return 'ok';
end;
$$;
revoke execute on function public.save_place(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_place(uuid, uuid, jsonb) to authenticated;

create function public.unsave_place(p_trip_id uuid, p_place_ref text)
  returns text
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  delete from public.trip_saved_places
  where trip_id = p_trip_id and place_ref = p_place_ref and user_id = auth.uid();
  return case when found then 'ok' else 'gone' end;
end;
$$;
revoke execute on function public.unsave_place(uuid, text) from public, anon;
grant execute on function public.unsave_place(uuid, text) to authenticated;

-- ------------------------------------------------- save_hotel with its point
-- Sprint 11 D9: the point picked on the map, saved with the rest of the hotel (one
-- save path, Raz design approval 5). Same rules as sprint 8 otherwise.
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
    perform (h ->> 'lat')::double precision, (h ->> 'lng')::double precision;
  exception when others then
    raise exception 'bad date or point' using errcode = '22023';
  end;

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
    (id, trip_id, user_id, name, address_en, address_local, phone, check_in, check_out, booking_ref, lat, lng)
  values (
    p_id, p_trip_id, uid, h ->> 'name', h ->> 'addressEn', nullif(h ->> 'addressLocal', ''),
    nullif(h ->> 'phone', ''), v_in, v_out, nullif(h ->> 'bookingRef', ''),
    (h ->> 'lat')::double precision, (h ->> 'lng')::double precision
  )
  on conflict (id) do update
    set name = excluded.name, address_en = excluded.address_en,
        address_local = excluded.address_local, phone = excluded.phone,
        check_in = excluded.check_in, check_out = excluded.check_out,
        booking_ref = excluded.booking_ref,
        -- An older app sends no point: it keeps the one saved (Dudi 8).
        lat = case when h ? 'lat' then excluded.lat else t.lat end,
        lng = case when h ? 'lng' then excluded.lng else t.lng end,
        updated_at = now()
    -- A reused id never moves another user's or another trip's hotel.
    where t.user_id = uid and t.trip_id = p_trip_id;
  if not found then
    raise exception 'hotel id already in use' using errcode = '23505';
  end if;
  return 'ok';
end;
$$;
revoke execute on function public.save_hotel(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_hotel(uuid, uuid, jsonb) to authenticated;
