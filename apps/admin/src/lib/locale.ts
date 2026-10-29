import { cookies } from 'next/headers';

import { isLocale, translator, type Locale } from './messages';

/** Design 19: Hebrew by default; the switch keeps its choice in a cookie. */
export async function getLocale(): Promise<Locale> {
  const value = (await cookies()).get('admin_locale')?.value;
  return isLocale(value) ? value : 'he';
}

export async function getT() {
  const locale = await getLocale();
  return { locale, t: translator(locale), dir: locale === 'he' ? 'rtl' : 'ltr' } as const;
}
