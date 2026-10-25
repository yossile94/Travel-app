-- Sprint 2 AC-12: one profile per user with a display name only, created
-- with the user, readable and renamable by its owner alone.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

-- The trigger fills the profile from what Google sends.
insert into auth.users (id, email, raw_user_meta_data)
values
  ('00000000-0000-4000-8000-00000000001a', 'a@example.test', '{"full_name": "  יוסי   לוי  "}'),
  ('00000000-0000-4000-8000-00000000001b', 'dana.cohen@example.test', '{}'),
  ('00000000-0000-4000-8000-00000000001c', 'c@example.test',
   json_build_object('name', repeat('א', 70))::jsonb),
  -- Neither a name nor an email: no profile, but the sign-up still works.
  ('00000000-0000-4000-8000-00000000001d', null, '{"full_name": "   "}');

create function pg_temp.sign_in(user_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
$$;

-- ---------------------------------------------------------------- structure
select ok(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'RLS is on for profiles'
);
select fk_ok('public', 'profiles', 'id', 'auth', 'users', 'id', 'a profile belongs to an auth user');
select is(
  (select confdeltype from pg_constraint
   where conrelid = 'public.profiles'::regclass and contype = 'f'),
  'c',
  'a profile is deleted with its user'
);
select table_privs_are('public', 'profiles', 'anon', array[]::text[],
  'signed-out clients have no privileges on profiles');
select table_privs_are('public', 'profiles', 'authenticated', array['SELECT'],
  'users read profiles; they write only through column grants');
select ok(
  has_column_privilege('authenticated', 'public.profiles', 'display_name', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.profiles', 'created_at', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.profiles', 'updated_at', 'UPDATE'),
  'users write the name; the server keeps the times'
);

-- ------------------------------------------------------- created with users
select is(
  (select display_name from public.profiles where id = '00000000-0000-4000-8000-00000000001a'),
  'יוסי לוי',
  'the name from Google, with whitespace tidied'
);
select is(
  (select display_name from public.profiles where id = '00000000-0000-4000-8000-00000000001b'),
  'dana.cohen',
  'without a name, the part of the email before the @'
);
select is(
  (select char_length(display_name) from public.profiles where id = '00000000-0000-4000-8000-00000000001c'),
  60,
  'a long Google name is cut to 60 characters'
);
select ok(
  exists (select 1 from auth.users where id = '00000000-0000-4000-8000-00000000001d')
  and not exists (select 1 from public.profiles where id = '00000000-0000-4000-8000-00000000001d'),
  'a sign-up without a name or email still succeeds, without a profile'
);

-- ------------------------------------------------------------------ user A
select pg_temp.sign_in('00000000-0000-4000-8000-00000000001a');
select results_eq(
  $$ select id from public.profiles $$,
  $$ values ('00000000-0000-4000-8000-00000000001a'::uuid) $$,
  'a user sees only their own profile'
);
select lives_ok(
  $$ update public.profiles set display_name = 'יוסי' where id = '00000000-0000-4000-8000-00000000001a' $$,
  'a user renames themselves'
);
select is(
  (select display_name from public.profiles where id = '00000000-0000-4000-8000-00000000001a'),
  'יוסי',
  'the new name is saved'
);
select throws_ok(
  $$ update public.profiles set display_name = ' יוסי' where id = '00000000-0000-4000-8000-00000000001a' $$,
  '23514',
  null,
  'a name with surrounding spaces is refused by the database'
);
select throws_ok(
  $$ update public.profiles set display_name = repeat('a', 61) where id = '00000000-0000-4000-8000-00000000001a' $$,
  '23514',
  null,
  'a name longer than 60 characters is refused'
);
select is_empty(
  $$ update public.profiles set display_name = 'x' where id = '00000000-0000-4000-8000-00000000001b' returning id $$,
  'a user cannot rename someone else'
);
select throws_ok(
  $$ insert into public.profiles (id, display_name) values ('00000000-0000-4000-8000-00000000001b', 'x') $$,
  '42501',
  null,
  'a user cannot create a profile for someone else'
);
select throws_ok(
  $$ update public.profiles set id = '00000000-0000-4000-8000-00000000001b'
     where id = '00000000-0000-4000-8000-00000000001a' $$,
  '42501',
  null,
  'a user cannot move their profile to another id'
);
-- Renaming as supabase-js's upsert sends it (merge-duplicates).
select lives_ok(
  $$ insert into public.profiles (id, display_name) values ('00000000-0000-4000-8000-00000000001a', 'יוסי ל.')
     on conflict (id) do update set display_name = excluded.display_name, id = excluded.id $$,
  'renaming through the PostgREST upsert works'
);
select throws_ok(
  $$ update public.profiles set display_name = E'יוסי\t' where id = '00000000-0000-4000-8000-00000000001a' $$,
  '23514',
  null,
  'a name ending in a tab is refused'
);
reset role;

-- A missing profile: the app creates its own (AC-12).
delete from public.profiles where id = '00000000-0000-4000-8000-00000000001a';
select pg_temp.sign_in('00000000-0000-4000-8000-00000000001a');
select lives_ok(
  $$ insert into public.profiles (id, display_name) values ('00000000-0000-4000-8000-00000000001a', 'יוסי לוי')
     on conflict (id) do nothing $$,
  'a user creates their own missing profile (upsert, ignore duplicates)'
);
-- Creating a missing profile never overwrites a name set meanwhile.
select lives_ok(
  $$ insert into public.profiles (id, display_name) values ('00000000-0000-4000-8000-00000000001a', 'מ-Google')
     on conflict (id) do nothing $$,
  'creating it again does nothing'
);
reset role;
select is(
  (select display_name from public.profiles where id = '00000000-0000-4000-8000-00000000001a'),
  'יוסי לוי',
  'the existing name is kept'
);

-- -------------------------------------------------------- deleted with user
delete from auth.users where id = '00000000-0000-4000-8000-00000000001b';
select is_empty(
  $$ select 1 from public.profiles where id = '00000000-0000-4000-8000-00000000001b' $$,
  'deleting the user deletes the profile'
);

select * from finish();
rollback;
