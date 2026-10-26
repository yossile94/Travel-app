import type { CountryInfo } from '@/features/globe/countryData';

/** The country's name in the app's language (sprint 2 design 3.2, QA D-7). */
export function countryName(
  country: Pick<CountryInfo, 'nameHe' | 'nameEn'>,
  language: string,
): string {
  return language === 'he' ? country.nameHe : country.nameEn;
}
