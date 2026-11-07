/**
 * Hotel search (sprint 14 F-043, AC-1 – AC-5), apart from its I/O so it is
 * tested with fakes. Three modes, all in a POST body (never the URL, which
 * Supabase logs):
 *   search  — Autocomplete (New), lodging only, limited to the trip's countries.
 *   pick    — Place Details in the local language with the session token, then
 *             name and address in English without it (skipped when local is
 *             English). The phone puts the first call in the Enterprise tier,
 *             so picks have a global monthly budget below its free 1,000.
 *   refresh — location only, for the 30-day rule on the point (ADR-021).
 * Nothing the user typed is logged. Any failure is an answer the form turns
 * into manual entry, never a dead end (AC-5).
 */

export const SEARCH_PER_DAY = 100;
export const PICKS_PER_DAY = 20;

const PLACE_ID = /^[A-Za-z0-9_-]{10,300}$/;
const SESSION = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REGION = /^[A-Z]{2}$/;
const LANGUAGE = /^[a-z]{2,3}(-[A-Z][a-z]{3})?$/;

export type Suggestion = { placeId: string; name: string; place: string };
export type Picked = {
  placeId: string;
  nameLocal: string | null;
  addressLocal: string | null;
  nameEn: string | null;
  addressEn: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  fetchedAt: string;
};

/** What Google answered, already reduced to the fields asked for. */
export type GoogleAnswer<T> = { ok: true; value: T } | { ok: false; notFound: boolean };

export type PlaceDetails = {
  id: string;
  displayName?: string;
  formattedAddress?: string;
  internationalPhoneNumber?: string;
  location?: { latitude: number; longitude: number };
};

export type PlacesProvider = {
  autocomplete(q: {
    input: string;
    session: string;
    regions: string[];
    language: string;
  }): Promise<GoogleAnswer<Suggestion[]>>;
  details(q: {
    placeId: string;
    language: string;
    session: string | null;
    fields: string[];
  }): Promise<GoogleAnswer<PlaceDetails>>;
};

export type Kind = 'search' | 'pick' | 'refresh';

export type PlacesDeps = {
  /** Null when the key isn't set yet (AC-5 "unavailable"). */
  provider: PlacesProvider | null;
  /** The user's daily count and the project's monthly budget, in one step. */
  take(userId: string, kind: Kind): Promise<boolean>;
  now(): Date;
};

export type PlacesAnswer =
  | { status: 200; body: { suggestions: Suggestion[] } }
  | { status: 200; body: { place: Picked } }
  | { status: 200; body: { refreshed: { placeId: string; lat: number; lng: number; fetchedAt: string } } }
  | { status: 200; body: { gone: true } }
  | { status: 400; body: { error: 'bad_request' } }
  | { status: 429; body: { error: 'quota' } }
  | { status: 503; body: { error: 'unavailable' | 'provider' } };

const bad = { status: 400, body: { error: 'bad_request' } } as const;
const quota = { status: 429, body: { error: 'quota' } } as const;
const failed = { status: 503, body: { error: 'provider' } } as const;

export const PICK_FIELDS = ['id', 'displayName', 'formattedAddress', 'location', 'internationalPhoneNumber'];
export const ENGLISH_FIELDS = ['displayName', 'formattedAddress'];
export const REFRESH_FIELDS = ['id', 'location'];

const str = (v: unknown) => (typeof v === 'string' ? v : null);
const trimmed = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

export async function places(
  deps: PlacesDeps,
  userId: string,
  body: Record<string, unknown>,
): Promise<PlacesAnswer> {
  const mode = str(body.mode);
  if (mode !== 'search' && mode !== 'pick' && mode !== 'refresh') return bad;
  if (!deps.provider) return { status: 503, body: { error: 'unavailable' } };
  const provider = deps.provider;

  if (mode === 'search') {
    const input = str(body.input)?.trim() ?? '';
    const session = str(body.session);
    const language = str(body.language);
    const regions = Array.isArray(body.regions) ? body.regions : null;
    if (
      input.length < 3 || input.length > 100 ||
      !session || !SESSION.test(session) ||
      !language || !LANGUAGE.test(language) ||
      !regions || regions.length < 1 || regions.length > 15 ||
      !regions.every((r) => typeof r === 'string' && REGION.test(r))
    ) {
      return bad;
    }
    if (!(await deps.take(userId, 'search'))) return quota;
    const answer = await provider.autocomplete({ input, session, regions: regions as string[], language });
    if (!answer.ok) return failed;
    return { status: 200, body: { suggestions: answer.value.slice(0, 5) } };
  }

  const placeId = str(body.placeId);
  if (!placeId || !PLACE_ID.test(placeId)) return bad;

  if (mode === 'refresh') {
    if (!(await deps.take(userId, 'refresh'))) return quota;
    const answer = await provider.details({ placeId, language: 'en', session: null, fields: REFRESH_FIELDS });
    if (!answer.ok) return answer.notFound ? { status: 200, body: { gone: true } } : failed;
    const loc = answer.value.location;
    if (!loc) return { status: 200, body: { gone: true } };
    return {
      status: 200,
      body: {
        refreshed: {
          placeId: answer.value.id || placeId,
          lat: loc.latitude,
          lng: loc.longitude,
          fetchedAt: deps.now().toISOString(),
        },
      },
    };
  }

  const session = str(body.session);
  const local = str(body.localLanguage);
  if (!session || !SESSION.test(session) || !local || !LANGUAGE.test(local)) return bad;
  if (!(await deps.take(userId, 'pick'))) return quota;
  const first = await provider.details({ placeId, language: local, session, fields: PICK_FIELDS });
  if (!first.ok) return first.notFound ? { status: 200, body: { gone: true } } : failed;
  const d = first.value;
  let nameEn = trimmed(d.displayName);
  let addressEn = trimmed(d.formattedAddress);
  if (local.split('-')[0] !== 'en') {
    const english = await provider.details({ placeId, language: 'en', session: null, fields: ENGLISH_FIELDS });
    // Without the English half the local one still fills the card.
    nameEn = english.ok ? trimmed(english.value.displayName) : null;
    addressEn = english.ok ? trimmed(english.value.formattedAddress) : null;
  }
  return {
    status: 200,
    body: {
      place: {
        placeId: d.id || placeId,
        nameLocal: trimmed(d.displayName),
        addressLocal: trimmed(d.formattedAddress),
        nameEn,
        addressEn,
        phone: trimmed(d.internationalPhoneNumber),
        lat: d.location?.latitude ?? null,
        lng: d.location?.longitude ?? null,
        fetchedAt: deps.now().toISOString(),
      },
    },
  };
}

/** Places API (New) over fetch. The key never leaves the server. */
export function googlePlaces(key: string, fetcher: typeof fetch = fetch): PlacesProvider {
  const base = 'https://places.googleapis.com/v1';
  const timeout = () => AbortSignal.timeout(8_000);
  return {
    async autocomplete({ input, session, regions, language }) {
      try {
        const res = await fetcher(`${base}/places:autocomplete`, {
          method: 'POST',
          signal: timeout(),
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': key,
            'X-Goog-FieldMask':
              'suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat',
          },
          body: JSON.stringify({
            input,
            sessionToken: session,
            includedPrimaryTypes: ['lodging'],
            includedRegionCodes: regions.map((r) => r.toLowerCase()),
            languageCode: language,
          }),
        });
        if (!res.ok) return { ok: false, notFound: false };
        const json = (await res.json()) as {
          suggestions?: {
            placePrediction?: {
              placeId?: string;
              structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
            };
          }[];
        };
        const value: Suggestion[] = [];
        for (const s of json.suggestions ?? []) {
          const p = s.placePrediction;
          const name = p?.structuredFormat?.mainText?.text;
          if (!p?.placeId || !name) continue;
          value.push({ placeId: p.placeId, name, place: p.structuredFormat?.secondaryText?.text ?? '' });
        }
        return { ok: true, value };
      } catch {
        return { ok: false, notFound: false };
      }
    },
    async details({ placeId, language, session, fields }) {
      try {
        const query = new URLSearchParams({ languageCode: language });
        if (session) query.set('sessionToken', session);
        const res = await fetcher(`${base}/places/${encodeURIComponent(placeId)}?${query}`, {
          signal: timeout(),
          headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': fields.join(',') },
        });
        if (res.status === 404) return { ok: false, notFound: true };
        if (!res.ok) return { ok: false, notFound: false };
        const json = (await res.json()) as {
          id?: string;
          displayName?: { text?: string };
          formattedAddress?: string;
          internationalPhoneNumber?: string;
          location?: { latitude: number; longitude: number };
        };
        return {
          ok: true,
          value: {
            id: json.id ?? placeId,
            displayName: json.displayName?.text,
            formattedAddress: json.formattedAddress,
            internationalPhoneNumber: json.internationalPhoneNumber,
            location: json.location,
          },
        };
      } catch {
        return { ok: false, notFound: false };
      }
    },
  };
}
