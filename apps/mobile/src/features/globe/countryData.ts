/**
 * Per-country data for the globe (built by scripts/build-country-meta.mjs),
 * keyed by Natural Earth's adm0 code, which is unique per area. ISO codes are
 * not: overseas territories share their parent's.
 */
import raw from './countryMeta.json';

export interface CountryCurrency {
  code: string;
  nameHe: string;
  symbol: string;
}

export interface CountryInfo {
  adm0: string;
  nameHe: string;
  nameEn: string;
  /** Natural Earth label point, [longitude, latitude]: inside the area even for odd shapes. */
  label: [number, number];
  /** Approximate size in degrees, used to pick the fly-to zoom. */
  span: number;
  /** Small land area: shown as a dot with an enlarged tap target. */
  small?: boolean;
  timeZone?: string;
  /** City whose time is shown, for countries that span several UTC offsets. */
  city?: string;
  currency?: CountryCurrency;
}

const table = raw as unknown as Record<string, Omit<CountryInfo, 'adm0'>>;

export function countryByAdm0(adm0: string): CountryInfo | undefined {
  const entry = table[adm0];
  return entry ? { adm0, ...entry } : undefined;
}

/** Every area on the globe (sprint 9: what discovery search goes through). */
export const allCountries: readonly CountryInfo[] = Object.entries(table).map(([adm0, entry]) => ({
  adm0,
  ...entry,
}));

export interface SmallCountryPoint {
  type: 'Feature';
  properties: { adm0: string };
  geometry: { type: 'Point'; coordinates: [number, number] };
}

/** Label points of small areas, for the dot layer and its enlarged tap target. */
export const smallCountryPoints: { type: 'FeatureCollection'; features: SmallCountryPoint[] } = {
  type: 'FeatureCollection',
  features: Object.entries(table)
    .filter(([, entry]) => entry.small)
    .map(([adm0, entry]) => ({
      type: 'Feature',
      properties: { adm0 },
      geometry: { type: 'Point', coordinates: entry.label },
    })),
};
