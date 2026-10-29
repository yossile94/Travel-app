import { notFound, redirect } from 'next/navigation';

import { SignOutButton } from '@/components/SignOutButton';
import { getT } from '@/lib/locale';
import { serverClient } from '@/lib/supabase/server';

import { MfaForm } from '../MfaForm';

export const metadata = { title: 'MFA' };

/** Design 20.2 (/mfa/enroll) and 20.3 (/mfa/verify). No other page loads before this. */
export default async function MfaPage({ params }: { params: Promise<{ mode: string }> }) {
  const { mode } = await params;
  if (mode !== 'enroll' && mode !== 'verify') notFound();
  const supabase = await serverClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/login');
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel === 'aal2') redirect('/');
  const { t } = await getT();
  return (
    <div className="center">
      <div className="card">
        <MfaForm
          mode={mode}
          text={{
            title: t('mfa.title'),
            sub: mode === 'enroll' ? t('mfa.enrollSub') : t('mfa.verifySub'),
            step1: t('mfa.step1'),
            step2: t('mfa.step2'),
            qrAlt: t('mfa.qrAlt'),
            manual: t('mfa.manual'),
            copy: t('mfa.copy'),
            copied: t('mfa.copied'),
            step3: t('mfa.step3'),
            code: t('mfa.code'),
            submit: mode === 'enroll' ? t('mfa.submitEnroll') : t('mfa.submit'),
            wrong: t('mfa.wrong'),
            length: t('mfa.length'),
            lost: t('mfa.lost'),
            error: t('login.error'),
          }}
        />
        <SignOutButton label={t('signOut')} />
      </div>
    </div>
  );
}
