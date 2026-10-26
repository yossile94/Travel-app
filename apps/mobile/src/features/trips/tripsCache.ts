/**
 * The trips kept on the device for offline viewing (sprint 4 F-015, AC-12,
 * AC-13; ADR-009). Encrypted like the session (AES-256-CTR, a key per user in
 * SecureStore, the Android Keystore), so a copy of the app's storage or an
 * Android backup reveals nothing without that device's key.
 *
 * Bounded: every upcoming and active trip up to 50, and the 20 latest that
 * ended, with their travelers and cities; the countries to highlight and the
 * next trip, for the pin. Shown only to the user it was saved for, and removed
 * on every way out: sign-out, a sign-out the user didn't make, account
 * deletion (and so before another user signs in).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { secureSessionStorage } from '@/lib/secureSessionStorage';

import type { Trip } from './tripsApi';

export const CACHE_UPCOMING_MAX = 50;
export const CACHE_PAST_MAX = 20;

const PREFIX = 'trips-cache.';

export interface TripsCache {
  userId: string;
  /** When these came from the server (ISO). */
  savedAt: string;
  upcoming: Trip[];
  past: Trip[];
  countries: string[];
  nextTrip: Trip | null;
  /** The upcoming or past list was cut at its limit: more exist online. */
  full: boolean;
}

const keyOf = (userId: string) => `${PREFIX}${userId}`;

export async function saveTripsCache(cache: TripsCache): Promise<void> {
  const value: TripsCache = {
    ...cache,
    upcoming: cache.upcoming.slice(0, CACHE_UPCOMING_MAX),
    past: cache.past.slice(0, CACHE_PAST_MAX),
  };
  try {
    await secureSessionStorage.setItem(keyOf(cache.userId), JSON.stringify(value));
  } catch (error) {
    // A cache that can't be written is only a missing offline copy.
    console.warn('[trips] cache write failed', (error as Error)?.name);
  }
}

/** The user's own copy, or null (none, unreadable, or someone else's). */
export async function readTripsCache(userId: string): Promise<TripsCache | null> {
  try {
    const text = await secureSessionStorage.getItem(keyOf(userId));
    if (!text) return null;
    const cache = JSON.parse(text) as TripsCache;
    return cache.userId === userId ? cache : null;
  } catch {
    return null;
  }
}

/** Every user's copy and its key (sign-out, deletion: AC-13). */
export async function clearTripsCaches(): Promise<void> {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(PREFIX));
    await Promise.all(keys.map((key) => secureSessionStorage.removeItem(key).catch(() => {})));
  } catch {
    // Nothing stored, or storage unavailable: nothing to clear.
  }
}

/** When the copy was saved, for "מוצג מהשמירה האחרונה · {{when}}" (design 10.2). */
export function cachedWhen(
  savedAt: string,
  t: (key: string, options?: Record<string, unknown>) => string,
  now = new Date(),
): string {
  const saved = new Date(savedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const time = `\u2066${pad(saved.getHours())}:${pad(saved.getMinutes())}\u2069`;
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(saved)) / 86_400_000);
  if (days === 0) return t('offline.whenToday', { time });
  if (days === 1) return t('offline.whenYesterday', { time });
  return `\u2066${saved.getDate()}.${saved.getMonth() + 1}.${saved.getFullYear()}\u2069`;
}
