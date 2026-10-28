/**
 * The words of discovery search (sprint 9 design 8.4, 9, 16): the rules in
 * discover.ts know nothing of language; everything a person reads or hears
 * is built here, from its result. Pure, so every wording is unit-tested.
 */
import type { TFunction } from 'i18next';

import { formatTemp, tempA11y } from '@/features/climate/tempFormat';

import type { DiscoverFilters, DiscoverResult, Weather } from './discover';

const LRI = String.fromCodePoint(0x2066);
const FSI = String.fromCodePoint(0x2068);
const PDI = String.fromCodePoint(0x2069);

/** testIDs and string keys of the weather types (design 16.1, 17). */
export const WEATHER_TYPES: readonly Weather[] = ['hot', 'mild', 'cool', 'winter'];
export const weatherTestId = (w: Weather) => (w === 'mild' ? 'pleasant' : w);

/** "כ-4 שעות", "כשעה וחצי" (design 16.4): always "about", to the half hour. */
export function formatFlightHours(h: number, t: TFunction): string {
  if (h <= 0.5) return t('discover.hours.half');
  if (h === 1) return t('discover.hours.one');
  if (h === 1.5) return t('discover.hours.oneHalf');
  if (h === 2) return t('discover.hours.two');
  if (h === 2.5) return t('discover.hours.twoHalf');
  const whole = Math.floor(h);
  return h === whole
    ? t('discover.hours.many', { h: whole })
    : t('discover.hours.manyHalf', { h: whole });
}

/** A city's name in the interface language; an English name keeps its own direction. */
export function cityName(city: { nameHe: string; nameEn: string }, language: string): string {
  return language === 'he' && city.nameHe ? city.nameHe : `${FSI}${city.nameEn}${PDI}`;
}

export type ReasonKind = 'level' | 'entry' | 'temp' | 'rain' | 'coast';

export interface ReasonText {
  kind: ReasonKind;
  text: string;
  /** The words a screen reader says: the temperature in words, never the shown string. */
  a11y: string;
}

/** The reasons of a match, always in the same order (design 8.4). */
export function reasonTexts(
  r: Pick<DiscoverResult, 'reasons'>,
  f: Pick<DiscoverFilters, 'month'>,
  t: TFunction,
  language: string,
): ReasonText[] {
  const out: ReasonText[] = [];
  const add = (kind: ReasonKind, text: string, a11y = text) => out.push({ kind, text, a11y });
  const { reasons } = r;
  if (reasons.nsc !== undefined) add('level', t('discover.reason.level', { n: reasons.nsc }));
  if (reasons.entry === 'allowed') add('entry', t('discover.reason.entryAllowed'));
  if (reasons.entry === 'check') add('entry', t('discover.reason.entryCheck'));
  if (reasons.entry === 'restricted') add('entry', t('discover.reason.entryRestricted'));
  if (reasons.temp !== undefined) {
    const month = t(`months.${f.month + 1}`);
    const hundredths = reasons.temp * 100;
    const city = reasons.tempCity ? cityName(reasons.tempCity, language) : null;
    const words = (value: string) =>
      city
        ? t('discover.reason.tempCity', { city, t: value, month })
        : t('discover.reason.temp', { t: value, month });
    add('temp', words(formatTemp(hundredths, t)), words(tempA11y(hundredths, t)));
  }
  if (reasons.rain !== undefined) add('rain', rainText(reasons.rain, t));
  if (reasons.coast) add('coast', t('discover.reason.coast'));
  return out;
}

function rainText(days: number, t: TFunction): string {
  if (days === 0) return t('discover.reason.rainNone');
  if (days === 1) return t('discover.reason.rainOne');
  return t('discover.reason.rainMany', { n: days });
}

/** "ערים: מיאמי, הונולולו" (design 8.5); null when the country's own point matched. */
export function citiesLine(
  cities: DiscoverResult['cities'],
  t: TFunction,
  language: string,
  extra = 0,
): string | null {
  if (!cities.length) return null;
  const list = cities.map((c) => cityName(c, language)).join(', ');
  return t('discover.cities', {
    list: extra > 0 ? t('discover.citiesMore', { list, n: extra }) : list,
  });
}

/** The panel's title and the announcement (design 12.2). */
export function countText(n: number, t: TFunction): string {
  if (n === 0) return t('discover.countNone');
  return n === 1 ? t('discover.countOne') : t('discover.countMany', { n });
}

export const countriesText = (n: number, t: TFunction) =>
  n === 1 ? t('discover.nCountriesOne') : t('discover.nCountriesMany', { n });

/** Why a country doesn't match (design 9.3, 16.6): the first failing rule, in one line. */
export function failureText(
  r: DiscoverResult,
  f: Pick<DiscoverFilters, 'month'>,
  t: TFunction,
): string | null {
  const month = t(`months.${f.month + 1}`);
  const temp = r.reasons.temp !== undefined ? formatTemp(r.reasons.temp * 100, t) : '';
  switch (r.failure) {
    case undefined:
      return null;
    case 'barred':
      return t('discover.not.barred');
    case 'far':
      return t('discover.not.far', { hours: formatFlightHours(r.reasons.hours, t) });
    case 'noAdvisory':
      return t('discover.not.noAdvisory');
    case 'nscHigh':
      return t('discover.not.nscHigh', { n: r.reasons.nsc });
    case 'entryRestricted':
      return t('discover.not.entryRestricted');
    case 'noClimate':
      return t('discover.not.noClimate');
    case 'tooCold':
      return t('discover.not.tooCold', { t: temp, month });
    case 'tooHot':
      return t('discover.not.tooHot', { t: temp, month });
    case 'rainy':
      return t('discover.not.rainy', { n: r.reasons.rain ?? '', month });
    case 'noCoast':
      return t('discover.not.noCoast');
  }
}

/** The newest fetchedAt of the advisories copy (Raz): what "as of" says offline. */
export function advisoriesAsOf(
  advisories: Iterable<{ fetchedAt: string | null }> | null | undefined,
): string | null {
  let newest: string | null = null;
  for (const a of advisories ?? []) {
    if (a.fetchedAt && (!newest || Date.parse(a.fetchedAt) > Date.parse(newest)))
      newest = a.fetchedAt;
  }
  return newest;
}

/** "12.10.2026", isolated left to right (the app's numeric date). */
export function numericDate(iso: string): string {
  const d = new Date(iso);
  return `${LRI}${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}${PDI}`;
}
