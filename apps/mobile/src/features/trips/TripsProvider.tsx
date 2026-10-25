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

import { loadTripCountries } from './tripsApi';

interface TripsContextValue {
  /** Countries (adm0) with trips; null until loaded, or when signed out or offline at launch. */
  countries: ReadonlySet<string> | null;
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
    setFirstLoad(false);
  }

  /** Only the latest request's answer counts: an older, slower one is dropped. */
  const sequence = useRef(0);
  const reload = useCallback(async () => {
    const forUser = currentUser.current;
    if (!forUser) return;
    const id = ++sequence.current;
    const result = await loadTripCountries();
    if (id !== sequence.current || currentUser.current !== forUser || !result.ok) return;
    setCountries(result.value);
    setFirstLoad(true);
  }, []);

  // After the globe is up, and again whenever the network returns.
  useEffect(() => {
    if (!started || !userId) return;
    void reload();
    let wasConnected: boolean | null = null;
    return NetInfo.addEventListener((net) => {
      const connected = net.isConnected === true;
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
    () => ({ countries, changes, changed, firstLoad, start }),
    [countries, changes, changed, firstLoad, start],
  );
  return <TripsContext.Provider value={value}>{children}</TripsContext.Provider>;
}
