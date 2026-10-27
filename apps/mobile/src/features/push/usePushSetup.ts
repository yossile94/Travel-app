/**
 * Flight alerts on the globe screen (sprint 6 design 2, 3.4): the channel in
 * the app's language, the consent and this device's token sent when the
 * server can take them, and when to offer the explainer.
 */
import { useNetInfo } from '@react-native-community/netinfo';
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState } from 'react-native';

import { hasFlightNumber } from '@/features/flights/flightsStore';
import { supabase } from '@/lib/supabase';

import { sampleNumber } from './PushExplainer';
import {
  allowPush,
  ensureChannel,
  explainerState,
  flightAlertsOn,
  permissionState,
  recordShown,
  registerDevice,
  shouldOfferPush,
  signedInAgain,
  syncConsent,
  systemPrompts,
} from './push';

/** After the globe and the trips, if nothing was touched (design 2.3). */
const LAUNCH_DELAY_MS = 1500;
const DAY_MS = 24 * 60 * 60_000;

/** A flight still tracked (or to be): the launch trigger (design 2.2 b). */
async function hasTrackedFlight(): Promise<boolean> {
  if (!supabase) return false;
  const since = new Date(Date.now() - DAY_MS).toISOString().slice(0, 10);
  const { count, error } = await supabase
    .from('flights')
    .select('id', { count: 'exact', head: true })
    .not('watch_id', 'is', null)
    .gte('dep_date_local', since);
  return !error && (count ?? 0) > 0;
}

export function usePushSetup({
  userId,
  ready,
  quiet,
  onToast,
}: {
  /** Signed in: the user; else null. */
  userId: string | null;
  /** The globe and the trips are up, and no consent screen (design 2.3). */
  ready: boolean;
  /** No other sheet, form or search on screen. */
  quiet: boolean;
  onToast: (text: string, long?: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const net = useNetInfo();
  const [visible, setVisible] = useState(false);
  const [number, setNumber] = useState('LY81');
  const [androidNote, setAndroidNote] = useState(false);
  const shownThisSession = useRef(false);
  /** A trigger came while something else was open: it waits for the next quiet moment (Raz review 5). */
  const [waiting, setWaiting] = useState(false);
  const quietRef = useRef(quiet);
  useEffect(() => {
    quietRef.current = quiet;
  }, [quiet]);

  // Signed in (again): this device may register; a new token registers at once (AC-2).
  useEffect(() => {
    if (!userId) return;
    signedInAgain();
    const sub = Notifications.addPushTokenListener(
      () => void registerDevice(userId, i18n.language, true),
    );
    return () => sub.remove();
  }, [userId, i18n.language]);

  // The channel first, in the app's language; a language change renames it (design 3.4).
  useEffect(() => {
    void ensureChannel(t('push.channel.name'), t('push.channel.description')).catch(() => {});
  }, [t, i18n.language]);

  // The consent and the token, on sign-in, on coming back online and to the foreground.
  const online = net.isConnected !== false;
  useEffect(() => {
    if (!userId || !online) return;
    void syncConsent(userId, i18n.language);
    const sub = AppState.addEventListener(
      'change',
      (s) => s === 'active' && void syncConsent(userId, i18n.language),
    );
    return () => sub.remove();
  }, [userId, online, i18n.language]);

  const offer = useCallback(async () => {
    if (!userId) return;
    const [asked, permission, flightAlerts] = await Promise.all([
      explainerState(userId),
      permissionState(),
      flightAlertsOn(userId),
    ]);
    const show = shouldOfferPush({
      trigger: true,
      flightAlerts,
      allowedHere: asked.allowed,
      shown: asked.shown,
      permission,
      shownThisSession: shownThisSession.current,
      quiet: true,
    });
    if (!show) return;
    if (!quietRef.current) {
      setWaiting(true);
      return;
    }
    setWaiting(false);
    shownThisSession.current = true;
    await recordShown(userId);
    setNumber(sampleNumber(hasFlightNumber));
    setAndroidNote(systemPrompts() && permission !== 'granted');
    setVisible(true);
  }, [userId]);

  useEffect(() => {
    if (!waiting || !quiet || !userId) return;
    const timer = setTimeout(() => void offer(), 400);
    return () => clearTimeout(timer);
  }, [waiting, quiet, userId, offer]);

  // The launch trigger: once, when everything is up and the user has a tracked flight.
  const launchDecided = useRef(false);
  useEffect(() => {
    if (!ready || !userId || launchDecided.current) return;
    launchDecided.current = true;
    const timer = setTimeout(() => {
      void hasTrackedFlight().then((tracked) => tracked && void offer());
    }, LAUNCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [ready, userId, offer]);
  useEffect(() => {
    if (!userId) {
      launchDecided.current = false;
      shownThisSession.current = false;
    }
  }, [userId]);

  const allow = useCallback(async () => {
    if (!userId) return;
    const result = await allowPush(userId, i18n.language, {
      name: t('push.channel.name'),
      description: t('push.channel.description'),
    });
    setVisible(false);
    if (result === 'on') onToast(t('push.allowed'));
    else if (result === 'refused') onToast(t('push.denied'), true);
    else onToast(t('push.blockedOnAllow'), true);
  }, [userId, i18n.language, t, onToast]);

  const later = useCallback(() => setVisible(false), []);

  return { visible, number, androidNote, offer, allow, later };
}
