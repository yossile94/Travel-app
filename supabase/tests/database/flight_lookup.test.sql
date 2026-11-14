-- Sprint 15 PR-C (F-048 AC-7, AC-8, design 6.3; ADR-023): the flight search.
-- A copy (a tracked check or any search in 24 hours, the newer one; "not found" too)
-- answers for free; 10 searches a day and 150 in 30 days; the units cap and
-- the search's slice; cache only at 85%, off at 95%; a suspended account
-- can't search. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(44);
-- The function's day is UTC; so is current_date here (Dudi 6).
set local timezone = 'UTC';

insert into auth.users (id, email)
values
  ('00000000-0000-4000-8000-0000000015c1', 'a@example.test'),
  ('00000000-0000-4000-8000-0000000015c2', 'b@example.test'),
  ('00000000-0000-4000-8000-0000000015c3', 'c@example.test'),
  ('00000000-0000-4000-8000-0000000015c4', 'd@example.test');
delete from public.provider_usage;

create function pg_temp.go(n integer, num text, d date default current_date + 10) returns text
language sql as $$
  select public.begin_flight_lookup(('00000000-0000-4000-8000-0000000015c' || n)::uuid, num, d, 2) ->> 'status';
$$;
create function pg_temp.used() returns text language sql as $$
  select coalesce(sum(units), 0) || '/' || coalesce(sum(lookup_units), 0)
  from public.provider_usage where provider = 'aerodatabox';
$$;

-- ---------------------------------------------------------------- structure
select ok((select relrowsecurity from pg_class where oid = 'public.flight_lookup_cache'::regclass),
  'RLS is on for the copy');
select table_privs_are('public', 'flight_lookup_cache', 'authenticated', array[]::text[], 'users: no copy rows');
select table_privs_are('public', 'flight_lookup_cache', 'anon', array[]::text[], 'anon: no copy rows');
select hasnt_column('public', 'flight_lookup_cache', 'user_id', 'the copy keeps no user id (AC-7)');
select ok(
  not has_function_privilege('authenticated', 'public.begin_flight_lookup(uuid,text,date,integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.begin_flight_lookup(uuid,text,date,integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.put_flight_lookup(text,date,jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.put_flight_lookup(text,date,jsonb)', 'EXECUTE'),
  'clients cannot take a search or write the copy'
);
select ok(
  has_function_privilege('service_role', 'public.begin_flight_lookup(uuid,text,date,integer)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.put_flight_lookup(text,date,jsonb)', 'EXECUTE'),
  'the lookup function calls both with the service role'
);
select ok(
  (select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
   where oid in ('public.begin_flight_lookup(uuid,text,date,integer)'::regprocedure,
                 'public.put_flight_lookup(text,date,jsonb)'::regprocedure)),
  'both are security definer with an empty search_path'
);
select ok(to_regprocedure('public.take_flight_lookup(uuid)') is null, 'take_flight_lookup is gone');
select throws_ok($$select pg_temp.go(1, null)$$, '22023', null, 'a missing number is refused');
select throws_ok($$select pg_temp.go(1, 'ly 1')$$, '22023', null, 'a number not normalised is refused (Dudi 5)');
select throws_ok($$select pg_temp.go(1, 'LY1', current_date + 356)$$, '22023', null,
  'a date past 355 days is refused');
select throws_ok($$select pg_temp.go(1, 'LY1', current_date - 3)$$, '22023', null,
  'a date more than 2 days back is refused');
select throws_ok(
  $$select public.begin_flight_lookup('00000000-0000-4000-8000-0000000015c1', 'LY1', current_date, 11)$$,
  '22023', null, 'more than 10 units is refused');
select ok(
  not has_function_privilege('authenticated', 'public.aerodatabox_load()', 'EXECUTE')
  and has_function_privilege('service_role', 'public.aerodatabox_load()', 'EXECUTE'),
  'the load is read by the server only');

-- ---------------------------------------------------------- a search, a copy
select is(pg_temp.go(1, 'LY1'), 'go', 'a first search goes to the provider');
select is(pg_temp.used(), '2/2', 'it spends 2 units, in the search slice');
select is((select count from public.flight_lookups where user_id = '00000000-0000-4000-8000-0000000015c1'),
  1::smallint, 'and one of the user''s searches');
select public.put_flight_lookup('LY1', current_date + 10, '[{"number": "LY1"}]');
select is(
  public.begin_flight_lookup('00000000-0000-4000-8000-0000000015c2', 'LY1', current_date + 10, 2),
  '{"status": "copy", "from": "cache", "legs": [{"number": "LY1"}]}'::jsonb,
  'another user''s search in 24 hours answers from the copy (AC-7)'
);
select is(pg_temp.used(), '2/2', 'a copy spends no units');
select ok(not exists (select 1 from public.flight_lookups where user_id = '00000000-0000-4000-8000-0000000015c2'),
  'and isn''t counted as a search');
select public.put_flight_lookup('LY2', current_date + 10, '[]');
select is(
  public.begin_flight_lookup('00000000-0000-4000-8000-0000000015c2', 'LY2', current_date + 10, 2) -> 'legs',
  '[]'::jsonb, '"not found" is a copy too');
update public.flight_lookup_cache set fetched_at = now() - interval '25 hours' where flight_number = 'LY2';
select is(pg_temp.go(2, 'LY2'), 'go', 'a copy older than 24 hours isn''t used');
select public.put_flight_lookup('LY2', current_date + 10, '[{"number": "LY2"}]');
select ok(
  (select fetched_at > now() - interval '1 minute' and legs = '[{"number": "LY2"}]'
   from public.flight_lookup_cache where flight_number = 'LY2'),
  'a new answer replaces the copy and its time'
);
select throws_ok($$select public.put_flight_lookup('LY3', current_date, '{}')$$, '23514', null,
  'the copy is an array');
select throws_ok(
  $$select public.put_flight_lookup('LY3', current_date, (select jsonb_agg('{}'::jsonb) from generate_series(1, 9)))$$,
  '23514', null, 'the copy holds 8 legs at most');

-- A tracked flight checked in the last 24 hours answers with every leg.
insert into public.flight_watch (flight_number, dep_date_local, sched_dep_utc, last_snapshot, last_legs, last_checked_at)
values
  ('LY4', current_date + 10, now() + interval '10 days', '{"number": "LY4"}',
   '[{"number": "LY4"}, {"number": "LY4", "leg": 2}]', now() - interval '10 minutes'),
  ('LY5', current_date + 10, now() + interval '10 days', '{"number": "LY5"}', null, now() - interval '10 minutes'),
  ('LY6', current_date + 10, now() + interval '10 days', '{"number": "LY6"}', null, now() - interval '25 hours'),
  ('LY8', current_date + 10, now() + interval '10 days', '{"number": "LY8"}', null, now() - interval '2 hours'),
  ('LY9', current_date + 10, now() + interval '10 days', '{"number": "LY9"}', null, now() - interval '5 hours');
insert into public.flight_lookup_cache (flight_number, dep_date_local, legs, fetched_at)
values ('LY8', current_date + 10, '[{"number": "LY8", "old": true}]', now() - interval '5 hours'),
       ('LY9', current_date + 10, '[{"number": "LY9", "new": true}]', now() - interval '1 hour');
select is(
  public.begin_flight_lookup('00000000-0000-4000-8000-0000000015c3', 'LY4', current_date + 10, 2),
  '{"status": "copy", "from": "tracked", "legs": [{"number": "LY4"}, {"number": "LY4", "leg": 2}]}'::jsonb,
  'a tracked copy answers with every leg');
select is(
  public.begin_flight_lookup('00000000-0000-4000-8000-0000000015c3', 'LY5', current_date + 10, 2) -> 'legs',
  '[{"number": "LY5"}]'::jsonb, 'without legs, with the tracked one');
select is(pg_temp.go(3, 'LY6'), 'go', 'a tracked copy older than 24 hours isn''t used');
select is(
  public.begin_flight_lookup('00000000-0000-4000-8000-0000000015c3', 'LY8', current_date + 10, 2) -> 'legs',
  '[{"number": "LY8"}]'::jsonb, 'a tracked check newer than the copy answers (Raz 4)');
select is(
  public.begin_flight_lookup('00000000-0000-4000-8000-0000000015c3', 'LY9', current_date + 10, 2) -> 'legs',
  '[{"number": "LY9", "new": true}]'::jsonb, 'a copy newer than the tracked check answers');

-- ------------------------------------------------------------- the user's caps
select is(
  (select count(*)::integer from generate_series(1, 11) n where pg_temp.go(4, 'IZ' || n) = 'go'),
  10, 'ten searches a day');
select is(pg_temp.go(4, 'IZ99'), 'lookups_day', 'the 11th names today''s cap');
select is(pg_temp.go(4, 'LY1'), 'copy', 'a copy still answers past the cap');
update public.flight_lookups set day = day - 1 where user_id = '00000000-0000-4000-8000-0000000015c4';
insert into public.flight_lookups (user_id, day, count)
select '00000000-0000-4000-8000-0000000015c4', current_date - n, 10 from generate_series(2, 29) n;
-- 10 yesterday + 280 over 28 days: past 150 in 30 days.
select is(pg_temp.go(4, 'IZ100'), 'lookups_30d', 'past 150 in 30 days names the 30-day cap');
delete from public.flight_lookups where user_id = '00000000-0000-4000-8000-0000000015c4';
insert into public.flight_lookups (user_id, day, count)
values ('00000000-0000-4000-8000-0000000015c4', current_date - 30, 150);
select is(pg_temp.go(4, 'IZ101'), 'go', 'searches 30 days ago don''t count');

-- ------------------------------------------------------------------ the budget
update public.provider_catalog set hard_cap = 30 where provider = 'aerodatabox' and metric = 'lookup';
update public.provider_usage set lookup_units = 30, units = 100;
select is(pg_temp.go(1, 'IZ200'), 'budget', 'the search''s slice is spent: budget');
select is(pg_temp.used(), '100/30', 'a refused search spends nothing');
update public.provider_catalog set hard_cap = 360 where provider = 'aerodatabox' and metric = 'lookup';
update public.provider_usage set lookup_units = 0, units = 306;
select is(pg_temp.go(1, 'IZ201'), 'off', 'at 85% of the units cap a search without a copy is off');
select is(pg_temp.go(1, 'LY1'), 'copy', 'and a copy still answers');
update public.provider_usage set units = 342;
select is(pg_temp.go(1, 'LY1'), 'off', 'at 95% the search is off, the copy too');
update public.provider_usage set units = 0;
update public.provider_catalog set monthly_quota = 400, hard_cap = 1 where provider = 'aerodatabox' and metric = 'units';
select is(pg_temp.go(1, 'IZ202'), 'budget', 'units past the units cap: budget');
update public.provider_catalog set hard_cap = 360 where provider = 'aerodatabox' and metric = 'units';
select throws_ok($$update public.provider_usage set lookup_units = units + 1$$, '23514', null,
  'the slice is never more than the units');

-- ---------------------------------------------------------------- suspended
insert into public.account_suspensions (user_id, reason)
values ('00000000-0000-4000-8000-0000000015c1', 'test');
select is(pg_temp.go(1, 'LY1'), 'suspended', 'a suspended account can''t search, a copy neither (design 6.3)');

-- ---------------------------------------------------------------- retention
insert into public.flight_lookup_cache (flight_number, dep_date_local, legs, fetched_at)
values ('LY7', current_date + 10, '[]', now() - interval '25 hours');
select public.flight_data_retention();
select ok(not exists (select 1 from public.flight_lookup_cache where fetched_at < now() - interval '24 hours')
  and exists (select 1 from public.flight_lookup_cache where flight_number = 'LY1'),
  'retention drops copies older than 24 hours only');

select * from finish();
rollback;
