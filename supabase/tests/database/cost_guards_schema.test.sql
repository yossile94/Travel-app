-- Sprint 15 PR-A (F-048 – F-050, ADR-023): the cost-guard and dashboard
-- tables. AC-17: a user without the admin role, or an admin without MFA,
-- reads nothing from any of them. The limits are rows, the catalog keeps its
-- ranges, an alert is written once per period, and an admin's change is logged.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(47);

insert into auth.users (id, email, email_confirmed_at)
values
  ('00000000-0000-4000-8000-0000000015a1', 'admin15@example.test', now()),
  ('00000000-0000-4000-8000-0000000015f1', 'user15@example.test', now()),
  ('00000000-0000-4000-8000-0000000015e1', 'editor15@example.test', now());
insert into public.admin_roles (user_id, role)
values ('00000000-0000-4000-8000-0000000015a1', 'admin'),
       ('00000000-0000-4000-8000-0000000015e1', 'content_editor'),
       ('00000000-0000-4000-8000-0000000015e1', 'support');

-- One row in each table, so an empty answer means "not allowed", not "nothing there".
insert into public.account_suspensions (user_id, reason, created_by)
values ('00000000-0000-4000-8000-0000000015f1', 'test', '00000000-0000-4000-8000-0000000015a1');
insert into public.usage_daily (provider, metric, day, feature, platform, calls, amount)
values ('aerodatabox', 'units', current_date, 'watch', 'server', 1, 2);
insert into public.cost_alerts (provider, metric, kind, threshold, period)
values ('aerodatabox', 'units', 'threshold', 70, current_date);
insert into public.manual_usage (provider, metric, as_of, amount)
values ('google_places', 'places_search', current_date, 1);
insert into public.tracked_flight_adds (user_id, watch_id)
values ('00000000-0000-4000-8000-0000000015f1', 1);

create function pg_temp.sign_in(user_id uuid, aal text, email text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', user_id, 'role', 'authenticated', 'aal', aal, 'email', email)::text, true);
  set local role authenticated;
$$;
create function pg_temp.sign_out() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true);
  reset role;
$$;
-- How many rows the signed-in caller sees in each dashboard table.
create function pg_temp.seen() returns integer[] language sql as $$
  select array[
    (select count(*) from public.usage_limits),
    (select count(*) from public.provider_catalog),
    (select count(*) from public.usage_daily),
    (select count(*) from public.cost_alerts),
    (select count(*) from public.manual_usage),
    (select count(*) from public.account_suspensions)
  ]::integer[];
$$;

-- ---------------------------------------------------------------- structure
select ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('public.usage_limits'::regclass, 'public.tracked_flight_adds'::regclass,
                 'public.account_suspensions'::regclass, 'public.provider_catalog'::regclass,
                 'public.usage_daily'::regclass, 'public.cost_alerts'::regclass,
                 'public.manual_usage'::regclass)),
  'RLS is on for every new table'
);
select table_privs_are('public', 'usage_limits', 'authenticated', array['SELECT'], 'limits: read at most (RLS: admins)');
select table_privs_are('public', 'provider_catalog', 'authenticated', array['SELECT'], 'catalog: written through RPCs only');
select table_privs_are('public', 'usage_daily', 'authenticated', array['SELECT'], 'usage: read at most');
select table_privs_are('public', 'cost_alerts', 'authenticated', array['SELECT'], 'alerts: read at most');
select table_privs_are('public', 'manual_usage', 'authenticated', array['SELECT'], 'manual usage: read at most');
select table_privs_are('public', 'account_suspensions', 'authenticated', array['SELECT'], 'suspensions: read at most');
select table_privs_are('public', 'tracked_flight_adds', 'authenticated', array[]::text[], 'users: no adds log');
select table_privs_are('public', 'tracked_flight_adds', 'anon', array[]::text[], 'anon: no adds log');
select is(
  (select array_agg(t order by t) from unnest(array['usage_limits', 'provider_catalog', 'usage_daily',
     'cost_alerts', 'manual_usage', 'account_suspensions']) t
   where has_table_privilege('anon', 'public.' || t, 'select,insert,update,delete,truncate')),
  null, 'signed-out clients reach none of the dashboard tables'
);
select ok(
  not has_sequence_privilege('authenticated', 'public.tracked_flight_adds_id_seq', 'USAGE')
  and not has_sequence_privilege('authenticated', 'public.cost_alerts_id_seq', 'USAGE'),
  'the new sequences are closed to clients'
);
select ok(
  not has_function_privilege('authenticated', 'public.cost_data_retention()', 'EXECUTE'),
  'clients cannot run the clean-up'
);
select ok(
  exists (select 1 from cron.job where jobname = 'cost-data-retention'),
  'the dashboard clean-up runs daily'
);

-- ---------------------------------------------------------------- AC-17
select pg_temp.sign_in('00000000-0000-4000-8000-0000000015f1', 'aal2', 'user15@example.test');
select is(pg_temp.seen(), array[0, 0, 0, 0, 0, 0], 'a user without the admin role reads nothing (AC-17)');
select throws_ok($$select count(*) from public.tracked_flight_adds$$, '42501', null,
  'and can''t read the adds log at all');
select throws_ok(
  $$insert into public.account_suspensions (user_id, reason) values ('00000000-0000-4000-8000-0000000015f1', 'x')$$,
  '42501', null, 'nor write a suspension'
);
select throws_ok(
  $$update public.provider_catalog set hard_cap = 0$$, '42501', null, 'nor change a cap'
);
select pg_temp.sign_out();

select pg_temp.sign_in('00000000-0000-4000-8000-0000000015e1', 'aal2', 'editor15@example.test');
select is(pg_temp.seen(), array[0, 0, 0, 0, 0, 0], 'an editor or support person with MFA reads nothing either');
select pg_temp.sign_out();

select pg_temp.sign_in('00000000-0000-4000-8000-0000000015a1', 'aal1', 'admin15@example.test');
select is(pg_temp.seen(), array[0, 0, 0, 0, 0, 0], 'an admin without MFA reads nothing (AC-17)');
select pg_temp.sign_out();

select pg_temp.sign_in('00000000-0000-4000-8000-0000000015a1', 'aal2', 'admin15@example.test');
select is(pg_temp.seen(), array[13, 9, 1, 1, 1, 1], 'an admin with MFA reads every dashboard table');
select throws_ok($$select count(*) from public.tracked_flight_adds$$, '42501', null,
  'the adds log stays server-only, admins included');
select throws_ok(
  $$update public.provider_catalog set hard_cap = 0$$, '42501', null,
  'an admin, too, changes the catalog only through the RPC'
);
select pg_temp.sign_out();

-- ---------------------------------------------------------------- the limits
select is(
  (select jsonb_object_agg(limit_key, value) from public.usage_limits where tier = 'interim'),
  '{"flights_per_trip":12,"flights_per_trip_total":20,"future_flights":30,"tracked_adds_year":72,
    "tracked_adds_30d":24,"lookups_30d":150,"lookups_day":10,"places_picks_month":15,
    "places_searches_month":300,"places_refreshes_month":30,"places_picks_day":20,
    "places_searches_day":100,"places_refreshes_day":20}'::jsonb,
  'the interim tier carries the approved caps'
);
select throws_ok($$insert into public.usage_limits values ('interim', 'other', 1)$$, '23514', null,
  'an unknown limit is refused');
select throws_ok($$insert into public.usage_limits values ('pro', 'lookups_30d', 1)$$, '23514', null,
  'a tier comes with the Pro sprint, not before');
select throws_ok($$update public.usage_limits set value = -1 where limit_key = 'lookups_day'$$, '23514', null,
  'a negative cap is refused');

-- ---------------------------------------------------------------- the catalog
select is(
  (select array_agg(provider || '/' || metric || '=' || hard_cap order by provider, metric)
   from public.provider_catalog),
  array['aerodatabox/lookup=360', 'aerodatabox/units=360', 'google_places/places_pick=800',
        'google_places/places_pick_en=800', 'google_places/places_refresh=8000',
        'google_places/places_search=9000', 'mapbox/mau=25000', 'supabase/db_size_mb=500',
        'supabase/edge_invocations=500000'],
  'the catalog holds provider_caps'' rows as they were, and the sprint''s new rows'
);
select throws_ok(
  $$update public.provider_catalog set hard_cap = 401 where provider = 'aerodatabox' and metric = 'units'$$,
  '23514', null, 'a hard cap above the quota is refused (AC-18)'
);
select throws_ok(
  $$update public.provider_catalog set alert_thresholds = '{70,85,101}' where provider = 'aerodatabox'$$,
  '23514', null, 'an alert threshold past 100 is refused'
);
select throws_ok(
  $$update public.provider_catalog set alert_thresholds = '{85,70,95}' where provider = 'aerodatabox'$$,
  '23514', null, 'the three thresholds go up'
);
select throws_ok(
  $$update public.provider_catalog set schedule_mode = null where provider = 'aerodatabox'$$,
  '23514', null, 'flight tracking always has a schedule mode'
);
select throws_ok(
  $$update public.provider_catalog set schedule_mode = 'full' where provider = 'google_places' and metric = 'places_pick'$$,
  '23514', null, 'and only flight tracking has one'
);

-- ---------------------------------------------------------------- alerts and usage
select throws_ok(
  $$insert into public.cost_alerts (provider, metric, kind, threshold, period)
    values ('aerodatabox', 'units', 'threshold', 70, current_date)$$,
  '23505', null, 'an alert is written once per threshold and period (AC-16)'
);
select lives_ok(
  $$insert into public.cost_alerts (provider, metric, kind, threshold, period)
    values ('aerodatabox', 'units', 'threshold', 85, current_date)$$,
  'the next threshold is its own alert'
);
select throws_ok(
  $$insert into public.cost_alerts (provider, metric, kind, period) values ('aerodatabox', 'units', 'flood', current_date)$$,
  '23514', null, 'a flood names its feature and numbers'
);
select throws_ok(
  $$insert into public.usage_daily (provider, metric, day, feature, platform)
    values ('aerodatabox', 'units', current_date, 'watch', 'web')$$,
  '23514', null, 'the platform is one of the closed list (AC-14)'
);
select throws_ok(
  $$insert into public.usage_daily (provider, metric, day, feature, platform)
    values ('mapbox', 'loads', current_date, 'watch', 'ios')$$,
  '23503', null, 'usage is counted only against a catalog row'
);

-- ---------------------------------------------------------------- suspensions and flights
select throws_ok(
  $$insert into public.account_suspensions (user_id, reason) values ('00000000-0000-4000-8000-0000000015a1', ' ')$$,
  '23514', null, 'a suspension needs a reason'
);
select pg_temp.sign_in('00000000-0000-4000-8000-0000000015a1', 'aal2', 'admin15@example.test');
insert into public.consents (doc_type, doc_version, action, platform, app_version)
values ('terms', 0, 'granted', 'android', '0.6.0'), ('privacy', 0, 'granted', 'android', '0.6.0');
select public.save_trip('create', '10000000-0000-4000-8000-0000000015a1', 'GRC', 'A',
  current_date, current_date + 10, null, '[]', '[]') is not null;
select pg_temp.sign_out();
insert into public.flight_watch (id, flight_number, dep_date_local)
overriding system value values (915001, 'LY81', current_date + 5);
select throws_ok(
  $$insert into public.flights (id, trip_id, user_id, direction, flight_number_input, flight_number,
      dep_date_local, dep_iata, dep_tz, watch_id, untracked_reason)
    values ('60000000-0000-4000-8000-0000000015a1', '10000000-0000-4000-8000-0000000015a1',
      '00000000-0000-4000-8000-0000000015a1', 'out', 'LY81', 'LY81', current_date + 5,
      'TLV', 'Asia/Jerusalem', 915001, 'concurrent')$$,
  '23514', null, 'a flight with a watch has no untracked reason (AC-6)'
);
select lives_ok(
  $$insert into public.flights (id, trip_id, user_id, direction, flight_number_input, flight_number,
      dep_date_local, dep_iata, dep_tz, untracked_reason)
    values ('60000000-0000-4000-8000-0000000015a2', '10000000-0000-4000-8000-0000000015a1',
      '00000000-0000-4000-8000-0000000015a1', 'out', 'LY81', 'LY81', current_date + 5,
      'TLV', 'Asia/Jerusalem', 'turnover')$$,
  'a flight without a watch keeps its reason'
);

-- ---------------------------------------------------------------- retention
insert into public.tracked_flight_adds (user_id, watch_id, added_at)
values ('00000000-0000-4000-8000-0000000015a1', 2, now() - interval '401 days'),
       ('00000000-0000-4000-8000-0000000015a1', 3, now() - interval '399 days');
insert into public.flight_lookups (user_id, day, count)
values ('00000000-0000-4000-8000-0000000015a1', current_date - 30, 1),
       ('00000000-0000-4000-8000-0000000015a1', current_date - 32, 1);
insert into public.places_calls (user_id, day, searches)
values ('00000000-0000-4000-8000-0000000015a1', current_date - 30, 1),
       ('00000000-0000-4000-8000-0000000015a1', current_date - 32, 1);
insert into public.usage_daily (provider, metric, day, feature, platform, calls, amount)
values ('aerodatabox', 'units', current_date - 401, 'watch', 'server', 1, 2);
select public.flight_data_retention();
select public.places_retention();
select public.cost_data_retention();
select is(
  (select array_agg(watch_id order by watch_id) from public.tracked_flight_adds
   where user_id = '00000000-0000-4000-8000-0000000015a1'),
  array[3::bigint], 'the adds log keeps 400 days (AC-5)'
);
select is(
  (select array_agg(day order by day) from public.flight_lookups
   where user_id = '00000000-0000-4000-8000-0000000015a1'),
  array[current_date - 30], 'flight searches are kept 31 days (AC-7)'
);
select is(
  (select array_agg(day order by day) from public.places_calls
   where user_id = '00000000-0000-4000-8000-0000000015a1'),
  array[current_date - 30], 'Places counts are kept 31 days (AC-10)'
);
select is((select count(*) from public.usage_daily where day < current_date - 400), 0::bigint,
  'the dashboard keeps 400 days');
select is((select count(*) from public.usage_daily), 1::bigint, 'and today''s usage stays');

-- An admin's change is logged with its whole key. The RPCs come in PR-G, so
-- the write runs as the owner with the admin's claims, as an RPC would.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000015a1', 'role', 'authenticated',
                    'aal', 'aal2', 'email', 'admin15@example.test')::text, true);
update public.provider_catalog set plan = 'Growth' where provider = 'aerodatabox' and metric = 'units';
delete from public.account_suspensions where user_id = '00000000-0000-4000-8000-0000000015f1';
select is(
  (select array_agg(entity || ':' || entity_id || ':' || action order by id) from public.admin_audit_log
   where actor_id = '00000000-0000-4000-8000-0000000015a1'),
  array['provider_catalog:aerodatabox/units:update',
        'account_suspensions:00000000-0000-4000-8000-0000000015f1:delete'],
  'a catalog change and a lifted suspension are logged by key (AC-13, AC-18)'
);
select pg_temp.sign_out();

-- A deleted account's adds go with it (AC-5).
delete from auth.users where id = '00000000-0000-4000-8000-0000000015f1';
select is(
  (select count(*) from public.tracked_flight_adds where user_id = '00000000-0000-4000-8000-0000000015f1'),
  0::bigint, 'a deleted account''s adds log goes with it'
);

select * from finish();
rollback;
