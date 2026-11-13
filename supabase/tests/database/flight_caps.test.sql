-- Sprint 15 PR-B (F-048 AC-3 – AC-6, ADR-023): the flight caps. 12 tracked
-- per trip, 30 tracked future flights, 72 adds a year and 24 in 30 days; past
-- a cap the flight is saved without tracking, with the reason; a re-added
-- flight waits 15 minutes after its last check; the old app sees 'ok'.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

insert into auth.users (id, email)
values
  ('00000000-0000-4000-8000-0000000015b1', 'a@example.test'),
  ('00000000-0000-4000-8000-0000000015b2', 'b@example.test'),
  ('00000000-0000-4000-8000-0000000015b3', 'c@example.test'),
  ('00000000-0000-4000-8000-0000000015b4', 'd@example.test'),
  ('00000000-0000-4000-8000-0000000015b5', 'e@example.test'),
  ('00000000-0000-4000-8000-0000000015b6', 'f@example.test');

create function pg_temp.sign_in(user_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
$$;
-- Signs in, consents and opens trips 1 and 2 of the user (ids end with the user's digit).
create function pg_temp.setup(n integer) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', ('00000000-0000-4000-8000-0000000015b' || n)::uuid, 'role', 'authenticated')::text, true);
  insert into public.consents (doc_type, doc_version, action, platform, app_version)
  values ('terms', 0, 'granted', 'android', '0.6.0'), ('privacy', 0, 'granted', 'android', '0.6.0');
  perform public.save_trip('create', ('10000000-0000-4000-8000-0000000015' || n || '1')::uuid, 'GRC', 'T1',
    current_date, current_date + 30, null, '[]', '[]');
  perform public.save_trip('create', ('10000000-0000-4000-8000-0000000015' || n || '2')::uuid, 'GRC', 'T2',
    current_date, current_date + 30, null, '[]', '[]');
end;
$$;
create function pg_temp.trip(n integer, t integer) returns uuid language sql as $$
  select ('10000000-0000-4000-8000-0000000015' || n || t)::uuid;
$$;
create function pg_temp.fid(n integer, k integer) returns uuid language sql as $$
  select ('20000000-0000-4000-8000-0000015' || n || lpad(k::text, 4, '0'))::uuid;
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
-- The log is server-only: the helper reads it as the test's owner, whoever is signed in.
create function pg_temp.adds(n integer) returns integer language sql security definer as $$
  select count(*)::integer from public.tracked_flight_adds
  where user_id = ('00000000-0000-4000-8000-0000000015b' || n)::uuid;
$$;

select pg_temp.setup(n) from generate_series(1, 6) n;

-- ---------------------------------------------------------------- structure
select ok(
  has_function_privilege('authenticated', 'public.save_flight_v2(uuid,uuid,jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.save_flight_v2(uuid,uuid,jsonb)', 'EXECUTE'),
  'signed-in users save through save_flight_v2'
);
select ok(
  not has_function_privilege('authenticated', 'public.usage_limit(uuid,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.user_tier(uuid)', 'EXECUTE'),
  'the limits are read inside the server only'
);
select ok(to_regprocedure('public.tracked_flights_of(uuid,uuid)') is null, 'the old cap of 10 is gone');

-- ---------------------------------------------------------------- AC-4: 12 per trip
select pg_temp.sign_in('00000000-0000-4000-8000-0000000015b1');
select is(
  (select count(*)::integer from generate_series(1, 12) k
   where public.save_flight_v2(pg_temp.fid(1, k), pg_temp.trip(1, 1),
     pg_temp.flight('AB' || k + 10, current_date + 5)) ->> 'status' = 'ok'),
  12, '12 tracked flights fit in a trip'
);
select is(
  public.save_flight_v2(pg_temp.fid(1, 13), pg_temp.trip(1, 1), pg_temp.flight('A99', current_date + 5)),
  '{"status":"untracked","reason":"concurrent","renews_at":null}'::jsonb,
  'the 13th is saved without tracking (AC-6)'
);
select is(
  (select array[watch_id::text, untracked_reason] from public.flights where id = pg_temp.fid(1, 13)),
  array[null, 'concurrent'], 'with no watch, and the reason on the row'
);
select is(pg_temp.adds(1), 12, 'only tracked flights count as adds (AC-5)');
select is(
  (select f ->> 'untrackedReason' from jsonb_array_elements(
     public.flights_for_trips(array[pg_temp.trip(1, 1)])) f where f ->> 'number' = 'A99'),
  'concurrent', 'the flight list carries the reason (design 6.2)'
);
select is(
  public.save_flight(pg_temp.fid(1, 14), pg_temp.trip(1, 2), pg_temp.flight('A98', current_date + 5)), 'ok',
  'another trip has its own 12'
);
-- A retry of the same flight keeps its tracking and isn't a new add.
select is(
  public.save_flight_v2(pg_temp.fid(1, 1), pg_temp.trip(1, 1),
    pg_temp.flight('AB11', current_date + 5, '{"seat": "12C"}')) ->> 'status',
  'ok', 'editing a tracked flight keeps it tracked'
);
select is(pg_temp.adds(1), 13, 'and adds nothing (AC-5)');
-- A place frees up; editing the untracked flight tries again (AC-6).
select public.delete_flight(pg_temp.fid(1, 2));
select is(
  public.save_flight_v2(pg_temp.fid(1, 13), pg_temp.trip(1, 1), pg_temp.flight('A99', current_date + 5)),
  '{"status":"ok"}'::jsonb, 'saving it again once there is room tracks it'
);
select is(
  (select untracked_reason from public.flights where id = pg_temp.fid(1, 13)), null,
  'and clears the reason'
);
select is(pg_temp.adds(1), 14, 'a successful retry is an add');
select is(
  public.save_flight_v2(pg_temp.fid(1, 15), pg_temp.trip(1, 1), pg_temp.flight('A97', current_date - 5)),
  '{"status":"ok"}'::jsonb, 'a past flight is saved as before, with no reason'
);
reset role;

-- ---------------------------------------------------------------- AC-4: future flights
update public.usage_limits set value = 3 where limit_key = 'future_flights';
select pg_temp.sign_in('00000000-0000-4000-8000-0000000015b2');
select is(
  (select count(*)::integer from generate_series(1, 3) k
   where public.save_flight_v2(pg_temp.fid(2, k), pg_temp.trip(2, 1 + k % 2),
     pg_temp.flight('B' || k + 10, current_date + 5)) ->> 'status' = 'ok'),
  3, 'tracked flights across trips count together'
);
select is(
  public.save_flight_v2(pg_temp.fid(2, 4), pg_temp.trip(2, 2), pg_temp.flight('B99', current_date + 5)) ->> 'reason',
  'concurrent', 'past the account''s future flights, the next is untracked'
);
reset role;
update public.usage_limits set value = 30 where limit_key = 'future_flights';

-- ---------------------------------------------------------------- AC-5: turnover
insert into public.tracked_flight_adds (user_id, watch_id, added_at)
select '00000000-0000-4000-8000-0000000015b3', n, now() - make_interval(hours => n)
from generate_series(1, 24) n;
select pg_temp.sign_in('00000000-0000-4000-8000-0000000015b3');
select is(
  public.save_flight_v2(pg_temp.fid(3, 1), pg_temp.trip(3, 1), pg_temp.flight('C11', current_date + 5)),
  jsonb_build_object('status', 'untracked', 'reason', 'turnover',
                     'renews_at', now() - interval '24 hours' + interval '30 days'),
  '24 adds in 30 days: the next is untracked, and renews when the oldest of them leaves the window'
);
select is(pg_temp.adds(3), 24, 'an untracked save adds nothing');
reset role;

insert into public.tracked_flight_adds (user_id, watch_id, added_at)
select '00000000-0000-4000-8000-0000000015b4', n, now() - make_interval(days => 40 + n)
from generate_series(1, 72) n;
select pg_temp.sign_in('00000000-0000-4000-8000-0000000015b4');
select is(
  public.save_flight_v2(pg_temp.fid(4, 1), pg_temp.trip(4, 1), pg_temp.flight('D11', current_date + 5)),
  jsonb_build_object('status', 'untracked', 'reason', 'turnover',
                     'renews_at', now() - interval '112 days' + interval '365 days'),
  '72 adds in a year: untracked until the oldest is a year old'
);
reset role;
-- Both caps crossed: the later date, since only then can a flight be added.
insert into public.tracked_flight_adds (user_id, watch_id, added_at)
select '00000000-0000-4000-8000-0000000015b4', n, now() - make_interval(hours => n)
from generate_series(1, 24) n;
select pg_temp.sign_in('00000000-0000-4000-8000-0000000015b4');
select is(
  public.save_flight_v2(pg_temp.fid(4, 1), pg_temp.trip(4, 1), pg_temp.flight('D11', current_date + 5)) ->> 'renews_at',
  to_jsonb(now() - interval '88 days' + interval '365 days') #>> '{}',
  'with both caps crossed, the later renewal'
);
-- The old app: a flight saved without tracking is 'ok', never an error (AC-6).
select is(
  public.save_flight(pg_temp.fid(4, 2), pg_temp.trip(4, 1), pg_temp.flight('D12', current_date + 5)), 'ok',
  'save_flight answers ok for an untracked flight'
);
select is((select untracked_reason from public.flights where id = pg_temp.fid(4, 2)), 'turnover',
  'and the row is saved with its reason');
reset role;

-- ---------------------------------------------------------------- suspended (AC-13)
insert into public.account_suspensions (user_id, reason)
values ('00000000-0000-4000-8000-0000000015b5', 'test');
select pg_temp.sign_in('00000000-0000-4000-8000-0000000015b5');
select is(
  public.save_flight_v2(pg_temp.fid(5, 1), pg_temp.trip(5, 1), pg_temp.flight('E11', current_date + 5)),
  '{"status":"untracked","reason":"suspended","renews_at":null}'::jsonb,
  'a suspended account saves flights without tracking'
);
select is(pg_temp.adds(5), 0, 'and spends no add');
select is((select count(*)::integer from public.flight_watch where flight_number = 'E11'), 0,
  'and no watch is made');
reset role;

-- ---------------------------------------------------------------- AC-3: re-added
-- A flight leaving in 2 hours is due at once. Checked, deleted, and added
-- again 10 times, it waits 15 minutes after the check every time.
select pg_temp.sign_in('00000000-0000-4000-8000-0000000015b6');
select is(
  public.save_flight_v2(pg_temp.fid(6, 1), pg_temp.trip(6, 1), pg_temp.flight('F11', (now() at time zone 'UTC')::date,
    jsonb_build_object('depTz', 'UTC', 'depDateLocal', ((now() + interval '2 hours') at time zone 'UTC')::date,
                       'depSched', now() + interval '2 hours', 'arrSched', now() + interval '4 hours'))) ->> 'status',
  'ok', 'a flight leaving soon is tracked'
);
reset role;
select is((select next_check_at from public.flight_watch where flight_number = 'F11'), now(),
  'and is due at once');
update public.flight_watch set last_checked_at = now(), next_check_at = now() + interval '15 minutes'
where flight_number = 'F11';
select pg_temp.sign_in('00000000-0000-4000-8000-0000000015b6');
do $$
begin
  for i in 1..10 loop
    perform public.delete_flight(pg_temp.fid(6, 1));
    perform public.save_flight_v2(pg_temp.fid(6, 1), pg_temp.trip(6, 1), pg_temp.flight('F11', (now() at time zone 'UTC')::date,
      jsonb_build_object('depTz', 'UTC', 'depDateLocal', ((now() + interval '2 hours') at time zone 'UTC')::date,
                         'depSched', now() + interval '2 hours', 'arrSched', now() + interval '4 hours')));
  end loop;
end;
$$;
reset role;
select is((select state from public.flight_watch where flight_number = 'F11'), 'active',
  'after 10 deletes and re-adds it is tracked');
select is((select next_check_at from public.flight_watch where flight_number = 'F11'),
  now() + interval '15 minutes', 'and not checked sooner than 15 minutes after the last check (AC-3)');
select is((select count(*)::integer from public.flight_watch where flight_number = 'F11'), 1,
  'one watch, so at most one provider check');

-- ---------------------------------------------------------------- concurrent saves
-- The cap and the add share one lock per user, so the log matches the watches.
select is(
  (select count(*)::integer from public.flights f join public.flight_watch w on w.id = f.watch_id
   where f.user_id = '00000000-0000-4000-8000-0000000015b1' and w.state in ('active', 'paused')),
  13, 'user A: 12 in trip 1 and 1 in trip 2 tracked'
);
select ok(
  (select bool_and(untracked_reason is null) from public.flights where watch_id is not null),
  'no tracked flight carries a reason'
);

-- A missing limit fails closed, not open.
delete from public.usage_limits where limit_key = 'flights_per_trip';
select pg_temp.sign_in('00000000-0000-4000-8000-0000000015b2');
select throws_ok(
  $$select public.save_flight_v2(pg_temp.fid(2, 9), pg_temp.trip(2, 1), pg_temp.flight('B98', current_date + 5))$$,
  'P0001', 'usage_limit: no flights_per_trip for this tier', 'a missing limit refuses the save'
);
reset role;

select * from finish();
rollback;
