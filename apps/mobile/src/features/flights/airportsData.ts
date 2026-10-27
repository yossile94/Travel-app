/**
 * The bundled airport list (scripts/build-airports.mjs; sprint 5 AC-4, design
 * 5), loaded the first time the airport picker opens and kept for the
 * session. The card never needs it: a flight keeps its airports' time zones
 * and countries (design 20.7).
 */
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';

import { normalize } from '@/features/trips/citySearch';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const AIRPORTS = require('../../../assets/data/airports.dat') as number;

/** [iata, adm0, country, tz, cityHe, cityEn, name, rank, nameHe] */
export type AirportRow = [string, string, string, string, string, string, string, number, string];

export interface Airport {
  iata: string;
  adm0: string;
  country: string;
  tz: string;
  cityHe: string;
  cityEn: string;
  name: string;
  /** 0 large, 1 medium, 2 small. */
  rank: number;
  nameHe: string;
}

export const airportOf = ([
  iata,
  adm0,
  country,
  tz,
  cityHe,
  cityEn,
  name,
  rank,
  nameHe,
]: AirportRow): Airport => ({
  iata,
  adm0,
  country,
  tz,
  cityHe,
  cityEn,
  name,
  rank,
  nameHe,
});

/** "Suvarnabhumi Airport" → "Suvarnabhumi". */
export function shortAirportName(name: string): string {
  const short = name
    .replace(/\b(International|Intl\.?|Regional|Municipal)\b/gi, '')
    .replace(/\bAirport\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return short || name;
}

/** "בנגקוק · סוברנבומי" / "Bangkok · Suvarnabhumi" (design 5). */
export function airportTitle(a: Airport, language: string): string {
  const city = language === 'he' && a.cityHe ? a.cityHe : a.cityEn;
  const name = language === 'he' && a.nameHe ? a.nameHe : shortAirportName(a.name);
  return city && city !== name ? `${city} · ${name}` : name;
}

interface Indexed {
  airport: Airport;
  names: string[];
  words: string[];
}

export const RESULT_LIMIT = 30;
export const COUNTRY_TOP = 10;
export const ISRAEL_ORDER = ['TLV', 'ETM', 'HFA'];

/** Built once, in rank order (large airports first). */
export function indexAirports(
  airports: Airport[],
  countryNames: (iso2: string) => string[],
): Indexed[] {
  return airports.map((airport) => {
    const names = [
      ...new Set(
        [
          airport.iata,
          airport.cityHe,
          airport.cityEn,
          airport.name,
          airport.nameHe,
          ...countryNames(airport.country),
        ]
          .filter(Boolean)
          .map(normalize),
      ),
    ];
    return { airport, names, words: [...new Set(names.flatMap((n) => n.split(' ')))] };
  });
}

/** An exact 3-letter code first, then names that start with the query, then words (design 5). */
export function searchAirports(index: Indexed[], query: string, limit = RESULT_LIMIT): Airport[] {
  const q = normalize(query);
  if (!q) return [];
  const code = /^[a-z]{3}$/.test(q) ? q.toUpperCase() : null;
  const exact: Indexed[] = [];
  const first: Indexed[] = [];
  const second: Indexed[] = [];
  const terms = q.split(' ');
  for (const entry of index) {
    if (code && entry.airport.iata === code) {
      exact.push(entry);
      continue;
    }
    if (!terms.every((term) => entry.words.some((word) => word.startsWith(term)))) continue;
    (entry.names.some((name) => name.startsWith(q)) ? first : second).push(entry);
  }
  return [...exact, ...first, ...second].slice(0, limit).map((e) => e.airport);
}

/** The groups shown before typing: the trip's country (top 10) and Israel (design 5). */
export function defaultGroups(airports: Airport[], adm0: string) {
  const inCountry =
    adm0 === 'ISR' ? [] : airports.filter((a) => a.adm0 === adm0).slice(0, COUNTRY_TOP);
  const israel = ISRAEL_ORDER.map((code) => airports.find((a) => a.iata === code)).filter(
    (a): a is Airport => a !== undefined,
  );
  return { inCountry, israel };
}

let loaded: Promise<Airport[]> | null = null;

export function loadAirports(): Promise<Airport[]> {
  loaded ??= (async () => {
    const asset = await Asset.fromModule(AIRPORTS).downloadAsync();
    const text = await new File(asset.localUri ?? asset.uri).text();
    const data = JSON.parse(text) as { rows: AirportRow[] };
    return data.rows.map(airportOf);
  })().catch((error: unknown) => {
    loaded = null;
    throw error;
  });
  return loaded;
}
