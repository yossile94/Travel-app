/**
 * Sprint 10 F-025, F-026 (spec 6, ADR-015): the passport wallet's rules, pure.
 * Nothing here leaves the device; the module never imports the network
 * (ESLint, D8). Dates are Postgres-style calendar days ("YYYY-MM-DD"), like
 * the trips, so the comparisons are plain string comparisons.
 */

/** One person's passport, as kept on the device (D1, D4). */
export interface Holder {
  /** A local UUID; "me" for the account holder. */
  id: string;
  isMe: boolean;
  /** Typed on the device; "" for "me" (shown as "Me"). */
  name: string;
  /** The last day the passport is valid; null: not entered. */
  expiry: string | null;
  /** Exactly 4 digits, or null. Never more (AC-1). */
  last4: string | null;
  hasPhoto: boolean;
}

export const ME_ID = 'me';
export const LIMITS = { name: 60, holders: 20, suggestions: 6 } as const;
/** Spec 6.4: the default months of validity on the return day. */
export const DEFAULT_VALIDITY_MONTHS = 6;

/** A name for matching a trip's traveler to a holder (D1, design 34.2). */
export function normalizeName(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/[֑-ׇ]/g, '') // Hebrew points and cantillation
    .replace(/[‎‏⁦-⁩]/g, '') // direction marks
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();
}

/** A Postgres date moved by whole calendar months; the 31st becomes the month's last day. */
export function addMonths(value: string, months: number): string {
  const [y, m, d] = value.split('-').map(Number);
  const first = new Date(Date.UTC(y!, m! - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d!, last));
  return first.toISOString().slice(0, 10);
}

export type Verdict = 'expired_before_departure' | 'short_on_return' | 'ok' | 'no_date';

/**
 * Design 6.1 (D10): a passport against a trip. `expiry` is the last valid
 * day, so expiring on the departure day still flies (orange, not red). Once
 * the trip started there is no red: they already left (Raz).
 */
export function passportVerdict(p: {
  expiry: string | null;
  start: string;
  end: string;
  months: number;
  today: string;
}): Verdict {
  if (!p.expiry) return 'no_date';
  const started = p.today >= p.start;
  if (p.expiry < p.start) return started ? 'short_on_return' : 'expired_before_departure';
  // months 0: valid until the return day itself.
  const needed = p.months > 0 ? addMonths(p.end, p.months) : p.end;
  return p.expiry < needed ? 'short_on_return' : 'ok';
}

/** Months the destination asks for: its own value, its sovereign's, or 6 (D10). */
export function validityMonths(
  adm0: string,
  monthsOf: (adm0: string) => number | null | undefined,
  parentOf: (adm0: string) => string | undefined,
): { months: number; fromCountry: boolean } {
  const own = monthsOf(adm0);
  if (own !== null && own !== undefined) return { months: own, fromCountry: true };
  const parent = parentOf(adm0);
  const inherited = parent ? monthsOf(parent) : null;
  if (inherited !== null && inherited !== undefined)
    return { months: inherited, fromCountry: true };
  return { months: DEFAULT_VALIDITY_MONTHS, fromCountry: false };
}

export interface TripPassports {
  red: Holder[];
  orange: Holder[];
  /** "me" first, then the travelers in the trip's order; a name with no holder is `holder: null`. */
  missing: { key: string; name: string; isMe: boolean; holder: Holder | null }[];
}

/**
 * Design 6.1–6.4: every traveler of an upcoming or active trip against the
 * device's passports. "Me" is the account holder; the others match by
 * normalized name. A trip already over checks nothing.
 */
export function tripPassports(
  trip: { start: string; end: string; travelers: readonly { name: string }[] },
  holders: readonly Holder[],
  months: number,
  today: string,
): TripPassports {
  const result: TripPassports = { red: [], orange: [], missing: [] };
  if (trip.end < today) return result;
  const byName = new Map(holders.filter((h) => !h.isMe).map((h) => [normalizeName(h.name), h]));
  const people: { key: string; name: string; isMe: boolean; holder: Holder | null }[] = [
    { key: ME_ID, name: '', isMe: true, holder: holders.find((h) => h.isMe) ?? null },
  ];
  const seen = new Set<string>();
  for (const t of trip.travelers) {
    const norm = normalizeName(t.name);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    const holder = byName.get(norm) ?? null;
    people.push({ key: holder?.id ?? `name:${norm}`, name: t.name.trim(), isMe: false, holder });
  }
  for (const p of people) {
    const verdict = passportVerdict({
      expiry: p.holder?.expiry ?? null,
      start: trip.start,
      end: trip.end,
      months,
      today,
    });
    if (verdict === 'expired_before_departure') result.red.push(p.holder!);
    else if (verdict === 'short_on_return') result.orange.push(p.holder!);
    else if (verdict === 'no_date') result.missing.push(p);
  }
  return result;
}

/** The trip's worst state, for the "once per state" notification (D9). */
export function tripSeverity(p: TripPassports): 'red' | 'orange' | null {
  return p.red.length ? 'red' : p.orange.length ? 'orange' : null;
}

export type HolderField = 'name' | 'last4';
export type HolderError = 'nameRequired' | 'nameMax' | 'nameTaken' | 'last4';

const codePoints = (s: string) => [...s].length;

/** Design 4.3: the form's checks. "Me" has no name field. */
export function holderErrors(
  form: { id: string | null; isMe: boolean; name: string; last4: string },
  others: readonly Holder[],
): Partial<Record<HolderField, HolderError>> {
  const errors: Partial<Record<HolderField, HolderError>> = {};
  if (!form.isMe) {
    const name = form.name.trim();
    if (!name) errors.name = 'nameRequired';
    else if (codePoints(name) > LIMITS.name) errors.name = 'nameMax';
    else if (
      others.some(
        (h) => !h.isMe && h.id !== form.id && normalizeName(h.name) === normalizeName(name),
      )
    )
      errors.name = 'nameTaken';
  }
  if (form.last4 && !/^[0-9]{4}$/.test(form.last4)) errors.last4 = 'last4';
  return errors;
}

/**
 * Raz (Sharona's question 4): the field takes digits only; a pasted longer
 * number keeps its last 4, and says so.
 */
export function last4Input(text: string): { value: string; trimmed: boolean } {
  const digits = text.replace(/[^0-9]/g, '');
  if (digits.length > 4) return { value: digits.slice(-4), trimmed: true };
  return { value: digits, trimmed: false };
}

/** Design 3.1: "me" first, then by name in the interface language. */
export function sortHolders(holders: readonly Holder[], locale: string): Holder[] {
  const collator = new Intl.Collator(locale);
  return [...holders].sort(
    (a, b) => Number(b.isMe) - Number(a.isMe) || collator.compare(a.name, b.name),
  );
}

/**
 * Design 3.3 (D1): names from the trips not yet on the list, the nearest
 * trips first; the caller passes them in trip order.
 */
export function nameSuggestions(
  travelerNames: readonly string[],
  holders: readonly Holder[],
): string[] {
  const taken = new Set(holders.filter((h) => !h.isMe).map((h) => normalizeName(h.name)));
  const out: string[] = [];
  for (const raw of travelerNames) {
    const name = raw.trim();
    const norm = normalizeName(name);
    if (!norm || taken.has(norm)) continue;
    taken.add(norm);
    out.push(name);
  }
  return out;
}
