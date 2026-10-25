-- Sprint 2 AC-16 to AC-18: deleting an account in one transaction, logged
-- with its reason, run only by the server; and the daily purge of users who
-- never consented.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

-- A: consented, new. B: consented to terms version 0 only (then version 1 is
-- published), 40 days old. C: never consented, 31 days old. D: never
-- consented, 29 days old.
insert into auth.users (id, email, created_at)
values
  ('00000000-0000-4000-8000-00000000003a', 'a@example.test', now()),
  ('00000000-0000-4000-8000-00000000003b', 'b@example.test', now() - interval '40 days'),
  ('00000000-0000-4000-8000-00000000003c', 'c@example.test', now() - interval '31 days'),
  ('00000000-0000-4000-8000-00000000003d', 'd@example.test', now() - interval '29 days'),
  -- E consented and later withdrew: they once agreed, so they are kept.
  ('00000000-0000-4000-8000-00000000003e', 'e@example.test', now() - interval '35 days'),
  -- F and G never consented, 32 and 33 days old: for the batch size.
  ('00000000-0000-4000-8000-00000000003f', 'f@example.test', now() - interval '32 days'),
  ('00000000-0000-4000-8000-000000000040', 'g@example.test', now() - interval '33 days');

create function pg_temp.sign_in(user_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
$$;

select pg_temp.sign_in('00000000-0000-4000-8000-00000000003a');
insert into public.consents (doc_type, doc_version, action, platform, app_version)
values ('terms', 0, 'granted', 'android', '0.3.0'), ('privacy', 0, 'granted', 'android', '0.3.0');
insert into public.trips (country_iso2, title, start_date, end_date)
values ('TH', 'תאילנד', '2027-08-01', '2027-08-10');
reset role;
select pg_temp.sign_in('00000000-0000-4000-8000-00000000003b');
insert into public.consents (doc_type, doc_version, action, platform, app_version)
values ('terms', 0, 'granted', 'android', '0.3.0'), ('privacy', 0, 'granted', 'android', '0.3.0');
reset role;
select pg_temp.sign_in('00000000-0000-4000-8000-00000000003e');
insert into public.consents (doc_type, doc_version, action, platform, app_version)
values ('terms', 0, 'granted', 'android', '0.3.0');
insert into public.consents (doc_type, doc_version, action, platform, app_version)
values ('terms', 0, 'withdrawn', 'android', '0.3.0');
reset role;
-- Newer terms that B has not accepted yet.
insert into public.legal_documents (doc_type, version) values ('terms', 1);

-- ---------------------------------------------------------------- structure
select ok(
  (select relrowsecurity from pg_class where oid = 'public.account_deletions'::regclass),
  'RLS is on for account_deletions'
);
select ok(
  not exists (
    select 1 from pg_constraint
    where conrelid = 'public.account_deletions'::regclass and contype = 'f'
  ),
  'the deletion log has no foreign key: the user is gone'
);
select table_privs_are('public', 'account_deletions', 'anon', array[]::text[],
  'signed-out clients have no access to the deletion log');
select table_privs_are('public', 'account_deletions', 'authenticated', array[]::text[],
  'users have no access to the deletion log');
select function_privs_are('public', 'admin_delete_user', array['uuid', 'text'], 'authenticated',
  array[]::text[], 'users cannot run the deletion function themselves');
select function_privs_are('public', 'admin_delete_user', array['uuid', 'text'], 'anon',
  array[]::text[], 'signed-out clients cannot run the deletion function');
select function_privs_are('public', 'purge_unconsented_users', array['integer', 'integer'],
  'authenticated', array[]::text[], 'users cannot run the purge');
select function_privs_are('public', 'purge_unconsented_users', array['integer', 'integer'],
  'anon', array[]::text[], 'signed-out clients cannot run the purge');
select results_eq(
  $$ select schedule, btrim(command) from cron.job where jobname = 'purge-unconsented-users' $$,
  $$ values ('17 3 * * *'::text, 'select public.purge_unconsented_users();'::text) $$,
  'the purge runs every day'
);

-- -------------------------------------------- a user can't delete anyone
select pg_temp.sign_in('00000000-0000-4000-8000-00000000003a');
select throws_ok(
  $$ select public.admin_delete_user('00000000-0000-4000-8000-00000000003b', 'user_request') $$,
  '42501',
  null,
  'a signed-in user cannot call the deletion function'
);
reset role;

-- ------------------------------------------------- deletion by the server
set local role service_role;
select is(
  public.admin_delete_user('00000000-0000-4000-8000-00000000003a', 'user_request'),
  true,
  'the server deletes a user'
);
select is(
  public.admin_delete_user('00000000-0000-4000-8000-00000000003a', 'user_request'),
  false,
  'deleting again answers "no such user" (a retry after a lost response)'
);
reset role;
select is_empty(
  $$ select 1 from auth.users where id = '00000000-0000-4000-8000-00000000003a' $$,
  'the auth user is gone'
);
select is_empty(
  $$ select 1 from public.trips where user_id = '00000000-0000-4000-8000-00000000003a'
     union all select 1 from public.profiles where id = '00000000-0000-4000-8000-00000000003a' $$,
  'their trips and profile are gone'
);
select is(
  (select count(*)::int from public.consents where user_id = '00000000-0000-4000-8000-00000000003a'),
  2,
  'their consent log is kept'
);
select results_eq(
  $$ select reason from public.account_deletions where user_id = '00000000-0000-4000-8000-00000000003a' $$,
  $$ values ('user_request'::text) $$,
  'the deletion is logged once, with its reason'
);

-- ---------------------------------------------------------- daily purge
set local role service_role;
select is(
  public.purge_unconsented_users(batch => 1, max_batches => 1),
  1,
  'one batch of one deletes exactly one user'
);
select is(public.purge_unconsented_users(batch => 1), 2, 'later batches drain the rest');
select is(public.purge_unconsented_users(), 0, 'nothing is left to purge');
reset role;
select is_empty(
  $$ select 1 from auth.users
     where id in ('00000000-0000-4000-8000-00000000003f', '00000000-0000-4000-8000-000000000040') $$,
  'F and G, who never consented, are deleted'
);
select ok(
  exists (select 1 from auth.users where id = '00000000-0000-4000-8000-00000000003e'),
  'a user who consented once and withdrew is kept'
);
select is_empty(
  $$ select 1 from auth.users where id = '00000000-0000-4000-8000-00000000003c' $$,
  'a user who never consented, 31 days old, is deleted'
);
select results_eq(
  $$ select id from auth.users
     where id in ('00000000-0000-4000-8000-00000000003b', '00000000-0000-4000-8000-00000000003d')
     order by id $$,
  $$ values ('00000000-0000-4000-8000-00000000003b'::uuid), ('00000000-0000-4000-8000-00000000003d'::uuid) $$,
  'kept: a user who consented to older terms, and one not yet 30 days old'
);
select results_eq(
  $$ select reason from public.account_deletions where user_id = '00000000-0000-4000-8000-00000000003c' $$,
  $$ values ('no_consent_30d'::text) $$,
  'the purge logs its reason'
);

select * from finish();
rollback;
