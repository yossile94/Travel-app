-- Sprint 4 (Dudi, E1): the retry an hour after a run could be refused when
-- the first run's call took a little longer to arrive than the retry's (a
-- cold start), so a failed run sometimes got no retry. A claim now lasts 50
-- minutes: still one run per scheduled slot, and the retry always runs.
create or replace function public.claim_job_run(p_name text)
  returns boolean
  language sql
  security definer
  set search_path = ''
as $$
  insert into public.job_runs as j (name, claimed_at)
  values (p_name, now())
  on conflict (name) do update set claimed_at = now()
    where j.claimed_at < now() - interval '50 minutes'
  returning true;
$$;

revoke execute on function public.claim_job_run(text) from public, anon, authenticated;
grant execute on function public.claim_job_run(text) to service_role;
