-- Sprint 4 F-012 and F-013: exchange rates and travel advisories, refreshed
-- daily by Edge Functions (rates-daily, advisories-daily) on pg_cron.
-- Reference data, not personal data: readable by everyone, written only by
-- the service role. ADR-008.

-- ------------------------------------------------------------------ rates
-- Only the latest rate per currency is kept: no history, so the app never
-- republishes ExchangeRate-API's series (their terms; Raz, sprint 4 B-1).
create table public.exchange_rates (
  currency text primary key constraint exchange_rates_currency_check check (currency ~ '^[A-Z]{3}$'),
  rate_to_ils numeric not null constraint exchange_rates_ils_check check (rate_to_ils > 0),
  rate_to_usd numeric not null constraint exchange_rates_usd_check check (rate_to_usd > 0),
  -- boi: Bank of Israel (representative rate); erapi: ExchangeRate-API, cross rate via USD.
  source text not null constraint exchange_rates_source_check check (source in ('boi', 'erapi')),
  -- The date the source gives for the rate; fetched_at is when we read it.
  rate_date date not null,
  fetched_at timestamptz not null default now()
);

comment on table public.exchange_rates is
  'Latest rate per currency (sprint 4 F-012). Public read, service-role write; no history (ER-API terms).';

alter table public.exchange_rates enable row level security;
create policy "anyone reads the latest rates"
  on public.exchange_rates for select to anon, authenticated
  using (true);
revoke all on public.exchange_rates from anon, authenticated;
grant select on public.exchange_rates to anon, authenticated;

-- -------------------------------------------------------------- advisories
-- One row per globe area (adm0), not per ISO country: territories are
-- separate areas and show "not checked yet" rather than their sovereign's
-- data (Raz, sprint 4 B-4).
create table public.country_advisories (
  adm0 text primary key constraint country_advisories_adm0_check check (adm0 ~ '^[A-Z0-9]{3}$'),
  -- Entry with an Israeli passport: maintained by hand, with its source (not in data.gov.il).
  entry_status text constraint country_advisories_entry_check
    check (entry_status in ('allowed', 'restricted', 'banned')),
  entry_note text constraint country_advisories_entry_note_check check (char_length(entry_note) <= 500),
  entry_source_url text constraint country_advisories_entry_url_check check (entry_source_url ~ '^https://'),
  entry_verified_at date,
  -- From data.gov.il "travelwarnings" (NSC, MFA, Health), daily.
  -- nsc_level: the highest level named in the NSC text; null when the text names none.
  nsc_level smallint constraint country_advisories_level_check check (nsc_level between 1 and 4),
  -- Every level the text names, low to high: {2,4} for "4 in the south, 2 elsewhere",
  -- so the app can say the level varies by region (Sharona, design 6.3).
  nsc_levels smallint[] constraint country_advisories_levels_check
    check (nsc_levels <@ array[1, 2, 3, 4]::smallint[]),
  nsc_text text constraint country_advisories_nsc_text_check check (char_length(nsc_text) <= 4000),
  nsc_url text constraint country_advisories_nsc_url_check check (nsc_url ~ '^https://'),
  mfa_text text constraint country_advisories_mfa_text_check check (char_length(mfa_text) <= 4000),
  mfa_url text constraint country_advisories_mfa_url_check check (mfa_url ~ '^https://'),
  -- When the daily job last saw this area in the dataset; null: never (not checked yet).
  fetched_at timestamptz,
  constraint country_advisories_entry_complete check (
    entry_status is null or (entry_source_url is not null and entry_verified_at is not null)
  )
);

comment on table public.country_advisories is
  'Entry status (by hand) and NSC/MFA advisories (data.gov.il, daily) per globe area (sprint 4 F-013).';

alter table public.country_advisories enable row level security;
create policy "anyone reads advisories"
  on public.country_advisories for select to anon, authenticated
  using (true);
revoke all on public.country_advisories from anon, authenticated;
grant select on public.country_advisories to anon, authenticated;

-- Every change of an NSC level or an entry status, for a later push (spec 5.10).
create table public.country_advisory_changes (
  id bigint generated always as identity primary key,
  adm0 text not null references public.country_advisories (adm0) on delete cascade,
  field text not null constraint country_advisory_changes_field_check
    check (field in ('nsc_level', 'entry_status')),
  old_value text,
  new_value text,
  changed_at timestamptz not null default now()
);

create index country_advisory_changes_adm0 on public.country_advisory_changes (adm0, changed_at desc);

alter table public.country_advisory_changes enable row level security;
revoke all on public.country_advisory_changes from anon, authenticated;

-- A level or status change is recorded by the database, whoever writes it.
create function public.record_advisory_change()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if new.nsc_level is distinct from old.nsc_level then
    insert into public.country_advisory_changes (adm0, field, old_value, new_value)
    values (new.adm0, 'nsc_level', old.nsc_level::text, new.nsc_level::text);
  end if;
  if new.entry_status is distinct from old.entry_status then
    insert into public.country_advisory_changes (adm0, field, old_value, new_value)
    values (new.adm0, 'entry_status', old.entry_status, new.entry_status);
  end if;
  return new;
end;
$$;

revoke execute on function public.record_advisory_change() from public, anon, authenticated;

create trigger country_advisories_changes
  after update on public.country_advisories
  for each row execute function public.record_advisory_change();

-- ------------------------------------------------------------------- jobs
-- The daily jobs call the Edge Functions over HTTP. A function claims its run
-- here first, atomically: at most one run an hour per job, whoever calls and
-- however many calls arrive at once, and a failed run counts too, so a
-- missing source is not hammered (Dudi, sprint 4 D1; ADR-008).
create table public.job_runs (
  name text primary key constraint job_runs_name_check check (name in ('rates', 'advisories')),
  claimed_at timestamptz not null
);

alter table public.job_runs enable row level security;
revoke all on public.job_runs from anon, authenticated;

create function public.claim_job_run(p_name text)
  returns boolean
  language sql
  security definer
  set search_path = ''
as $$
  insert into public.job_runs as j (name, claimed_at)
  values (p_name, now())
  on conflict (name) do update set claimed_at = now()
    where j.claimed_at < now() - interval '1 hour'
  returning true;
$$;

revoke execute on function public.claim_job_run(text) from public, anon, authenticated;
grant execute on function public.claim_job_run(text) to service_role;

-- The schedule (UTC): rates 14:15 with a retry at 15:15 (the Bank of Israel
-- publishes around 13:20 UTC); advisories 14:30 and 15:30. A retry after a
-- good run is a no-op (the claim). The project URL comes from this
-- environment's Vault ("project_url"), set once per environment (ADR-008).
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create function public.call_daily_job(p_function text)
  returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  base text := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url');
begin
  if base is null then
    raise warning 'call_daily_job: no project_url in Vault';
    return;
  end if;
  perform net.http_post(
    url := base || '/functions/v1/' || p_function,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;

revoke execute on function public.call_daily_job(text) from public, anon, authenticated;

select cron.schedule('rates-daily', '15 14 * * *', $$select public.call_daily_job('rates-daily')$$);
select cron.schedule('rates-daily-retry', '15 15 * * *', $$select public.call_daily_job('rates-daily')$$);
select cron.schedule('advisories-daily', '30 14 * * *', $$select public.call_daily_job('advisories-daily')$$);
select cron.schedule('advisories-daily-retry', '30 15 * * *', $$select public.call_daily_job('advisories-daily')$$);
