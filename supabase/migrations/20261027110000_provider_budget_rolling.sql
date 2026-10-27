-- Sprint 5, Dudi's and Raz's reviews of the budget migration:
--   #3 RapidAPI resets the quota on the subscription day, not on the 1st: the
--      cap is now over any 30 days (a row per day), so two calendar months
--      can't add up to 720 units in one billing cycle.
--   #6 call_cron_job sends the secret only to the functions that need it.
--   #8 cron.job_run_details is trimmed daily (a job runs every few minutes).
--   #9 the identity sequence is closed to clients, like its table.
--   Raz #8: the cap is a setting row, so the paid plan is a config change.
--   Raz #4: a delayed flight gets one "retry" probe after its new time.

drop function public.spend_provider_units(text, integer);
drop table public.provider_usage;

create table public.provider_usage (
  day date not null,
  provider text not null check (provider in ('aerodatabox')),
  units integer not null default 0 check (units >= 0),
  primary key (provider, day)
);
alter table public.provider_usage enable row level security;
revoke all on public.provider_usage from anon, authenticated;

create table public.provider_caps (
  provider text primary key check (provider in ('aerodatabox')),
  -- Units allowed in any 30 days: 360 of the free plan's 400 (AC-6א).
  cap integer not null check (cap > 0)
);
insert into public.provider_caps (provider, cap) values ('aerodatabox', 360);
alter table public.provider_caps enable row level security;
revoke all on public.provider_caps from anon, authenticated;

-- Spends units only while the last 30 days stay within 360 of the free
-- plan's 400 (AC-6א). One transaction-scoped lock per provider makes the
-- check and the add one step for concurrent callers.
create function public.spend_provider_units(p_provider text, p_units integer)
  returns boolean
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  cap integer := (select c.cap from public.provider_caps c where c.provider = p_provider);
  today date := (now() at time zone 'utc')::date;
  used integer;
begin
  if p_units is null or p_units < 1 or p_units > 10 then
    raise exception 'spend_provider_units: bad units';
  end if;
  perform pg_advisory_xact_lock(hashtext('provider_units:' || p_provider));
  select coalesce(sum(units), 0) into used
  from public.provider_usage
  where provider = p_provider and day > today - 30;
  if cap is null or used + p_units > cap then
    raise log 'spend_provider_units: % reached the cap of % units in 30 days', p_provider, cap;
    return false;
  end if;
  insert into public.provider_usage as u (day, provider, units)
  values (today, p_provider, p_units)
  on conflict (provider, day) do update set units = u.units + excluded.units;
  return true;
end;
$$;
revoke execute on function public.spend_provider_units(text, integer) from public, anon, authenticated;
grant execute on function public.spend_provider_units(text, integer) to service_role;

create or replace function public.call_cron_job(p_function text, p_body jsonb)
  returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  base text := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url');
  secret text := (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret');
begin
  if p_function not in ('flight-coverage', 'flight-watch') then
    raise exception 'call_cron_job: % is not a cron function', p_function;
  end if;
  if base is null or secret is null then
    raise warning 'call_cron_job: project_url or cron_secret missing in Vault';
    return;
  end if;
  perform net.http_post(
    url := base || '/functions/v1/' || p_function,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := p_body,
    timeout_milliseconds := 60000
  );
end;
$$;
revoke execute on function public.call_cron_job(text, jsonb) from public, anon, authenticated, service_role;

revoke all on sequence public.flight_coverage_probes_id_seq from anon, authenticated;

select cron.schedule(
  'cron-history-retention',
  '40 3 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$
);

alter table public.flight_coverage_probes drop constraint flight_coverage_probes_probe_kind_check;
alter table public.flight_coverage_probes add constraint flight_coverage_probes_probe_kind_check
  check (probe_kind in ('early', 'late', 'after', 'retry'));
