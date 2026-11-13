-- Sprint 15 PR-A (F-048, F-049, F-050; ADR-023): the tables of the cost
-- guards and of the provider dashboard. The rules that read them come in the
-- next PRs (B–G); this one only lays the tables, moves the two budget
-- functions to the catalog, and removes the coverage gate.
--   usage_limits         every per-user cap, by tier (G3). One tier for now,
--                        'interim', on Pro's values. Changed by migration only.
--   tracked_flight_adds  each time a flight got a new watch (G2, AC-5).
--   flights.untracked_reason  why a flight was saved without tracking (AC-6).
--   account_suspensions  a suspended account spends no provider (AC-13).
--   provider_catalog     plan, quota, hard cap and prices per provider and
--                        metric (D-8). Replaces provider_caps (AC-9).
--   usage_daily          calls per day, provider, metric, feature and
--                        platform; no user id (D-1, AC-14).
--   cost_alerts          one row per alert and billing period (D-3, AC-16).
--   manual_usage         the numbers Yossi types from an invoice (AC-15).
-- The dashboard tables are read only by an admin with MFA (AC-17); writes
-- come through the admin RPCs of PR-G, logged by admin_audit.

-- ------------------------------------------------------- the audit trigger
-- A table keyed by more than one column logs them joined by '/', in the
-- order given (provider_catalog: 'aerodatabox/units').
create or replace function public.admin_audit()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  old_row jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  new_row jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  changed jsonb;
  key text;
begin
  -- The daily jobs (no person) aren't logged; a role is, whoever removes it (Dudi 6).
  if actor is null and tg_table_name <> 'admin_roles' then
    return null;
  end if;
  select coalesce(jsonb_object_agg(k, jsonb_build_object('old', old_row -> k, 'new', new_row -> k)), '{}')
    into changed
    from jsonb_object_keys(coalesce(new_row, old_row)) as k
    where (old_row -> k) is distinct from (new_row -> k);
  if changed = '{}' then
    return null;
  end if;
  select string_agg(coalesce(new_row, old_row) ->> a.col, '/' order by a.n)
    into key
    from unnest(tg_argv) with ordinality as a (col, n);
  insert into public.admin_audit_log (actor_id, actor_email, action, entity, entity_id, diff)
  values (
    actor,
    (select auth.jwt() ->> 'email'),
    lower(tg_op),
    tg_table_name,
    key,
    changed
  );
  return null;
end;
$$;
revoke execute on function public.admin_audit() from public, anon, authenticated;

-- ------------------------------------------------------------ usage_limits
create table public.usage_limits (
  tier text not null constraint usage_limits_tier_check check (tier in ('interim')),
  limit_key text not null constraint usage_limits_key_check check (limit_key in (
    'flights_per_trip', 'flights_per_trip_total', 'future_flights',
    'tracked_adds_year', 'tracked_adds_30d', 'lookups_30d', 'lookups_day',
    'places_picks_month', 'places_searches_month', 'places_refreshes_month',
    'places_picks_day', 'places_searches_day', 'places_refreshes_day')),
  value integer not null constraint usage_limits_value_check check (value >= 0),
  primary key (tier, limit_key)
);
comment on table public.usage_limits is
  'Per-user caps by tier (sprint 15, G3). The server reads its caps only here. Changed by migration only.';

insert into public.usage_limits (tier, limit_key, value) values
  -- Tracked flights per trip; with the manual ones, 20 (sprint 5).
  ('interim', 'flights_per_trip', 12),
  ('interim', 'flights_per_trip_total', 20),
  ('interim', 'future_flights', 30),
  ('interim', 'tracked_adds_year', 72),
  ('interim', 'tracked_adds_30d', 24),
  ('interim', 'lookups_30d', 150),
  ('interim', 'lookups_day', 10),
  ('interim', 'places_picks_month', 15),
  ('interim', 'places_searches_month', 300),
  ('interim', 'places_refreshes_month', 30),
  -- The daily caps of sprint 14 stay (AC-10), now as rows.
  ('interim', 'places_picks_day', 20),
  ('interim', 'places_searches_day', 100),
  ('interim', 'places_refreshes_day', 20);

alter table public.usage_limits enable row level security;
revoke all on public.usage_limits from anon, authenticated;
create policy "admins read the usage limits"
  on public.usage_limits for select to authenticated
  using ((select public.has_role('admin')));
grant select on public.usage_limits to authenticated;

-- ----------------------------------------------------- tracked_flight_adds
-- No foreign key to flight_watch: a watch row goes 7 days after landing,
-- and the add must still count for a year (AC-5).
create table public.tracked_flight_adds (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  watch_id bigint not null,
  added_at timestamptz not null default now()
);
comment on table public.tracked_flight_adds is
  'Each new watch a user''s flight got (sprint 15 AC-5): the turnover cap. Server only; kept 400 days.';
-- The cap counts the user's last 365 days; the clean-up drops rows past 400.
create index tracked_flight_adds_user on public.tracked_flight_adds (user_id, added_at desc);
create index tracked_flight_adds_added on public.tracked_flight_adds (added_at);

alter table public.tracked_flight_adds enable row level security;
revoke all on public.tracked_flight_adds from anon, authenticated;
revoke all on sequence public.tracked_flight_adds_id_seq from anon, authenticated;

-- ------------------------------------------------------ untracked_reason
-- A flight past a cap is saved without a watch, with the reason (AC-6).
-- Added not valid, then validated. In one migration this saves no lock time;
-- it is the pattern for a later migration on a large table (Dudi 6).
alter table public.flights
  add column untracked_reason text,
  add constraint flights_untracked_reason_check
    check (untracked_reason in ('concurrent', 'turnover', 'suspended')) not valid,
  add constraint flights_untracked_reason_watch_check
    check (untracked_reason is null or watch_id is null) not valid;
alter table public.flights validate constraint flights_untracked_reason_check;
alter table public.flights validate constraint flights_untracked_reason_watch_check;

-- ----------------------------------------------------- account_suspensions
create table public.account_suspensions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  reason text not null constraint account_suspensions_reason_check
    check (char_length(reason) between 1 and 200 and reason = btrim(reason)),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
comment on table public.account_suspensions is
  'Suspended accounts spend no provider (sprint 15 AC-13). Written by the admin RPCs; logged.';
create index account_suspensions_created_by on public.account_suspensions (created_by)
  where created_by is not null;

alter table public.account_suspensions enable row level security;
revoke all on public.account_suspensions from anon, authenticated;
create policy "admins read the suspensions"
  on public.account_suspensions for select to authenticated
  using ((select public.has_role('admin')));
grant select on public.account_suspensions to authenticated;

create trigger account_suspensions_audit
  after insert or update or delete on public.account_suspensions
  for each row execute function public.admin_audit('user_id');

-- -------------------------------------------------------- provider_catalog
create table public.provider_catalog (
  provider text not null constraint provider_catalog_provider_check
    check (provider in ('aerodatabox', 'google_places', 'mapbox', 'supabase')),
  metric text not null constraint provider_catalog_metric_check
    check (metric ~ '^[a-z][a-z0-9_]{1,30}$'),
  plan text not null constraint provider_catalog_plan_check
    check (char_length(plan) between 1 and 40 and plan = btrim(plan)),
  -- What the plan includes in a billing cycle, and what the server lets us
  -- spend of it. A hard cap of 0 stops the metric.
  monthly_quota integer not null constraint provider_catalog_quota_check check (monthly_quota > 0),
  hard_cap integer not null constraint provider_catalog_cap_check
    check (hard_cap >= 0 and hard_cap <= monthly_quota),
  -- AeroDataBox: RapidAPI renews monthly on the subscription day; the cap
  -- holds over any 31 days, which no monthly cycle is longer than, so one
  -- cycle never spends more than one cap. Google: the calendar month in
  -- Pacific time. Mapbox: the calendar month in UTC. Supabase: monthly from
  -- the organisation's billing day (billing_anchor).
  billing_cycle text not null constraint provider_catalog_cycle_check
    check (billing_cycle in ('rolling_31d', 'month_pacific', 'month_utc', 'month_anchor')),
  billing_anchor date,
  fixed_price numeric(12, 6) not null default 0 constraint provider_catalog_fixed_price_check
    check (fixed_price >= 0),
  unit_price numeric(12, 6) not null default 0 constraint provider_catalog_unit_price_check
    check (unit_price >= 0),
  alert_thresholds smallint[] not null default '{70,85,95}'
    constraint provider_catalog_thresholds_check
    check (cardinality(alert_thresholds) = 3 and array_ndims(alert_thresholds) = 1
           and array_lower(alert_thresholds, 1) = 1 and array_position(alert_thresholds, null) is null
           and alert_thresholds[1] >= 1 and alert_thresholds[1] < alert_thresholds[2]
           and alert_thresholds[2] < alert_thresholds[3] and alert_thresholds[3] <= 100),
  -- Flight tracking only (AC-1): the 6-hour window, or the full schedule.
  schedule_mode text constraint provider_catalog_schedule_check
    check (schedule_mode in ('window_6h', 'full')),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  primary key (provider, metric),
  constraint provider_catalog_schedule_row_check
    check ((schedule_mode is not null) = (provider = 'aerodatabox' and metric = 'units'))
);
comment on table public.provider_catalog is
  'Plans, quotas, hard caps and prices per provider and metric (sprint 15 D-8). Replaces provider_caps. Admin with MFA only; logged.';
create index provider_catalog_updated_by on public.provider_catalog (updated_by)
  where updated_by is not null;

-- The rows of provider_caps, as they were (ADR-010, ADR-021), and the rows
-- the sprint adds: the lookup budget (AC-7; on the free plan it shares the
-- whole cap, Yossi 13.11), the English pick (AC-12), and Mapbox and Supabase,
-- entered by hand (AC-15). Prices are the list price after the free quota,
-- in dollars. Mapbox and Supabase aren't enforced by us: their hard cap is
-- the quota, for the card's percentage.
insert into public.provider_catalog
  (provider, metric, plan, monthly_quota, hard_cap, billing_cycle, unit_price, schedule_mode)
values
  ('aerodatabox', 'units', 'Basic (free)', 400, 360, 'rolling_31d', 0, 'window_6h'),
  ('aerodatabox', 'lookup', 'Basic (free)', 400, 360, 'rolling_31d', 0, null),
  ('google_places', 'places_search', 'Autocomplete, free tier', 10000, 9000, 'month_pacific', 0.00283, null),
  ('google_places', 'places_pick', 'Place Details Enterprise, free tier', 1000, 800, 'month_pacific', 0.02, null),
  ('google_places', 'places_pick_en', 'Place Details Pro, free tier', 5000, 800, 'month_pacific', 0.017, null),
  ('google_places', 'places_refresh', 'Place Details Essentials, free tier', 10000, 8000, 'month_pacific', 0.005, null),
  ('mapbox', 'mau', 'Free', 25000, 25000, 'month_utc', 0, null),
  ('supabase', 'db_size_mb', 'Free', 500, 500, 'month_anchor', 0, null),
  ('supabase', 'edge_invocations', 'Free', 500000, 500000, 'month_anchor', 0, null);

alter table public.provider_catalog enable row level security;
revoke all on public.provider_catalog from anon, authenticated;
create policy "admins read the provider catalog"
  on public.provider_catalog for select to authenticated
  using ((select public.has_role('admin')));
grant select on public.provider_catalog to authenticated;

-- The edit RPC finds a stale row by updated_at (design 8.7), so every
-- change moves it, a migration's too (sprint 10's touch_updated_at).
create trigger provider_catalog_touch
  before update on public.provider_catalog
  for each row execute function public.touch_updated_at();

create trigger provider_catalog_audit
  after insert or update or delete on public.provider_catalog
  for each row execute function public.admin_audit('provider', 'metric');

-- ------------------------------------------------------------- usage_daily
create table public.usage_daily (
  provider text not null,
  metric text not null,
  day date not null,
  feature text not null constraint usage_daily_feature_check check (feature in (
    'watch', 'lookup', 'places_search', 'places_pick', 'places_pick_en', 'places_refresh')),
  platform text not null constraint usage_daily_platform_check
    check (platform in ('ios', 'android', 'server', 'unknown')),
  calls integer not null default 0 constraint usage_daily_calls_check check (calls >= 0),
  -- What the provider bills: AeroDataBox units, one per Places call.
  amount integer not null default 0 constraint usage_daily_amount_check check (amount >= 0),
  last_call_at timestamptz not null default now(),
  primary key (provider, metric, day, feature, platform),
  foreign key (provider, metric) references public.provider_catalog (provider, metric)
    on update cascade on delete restrict
);
comment on table public.usage_daily is
  'Provider calls per day, metric, feature and platform (sprint 15 D-1). No user id. Admin with MFA only.';

alter table public.usage_daily enable row level security;
revoke all on public.usage_daily from anon, authenticated;
create policy "admins read the daily usage"
  on public.usage_daily for select to authenticated
  using ((select public.has_role('admin')));
grant select on public.usage_daily to authenticated;

-- ------------------------------------------------------------- cost_alerts
create table public.cost_alerts (
  id bigint generated always as identity primary key,
  provider text not null,
  metric text not null,
  kind text not null constraint cost_alerts_kind_check
    check (kind in ('threshold', 'forecast', 'flood')),
  threshold smallint constraint cost_alerts_threshold_check check (threshold between 1 and 100),
  feature text constraint cost_alerts_feature_check check (feature in (
    'watch', 'lookup', 'places_search', 'places_pick', 'places_pick_en', 'places_refresh')),
  -- The first day of the billing cycle (or, for a flood, the day).
  period date not null,
  -- A flood's numbers only: {day, count, ratio}.
  detail jsonb constraint cost_alerts_detail_check
    check (jsonb_typeof(detail) = 'object' and pg_column_size(detail) <= 200),
  created_at timestamptz not null default now(),
  foreign key (provider, metric) references public.provider_catalog (provider, metric)
    on update cascade on delete restrict,
  constraint cost_alerts_shape_check check (
    (kind = 'threshold') = (threshold is not null)
    and (kind = 'flood') = (feature is not null)
    and (kind = 'flood') = (detail is not null))
);
comment on table public.cost_alerts is
  'One row per alert, threshold and billing period (sprint 15 D-3, AC-16). Admin with MFA only.';
-- Once per threshold and period, however often the daily job runs
-- (insert ... on conflict on constraint cost_alerts_once do nothing).
alter table public.cost_alerts add constraint cost_alerts_once
  unique nulls not distinct (provider, metric, kind, threshold, feature, period);
create index cost_alerts_created on public.cost_alerts (created_at desc);

alter table public.cost_alerts enable row level security;
revoke all on public.cost_alerts from anon, authenticated;
revoke all on sequence public.cost_alerts_id_seq from anon, authenticated;
create policy "admins read the cost alerts"
  on public.cost_alerts for select to authenticated
  using ((select public.has_role('admin')));
grant select on public.cost_alerts to authenticated;

-- ------------------------------------------------------------ manual_usage
create table public.manual_usage (
  provider text not null,
  metric text not null,
  as_of date not null,
  amount numeric(14, 2) not null constraint manual_usage_amount_check check (amount >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  primary key (provider, metric, as_of),
  foreign key (provider, metric) references public.provider_catalog (provider, metric)
    on update cascade on delete cascade
);
comment on table public.manual_usage is
  'Usage typed from an invoice, for providers we can''t meter (sprint 15 AC-15). Admin with MFA only; logged.';
create index manual_usage_updated_by on public.manual_usage (updated_by) where updated_by is not null;

alter table public.manual_usage enable row level security;
revoke all on public.manual_usage from anon, authenticated;
create policy "admins read the manual usage"
  on public.manual_usage for select to authenticated
  using ((select public.has_role('admin')));
grant select on public.manual_usage to authenticated;

create trigger manual_usage_touch
  before update on public.manual_usage
  for each row execute function public.touch_updated_at();
create trigger manual_usage_audit
  after insert or update or delete on public.manual_usage
  for each row execute function public.admin_audit('provider', 'metric', 'as_of');

-- ------------------------------------------- the budgets read the catalog
-- Same rules as sprint 5 and 14; the source of the cap moves (AC-9), and the
-- AeroDataBox window is 31 days, so a 31-day billing month can't hold two
-- full caps (Raz 3).
create or replace function public.spend_provider_units(p_provider text, p_units integer)
  returns boolean
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  cap integer := (select c.hard_cap from public.provider_catalog c
                  where c.provider = p_provider and c.metric = 'units');
  today date := (now() at time zone 'utc')::date;
  used integer;
begin
  if p_units is null or p_units < 1 or p_units > 10 then
    raise exception 'spend_provider_units: bad units';
  end if;
  perform pg_advisory_xact_lock(hashtext('provider_units:' || p_provider));
  select coalesce(sum(units), 0) into used
  from public.provider_usage
  where provider = p_provider and day > today - 31;
  if cap is null or used + p_units > cap then
    raise log 'spend_provider_units: % reached the cap of % units in 31 days', p_provider, cap;
    return false;
  end if;
  insert into public.provider_usage as u (day, provider, units)
  values (today, p_provider, p_units)
  on conflict (provider, day) do update set units = u.units + excluded.units;
  return true;
end;
$$;

create or replace function public.take_places_call(p_user uuid, p_kind text)
  returns boolean
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  today date := (now() at time zone 'utc')::date;
  -- Google bills by calendar month in Pacific time (Dudi 2).
  this_month date := date_trunc('month', now() at time zone 'America/Los_Angeles')::date;
  -- The user's daily caps are rows now (100 searches, 20 picks, 20 refreshes).
  per_user integer := (select l.value from public.usage_limits l
                       where l.tier = 'interim'
                         and l.limit_key = case p_kind when 'search' then 'places_searches_day'
                                                       when 'pick' then 'places_picks_day'
                                                       when 'refresh' then 'places_refreshes_day' end);
  cap integer := (select c.hard_cap from public.provider_catalog c
                  where c.provider = 'google_places' and c.metric = 'places_' || p_kind);
  used integer;
begin
  if p_user is null or per_user is null then
    raise exception 'take_places_call: bad user or kind';
  end if;
  perform pg_advisory_xact_lock(hashtext('places_month:' || p_kind));
  select case p_kind when 'search' then m.searches when 'pick' then m.picks else m.refreshes end
    into used
  from public.places_month m where m.month = this_month;
  if cap is null or coalesce(used, 0) >= cap then
    return false;
  end if;

  insert into public.places_calls (user_id, day) values (p_user, today)
  on conflict (user_id, day) do nothing;
  update public.places_calls c
    set searches = c.searches + (p_kind = 'search')::integer,
        picks = c.picks + (p_kind = 'pick')::integer,
        refreshes = c.refreshes + (p_kind = 'refresh')::integer
  where c.user_id = p_user and c.day = today
    and case p_kind when 'search' then c.searches when 'pick' then c.picks else c.refreshes end
        < per_user;
  if not found then
    return false;
  end if;

  insert into public.places_month as m (month, searches, picks, refreshes)
  values (this_month, (p_kind = 'search')::integer, (p_kind = 'pick')::integer,
          (p_kind = 'refresh')::integer)
  on conflict (month) do update
    set searches = m.searches + excluded.searches,
        picks = m.picks + excluded.picks,
        refreshes = m.refreshes + excluded.refreshes;
  -- Once, by the call that fills the month, not by every refusal after it (Dudi 6).
  if coalesce(used, 0) + 1 = cap then
    raise log 'take_places_call: % reached the monthly cap of %', p_kind, cap;
  end if;
  return true;
end;
$$;

drop table public.provider_caps;

-- -------------------------------------------- the coverage gate goes (G15)
select cron.unschedule(j.jobid) from cron.job j
where j.jobname in ('flight-coverage-tick', 'flight-coverage-retention');
drop table public.flight_coverage_probes;

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
  if p_function not in ('flight-watch') then
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

-- -------------------------------------------------------------- retention
-- The 30-day caps need 31 days of counts (Raz 5): flight_lookups and
-- places_calls were kept 2 days. Their keys start with the user, so the
-- daily delete gets an index on the day (Dudi 2).
create index flight_lookups_day on public.flight_lookups (day);
create index places_calls_day on public.places_calls (day);
create or replace function public.flight_data_retention()
  returns void
  language sql
  security definer
  set search_path = ''
as $$
  delete from public.flight_watch
  where coalesce(landed_at, sched_arr_utc, sched_dep_utc + interval '24 hours',
                 (dep_date_local + 2)::timestamptz) < now() - interval '7 days';
  delete from public.flight_lookups where day < current_date - 31;
  delete from public.push_receipts where created_at < now() - interval '24 hours';
  delete from public.push_tokens where last_seen_at < now() - interval '90 days';
  delete from public.tracked_flight_adds where added_at < now() - interval '400 days';
$$;

create or replace function public.places_retention()
  returns void
  language sql
  security definer
  set search_path = ''
as $$
  update public.hotels
    set lat = null, lng = null
  where place_id is not null
    and place_fetched_at < now() - interval '30 days'
    and lat is not null
    and not ('point' = any (place_edited));
  delete from public.places_calls where day < (now() at time zone 'utc')::date - 31;
  delete from public.places_month where month < (now() at time zone 'utc')::date - interval '13 months';
$$;

-- The dashboard keeps 13 months: a year back, and the same month last year.
create function public.cost_data_retention()
  returns void
  language sql
  security definer
  set search_path = ''
as $$
  delete from public.usage_daily where day < (now() at time zone 'utc')::date - interval '400 days';
  delete from public.cost_alerts where created_at < now() - interval '400 days';
  delete from public.manual_usage where as_of < (now() at time zone 'utc')::date - interval '400 days';
$$;
revoke execute on function public.cost_data_retention() from public, anon, authenticated;

select cron.schedule('cost-data-retention', '50 3 * * *', $$select public.cost_data_retention()$$);
