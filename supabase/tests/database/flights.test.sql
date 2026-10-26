-- Sprint 5 F-016, F-017 (AC-1 to AC-7א, ADR-010): flights belong to the trip's
-- owner and are written only through save_flight / delete_flight; one
-- tracking row per flight number and date; the PNR and seat stay with the
-- owner; tracking stops when no flight is left.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

insert into auth.users (id, email)
values
  ('00000000-0000-4000-8000-00000000005a', 'a5@example.test'),
  ('00000000-0000-4000-8000-00000000005b', 'b5@example.test'),
  ('00000000-0000-4000-8000-00000000005c', 'c5@example.test');

create function pg_temp.sign_in(user_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
$$;
create function pg_temp.consent() returns void language sql as $$
  insert into public.consents (doc_type, doc_version, action, platform, app_version)
  values ('terms', 0, 'granted', 'android', '0.6.0'), ('privacy', 0, 'granted', 'android', '0.6.0');
$$;
-- A flight on the given local date, departing at 10:00 UTC.
create function pg_temp.flight(number text, day date, extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object(
    'direction', 'out', 'numberInput', number, 'number', number, 'depDateLocal', day,
    'depIata', 'TLV', 'depTz', 'Asia/Jerusalem', 'arrIata', 'ATH', 'arrTz', 'Europe/Athens',
    'depSched', (day + time '10:00') at time zone 'UTC',
    'arrSched', (day + time '12:00') at time zone 'UTC'
  ) || extra;
$$;

select pg_temp.sign_in('00000000-0000-4000-8000-00000000005a');
select pg_temp.consent();
select public.save_trip('create', '10000000-0000-4000-8000-00000000005a', 'GRC', 'יוון',
  current_date, current_date + 10, null, '[]', '[]');
reset role;
select pg_temp.sign_in('00000000-0000-4000-8000-00000000005b');
select pg_temp.consent();
select public.save_trip('create', '10000000-0000-4000-8000-00000000005b', 'GRC', 'B',
  current_date, current_date + 10, null, '[]', '[]');
reset role;

-- ---------------------------------------------------------------- structure
select ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('public.flights'::regclass, 'public.flight_watch'::regclass,
                 'public.flight_events'::regclass, 'public.flight_lookups'::regclass)),
  'RLS is on for flights, tracking, changes and the search quota'
);
select table_privs_are('public', 'flights', 'authenticated', array['SELECT'],
  'users only read flights; writes go through the functions');
select table_privs_are('public', 'flights', 'anon', array[]::text[], 'anon: no flights');
select table_privs_are('public', 'flight_watch', 'authenticated', array[]::text[], 'users: no tracking rows');
select table_privs_are('public', 'flight_events', 'authenticated', array[]::text[], 'users: no change rows');
select ok(
  not has_function_privilege('authenticated', 'public.take_flight_lookup(uuid)', 'EXECUTE'),
  'users cannot take search quota themselves'
);
select ok(
  not has_function_privilege('anon', 'public.save_flight(uuid,uuid,jsonb)', 'EXECUTE'),
  'signed-out clients cannot save flights'
);

-- ---------------------------------------------------------------- save
select pg_temp.sign_in('00000000-0000-4000-8000-00000000005a');
select is(
  public.save_flight('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-00000000005a',
    pg_temp.flight('LY541', current_date + 3, '{"pnr": "ABC123", "seat": "34A", "cabin": "economy"}')),
  'ok', 'a flight is saved'
);
select is(
  public.save_flight('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-00000000005a',
    pg_temp.flight('LY541', current_date + 3, '{"pnr": "ABC123", "seat": "34A"}')),
  'ok', 'the same id again (a retry) saves again'
);
select is((select count(*)::integer from public.flights), 1, 'a retry leaves one row');
select is(
  public.save_flight('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-00000000005b',
    pg_temp.flight('LY541', current_date + 3)),
  'gone', 'another user''s trip is "gone"'
);
select throws_ok(
  $$select public.save_flight('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-00000000005a',
      pg_temp.flight('LY541', current_date + 3, '{"pnr": "ab-12"}'))$$,
  '23514', null, 'a PNR outside A-Z and 0-9, 5 to 8 long, is refused'
);
select throws_ok(
  $$select public.save_flight('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-00000000005a',
      pg_temp.flight('LY0541', current_date + 3))$$,
  '23514', null, 'a number with a leading zero is refused (normalised on the device)'
);
select throws_ok(
  $$select public.save_flight('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-00000000005a',
      pg_temp.flight('LY541', current_date + 400))$$,
  '22023', null, 'more than 355 days ahead is refused'
);
select throws_ok(
  $$select public.save_flight('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-00000000005a',
      pg_temp.flight('LY541', current_date + 3, '{"depTz": "Not/AZone"}'))$$,
  '22023', null, 'an unknown time zone is refused'
);
select is(
  public.save_flight('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-00000000005a',
    pg_temp.flight('LY542', current_date - 3)),
  'ok', 'a past flight is saved'
);
reset role;
select is(
  (select watch_id from public.flights where id = '20000000-0000-4000-8000-000000000004'), null,
  'a past flight is not tracked'
);
select is(
  (select next_check_at from public.flight_watch where flight_number = 'LY541'),
  ((current_date + 3) + time '10:00') at time zone 'UTC' - interval '6 hours',
  'tracking starts 6 hours before departure'
);

-- Another user on the same flight shares the tracking row (AC-6).
select pg_temp.sign_in('00000000-0000-4000-8000-00000000005b');
select public.save_flight('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-00000000005b',
  pg_temp.flight('LY541', current_date + 3));
select is((select count(*)::integer from public.flights), 1, 'B sees only B''s flight');
select is(
  jsonb_array_length(public.flights_for_trips(array['10000000-0000-4000-8000-00000000005a']::uuid[])), 0,
  'B cannot read A''s flights through the function'
);
select throws_ok(
  $$select public.save_flight('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-00000000005b',
      pg_temp.flight('LY541', current_date + 3))$$,
  '23505', null, 'B cannot take over A''s flight id'
);
reset role;
select is((select count(*)::integer from public.flight_watch where flight_number = 'LY541'), 1,
  'one tracking row for two users on the same flight');

-- ---------------------------------------------------------------- read
select pg_temp.sign_in('00000000-0000-4000-8000-00000000005a');
select is(
  public.flights_for_trips(array['10000000-0000-4000-8000-00000000005a']::uuid[]) -> 1 ->> 'pnr',
  'ABC123', 'the owner reads the PNR'
);
select is(
  public.flights_for_trips(array['10000000-0000-4000-8000-00000000005a']::uuid[]) -> 1 -> 'watch' ->> 'state',
  'active', 'with its tracking state'
);
reset role;

-- ---------------------------------------------------------------- delete and stop
select pg_temp.sign_in('00000000-0000-4000-8000-00000000005b');
select is(public.delete_flight('20000000-0000-4000-8000-000000000001'), 'gone',
  'B cannot delete A''s flight');
select is(public.delete_flight('20000000-0000-4000-8000-000000000005'), 'ok', 'B deletes B''s flight');
reset role;
select is((select state from public.flight_watch where flight_number = 'LY541'), 'active',
  'tracking goes on while A still has the flight');
-- A deletes the trip: the cascade takes the flight and stops the tracking.
delete from public.trips where id = '10000000-0000-4000-8000-00000000005a';
select is((select state from public.flight_watch where flight_number = 'LY541'), 'stopped',
  'no flight left: tracking stops');

-- ---------------------------------------------------------------- limit and quota
select pg_temp.sign_in('00000000-0000-4000-8000-00000000005b');
select is(
  (select count(*)::integer from generate_series(1, 20) n
   where public.save_flight(('30000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
     '10000000-0000-4000-8000-00000000005b', pg_temp.flight('IZ' || n, current_date + 5)) = 'ok'),
  20, '20 flights fit in a trip'
);
select is(
  public.save_flight('30000000-0000-4000-8000-000000000099', '10000000-0000-4000-8000-00000000005b',
    pg_temp.flight('IZ99', current_date + 5)),
  'limit', 'the 21st is refused'
);
reset role;
select is(
  (select count(*)::integer from generate_series(1, 11) n
   where public.take_flight_lookup('00000000-0000-4000-8000-00000000005c')),
  10, 'ten searches a day, the 11th is refused'
);

select * from finish();
rollback;
