// Sprint 11 F-032 (design 23.3; AC-19, D8, D15): a curated place's rules, the
// same in the panel and in the database's CHECKs (the shared table of cases,
// supabase/tests/fixtures/admin_cases.json). Pure: imported by the form, the
// server action and node --test.
import { isHttps } from './validate.ts';

export const CURATED_CATEGORIES = [
  'kosher',
  'chabad',
  'memorial',
  'attraction',
  'nature',
  'culture',
  'family',
  'food',
  'shopping',
] as const;
export type CuratedCategory = (typeof CURATED_CATEGORIES)[number];
export const CURATED_STATUSES = ['draft', 'published', 'hidden'] as const;
export type CuratedStatus = (typeof CURATED_STATUSES)[number];
export const NAME_MAX = 120;
export const BODY_MAX = 280;

export interface CuratedForm {
  adm0: string;
  category: string;
  nameHe: string;
  nameEn: string;
  body: string;
  /** "13.7590, 100.4970": what is copied from a maps app. */
  coords: string;
  source: string;
  verified: string;
  status: string;
}

export type CuratedField =
  'adm0' | 'category' | 'nameHe' | 'nameEn' | 'body' | 'coords' | 'source' | 'verified' | 'status';
export type CuratedError =
  | 'country'
  | 'category'
  | 'nameRequired'
  | 'nameMax'
  | 'descMax'
  | 'coords'
  | 'lat'
  | 'lng'
  | 'sourceRequired'
  | 'sourceHttps'
  | 'verifiedRequired'
  | 'verifiedFuture'
  | 'status';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** The database's text_is_clean: no control, bidi or zero-width characters. */
const UNCLEAN = new RegExp(
  `[${[
    [0x01, 0x1f],
    [0x7f, 0x9f],
    [0x61c, 0x61c],
    [0x200b, 0x200b],
    [0x200e, 0x200f],
    [0x2028, 0x202e],
    [0x2060, 0x206f],
    [0xfeff, 0xfeff],
  ]
    .map(([a, b]) => `${String.fromCodePoint(a!)}-${String.fromCodePoint(b!)}`)
    .join('')}]`,
  'u',
);
const length = (s: string) => [...s].length;

/** "lat, lng" (a comma or spaces) → numbers, or which part is wrong. */
export function parseCoords(text: string): { lat: number; lng: number } | 'coords' | 'lat' | 'lng' {
  const m = /^\s*(-?\d+(?:\.\d{1,6})?)\s*(?:,\s*|\s+)(-?\d+(?:\.\d{1,6})?)\s*$/.exec(text);
  if (!m) return 'coords';
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (lat < -90 || lat > 90) return 'lat';
  if (lng < -180 || lng > 180) return 'lng';
  return { lat, lng };
}

export function curatedErrors(
  f: CuratedForm,
  today: string,
): Partial<Record<CuratedField, CuratedError>> {
  const e: Partial<Record<CuratedField, CuratedError>> = {};
  if (!/^[A-Z0-9]{3}$/.test(f.adm0)) e.adm0 = 'country';
  if (!(CURATED_CATEGORIES as readonly string[]).includes(f.category)) e.category = 'category';
  for (const field of ['nameHe', 'nameEn'] as const) {
    const v = f[field].trim();
    if (!v) e[field] = 'nameRequired';
    else if (length(v) > NAME_MAX || UNCLEAN.test(v)) e[field] = 'nameMax';
  }
  const body = f.body.trim();
  if (body && (length(body) > BODY_MAX || UNCLEAN.test(body))) e.body = 'descMax';
  const point = parseCoords(f.coords);
  if (typeof point === 'string') e.coords = point;
  const source = f.source.trim();
  if (!source) e.source = 'sourceRequired';
  else if (!isHttps(source)) e.source = 'sourceHttps';
  if (!f.verified || !DATE.test(f.verified)) e.verified = 'verifiedRequired';
  else if (f.verified > today) e.verified = 'verifiedFuture';
  if (!(CURATED_STATUSES as readonly string[]).includes(f.status)) e.status = 'status';
  return e;
}

/** The row to write; call only when curatedErrors is empty. */
export function curatedPayload(f: CuratedForm) {
  const point = parseCoords(f.coords) as { lat: number; lng: number };
  return {
    adm0: f.adm0,
    category: f.category,
    name_he: f.nameHe.trim(),
    name_en: f.nameEn.trim(),
    body: f.body.trim() || null,
    lat: point.lat,
    lng: point.lng,
    source_url: f.source.trim(),
    verified_at: f.verified,
    status: f.status,
  };
}

/** [lng, lat] → km (the app's distanceKm, design 25). */
export function distanceKm([lng1, lat1]: [number, number], [lng2, lat2]: [number, number]): number {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

/**
 * D8, D18: the listed city a point belongs to — the nearest within 15 km of
 * the country's bundled cities; null outside every one.
 */
export function cityFor(
  point: [number, number],
  cities: readonly { name: string; point: [number, number] }[],
): { name: string; km: number } | null {
  let best: { name: string; km: number } | null = null;
  for (const c of cities) {
    const km = distanceKm(point, c.point);
    if (km <= 15 && (!best || km < best.km)) best = { name: c.name, km };
  }
  return best;
}
