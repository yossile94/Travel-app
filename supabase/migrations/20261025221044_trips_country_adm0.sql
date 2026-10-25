-- Sprint 2 F-006: a trip names its destination by the globe's area code
-- (Natural Earth adm0, three capitals, e.g. "THA"), not by ISO 3166 alpha-2.
-- ISO codes are not unique per area on the globe (some territories share
-- their sovereign's code), so a trip to one would show on the other's card.
-- The table was still empty on staging when this changed (2026-10-26).

alter table public.trips rename column country_iso2 to country_adm0;

alter table public.trips drop constraint trips_country_check;
alter table public.trips
  add constraint trips_country_check check (country_adm0 ~ '^[A-Z]{3}$');

-- Column privileges follow the column through a rename; the function body
-- names the column, so it is replaced.
create or replace function public.my_trip_countries()
  returns setof text
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select distinct t.country_adm0
  from public.trips t
  where t.user_id = (select auth.uid());
$$;
