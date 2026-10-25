/**
 * The sign-in sheet (design 4) and the signed-in account sheet (design 3.2).
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

import { BottomSheet } from '@/components/BottomSheet';
import { InlineNotice } from '@/components/formControls';
import { colors, fonts, layout, radius, type ColorScheme } from '@/theme/tokens';

import { isolateLtr } from '../globe/BoardingPassCard';
import { initialOf } from './AccountButton';
import { useAuth, type AuthUser, type SignInOutcome } from './AuthProvider';
import { GoogleButton } from './GoogleButton';

interface SheetProps {
  visible: boolean;
  colorScheme: ColorScheme;
  reduceMotion: boolean;
  insetsBottom: number;
  onClose: () => void;
}

type SignInMessage = Exclude<SignInOutcome, 'done' | 'abandoned'> | 'expired' | null;

export function SignInSheet({
  visible,
  expired,
  reason = null,
  ...sheet
}: SheetProps & {
  expired: boolean;
  /** Opened by a trips action: the body says why an account is needed (sprint 2 design 2.3, 5.2). */
  reason?: 'newTrip' | 'myTrips' | null;
}) {
  const { t } = useTranslation();
  const { signInWithGoogle, abandonSignIn } = useAuth();
  const palette = colors[sheet.colorScheme];
  const [busy, setBusy] = useState(false);
  // Design 5.5: once Google has answered, the sheet can't be dismissed.
  const [exchanging, setExchanging] = useState(false);
  const [message, setMessage] = useState<SignInMessage>(expired ? 'expired' : null);
  // Each opening starts without the last attempt's message.
  const [openedAs, setOpenedAs] = useState(visible);
  if (openedAs !== visible) {
    setOpenedAs(visible);
    if (visible) setMessage(expired ? 'expired' : null);
  }

  // "No network" is shown as soon as the sheet opens, and clears when it's back.
  useEffect(() => {
    if (!visible) return;
    return NetInfo.addEventListener((state) => {
      setMessage((current) =>
        state.isConnected === false ? 'offline' : current === 'offline' ? null : current,
      );
    });
  }, [visible]);

  const onGoogle = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    const outcome = await signInWithGoogle(() => setExchanging(true));
    setBusy(false);
    setExchanging(false);
    if (outcome === 'done' || outcome === 'abandoned') return;
    setMessage(outcome);
  }, [signInWithGoogle]);

  const close = useCallback(() => {
    if (busy) abandonSignIn();
    sheet.onClose();
  }, [busy, abandonSignIn, sheet]);

  const notice =
    message === 'offline'
      ? t('signIn.offline')
      : message === 'playServicesUnavailable'
        ? t('signIn.playServices')
        : message === 'expired'
          ? t('signIn.expired')
          : message === 'error'
            ? t('signIn.error')
            : null;

  return (
    <BottomSheet
      {...sheet}
      visible={visible}
      dismissable={!exchanging}
      onClose={close}
      testID="sign-in-sheet"
    >
      <Text style={[styles.title, { color: palette.textPrimary }]} accessibilityRole="header">
        {t('signIn.title')}
      </Text>
      <Text style={[styles.body, { color: palette.textSecondary }]}>
        {t(
          reason === 'newTrip'
            ? 'signIn.bodyTrip'
            : reason === 'myTrips'
              ? 'signIn.bodyMyTrips'
              : 'signIn.body',
        )}
      </Text>
      {notice ? (
        <View style={styles.block}>
          <InlineNotice text={notice} colorScheme={sheet.colorScheme} testID="sign-in-notice" />
        </View>
      ) : null}
      <View style={styles.block}>
        <GoogleButton
          colorScheme={sheet.colorScheme}
          busy={busy}
          // Never locked: a press checks Play Services again, so an update counts at once.
          disabled={false}
          onPress={() => void onGoogle()}
        />
      </View>
      {message === 'cancelled' ? (
        <Text
          style={[styles.footnote, { color: palette.textSecondary }]}
          testID="sign-in-cancelled"
        >
          {t('signIn.cancelled')}
        </Text>
      ) : null}
      <Text style={[styles.footnote, { color: palette.textSecondary }]}>{t('signIn.next')}</Text>
    </BottomSheet>
  );
}

export function AccountSheet({ user, ...sheet }: SheetProps & { user: AuthUser }) {
  const { t } = useTranslation();
  const { signOut } = useAuth();
  const palette = colors[sheet.colorScheme];
  const initial = initialOf(user);
  return (
    <BottomSheet {...sheet} testID="account-sheet">
      <View style={styles.accountHead}>
        {initial ? (
          <View style={[styles.avatar, { backgroundColor: palette.primary }]}>
            <Text style={[styles.avatarInitial, { color: palette.onPrimary }]}>{initial}</Text>
          </View>
        ) : null}
        {user.name ? (
          <Text style={[styles.name, { color: palette.textPrimary }]}>{user.name}</Text>
        ) : null}
        {user.email ? (
          <Text style={[styles.email, { color: palette.textSecondary }]}>
            {isolateLtr(user.email)}
          </Text>
        ) : null}
        <Text style={[styles.footnote, { color: palette.textTertiary }]}>
          {t('account.connectedWithGoogle')}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          sheet.onClose();
          void signOut();
        }}
        style={[styles.secondary, { backgroundColor: palette.secondaryBg }]}
        testID="sign-out"
      >
        <Text style={[styles.secondaryLabel, { color: palette.secondaryFg }]}>
          {t('account.signOut')}
        </Text>
      </Pressable>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: fonts.semibold,
    fontSize: 22,
    lineHeight: 28,
    marginTop: 8,
    textAlign: 'left',
  },
  body: {
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 24,
    marginTop: 8,
    textAlign: 'left',
  },
  block: { marginTop: 16 },
  footnote: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 12,
    textAlign: 'left',
  },
  accountHead: { alignItems: 'flex-start', marginTop: 8, gap: 4 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontFamily: fonts.semibold, fontSize: 22, lineHeight: 28 },
  name: {
    fontFamily: fonts.semibold,
    fontSize: 18,
    lineHeight: 24,
    marginTop: 8,
    textAlign: 'left',
  },
  email: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 20, textAlign: 'left' },
  secondary: {
    height: layout.touchTargetMin,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  secondaryLabel: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 24 },
});
