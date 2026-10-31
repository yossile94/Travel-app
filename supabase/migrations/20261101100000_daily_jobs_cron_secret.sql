-- Sprint 13 AC-14 (Dudi, F-041 review 2): the daily jobs carry the cron
-- secret too, as call_cron_job does, so rates-daily and advisories-daily
-- answer only pg_cron (verify_jwt stays off; ADR-008, ADR-010).
create or replace function public.call_daily_job(p_function text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  base text := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url');
  secret text := (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret');
begin
  if p_function not in ('rates-daily', 'advisories-daily') then
    raise exception 'call_daily_job: % is not a daily job', p_function;
  end if;
  if base is null or secret is null then
    raise warning 'call_daily_job: project_url or cron_secret missing in Vault';
    return;
  end if;
  perform net.http_post(
    url := base || '/functions/v1/' || p_function,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;
revoke execute on function public.call_daily_job(text) from public, anon, authenticated;
