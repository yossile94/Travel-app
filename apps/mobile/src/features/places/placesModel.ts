/**
 * Sprint 11 F-029 (design 3 – 7; D18 – D22; Raz 29.10): "What to see", pure.
 * The places of a country are on the device; everything here filters, sorts
 * and words them — no network, no React. The picked city never leaves the
 * device (D20).
 */
import type { CityEntry } from '@/features/trips/citySearch';
import type { Trip } from '@/features/trips/tripsApi';

export type PlaceCategory = 'attraction' | 'nature' | 'culture' | 'family' | 'food' | 'shopping';
export type CuratedCategory = PlaceCategory | 'kosher' | 'chabad' | 'memorial';
export const CATEGORIES: readonly PlaceCategory[] = [
  'attraction',
  'nature',
  'culture',
  'family',
  'food',
  'shopping',
];

/** AC-4: a city's places are within 15 km of its centre. */
export const CITY_RADIUS_KM = 15;
/** AC-5: the radii around a hotel; 3 is the default. */
export const HOTEL_RADII = [1, 3, 10] as const;
/** Design 3.6: rows shown per "page"; the data is already on the device. */
export const PAGE_SIZE = 20;
/** D11: the largest cities offered without a trip. */
export const LARGEST_CITIES = 5;

export interface Place {
  /** 'wd:Q123' or 'cu:<uuid>' (D4). */
  ref: string;
  nameHe: string | null;
  nameEn: string;
  lat: number;
  lng: number;
  category: CuratedCategory;
  /** Wikipedia sitelinks; curated places sort first, not by this. */
  popularity: number;
  /** Set for "recommended for Israelis" (AC-20). */
  curated?: {
    body: string | null;
    sourceUrl: string;
    verifiedAt: string;
    /** The same place in Wikidata, hidden from the list (Raz). */
    wikidataQid: string | null;
  };
}

/** [lng, lat] → km, great circle (design 25: one distance for the app and the planner). */
export function distanceKm([lng1, lat1]: [number, number], [lng2, lat2]: [number, number]): number {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

/** Design 4: "850 מ'" under 1 km (to 50 m), "1.2 ק"מ" under 10, "14 ק"מ" above. */
export function formatDistance(km: number): { value: string; unit: 'm' | 'km' } {
  if (km < 1) return { value: String(Math.max(50, Math.round((km * 1000) / 50) * 50)), unit: 'm' };
  if (km < 10) return { value: (Math.round(km * 10) / 10).toFixed(1), unit: 'km' };
  return { value: String(Math.round(km)), unit: 'km' };
}

/**
 * The country's list: curated first (by name), then Wikidata by popularity;
 * a Wikidata row that a curated place names (wikidata_qid) is hidden.
 */
export function mergeCurated(wikidata: readonly Place[], curated: readonly Place[]): Place[] {
  const shadowed = new Set(
    curated.map((p) => p.curated?.wikidataQid).filter((q): q is string => Boolean(q)),
  );
  const collator = new Intl.Collator('he');
  return [
    ...[...curated].sort((a, b) => collator.compare(a.nameHe ?? a.nameEn, b.nameHe ?? b.nameEn)),
    ...wikidata
      .filter((p) => !shadowed.has(p.ref.slice(3)))
      .sort((a, b) => b.popularity - a.popularity || a.ref.localeCompare(b.ref)),
  ];
}

/** A shown place, with its distance when the tab has one. */
export interface ShownPlace {
  place: Place;
  km: number | null;
}

/**
 * "בעיר" (design 3.3): within 15 km of the city, in the list's order; or, with
 * no point ("בכל המדינה"), the whole list. Computed once per city (26.8).
 */
export function placesInCity(list: readonly Place[], point: [number, number] | null): ShownPlace[] {
  if (!point) return list.map((place) => ({ place, km: null }));
  const out: ShownPlace[] = [];
  for (const place of list) {
    const km = distanceKm(point, [place.lng, place.lat]);
    if (km <= CITY_RADIUS_KM) out.push({ place, km });
  }
  return out;
}

/** "ליד המלון" (3.4): within the radius, curated first, then by distance. */
export function placesNear(
  list: readonly Place[],
  point: [number, number],
  radiusKm: number,
): ShownPlace[] {
  return list
    .map((place) => ({ place, km: distanceKm(point, [place.lng, place.lat]) }))
    .filter((s) => s.km <= radiusKm)
    .sort(
      (a, b) =>
        Number(Boolean(b.place.curated)) - Number(Boolean(a.place.curated)) ||
        a.km - b.km ||
        a.place.ref.localeCompare(b.place.ref),
    );
}

/** The category chip: "all", or one of AC-3's; curated special categories show under "all" only. */
export function byCategory(
  shown: readonly ShownPlace[],
  category: PlaceCategory | 'all',
): ShownPlace[] {
  return category === 'all' ? [...shown] : shown.filter((s) => s.place.category === category);
}

// ------------------------------------------------------------- the trip

/** The day in the destination's calendar, "YYYY-MM-DD", compared as text. */
const isActive = (trip: Trip, today: string) => trip.startDate <= today && today <= trip.endDate;

/**
 * The trip the country screen is tied to (Raz, 29.10): the active trip that
 * started last; otherwise the next by start date; ties by id. Past trips
 * don't count.
 */
export function contextTrip(trips: readonly Trip[], adm0: string, today: string): Trip | null {
  const here = trips.filter((t) => t.countryAdm0 === adm0 && t.endDate >= today);
  const active = here
    .filter((t) => isActive(t, today))
    .sort((a, b) => b.startDate.localeCompare(a.startDate) || a.id.localeCompare(b.id));
  if (active[0]) return active[0];
  return (
    [...here].sort(
      (a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id),
    )[0] ?? null
  );
}

// ------------------------------------------------------- the city picker

export type PickerOption =
  | {
      kind: 'city';
      key: string;
      id: number;
      nameHe: string;
      nameEn: string;
      from: 'trip' | 'largest' | 'search';
    }
  | { kind: 'typed'; key: string; name: string }
  | { kind: 'other'; key: 'other' }
  | { kind: 'country'; key: 'country' };

export interface PickerInput {
  /** The trip the screen is tied to, if any (3.1). */
  trip: Pick<Trip, 'cities' | 'startDate' | 'endDate'> | null;
  /** The country's bundled cities, largest first (D11). */
  cities: readonly CityEntry[];
  /** The city of tonight's night (3.7.3), when the trip is active. */
  nightCityId: number | null;
  /** A city picked in "עיר אחרת" this session. */
  searched: CityEntry | null;
}

/**
 * Design 3.7.1 (AC-4): the trip's cities in order, each once (manual ones
 * marked); without trip cities, the 5 largest; then a searched city, "עיר
 * אחרת", and "בכל המדינה" always last. The default: tonight's city on an
 * active trip, the trip's first city, else the largest. No bundled cities: no
 * picker at all (null).
 */
export function cityPickerOptions(input: PickerInput): {
  options: PickerOption[];
  defaultKey: string;
  /** Raz 29.10: a trip without listed cities shows the help line. */
  noTripCity: boolean;
} | null {
  if (input.cities.length === 0) return null;
  const byId = new Map(input.cities.map((c) => [c.id, c]));
  const options: PickerOption[] = [];
  const seen = new Set<number>();
  for (const c of input.trip?.cities ?? []) {
    if (c.geonameId === null) {
      options.push({ kind: 'typed', key: `typed:${c.name}`, name: c.name });
    } else if (!seen.has(c.geonameId)) {
      seen.add(c.geonameId);
      const city = byId.get(c.geonameId);
      options.push({
        kind: 'city',
        key: `city:${c.geonameId}`,
        id: c.geonameId,
        nameHe: city?.nameHe || c.name,
        nameEn: city?.nameEn ?? c.name,
        from: 'trip',
      });
    }
  }
  const tripHasListed = seen.size > 0;
  if (!tripHasListed) {
    for (const city of input.cities.slice(0, LARGEST_CITIES)) {
      if (seen.has(city.id)) continue;
      seen.add(city.id);
      options.push({
        kind: 'city',
        key: `city:${city.id}`,
        id: city.id,
        nameHe: city.nameHe,
        nameEn: city.nameEn,
        from: 'largest',
      });
    }
  }
  const { searched } = input;
  if (searched && !seen.has(searched.id)) {
    options.push({
      kind: 'city',
      key: `city:${searched.id}`,
      id: searched.id,
      nameHe: searched.nameHe,
      nameEn: searched.nameEn,
      from: 'search',
    });
  }
  options.push({ kind: 'other', key: 'other' }, { kind: 'country', key: 'country' });

  const first = options[0]!;
  let defaultKey = first.key;
  if (searched) defaultKey = `city:${searched.id}`;
  else if (input.nightCityId !== null && seen.has(input.nightCityId))
    defaultKey = `city:${input.nightCityId}`;
  // A trip whose first city was typed: still that one (3.7.1); its empty state says why.
  return {
    options,
    defaultKey,
    noTripCity: Boolean(input.trip) && !tripHasListed && !hasTyped(input.trip),
  };
}

const hasTyped = (trip: PickerInput['trip']) =>
  (trip?.cities ?? []).some((c) => c.geonameId === null);

// ---------------------------------------------------- the trip form ask

/**
 * Design 2.5 (D19): the one question before save_trip — on create and
 * duplicate only, when no city from the list is marked, once per trip, and
 * only online (offline, saving is blocked anyway).
 */
export function shouldAskCity(
  kind: 'create' | 'duplicate' | 'edit',
  cities: readonly { geonameId: number | null }[],
  asked: boolean,
  online: boolean,
): boolean {
  if (kind === 'edit' || asked || !online) return false;
  return !cities.some((c) => c.geonameId !== null);
}

// ------------------------------------------------------ tonight's city

/** Whole days from a to b ("YYYY-MM-DD"). */
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * Design 3.7.3 (scope ח3): the trip city of tonight's night, for the picker's
 * default on an active trip — the listed trip city nearest a hotel with a
 * point that covers tonight (within 15 km); else the one listed city; else the
 * trip's days split evenly between its listed cities in order. Null when the
 * trip isn't active or has no listed city.
 */
export function nightCityId(
  trip: Pick<Trip, 'cities' | 'startDate' | 'endDate'>,
  hotels: readonly { checkIn: string; checkOut: string; point?: [number, number] | null }[],
  today: string,
  pointOf: (id: number) => [number, number] | null,
): number | null {
  if (today < trip.startDate || today > trip.endDate) return null;
  const listed: number[] = [];
  for (const c of trip.cities)
    if (c.geonameId !== null && !listed.includes(c.geonameId)) listed.push(c.geonameId);
  if (listed.length === 0) return null;
  const hotel = hotels.find((h) => h.point && h.checkIn <= today && today < h.checkOut);
  if (hotel?.point) {
    const nearest = listed
      .map((id) => ({ id, at: pointOf(id) }))
      .filter((c): c is { id: number; at: [number, number] } => c.at !== null)
      .map((c) => ({ id: c.id, km: distanceKm(c.at, hotel.point!) }))
      .filter((c) => c.km <= CITY_RADIUS_KM)
      .sort((a, b) => a.km - b.km)[0];
    if (nearest) return nearest.id;
  }
  if (listed.length === 1) return listed[0]!;
  const days = daysBetween(trip.startDate, trip.endDate) + 1;
  const index = daysBetween(trip.startDate, today);
  return listed[Math.min(listed.length - 1, Math.floor((index * listed.length) / days))]!;
}

/**
 * QA B8: a Hebrew name from Wikidata is often a Wikipedia title — "בנגקוק/פראטונאם",
 * "בריטניק (אונייה)". The place is shown as itself: no "city/" prefix, no
 * trailing disambiguation, unless the English name has the same slash.
 */
export function placeNameHe(nameHe: string | null, nameEn: string): string | null {
  if (!nameHe) return null;
  let name = nameHe.trim().replace(/\s*\([^()]*\)$/, '');
  if (name.includes('/') && !nameEn.includes('/')) name = name.slice(name.lastIndexOf('/') + 1);
  return name.trim() || nameHe;
}
