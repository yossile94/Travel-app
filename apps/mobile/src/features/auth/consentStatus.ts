/**
 * Whether a signed-in user must see the consent screen (sprint 1 AC-16,
 * AC-18, AC-18a). Pure, so every case is unit-tested.
 */

export type LegalDocType = 'terms' | 'privacy';

export interface LegalDocument {
  docType: LegalDocType;
  version: number;
  /** Hosted copy; null while the text ships with the app (draft version 0). */
  url: string | null;
  publishedAt: string;
}

/** The document versions a user has agreed to, as last known on this device or the server. */
export type AgreedVersions = Record<LegalDocType, number>;

export type ConsentNeed =
  | { kind: 'none' }
  /** Never agreed (or nothing on this device and the server can't be asked): the full screen. */
  | { kind: 'first' }
  /** Agreed before, but a newer version has been published since. */
  | { kind: 'updated'; docs: LegalDocType[] };

/**
 * @param agreed What the user has agreed to; null when nothing is known.
 * @param current The versions in force; null when they couldn't be fetched (offline).
 */
export function consentNeed(
  agreed: AgreedVersions | null,
  current: LegalDocument[] | null,
): ConsentNeed {
  // AC-18a: no record at all blocks even offline; the exit is signing out.
  if (!agreed) return { kind: 'first' };
  // Offline: nothing newer can be known, so the user carries on (AC-19).
  if (!current) return { kind: 'none' };
  const docs = current
    .filter((doc) => agreed[doc.docType] < doc.version)
    .map((doc) => doc.docType)
    .sort();
  return docs.length ? { kind: 'updated', docs } : { kind: 'none' };
}

/**
 * What the server's consent log says the user agreed to: the latest decision
 * per document, counted only if it was "granted".
 */
export function agreedFromLog(
  rows: { docType: string; docVersion: number | null; action: string }[],
): AgreedVersions | null {
  const latest = new Map<string, { docVersion: number | null; action: string }>();
  // Rows come newest first; the first one per document is the latest decision.
  for (const row of rows) if (!latest.has(row.docType)) latest.set(row.docType, row);
  const terms = latest.get('terms');
  const privacy = latest.get('privacy');
  if (terms?.action !== 'granted' || privacy?.action !== 'granted') return null;
  if (terms.docVersion === null || privacy.docVersion === null) return null;
  return { terms: terms.docVersion, privacy: privacy.docVersion };
}
