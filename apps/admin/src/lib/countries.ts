/**
 * Design 21.1: country names from the app's own bundled table (no new table),
 * searched and paged here: about 250 rows.
 */
import meta from '../../../mobile/src/features/globe/countryMeta.json';

import type { Locale } from './messages';

interface Meta {
  nameHe: string;
  nameEn: string;
  parent?: string;
}
const table = meta as unknown as Record<string, Meta>;

export const countryName = (adm0: string, locale: Locale) =>
  (locale === 'he' ? table[adm0]?.nameHe : table[adm0]?.nameEn) ?? adm0;

export const sovereignOf = (adm0: string) => table[adm0]?.parent ?? null;

export const PAGE_SIZE = 50;

export interface Row {
  adm0: string;
  entry_status: 'allowed' | 'restricted' | 'banned' | null;
  entry_verified_at: string | null;
  passport_validity_months: number | null;
  nsc_level: number | null;
}

export type StatusFilter = 'all' | 'allowed' | 'restricted' | 'banned' | 'none';

/** Search by Hebrew or English name or code; sorted by the name in the interface language. */
export function filterRows(
  rows: readonly Row[],
  q: string,
  status: StatusFilter,
  locale: Locale,
): Row[] {
  const needle = q.trim().toLocaleLowerCase();
  const collator = new Intl.Collator(locale);
  return rows
    .filter((r) =>
      status === 'all' ? true : status === 'none' ? !r.entry_status : r.entry_status === status,
    )
    .filter(
      (r) =>
        !needle ||
        r.adm0.toLowerCase().includes(needle) ||
        countryName(r.adm0, 'he').includes(q.trim()) ||
        countryName(r.adm0, 'en').toLocaleLowerCase().includes(needle),
    )
    .sort((a, b) => collator.compare(countryName(a.adm0, locale), countryName(b.adm0, locale)));
}

/** "28.10.2026" (design 21.1). */
export const numDate = (d: string | null) =>
  d ? d.slice(0, 10).split('-').reverse().map(Number).join('.') : '—';
