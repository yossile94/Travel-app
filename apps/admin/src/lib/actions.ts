'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { isLocale } from './messages';
import { serverClient } from './supabase/server';

/** Design 19.1: sign out on this browser, back to /login. */
export async function signOutAction() {
  const supabase = await serverClient();
  await supabase.auth.signOut({ scope: 'local' });
  redirect('/login');
}

/** Design 19: the language switch; the page reloads in the other direction. */
export async function setLocaleAction(formData: FormData) {
  const locale = formData.get('locale');
  const back = String(formData.get('back') ?? '/');
  if (isLocale(locale)) {
    (await cookies()).set('admin_locale', locale, {
      path: '/',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  redirect(back.startsWith('/') && !back.startsWith('//') ? back : '/');
}
