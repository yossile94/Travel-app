-- Sprint 6 F-018 (ADR-011): push tokens belong to their owner and move with
-- the device; the outbox claims a change once, skips stale ones, and the
-- targets are one per user and device, with alerts on.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users (id, email)
values
  ('00000000-0000-4000-8000-00000000006a', 'a6@example.test'),
  ('00000000-0000-4000-8000-00000000006b', 'b6@example.test');

create function pg_temp.sign_in(user_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
$$;

-- ---------------------------------------------------------------- structure
select ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('public.push_tokens'::regclass, 'public.push_receipts'::regclass)),
  'RLS is on for tokens and receipts'
);
select table_privs_are('public', 'push_tokens', 'authenticated', array['SELECT', 'DELETE'],
  'users read and delete their tokens; registering goes through the function');
select table_privs_are('public', 'push_receipts', 'authenticated', array[]::text[], 'users: no receipts');
select ok(
  not has_function_privilege('authenticated', 'public.claim_flight_notifications(integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.flight_notification_targets(bigint[])', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.mark_flight_notifications(bigint[],jsonb)', 'EXECUTE'),
  'only the service role runs the outbox'
);

-- ---------------------------------------------------------------- tokens
select pg_temp.sign_in('00000000-0000-4000-8000-00000000006a');
select public.register_push_token('ExponentPushToken[aaaaaaaaaaaa]', 'android', 'he') is null;
select throws_ok(
  $$select public.register_push_token('not a token', 'android', 'he')$$,
  '23514', null, 'only an Expo push token is accepted'
);
select is((select count(*)::integer from public.push_tokens), 1, 'A has one device');
reset role;
select pg_temp.sign_in('00000000-0000-4000-8000-00000000006b');
select public.register_push_token('ExponentPushToken[aaaaaaaaaaaa]', 'android', 'en') is null;
select is((select count(*)::integer from public.push_tokens), 1, 'the device moved to B');
select is((select locale from public.push_tokens), 'en', 'with B''s language');
select public.register_push_token('ExponentPushToken[device' || n || 'xxxxx]', 'android', 'en') is null
from generate_series(1, 6) n;
select is((select count(*)::integer from public.push_tokens), 5, 'five devices at most: the oldest goes');
select public.unregister_push_token('ExponentPushToken[device6xxxxx]') is null;
select is((select count(*)::integer from public.push_tokens), 4, 'signing out removes this device');
reset role;
select pg_temp.sign_in('00000000-0000-4000-8000-00000000006a');
select is((select count(*)::integer from public.push_tokens), 0, 'A sees none of B''s devices');
reset role;

-- ---------------------------------------------------------------- outbox
insert into public.flight_watch (flight_number, dep_date_local, sched_dep_utc, next_check_at)
values ('XQ981', current_date + 1, now() + interval '5 hours', now());
insert into public.flight_events (watch_id, field, old_value, new_value, detected_at)
select id, 'dep_time', 'a', 'b', now() from public.flight_watch where flight_number = 'XQ981';
insert into public.flight_events (watch_id, field, old_value, new_value, detected_at)
select id, 'dep_gate', 'B1', 'B2', now() - interval '45 minutes' from public.flight_watch where flight_number = 'XQ981';
select is((select count(*)::integer from public.claim_flight_notifications(10)), 1,
  'a fresh change is claimed; one older than 30 minutes is not');
select is((select count(*)::integer from public.flight_events where notify_skipped), 1,
  'the stale change is marked skipped, never sent late');
select is((select count(*)::integer from public.claim_flight_notifications(10)), 0,
  'a claimed change is not claimed again while its claim holds');
select public.mark_flight_notifications(array(select id from public.flight_events where not notify_skipped), '[]') is null;
select is((select count(*)::integer from public.flight_events where notified_at is not null), 1,
  'sent changes are marked');

-- Targets: off until the user turns alerts on (design 2); then one per device,
-- with what the alert text needs (design 3.2).
insert into public.trips (id, user_id, country_adm0, title, start_date, end_date)
values ('10000000-0000-4000-8000-00000000006b', '00000000-0000-4000-8000-00000000006b', 'THA', 'T',
  current_date, current_date + 7);
insert into public.flights (id, trip_id, user_id, direction, flight_number_input, flight_number,
  dep_date_local, dep_iata, dep_tz, arr_iata, arr_tz, watch_id)
select '20000000-0000-4000-8000-00000000006b', '10000000-0000-4000-8000-00000000006b',
  '00000000-0000-4000-8000-00000000006b', 'out', 'xq 981', 'XQ981', current_date + 1,
  'TLV', 'Asia/Jerusalem', 'BKK', 'Asia/Bangkok', id
from public.flight_watch where flight_number = 'XQ981';
select is((select flight_alerts from public.profiles where id = '00000000-0000-4000-8000-00000000006b'),
  false, 'alerts are off for a new profile');
update public.profiles set flight_alerts = true where id = '00000000-0000-4000-8000-00000000006b';
select is(
  (select count(*)::integer from public.flight_notification_targets(array(select id from public.flight_watch where flight_number = 'XQ981'))),
  4, 'alerts on: one target per device'
);
select is(
  (select row(flight_number_input, dep_iata, arr_iata, dep_date_local)::text
   from public.flight_notification_targets(array(select id from public.flight_watch where flight_number = 'XQ981')) limit 1),
  row('xq 981', 'TLV', 'BKK', current_date + 1)::text,
  'with the typed number, the airports and the date'
);

-- Alerts off means none.
update public.profiles set flight_alerts = false where id = '00000000-0000-4000-8000-00000000006b';
select is(
  (select count(*)::integer from public.flight_notification_targets(array(select id from public.flight_watch where flight_number = 'XQ981'))),
  0, 'no targets with alerts off'
);

-- Account deletion takes the devices.
delete from auth.users where id = '00000000-0000-4000-8000-00000000006b';
select is((select count(*)::integer from public.push_tokens), 0, 'deleting the account deletes its devices');

select * from finish();
rollback;
