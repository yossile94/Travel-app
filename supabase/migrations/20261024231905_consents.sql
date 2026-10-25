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
  -- Null until the document is hosted; meanwhile the app shows the text it ships with.
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

-- Supabase grants every privilege on new public tables; keep only reading.
revoke all on public.legal_documents from anon, authenticated;
grant select on public.legal_documents to anon, authenticated;

-- The version in force for each document: the newest one already published.
create view public.current_legal_documents
  with (security_invoker = true) as
  select distinct on (doc_type) doc_type, version, url, published_at
  from public.legal_documents
  where published_at <= now()
  order by doc_type, version desc;

comment on view public.current_legal_documents is
  'The terms and privacy versions a user must have consented to.';

revoke all on public.current_legal_documents from anon, authenticated;
grant select on public.current_legal_documents to anon, authenticated;

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
-- id breaks ties: rows inserted together share created_at (transaction time).
create index consents_user_type_time on public.consents (user_id, doc_type, created_at desc, id desc);

-- A consent always names a version that exists, and that version can never
-- be removed or renumbered (see legal_documents_guard below). No index on
-- (doc_type, doc_version) on purpose: the guard refuses deleting a published
-- version before this check would ever scan consents.
alter table public.consents
  add constraint consents_document_fk
  foreign key (doc_type, doc_version)
  references public.legal_documents (doc_type, version)
  on update restrict on delete restrict;

alter table public.consents enable row level security;

create policy "users read their own consents"
  on public.consents for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "users record their own consents"
  on public.consents for insert
  to authenticated
  with check (user_id = (select auth.uid()));

-- Signed-out clients get nothing; signed-in users only read and add their own rows.
revoke all on public.consents from anon;
revoke all on public.consents from authenticated;
grant select, insert on public.consents to authenticated;
revoke all on sequence public.consents_id_seq, public.legal_documents_id_seq from anon, authenticated;
-- TRUNCATE skips row triggers and RLS: not even the admin key may empty the log.
revoke truncate on public.consents, public.legal_documents from service_role;

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

revoke execute on function public.consents_before_insert() from public, anon, authenticated;

-- A published version is evidence of what users agreed to: it can't be
-- deleted, renumbered, re-dated or pointed at another text. A version
-- scheduled for the future can still be changed until it takes effect.
create function public.legal_documents_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if old.published_at <= now() then
    if tg_op = 'DELETE'
       or new.doc_type is distinct from old.doc_type
       or new.version is distinct from old.version
       or new.published_at is distinct from old.published_at
       or (old.url is not null and new.url is distinct from old.url) then
      raise exception 'legal document % version % is published and cannot be changed',
        old.doc_type, old.version
        using errcode = '55000';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger legal_documents_guard
  before update or delete on public.legal_documents
  for each row execute function public.legal_documents_guard();

revoke execute on function public.legal_documents_guard() from public, anon, authenticated;
