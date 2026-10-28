-- Sprint 10 F-027, F-028 (ADR-015, Raz D11–D13, D16): the admin roles are
-- read from the table with MFA; editors write only the hand-kept columns;
-- every change by a person is logged, and the log is never rewritten.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

insert into auth.users (id, email)
values
  ('00000000-0000-4000-8000-0000000010a1', 'admin@example.test'),
  ('00000000-0000-4000-8000-0000000010a2', 'admin2@example.test'),
  ('00000000-0000-4000-8000-0000000010e1', 'editor@example.test'),
  ('00000000-0000-4000-8000-0000000010u1', 'user@example.test');

insert into public.admin_roles (user_id, role)
values
  ('00000000-0000-4000-8000-0000000010a1', 'admin'),
  ('00000000-0000-4000-8000-0000000010e1', 'content_editor');

insert into public.country_advisories (adm0, nsc_level, nsc_text, fetched_at)
values ('ZZA', 2, 'level 2', now());

create function pg_temp.sign_in(user_id uuid, aal text, email text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', user_id, 'role', 'authenticated', 'aal', aal, 'email', email)::text, true);
  set local role authenticated;
$$;

-- ---------------------------------------------------------------- structure
select ok(
  (select relrowsecurity from pg_class where oid = 'public.admin_roles'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.admin_audit_log'::regclass),
  'RLS is on for roles and the audit log'
);
select table_privs_are('public', 'admin_roles', 'anon', array[]::text[], 'signed-out clients never see roles');
select table_privs_are('public', 'admin_audit_log', 'anon', array[]::text[], 'nor the audit log');
select table_privs_are('public', 'admin_audit_log', 'authenticated', array['SELECT'],
  'signed-in clients can at most read the log (RLS: admins)');
select table_privs_are('public', 'admin_roles', 'authenticated', array['SELECT'],
  'roles are written through the functions only');

-- ---------------------------------------------------------------- MFA and roles
select pg_temp.sign_in('00000000-0000-4000-8000-0000000010e1', 'aal1', 'editor@example.test');
select is(public.has_role('content_editor'), false, 'an editor without MFA has no role (AC-16)');
select is(public.my_roles(), '{}'::text[], 'and the panel sees no roles');
update public.country_advisories set entry_note = 'aal1' where adm0 = 'ZZA';
reset role;
select is((select entry_note from public.country_advisories where adm0 = 'ZZA'), null,
  'without MFA an editor changes nothing');

select pg_temp.sign_in('00000000-0000-4000-8000-0000000010e1', 'aal2', 'editor@example.test');
select is(public.my_roles(), array['content_editor'], 'with MFA the editor sees the role');
select is(public.has_role('admin'), false, 'an editor is not an admin');
update public.country_advisories
  set entry_status = 'allowed', entry_source_url = 'https://gov.example.test', entry_verified_at = current_date,
      passport_validity_months = 3
  where adm0 = 'ZZA';
select throws_ok(
  $$update public.country_advisories set nsc_level = 4 where adm0 = 'ZZA'$$,
  '42501', null, 'an editor never writes the NSC level (D13)'
);
select throws_ok(
  $$update public.country_advisories set passport_validity_months = 13 where adm0 = 'ZZA'$$,
  '23514', null, 'validity is 0 to 12 months'
);
select throws_ok(
  $$update public.country_advisories set entry_status = 'banned', entry_source_url = null where adm0 = 'ZZA'$$,
  '23514', null, 'a status without its source is refused (AC-23)'
);
insert into public.min_connection_times (iata, minutes, source_url, verified_at)
values ('ZZA', 75, 'https://airport.example.test', current_date);
select throws_ok(
  $$insert into public.min_connection_times (iata, minutes, source_url, verified_at)
    values ('ZZB', 400, 'https://airport.example.test', current_date)$$,
  '23514', null, 'MCT over 360 minutes is refused (AC-22)'
);
select throws_ok(
  $$select public.admin_grant_role('user@example.test', 'content_editor')$$,
  '42501', null, 'an editor never grants roles'
);
select is((select count(*)::int from public.admin_audit_log), 0, 'an editor does not read the log');
reset role;

select is(
  (select (entry_status, passport_validity_months, nsc_level)::text from public.country_advisories where adm0 = 'ZZA'),
  '(allowed,3,2)', 'the editor''s change is saved; the NSC level is untouched'
);
select is(public.connection_mct('ZZA'), 75, 'a new MCT row beats the default');

-- ---------------------------------------------------------------- the log
select is(
  (select actor_email || ' ' || action || ' ' || entity || ' ' || entity_id from public.admin_audit_log
   where entity = 'country_advisories'),
  'editor@example.test update country_advisories ZZA', 'the change is logged with who and which row (AC-18)'
);
select is(
  (select array_agg(k order by k) from public.admin_audit_log l, jsonb_object_keys(l.diff) k
   where l.entity = 'country_advisories'),
  array['entry_source_url', 'entry_status', 'entry_verified_at', 'passport_validity_months'],
  'the diff holds only the changed columns'
);
update public.country_advisories set nsc_level = 3 where adm0 = 'ZZA';
select is((select count(*)::int from public.admin_audit_log where entity = 'country_advisories'), 1,
  'a job write (no signed-in person) is not logged');
select throws_ok($$update public.admin_audit_log set actor_email = 'x'$$, '42501', null,
  'the log is never updated, even by the owner');
select throws_ok($$delete from public.admin_audit_log$$, '42501', null, 'nor deleted');

-- ---------------------------------------------------------------- admin
select pg_temp.sign_in('00000000-0000-4000-8000-0000000010a1', 'aal2', 'admin@example.test');
select is((select count(*)::int from public.admin_audit_log), 2, 'an admin reads the log');
select lives_ok($$select public.admin_grant_role('ADMIN2@example.test ', 'admin')$$,
  'an admin grants a role by email');
select throws_ok($$select public.admin_grant_role('nobody@example.test', 'admin')$$, 'P0002', null,
  'an unknown email is refused');
select throws_ok(
  $$select public.admin_revoke_role('00000000-0000-4000-8000-0000000010a1', 'admin')$$,
  '42501', null, 'no one changes their own role (D12)'
);
select lives_ok(
  $$select public.admin_revoke_role('00000000-0000-4000-8000-0000000010a2', 'admin')$$,
  'an admin removes another admin'
);
reset role;
delete from public.admin_roles where user_id = '00000000-0000-4000-8000-0000000010a2';
insert into public.admin_roles (user_id, role) values ('00000000-0000-4000-8000-0000000010a2', 'admin');
select pg_temp.sign_in('00000000-0000-4000-8000-0000000010a2', 'aal2', 'admin2@example.test');
delete from public.admin_roles where user_id = '00000000-0000-4000-8000-0000000010a1';
reset role;
select is((select count(*)::int from public.admin_roles where role = 'admin'), 2,
  'roles are never deleted directly, only through the function');
select pg_temp.sign_in('00000000-0000-4000-8000-0000000010a2', 'aal2', 'admin2@example.test');
select lives_ok($$select public.admin_revoke_role('00000000-0000-4000-8000-0000000010a1', 'admin')$$,
  'admin2 removes admin1');
reset role;
-- admin2 is now the last admin; no one else can remove them, and they can't remove themselves.
select is((select count(*)::int from public.admin_roles where role = 'admin'), 1, 'one admin is left');

select * from finish();
rollback;
