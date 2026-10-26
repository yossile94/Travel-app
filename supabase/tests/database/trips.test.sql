-- Sprint 2 AC-2, AC-3, AC-9, AC-10: trips are the owner's alone, validated
-- by the database, written only with consent to the current documents, and
-- the globe highlight comes from one distinct-countries query.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

insert into auth.users (id, email)
values
  ('00000000-0000-4000-8000-00000000002a', 'a@example.test'),
  ('00000000-0000-4000-8000-00000000002b', 'b@example.test'),
  ('00000000-0000-4000-8000-00000000002c', 'c@example.test'),
  ('00000000-0000-4000-8000-00000000002d', 'd@example.test');

create function pg_temp.sign_in(user_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
$$;

-- A and B consent to the current documents (version 0); C never does.
create function pg_temp.consent() returns void language sql as $$
  insert into public.consents (doc_type, doc_version, action, platform, app_version)
  values ('terms', 0, 'granted', 'android', '0.3.0'), ('privacy', 0, 'granted', 'android', '0.3.0');
$$;
select pg_temp.sign_in('00000000-0000-4000-8000-00000000002a');
select pg_temp.consent();
reset role;
select pg_temp.sign_in('00000000-0000-4000-8000-00000000002b');
select pg_temp.consent();
reset role;

-- ---------------------------------------------------------------- structure
select ok(
  (select relrowsecurity from pg_class where oid = 'public.trips'::regclass),
  'RLS is on for trips'
);
select has_index('public', 'trips', 'trips_user_start', array['user_id', 'start_date', 'id'],
  'trips are indexed for keyset pages of one user');
select is(
  (select confdeltype from pg_constraint
   where conrelid = 'public.trips'::regclass and contype = 'f'),
  'c',
  'trips are deleted with their user'
);
select table_privs_are('public', 'trips', 'anon', array[]::text[],
  'signed-out clients have no privileges on trips');
select table_privs_are('public', 'trips', 'authenticated', array['SELECT', 'DELETE'],
  'users insert and update trips only through column grants');
select ok(
  not has_column_privilege('authenticated', 'public.trips', 'user_id', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.trips', 'country_adm0', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.trips', 'user_id', 'INSERT'),
  'the owner and the country never change, and the owner is set by the server'
);
select function_privs_are('public', 'my_trip_countries', array[]::text[], 'anon', array[]::text[],
  'signed-out clients cannot ask for trip countries');

-- -------------------------------------------------------- signed out (anon)
set local role anon;
select throws_ok(
  $$ insert into public.trips (country_adm0, title, start_date, end_date)
     values ('THA', 'x', '2027-08-01', '2027-08-10') $$,
  '42501',
  null,
  'a signed-out client cannot add a trip'
);
reset role;

-- ------------------------------------------------------------------ user A
select pg_temp.sign_in('00000000-0000-4000-8000-00000000002a');
select lives_ok(
  $$ insert into public.trips (id, country_adm0, title, start_date, end_date, notes) values
     ('00000000-0000-4000-8000-0000000000a1', 'THA', 'תאילנד אוגוסט 2027', '2027-08-01', '2027-08-20', 'בנגקוק'),
     ('00000000-0000-4000-8000-0000000000a2', 'THA', 'תאילנד 2025', '2025-02-01', '2025-02-10', null),
     ('00000000-0000-4000-8000-0000000000a3', 'GRC', 'יוון', '2026-11-01', '2026-11-05', null) $$,
  'a user with consent adds trips'
);
select is(
  (select user_id from public.trips where id = '00000000-0000-4000-8000-0000000000a1'),
  '00000000-0000-4000-8000-00000000002a'::uuid,
  'the server sets the owner'
);
select throws_ok(
  $$ insert into public.trips (id, country_adm0, title, start_date, end_date)
     values ('00000000-0000-4000-8000-0000000000a1', 'THA', 'again', '2027-08-01', '2027-08-20') $$,
  '23505',
  null,
  'saving the same trip id again does not make a second trip (AC-3)'
);
select throws_ok(
  $$ insert into public.trips (country_adm0, title, start_date, end_date)
     values ('THA', 'x', '2027-08-10', '2027-08-01') $$,
  '23514',
  null,
  'a return before the departure is refused'
);
select throws_ok(
  $$ insert into public.trips (country_adm0, title, start_date, end_date)
     values ('THA', ' x', '2027-08-01', '2027-08-02') $$,
  '23514',
  null,
  'a name with surrounding spaces is refused'
);
select throws_ok(
  $$ insert into public.trips (country_adm0, title, start_date, end_date)
     values ('THA', repeat('א', 81), '2027-08-01', '2027-08-02') $$,
  '23514',
  null,
  'a name longer than 80 characters is refused'
);
select lives_ok(
  $$ insert into public.trips (country_adm0, title, start_date, end_date)
     values ('THA', repeat('א', 80), '2027-09-01', '2027-09-02') $$,
  'a name of exactly 80 characters is accepted'
);
select throws_ok(
  $$ insert into public.trips (country_adm0, title, start_date, end_date, notes)
     values ('THA', 'x', '2027-08-01', '2027-08-02', repeat('a', 2001)) $$,
  '23514',
  null,
  'notes longer than 2,000 characters are refused'
);
select throws_ok(
  $$ insert into public.trips (country_adm0, title, start_date, end_date)
     values ('tha', 'x', '2027-08-01', '2027-08-02') $$,
  '23514',
  null,
  'the country is an area code (three capitals)'
);
select throws_ok(
  $$ insert into public.trips (country_adm0, title, start_date, end_date)
     values ('THA', E'x\n', '2027-08-01', '2027-08-02') $$,
  '23514',
  null,
  'a name ending in a newline is refused'
);
select throws_ok(
  $$ insert into public.trips (country_adm0, title, start_date, end_date, notes)
     values ('THA', 'x', '2027-08-01', '2027-08-02', '') $$,
  '23514',
  null,
  'empty notes are null, never an empty string'
);
select results_eq(
  $$ select * from public.my_trip_countries() order by 1 $$,
  $$ values ('GRC'::text), ('THA'::text) $$,
  'the globe highlight gets each country once (AC-10)'
);
select lives_ok(
  $$ update public.trips set title = 'תאילנד', end_date = '2027-08-21'
     where id = '00000000-0000-4000-8000-0000000000a1' $$,
  'a user edits their trip'
);
select ok(
  (select updated_at >= created_at from public.trips where id = '00000000-0000-4000-8000-0000000000a1'),
  'the server keeps the update time'
);
select throws_ok(
  $$ update public.trips set country_adm0 = 'FRA' where id = '00000000-0000-4000-8000-0000000000a1' $$,
  '42501',
  null,
  'the country cannot be changed (AC-2)'
);
select throws_ok(
  $$ update public.trips set user_id = '00000000-0000-4000-8000-00000000002b'
     where id = '00000000-0000-4000-8000-0000000000a1' $$,
  '42501',
  null,
  'a trip cannot be moved to another user (AC-9)'
);
reset role;

-- ------------------------------------------------------------------ user B
select pg_temp.sign_in('00000000-0000-4000-8000-00000000002b');
select is_empty(
  $$ select 1 from public.trips $$,
  'another user sees none of A''s trips'
);
select is_empty(
  $$ update public.trips set title = 'x' where id = '00000000-0000-4000-8000-0000000000a1' returning id $$,
  'another user cannot edit A''s trip'
);
select is_empty(
  $$ delete from public.trips where id = '00000000-0000-4000-8000-0000000000a1' returning id $$,
  'another user cannot delete A''s trip'
);
select is_empty(
  $$ select * from public.my_trip_countries() $$,
  'another user gets no countries of A''s'
);
reset role;

-- ------------------------------------------------------- C, without consent
select pg_temp.sign_in('00000000-0000-4000-8000-00000000002c');
select throws_ok(
  $$ insert into public.trips (country_adm0, title, start_date, end_date)
     values ('THA', 'x', '2027-08-01', '2027-08-02') $$,
  '42501',
  null,
  'a user who never consented cannot add a trip (decision 4)'
);
reset role;

-- ------------------------------ D consented to the terms but not the privacy
select pg_temp.sign_in('00000000-0000-4000-8000-00000000002d');
insert into public.consents (doc_type, doc_version, action, platform, app_version)
values ('terms', 0, 'granted', 'android', '0.3.0');
select throws_ok(
  $$ insert into public.trips (country_adm0, title, start_date, end_date)
     values ('THA', 'x', '2027-08-01', '2027-08-02') $$,
  '42501',
  null,
  'consent to the terms alone is not enough'
);
reset role;

-- ------------------------------------- B withdraws: the gate closes again
select pg_temp.sign_in('00000000-0000-4000-8000-00000000002b');
insert into public.consents (doc_type, doc_version, action, platform, app_version)
values ('terms', 0, 'withdrawn', 'android', '0.3.0');
select throws_ok(
  $$ insert into public.trips (country_adm0, title, start_date, end_date)
     values ('THA', 'x', '2027-08-01', '2027-08-02') $$,
  '42501',
  null,
  'after withdrawing the terms, writing is refused'
);
reset role;

-- --------------------------- a new version: A is gated until consenting again
insert into public.legal_documents (doc_type, version) values ('terms', 1);
select pg_temp.sign_in('00000000-0000-4000-8000-00000000002a');
select throws_ok(
  $$ update public.trips set title = 'x' where id = '00000000-0000-4000-8000-0000000000a1' $$,
  '42501',
  null,
  'after new terms are published, edits fail with 42501, not "no rows" (re-consent)'
);
select throws_ok(
  $$ insert into public.trips (country_adm0, title, start_date, end_date)
     values ('THA', 'x', '2027-08-01', '2027-08-02') $$,
  '42501',
  null,
  'after new terms are published, adding needs consent again'
);
select results_eq(
  $$ delete from public.trips where id = '00000000-0000-4000-8000-0000000000a2' returning id $$,
  $$ values ('00000000-0000-4000-8000-0000000000a2'::uuid) $$,
  'deleting a trip never needs consent (AC-9)'
);
select lives_ok(
  $$ insert into public.consents (doc_type, doc_version, action, platform, app_version)
     values ('terms', 1, 'granted', 'android', '0.3.0');
     update public.trips set title = 'תאילנד!' where id = '00000000-0000-4000-8000-0000000000a1' $$,
  'consenting to the new terms opens writing again'
);
reset role;

-- -------------------------------------------------------- deleted with user
delete from auth.users where id = '00000000-0000-4000-8000-00000000002a';
select is_empty(
  $$ select 1 from public.trips where user_id = '00000000-0000-4000-8000-00000000002a' $$,
  'deleting the user deletes their trips'
);

select * from finish();
rollback;
