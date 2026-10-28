-- Sprint 8 F-020, F-021 (AC-1, AC-6, AC-7): hotels and insurance belong to
-- the trip's owner and are written only through their functions; the
-- 10-hotel limit and the trip's dates hold in the server; new trip dates
-- that leave a hotel outside are refused.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(40);

insert into auth.users (id, email)
values
  ('00000000-0000-4000-8000-00000000008a', 'a8@example.test'),
  ('00000000-0000-4000-8000-00000000008b', 'b8@example.test'),
  ('00000000-0000-4000-8000-00000000008c', 'c8@example.test');

create function pg_temp.sign_in(user_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
$$;
create function pg_temp.consent() returns void language sql as $$
  insert into public.consents (doc_type, doc_version, action, platform, app_version)
  values ('terms', 0, 'granted', 'android', '0.9.0'), ('privacy', 0, 'granted', 'android', '0.9.0');
$$;
-- A hotel from day a to day b of the trip (the trip starts on 2027-01-10).
create function pg_temp.hotel(a int, b int, extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object(
    'name', 'Riva Surya', 'addressEn', '23 Phra Athit Rd, Bangkok',
    'addressLocal', '23 ถนนพระอาทิตย์ กรุงเทพฯ', 'phone', '+6626335000',
    'checkIn', date '2027-01-10' + a, 'checkOut', date '2027-01-10' + b, 'bookingRef', 'BK-12345'
  ) || extra;
$$;

select pg_temp.sign_in('00000000-0000-4000-8000-00000000008a');
select pg_temp.consent();
select public.save_trip('create', '10000000-0000-4000-8000-00000000008a', 'THA', 'תאילנד',
  date '2027-01-10', date '2027-01-24', null, '[]', '[]') is not null;
reset role;
select pg_temp.sign_in('00000000-0000-4000-8000-00000000008b');
select pg_temp.consent();
select public.save_trip('create', '10000000-0000-4000-8000-00000000008b', 'THA', 'B',
  date '2027-01-10', date '2027-01-24', null, '[]', '[]') is not null;
reset role;

-- ---------------------------------------------------------------- structure
select ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('public.hotels'::regclass, 'public.insurance'::regclass)),
  'RLS is on for hotels and insurance'
);
select table_privs_are('public', 'hotels', 'authenticated', array['SELECT'],
  'users only read hotels; writes go through the functions');
select table_privs_are('public', 'insurance', 'authenticated', array['SELECT'],
  'users only read insurance; writes go through the functions');
select table_privs_are('public', 'hotels', 'anon', array[]::text[], 'anon: no hotels');
select table_privs_are('public', 'insurance', 'anon', array[]::text[], 'anon: no insurance');
select ok(
  not has_function_privilege('anon', 'public.save_hotel(uuid,uuid,jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.save_insurance(uuid,jsonb)', 'EXECUTE'),
  'signed-out clients cannot save'
);

-- ---------------------------------------------------------------- hotels
select pg_temp.sign_in('00000000-0000-4000-8000-00000000008a');
select is(
  public.save_hotel('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-00000000008a',
    pg_temp.hotel(0, 4)),
  'ok', 'a hotel is saved'
);
select is(
  public.save_hotel('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-00000000008a',
    pg_temp.hotel(0, 5)),
  'ok', 'the same id again (an edit or a retry) saves again'
);
select is((select check_out from public.hotels), date '2027-01-15', 'the edit is kept, one row');
select is(
  public.save_hotel('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-00000000008a',
    pg_temp.hotel(-1, 3)),
  'dates', 'check-in before the trip is refused'
);
select is(
  public.save_hotel('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-00000000008a',
    pg_temp.hotel(10, 15)),
  'dates', 'check-out after the trip is refused'
);
select is(
  public.save_hotel('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-00000000008a',
    pg_temp.hotel(10, 14)),
  'ok', 'check-out on the last day is allowed'
);
select throws_ok(
  $$select public.save_hotel('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-00000000008a',
      pg_temp.hotel(3, 3))$$,
  '23514', null, 'check-in and check-out on the same day are refused'
);
select throws_ok(
  $$select public.save_hotel('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-00000000008a',
      pg_temp.hotel(1, 2, '{"phone": "026335000"}'))$$,
  '23514', null, 'a phone that is not E.164 is refused'
);
select throws_ok(
  $$select public.save_hotel('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-00000000008a',
      pg_temp.hotel(1, 2, jsonb_build_object('bookingRef', repeat('A', 41))))$$,
  '23514', null, 'a booking number over 40 characters is refused'
);
select throws_ok(
  $$select public.save_hotel('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-00000000008a',
      pg_temp.hotel(1, 2, jsonb_build_object('name', 'Riva' || chr(8238) || 'Surya')))$$,
  '23514', null, 'a name with a bidi override is refused'
);
select is(
  public.save_hotel('30000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-00000000008b',
    pg_temp.hotel(1, 2)),
  'gone', 'another user''s trip is "gone"'
);

-- The limit is 10, held in the server.
select is(
  (select array_agg(distinct r) from (
    select public.save_hotel(('30000000-0000-4000-8000-0000000001' || lpad(n::text, 2, '0'))::uuid,
      '10000000-0000-4000-8000-00000000008a', pg_temp.hotel(1, 2)) as r
    from generate_series(1, 8) n) s),
  array['ok'], 'hotels up to 10 are saved'
);
select is(
  public.save_hotel('30000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-00000000008a',
    pg_temp.hotel(1, 2)),
  'limit', 'an 11th hotel is refused'
);
select is(
  public.save_hotel('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-00000000008a',
    pg_temp.hotel(0, 6)),
  'ok', 'editing one of the 10 is still allowed'
);

-- New trip dates that leave a hotel outside (AC-1).
select throws_ok(
  $$select public.save_trip('update', '10000000-0000-4000-8000-00000000008a', 'THA', 'תאילנד',
      date '2027-01-12', date '2027-01-24', null, '[]', '[]')$$,
  '23514', 'hotels outside the trip dates', 'trip dates that leave a hotel outside are refused'
);
select is(
  public.save_trip('update', '10000000-0000-4000-8000-00000000008a', 'THA', 'תאילנד',
    date '2027-01-09', date '2027-01-26', null, '[]', '[]'),
  'ok', 'wider dates are saved'
);

select is(public.delete_hotel('30000000-0000-4000-8000-000000000001'), 'ok', 'a hotel is deleted');
select is(public.delete_hotel('30000000-0000-4000-8000-000000000001'), 'gone', 'twice: gone');
reset role;

-- Another user sees none of them.
select pg_temp.sign_in('00000000-0000-4000-8000-00000000008b');
select is((select count(*)::integer from public.hotels), 0, 'another user reads no hotels');
select is(public.delete_hotel('30000000-0000-4000-8000-000000000002'), 'gone',
  'another user cannot delete a hotel');

-- ---------------------------------------------------------------- insurance
reset role;
select pg_temp.sign_in('00000000-0000-4000-8000-00000000008a');
select is(
  public.save_insurance('10000000-0000-4000-8000-00000000008a', jsonb_build_object(
    'provider', 'הפניקס', 'policyNumber', 'P-778899', 'validUntil', '2027-01-20',
    'emergencyPhone', '+97239294000', 'notes', 'כולל ספורט אתגרי')),
  'ok', 'insurance is saved, valid until before the return date'
);
select is(
  public.save_insurance('10000000-0000-4000-8000-00000000008a', jsonb_build_object('provider', 'הראל')),
  'ok', 'saving again replaces it'
);
select is(
  (select provider || ',' || coalesce(policy_number, '-') from public.insurance),
  'הראל,-', 'one policy per trip, with the new values'
);
reset role;
select pg_temp.sign_in('00000000-0000-4000-8000-00000000008b');
select is(
  public.save_insurance('10000000-0000-4000-8000-00000000008a', '{"provider": "x"}'),
  'gone', 'another user''s trip is "gone"'
);
reset role;

-- ---------------------------------------------------------------- Dudi's review (3)
-- (a) No consent: no hotel and no insurance (the gate, as in save_flight).
select pg_temp.sign_in('00000000-0000-4000-8000-00000000008c');
select throws_ok(
  $$select public.save_hotel('30000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-00000000008a', pg_temp.hotel(1, 2))$$,
  '42501', 'consent to the current documents is required', 'without consent, no hotel'
);
select throws_ok(
  $$select public.save_insurance('10000000-0000-4000-8000-00000000008a', '{"provider": "x"}')$$,
  '42501', 'consent to the current documents is required', 'without consent, no insurance'
);
reset role;

-- (b) Another user reusing a hotel's id on their own trip: refused, the row untouched.
select pg_temp.sign_in('00000000-0000-4000-8000-00000000008b');
select throws_ok(
  $$select public.save_hotel('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-00000000008b', pg_temp.hotel(1, 2, '{"name": "Taken"}'))$$,
  '23505', 'hotel id already in use', 'a reused hotel id is refused'
);
-- (c, d) Not theirs to delete or read.
select is(public.delete_insurance('10000000-0000-4000-8000-00000000008a'), 'gone', 'another user cannot delete the insurance');
select is((select count(*)::integer from public.insurance), 0, 'another user reads no insurance');
reset role;
select is((select name from public.hotels where id = '30000000-0000-4000-8000-000000000002'), 'Riva Surya', 'the owner''s hotel is unchanged');

select pg_temp.sign_in('00000000-0000-4000-8000-00000000008a');
-- (e) A retried create with dates that leave a hotel outside is refused too.
select throws_ok(
  $$select public.save_trip('create', '10000000-0000-4000-8000-00000000008a', 'THA', 'תאילנד', date '2027-01-12', date '2027-01-26', null, '[]', '[]')$$,
  '23514', 'hotels outside the trip dates', 'a retried create cannot leave a hotel outside'
);
select is(public.delete_insurance('10000000-0000-4000-8000-00000000008a'), 'ok', 'the owner deletes the insurance');
select is(public.delete_insurance('10000000-0000-4000-8000-00000000008a'), 'gone', 'twice: gone');
reset role;

-- A trip's deletion takes its hotels and insurance (AC-6).
select pg_temp.sign_in('00000000-0000-4000-8000-00000000008a');
delete from public.trips where id = '10000000-0000-4000-8000-00000000008a';
reset role;
select is(
  (select count(*)::integer from public.hotels) + (select count(*)::integer from public.insurance),
  0, 'deleting the trip deletes its hotels and insurance'
);

select * from finish();
rollback;
