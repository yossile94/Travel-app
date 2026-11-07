-- Sprint 14 F-043 (AC-3, AC-4, ADR-021): the Places fields on a hotel, the
-- 30-day rule on Google's point, and the user and project budgets for calls
-- to Google, closed to clients.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(52);

insert into auth.users (id, email)
values ('00000000-0000-4000-8000-0000000014a1', 'a14@example.test'),
       ('00000000-0000-4000-8000-00000000014b', 'b14@example.test');

create function pg_temp.sign_in(user_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
$$;
create function pg_temp.hotel(extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object(
    'name', 'Siam Hotel', 'addressEn', '3/2 Khao Rd, Bangkok', 'addressLocal', '3/2 ถนนขาว กรุงเทพฯ',
    'phone', '+6622066999', 'checkIn', '2027-01-10', 'checkOut', '2027-01-14',
    'lat', 13.78, 'lng', 100.5
  ) || extra;
$$;
create function pg_temp.place(fetched timestamptz, extra jsonb default '{}') returns jsonb language sql as $$
  select pg_temp.hotel(jsonb_build_object(
    'nameLocal', 'โรงแรมสยาม', 'placeId', 'ChIJN1t_tDeuEmsRUsoyG83frY4',
    'placeFetchedAt', fetched, 'placeEdited', '[]'::jsonb
  ) || extra);
$$;

select pg_temp.sign_in('00000000-0000-4000-8000-0000000014a1');
insert into public.consents (doc_type, doc_version, action, platform, app_version)
values ('terms', 0, 'granted', 'android', '0.15.0'), ('privacy', 0, 'granted', 'android', '0.15.0');
select public.save_trip('create', '10000000-0000-4000-8000-0000000014a1', 'THA', 'תאילנד',
  date '2027-01-10', date '2027-01-24', null, '[]', '[]') is not null;

-- ---------------------------------------------------------- Places fields
select is(
  public.save_hotel('30000000-0000-4000-8000-0000000014a1', '10000000-0000-4000-8000-0000000014a1',
    pg_temp.place(now())),
  'ok', 'a hotel picked from Google is saved'
);
select results_eq(
  $$select name_local, place_id, place_edited, lat from public.hotels
    where id = '30000000-0000-4000-8000-0000000014a1'$$,
  $$values ('โรงแรมสยาม'::text, 'ChIJN1t_tDeuEmsRUsoyG83frY4'::text, '{}'::text[], 13.78::double precision)$$,
  'the local name, the place id and the point are kept'
);
select is(
  public.save_hotel('30000000-0000-4000-8000-0000000014a1', '10000000-0000-4000-8000-0000000014a1',
    pg_temp.hotel()),
  'ok', 'an older app saves without the Places fields'
);
select results_eq(
  $$select name_local, place_id from public.hotels where id = '30000000-0000-4000-8000-0000000014a1'$$,
  $$values ('โรงแรมสยาม'::text, 'ChIJN1t_tDeuEmsRUsoyG83frY4'::text)$$,
  'and keeps the saved ones'
);
select is(
  public.save_hotel('30000000-0000-4000-8000-0000000014a1', '10000000-0000-4000-8000-0000000014a1',
    pg_temp.place(now(), '{"placeEdited": ["phone", "nameLocal", "phone"]}')),
  'ok', 'edited fields are saved'
);
select is(
  (select place_edited from public.hotels where id = '30000000-0000-4000-8000-0000000014a1'),
  array['nameLocal', 'phone'], 'once each, in order'
);
select throws_ok(
  $$select public.save_hotel('30000000-0000-4000-8000-0000000014a1', '10000000-0000-4000-8000-0000000014a1',
    pg_temp.place(now(), '{"placeEdited": ["address"]}'))$$,
  '23514', null, 'an unknown edited field is refused'
);
select throws_ok(
  $$select public.save_hotel('30000000-0000-4000-8000-0000000014a1', '10000000-0000-4000-8000-0000000014a1',
    pg_temp.place(now(), '{"placeId": "../../etc"}'))$$,
  '23514', null, 'a malformed place id is refused'
);
select throws_ok(
  $$select public.save_hotel('30000000-0000-4000-8000-0000000014a1', '10000000-0000-4000-8000-0000000014a1',
    pg_temp.place(now() + interval '1 day'))$$,
  '22023', null, 'a fetch time in the future is refused'
);
select throws_ok(
  $$select public.save_hotel('30000000-0000-4000-8000-0000000014a1', '10000000-0000-4000-8000-0000000014a1',
    pg_temp.place(now(), jsonb_build_object('nameLocal', repeat('x', 121))))$$,
  '23514', null, 'a local name over 120 characters is refused'
);

-- ------------------------------------------------- Google's 30 days (ADR-021)
select is(
  public.save_hotel('30000000-0000-4000-8000-0000000014a1', '10000000-0000-4000-8000-0000000014a1',
    pg_temp.place(now() - interval '31 days')),
  'ok', 'a save with a point fetched 31 days ago passes'
);
select is(
  (select lat from public.hotels where id = '30000000-0000-4000-8000-0000000014a1'), null,
  'but the point is not stored'
);
select is(
  public.save_hotel('30000000-0000-4000-8000-0000000014a1', '10000000-0000-4000-8000-0000000014a1',
    pg_temp.place(now() - interval '31 days', '{"placeEdited": ["point"]}')),
  'ok', 'a point the user moved'
);
select is(
  (select lat from public.hotels where id = '30000000-0000-4000-8000-0000000014a1'), 13.78::double precision,
  'is the user''s own and is kept'
);
select is(
  public.save_hotel('30000000-0000-4000-8000-0000000014a2', '10000000-0000-4000-8000-0000000014a1',
    pg_temp.place(now() - interval '29 days', '{"placeId": "ChIJsecondHotelPlaceId"}')),
  'ok', 'a second hotel with a 29-day-old point'
);
reset role;
update public.hotels set place_fetched_at = now() - interval '31 days'
where id = '30000000-0000-4000-8000-0000000014a2';
select public.places_retention();
select is(
  (select lat from public.hotels where id = '30000000-0000-4000-8000-0000000014a2'), null,
  'the daily clean-up clears a Google point past 30 days'
);
select is(
  (select lat from public.hotels where id = '30000000-0000-4000-8000-0000000014a1'), 13.78::double precision,
  'and leaves a point the user moved'
);
select is(
  (select name_local from public.hotels where id = '30000000-0000-4000-8000-0000000014a2'), 'โรงแรมสยาม',
  'the text stays: it is the user''s entry'
);

-- -------------------------------- older apps, and the rule on the saved row (Dudi 3)
update public.hotels set lat = 13.78, lng = 100.5 where id = '30000000-0000-4000-8000-0000000014a2';
select pg_temp.sign_in('00000000-0000-4000-8000-0000000014a1');
select is(
  public.save_hotel('30000000-0000-4000-8000-0000000014a2', '10000000-0000-4000-8000-0000000014a1',
    pg_temp.hotel()),
  'ok', 'an older app saves a hotel whose Google point is past 30 days'
);
select is(
  (select lat from public.hotels where id = '30000000-0000-4000-8000-0000000014a2'), null,
  'and the expired point it sent is not written back'
);
select is(
  public.save_hotel('30000000-0000-4000-8000-0000000014a3', '10000000-0000-4000-8000-0000000014a1',
    pg_temp.place(now(), '{"placeId": "ChIJthirdHotelPlaceId"}')),
  'ok', 'a third hotel with a fresh Google point'
);
select is(
  public.save_hotel('30000000-0000-4000-8000-0000000014a3', '10000000-0000-4000-8000-0000000014a1',
    pg_temp.hotel('{"lat": 13.9, "lng": 100.6}')),
  'ok', 'an older app moves its point'
);
select is(
  (select place_edited from public.hotels where id = '30000000-0000-4000-8000-0000000014a3'),
  array['point'], 'the moved point is marked as the user''s own'
);
select is(
  public.save_hotel('30000000-0000-4000-8000-0000000014a3', '10000000-0000-4000-8000-0000000014a1',
    pg_temp.hotel('{"placeId": null}')),
  'ok', 'a save that drops the place id'
);
select results_eq(
  $$select place_id, place_fetched_at from public.hotels where id = '30000000-0000-4000-8000-0000000014a3'$$,
  $$values (null::text, null::timestamptz)$$,
  'clears the place id and its time together'
);
reset role;

-- ------------------------------------------- refresh_hotel_point (Raz app 2)
update public.hotels
  set lat = null, lng = null, place_fetched_at = now() - interval '40 days',
      place_id = 'ChIJsecondHotelPlaceId', place_edited = '{}', phone = '+6622066999'
where id = '30000000-0000-4000-8000-0000000014a2';
select pg_temp.sign_in('00000000-0000-4000-8000-0000000014a1');
select is(
  public.refresh_hotel_point('30000000-0000-4000-8000-0000000014a2', 'ChIJsomeOtherPlace', 'ChIJrefreshedPlaceId', 13.8, 100.6, now()),
  'gone', 'a hotel picked again meanwhile is not touched (Dudi 2)'
);
select is(
  public.refresh_hotel_point('30000000-0000-4000-8000-0000000014a2', 'ChIJsecondHotelPlaceId', 'ChIJrefreshedPlaceId', 13.8, 100.6, now()),
  'ok', 'a point cleared after 30 days is fetched again'
);
select results_eq(
  $$select place_id, lat, phone from public.hotels where id = '30000000-0000-4000-8000-0000000014a2'$$,
  $$values ('ChIJrefreshedPlaceId'::text, 13.8::double precision, '+6622066999'::text)$$,
  'only the link and the point change'
);
select is(
  public.refresh_hotel_point('30000000-0000-4000-8000-0000000014a1', 'ChIJN1t_tDeuEmsRUsoyG83frY4', 'ChIJrefreshedPlaceId', 1, 2, now()),
  'gone', 'a point the user moved is never refreshed'
);
select is(
  public.refresh_hotel_point('30000000-0000-4000-8000-0000000014a3', null, 'ChIJrefreshedPlaceId', 1, 2, now()),
  'gone', 'a hotel with no link gets none through a refresh (Dudi 4)'
);
select throws_ok(
  $$select public.refresh_hotel_point('30000000-0000-4000-8000-0000000014a2', 'ChIJrefreshedPlaceId', 'ChIJx1234567890', 1, 2, now() - interval '31 days')$$,
  '22023', null, 'a fetch time past 30 days is refused (Dudi 3)'
);
select is(
  public.refresh_hotel_point('30000000-0000-4000-8000-0000000014a2', 'ChIJrefreshedPlaceId', null, null, null, null),
  'ok', 'a place Google no longer knows'
);
select results_eq(
  $$select place_id, lat, name_local from public.hotels where id = '30000000-0000-4000-8000-0000000014a2'$$,
  $$values (null::text, null::double precision, 'โรงแรมสยาม'::text)$$,
  'drops the link and the point, and keeps the text'
);
select throws_ok(
  $$select public.refresh_hotel_point('30000000-0000-4000-8000-0000000014a2', null, 'ChIJx1234567890', null, null, now())$$,
  '22023', null, 'a refresh without a point is refused'
);
reset role;
select pg_temp.sign_in('00000000-0000-4000-8000-00000000014b');
select is(
  public.refresh_hotel_point('30000000-0000-4000-8000-0000000014a1', 'ChIJN1t_tDeuEmsRUsoyG83frY4', 'ChIJrefreshedPlaceId', 1, 2, now()),
  'gone', 'another user can''t refresh someone''s hotel'
);
reset role;
select ok(
  not has_function_privilege('anon', 'public.refresh_hotel_point(uuid,text,text,double precision,double precision,timestamptz)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.refresh_hotel_point(uuid,text,text,double precision,double precision,timestamptz)', 'EXECUTE'),
  'only signed-in users can refresh'
);

-- ---------------------------------------------------------------- budget
select ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('public.places_calls'::regclass, 'public.places_month'::regclass)),
  'RLS is on for the Places counters'
);
select table_privs_are('public', 'places_calls', 'authenticated', array[]::text[], 'users: no counters');
select table_privs_are('public', 'places_month', 'anon', array[]::text[], 'anon: no budget');
select table_privs_are('public', 'places_calls', 'anon', array[]::text[], 'anon: no counters');
select table_privs_are('public', 'places_month', 'authenticated', array[]::text[], 'users: no budget');
select ok(
  not has_function_privilege('authenticated', 'public.take_places_call(uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.take_places_call(uuid,text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.take_places_call(uuid,text)', 'EXECUTE'),
  'only the function takes calls, with the service role'
);
select ok(
  not has_function_privilege('authenticated', 'public.places_retention()', 'EXECUTE'),
  'clients cannot run the clean-up'
);
select is(
  (select bool_and(public.take_places_call('00000000-0000-4000-8000-0000000014a1', 'pick'))
   from generate_series(1, 20)),
  true, '20 picks a day pass'
);
select is(public.take_places_call('00000000-0000-4000-8000-0000000014a1', 'pick'), false,
  'the 21st is refused');
select is(public.take_places_call('00000000-0000-4000-8000-0000000014a1', 'search'), true,
  'searches have their own count');
select is(
  (select picks from public.places_month where month = date_trunc('month', now() at time zone 'America/Los_Angeles')::date),
  20, 'a refused pick spends nothing from the month'
);
update public.places_month set searches = 9000
where month = date_trunc('month', now() at time zone 'America/Los_Angeles')::date;
select is(public.take_places_call('00000000-0000-4000-8000-0000000014a1', 'search'), false,
  'the project''s monthly cap refuses every user');
select is(
  (select searches from public.places_calls where user_id = '00000000-0000-4000-8000-0000000014a1'),
  1::smallint, 'and spends nothing from the user''s day'
);
select throws_ok(
  $$select public.take_places_call('00000000-0000-4000-8000-0000000014a1', 'other')$$,
  'P0001', 'take_places_call: bad user or kind', 'an unknown kind is refused'
);
select is((select cap from public.provider_caps where provider = 'places_pick'), 800,
  'the pick cap is a setting under Enterprise''s free 1,000');

delete from auth.users where id = '00000000-0000-4000-8000-0000000014a1';
select is(
  (select count(*) from public.places_calls where user_id = '00000000-0000-4000-8000-0000000014a1'),
  0::bigint, 'a deleted account''s counts go with it'
);

select * from finish();
rollback;
