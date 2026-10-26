/**
 * Searching the bundled city list (sprint 3 AC-4, design 5.3): one
 * normalisation for the query and the names, every query word must start a
 * word of the name (Hebrew, English or ASCII), names that start with the
 * query first, then by population. Pure, so every rule is unit-tested.
 * Ranges are built from code points: no invisible characters in the source.
 */
import { isForbidden } from './tripFormRules';

/** [id, Hebrew name or "", English name, ASCII name if different, population] (scripts/build-cities.mjs). */
export type CityRow = [number, string, string, string, number];

export interface CityEntry {
  id: number;
  nameHe: string;
  nameEn: string;
  ascii: string;
  population: number;
}

const range = (from: number, to: number) =>
  `${String.fromCodePoint(from)}-${String.fromCodePoint(to)}`;
const COMBINING = new RegExp(`[${range(0x300, 0x36f)}]`, 'g');
const HEBREW_POINTS = new RegExp(`[${range(0x591, 0x5c7)}]`, 'g');
const QUOTES = new RegExp(
  `[${["'", '`', '"', 0x2019, 0x201d, 0x5f3, 0x5f4]
    .map((c) => (typeof c === 'number' ? String.fromCodePoint(c) : c))
    .join('')}]`,
  'g',
);
const DASHES_AND_SPACES = new RegExp(`[\\s\\-${String.fromCodePoint(0x2013)}]+`, 'g');

/** Letters NFD doesn't take apart (design 5.3, rule 2). */
const LETTERS: [number, string][] = [
  [0xf0, 'd'], // ð
  [0xfe, 'th'], // þ
  [0xe6, 'ae'], // æ
  [0xf8, 'o'], // ø
  [0xdf, 'ss'], // ß
  [0x142, 'l'], // ł
  [0x111, 'd'], // đ
  [0x131, 'i'], // ı
  [0x127, 'h'], // ħ
  [0x153, 'oe'], // œ
];
/** Hebrew final letters to their regular forms (ך ם ן ף ץ). */
const FINALS: [number, number][] = [
  [0x5da, 0x5db],
  [0x5dd, 0x5de],
  [0x5df, 0x5e0],
  [0x5e3, 0x5e4],
  [0x5e5, 0x5e6],
];
const LETTER_MAP = new Map<string, string>([
  ...LETTERS.map(([c, to]) => [String.fromCodePoint(c), to] as [string, string]),
  ...FINALS.map(
    ([c, to]) => [String.fromCodePoint(c), String.fromCodePoint(to)] as [string, string],
  ),
]);

/** NFD where the engine has it; Hermes builds without full ICU may not (the ASCII name still matches). */
function decompose(text: string): string {
  try {
    return text.normalize('NFD');
  } catch {
    return text;
  }
}

export function normalize(text: string): string {
  const lowered = decompose(text.toLowerCase())
    .replace(COMBINING, '')
    .replace(HEBREW_POINTS, '')
    .replace(QUOTES, '');
  return (
    [...lowered]
      // A hidden mark (an RLM in a GeoNames name, or a pasted one) never blocks a match (Raz, M1).
      .filter((ch) => !isForbidden(ch.codePointAt(0)!))
      .map((ch) => LETTER_MAP.get(ch) ?? ch)
      .join('')
      .replace(DASHES_AND_SPACES, ' ')
      .trim()
  );
}

export function entryOf([id, nameHe, nameEn, ascii, population]: CityRow): CityEntry {
  return { id, nameHe, nameEn, ascii: ascii || nameEn, population };
}

/** The name shown and saved (as the snapshot, AC-5): Hebrew when there is one, in Hebrew. */
export function displayName(city: CityEntry, language: string): string {
  return language === 'he' && city.nameHe ? city.nameHe : city.nameEn;
}

interface Indexed {
  city: CityEntry;
  /** Every normalised name, whole, for "starts with". */
  names: string[];
  /** Every word of every name. */
  words: string[];
}

/** Built once per area, when the search first opens (design 5.3: not on every keystroke). */
export function indexCities(cities: CityEntry[]): Indexed[] {
  return cities.map((city) => {
    const names = [
      ...new Set([city.nameHe, city.nameEn, city.ascii].filter(Boolean).map(normalize)),
    ];
    return { city, names, words: [...new Set(names.flatMap((name) => name.split(' ')))] };
  });
}

export const RESULTS_MAX = 30;
export const LARGEST = 20;

/** The cities matching a query, best first; the largest cities for an empty one. */
export function searchCities(index: Indexed[], query: string, limit = RESULTS_MAX): CityEntry[] {
  const q = normalize(query);
  if (!q) return index.slice(0, LARGEST).map((entry) => entry.city);
  const terms = q.split(' ');
  const first: Indexed[] = [];
  const second: Indexed[] = [];
  for (const entry of index) {
    if (!terms.every((term) => entry.words.some((word) => word.startsWith(term)))) continue;
    (entry.names.some((name) => name.startsWith(q)) ? first : second).push(entry);
  }
  // The index is already in population order (the build sorts it).
  return [...first, ...second].slice(0, limit).map((entry) => entry.city);
}

/** "Add as written" shows only when no result's name equals the query (design 5.2). */
export function hasExactMatch(results: CityEntry[], query: string): boolean {
  const q = normalize(query);
  return results.some((city) =>
    [city.nameHe, city.nameEn, city.ascii].some((name) => name && normalize(name) === q),
  );
}
