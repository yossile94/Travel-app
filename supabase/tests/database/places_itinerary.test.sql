-- Sprint 11 F-029 – F-032 (ADR-016, D2–D9, D22–D24; Dudi's review): places
-- are read by all and written by no client; curated places are published to
-- all and written by content editors (logged); the saved places and the daily
-- plan belong to the trip's owner, are written only through their functions,
-- and their limits hold in the server.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(65);

insert into auth.users (id, email, email_confirmed_at)
values
  ('00000000-0000-4000-8000-0000000011a1', 'a11@example.test', now()),
  ('00000000-0000-4000-8000-0000000011b1', 'b11@example.test', now()),
  ('00000000-0000-4000-8000-0000000011e1', 'editor11@example.test', now()),
  ('00000000-0000-4000-8000-0000000011c1', 'noconsent11@example.test', now());
insert into public.admin_roles (user_id, role)
values ('00000000-0000-4000-8000-0000000011e1', 'content_editor');

insert into public.places (wikidata_id, adm0, name_he, name_en, lat, lng, category, popularity, hidden)
values
  ('Q999999901', 'THA', null, 'Shown Temple', 13.75, 100.49, 'culture', 50, false),
  ('Q999999902', 'THA', null, 'Hidden Temple', 13.76, 100.5, 'culture', 40, true),
  -- D24: a shared place is a row in each country.
  ('Q999999903', 'CAN', null, 'Shared Falls', 43.08, -79.07, 'nature', 90, false),
  ('Q999999903', 'USA', null, 'Shared Falls', 43.08, -79.07, 'nature', 90, false);

create function pg_temp.sign_in(user_id uuid, aal text default 'aal1') returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', user_id, 'role', 'authenticated', 'aal', aal)::text, true);
  set local role authenticated;
$$;
create function pg_temp.as_anon() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
$$;
create function pg_temp.consent() returns void language sql as $$
  insert into public.consents (doc_type, doc_version, action, platform, app_version)
  values ('terms', 0, 'granted', 'android', '0.12.0'), ('privacy', 0, 'granted', 'android', '0.12.0');
$$;
-- An item for the plan; the trip runs 2027-01-10 to 2027-01-17.
create function pg_temp.item(day int, title text default 'Grand Palace', extra jsonb default '{}')
  returns jsonb language sql as $$
  select jsonb_build_object('day', date '2027-01-10' + day, 'title', title) || extra;
$$;
create function pg_temp.auto_items(day int, n int) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', gen_random_uuid(), 'day', date '2027-01-10' + day, 'time', '09:30',
    'title', 'Auto ' || g, 'order', least(g - 1, 29))), '[]')
  from generate_series(1, n) g;
$$;

select pg_temp.sign_in('00000000-0000-4000-8000-0000000011a1');
select pg_temp.consent();
select public.save_trip('create', '10000000-0000-4000-8000-0000000011a1', 'THA', 'תאילנד',
  date '2027-01-10', date '2027-01-17', null, '[]', '[]') is not null;
reset role;
select pg_temp.sign_in('00000000-0000-4000-8000-0000000011b1');
select pg_temp.consent();
select public.save_trip('create', '10000000-0000-4000-8000-0000000011b1', 'THA', 'B',
  date '2027-01-10', date '2027-01-17', null, '[]', '[]') is not null;
reset role;

-- ---------------------------------------------------------------- structure
select ok(
  (select bool_and(relrowsecurity) from pg_class where oid in (
    'public.places'::regclass, 'public.curated_places'::regclass,
    'public.trip_saved_places'::regclass, 'public.itinerary_items'::regclass)),
  'RLS is on for all four tables'
);
select table_privs_are('public', 'places', 'anon', array['SELECT'], 'anon only reads places');
select table_privs_are('public', 'places', 'authenticated', array['SELECT'], 'users only read places');
select table_privs_are('public', 'itinerary_items', 'authenticated', array['SELECT'],
  'users only read the plan; writes go through the functions');
select table_privs_are('public', 'trip_saved_places', 'authenticated', array['SELECT'],
  'users only read saved places; writes go through the functions');
select table_privs_are('public', 'itinerary_items', 'anon', array[]::text[], 'anon: no plan');
select table_privs_are('public', 'trip_saved_places', 'anon', array[]::text[], 'anon: no saved places');
select ok(
  not has_function_privilege('anon', 'public.save_itinerary_item(uuid,uuid,jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.apply_auto_plan(uuid,jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.save_place(uuid,uuid,jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.itinerary_gate(uuid)', 'EXECUTE'),
  'signed-out clients cannot write, and nobody calls the gate directly'
);
select col_is_pk('public', 'places', array['adm0', 'wikidata_id'],
  'D24: a place is keyed by country and QID');

-- ---------------------------------------------------------------- places
select pg_temp.as_anon();
select is((select count(*)::int from public.places where wikidata_id in ('Q999999901', 'Q999999902')), 1,
  'anon reads places; a hidden one is not shown');
select is((select count(*)::int from public.places where wikidata_id = 'Q999999903'), 2,
  'D24: a shared place shows in both countries');
select throws_ok($$ insert into public.places (wikidata_id, adm0, name_en, lat, lng, category, popularity)
  values ('Q1', 'THA', 'x', 1, 1, 'culture', 1) $$, '42501', null, 'anon cannot write places');
reset role;

-- ---------------------------------------------------------- curated places
select pg_temp.sign_in('00000000-0000-4000-8000-0000000011e1', 'aal2');
select lives_ok($$ insert into public.curated_places
  (adm0, category, name_he, name_en, lat, lng, source_url, verified_at, status)
  values ('THA', 'chabad', 'בית חב"ד בנגקוק', 'Chabad Bangkok',
    13.76, 100.49, 'https://chabadthailand.com', current_date, 'draft') $$,
  'a content editor with AAL2 adds a curated place');
select lives_ok($$ insert into public.curated_places
  (adm0, category, name_he, name_en, lat, lng, source_url, verified_at, status)
  values ('THA', 'kosher', 'מסעדה כשרה', 'Kosher Place',
    13.74, 100.55, 'https://example.org', current_date, 'published') $$,
  'and a published one');
select is((select count(*)::int from public.curated_places), 2, 'the editor reads drafts too');
reset role;
select is(
  (select count(*)::int from public.admin_audit_log where entity = 'curated_places'), 2,
  'every change to curated places is logged');

select pg_temp.as_anon();
select lives_ok($$ select count(*) from public.curated_places $$,
  'anon reads curated places without an error (Dudi, blocker 2)');
select is((select count(*)::int from public.curated_places), 1, 'anon sees only the published one');
reset role;

select pg_temp.sign_in('00000000-0000-4000-8000-0000000011a1');
select is((select count(*)::int from public.curated_places), 1, 'a user sees only the published one');
select throws_ok($$ insert into public.curated_places
  (adm0, category, name_he, name_en, lat, lng, source_url, verified_at)
  values ('THA', 'food', 'x', 'x', 1, 1, 'https://x.org', current_date) $$,
  '42501', null, 'a user without the role cannot write');
reset role;
select pg_temp.sign_in('00000000-0000-4000-8000-0000000011e1', 'aal1');
select is((select count(*)::int from public.curated_places), 1,
  'an editor without AAL2 sees only the published one');
reset role;

-- ---------------------------------------------------------- the daily plan
select pg_temp.sign_in('00000000-0000-4000-8000-0000000011a1');
select is(public.save_itinerary_item('20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-0000000011a1', pg_temp.item(1, 'Lunch', '{"time":"13:00"}')),
  'ok', 'an item with a time is saved');
select is(public.save_itinerary_item('20000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-0000000011a1', pg_temp.item(1, 'Breakfast', '{"time":"08:00"}')),
  'ok', 'an earlier one too');
select results_eq(
  $$ select title from public.itinerary_items where day_date = date '2027-01-11' order by sort_order $$,
  array['Breakfast', 'Lunch'],
  'a new item goes before the first later-timed item of its day (Raz design approval 3)');
select is(public.save_itinerary_item('20000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-0000000011a1', pg_temp.item(9)),
  'day', 'a day outside the trip is refused');
select is(public.save_itinerary_item('20000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-0000000011b1', pg_temp.item(1)),
  'gone', 'another user''s trip is gone');
select throws_ok($$ select public.save_itinerary_item('20000000-0000-4000-8000-000000000005',
  '10000000-0000-4000-8000-0000000011a1', '"not an object"') $$, '22023', null,
  'an item that is not an object is refused as bad input');
select throws_ok($$ select public.save_itinerary_item('20000000-0000-4000-8000-000000000005',
  '10000000-0000-4000-8000-0000000011a1', pg_temp.item(1, 'x', '{"placeRef":"wd:Q1","placeName":"x","lat":"north","lng":1}')) $$,
  '22023', null, 'a bad point is bad input, not a raw cast error');
select is(public.save_itinerary_item('20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-0000000011a1', pg_temp.item(2, 'Lunch', '{"time":"13:00"}')),
  'ok', 'a day change in the same call');
select is((select day_date from public.itinerary_items where id = '20000000-0000-4000-8000-000000000001'),
  date '2027-01-12', 'the item moved to the new day');

-- 30 a day.
reset role;
insert into public.itinerary_items (id, trip_id, user_id, day_date, title, sort_order)
select gen_random_uuid(), '10000000-0000-4000-8000-0000000011a1', '00000000-0000-4000-8000-0000000011a1',
  date '2027-01-14', 'Filler ' || g, g * 1024
from generate_series(1, 30) g;
select pg_temp.sign_in('00000000-0000-4000-8000-0000000011a1');
select is(public.save_itinerary_item('20000000-0000-4000-8000-000000000006',
  '10000000-0000-4000-8000-0000000011a1', pg_temp.item(4)),
  'limit', 'a 31st item on a day is refused');
select is(public.move_itinerary_item('20000000-0000-4000-8000-000000000002', date '2027-01-14', 0),
  'limit', 'moving into a full day is refused');
select is(public.move_itinerary_item('20000000-0000-4000-8000-000000000002', null, 0),
  'day', 'a move without a day is refused cleanly (Dudi 6)');
select is(public.move_itinerary_item('20000000-0000-4000-8000-000000000002', date '2027-01-12', 0),
  'ok', 'a move to another day');
select results_eq(
  $$ select title from public.itinerary_items where day_date = date '2027-01-12' order by sort_order $$,
  array['Breakfast', 'Lunch'], 'it goes to the position asked');

-- D13: an automatic item edited.
reset role;
insert into public.itinerary_items (id, trip_id, user_id, day_date, time_of_day, title, source, sort_order)
values ('20000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000011a1',
  '00000000-0000-4000-8000-0000000011a1', date '2027-01-13', '09:30', 'Wat Pho', 'auto', 1024);
select pg_temp.sign_in('00000000-0000-4000-8000-0000000011a1');
select is(public.save_itinerary_item('20000000-0000-4000-8000-0000000000a1',
  '10000000-0000-4000-8000-0000000011a1', pg_temp.item(3, 'Wat Pho', '{"time":"09:30","note":"shoes off"}')),
  'ok', 'a note is added to an automatic item');
select is((select source from public.itinerary_items where id = '20000000-0000-4000-8000-0000000000a1'),
  'auto', 'a note keeps it automatic (D13)');
select is(public.save_itinerary_item('20000000-0000-4000-8000-0000000000a1',
  '10000000-0000-4000-8000-0000000011a1', pg_temp.item(3, 'Wat Pho', '{"time":"10:00"}')),
  'ok', 'its time is changed');
select is((select source from public.itinerary_items where id = '20000000-0000-4000-8000-0000000000a1'),
  'manual', 'a new time makes it manual (D13)');

-- ---------------------------------------------------------- the auto plan
select is(
  public.apply_auto_plan('10000000-0000-4000-8000-0000000011a1',
    pg_temp.auto_items(5, 2) || pg_temp.auto_items(2, 1) || pg_temp.auto_items(20, 1)),
  jsonb_build_object('result', 'ok', 'inserted', 2, 'skipped', jsonb_build_array(
    jsonb_build_object('date', '2027-01-12', 'reason', 'filled_meanwhile'),
    jsonb_build_object('date', '2027-01-30', 'reason', 'out_of_range'))),
  'only empty days are filled; each skipped day says why (D2)');
select is((select count(*)::int from public.itinerary_items where day_date = date '2027-01-15' and source = 'auto'),
  2, 'the empty day got its two items');
select is(
  public.apply_auto_plan('10000000-0000-4000-8000-0000000011a1', pg_temp.auto_items(6, 31)) ->> 'result',
  'limit', '31 items for one day are refused (Dudi, blocker 3)');
select throws_ok($$ select public.apply_auto_plan('10000000-0000-4000-8000-0000000011a1',
  '[{"id":"20000000-0000-4000-8000-0000000000b1","day":"2027-01-16","title":"x","order":5000}]') $$,
  '22023', null, 'an order outside 0–29 is refused');
select throws_ok($$ select public.apply_auto_plan('10000000-0000-4000-8000-0000000011a1',
  '[{"id":"20000000-0000-4000-8000-0000000000b1","day":"2027-01-16","title":"x"}]') $$,
  '22023', null, 'an item without an order is refused');
select is((select count(*)::int from public.itinerary_items where day_date = date '2027-01-16'), 0,
  'a refused plan writes nothing');
select is(
  public.apply_auto_plan('10000000-0000-4000-8000-0000000011a1', (
    select jsonb_agg(jsonb_build_object('id', gen_random_uuid(),
      'day', case when g % 2 = 0 then '2027-01-17' else '20270117' end,
      'title', 'Auto ' || g, 'order', least(g - 1, 29)))
    from generate_series(1, 31) g)) ->> 'result',
  'limit', '31 items on one day in two spellings of the date are still 31 (Dudi)');
select is(
  public.apply_auto_plan('10000000-0000-4000-8000-0000000011b1', pg_temp.auto_items(6, 1)) ->> 'result',
  'gone', 'another user''s trip is gone');

-- ---------------------------------------------------------- saved places
select is(public.save_place('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-0000000011a1',
  '{"placeRef":"wd:Q999999901","name":"Shown Temple","lat":13.75,"lng":100.49}'), 'ok', 'a place is saved');
select is(public.save_place('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-0000000011a1',
  '{"placeRef":"wd:Q999999901","name":"Shown Temple","lat":13.75,"lng":100.49}'), 'ok',
  'saving it again is a no-op');
select is((select count(*)::int from public.trip_saved_places), 1, 'still one saved place');
reset role;
insert into public.trip_saved_places (id, trip_id, user_id, place_ref, name, lat, lng)
select gen_random_uuid(), '10000000-0000-4000-8000-0000000011a1', '00000000-0000-4000-8000-0000000011a1',
  'wd:Q' || (800000 + g), 'Filler', 1, 1
from generate_series(1, 99) g;
select pg_temp.sign_in('00000000-0000-4000-8000-0000000011a1');
select is(public.save_place('40000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-0000000011a1',
  '{"placeRef":"wd:Q700001","name":"One more","lat":1,"lng":1}'), 'limit', 'a 101st saved place is refused');
select is(public.unsave_place('10000000-0000-4000-8000-0000000011a1', 'wd:Q999999901'), 'ok', 'unsave');
reset role;

-- ------------------------------------------------- isolation and consent
select pg_temp.sign_in('00000000-0000-4000-8000-0000000011b1');
select is((select count(*)::int from public.itinerary_items), 0, 'B never reads A''s plan');
select is((select count(*)::int from public.trip_saved_places), 0, 'B never reads A''s saved places');
select is(public.delete_itinerary_item('20000000-0000-4000-8000-000000000002'), 'gone',
  'B cannot delete A''s item');
select is(public.move_itinerary_item('20000000-0000-4000-8000-000000000002', date '2027-01-12', 0), 'gone',
  'B cannot move A''s item');
reset role;

-- 600 a trip, on B's trip.
insert into public.itinerary_items (id, trip_id, user_id, day_date, title, sort_order)
select gen_random_uuid(), '10000000-0000-4000-8000-0000000011b1', '00000000-0000-4000-8000-0000000011b1',
  date '2027-01-17', 'Filler ' || g, g
from generate_series(1, 580) g;
select pg_temp.sign_in('00000000-0000-4000-8000-0000000011b1');
select is(
  public.apply_auto_plan('10000000-0000-4000-8000-0000000011b1', pg_temp.auto_items(0, 21)) ->> 'result',
  'limit', 'a plan that would pass 600 items in the trip is refused');
reset role;
insert into public.itinerary_items (id, trip_id, user_id, day_date, title, sort_order)
select gen_random_uuid(), '10000000-0000-4000-8000-0000000011b1', '00000000-0000-4000-8000-0000000011b1',
  date '2027-01-16', 'Filler ' || g, g
from generate_series(1, 20) g;
select pg_temp.sign_in('00000000-0000-4000-8000-0000000011b1');
select is(public.save_itinerary_item('20000000-0000-4000-8000-0000000000d1',
  '10000000-0000-4000-8000-0000000011b1', pg_temp.item(1)),
  'limit', 'a 601st item in the trip is refused');
reset role;
select pg_temp.sign_in('00000000-0000-4000-8000-0000000011c1');
select throws_ok($$ select public.save_itinerary_item('20000000-0000-4000-8000-0000000000c1',
  '10000000-0000-4000-8000-0000000011a1', pg_temp.item(1)) $$, '42501', null,
  'without consent nothing is written');
reset role;

-- ------------------------------------------------------- hotel point
select pg_temp.sign_in('00000000-0000-4000-8000-0000000011a1');
select is(public.save_hotel('30000000-0000-4000-8000-0000000011a1', '10000000-0000-4000-8000-0000000011a1',
  '{"name":"Riva","addressEn":"23 Phra Athit Rd","checkIn":"2027-01-10","checkOut":"2027-01-12","lat":13.76,"lng":100.49}'),
  'ok', 'a hotel with its point');
select is(public.save_hotel('30000000-0000-4000-8000-0000000011a1', '10000000-0000-4000-8000-0000000011a1',
  '{"name":"Riva Surya","addressEn":"23 Phra Athit Rd","checkIn":"2027-01-10","checkOut":"2027-01-12"}'),
  'ok', 'an older app edits it without a point');
select is((select lat from public.hotels where id = '30000000-0000-4000-8000-0000000011a1'), 13.76::double precision,
  'the saved point stays (Dudi 8)');
reset role;

-- ------------------------------------------------------- deletion
delete from public.trips where id = '10000000-0000-4000-8000-0000000011a1';
select is(
  (select count(*)::int from public.itinerary_items where trip_id = '10000000-0000-4000-8000-0000000011a1')
    + (select count(*)::int from public.trip_saved_places where trip_id = '10000000-0000-4000-8000-0000000011a1'),
  0, 'deleting the trip deletes its plan and saved places');
select ok(public.admin_delete_user('00000000-0000-4000-8000-0000000011b1', 'user_request'), 'B''s account is deleted');
select is((select count(*)::int from public.itinerary_items), 0,
  'deleting the account deletes its plans');

select * from finish();
rollback;
