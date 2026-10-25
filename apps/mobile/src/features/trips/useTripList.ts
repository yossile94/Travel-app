/**
 * One list of trips, read page by page (sprint 2 AC-4, AC-5): "upcoming"
 * until it ends, then "past", so the order on screen is always right.
 * Used by the country card (one country) and by "My trips" (all of them).
 * Memory only (design 19.2); reloads when a trip changes or the network
 * returns, and keeps what it has when the network drops (5.2).
 */
import NetInfo from '@react-native-community/netinfo';
import { useCallback, useEffect, useRef, useState } from 'react';

import { motion } from '@/theme/tokens';

import { todayPg } from './tripDates';
import { loadTripPage, type Trip, type TripCursor, type TripSection } from './tripsApi';

export type TripListStatus =
  /** Nothing asked: signed out, or the answer is known without asking (design 2.2). */
  | 'idle'
  | 'loading'
  | 'ready'
  | 'offline'
  | 'error';

export interface TripListState {
  status: TripListStatus;
  upcoming: Trip[];
  past: Trip[];
  /** More pages exist (in either section). */
  hasMore: boolean;
  /** A later page is loading. */
  loadingMore: boolean;
  /** A later page failed; the rows already shown stay. */
  moreError: boolean;
  /** The first page took longer than the skeleton delay (design 5.2: no flash). */
  showSkeleton: boolean;
  /** The network dropped after rows were shown (design 5.2). */
  offlineStale: boolean;
}

const EMPTY: TripListState = {
  status: 'idle',
  upcoming: [],
  past: [],
  hasMore: false,
  loadingMore: false,
  moreError: false,
  showSkeleton: false,
  offlineStale: false,
};

const LOADING: TripListState = { ...EMPTY, status: 'loading' };

interface Position {
  section: TripSection;
  cursor: TripCursor | null;
  done: boolean;
}

type PastPage = { trips: Trip[]; next: TripCursor | null };

/**
 * @param enabled false: no request, an empty list (signed out, or the
 *   countries set already says this country has no trips: design 2.2).
 * @param reloadKey Changes after a save or delete: everything is read again.
 * @param parallelFirstPage "My trips" asks for both sections' first page at
 *   once (design 5.1); past rows show only after upcoming ends.
 */
export function useTripList({
  enabled,
  countryAdm0,
  reloadKey,
  parallelFirstPage = false,
}: {
  enabled: boolean;
  countryAdm0?: string;
  reloadKey: number;
  parallelFirstPage?: boolean;
}) {
  const [state, setState] = useState<TripListState>(enabled ? LOADING : EMPTY);
  // AC-8: disabled (signed out) empties the list during render, before it draws.
  const [wasEnabled, setWasEnabled] = useState(enabled);
  if (wasEnabled !== enabled) {
    setWasEnabled(enabled);
    setState(enabled ? LOADING : EMPTY);
  }
  const position = useRef<Position>({ section: 'upcoming', cursor: null, done: true });
  /** A past page fetched early (parallel first page), shown once upcoming ends. */
  const pastFirst = useRef<PastPage | null>(null);
  const request = useRef(0);
  const busy = useRef(false);

  /** Reads the first page(s). Sets state only after answers arrive. */
  const fetchFirst = useCallback(async () => {
    const id = ++request.current;
    busy.current = true;
    const today = todayPg();
    pastFirst.current = null;
    const skeleton = setTimeout(() => {
      if (request.current === id) setState((s) => ({ ...s, showSkeleton: s.status === 'loading' }));
    }, motion.skeletonDelay);

    const [upcoming, past] = await Promise.all([
      loadTripPage({ section: 'upcoming', today, countryAdm0 }),
      parallelFirstPage ? loadTripPage({ section: 'past', today, countryAdm0 }) : null,
    ]);
    if (request.current !== id) return;
    if (!upcoming.ok) {
      clearTimeout(skeleton);
      busy.current = false;
      setState((s) =>
        s.status === 'ready' && upcoming.reason === 'offline'
          ? { ...s, offlineStale: true }
          : { ...EMPTY, status: upcoming.reason },
      );
      return;
    }
    let firstPast: PastPage | null = past && past.ok ? past.value : null;
    if (!upcoming.value.next && !firstPast) {
      // Upcoming ended in one page: past follows at once.
      const read = await loadTripPage({ section: 'past', today, countryAdm0 });
      if (request.current !== id) return;
      if (!read.ok) {
        clearTimeout(skeleton);
        busy.current = false;
        setState({ ...EMPTY, status: read.reason });
        return;
      }
      firstPast = read.value;
    }
    clearTimeout(skeleton);
    busy.current = false;
    let rowsPast: Trip[] = [];
    if (upcoming.value.next) {
      position.current = { section: 'upcoming', cursor: upcoming.value.next, done: false };
      pastFirst.current = firstPast;
    } else {
      rowsPast = firstPast!.trips;
      position.current = { section: 'past', cursor: firstPast!.next, done: firstPast!.next === null };
    }
    setState({
      ...EMPTY,
      status: 'ready',
      upcoming: upcoming.value.trips,
      past: rowsPast,
      hasMore: !position.current.done,
    });
  }, [countryAdm0, parallelFirstPage]);

  /** "Try again" after a failed first load. */
  const reload = useCallback(() => {
    setState(LOADING);
    void fetchFirst();
  }, [fetchFirst]);

  const loadMore = useCallback(async () => {
    if (busy.current || position.current.done) return;
    const id = request.current;
    busy.current = true;
    setState((s) => ({ ...s, loadingMore: true, moreError: false }));
    const today = todayPg();
    // Usually one page; two when upcoming ends exactly at a page boundary.
    for (;;) {
      const at = position.current;
      const page = await loadTripPage({ section: at.section, today, cursor: at.cursor, countryAdm0 });
      if (request.current !== id) return;
      if (!page.ok) {
        busy.current = false;
        setState((s) => ({ ...s, loadingMore: false, moreError: true }));
        return;
      }
      const sectionDone = page.value.next === null;
      // Upcoming just ended: the past page fetched at the start (if any) follows.
      const first = at.section === 'upcoming' && sectionDone ? pastFirst.current : null;
      position.current =
        at.section === 'past'
          ? { section: 'past', cursor: page.value.next, done: sectionDone }
          : !sectionDone
            ? { section: 'upcoming', cursor: page.value.next, done: false }
            : first
              ? { section: 'past', cursor: first.next, done: first.next === null }
              : { section: 'past', cursor: null, done: false };
      const readPastNow = at.section === 'upcoming' && sectionDone && !first;
      setState((s) => ({
        ...s,
        [at.section]: [...s[at.section], ...page.value.trips],
        ...(first ? { past: first.trips } : null),
        loadingMore: readPastNow,
        hasMore: !position.current.done,
      }));
      if (!readPastNow) break;
    }
    busy.current = false;
  }, [countryAdm0]);

  // Disabled: answers still in flight are dropped.
  useEffect(() => {
    if (enabled) return;
    request.current += 1;
    busy.current = false;
    position.current = { section: 'upcoming', cursor: null, done: true };
  }, [enabled]);

  useEffect(() => {
    // fetchFirst sets state only once the server has answered (after an await).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (enabled) void fetchFirst();
  }, [enabled, reloadKey, fetchFirst]);

  // Network back: offline lists load by themselves (AC-7); stale ones refresh.
  useEffect(() => {
    if (!enabled) return;
    let wasConnected: boolean | null = null;
    return NetInfo.addEventListener((net) => {
      const connected = net.isConnected === true;
      if (wasConnected === false && connected) {
        setState((s) => (s.status === 'offline' ? LOADING : s));
        void fetchFirst();
      } else if (wasConnected === true && !connected) {
        setState((s) => (s.status === 'ready' ? { ...s, offlineStale: true } : s));
      }
      wasConnected = connected;
    });
  }, [enabled, fetchFirst]);

  return { state, reload, loadMore };
}
