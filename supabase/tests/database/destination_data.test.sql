-- Sprint 4 F-012, F-013: rates and advisories are public to read, written
-- only by the service role, keep their limits in the schema, and every level
-- or entry change is recorded.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

-- ---------------------------------------------------------------- structure
select ok(
  (select relrowsecurity from pg_class where oid = 'public.exchange_rates'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.country_advisories'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.country_advisory_changes'::regclass),
  'RLS is on for rates, advisories and their changes'
);
select table_privs_are('public', 'exchange_rates', 'anon', array['SELECT'],
  'signed-out clients only read rates');
select table_privs_are('public', 'exchange_rates', 'authenticated', array['SELECT'],
  'signed-in clients only read rates');
select table_privs_are('public', 'country_advisories', 'anon', array['SELECT'],
  'signed-out clients only read advisories');
select table_privs_are('public', 'country_advisory_changes', 'authenticated', array[]::text[],
  'clients never see the change log');
select table_privs_are('public', 'country_advisory_changes', 'anon', array[]::text[],
  'nor do signed-out clients');
select table_privs_are('public', 'country_advisories', 'authenticated', array['SELECT'],
  'signed-in clients only read advisories');
select table_privs_are('public', 'job_runs', 'anon', array[]::text[],
  'clients never see the job runs');
select ok(
  (select prosecdef and proconfig @> array['search_path=""'] from pg_proc
   where oid = 'public.record_advisory_change()'::regprocedure)
  and not has_function_privilege('authenticated', 'public.record_advisory_change()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.claim_job_run(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.call_daily_job(text)', 'EXECUTE'),
  'the trigger and job functions run as their owner and clients cannot call them'
);
select is(
  (select count(*)::int from cron.job where jobname like '%-daily%'),
  4,
  'four daily jobs are scheduled (two jobs and their retries)'
);

-- ------------------------------------------------------------- as service
insert into public.exchange_rates (currency, rate_to_ils, rate_to_usd, source, rate_date)
values ('THB', 0.0951, 0.0309, 'erapi', '2026-10-26'), ('USD', 3.078, 1, 'boi', '2026-10-26');
insert into public.country_advisories (adm0, nsc_level, nsc_text, nsc_url, fetched_at)
values ('THA', 2, 'רמה 2', 'https://www.gov.il/he/pages/thailand1', now());

select throws_ok(
  $$ insert into public.exchange_rates (currency, rate_to_ils, rate_to_usd, source, rate_date)
     values ('thb', 1, 1, 'erapi', '2026-10-26') $$,
  '23514', null, 'a currency is three capital letters'
);
select throws_ok(
  $$ insert into public.exchange_rates (currency, rate_to_ils, rate_to_usd, source, rate_date)
     values ('EUR', 0, 1, 'boi', '2026-10-26') $$,
  '23514', null, 'a rate is positive'
);
select throws_ok(
  $$ insert into public.exchange_rates (currency, rate_to_ils, rate_to_usd, source, rate_date)
     values ('EUR', 1, 1, 'ecb', '2026-10-26') $$,
  '23514', null, 'only the two known sources'
);
select throws_ok(
  $$ insert into public.country_advisories (adm0, nsc_level) values ('GRC', 5) $$,
  '23514', null, 'an NSC level is 1 to 4'
);
select throws_ok(
  $$ insert into public.country_advisories (adm0, entry_status) values ('MDV', 'banned') $$,
  '23514', null, 'an entry status needs its source and the date it was checked'
);
select throws_ok(
  $$ insert into public.country_advisories (adm0, nsc_url) values ('GRC', 'http://x.example') $$,
  '23514', null, 'links are https'
);

update public.country_advisories set nsc_level = 4 where adm0 = 'THA';
update public.country_advisories set nsc_text = 'טקסט חדש' where adm0 = 'THA';
select results_eq(
  $$ select field, old_value, new_value from public.country_advisory_changes where adm0 = 'THA' $$,
  $$ values ('nsc_level'::text, '2'::text, '4'::text) $$,
  'a level change is recorded once; a text-only change is not'
);
update public.country_advisories
set entry_status = 'restricted', entry_source_url = 'https://www.gov.il/x', entry_verified_at = '2026-10-26'
where adm0 = 'THA';
select is(
  (select count(*)::int from public.country_advisory_changes where adm0 = 'THA' and field = 'entry_status'),
  1,
  'an entry status change is recorded'
);

-- A run is claimed once an hour, whoever asks (ADR-008).
select ok(public.claim_job_run('rates'), 'the first claim of the hour wins');
select ok(public.claim_job_run('rates') is null, 'a second claim within the hour is refused');
update public.job_runs set claimed_at = now() - interval '59 minutes 59 seconds' where name = 'rates';
select ok(public.claim_job_run('rates'), 'the retry an hour later always runs, even a little early (Dudi, E1)');
update public.country_advisories set nsc_level = null where adm0 = 'THA';
select ok(
  (select new_value is null and old_value = '4' from public.country_advisory_changes
   where adm0 = 'THA' and field = 'nsc_level' order by id desc limit 1),
  'a level that goes away is recorded too'
);

-- -------------------------------------------------------------- as a client
set local role anon;
select results_eq(
  $$ select currency from public.exchange_rates order by currency $$,
  $$ values ('THB'::text), ('USD') $$,
  'a signed-out client reads the rates'
);
select throws_ok(
  $$ insert into public.exchange_rates (currency, rate_to_ils, rate_to_usd, source, rate_date)
     values ('EUR', 1, 1, 'boi', '2026-10-26') $$,
  '42501', null, 'a client cannot write a rate'
);
select throws_ok(
  $$ update public.country_advisories set nsc_level = 1 where adm0 = 'THA' $$,
  '42501', null, 'a client cannot change an advisory'
);
select is(
  (select nsc_text from public.country_advisories where adm0 = 'THA'),
  'טקסט חדש',
  'a signed-out client reads the advisory'
);
select throws_ok(
  $$ select 1 from public.country_advisory_changes $$,
  '42501', null, 'a client cannot read the change log'
);
reset role;

select * from finish();
rollback;
