/**
 * Sprint 10 AC-23 (D15): the panel's form rules, the same as the database's
 * CHECKs. Both run against supabase/tests/fixtures/admin_cases.json, so a rule
 * changed on one side only fails a test. Pure: no imports, so Node runs the
 * tests directly.
 */

export type EntryStatus = 'allowed' | 'restricted' | 'banned';

export interface EntryForm {
  status: EntryStatus | null;
  note: string;
  source: string;
  /** YYYY-MM-DD, or "" */
  verified: string;
  /** "", or a whole number 0–12 as typed */
  months: string;
}

export type EntryField = 'note' | 'source' | 'verified' | 'months';
export type EntryError =
  'noteMax' | 'sourceRequired' | 'sourceHttps' | 'verifiedRequired' | 'verifiedFuture' | 'months';

export const NOTE_MAX = 500;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A URL that parses and starts with https:// (the CHECK is ^https://). */
export function isHttps(value: string): boolean {
  if (!/^https:\/\//.test(value)) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

const codePoints = (s: string) => [...s].length;

/** Design 21.2: what the server would refuse, and a date in the future. */
export function entryErrors(f: EntryForm, today: string): Partial<Record<EntryField, EntryError>> {
  const e: Partial<Record<EntryField, EntryError>> = {};
  if (codePoints(f.note) > NOTE_MAX) e.note = 'noteMax';
  const source = f.source.trim();
  if (source && !isHttps(source)) e.source = 'sourceHttps';
  else if (f.status && !source) e.source = 'sourceRequired';
  if (f.verified && !DATE.test(f.verified)) e.verified = 'verifiedRequired';
  else if (f.status && !f.verified) e.verified = 'verifiedRequired';
  else if (f.verified && f.verified > today) e.verified = 'verifiedFuture';
  if (f.months.trim() !== '' && !/^(?:[0-9]|1[0-2])$/.test(f.months.trim())) e.months = 'months';
  return e;
}

/** The row to write: empty fields are null; "not checked" keeps the rest (design 21.2). */
export function entryPayload(f: EntryForm) {
  return {
    entry_status: f.status,
    entry_note: f.note.trim() || null,
    entry_source_url: f.source.trim() || null,
    entry_verified_at: f.verified || null,
    passport_validity_months: f.months.trim() === '' ? null : Number(f.months.trim()),
  };
}

export interface MctForm {
  iata: string;
  minutes: string;
  source: string;
  verified: string;
}
export type MctField = 'iata' | 'minutes' | 'source' | 'verified';
export type MctError =
  'iata' | 'minutes' | 'sourceRequired' | 'sourceHttps' | 'verifiedRequired' | 'verifiedFuture';

/** Design 22.2. */
export function mctErrors(f: MctForm, today: string): Partial<Record<MctField, MctError>> {
  const e: Partial<Record<MctField, MctError>> = {};
  if (!/^[A-Z]{3}$/.test(f.iata.trim().toUpperCase())) e.iata = 'iata';
  const m = f.minutes.trim();
  if (!/^\d+$/.test(m) || Number(m) < 15 || Number(m) > 360) e.minutes = 'minutes';
  const source = f.source.trim();
  if (!source) e.source = 'sourceRequired';
  else if (!isHttps(source)) e.source = 'sourceHttps';
  if (!f.verified || !DATE.test(f.verified)) e.verified = 'verifiedRequired';
  else if (f.verified > today) e.verified = 'verifiedFuture';
  return e;
}

export function mctPayload(f: MctForm) {
  return {
    iata: f.iata.trim().toUpperCase(),
    minutes: Number(f.minutes.trim()),
    source_url: f.source.trim(),
    verified_at: f.verified,
  };
}

/** Design 24: an address to grant a role to. */
export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export const ROLES = ['admin', 'content_editor', 'support', 'moderator'] as const;
export type Role = (typeof ROLES)[number];

/**
 * Where a form may send the browser back to: a path on this site only. No
 * other host ("//x", "/\x"), no scheme, no control characters (Dana bug 5).
 */
export function safeBackPath(value: unknown): string {
  const back = typeof value === 'string' ? value : '';
  if (back.length > 512 || !back.startsWith('/')) return '/';
  if (/[\u0000-\u001f\u007f\\]/.test(back) || back[1] === '/') return '/';
  return back;
}
