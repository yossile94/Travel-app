-- Sprint 13 AC-13 (docs/security/rls-audit.md): guards over the whole public
-- schema, so a new table, view or function can't slip past the rules by mistake.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

select is(
  (select array_agg(c.relname::text order by c.relname)
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity),
  null,
  'every public table has RLS enabled'
);

select is(
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and not coalesce(p.proconfig @> array['search_path=""'], false)),
  null,
  'every SECURITY DEFINER function pins an empty search_path'
);

select is(
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and has_function_privilege('anon', p.oid, 'execute')),
  null,
  'no SECURITY DEFINER function is callable without signing in'
);

-- Dudi 1: the reviewed list. A new SECURITY DEFINER function a user can call
-- fails here until someone reviews its ownership checks and adds it.
select is(
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef
     and has_function_privilege('authenticated', p.oid, 'execute')),
  array[
    'admin_grant_role', 'admin_revoke_role', 'admin_role_list', 'apply_auto_plan',
    'delete_flight', 'delete_hotel', 'delete_insurance', 'delete_itinerary_item',
    'flights_for_trips', 'has_role', 'move_itinerary_item', 'my_roles',
    'register_push_token', 'save_flight', 'save_hotel', 'save_insurance',
    'save_itinerary_item', 'save_place', 'set_same_booking', 'unregister_push_token',
    'unsave_place'
  ]::text[],
  'the SECURITY DEFINER functions a user can call are exactly the reviewed ones'
);

-- And each of them reads who calls, outside comments (Dudi 1, 6).
select is(
  (select array_agg(f.proname order by f.proname)
   from (
     select p.proname::text as proname,
            regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') as body
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef
       and has_function_privilege('authenticated', p.oid, 'execute')
   ) f
   where f.body !~ '(^|[^a-z_.])(auth\.uid\(\)|(public\.)?has_role\()'),
  null,
  'every SECURITY DEFINER function a user can call reads the caller'
);

-- Tables without a policy are server-only: no grant lets a user reach them.
select is(
  (select array_agg(c.relname::text order by c.relname)
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p')
     and not exists (select 1 from pg_policies p
                     where p.schemaname = 'public' and p.tablename = c.relname)
     and (has_table_privilege('anon', c.oid, 'select,insert,update,delete')
          or has_table_privilege('authenticated', c.oid, 'select,insert,update,delete'))),
  null,
  'a table with no policy grants nothing to anon or authenticated'
);

-- Dudi 7: TRUNCATE skips RLS; no user role may truncate any table.
select is(
  (select array_agg(c.relname::text order by c.relname)
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p')
     and (has_table_privilege('anon', c.oid, 'truncate')
          or has_table_privilege('authenticated', c.oid, 'truncate'))),
  null,
  'no table can be truncated by anon or authenticated'
);

-- Dudi 5: a view reads as its owner unless it is security_invoker, and a
-- materialized view has no RLS at all.
select is(
  (select array_agg(c.relname::text order by c.relname)
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('v', 'm')
     and (has_table_privilege('anon', c.oid, 'select')
          or has_table_privilege('authenticated', c.oid, 'select'))
     and not (c.relkind = 'v' and 'security_invoker=true' = any(coalesce(c.reloptions, '{}')))),
  null,
  'every view users can read runs with their rights; no readable materialized view'
);

-- Dudi 2: the daily jobs go only to the two daily functions, with the secret.
select throws_ok(
  $$select public.call_daily_job('flight-watch')$$,
  'call_daily_job: flight-watch is not a daily job',
  'call_daily_job calls only the daily functions'
);

select * from finish();
rollback;
