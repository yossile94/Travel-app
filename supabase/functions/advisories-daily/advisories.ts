/**
 * Turns data.gov.il "travelwarnings" (gov.il: NSC, MFA, Health) into one
 * advisory per globe area (sprint 4 F-013, ADR-008). Pure, so every rule is
 * tested. The NSC level is named in free text, in several ways:
 *   "רמת איום מזדמן (2)", "(רמה 4)", "(3/4)", "רמת סיכון 3 ו-4",
 *   "איום גבוה 4", "אין אזהרות" ...
 * The highest level named counts (a country can be 4 in one region and 2 in
 * the rest); the text and the official link are kept, so the app shows the
 * detail. No level found: null, and the app shows the text alone.
 */
import { AREA_BY_NAME } from './names.ts';

export interface WarningRecord {
  country: string | null;
  recommendations: string | null;
  details: string | null;
  משרד: string | null;
}

export interface Advisory {
  adm0: string;
  nsc_level: number | null;
  nsc_text: string | null;
  nsc_url: string | null;
  mfa_text: string | null;
  mfa_url: string | null;
}

const MAX_TEXT = 4000;

/** Levels in words, as the NSC writes them. */
const WORDS: [RegExp, number][] = [
  [/איום גבוה/, 4],
  [/איום בינוני/, 3],
  [/איום מזדמן/, 2],
  [/אין אזהר/, 1],
];

/** The highest NSC level (1-4) the text names, or null. */
export function nscLevel(text: string | null): number | null {
  if (!text) return null;
  const levels: number[] = [];
  // A digit right after "רמה/רמת ...", "איום ...", or in parentheses: "(2)", "(3/4)".
  const contexts =
    /(?:רמ[הת][^.\n\d]{0,25}|איום[^.\n\d]{0,15}|\()\s*([1-4])(?:\s*(?:\/|ו-|ו|-)\s*([1-4]))?/g;
  for (const match of text.matchAll(contexts)) {
    levels.push(Number(match[1]));
    if (match[2]) levels.push(Number(match[2]));
  }
  for (const [pattern, level] of WORDS) if (pattern.test(text)) levels.push(level);
  return levels.length ? Math.max(...levels) : null;
}

/** The official link inside the record's HTML: https on gov.il only. */
export function officialLink(details: string | null): string | null {
  const href = details?.match(/href="([^"]+)"/)?.[1];
  if (!href) return null;
  try {
    const url = new URL(href);
    return url.protocol === 'https:' && (url.hostname === 'www.gov.il' || url.hostname === 'gov.il')
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

const clean = (text: string | null) => {
  const t = text?.trim();
  return t ? t.slice(0, MAX_TEXT) : null;
};

/** One advisory per mapped area; names not in the map are returned to log. */
export function advisoriesFrom(records: WarningRecord[]): {
  advisories: Advisory[];
  unmapped: string[];
} {
  const byArea = new Map<string, Advisory>();
  const unmapped = new Set<string>();
  for (const record of records) {
    const name = record.country?.trim();
    if (!name) continue;
    const adm0 = AREA_BY_NAME[name];
    if (!adm0) {
      unmapped.add(name);
      continue;
    }
    const advisory = byArea.get(adm0) ?? {
      adm0,
      nsc_level: null,
      nsc_text: null,
      nsc_url: null,
      mfa_text: null,
      mfa_url: null,
    };
    const office = record.משרד ?? '';
    const text = clean(record.recommendations);
    const link = officialLink(record.details);
    if (office.includes('ל"ל')) {
      advisory.nsc_text = text;
      advisory.nsc_url = link;
      advisory.nsc_level = nscLevel(text);
    } else if (office.includes('חוץ') && text) {
      // The MFA can have several rows per country: kept together, in order.
      advisory.mfa_text = clean(advisory.mfa_text ? `${advisory.mfa_text}\n\n${text}` : text);
      advisory.mfa_url ??= link;
    }
    byArea.set(adm0, advisory);
  }
  return { advisories: [...byArea.values()], unmapped: [...unmapped].sort() };
}
