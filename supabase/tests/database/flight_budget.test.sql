-- Sprint 5 AC-6א, AC-6ב (ADR-010; Dudi's and Raz's reviews): the provider unit
-- budget over any 30 days, the cron call that carries the secret, and the
-- coverage-gate table are closed to clients.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

-- ---------------------------------------------------------------- structure
select ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('public.provider_usage'::regclass, 'public.provider_caps'::regclass,
                 'public.flight_coverage_probes'::regclass)),
  'RLS is on for the budget and coverage tables'
);
select table_privs_are('public', 'provider_usage', 'anon', array[]::text[], 'anon: no usage');
select table_privs_are('public', 'provider_usage', 'authenticated', array[]::text[], 'users: no usage');
select table_privs_are('public', 'provider_caps', 'authenticated', array[]::text[], 'users: no caps');
select table_privs_are('public', 'flight_coverage_probes', 'anon', array[]::text[], 'anon: no probes');
select table_privs_are('public', 'flight_coverage_probes', 'authenticated', array[]::text[],
  'users: no probes');
select ok(
  not has_sequence_privilege('anon', 'public.flight_coverage_probes_id_seq', 'USAGE'),
  'the probes sequence is closed to clients'
);
select ok(
  (select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
   where oid in ('public.spend_provider_units(text,integer)'::regprocedure,
                 'public.call_cron_job(text,jsonb)'::regprocedure)),
  'both functions are security definer with an empty search_path'
);
select ok(
  not has_function_privilege('authenticated', 'public.spend_provider_units(text,integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.spend_provider_units(text,integer)', 'EXECUTE'),
  'clients cannot spend units'
);
select ok(
  has_function_privilege('service_role', 'public.spend_provider_units(text,integer)', 'EXECUTE'),
  'the functions spend units with the service role'
);
select ok(
  not has_function_privilege('authenticated', 'public.call_cron_job(text,jsonb)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.call_cron_job(text,jsonb)', 'EXECUTE'),
  'only the database itself sends the cron secret'
);

-- ---------------------------------------------------------------- the cap
select is((select cap from public.provider_caps where provider = 'aerodatabox'), 360,
  'the cap is a setting: 360 units');
select is(
  (select bool_and(public.spend_provider_units('aerodatabox', 2)) from generate_series(1, 179)),
  true, '179 calls of 2 units pass'
);
select is(public.spend_provider_units('aerodatabox', 2), true, 'the call that reaches 360 passes');
select is(public.spend_provider_units('aerodatabox', 1), false, 'one unit over the cap is refused');
select is(
  (select sum(units)::integer from public.provider_usage where provider = 'aerodatabox'), 360,
  'a refused call spends nothing'
);
-- Units older than 30 days no longer count (a rolling window, Dudi #3).
update public.provider_usage set day = day - 30 where provider = 'aerodatabox';
select is(public.spend_provider_units('aerodatabox', 2), true, 'units from 30 days ago are free again');
update public.provider_caps set cap = 4000 where provider = 'aerodatabox';
select is(
  (select bool_and(public.spend_provider_units('aerodatabox', 10)) from generate_series(1, 50)),
  true, 'a paid plan is a change of the setting, not of code'
);
select throws_ok($$select public.spend_provider_units('aerodatabox', 0)$$, 'P0001', null,
  'zero units is refused');
select throws_ok($$select public.spend_provider_units('aerodatabox', 11)$$, 'P0001', null,
  'more than 10 units at once is refused');
select is(public.spend_provider_units('unknown', 1), false, 'a provider without a cap spends nothing');

-- ---------------------------------------------------------------- coverage and cron
select throws_ok(
  $$insert into public.flight_coverage_probes (flight_number, airline, dep_date_local, sched_dep_utc, probe_kind, probe_at)
    values ('LY 81', 'LY', '2026-10-27', now(), 'early', now())$$,
  '23514', null, 'a spaced flight number is refused'
);
select throws_ok($$select public.call_cron_job('delete-account', '{}')$$, 'P0001', null,
  'the secret goes only to the cron functions');
select ok(
  not exists (select 1 from cron.job where command ilike '%cron_secret%' and jobname like 'flight-%'
              and command not ilike '%call_cron_job%'),
  'no cron command holds the secret itself'
);

select * from finish();
rollback;
