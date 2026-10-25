-- Sprint 2 F-006 (AC-1 to AC-10): the user's trips, first part of spec 5.2.
-- No status column yet (sprint 3): "upcoming" and "past" come from the dates.
-- Deletion is a hard delete until sync arrives in sprints 3-4 (deleted_at
-- and a version number then come in their own migration).

-- True when the signed-in user's latest decision on the current terms and
-- the current privacy policy is "granted" (Yossi's decision 4, sprint 2: no
-- trip writes without consent, even from a modified client).
create function public.has_current_consent()
  returns boolean
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select count(*) = 2
  from public.current_legal_documents d
  where (
    select c.action
    from public.consents c
    where c.user_id = (select auth.uid())
      and c.doc_type = d.doc_type
      and c.doc_version = d.version
    order by c.created_at desc, c.id desc
    limit 1
  ) = 'granted';
$$;

revoke execute on function public.has_current_consent() from public, anon;
grant execute on function public.has_current_consent() to authenticated;

create table public.trips (
  -- Created on the device, so a retried save can't make a second trip (AC-3).
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  country_iso2 text not null constraint trips_country_check check (country_iso2 ~ '^[A-Z]{2}$'),
  title text not null
    constraint trips_title_check
    check (title = btrim(title) and char_length(title) between 1 and 80),
  start_date date not null,
  end_date date not null,
  notes text constraint trips_notes_check check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trips_dates_check check (end_date >= start_date)
);

comment on table public.trips is
  'A user''s trips (sprint 2 F-006). Owner-only; writes need consent to the current documents.';

-- "My trips" in both directions with keyset pagination on (start_date, id)
-- (AC-5), and the trips of one user for the globe and the card.
create index trips_user_start on public.trips (user_id, start_date, id);

alter table public.trips enable row level security;

create policy "users read their own trips"
  on public.trips for select
  to authenticated
  using (user_id = (select auth.uid()));

-- The consent gate sits in WITH CHECK, so a refused write fails with 42501
-- (the app shows the consent screen) instead of matching no rows, which the
-- app reads as "deleted on another device" (design review, sprint 2).
create policy "users add trips with consent"
  on public.trips for insert
  to authenticated
  with check (user_id = (select auth.uid()) and (select public.has_current_consent()));

create policy "users edit their own trips with consent"
  on public.trips for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (select public.has_current_consent()));

-- Deleting is always allowed to the owner, consent or not (sprint 2 AC-9).
create policy "users delete their own trips"
  on public.trips for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- The country never changes after creation (AC-2); the server keeps the
-- owner and the times.
revoke all on public.trips from anon, authenticated;
grant select, delete on public.trips to authenticated;
grant insert (id, country_iso2, title, start_date, end_date, notes) on public.trips to authenticated;
grant update (title, start_date, end_date, notes) on public.trips to authenticated;

create function public.trips_before_update()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.trips_before_update() from public, anon, authenticated;

create trigger trips_before_update
  before update on public.trips
  for each row execute function public.trips_before_update();

-- The countries the user has trips to, for the globe highlight (AC-10): one
-- query, separate from the paged list. PostgREST has no "distinct".
create function public.my_trip_countries()
  returns setof text
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select distinct t.country_iso2
  from public.trips t
  where t.user_id = (select auth.uid());
$$;

revoke execute on function public.my_trip_countries() from public, anon;
grant execute on function public.my_trip_countries() to authenticated;
