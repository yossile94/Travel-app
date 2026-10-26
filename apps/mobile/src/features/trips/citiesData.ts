/**
 * The bundled city list (scripts/build-cities.mjs), loaded the first time
 * the city search opens and kept for the session (sprint 3 AC-4: never
 * before the first frame, and never by the card).
 */
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';

import { entryOf, indexCities, type CityEntry, type CityRow } from './citySearch';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const CITIES = require('../../../assets/data/cities.dat') as number;

type Areas = Map<string, CityRow[]>;

let areas: Promise<Areas> | null = null;
const indexes = new Map<string, ReturnType<typeof indexCities>>();

function loadAreas(): Promise<Areas> {
  areas ??= (async () => {
    const asset = await Asset.fromModule(CITIES).downloadAsync();
    const text = await new File(asset.localUri ?? asset.uri).text();
    const data = JSON.parse(text) as { areas: Record<string, CityRow[]> };
    return new Map(Object.entries(data.areas));
  })().catch((error: unknown) => {
    // A later opening tries again.
    areas = null;
    throw error;
  });
  return areas;
}

/** The search index of one area (built once per area); empty when the list has none. */
export async function cityIndex(adm0: string): Promise<ReturnType<typeof indexCities>> {
  const cached = indexes.get(adm0);
  if (cached) return cached;
  const rows = (await loadAreas()).get(adm0) ?? [];
  const index = indexCities(rows.map(entryOf));
  indexes.set(adm0, index);
  return index;
}

export type { CityEntry };
