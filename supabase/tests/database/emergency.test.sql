-- Sprint 8 F-022 (AC-13, AC-14; Dudi review 4): missions and emergency
-- numbers are public to read, written only by migrations, and the data keeps
-- its promises: a checked row cites a source, "no mission" too, and every
-- country said to be covered is covered by a mission.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

-- ---------------------------------------------------------------- structure
select ok(
  (select relrowsecurity from pg_class where oid = 'public.emergency_numbers'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.missions'::regclass),
  'RLS is on for emergency numbers and missions'
);
select table_privs_are('public', 'emergency_numbers', 'anon', array['SELECT'],
  'signed-out clients only read emergency numbers (AC-17)');
select table_privs_are('public', 'emergency_numbers', 'authenticated', array['SELECT'],
  'signed-in clients only read emergency numbers');
select table_privs_are('public', 'missions', 'anon', array['SELECT'],
  'signed-out clients only read missions');
select table_privs_are('public', 'missions', 'authenticated', array['SELECT'],
  'signed-in clients only read missions');

-- ---------------------------------------------------------------- the data
select is(
  (select count(*)::int from public.emergency_numbers e
   where e.mission_status = 'covered'
     and not exists (select 1 from public.missions m where e.adm0 = any (m.covers))),
  0, 'every country marked covered is in some mission''s covers'
);
select is(
  (select count(*)::int from public.emergency_numbers where mission_status = 'none' and source_url is null),
  0, 'every "no mission" cites its source'
);
select is(
  (select count(*)::int from public.missions where covers[1] <> adm0),
  0, 'each mission lists its host first'
);
select ok(
  (select police = '191' and numbers_status = 'verified' from public.emergency_numbers where adm0 = 'THA'),
  'Thailand: checked numbers'
);
select is(
  (select numbers_status from public.emergency_numbers where adm0 = 'MAR'),
  'pending', 'Morocco, with conflicting sources, stays pending'
);

-- ---------------------------------------------------------------- the rules hold
select throws_ok(
  $$insert into public.emergency_numbers (adm0, police, numbers_status) values ('ZZZ', '112', 'verified')$$,
  '23514', null, 'a checked row without a source is refused'
);
select throws_ok(
  $$insert into public.missions (id, adm0, kind, name_he, name_en, covers, source_url, verified_at)
    values (99999, 'THA', 'embassy', 'x', 'x', array['KHM'], 'https://example.org', current_date)$$,
  '23514', null, 'a mission whose covers don''t start with its host is refused'
);

select * from finish();
rollback;
