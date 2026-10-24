-- Sprint 1 F-003a: the published legal documents and the consent log
-- (spec 4.2 and 8; docs/sprints/sprint-01.md AC-16 to AC-18).

-- ---------------------------------------------------------------------------
-- legal_documents: every published version of the terms and the privacy
-- policy. Readable by everyone (the consent screen links them before sign-in
-- completes); written only by the service role (admin), never by the app.
-- ---------------------------------------------------------------------------
create table public.legal_documents (
  id bigint generated always as identity primary key,
  doc_type text not null check (doc_type in ('terms', 'privacy')),
  version integer not null check (version >= 0),
  -- Shown in the app until the documents are hosted; null once a URL is set.
  url text check (url is null or url ~ '^https://'),
  published_at timestamptz not null default now(),
  unique (doc_type, version)
);

comment on table public.legal_documents is
  'Published versions of the terms of use and privacy policy. A newer version makes every user consent again (AC-18).';

alter table public.legal_documents enable row level security;

create policy "legal documents are public"
  on public.legal_documents for select
  to anon, authenticated
  using (true);

revoke insert, update, delete, truncate on public.legal_documents from anon, authenticated;

-- The version in force for each document: the newest one already published.
create view public.current_legal_documents
  with (security_invoker = true) as
  select distinct on (doc_type) doc_type, version, url, published_at
  from public.legal_documents
  where published_at <= now()
  order by doc_type, version desc;

comment on view public.current_legal_documents is
  'The terms and privacy versions a user must have consented to.';

-- ---------------------------------------------------------------------------
-- consents: an append-only log. Each row is one decision by one user. The
-- server, not the app, decides who and when, and refuses a terms or privacy
-- version that is not the current one, so the log can stand as evidence.
-- ---------------------------------------------------------------------------
create table public.consents (
  id bigint generated always as identity primary key,
  -- No foreign key to auth.users on purpose: the log outlives a deleted
  -- account, for as long as legal counsel decides (spec 8).
  user_id uuid not null default auth.uid(),
  doc_type text not null check (doc_type in ('terms', 'privacy', 'marketing', 'analytics')),
  -- The document version for terms and privacy; nothing for the optional choices.
  doc_version integer,
  action text not null check (action in ('granted', 'withdrawn')),
  platform text not null check (platform in ('android', 'ios')),
  app_version text not null check (char_length(app_version) between 1 and 32),
  created_at timestamptz not null default now(),
  constraint consents_version_matches_type
    check ((doc_type in ('terms', 'privacy')) = (doc_version is not null))
);

comment on table public.consents is
  'Append-only consent log (spec 4.2). Never updated or deleted by users; kept after account deletion.';

-- "My latest decision on each document": the consent screen and re-consent check.
create index consents_user_type_time on public.consents (user_id, doc_type, created_at desc);

alter table public.consents enable row level security;

create policy "users read their own consents"
  on public.consents for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "users record their own consents"
  on public.consents for insert
  to authenticated
  with check (user_id = (select auth.uid()));

revoke update, delete, truncate on public.consents from anon, authenticated;

-- Sets the user and the time on the server and checks the version. Runs
-- before the row-level policy, so a client cannot backdate a row or record
-- one for someone else.
create function public.consents_before_insert()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  current_version integer;
begin
  new.user_id := auth.uid();
  new.created_at := now();

  if new.doc_type in ('terms', 'privacy') then
    select c.version into current_version
    from public.current_legal_documents c
    where c.doc_type = new.doc_type;

    if current_version is null or new.doc_version is distinct from current_version then
      raise exception 'consent to % version % is not the current version (%)',
        new.doc_type, new.doc_version, coalesce(current_version::text, 'none published')
        using errcode = '22023';
    end if;
  end if;

  return new;
end;
$$;

create trigger consents_before_insert
  before insert on public.consents
  for each row execute function public.consents_before_insert();
