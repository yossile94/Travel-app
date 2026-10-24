/**
 * Country search (sprint 1 F-002, AC-2): matches a query against the
 * precomputed forms in searchIndex.json (scripts/build-search-index.mjs).
 * Synchronous and allocation-light: about 250 areas, so no debounce is needed.
 */
import { fold } from './fold';
import rawIndex from './searchIndex.json';

export interface SearchEntry {
  adm0: string;
  nameHe: string;
  nameEn: string;
  /** Hebrew name of the sovereign, for territories: "איי קוקוס (אוסטרליה)". */
  parentHe?: string;
  sortKey: string;
  names: string[];
  aliases?: string[];
}

export interface SearchResults {
  results: SearchEntry[];
  /** More areas matched than are shown. */
  more: boolean;
}

export const MAX_RESULTS = 8;

const index = rawIndex as SearchEntry[];

/**
 * How well a query matched, best first. A country's own name beats an alias
 * at the same kind of match, so "ארה" lists ארצות הברית (alias ארה"ב, a
 * prefix) above the US Minor Outlying Islands (a word inside the name).
 */
const enum Rank {
  ExactName,
  ExactAlias,
  NamePrefix,
  AliasPrefix,
  NameWord,
  AliasWord,
  None,
}

function rankForms(
  forms: readonly string[] | undefined,
  query: string,
  base: 'name' | 'alias',
): Rank {
  if (!forms) return Rank.None;
  let best: Rank = Rank.None;
  for (const form of forms) {
    if (form === query) return base === 'name' ? Rank.ExactName : Rank.ExactAlias;
    if (form.startsWith(query))
      best = Math.min(best, base === 'name' ? Rank.NamePrefix : Rank.AliasPrefix);
    else if (form.includes(` ${query}`))
      best = Math.min(best, base === 'name' ? Rank.NameWord : Rank.AliasWord);
  }
  return best;
}

/** Areas matching `query`, best match first, then alphabetically by Hebrew name. */
export function searchCountries(query: string): SearchResults {
  const folded = fold(query);
  if (!folded) return { results: [], more: false };

  const matches: { entry: SearchEntry; rank: Rank }[] = [];
  for (const entry of index) {
    const rank = Math.min(
      rankForms(entry.names, folded, 'name'),
      rankForms(entry.aliases, folded, 'alias'),
    ) as Rank;
    if (rank !== Rank.None) matches.push({ entry, rank });
  }
  // The index is already in Hebrew alphabetical order, and Array.prototype.sort
  // is stable, so sorting by rank alone keeps that order within a rank.
  matches.sort((a, b) => a.rank - b.rank);

  return {
    results: matches.slice(0, MAX_RESULTS).map((m) => m.entry),
    more: matches.length > MAX_RESULTS,
  };
}

/** The name shown in a result row: a territory carries its sovereign in brackets. */
export function displayName(entry: Pick<SearchEntry, 'nameHe' | 'parentHe'>): string {
  return entry.parentHe ? `${entry.nameHe} (${entry.parentHe})` : entry.nameHe;
}
