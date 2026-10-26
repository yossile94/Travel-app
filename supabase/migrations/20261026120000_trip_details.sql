-- Sprint 3 F-007 and F-008 (AC-1 to AC-5): travelers and cities of a trip,
-- and one save for the whole trip (ADR-007: the trip is the aggregate).
-- Travelers have no account; only a name and an optional relation are kept
-- (data minimisation). Cities keep a snapshot of their name, so a city that
-- leaves a later GeoNames build, or one typed in by hand, still shows.

-- Text shown inside right-to-left UI: no control or bidi-control characters
-- (sprint 3 design 6.3, Raz). Used by both child tables.
create function public.text_is_clean(t text)
  returns boolean
  language sql
  immutable
  set search_path = ''
as $$
  select t !~ '[\x01-\x1f\x7f-\x9f‪-‮⁦-⁩]';
$$;

revoke execute on function public.text_is_clean(text) from public, anon;
grant execute on function public.text_is_clean(text) to authenticated;

-- The children reference (id, user_id), so their owner is the trip's owner
-- and RLS needs no join.
alter table public.trips add constraint trips_id_user_key unique (id, user_id);

create table public.trip_travelers (
  trip_id uuid not null,
  user_id uuid not null default auth.uid(),
  -- "Me" is not stored; up to 9 more (AC-1).
  position smallint not null constraint trip_travelers_position_check check (position between 0 and 8),
  name text not null
    constraint trip_travelers_name_check
    check (name = btrim(name) and char_length(name) between 1 and 40 and public.text_is_clean(name)),
  relation text
    constraint trip_travelers_relation_check
    check (relation in ('partner', 'child', 'parent', 'friend', 'other')),
  primary key (trip_id, position),
  foreign key (trip_id, user_id) references public.trips (id, user_id) on delete cascade
);

comment on table public.trip_travelers is
  'Travelers without an account on a trip (sprint 3 F-007). Owner-only; writes need consent.';

create table public.trip_cities (
  trip_id uuid not null,
  user_id uuid not null default auth.uid(),
  -- In the order they were added; the same city may appear twice (AC-4).
  position smallint not null constraint trip_cities_position_check check (position between 0 and 9),
  -- Null for a city typed in by hand (not in the bundled list).
  geoname_id integer constraint trip_cities_geoname_check check (geoname_id > 0),
  name text not null
    constraint trip_cities_name_check
    check (name = btrim(name) and char_length(name) between 1 and 60 and public.text_is_clean(name)),
  primary key (trip_id, position),
  foreign key (trip_id, user_id) references public.trips (id, user_id) on delete cascade
);

comment on table public.trip_cities is
  'The cities of a trip, in order (sprint 3 F-008). Owner-only; writes need consent.';

-- The export reads by user (sprint 2 review); the primary key serves the trip.
create index trip_travelers_user on public.trip_travelers (user_id);
create index trip_cities_user on public.trip_cities (user_id);

alter table public.trip_travelers enable row level security;
alter table public.trip_cities enable row level security;

create policy "users read their own travelers"
  on public.trip_travelers for select to authenticated
  using (user_id = (select auth.uid()));
create policy "users add travelers with consent"
  on public.trip_travelers for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.has_current_consent()));
-- Removing a traveler is an edit of the trip, so it needs consent too. A
-- trip deleted without consent still takes its travelers (the cascade
-- doesn't go through RLS).
create policy "users remove travelers with consent"
  on public.trip_travelers for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.has_current_consent()));

create policy "users read their own cities"
  on public.trip_cities for select to authenticated
  using (user_id = (select auth.uid()));
create policy "users add cities with consent"
  on public.trip_cities for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.has_current_consent()));
create policy "users remove cities with consent"
  on public.trip_cities for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.has_current_consent()));

-- No updates: a save replaces the children (save_trip below).
revoke all on public.trip_travelers, public.trip_cities from anon, authenticated;
grant select, delete on public.trip_travelers, public.trip_cities to authenticated;
grant insert (trip_id, position, name, relation) on public.trip_travelers to authenticated;
grant insert (trip_id, position, geoname_id, name) on public.trip_cities to authenticated;

-- One save for a whole trip, in one transaction (sprint 3 infrastructure,
-- Raz). security invoker: RLS, the column grants and the consent gate all
-- apply as for direct writes.
--   create: insert with the device's id. The same id again (a retry after a
--     lost answer) writes the current values over the first save.
--   update: the trip row first (row lock, updated_at, the consent check);
--     no row means deleted elsewhere: 'gone', never re-created (sprint 2 AC-6).
-- Then the travelers and cities are replaced. Returns 'ok' or 'gone'.
create function public.save_trip(
  p_mode text,
  p_id uuid,
  p_country_adm0 text,
  p_title text,
  p_start date,
  p_end date,
  p_notes text,
  p_travelers jsonb default '[]',
  p_cities jsonb default '[]'
)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  changed integer;
  travelers jsonb := coalesce(p_travelers, '[]');
  cities jsonb := coalesce(p_cities, '[]');
begin
  -- A distinct hint: the app opens the consent screen for this 42501 only,
  -- not for a missing grant (Raz).
  if not (select public.has_current_consent()) then
    raise exception 'consent to the current documents is required'
      using errcode = '42501', hint = 'consent_required';
  end if;
  if jsonb_typeof(travelers) <> 'array' or jsonb_array_length(travelers) > 9 then
    raise exception 'travelers must be a list of at most 9' using errcode = '22023';
  end if;
  if jsonb_typeof(cities) <> 'array' or jsonb_array_length(cities) > 10 then
    raise exception 'cities must be a list of at most 10' using errcode = '22023';
  end if;

  if p_mode = 'create' then
    insert into public.trips (id, country_adm0, title, start_date, end_date, notes)
    values (p_id, p_country_adm0, p_title, p_start, p_end, p_notes)
    on conflict (id) do nothing;
    if not found then
      -- Ours (a retry): write the current values. Not ours: RLS hides it.
      update public.trips
      set title = p_title, start_date = p_start, end_date = p_end, notes = p_notes
      where id = p_id;
      get diagnostics changed = row_count;
      if changed = 0 then
        raise exception 'trip id already in use' using errcode = '23505';
      end if;
    end if;
  elsif p_mode = 'update' then
    update public.trips
    set title = p_title, start_date = p_start, end_date = p_end, notes = p_notes
    where id = p_id;
    get diagnostics changed = row_count;
    if changed = 0 then
      return 'gone';
    end if;
  else
    raise exception 'mode must be create or update' using errcode = '22023';
  end if;

  delete from public.trip_travelers where trip_id = p_id;
  insert into public.trip_travelers (trip_id, position, name, relation)
  select p_id, (t.ord - 1)::smallint, t.item ->> 'name', nullif(t.item ->> 'relation', '')
  from jsonb_array_elements(travelers) with ordinality as t(item, ord);

  delete from public.trip_cities where trip_id = p_id;
  insert into public.trip_cities (trip_id, position, geoname_id, name)
  select p_id, (c.ord - 1)::smallint, (c.item ->> 'geonameId')::integer, c.item ->> 'name'
  from jsonb_array_elements(cities) with ordinality as c(item, ord);

  return 'ok';
end;
$$;

revoke execute on function public.save_trip(text, uuid, text, text, date, date, text, jsonb, jsonb)
  from public, anon;
grant execute on function public.save_trip(text, uuid, text, text, date, date, text, jsonb, jsonb)
  to authenticated;
