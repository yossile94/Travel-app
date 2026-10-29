/**
 * Sprint 10 AC-16, AC-17 (design 20.4): who may see which page, decided on
 * the server for every request. The database enforces it again (RLS with
 * has_role and AAL2); this only keeps people on pages they can use.
 */
import { redirect } from 'next/navigation';

import { serverClient } from './supabase/server';
import type { Role } from './validate';

export interface Access {
  email: string;
  userId: string;
  roles: Role[];
}

/** The signed-in person with MFA and a role with screens, or a redirect. */
export async function requireAccess(
  need: 'content_editor' | 'admin' = 'content_editor',
): Promise<Access> {
  const supabase = await serverClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) redirect('/login');
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== 'aal2')
    redirect(aal?.nextLevel === 'aal2' ? '/mfa/verify' : '/mfa/enroll');
  const { data: roles } = await supabase.rpc('my_roles');
  const list = (roles ?? []) as Role[];
  const screens = list.includes('admin') || list.includes('content_editor');
  if (!screens) redirect('/no-access');
  if (need === 'admin' && !list.includes('admin')) redirect('/forbidden');
  return { email: user.email ?? '', userId: user.id, roles: list };
}
