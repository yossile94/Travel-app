import { redirect } from 'next/navigation';

import { SignOutButton } from '@/components/SignOutButton';
import { getT } from '@/lib/locale';
import type { MessageKey } from '@/lib/messages';
import { serverClient } from '@/lib/supabase/server';

export const metadata = { title: 'No access' };

/** Design 20.4: signed in with MFA, but no role with screens. No shell: nowhere to go. */
export default async function NoAccessPage() {
  const supabase = await serverClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/login');
  const { data: roles } = await supabase.rpc('my_roles');
  const list = (roles ?? []) as string[];
  if (list.includes('admin') || list.includes('content_editor')) redirect('/');
  const { t } = await getT();
  const role = list[0];
  return (
    <div className="center">
      <div className="card" data-testid="admin-no-access">
        {role ? (
          <>
            <h1>{t('noAccess.noScreensTitle')}</h1>
            <p>{t('noAccess.noScreensBody', { role: t(`role.${role}` as MessageKey) })}</p>
          </>
        ) : (
          <>
            <h1>{t('noAccess.title')}</h1>
            <p>{t('noAccess.body', { email: data.user.email ?? '' })}</p>
          </>
        )}
        <SignOutButton label={t('signOut')} />
      </div>
    </div>
  );
}
