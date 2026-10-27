-- Sprint 5 (ADR-010): the provider unit budget, the cron call with the
-- secret, and the temporary coverage-gate probes.

-- 1. The monthly unit budget (AC-6א). A hard cap of 360 of the free plan's
-- 400 units: a call is spent before it is made, and refused at the cap.
create table public.provider_usage (
  month date not null,
  provider text not null check (provider in ('aerodatabox')),
  units integer not null default 0 check (units >= 0),
  primary key (month, provider)
);
alter table public.provider_usage enable row level security;
revoke all on public.provider_usage from anon, authenticated;

create function public.spend_provider_units(p_provider text, p_units integer)
  returns boolean
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  cap constant integer := 360;
  this_month date := date_trunc('month', now() at time zone 'utc')::date;
  spent integer;
begin
  if p_units is null or p_units < 1 or p_units > 10 then
    raise exception 'spend_provider_units: bad units';
  end if;
  insert into public.provider_usage as u (month, provider, units)
    values (this_month, p_provider, p_units)
    on conflict (month, provider) do update
      set units = u.units + excluded.units
      where u.units + excluded.units <= cap
    returning units into spent;
  if spent is null then
    raise log 'spend_provider_units: % reached the cap of % units this month', p_provider, cap;
    return false;
  end if;
  return true;
end;
$$;
revoke execute on function public.spend_provider_units(text, integer) from public, anon, authenticated;
grant execute on function public.spend_provider_units(text, integer) to service_role;

-- 2. Cron calls that spend units carry the Vault's cron_secret (ADR-010;
-- pre-launch checklist). Like call_daily_job, with a body and the header.
create function public.call_cron_job(p_function text, p_body jsonb)
  returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  base text := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url');
  secret text := (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret');
begin
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
revoke execute on function public.call_cron_job(text, jsonb) from public, anon, authenticated;

-- 3. The coverage gate (days 1–3). No user data: public flight numbers and
-- the provider's answer, deleted after 7 days.
create table public.flight_coverage_probes (
  id bigint generated always as identity primary key,
  flight_number text not null check (flight_number ~ '^[A-Z0-9]{2}[0-9]{1,4}[A-Z]?$'),
  airline text not null,
  dep_date_local date not null,
  sched_dep_utc timestamptz not null,
  probe_kind text not null check (probe_kind in ('early', 'late', 'after')),
  probe_at timestamptz not null,
  done_at timestamptz,
  http_ok boolean,
  snapshot jsonb,
  created_at timestamptz not null default now(),
  unique (flight_number, dep_date_local, probe_kind)
);
alter table public.flight_coverage_probes enable row level security;
revoke all on public.flight_coverage_probes from anon, authenticated;
create index flight_coverage_probes_due on public.flight_coverage_probes (probe_at) where done_at is null;

-- Calls the function only when a probe is due: most minutes cost nothing.
select cron.schedule(
  'flight-coverage-tick',
  '*/5 * * * *',
  $$select public.call_cron_job('flight-coverage', '{"action":"tick"}'::jsonb)
    where exists (select 1 from public.flight_coverage_probes where done_at is null and probe_at <= now())$$
);
select cron.schedule(
  'flight-coverage-retention',
  '0 3 * * *',
  $$delete from public.flight_coverage_probes where created_at < now() - interval '7 days'$$
);
