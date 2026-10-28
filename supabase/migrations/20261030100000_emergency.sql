-- Sprint 8 F-022 (AC-11 to AC-17): what the emergency card and the SOS screen
-- show for a country. Public reference data, keyed by adm0 like
-- country_advisories; written only by migrations until the sprint 10 admin.
--   emergency_numbers: one row per country, with two separate facts
--     (Raz, design 6): mission_status (is there an Israeli mission serving
--     it?) and numbers_status (were the local numbers checked?).
--   missions: Israel's missions, from the data.gov.il dataset ntz-short;
--     covers[] lists the countries each one serves.
-- A territory with no row of its own uses its sovereign's (the app maps it).

create table public.emergency_numbers (
  adm0 text primary key constraint emergency_numbers_adm0_check check (adm0 ~ '^[A-Z0-9]{3}$'),
  police text constraint emergency_numbers_police_check check (police ~ '^[0-9]{2,6}$'),
  ambulance text constraint emergency_numbers_ambulance_check check (ambulance ~ '^[0-9]{2,6}$'),
  fire text constraint emergency_numbers_fire_check check (fire ~ '^[0-9]{2,6}$'),
  tourist_police text constraint emergency_numbers_tourist_check check (tourist_police ~ '^[0-9]{2,8}$'),
  -- One number for all services (112, 911), when the country has one.
  shared text constraint emergency_numbers_shared_check check (shared ~ '^[0-9]{2,6}$'),
  numbers_status text not null default 'pending'
    constraint emergency_numbers_numbers_status_check check (numbers_status in ('verified', 'pending')),
  mission_status text not null default 'pending'
    constraint emergency_numbers_mission_status_check check (mission_status in ('covered', 'none', 'pending')),
  source_url text constraint emergency_numbers_source_check check (source_url ~ '^https://'),
  verified_at date,
  -- "בהשלמה" is never a guess: a checked row says where and when (AC-14).
  constraint emergency_numbers_verified_check check (
    numbers_status = 'pending' or (source_url is not null and verified_at is not null
      and coalesce(police, ambulance, fire, shared) is not null)
  ),
  -- "No Israeli mission" is a fact with a source too.
  constraint emergency_numbers_none_check check (mission_status <> 'none' or source_url is not null)
);

comment on table public.emergency_numbers is
  'Local emergency numbers and mission status per country (sprint 8 F-022). Read by all; written by migrations.';

create table public.missions (
  id integer primary key,
  -- The host country.
  adm0 text not null constraint missions_adm0_check check (adm0 ~ '^[A-Z0-9]{3}$'),
  kind text not null constraint missions_kind_check check (kind in ('embassy', 'consulate', 'office')),
  name_he text not null,
  name_en text not null,
  city_he text,
  city_en text,
  address_he text,
  address_en text,
  hours_he text,
  hours_en text,
  -- E.164, normalised at import; the raw text is never shown (Raz, design 6).
  phone text constraint missions_phone_check check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  emergency_phone text constraint missions_emergency_phone_check check (emergency_phone ~ '^\+[1-9][0-9]{7,14}$'),
  -- The countries it serves, the host first.
  covers text[] not null constraint missions_covers_check check (cardinality(covers) between 1 and 20),
  source_url text not null constraint missions_source_check check (source_url ~ '^https://'),
  verified_at date not null
);

comment on table public.missions is
  'Israel''s missions abroad (sprint 8 F-022), from data.gov.il ntz-short. Read by all; written by migrations.';

create index missions_covers on public.missions using gin (covers);

alter table public.emergency_numbers enable row level security;
alter table public.missions enable row level security;
create policy "everyone reads emergency numbers" on public.emergency_numbers for select to anon, authenticated using (true);
create policy "everyone reads missions" on public.missions for select to anon, authenticated using (true);
revoke all on public.emergency_numbers, public.missions from anon, authenticated;
grant select on public.emergency_numbers, public.missions to anon, authenticated;
