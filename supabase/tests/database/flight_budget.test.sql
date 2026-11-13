-- Sprint 5 AC-6א, AC-6ב (ADR-010; Dudi's and Raz's reviews): the provider unit
-- budget over any 30 days and the cron call that carries the secret are
-- closed to clients. Sprint 15 (AC-9): the cap is read from provider_catalog,
-- and the coverage gate is gone.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

-- ---------------------------------------------------------------- structure
select ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('public.provider_usage'::regclass, 'public.provider_catalog'::regclass)),
  'RLS is on for the budget tables'
);
select table_privs_are('public', 'provider_usage', 'anon', array[]::text[], 'anon: no usage');
select table_privs_are('public', 'provider_usage', 'authenticated', array[]::text[], 'users: no usage');
select ok(to_regclass('public.flight_coverage_probes') is null and to_regclass('public.provider_caps') is null,
  'the coverage gate and provider_caps are gone (AC-9)');
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
select is((select hard_cap from public.provider_catalog where provider = 'aerodatabox' and metric = 'units'), 360,
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
-- Units count for 31 days, so a 31-day billing month holds one cap (Raz 3, sprint 15).
update public.provider_usage set day = day - 30 where provider = 'aerodatabox';
select is(public.spend_provider_units('aerodatabox', 1), false, 'units from 30 days ago still count');
update public.provider_usage set day = day - 1 where provider = 'aerodatabox';
select is(public.spend_provider_units('aerodatabox', 2), true, 'units from 31 days ago are free again');
update public.provider_catalog set monthly_quota = 4000, hard_cap = 4000
where provider = 'aerodatabox' and metric = 'units';
select is(
  (select bool_and(public.spend_provider_units('aerodatabox', 10)) from generate_series(1, 50)),
  true, 'a paid plan is a change of the setting, not of code'
);
select throws_ok($$select public.spend_provider_units('aerodatabox', 0)$$, 'P0001', null,
  'zero units is refused');
select throws_ok($$select public.spend_provider_units('aerodatabox', 11)$$, 'P0001', null,
  'more than 10 units at once is refused');
select is(public.spend_provider_units('unknown', 1), false, 'a provider without a cap spends nothing');

-- ---------------------------------------------------------------- cron
select throws_ok($$select public.call_cron_job('delete-account', '{}')$$, 'P0001', null,
  'the secret goes only to the cron functions');
select throws_ok($$select public.call_cron_job('flight-coverage', '{}')$$, 'P0001', null,
  'and no longer to the removed coverage gate');
select ok(not exists (select 1 from cron.job where jobname like 'flight-coverage%'),
  'the coverage cron jobs are gone');
select ok(
  not exists (select 1 from cron.job where command ilike '%cron_secret%' and jobname like 'flight-%'
              and command not ilike '%call_cron_job%'),
  'no cron command holds the secret itself'
);

select * from finish();
rollback;
