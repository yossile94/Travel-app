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
  nsc_text text,
  nsc_url text constraint country_advisories_nsc_url_check check (nsc_url ~ '^https://'),
  mfa_text text,
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

-- The daily jobs call the Edge Functions over HTTP (the schedule itself is
-- per environment, with its own URL: ADR-008).
create extension if not exists pg_net with schema extensions;
