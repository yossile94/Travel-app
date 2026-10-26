-- Sprint 3 AC-1 to AC-5, AC-9: travelers and cities belong to the trip's
-- owner, follow the consent gate, keep their limits in the schema, and the
-- whole trip is saved in one call (save_trip).
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(54);

insert into auth.users (id, email)
values
  ('00000000-0000-4000-8000-00000000003a', 'a3@example.test'),
  ('00000000-0000-4000-8000-00000000003b', 'b3@example.test'),
  ('00000000-0000-4000-8000-00000000003c', 'c3@example.test');

create function pg_temp.sign_in(user_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
$$;
create function pg_temp.save_hint(p_id uuid) returns text language plpgsql as $$
declare h text;
begin
  perform public.save_trip('create', p_id, 'THA', 'x', '2027-01-01', '2027-01-02', null, '[]', '[]');
  return null;
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return h;
end;
$$;
create function pg_temp.consent() returns void language sql as $$
  insert into public.consents (doc_type, doc_version, action, platform, app_version)
  values ('terms', 0, 'granted', 'android', '0.4.0'), ('privacy', 0, 'granted', 'android', '0.4.0');
$$;
select pg_temp.sign_in('00000000-0000-4000-8000-00000000003a');
select pg_temp.consent();
reset role;
select pg_temp.sign_in('00000000-0000-4000-8000-00000000003b');
select pg_temp.consent();
reset role;

-- ---------------------------------------------------------------- structure
select ok(
  (select relrowsecurity from pg_class where oid = 'public.trip_travelers'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.trip_cities'::regclass),
  'RLS is on for travelers and cities'
);
select table_privs_are('public', 'trip_travelers', 'anon', array[]::text[],
  'signed-out clients have no privileges on travelers');
select table_privs_are('public', 'trip_cities', 'authenticated', array['SELECT', 'DELETE'],
  'cities are inserted through column grants and never updated');
select ok(
  not has_column_privilege('authenticated', 'public.trip_travelers', 'user_id', 'INSERT'),
  'the owner of a traveler is set by the server'
);
select has_index('public', 'trip_cities', 'trip_cities_user', array['user_id'],
  'cities are indexed by user for the export');
select has_index('public', 'trip_travelers', 'trip_travelers_user', array['user_id'],
  'travelers are indexed by user for the export');
select table_privs_are('public', 'trip_travelers', 'authenticated', array['SELECT', 'DELETE'],
  'travelers are inserted through column grants and never updated');
select ok(
  exists (select 1 from pg_constraint where conname = 'trips_id_user_key' and conrelid = 'public.trips'::regclass),
  'trips have the (id, user_id) key the children reference'
);
select ok(
  (select not prosecdef and proconfig @> array['search_path=""'] from pg_proc
   where oid = 'public.save_trip(text, uuid, text, text, date, date, text, jsonb, jsonb)'::regprocedure),
  'save_trip runs as the caller with an empty search path'
);
select ok(
  public.text_is_clean('שלום 🏝') and public.text_is_clean('a' || chr(160) || 'b')
  and not public.text_is_clean('a' || chr(1)) and not public.text_is_clean('a' || chr(127))
  and not public.text_is_clean('a' || chr(133)) and not public.text_is_clean('a' || chr(8294)),
  'text_is_clean keeps letters and emoji, refuses control and isolate characters'
);
select function_privs_are('public', 'save_trip',
  array['text', 'uuid', 'text', 'text', 'date', 'date', 'text', 'jsonb', 'jsonb'],
  'anon', array[]::text[], 'signed-out clients cannot save trips');

-- ------------------------------------------------------- save_trip, create
select pg_temp.sign_in('00000000-0000-4000-8000-00000000003a');
select is(
  public.save_trip('create', '00000000-0000-4000-8000-0000000003a1', 'THA', 'תאילנד אוגוסט 2027',
    '2027-08-01', '2027-08-20', null,
    '[{"name":"דנה","relation":"partner"},{"name":"נועם","relation":"child"}]',
    '[{"geonameId":1609350,"name":"בנגקוק"},{"geonameId":1153671,"name":"צ''יאנג מאי"},{"name":"קו טאו"}]'),
  'ok',
  'a trip is saved with its travelers and cities in one call'
);
select results_eq(
  $$ select name, relation from public.trip_travelers
     where trip_id = '00000000-0000-4000-8000-0000000003a1' order by position $$,
  $$ values ('דנה'::text, 'partner'::text), ('נועם', 'child') $$,
  'travelers are kept in order'
);
select results_eq(
  $$ select geoname_id, name from public.trip_cities
     where trip_id = '00000000-0000-4000-8000-0000000003a1' order by position $$,
  $$ values (1609350, 'בנגקוק'::text), (1153671, 'צ''יאנג מאי'), (null::integer, 'קו טאו') $$,
  'cities are kept in order, a hand-typed one without an id'
);
select is(
  (select user_id from public.trip_cities where trip_id = '00000000-0000-4000-8000-0000000003a1' limit 1),
  '00000000-0000-4000-8000-00000000003a'::uuid,
  'the children belong to the trip''s owner'
);

-- A retry of the same create (the first answer was lost) writes the current values once.
select is(
  public.save_trip('create', '00000000-0000-4000-8000-0000000003a1', 'THA', 'ירח דבש',
    '2027-08-01', '2027-08-21', null, '[{"name":"דנה"}]', '[]'),
  'ok',
  'the same id again is a success'
);
select results_eq(
  $$ select (select count(*) from public.trips where id = '00000000-0000-4000-8000-0000000003a1')::int,
            (select title from public.trips where id = '00000000-0000-4000-8000-0000000003a1'),
            (select count(*) from public.trip_travelers where trip_id = '00000000-0000-4000-8000-0000000003a1')::int,
            (select count(*) from public.trip_cities where trip_id = '00000000-0000-4000-8000-0000000003a1')::int $$,
  $$ values (1, 'ירח דבש'::text, 1, 0) $$,
  'one trip, with the values of the retry'
);

-- ------------------------------------------------------- save_trip, update
select is(
  public.save_trip('update', '00000000-0000-4000-8000-0000000003a1', 'GRC', 'ירח דבש בתאילנד',
    '2027-08-02', '2027-08-21', 'הערה', '[{"name":"דנה","relation":null}]', '[{"geonameId":1609350,"name":"בנגקוק"},{"geonameId":1609350,"name":"בנגקוק"}]'),
  'ok',
  'an update replaces the details'
);
select is(
  (select country_adm0 from public.trips where id = '00000000-0000-4000-8000-0000000003a1'),
  'THA',
  'the country never changes on update'
);
select is(
  (select count(*)::int from public.trip_cities where trip_id = '00000000-0000-4000-8000-0000000003a1'),
  2,
  'the same city may appear twice'
);
select is(
  public.save_trip('update', '00000000-0000-4000-8000-0000000003ff', 'THA', 'x',
    '2027-08-01', '2027-08-02', null, '[]', '[]'),
  'gone',
  'updating a trip that no longer exists answers gone'
);
select is_empty(
  $$ select 1 from public.trips where id = '00000000-0000-4000-8000-0000000003ff' $$,
  'a deleted trip is never re-created by an update'
);

-- ------------------------------------------------------------------ limits
select throws_ok(
  $$ select public.save_trip('create', '00000000-0000-4000-8000-0000000003a2', 'THA', 'x', '2027-01-01', '2027-01-02', null,
       (select jsonb_agg(jsonb_build_object('name', 'n' || g)) from generate_series(1, 10) g), '[]') $$,
  '22023', null, 'at most 9 travelers'
);
select throws_ok(
  $$ select public.save_trip('create', '00000000-0000-4000-8000-0000000003a2', 'THA', 'x', '2027-01-01', '2027-01-02', null,
       '[]', (select jsonb_agg(jsonb_build_object('name', 'c' || g)) from generate_series(1, 11) g)) $$,
  '22023', null, 'at most 10 cities'
);
select throws_ok(
  $$ select public.save_trip('create', '00000000-0000-4000-8000-0000000003a2', 'THA', 'x', '2027-01-01', '2027-01-02', null,
       jsonb_build_array(jsonb_build_object('name', repeat('א', 41))), '[]') $$,
  '23514', null, 'a traveler''s name is at most 40 characters'
);
select throws_ok(
  $$ select public.save_trip('create', '00000000-0000-4000-8000-0000000003a2', 'THA', 'x', '2027-01-01', '2027-01-02', null,
       '[]', jsonb_build_array(jsonb_build_object('name', repeat('א', 61)))) $$,
  '23514', null, 'a city''s name is at most 60 characters'
);
select throws_ok(
  $$ select public.save_trip('create', '00000000-0000-4000-8000-0000000003a2', 'THA', 'x', '2027-01-01', '2027-01-02', null,
       jsonb_build_array(jsonb_build_object('name', 'דנה' || chr(8238))), '[]') $$,
  '23514', null, 'a bidi control character is refused'
);
select throws_ok(
  $$ select public.save_trip('create', '00000000-0000-4000-8000-0000000003a2', 'THA', 'x', '2027-01-01', '2027-01-02', null,
       '[{"name":"דנה","relation":"cousin"}]', '[]') $$,
  '23514', null, 'a relation outside the list is refused'
);
select is_empty(
  $$ select 1 from public.trips where id = '00000000-0000-4000-8000-0000000003a2' $$,
  'a refused save leaves nothing behind (one transaction)'
);
select throws_ok(
  $$ select public.save_trip('create', '00000000-0000-4000-8000-0000000003a2', 'THA', 'x', '2027-01-01', '2027-01-02', null, '["דנה"]', '[]') $$,
  '22023', null, 'a traveler that is not an object is refused'
);
select throws_ok(
  $$ select public.save_trip('create', '00000000-0000-4000-8000-0000000003a2', 'THA', 'x', '2027-01-01', '2027-01-02', null, '[{"name":5}]', '[]') $$,
  '22023', null, 'a name that is not text is refused'
);
select throws_ok(
  $$ select public.save_trip('create', '00000000-0000-4000-8000-0000000003a2', 'THA', 'x', '2027-01-01', '2027-01-02', null, '[{"relation":"child"}]', '[]') $$,
  '22023', null, 'a traveler without a name is refused'
);
select throws_ok(
  $$ select public.save_trip('create', '00000000-0000-4000-8000-0000000003a2', 'THA', 'x', '2027-01-01', '2027-01-02', null, '[]', '[{"name":"x","geonameId":"123"}]') $$,
  '22023', null, 'a GeoNames id given as text is refused'
);
select throws_ok(
  $$ select public.save_trip('create', '00000000-0000-4000-8000-0000000003a2', 'THA', 'x', '2027-01-01', '2027-01-02', null, '[]', '[{"name":"x","geonameId":1.5}]') $$,
  '22023', null, 'a GeoNames id that is not a whole number is refused'
);
select throws_ok(
  $$ select public.save_trip('create', '00000000-0000-4000-8000-0000000003a2', 'THA', 'x', '2027-01-01', '2027-01-02', null, '{"name":"x"}', '[]') $$,
  '22023', null, 'travelers that are not a list are refused'
);
select throws_ok(
  $$ select public.save_trip('replace', '00000000-0000-4000-8000-0000000003a2', 'THA', 'x', '2027-01-01', '2027-01-02', null, '[]', '[]') $$,
  '22023', null, 'an unknown mode is refused'
);
select throws_ok(
  $$ select public.save_trip('create', '00000000-0000-4000-8000-0000000003a2', 'THA', 'x', '2027-01-01', '2027-01-02', null,
       jsonb_build_array(jsonb_build_object('name', 'דנה' || chr(10) || 'x')), '[]') $$,
  '23514', null, 'a newline in a name is refused'
);
select lives_ok(
  $$ select public.save_trip('create', '00000000-0000-4000-8000-0000000003a3', 'ISL', 'איסלנד', '2027-01-01', '2027-01-02', null,
       jsonb_build_array(jsonb_build_object('name', repeat('א', 39) || '🏝')),
       jsonb_build_array(jsonb_build_object('name', repeat('ב', 60)))) $$,
  'exactly 40 and 60 characters (an emoji is one) are accepted'
);
select is(
  public.save_trip('update', '00000000-0000-4000-8000-0000000003a3', 'ISL', 'איסלנד', '2027-01-01', '2027-01-02', null,
    '[{"name":"רון"}]', '[{"name":"רייקיאוויק"}]'),
  'ok',
  'a second save in a row ...'
);
select results_eq(
  $$ select (select string_agg(name, ',' order by position) from public.trip_travelers where trip_id = '00000000-0000-4000-8000-0000000003a3'),
            (select string_agg(name, ',' order by position) from public.trip_cities where trip_id = '00000000-0000-4000-8000-0000000003a3') $$,
  $$ values ('רון'::text, 'רייקיאוויק'::text) $$,
  '... replaces the details fully: only the last save remains'
);
select throws_ok(
  $$ select public.save_trip('create', '00000000-0000-4000-8000-0000000003a3', 'GRC', 'x', '2027-01-01', '2027-01-02', null, '[]', '[]') $$,
  '23505', null, 'a create retry with another country never rewrites the trip'
);
reset role;

-- ------------------------------------------------------------------ user B
select pg_temp.sign_in('00000000-0000-4000-8000-00000000003b');
select is_empty(
  $$ select 1 from public.trip_travelers union all select 1 from public.trip_cities $$,
  'another user sees none of A''s travelers or cities'
);
select throws_ok(
  $$ select public.save_trip('create', '00000000-0000-4000-8000-0000000003a1', 'THA', 'x', '2027-01-01', '2027-01-02', null, '[]', '[]') $$,
  '23505', null, 'creating with another user''s trip id fails without revealing it'
);
select is(
  public.save_trip('update', '00000000-0000-4000-8000-0000000003a1', 'THA', 'x', '2027-01-01', '2027-01-02', null, '[]', '[]'),
  'gone',
  'updating another user''s trip touches nothing'
);
select throws_ok(
  $$ insert into public.trip_cities (trip_id, position, name)
     values ('00000000-0000-4000-8000-0000000003a1', 5, 'פריצה') $$,
  '23503', null, 'a city cannot be attached to another user''s trip'
);
select lives_ok(
  $$ delete from public.trip_travelers where trip_id = '00000000-0000-4000-8000-0000000003a1';
     delete from public.trip_cities where trip_id = '00000000-0000-4000-8000-0000000003a1' $$,
  'a delete by another user runs'
);
reset role;
select results_eq(
  $$ select (select count(*) from public.trip_travelers where trip_id = '00000000-0000-4000-8000-0000000003a1')::int,
            (select count(*) from public.trip_cities where trip_id = '00000000-0000-4000-8000-0000000003a1')::int,
            (select title from public.trips where id = '00000000-0000-4000-8000-0000000003a1') $$,
  $$ values (1, 2, 'ירח דבש בתאילנד'::text) $$,
  '... and removes or changes nothing of A''s'
);

-- ------------------------------------------------------- no consent (user C)
select pg_temp.sign_in('00000000-0000-4000-8000-00000000003c');
select throws_ok(
  $$ select public.save_trip('create', '00000000-0000-4000-8000-0000000003c1', 'THA', 'x', '2027-01-01', '2027-01-02', null, '[]', '[]') $$,
  '42501',
  'consent to the current documents is required',
  'saving without consent is refused with 42501'
);
select is(
  pg_temp.save_hint('00000000-0000-4000-8000-0000000003c1'),
  'consent_required',
  '... with the hint the app maps to the consent screen'
);
select throws_ok(
  $$ insert into public.trip_cities (trip_id, position, name)
     values ('00000000-0000-4000-8000-0000000003c9', 0, 'x') $$,
  '42501', null, 'a direct insert without consent is refused by RLS'
);
reset role;

-- A trip deleted without current consent still takes its children.
select pg_temp.sign_in('00000000-0000-4000-8000-00000000003a');
insert into public.consents (doc_type, doc_version, action, platform, app_version)
values ('terms', 0, 'withdrawn', 'android', '0.4.0');
select lives_ok(
  $$ delete from public.trips where id = '00000000-0000-4000-8000-0000000003a1' $$,
  'the owner deletes a trip without current consent'
);
reset role;
select is_empty(
  $$ select 1 from public.trip_cities where trip_id = '00000000-0000-4000-8000-0000000003a1'
     union all select 1 from public.trip_travelers where trip_id = '00000000-0000-4000-8000-0000000003a1' $$,
  'its travelers and cities go with it'
);

-- -------------------------------------------------------- deleted with user
select pg_temp.sign_in('00000000-0000-4000-8000-00000000003b');
select lives_ok(
  $$ select public.save_trip('create', '00000000-0000-4000-8000-0000000003b1', 'GRC', 'יוון',
       '2027-05-01', '2027-05-05', null, '[{"name":"רון"}]', '[{"name":"אתונה"}]') $$,
  'B saves a trip with details'
);
reset role;
delete from auth.users where id = '00000000-0000-4000-8000-00000000003b';
select is_empty(
  $$ select 1 from public.trip_travelers where user_id = '00000000-0000-4000-8000-00000000003b'
     union all select 1 from public.trip_cities where user_id = '00000000-0000-4000-8000-00000000003b' $$,
  'deleting the user deletes their travelers and cities'
);

select * from finish();
rollback;
