/**
 * The bundled city list (scripts/build-cities.mjs), loaded the first time
 * the city search opens and kept for the session (sprint 3 AC-4: never
 * before the first frame, and never by the card).
 */
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';

import { decodeBase64 } from '@/features/climate/climateData';

import { entryOf, indexCities, searchCities, type CityEntry, type CityRow } from './citySearch';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const CITIES = require('../../../assets/data/cities.dat') as number;

type Areas = Map<string, CityRow[]>;

/** Each city's [lon, lat], by GeoNames id (sprint 9, cities.dat v2 "points"; Raz D2). */
const pointById = new Map<number, [number, number]>();

let areas: Promise<Areas> | null = null;
const indexes = new Map<string, ReturnType<typeof indexCities>>();

function loadAreas(): Promise<Areas> {
  areas ??= (async () => {
    const asset = await Asset.fromModule(CITIES).downloadAsync();
    const text = await new File(asset.localUri ?? asset.uri).text();
    const data = JSON.parse(text) as {
      areas: Record<string, CityRow[]>;
      points?: Record<string, string>;
    };
    for (const [adm0, rows] of Object.entries(data.areas)) {
      const encoded = data.points?.[adm0];
      if (!encoded) continue;
      const bytes = decodeBase64(encoded);
      const view = new DataView(bytes.buffer);
      rows.forEach(([id], i) => {
        if ((i + 1) * 4 > bytes.length) return;
        pointById.set(id, [view.getInt16(i * 4, true) / 100, view.getInt16(i * 4 + 2, true) / 100]);
      });
    }
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

export interface GlobalCity extends CityEntry {
  adm0: string;
}

let globalIndex: Promise<{
  index: ReturnType<typeof indexCities>;
  areaOf: Map<number, string>;
}> | null = null;

/**
 * Every city in one index, largest first (sprint 4 F-014: cities in the main
 * search). Built once, on the first typed query, never before.
 */
export function globalCityIndex() {
  globalIndex ??= loadAreas()
    .then((areasMap) => {
      const areaOf = new Map<number, string>();
      const all: CityEntry[] = [];
      for (const [adm0, rows] of areasMap) {
        for (const row of rows) {
          const city = entryOf(row);
          areaOf.set(city.id, adm0);
          all.push(city);
        }
      }
      all.sort((a, b) => b.population - a.population);
      return { index: indexCities(all), areaOf };
    })
    .catch((error: unknown) => {
      globalIndex = null;
      throw error;
    });
  return globalIndex;
}

/** Up to `limit` cities for a main-search query, each with its area. */
export async function searchAllCities(query: string, limit = 5): Promise<GlobalCity[]> {
  const { index, areaOf } = await globalCityIndex();
  return searchCities(index, query, limit).map((city) => ({ ...city, adm0: areaOf.get(city.id)! }));
}

export type { CityEntry };

/** Every area's cities (largest first), for discovery search (sprint 9); loads the file once. */
export const cityAreas = (): Promise<ReadonlyMap<string, readonly CityRow[]>> => loadAreas();

/** A city's [lon, lat], once the list is loaded (sprint 9 AC-12); null when unknown. */
export const cityPoint = (id: number): [number, number] | null => pointById.get(id) ?? null;
