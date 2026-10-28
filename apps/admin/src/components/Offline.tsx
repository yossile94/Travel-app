'use client';

import { useSyncExternalStore } from 'react';

const subscribe = (cb: () => void) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
};

/** Design 25.5: the panel needs the network; it says so when it's gone. */
export function Offline({ text }: { text: string }) {
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
  if (online) return null;
  return (
    <div className="notice" role="status" data-testid="admin-offline">
      {text}
    </div>
  );
}

/** For save buttons: disabled while offline (design 25.5). */
export function useOnline() {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}
