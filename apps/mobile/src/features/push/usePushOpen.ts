/**
 * Sprint 6 AC-5, AC-5א: a tapped flight alert opens that flight; an alert
 * that arrives while the app is open shows as a banner and refreshes the
 * open trips. The alert that cold-started the app is read once, only after
 * the session and the trips are ready (Raz 8), and never again: its id is
 * kept on the device (design 4.1).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';

import { refreshOpenTrips } from '@/features/flights/flightsStore';

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

/** A launch from an alert: the active trip doesn't open by itself (design 4.1 step 4). */
export function launchedFromAlert(): boolean {
  return flightIdOf(Notifications.getLastNotificationResponse()) !== null;
}

export function usePushOpen(
  ready: boolean,
  onOpen: (flightId: string, text: AlertText) => void,
): void {
  const open = useRef(onOpen);
  useEffect(() => {
    open.current = onOpen;
  }, [onOpen]);

  useEffect(() => {
    if (!ready) return;
    let current = true;
    const handle = async (response: Notifications.NotificationResponse | null | undefined) => {
      const flightId = flightIdOf(response);
      const id = response?.notification.request.identifier;
      if (!response || !id) return;
      // Once: a later launch or a return to the foreground never replays it.
      const handled = await AsyncStorage.getItem(HANDLED_KEY).catch(() => null);
      if (!current || handled === id) return;
      await AsyncStorage.setItem(HANDLED_KEY, id).catch(() => {});
      if (!flightId) {
        console.warn('[push] push_open_bad_payload');
        return;
      }
      const content = response.notification.request.content;
      open.current(flightId, { title: content.title ?? '', body: content.body ?? '' });
    };
    void handle(Notifications.getLastNotificationResponse());
    const tapped = Notifications.addNotificationResponseReceivedListener((r) => void handle(r));
    const received = Notifications.addNotificationReceivedListener((n) => {
      if ((n.request.content.data as { type?: string } | undefined)?.type === 'flight_change') {
        refreshOpenTrips();
      }
    });
    return () => {
      current = false;
      tapped.remove();
      received.remove();
    };
  }, [ready]);
}
