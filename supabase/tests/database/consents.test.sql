-- Sprint 1 AC-17: the consent log is append-only, per user, with the server
-- deciding who and when, and only current document versions accepted.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

-- Two users. Only the columns a Google sign-in fills matter here.
insert into auth.users (id, email)
values
  ('00000000-0000-4000-8000-00000000000a', 'a@example.test'),
  ('00000000-0000-4000-8000-00000000000b', 'b@example.test');

create function pg_temp.sign_in(user_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
$$;

-- ---------------------------------------------------------------- structure
select ok(
  (select relrowsecurity from pg_class where oid = 'public.consents'::regclass),
  'RLS is on for consents'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.legal_documents'::regclass),
  'RLS is on for legal_documents'
);
select has_index('public', 'consents', 'consents_user_type_time', 'consents are indexed for "my latest decision"');
select ok(
  not exists (
    select 1 from pg_constraint
    where conrelid = 'public.consents'::regclass and contype = 'f'
      and confrelid = 'auth.users'::regclass
  ),
  'consents outlive a deleted account (no foreign key to auth.users)'
);
select fk_ok(
  'public', 'consents', array['doc_type', 'doc_version'],
  'public', 'legal_documents', array['doc_type', 'version'],
  'a consent names a document version that exists'
);

-- ------------------------------------------------------------------- grants
select table_privs_are('public', 'consents', 'anon', array[]::text[],
  'signed-out clients have no privileges on consents');
select table_privs_are('public', 'consents', 'authenticated', array['SELECT', 'INSERT'],
  'signed-in users can only read and add consents');
select table_privs_are('public', 'legal_documents', 'anon', array['SELECT'],
  'legal documents are read-only for signed-out clients');
select table_privs_are('public', 'legal_documents', 'authenticated', array['SELECT'],
  'legal documents are read-only for users');
select table_privs_are('public', 'current_legal_documents', 'anon', array['SELECT'],
  'the current-documents view is read-only');
select sequence_privs_are('public', 'consents_id_seq', 'authenticated', array[]::text[],
  'users have no direct use of the consents sequence');

-- -------------------------------------------------------- signed out (anon)
set local role anon;
select results_eq(
  $$ select doc_type, version from public.current_legal_documents order by doc_type $$,
  $$ values ('privacy'::text, 0), ('terms'::text, 0) $$,
  'anyone can read the current documents (draft version 0)'
);
select throws_ok(
  $$ insert into public.consents (doc_type, doc_version, action, platform, app_version)
     values ('terms', 0, 'granted', 'android', '0.2.0') $$,
  '42501',
  null,
  'a signed-out client cannot record a consent'
);
select throws_ok(
  $$ insert into public.legal_documents (doc_type, version) values ('terms', 9) $$,
  '42501',
  null,
  'the app cannot publish a document'
);
reset role;

-- ------------------------------------------------------------------ user A
select pg_temp.sign_in('00000000-0000-4000-8000-00000000000a');

select lives_ok(
  $$ insert into public.consents (doc_type, doc_version, action, platform, app_version)
     values ('terms', 0, 'granted', 'android', '0.2.0'),
            ('privacy', 0, 'granted', 'android', '0.2.0'),
            ('marketing', null, 'withdrawn', 'android', '0.2.0') $$,
  'a user records consent to the current versions and an optional choice'
);
select throws_ok(
  $$ insert into public.consents (doc_type, doc_version, action, platform, app_version)
     values ('terms', 1, 'granted', 'android', '0.2.0') $$,
  '22023',
  null,
  'a version that is not current is refused'
);
select throws_ok(
  $$ insert into public.consents (doc_type, doc_version, action, platform, app_version)
     values ('analytics', 0, 'granted', 'android', '0.2.0') $$,
  '23514',
  null,
  'an optional choice carries no document version'
);
select throws_ok(
  $$ insert into public.consents (doc_type, doc_version, action, platform, app_version)
     values ('terms', 0, 'maybe', 'android', '0.2.0') $$,
  '23514',
  null,
  'only granted or withdrawn'
);

-- The server decides who and when, whatever the client sends.
insert into public.consents (user_id, doc_type, action, platform, app_version, created_at)
values ('00000000-0000-4000-8000-00000000000b', 'analytics', 'granted', 'android', '0.2.0', '2000-01-01');
select is(
  (select user_id from public.consents where doc_type = 'analytics'),
  '00000000-0000-4000-8000-00000000000a'::uuid,
  'a row is always recorded for the signed-in user'
);
select ok(
  (select created_at > now() - interval '1 minute' from public.consents where doc_type = 'analytics'),
  'a client cannot backdate a consent'
);

select throws_ok(
  $$ update public.consents set action = 'withdrawn' $$,
  '42501',
  null,
  'consents cannot be edited'
);
select throws_ok(
  $$ delete from public.consents $$,
  '42501',
  null,
  'consents cannot be deleted'
);
select is(
  (select count(*)::int from public.consents),
  4,
  'user A sees their own four rows'
);

-- ------------------------------------------------------------------ user B
select pg_temp.sign_in('00000000-0000-4000-8000-00000000000b');
select is(
  (select count(*)::int from public.consents),
  0,
  'user B sees none of user A''s consents'
);
reset role;

-- ------------------------------------------------- a new version is published
insert into public.legal_documents (doc_type, version, published_at)
values ('terms', 1, now() + interval '1 day');
select is(
  (select version from public.current_legal_documents where doc_type = 'terms'),
  0,
  'a version takes effect only once it is published'
);
update public.legal_documents set published_at = now() - interval '1 second'
where doc_type = 'terms' and version = 1;
select is(
  (select version from public.current_legal_documents where doc_type = 'terms'),
  1,
  'the newest published version is the current one'
);
select pg_temp.sign_in('00000000-0000-4000-8000-00000000000a');
select throws_ok(
  $$ insert into public.consents (doc_type, doc_version, action, platform, app_version)
     values ('terms', 0, 'granted', 'android', '0.2.0') $$,
  '22023',
  null,
  'consent to the superseded version is refused (the app must ask again, AC-18)'
);

-- ----------------------------------------- published documents are evidence
reset role;
select throws_ok(
  $$ delete from public.legal_documents where doc_type = 'privacy' and version = 0 $$,
  '55000',
  null,
  'a published version cannot be deleted'
);
select throws_ok(
  $$ update public.legal_documents set published_at = now() + interval '1 year'
     where doc_type = 'privacy' and version = 0 $$,
  '55000',
  null,
  'a published version cannot be re-dated'
);
-- The insert trigger refuses unknown versions first (22023); switched off
-- here so the foreign key itself is shown to hold (rolled back at the end).
alter table public.consents disable trigger consents_before_insert;
select throws_ok(
  $$ insert into public.consents (user_id, doc_type, doc_version, action, platform, app_version)
     values ('00000000-0000-4000-8000-00000000000a', 'privacy', 7, 'granted', 'android', '0.2.0') $$,
  '23503',
  null,
  'a consent to a version that does not exist is refused (foreign key)'
);
alter table public.consents enable trigger consents_before_insert;

select * from finish();
rollback;
