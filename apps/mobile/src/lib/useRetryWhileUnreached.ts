/**
 * v0.14.1 (Raz's review of PR 30): a load that ended "offline" while the device
 * says it is connected (a Wi-Fi with no internet, a timeout, a server that
 * didn't answer) gets no NetInfo "back online" event, so it would stay on the
 * device copy, read only, until the app restarts. While `active`, this tries
 * again every RETRY_MS and whenever the app comes back to the front, as long
 * as NetInfo says connected.
 */
import NetInfo from '@react-native-community/netinfo';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

export const RETRY_MS = 30_000;

export function useRetryWhileUnreached(active: boolean, retry: () => void) {
  const latest = useRef(retry);
  useEffect(() => {
    latest.current = retry;
  }, [retry]);
  useEffect(() => {
    if (!active) return;
    const tryAgain = () =>
      void NetInfo.fetch()
        .then((net) => {
          if (net.isConnected === true) latest.current();
        })
        .catch(() => {});
    const timer = setInterval(tryAgain, RETRY_MS);
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') tryAgain();
    });
    return () => {
      clearInterval(timer);
      app.remove();
    };
  }, [active]);
}
