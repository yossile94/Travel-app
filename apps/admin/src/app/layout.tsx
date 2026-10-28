import type { Metadata } from 'next';
import { Rubik } from 'next/font/google';
import type { ReactNode } from 'react';

import { getT } from '@/lib/locale';

import './globals.css';

const rubik = Rubik({ subsets: ['latin', 'hebrew'], display: 'swap' });

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: { default: t('product'), template: `%s · ${t('product')}` }, robots: 'noindex' };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { locale, dir } = await getT();
  return (
    <html lang={locale} dir={dir}>
      <body className={rubik.className}>{children}</body>
    </html>
  );
}
