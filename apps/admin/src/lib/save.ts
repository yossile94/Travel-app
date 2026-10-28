'use server';

import { revalidatePath } from 'next/cache';

import { requireAccess } from './access';
import { serverClient } from './supabase/server';
import {
  entryErrors,
  entryPayload,
  isEmail,
  mctErrors,
  mctPayload,
  ROLES,
  type EntryForm,
  type MctForm,
  type Role,
} from './validate';

/** What a save says back (design 25.4). Field errors use the same rules as the form. */
export type SaveResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | 'denied'
        | 'rejected'
        | 'failed'
        | 'exists'
        | 'noUser'
        | 'has'
        | 'lastAdmin'
        | 'self'
        | 'email';
    }
  | { ok: false; fields: Record<string, string> };

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jerusalem' });

/** Postgres codes: 42501 no permission (RLS), 23514 a CHECK, 23505 a duplicate. */
function fromCode(code: string | undefined): SaveResult {
  if (code === '42501') return { ok: false, error: 'denied' };
  if (code === '23514') return { ok: false, error: 'rejected' };
  if (code === '23505') return { ok: false, error: 'exists' };
  return { ok: false, error: 'failed' };
}

/** AC-19: entry and passport validity; RLS lets only editors write, and only these columns. */
export async function saveEntryAction(adm0: string, form: EntryForm): Promise<SaveResult> {
  await requireAccess();
  if (!/^[A-Z0-9]{3}$/.test(adm0)) return { ok: false, error: 'rejected' };
  const fields = entryErrors(form, today());
  if (Object.keys(fields).length) return { ok: false, fields };
  const supabase = await serverClient();
  const { data, error } = await supabase
    .from('country_advisories')
    .update(entryPayload(form))
    .eq('adm0', adm0)
    .select('adm0');
  if (error) return fromCode(error.code);
  // RLS hides the row from an update it doesn't allow: no row back means no permission.
  if (!data?.length) return { ok: false, error: 'denied' };
  revalidatePath('/countries');
  return { ok: true };
}

/** AC-22: a new airport, or a changed one. */
export async function saveMctAction(form: MctForm, isNew: boolean): Promise<SaveResult> {
  await requireAccess();
  const fields = mctErrors(form, today());
  if (Object.keys(fields).length) return { ok: false, fields };
  const supabase = await serverClient();
  const row = mctPayload(form);
  if (isNew) {
    const { error } = await supabase.from('min_connection_times').insert(row);
    if (error) return fromCode(error.code);
  } else {
    const { data, error } = await supabase
      .from('min_connection_times')
      .update({ minutes: row.minutes, source_url: row.source_url, verified_at: row.verified_at })
      .eq('iata', row.iata)
      .select('iata');
    if (error) return fromCode(error.code);
    if (!data?.length) return { ok: false, error: 'denied' };
  }
  revalidatePath('/mct');
  return { ok: true };
}

/** AC-17 (D12): by email, admins only; the database refuses the rest. */
export async function grantRoleAction(email: string, role: Role): Promise<SaveResult> {
  const access = await requireAccess('admin');
  if (!isEmail(email)) return { ok: false, error: 'email' };
  if (!(ROLES as readonly string[]).includes(role)) return { ok: false, error: 'rejected' };
  if (email.trim().toLowerCase() === access.email.toLowerCase())
    return { ok: false, error: 'self' };
  const supabase = await serverClient();
  const { data: before } = await supabase.rpc('admin_role_list');
  const has = (before as { email: string; role: string }[] | null)?.some(
    (r) => r.email.toLowerCase() === email.trim().toLowerCase() && r.role === role,
  );
  if (has) return { ok: false, error: 'has' };
  const { error } = await supabase.rpc('admin_grant_role', { p_email: email, p_role: role });
  if (error?.code === 'P0002') return { ok: false, error: 'noUser' };
  if (error) return fromCode(error.code);
  revalidatePath('/roles');
  return { ok: true };
}

export async function revokeRoleAction(userId: string, role: Role): Promise<SaveResult> {
  const access = await requireAccess('admin');
  if (userId === access.userId) return { ok: false, error: 'self' };
  const supabase = await serverClient();
  const { error } = await supabase.rpc('admin_revoke_role', { p_user: userId, p_role: role });
  if (error?.code === '23514') return { ok: false, error: 'lastAdmin' };
  if (error) return fromCode(error.code);
  revalidatePath('/roles');
  return { ok: true };
}
