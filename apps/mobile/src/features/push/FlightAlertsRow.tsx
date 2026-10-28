/**
 * "Flight alerts" in the account sheet (sprint 6 design 6, AC-7): the switch
 * says whether this device gets alerts, the line under it says why. Checked
 * on every opening and every return to the foreground, never on a timer.
 */
import { useNetInfo } from '@react-native-community/netinfo';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  AppState,
  Linking,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { InlineNotice } from '@/components/formControls';
import { BellIcon } from '@/components/icons';
import { colors, fonts, type ColorScheme } from '@/theme/tokens';

import {
  allowPush,
  channelEnabled,
  consentPending,
  explainerState,
  flightAlertsOn,
  permissionState,
  pushRowState,
  registerDevice,
  setFlightAlerts,
  tokenRegistered,
  type PushRow,
} from './push';

const STATUS: Record<Exclude<PushRow, 'loading'>, string> = {
  never_asked: 'account.flightAlerts.neverAsked',
  on: 'account.flightAlerts.on',
  off: 'account.flightAlerts.off',
  blocked: 'account.flightAlerts.blocked',
  not_connected: 'account.flightAlerts.notConnected',
};

export function FlightAlertsRow({
  userId,
  visible,
  colorScheme,
}: {
  userId: string;
  /** The sheet is open: read the state again. */
  visible: boolean;
  colorScheme: ColorScheme;
}) {
  const { t, i18n } = useTranslation();
  const p = colors[colorScheme];
  const net = useNetInfo();
  const offline = net.isConnected === false;
  const [row, setRow] = useState<PushRow>('loading');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** Sent to the settings from this row: coming back allowed turns alerts on (design 6.2). */
  const toSettings = useRef(false);

  const read = useCallback(async () => {
    const [flightAlerts, permission, channel, token, pending, asked] = await Promise.all([
      flightAlertsOn(userId),
      permissionState(),
      channelEnabled(),
      tokenRegistered(userId),
      consentPending(userId),
      explainerState(userId),
    ]);
    const next = pushRowState({
      flightAlerts,
      permission,
      channelEnabled: channel,
      tokenRegistered: token,
      consentPending: pending,
      allowedHere: asked.allowed,
    });
    return { next, permission, channel };
  }, [userId]);

  /** 'failed': back from the settings allowed, but the switch didn't save. */
  const refresh = useCallback(async (): Promise<'ok' | 'failed'> => {
    const { next, permission, channel } = await read();
    if (toSettings.current && permission === 'granted' && channel) {
      toSettings.current = false;
      const saved = await setFlightAlerts(userId, true);
      if (saved) await registerDevice(userId, i18n.language);
      setRow((await read()).next);
      if (!saved) return 'failed';
      AccessibilityInfo.announceForAccessibility(t('account.flightAlerts.turnedOn'));
      return 'ok';
    }
    toSettings.current = false;
    setRow(next);
    return 'ok';
  }, [read, userId, i18n.language, t]);

  useEffect(() => {
    if (!visible) return;
    const run = () =>
      void refresh().then((r) => r === 'failed' && setNotice(t('account.flightAlerts.saveError')));
    run();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && run());
    return () => sub.remove();
  }, [visible, refresh, t]);

  const press = async () => {
    setNotice(null);
    if (row === 'blocked') {
      toSettings.current = true;
      void Linking.openSettings();
      return;
    }
    if (row === 'loading' || busy) return;
    if (offline) {
      setNotice(t('account.flightAlerts.offline'));
      return;
    }
    const before = row;
    const turningOn = before === 'off' || before === 'never_asked';
    // Optimistic: the switch moves at once (design 6.3).
    setRow(turningOn ? 'on' : 'off');
    setBusy(true);
    let ok: boolean;
    if (before === 'never_asked') {
      // The row is the context: the system prompt straight away (design 6.2).
      const result = await allowPush(userId, i18n.language, {
        name: t('push.channel.name'),
        description: t('push.channel.description'),
      });
      ok = true;
      if (result !== 'on') {
        setBusy(false);
        setRow((await read()).next);
        return;
      }
    } else {
      ok = await setFlightAlerts(userId, turningOn);
      if (ok && turningOn) await registerDevice(userId, i18n.language);
    }
    setBusy(false);
    if (!ok) {
      setRow(before);
      setNotice(t('account.flightAlerts.saveError'));
      return;
    }
    setRow((await read()).next);
    AccessibilityInfo.announceForAccessibility(
      t(turningOn ? 'account.flightAlerts.turnedOn' : 'account.flightAlerts.turnedOff'),
    );
  };

  const checked = row === 'on' || row === 'not_connected';
  const blocked = row === 'blocked' || (offline && row !== 'loading');
  const status = row === 'loading' ? null : t(STATUS[row]);

  return (
    <View>
      <Pressable
        accessibilityRole={row === 'blocked' ? 'button' : 'switch'}
        accessibilityLabel={
          row === 'blocked'
            ? t('account.flightAlerts.blockedA11y')
            : t('account.flightAlerts.label')
        }
        accessibilityHint={
          row === 'blocked' ? t('account.flightAlerts.blockedHint') : (status ?? undefined)
        }
        accessibilityState={{ checked, disabled: row === 'loading', busy }}
        accessibilityValue={{ text: row }}
        onPress={() => void press()}
        style={({ pressed }) => [styles.row, pressed && { backgroundColor: p.pressed }]}
        testID="account-flight-alerts"
      >
        <BellIcon color={p.textSecondary} />
        <View style={styles.grow}>
          <Text style={[styles.body, { color: p.textPrimary }]}>
            {t('account.flightAlerts.label')}
          </Text>
          {status ? (
            <Text
              style={[styles.footnote, { color: row === 'blocked' ? p.link : p.textSecondary }]}
              testID="account-flight-alerts-status"
            >
              {status}
            </Text>
          ) : (
            <View
              style={[styles.skeleton, { backgroundColor: p.skeleton }]}
              testID="account-flight-alerts-skeleton"
            />
          )}
        </View>
        <Switch
          value={checked}
          disabled={row === 'loading'}
          onValueChange={() => void press()}
          trackColor={{ false: p.borderControl, true: p.primary }}
          thumbColor={checked ? p.onPrimary : colorScheme === 'dark' ? p.textPrimary : '#FFFFFF'}
          style={blocked ? styles.blocked : undefined}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        />
      </Pressable>
      {notice ? (
        <InlineNotice
          text={notice}
          colorScheme={colorScheme}
          testID="account-flight-alerts-notice"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingVertical: 8,
  },
  grow: { flex: 1, gap: 2 },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, textAlign: 'left' },
  footnote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, textAlign: 'left' },
  skeleton: { width: 160, height: 12, borderRadius: 6, marginTop: 4 },
  blocked: { opacity: 0.5 },
});
