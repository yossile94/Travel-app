/**
 * Sprint 6 AC-5, AC-5א: a tapped flight alert opens that flight; an alert
 * that arrives while the app is open shows as a banner and refreshes its
 * trip. The alert that cold-started the app is read once, only after the
 * session and the trips are ready (Raz 8), and never again: its id is kept
 * on the device (design 4.1).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';

import { refreshTripOf } from '@/features/flights/flightsStore';

import { flightIdOf } from './push';

const HANDLED_KEY = 'push.handledResponseId';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** What the alert said: shown over an offline copy that predates it (design 4.4). */
export interface AlertText {
  title: string;
  body: string;
}

/** Ids taken in this run, marked before any await: the getter and the listener never both open it. */
const taken = new Set<string>();

async function alreadyHandled(id: string): Promise<boolean> {
  if (taken.has(id)) return true;
  return (await AsyncStorage.getItem(HANDLED_KEY).catch(() => null)) === id;
}

/**
 * A launch from an alert not yet handled: the active trip doesn't open by
 * itself (design 4.1 step 4). An alert handled before doesn't count (Raz review 8).
 */
export async function launchedFromAlert(): Promise<boolean> {
  const response = Notifications.getLastNotificationResponse();
  const id = response?.notification.request.identifier;
  return !!id && flightIdOf(response) !== null && !(await alreadyHandled(id));
}

export function usePushOpen({
  ready,
  signedIn,
  onOpen,
  onSignedOut,
}: {
  /** The session is settled: signed in with the trips loaded, or signed out. */
  ready: boolean;
  signedIn: boolean;
  onOpen: (flightId: string, text: AlertText) => void;
  /** A tap while signed out: the flight can't be shown (design 4.3). */
  onSignedOut: () => void;
}): void {
  const handlers = useRef({ onOpen, onSignedOut, signedIn });
  useEffect(() => {
    handlers.current = { onOpen, onSignedOut, signedIn };
  }, [onOpen, onSignedOut, signedIn]);

  useEffect(() => {
    if (!ready) return;
    let current = true;
    const handle = async (response: Notifications.NotificationResponse | null | undefined) => {
      const id = response?.notification.request.identifier;
      if (!response || !id || taken.has(id)) return;
      taken.add(id);
      const handled = (await AsyncStorage.getItem(HANDLED_KEY).catch(() => null)) === id;
      if (handled) return;
      if (!current) {
        // Unmounted before it was handled: the next mount takes it.
        taken.delete(id);
        return;
      }
      await AsyncStorage.setItem(HANDLED_KEY, id).catch(() => {});
      const flightId = flightIdOf(response);
      if (!flightId) {
        console.warn('[push] push_open_bad_payload');
        return;
      }
      if (!handlers.current.signedIn) {
        handlers.current.onSignedOut();
        return;
      }
      const content = response.notification.request.content;
      handlers.current.onOpen(flightId, { title: content.title ?? '', body: content.body ?? '' });
    };
    void handle(Notifications.getLastNotificationResponse());
    const tapped = Notifications.addNotificationResponseReceivedListener((r) => void handle(r));
    const received = Notifications.addNotificationReceivedListener((n) => {
      const data = n.request.content.data as { type?: string; flightId?: unknown } | undefined;
      if (data?.type === 'flight_change' && typeof data.flightId === 'string') {
        refreshTripOf(data.flightId);
      }
    });
    return () => {
      current = false;
      tapped.remove();
      received.remove();
    };
  }, [ready]);
}
