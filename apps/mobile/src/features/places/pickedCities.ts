/**
 * D20 (design 3.7.1): the city picked in "What to see", per country and trip,
 * for this session only — never sent, never written to the device.
 */
import type { CityEntry } from '@/features/trips/citySearch';

export interface Picked {
  key: string;
  searched: CityEntry | null;
}

const picked = new Map<string, Picked>();

export const pickedCity = (key: string): Picked | null => picked.get(key) ?? null;
export const rememberCity = (key: string, value: Picked) => void picked.set(key, value);

/** Sign-out, account deletion and tests: the session's picks go. */
export function forgetPickedCities() {
  picked.clear();
}
