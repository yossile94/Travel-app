/**
 * Discovery search (sprint 9 F-023, spec 5.12, ADR-014): which countries
 * match the chosen chips, and why — or why not. Pure: the screen hands in
 * the bundled countries, climate, cities and the advisories copy; everything
 * runs on the device. Every rule lives in evaluate(); discover() lists the
 * matches (Raz, design note 10).
 */
import { roundTemp } from '@/features/climate/tempFormat';
import type { Advisory } from '@/features/destination/destinationData';

export type Weather = 'hot' | 'mild' | 'cool' | 'winter';

export interface DiscoverFilters {
  family: boolean;
  near: boolean;
  /** The weather chip is on (it may have no type yet: then it only sets the month). */
  weatherOn: boolean;
  weather: Weather | null;
  /** 0–11, from the one month picker; used by the weather and family chips (AC-1). */
  month: number;
}

export const NO_FILTERS: DiscoverFilters = {
  family: false,
  near: false,
  weatherOn: false,
  weather: null,
  month: 0,
};

/** One place to test: the area's climate point, or a bundled city. */
export interface ClimatePoint {
  /** Monthly mean in hundredths of a degree. */
  temps: number[];
  /** Whole wet days per month; null when unknown. */
  wet: number[] | null;
  /** A city, or null for the area's own point. */
  city: { id: number; nameHe: string; nameEn: string; population: number } | null;
}

export interface DiscoverCountry {
  adm0: string;
  /** [lon, lat] (Natural Earth label point). */
  label: [number, number];
}

export interface DiscoverInput {
  countries: readonly DiscoverCountry[];
  advisories: ReadonlyMap<string, Pick<Advisory, 'entryStatus' | 'nscLevels'>> | null;
  /** The area's point and its cities, in any order; empty when it has no climate value. */
  pointsOf: (adm0: string) => readonly ClimatePoint[];
  landlocked: ReadonlySet<string>;
  /** Barred for Israelis, bundled: used where the device has no advisory (Raz 5). */
  banned: ReadonlySet<string>;
}

export interface DiscoverReasons {
  /** Estimated flight hours, to the half hour. */
  hours: number;
  /** The highest NSC level (family). */
  nsc?: number;
  /**
   * Entry for Israelis: with "family", allowed or not filled in yet; without
   * it, only "restricted" is worth saying (design 8.4).
   */
  entry?: 'allowed' | 'check' | 'restricted';
  /** The shown mean that month, in whole degrees. */
  temp?: number;
  /** When the temperature is a city's, not the area's point (Raz 10). */
  tempCity?: { nameHe: string; nameEn: string };
  /** Whole wet days that month, when the weather type limits rain. */
  rain?: number;
  /** "Hot, by the sea" was asked and the country has a coast. */
  coast?: boolean;
}

/** Why a country doesn't match: the first rule it fails, in this order (design 9.4). */
export type DiscoverFailure =
  | 'barred'
  | 'far'
  | 'noAdvisory'
  | 'nscHigh'
  | 'entryRestricted'
  | 'noClimate'
  | 'tooCold'
  | 'tooHot'
  | 'rainy'
  | 'noCoast';

export interface DiscoverResult {
  adm0: string;
  km: number;
  match: boolean;
  reasons: DiscoverReasons;
  failure?: DiscoverFailure;
  /** For a big country: the matching cities, largest first (up to 3); empty when its own point matches. */
  cities: { id: number; nameHe: string; nameEn: string }[];
}

/** Ben Gurion airport, where every distance starts (AC-4, Raz 4). */
export const TLV: [number, number] = [34.8867, 32.0114];
export const NEAR_HOURS = 5;
/**
 * Never a result (AC-9, Raz 7): Israel itself, and areas with no residents.
 * Gaza and the no-code areas aren't in countryMeta at all.
 */
export const NEVER: ReadonlySet<string> = new Set([
  'ISR',
  'ATA',
  'ATF',
  'HMD',
  'SGS',
  'IOT',
  'IOA',
  'UMI',
  'PCN',
  'CLP',
  'CSI',
  'ATC',
  'BRI',
]);
/** Cities that can make a big country match (Raz 8). */
export const CITY_MIN_POPULATION = 100_000;
/**
 * Entry not filled in yet (every advisory row today): still a family match,
 * shown as "check entry before you travel" until the admin fills it in
 * (sprint 10). Restricted or banned never match.
 */
export const FAMILY_ALLOWS_UNCHECKED_ENTRY = true;

/** Great-circle distance in km (haversine, R = 6371). */
export function distanceKm([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]): number {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Spec 5.12: km ÷ 800 + 0.5, to the nearest half hour (a tie rounds up). */
export const flightHours = (km: number) => Math.round((km / 800 + 0.5) * 2) / 2;

/**
 * The whole degrees shown (Raz 3): every rule compares these, never the
 * hundredths, rounded exactly as the card rounds them (half away from zero).
 */
export const shownTemp = roundTemp;

/** AC-3: half-open bands on the shown degrees, so every value has exactly one. */
export function weatherOf(degrees: number): Weather {
  if (degrees >= 24) return 'hot';
  if (degrees >= 16) return 'mild';
  if (degrees > 0) return 'cool';
  return 'winter';
}

const BAND_ORDER: Weather[] = ['winter', 'cool', 'mild', 'hot'];

/** Whether any chip that filters is on (the weather chip without a type doesn't, Raz 2). */
export const anyFilter = (f: DiscoverFilters) => f.family || f.near || f.weather !== null;

/** Why one point fails the month's rules, or null when it passes. */
function pointFailure(
  p: ClimatePoint,
  f: DiscoverFilters,
  coastal: boolean,
): DiscoverFailure | null {
  const t = shownTemp(p.temps[f.month]!);
  // Family: 12° to 30° in the picker's month (AC-2, Raz 1).
  if (f.family && t < 12) return 'tooCold';
  if (f.family && t > 30) return 'tooHot';
  if (!f.weather) return null;
  const band = weatherOf(t);
  if (band !== f.weather) {
    return BAND_ORDER.indexOf(band) < BAND_ORDER.indexOf(f.weather) ? 'tooCold' : 'tooHot';
  }
  if (f.weather === 'hot' || f.weather === 'mild') {
    const wet = p.wet?.[f.month];
    if (wet === undefined || wet > (f.weather === 'hot' ? 8 : 10)) return 'rainy';
  }
  if (f.weather === 'hot' && !coastal) return 'noCoast';
  return null;
}

/** One country against the chips: whether it matches, the reasons, and the first failure. */
export function evaluate(
  input: DiscoverInput,
  country: DiscoverCountry,
  f: DiscoverFilters,
): DiscoverResult {
  const { adm0 } = country;
  const km = distanceKm(TLV, country.label);
  const reasons: DiscoverReasons = { hours: flightHours(km) };
  const done = (
    failure?: DiscoverFailure,
    cities: DiscoverResult['cities'] = [],
  ): DiscoverResult =>
    failure
      ? { adm0, km, match: false, reasons, failure, cities }
      : { adm0, km, match: true, reasons, cities };
  if (NEVER.has(adm0)) return done('barred');
  const advisory = input.advisories?.get(adm0);
  // Barred is never highlighted, in any mode (AC-9). The copy decides only where it
  // has a value; with no copy, or no value in it, the bundled list stands in.
  const entry = advisory?.entryStatus ?? null;
  if (entry === 'banned' || (entry === null && input.banned.has(adm0))) return done('barred');
  if (f.near && reasons.hours > NEAR_HOURS) return done('far');
  if (!f.family && advisory?.entryStatus === 'restricted') reasons.entry = 'restricted';
  if (f.family) {
    const levels = advisory?.nscLevels ?? [];
    if (!levels.length) return done('noAdvisory');
    const top = Math.max(...levels);
    reasons.nsc = top;
    if (top > 2) return done('nscHigh');
    const entry = advisory!.entryStatus;
    if (entry === 'restricted' || (entry !== 'allowed' && !FAMILY_ALLOWS_UNCHECKED_ENTRY)) {
      return done('entryRestricted');
    }
    reasons.entry = entry === 'allowed' ? 'allowed' : 'check';
  }
  // The month matters to the family rule and to the weather chip, even with no type (a reason, no filter).
  if (!f.family && !f.weatherOn) return done();
  const filtering = f.family || f.weather !== null;
  const points = input.pointsOf(adm0);
  const own = points.find((p) => p.city === null);
  if (!own) return filtering ? done('noClimate') : done();
  const coastal = !input.landlocked.has(adm0);
  const ownFailure = filtering ? pointFailure(own, f, coastal) : null;
  if (!ownFailure) {
    reasons.temp = shownTemp(own.temps[f.month]!);
    addWeatherReasons(reasons, own, f);
    return done();
  }
  // A big country can match through its cities; largest first (Raz 8, 12).
  const cities = points
    .filter(
      (p) => p.city && p.city.population >= CITY_MIN_POPULATION && !pointFailure(p, f, coastal),
    )
    .sort((a, b) => b.city!.population - a.city!.population);
  const first = cities[0];
  if (!first) {
    // The failure shown is the country's own point's, never a city's (Raz, design 3).
    reasons.temp = shownTemp(own.temps[f.month]!);
    return done(ownFailure);
  }
  reasons.temp = shownTemp(first.temps[f.month]!);
  reasons.tempCity = { nameHe: first.city!.nameHe, nameEn: first.city!.nameEn };
  addWeatherReasons(reasons, first, f);
  return done(
    undefined,
    cities
      .slice(0, 3)
      .map((p) => ({ id: p.city!.id, nameHe: p.city!.nameHe, nameEn: p.city!.nameEn })),
  );
}

function addWeatherReasons(reasons: DiscoverReasons, p: ClimatePoint, f: DiscoverFilters) {
  if (f.weather === 'hot' || f.weather === 'mild') {
    const wet = p.wet?.[f.month];
    if (wet !== undefined) reasons.rain = wet;
  }
  if (f.weather === 'hot') reasons.coast = true;
}

/** The matching countries, nearest first, then by code for a stable order (AC-6, Raz 13). */
export function discover(input: DiscoverInput, f: DiscoverFilters): DiscoverResult[] {
  if (!anyFilter(f)) return [];
  return input.countries
    .map((c) => evaluate(input, c, f))
    .filter((r) => r.match)
    .sort((a, b) => a.km - b.km || (a.adm0 < b.adm0 ? -1 : 1));
}

/** The month the chips start with: the next one (AC-1). */
export const nextMonth = (now = new Date()) => (now.getMonth() + 1) % 12;
