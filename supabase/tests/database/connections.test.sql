-- Sprint 7 F-019 (ADR-012): the minimum connection times are public and
-- read-only; the "same booking" answer is the owner's, between two legs of
-- one trip; the rule's cases are in connection_cases.test.sql.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

insert into auth.users (id, email)
values
  ('00000000-0000-4000-8000-00000000007a', 'a7@example.test'),
  ('00000000-0000-4000-8000-00000000007b', 'b7@example.test');

create function pg_temp.sign_in(user_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
$$;

insert into public.trips (id, user_id, country_adm0, title, start_date, end_date)
values
  ('10000000-0000-4000-8000-00000000007a', '00000000-0000-4000-8000-00000000007a', 'THA', 'T', '2026-11-30', '2026-12-20'),
  ('10000000-0000-4000-8000-00000000007c', '00000000-0000-4000-8000-00000000007a', 'TUR', 'U', '2026-11-30', '2026-12-20'),
  ('10000000-0000-4000-8000-00000000007b', '00000000-0000-4000-8000-00000000007b', 'THA', 'T', '2026-11-30', '2026-12-20');
insert into public.flights (id, trip_id, user_id, direction, flight_number_input, flight_number,
  dep_date_local, dep_iata, dep_tz, arr_iata, arr_tz, dep_sched, arr_sched)
values
  ('20000000-0000-4000-8000-000000000071', '10000000-0000-4000-8000-00000000007a', '00000000-0000-4000-8000-00000000007a',
   'out', 'TK1', 'TK1', '2026-12-01', 'TLV', 'UTC', 'IST', 'UTC', '2026-12-01T06:00:00Z', '2026-12-01T08:00:00Z'),
  ('20000000-0000-4000-8000-000000000072', '10000000-0000-4000-8000-00000000007a', '00000000-0000-4000-8000-00000000007a',
   'out', 'TK2', 'TK2', '2026-12-01', 'IST', 'UTC', 'BKK', 'UTC', '2026-12-01T10:00:00Z', '2026-12-01T20:00:00Z'),
  ('20000000-0000-4000-8000-000000000073', '10000000-0000-4000-8000-00000000007c', '00000000-0000-4000-8000-00000000007a',
   'out', 'TK3', 'TK3', '2026-12-01', 'TLV', 'UTC', 'IST', 'UTC', '2026-12-01T06:00:00Z', '2026-12-01T08:00:00Z'),
  ('20000000-0000-4000-8000-00000000007b', '10000000-0000-4000-8000-00000000007b', '00000000-0000-4000-8000-00000000007b',
   'out', 'TK4', 'TK4', '2026-12-01', 'TLV', 'UTC', 'IST', 'UTC', '2026-12-01T06:00:00Z', '2026-12-01T08:00:00Z');

-- ---------------------------------------------------------------- minimum connection times
select ok((select relrowsecurity from pg_class where oid = 'public.min_connection_times'::regclass),
  'RLS is on for minimum connection times');
select table_privs_are('public', 'min_connection_times', 'authenticated', array['SELECT'],
  'users only read minimum connection times');
select throws_ok(
  $$insert into public.min_connection_times (iata, minutes, source_url, verified_at)
    values ('IST', 5, 'https://example.test', current_date)$$,
  '23514', null, 'a minimum under 15 minutes is refused');
select throws_ok(
  $$insert into public.min_connection_times (iata, minutes, source_url, verified_at)
    values ('IST', 60, 'http://example.test', current_date)$$,
  '23514', null, 'a source must be an https page');
select is(public.connection_mct('ZZZ'), 60, 'an airport without a value: 60 minutes');
insert into public.min_connection_times (iata, minutes, source_url, verified_at)
values ('IST', 75, 'https://example.test/ist', current_date);
select is(public.connection_mct('IST'), 75, 'an airport with a value: its own');

-- ---------------------------------------------------------------- same booking
select ok(not has_function_privilege('authenticated', 'public.trip_connections(uuid)', 'EXECUTE'),
  'the rule in SQL is for the server only');
select pg_temp.sign_in('00000000-0000-4000-8000-00000000007a');
select is(public.set_same_booking('20000000-0000-4000-8000-000000000072', '20000000-0000-4000-8000-000000000071', false),
  'ok', 'the owner answers for the later leg');
select is(public.set_same_booking('20000000-0000-4000-8000-000000000072', '20000000-0000-4000-8000-000000000073', true),
  'gone', 'the leg before must be in the same trip');
reset role;
select pg_temp.sign_in('00000000-0000-4000-8000-00000000007b');
select is(public.set_same_booking('20000000-0000-4000-8000-000000000072', '20000000-0000-4000-8000-000000000071', true),
  'gone', 'nobody answers for someone else''s flight');
reset role;
select is(
  (select row(same_booking, same_booking_prev)::text from public.flights
   where id = '20000000-0000-4000-8000-000000000072'),
  row(false, '20000000-0000-4000-8000-000000000071'::uuid)::text,
  'the answer and the leg it is about are kept together');
-- ---------------------------------------------------------------- alert recipients (AC-4)
insert into public.flight_watch (id, flight_number, dep_date_local, sched_dep_utc, next_check_at)
overriding system value
values (-71, 'TK1', '2026-12-01', '2026-12-01T06:00:00Z', null);
update public.flights set watch_id = -71 where id = '20000000-0000-4000-8000-000000000071';
update public.profiles set flight_alerts = true where id = '00000000-0000-4000-8000-00000000007a';
select pg_temp.sign_in('00000000-0000-4000-8000-00000000007a');
select public.register_push_token('ExponentPushToken[conn7aaaaaaaa]', 'android', 'en') is null;
select ok(
  (select bool_and(arrmct is not null) from (
     select (f ->> 'arrMct')::int as arrmct
     from jsonb_array_elements(public.flights_for_trips(array['10000000-0000-4000-8000-00000000007a']::uuid[])) f) x),
  'every flight reaches the device with its arrival minimum');
select is(
  (select f ->> 'arrMctDefault' from jsonb_array_elements(
     public.flights_for_trips(array['10000000-0000-4000-8000-00000000007a']::uuid[])) f
   where f ->> 'arrIata' = 'BKK'),
  'true', 'a minimum that is the general one says so');
reset role;
select is(
  (select row(next_flight_id, next_number, next_mct)::text
   from public.flight_notification_targets(-71, 0, 10)),
  row('20000000-0000-4000-8000-000000000072'::uuid, 'TK2', 75)::text,
  'an alert''s recipient gets the next leg, as typed, with the minimum where they meet');
delete from public.flights where id = '20000000-0000-4000-8000-000000000071';
select is(
  (select same_booking_prev from public.flights where id = '20000000-0000-4000-8000-000000000072'),
  null::uuid,
  'deleting the leg before unties the answer from it');

select * from finish();
rollback;
