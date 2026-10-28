import { LocaleSwitch } from '@/components/LocaleSwitch';
import { getT } from '@/lib/locale';

import { GoogleSignIn } from './GoogleSignIn';

export const metadata = { title: 'Login' };

/** Design 20.1: team only; Google, then two-step verification. */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; expired?: string }>;
}) {
  const { t, locale } = await getT();
  const { error, expired } = await searchParams;
  const message = expired
    ? t('login.expired')
    : error === 'cancelled'
      ? t('login.cancelled')
      : error
        ? t('login.error')
        : null;
  return (
    <div className="center">
      <div className="card" data-testid="admin-login">
        <h1>{t('product')}</h1>
        <p className="sub">{t('login.sub')}</p>
        <GoogleSignIn label={t('login.google')} />
        {message ? (
          <p className="alert" role="alert" data-testid="admin-login-error">
            {message}
          </p>
        ) : null}
      </div>
      <LocaleSwitch locale={locale} back="/login" />
    </div>
  );
}
