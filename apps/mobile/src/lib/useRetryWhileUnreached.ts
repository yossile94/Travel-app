/**
 * v0.14.1 (Raz's review of PR 30): a load that ended "offline" while the device
 * says it is connected (a Wi-Fi with no internet, a timeout, a server that
 * didn't answer) gets no NetInfo "back online" event, so it would stay on the
 * device copy, read only, until the app restarts. While `active`, this tries
 * again on a backoff and whenever the app comes back to the front, as long as
 * NetInfo says connected. The network coming back is the callers' own NetInfo
 * listener (TripsProvider, useTripList).
 *
 * Sprint 14 AC-11 (Raz, PR 30): the wait grows from RETRY_MS to MAX_RETRY_MS
 * with jitter, so tens of thousands of devices don't hit a struggling server
 * in step. Coming back to the front tries at once and starts the backoff over.
 */
import NetInfo from '@react-native-community/netinfo';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

export const RETRY_MS = 30_000;
export const MAX_RETRY_MS = 5 * 60_000;

/**
 * The wait before try number `attempt` (0-based): RETRY_MS doubled each time up
 * to MAX_RETRY_MS, then a random point in its upper half ("equal jitter"), so
 * it never drops below half the step.
 */
export function retryDelay(attempt: number, random: () => number = Math.random): number {
  const step = Math.min(MAX_RETRY_MS, RETRY_MS * 2 ** Math.max(0, attempt));
  return Math.round(step / 2 + random() * (step / 2));
}

export function useRetryWhileUnreached(active: boolean, retry: () => void) {
  const latest = useRef(retry);
  useEffect(() => {
    latest.current = retry;
  }, [retry]);
  useEffect(() => {
    if (!active) return;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tryAgain = () =>
      void NetInfo.fetch()
        .then((net) => {
          if (net.isConnected === true) latest.current();
        })
        .catch(() => {});
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        attempt += 1;
        tryAgain();
        schedule();
      }, retryDelay(attempt));
    };
    const now = () => {
      attempt = 0;
      tryAgain();
      schedule();
    };
    schedule();
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') now();
    });
    return () => {
      clearTimeout(timer);
      app.remove();
    };
  }, [active]);
}
