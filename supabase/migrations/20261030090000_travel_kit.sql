-- Sprint 8 F-020 and F-021: a trip's hotels and its travel insurance.
--   Both are the user's own data, owner-only, written only through
--   save_hotel / delete_hotel / save_insurance / delete_insurance (consent
--   gate, the 10-hotels limit and the trip's dates in one transaction).
--   booking_ref and policy_number are never logged (AC-6); the policy file
--   stays on the device (AC-9) and has no column here.

create table public.hotels (
  -- Made on the device: a retried save writes the same row.
  id uuid primary key,
  trip_id uuid not null,
  user_id uuid not null default auth.uid(),
  name text not null constraint hotels_name_check
    check (char_length(name) between 1 and 80 and public.text_is_clean(name)),
  address_en text not null constraint hotels_address_en_check
    check (char_length(address_en) between 1 and 200 and public.text_is_clean(address_en)),
  -- Pasted from the booking: any script (AC-1).
  address_local text constraint hotels_address_local_check
    check (char_length(address_local) between 1 and 200 and public.text_is_clean(address_local)),
  -- E.164 (AC-1): the app normalises what was typed.
  phone text constraint hotels_phone_check check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  check_in date not null,
  check_out date not null,
  booking_ref text constraint hotels_booking_ref_check
    check (char_length(booking_ref) between 1 and 40 and public.text_is_clean(booking_ref)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Same day is not a stay (AC-1).
  constraint hotels_dates_check check (check_out > check_in),
  foreign key (trip_id, user_id) references public.trips (id, user_id) on delete cascade
);

comment on table public.hotels is
  'A trip''s hotels (sprint 8 F-020). Owner-only; written through save_hotel and delete_hotel.';

create index hotels_trip on public.hotels (trip_id, check_in);
create index hotels_user on public.hotels (user_id);

alter table public.hotels enable row level security;
create policy "users read their own hotels"
  on public.hotels for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.hotels from anon, authenticated;
grant select on public.hotels to authenticated;

create table public.insurance (
  -- One policy per trip (AC-7).
  trip_id uuid primary key,
  user_id uuid not null default auth.uid(),
  provider text not null constraint insurance_provider_check
    check (char_length(provider) between 1 and 80 and public.text_is_clean(provider)),
  policy_number text constraint insurance_policy_number_check
    check (char_length(policy_number) between 1 and 40 and public.text_is_clean(policy_number)),
  -- Earlier than the return date is allowed, with a warning in the app (AC-7).
  valid_until date,
  emergency_phone text constraint insurance_emergency_phone_check
    check (emergency_phone ~ '^\+[1-9][0-9]{7,14}$'),
  notes text constraint insurance_notes_check
    check (char_length(notes) between 1 and 300 and public.text_is_clean(notes)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (trip_id, user_id) references public.trips (id, user_id) on delete cascade
);

comment on table public.insurance is
  'A trip''s travel insurance (sprint 8 F-021). Owner-only; written through save_insurance and delete_insurance.';

create index insurance_user on public.insurance (user_id);

alter table public.insurance enable row level security;
create policy "users read their own insurance"
  on public.insurance for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.insurance from anon, authenticated;
grant select on public.insurance to authenticated;

-- 'ok', 'gone' (no such trip of yours), 'limit' (10 hotels), 'dates' (outside the trip).
create function public.save_hotel(p_id uuid, p_trip_id uuid, p_hotel jsonb)
  returns text
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  h jsonb := coalesce(p_hotel, '{}');
  v_in date;
  v_out date;
  v_trip record;
begin
  if uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if not public.has_current_consent() then
    raise exception 'consent to the current documents is required'
      using errcode = '42501', hint = 'consent_required';
  end if;
  if jsonb_typeof(h) <> 'object' then
    raise exception 'hotel must be an object' using errcode = '22023';
  end if;
  begin
    v_in := (h ->> 'checkIn')::date;
    v_out := (h ->> 'checkOut')::date;
  exception when others then
    raise exception 'bad date' using errcode = '22023';
  end;

  select start_date, end_date into v_trip
  from public.trips where id = p_trip_id and user_id = uid for update;
  if not found then
    return 'gone';
  end if;
  if v_in is null or v_out is null or v_in < v_trip.start_date or v_out > v_trip.end_date then
    return 'dates';
  end if;
  if (select count(*) from public.hotels where trip_id = p_trip_id and id <> p_id) >= 10 then
    return 'limit';
  end if;

  insert into public.hotels as t
    (id, trip_id, user_id, name, address_en, address_local, phone, check_in, check_out, booking_ref)
  values (
    p_id, p_trip_id, uid, h ->> 'name', h ->> 'addressEn', nullif(h ->> 'addressLocal', ''),
    nullif(h ->> 'phone', ''), v_in, v_out, nullif(h ->> 'bookingRef', '')
  )
  on conflict (id) do update
    set name = excluded.name, address_en = excluded.address_en,
        address_local = excluded.address_local, phone = excluded.phone,
        check_in = excluded.check_in, check_out = excluded.check_out,
        booking_ref = excluded.booking_ref, updated_at = now()
    -- A reused id never moves another user's or another trip's hotel.
    where t.user_id = uid and t.trip_id = p_trip_id;
  if not found then
    raise exception 'hotel id already in use' using errcode = '23505';
  end if;
  return 'ok';
end;
$$;
revoke execute on function public.save_hotel(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_hotel(uuid, uuid, jsonb) to authenticated;

create function public.delete_hotel(p_id uuid)
  returns text
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  delete from public.hotels where id = p_id and user_id = auth.uid();
  return case when found then 'ok' else 'gone' end;
end;
$$;
revoke execute on function public.delete_hotel(uuid) from public, anon;
grant execute on function public.delete_hotel(uuid) to authenticated;

-- 'ok' or 'gone'.
create function public.save_insurance(p_trip_id uuid, p_insurance jsonb)
  returns text
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  i jsonb := coalesce(p_insurance, '{}');
  v_until date;
begin
  if uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if not public.has_current_consent() then
    raise exception 'consent to the current documents is required'
      using errcode = '42501', hint = 'consent_required';
  end if;
  if jsonb_typeof(i) <> 'object' then
    raise exception 'insurance must be an object' using errcode = '22023';
  end if;
  begin
    v_until := nullif(i ->> 'validUntil', '')::date;
  exception when others then
    raise exception 'bad date' using errcode = '22023';
  end;

  perform 1 from public.trips where id = p_trip_id and user_id = uid for update;
  if not found then
    return 'gone';
  end if;

  insert into public.insurance as t
    (trip_id, user_id, provider, policy_number, valid_until, emergency_phone, notes)
  values (
    p_trip_id, uid, i ->> 'provider', nullif(i ->> 'policyNumber', ''), v_until,
    nullif(i ->> 'emergencyPhone', ''), nullif(i ->> 'notes', '')
  )
  on conflict (trip_id) do update
    set provider = excluded.provider, policy_number = excluded.policy_number,
        valid_until = excluded.valid_until, emergency_phone = excluded.emergency_phone,
        notes = excluded.notes, updated_at = now();
  return 'ok';
end;
$$;
revoke execute on function public.save_insurance(uuid, jsonb) from public, anon;
grant execute on function public.save_insurance(uuid, jsonb) to authenticated;

create function public.delete_insurance(p_trip_id uuid)
  returns text
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  delete from public.insurance where trip_id = p_trip_id and user_id = auth.uid();
  return case when found then 'ok' else 'gone' end;
end;
$$;
revoke execute on function public.delete_insurance(uuid) from public, anon;
grant execute on function public.delete_insurance(uuid) to authenticated;

-- AC-1: new trip dates that leave a hotel outside are refused, with the
-- hotels' ids in the detail so the app can list them. save_trip surfaces it.
create function public.trips_keep_hotels_inside()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  outside text;
begin
  select string_agg(id::text, ',' order by check_in) into outside
  from public.hotels
  where trip_id = new.id and (check_in < new.start_date or check_out > new.end_date);
  if outside is not null then
    raise exception 'hotels outside the trip dates'
      using errcode = '23514', hint = 'hotels_outside', detail = outside;
  end if;
  return new;
end;
$$;
revoke execute on function public.trips_keep_hotels_inside() from public, anon, authenticated;

create trigger trips_keep_hotels_inside
  before update of start_date, end_date on public.trips
  for each row
  when (new.start_date is distinct from old.start_date or new.end_date is distinct from old.end_date)
  execute function public.trips_keep_hotels_inside();
