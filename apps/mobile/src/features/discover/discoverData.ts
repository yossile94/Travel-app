/**
 * The bundled data discovery search runs on (sprint 9, Raz: preloaded when
 * the chips first show, and indexed by adm0 once). The climate file is
 * required; without the city list the rules still run on the climate points
 * alone, quietly (design 8.8).
 */
import { useCallback, useEffect, useState } from 'react';

import { loadClimate, type Climate } from '@/features/climate/climateData';
import { allCountries } from '@/features/globe/countryData';
import { cityAreas } from '@/features/trips/citiesData';
import type { CityRow } from '@/features/trips/citySearch';

import { BARRED } from './barred';
import { CITY_MIN_POPULATION, type ClimatePoint, type DiscoverInput } from './discover';
import { LANDLOCKED } from './landlocked';

/** Everything but the advisories, which change with the device copy. */
export type DiscoverBase = Omit<DiscoverInput, 'advisories'>;

/** The per-area points, built once from the two files (Raz: an index, not a scan per tap). */
export function buildBase(
  climate: Climate,
  areas: ReadonlyMap<string, readonly CityRow[]> | null,
): DiscoverBase {
  const index = new Map<string, ClimatePoint[]>();
  for (const { adm0 } of allCountries) {
    const area = climate.area(adm0);
    if (!area) continue;
    const points: ClimatePoint[] = [
      { temps: area.normals, wet: climate.areaWet(adm0), city: null },
    ];
    // Largest first in the file; only cities that may count (Raz 8).
    for (const [id, nameHe, nameEn, , population] of areas?.get(adm0) ?? []) {
      if (population < CITY_MIN_POPULATION) break;
      const temps = climate.city(id);
      if (temps) {
        points.push({ temps, wet: climate.cityWet(id), city: { id, nameHe, nameEn, population } });
      }
    }
    index.set(adm0, points);
  }
  return {
    countries: allCountries,
    pointsOf: (adm0) => index.get(adm0) ?? [],
    landlocked: LANDLOCKED,
    banned: BARRED,
  };
}

export type DiscoverDataState =
  { status: 'idle' | 'loading' | 'failed' } | { status: 'ready'; base: DiscoverBase };

let cached: DiscoverBase | null = null;
let pending: Promise<DiscoverBase> | null = null;

function loadBase(): Promise<DiscoverBase> {
  pending ??= Promise.all([loadClimate(), cityAreas().catch(() => null)])
    .then(([climate, areas]) => {
      cached = buildBase(climate, areas);
      return cached;
    })
    .catch((error: unknown) => {
      pending = null;
      throw error;
    });
  return pending;
}

/** Starts loading once `enabled` (the chips are on screen), then keeps the index for the session. */
export function useDiscoverData(enabled: boolean): DiscoverDataState & { retry: () => void } {
  const [base, setBase] = useState<DiscoverBase | null>(cached);
  // The attempt that failed; a retry starts a new one.
  const [failedAttempt, setFailedAttempt] = useState(-1);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled || base) return;
    let live = true;
    loadBase().then(
      (loaded) => live && setBase(loaded),
      (error: unknown) => {
        console.warn('[discover] data_load_failed', (error as Error)?.name);
        if (live) setFailedAttempt(attempt);
      },
    );
    return () => {
      live = false;
    };
  }, [enabled, base, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  if (base) return { status: 'ready', base, retry };
  if (!enabled) return { status: 'idle', retry };
  return { status: failedAttempt === attempt ? 'failed' : 'loading', retry };
}
