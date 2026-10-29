/**
 * The user's trips as the whole app sees them (sprint 2 F-006): the countries
 * to highlight on the globe (AC-10), and a change counter that tells open
 * lists to reload after a save or a delete. Memory only: nothing about trips
 * is written to the device (design decision 19.2), and it is all dropped the
 * moment the user is no longer signed in (AC-8).
 */
import NetInfo from '@react-native-community/netinfo';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { useAuth } from '@/features/auth/AuthProvider';
import { prefetchFlights } from '@/features/flights/flightsStore';
import { pruneInsuranceReminders } from '@/features/kit/insuranceReminder';
import { kitsOf, prefetchKit } from '@/features/kit/kitStore';
import { passportTripsLoaded } from '@/features/passportAlerts/passportRunner';

import { loadTripCountries, loadTripPage, type Trip } from './tripsApi';
import {
  CACHE_PAST_MAX,
  CACHE_UPCOMING_MAX,
  readTripsCache,
  saveTripsCache,
  tripsCacheGeneration,
  type TripsCache,
} from './tripsCache';
import { useToday } from './useToday';

interface TripsContextValue {
  /** Countries (adm0) with trips; null until loaded, or when signed out or offline at launch. */
  countries: ReadonlySet<string> | null;
  /**
   * Sprint 3 AC-7: the first trip in "upcoming" order (an active trip wins),
   * for the pin; null when there is none, when signed out or offline at launch.
   */
  nextTrip: Trip | null;
  /** Today's local date, kept current (sprint 3 AC-6). */
  today: string;
  /** Grows after every save or delete; lists reload when it changes. */
  changes: number;
  /**
   * A trip was saved or deleted. `country` updates the highlight at once
   * (design 7.5): `has` is whether the country still has trips, when known.
   * The countries are then read again from the server.
   */
  changed: (country?: { adm0: string; has: boolean | null }) => void;
  /** The first countries list of this session arrived (the globe fades the layer in once). */
  firstLoad: boolean;
  /** The globe is up: from now on the countries load (design 7.5, never before the first frame). */
  start: () => void;
  /**
   * Sprint 4 F-015: the trips saved on this device for this user, shown read
   * only while offline; null when there is no copy.
   */
  cache: TripsCache | null;
  /** Offline and showing the saved copy: writes are blocked (AC-14). */
  fromCache: boolean;
}

const TripsContext = createContext<TripsContextValue | null>(null);

export function useTrips(): TripsContextValue {
  const value = useContext(TripsContext);
  if (!value) throw new Error('useTrips must be used inside TripsProvider');
  return value;
}

export function TripsProvider({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const userId = state.status === 'signedIn' ? state.user.id : null;
  const [started, setStarted] = useState(false);
  const [countries, setCountries] = useState<ReadonlySet<string> | null>(null);
  const [nextTrip, setNextTrip] = useState<Trip | null>(null);
  const [cache, setCache] = useState<TripsCache | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const hasCache = useRef(false);
  useEffect(() => {
    hasCache.current = cache !== null;
  }, [cache]);
  const today = useToday();
  /** The date a reload asks with; follows today (below). */
  const todayRef = useRef(today);
  const [changes, setChanges] = useState(0);
  const [firstLoad, setFirstLoad] = useState(false);
  /** Which user a request is for; an answer for anyone else is dropped. */
  const currentUser = useRef<string | null>(userId);
  useEffect(() => {
    currentUser.current = userId;
  }, [userId]);

  // AC-8: no user, no trips. Cleared during render, before anything draws them.
  const [shownFor, setShownFor] = useState(userId);
  if (shownFor !== userId) {
    setShownFor(userId);
    setCountries(null);
    setNextTrip(null);
    setCache(null);
    setFromCache(false);
    setFirstLoad(false);
  }

  /** Only the latest request's answer counts: an older, slower one is dropped. */
  const sequence = useRef(0);
  const reload = useCallback(async () => {
    const forUser = currentUser.current;
    if (!forUser) return;
    const id = ++sequence.current;
    const generation = tripsCacheGeneration();
    // The pin's trip comes with the countries (design 9.4); the upcoming and
    // past pages also fill the offline copy (sprint 4 F-015, AC-12).
    const [result, next, past] = await Promise.all([
      loadTripCountries(),
      loadTripPage({
        section: 'upcoming',
        today: todayRef.current,
        pageSize: CACHE_UPCOMING_MAX + 1,
      }),
      loadTripPage({ section: 'past', today: todayRef.current, pageSize: CACHE_PAST_MAX + 1 }),
    ]);
    if (id !== sequence.current || currentUser.current !== forUser) return;
    if (!result.ok) {
      // Offline: the saved copy, read only, if this user has one (AC-13).
      if (result.reason !== 'offline') {
        // The server answered: not offline, so editing isn't blocked (Raz, S4-m9).
        setFromCache(false);
        return;
      }
      const saved = await readTripsCache(forUser);
      if (id !== sequence.current || currentUser.current !== forUser || !saved) return;
      setCache(saved);
      setFromCache(true);
      setCountries(new Set(saved.countries));
      setNextTrip(saved.nextTrip);
      setFirstLoad(true);
      // Sprint 10 AC-12: offline, the passports are checked against the saved copy.
      void passportTripsLoaded(saved.upcoming);
      return;
    }
    setCountries(result.value);
    // A failed query shows no pin rather than one that may be gone (Dudi m6, Raz m4).
    const nextValue = next.ok ? (next.value.trips[0] ?? null) : null;
    setNextTrip(nextValue);
    setFromCache(false);
    setFirstLoad(true);
    if (next.ok && past.ok) {
      const saved: TripsCache = {
        userId: forUser,
        savedAt: new Date().toISOString(),
        upcoming: next.value.trips.slice(0, CACHE_UPCOMING_MAX),
        past: past.value.trips.slice(0, CACHE_PAST_MAX),
        countries: [...result.value],
        nextTrip: nextValue,
        // One more than kept was asked for: "more" only when it came (Raz, S4-m10).
        full:
          next.value.trips.length > CACHE_UPCOMING_MAX || past.value.trips.length > CACHE_PAST_MAX,
      };
      setCache(saved);
      // Still the same user, and no clear since the queries began: a sign-out in
      // between must not leave a copy (Dudi e2, Raz S4-M1).
      if (currentUser.current === forUser) {
        void saveTripsCache(saved, generation);
        // Sprint 5 (Raz 6): the upcoming trips' flights join the offline copy.
        void prefetchFlights(saved.upcoming.map((trip) => trip.id));
        // Sprint 10 AC-12: a trip created or moved is checked against the passports.
        void passportTripsLoaded(saved.upcoming);
        // Sprint 8: and their hotels and insurance; then reminders of trips now
        // insured, or gone from a complete list, are cancelled (design 11.3).
        const ids = saved.upcoming.map((trip) => trip.id);
        void prefetchKit(ids).then(async () => {
          const kits = await kitsOf(ids);
          await pruneInsuranceReminders(
            new Map(ids.map((id) => [id, { insured: !!kits.get(id)?.insurance }])),
            !saved.full,
          );
        });
      }
    } else if (next.ok && currentUser.current === forUser) {
      // Past trips failed: the upcoming ones are still checked (Dana bug 4).
      void passportTripsLoaded(next.value.trips.slice(0, CACHE_UPCOMING_MAX));
    }
  }, []);
  // A new day changes which trip is next (design 3.4).
  useEffect(() => {
    if (todayRef.current === today) return;
    todayRef.current = today;
    if (started && currentUser.current) void reload();
  }, [today, started, reload]);

  // After the globe is up, and again whenever the network returns.
  useEffect(() => {
    if (!started || !userId) return;
    void reload();
    let wasConnected: boolean | null = null;
    return NetInfo.addEventListener((net) => {
      const connected = net.isConnected === true;
      // The network dropped after a load: the same read-only state (design 10.1).
      if (net.isConnected === false && hasCache.current) setFromCache(true);
      if (wasConnected === false && connected) void reload();
      wasConnected = connected;
    });
  }, [started, userId, reload]);

  const changed = useCallback(
    (country?: { adm0: string; has: boolean | null }) => {
      if (country && country.has !== null) {
        const { adm0, has } = country;
        setCountries((current) => {
          if (!current || current.has(adm0) === has) return current;
          const next = new Set(current);
          if (has) next.add(adm0);
          else next.delete(adm0);
          return next;
        });
      }
      setChanges((n) => n + 1);
      void reload();
    },
    [reload],
  );

  const start = useCallback(() => setStarted(true), []);

  const value = useMemo(
    () => ({ countries, nextTrip, today, changes, changed, firstLoad, start, cache, fromCache }),
    [countries, nextTrip, today, changes, changed, firstLoad, start, cache, fromCache],
  );
  return <TripsContext.Provider value={value}>{children}</TripsContext.Provider>;
}
