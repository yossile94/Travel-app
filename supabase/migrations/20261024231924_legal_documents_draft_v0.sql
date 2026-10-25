-- Sprint 1 decision 8 (Yossi, 2026-10-23): the consent screen is built and
-- tested against version 0, a draft that legal counsel has not reviewed. The
-- reviewed text is published as version 1 before the beta; the re-consent
-- check (AC-18) then asks every user again.
insert into public.legal_documents (doc_type, version, url)
values
  ('terms', 0, null),
  ('privacy', 0, null);
