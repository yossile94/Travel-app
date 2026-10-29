import { headers } from 'next/headers';
import type { ReactNode } from 'react';

import { LocaleSwitch } from '@/components/LocaleSwitch';
import { Offline } from '@/components/Offline';
import { SignOutButton } from '@/components/SignOutButton';
import { requireAccess } from '@/lib/access';
import { isDevProject } from '@/lib/env';
import { getT } from '@/lib/locale';
import type { MessageKey } from '@/lib/messages';

import { SideNav } from './SideNav';

/** Design 19.1: the shell. Every page under it is checked on the server first. */
export default async function PanelLayout({ children }: { children: ReactNode }) {
  const access = await requireAccess();
  const { t, locale } = await getT();
  const path = (await headers()).get('x-pathname') ?? '/countries';
  const admin = access.roles.includes('admin');
  return (
    <div data-testid="admin-shell">
      <a href="#content" className="skip">
        {t('skip')}
      </a>
      <header className="top">
        <span className="product">{t('product')}</span>
        {isDevProject() ? (
          <span className="badge badge-dev" data-testid="admin-env-badge">
            {t('env.dev')}
          </span>
        ) : null}
        <span className="grow" />
        <span className="ltr">{access.email}</span>
        {access.roles.map((r) => (
          <span key={r} className="tag">
            {t(`role.${r}` as MessageKey)}
          </span>
        ))}
        <LocaleSwitch locale={locale} back={path} />
        <SignOutButton label={t('signOut')} />
      </header>
      <Offline text={t('offline')} />
      <div className="frame">
        <SideNav
          label={t('nav.label')}
          items={[
            { href: '/countries', label: t('nav.entry'), id: 'entry' },
            { href: '/mct', label: t('nav.mct'), id: 'mct' },
            { href: '/places', label: t('nav.places'), id: 'places' },
            ...(admin
              ? [
                  { href: '/audit', label: t('nav.audit'), id: 'audit', divider: true },
                  { href: '/roles', label: t('nav.roles'), id: 'roles' },
                ]
              : []),
          ]}
        />
        <main id="content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
