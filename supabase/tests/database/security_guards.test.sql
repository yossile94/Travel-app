-- Sprint 13 AC-13 (docs/security/rls-audit.md): guards over the whole public
-- schema, so a new table or function can't slip past the rules by mistake.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

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

-- Callable when signed in: each one checks who calls (auth.uid) or the role.
select is(
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and has_function_privilege('authenticated', p.oid, 'execute')
     and pg_get_functiondef(p.oid) !~ 'auth\.uid\(\)|has_role\('),
  null,
  'every SECURITY DEFINER function a user can call checks the caller'
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

select * from finish();
rollback;
