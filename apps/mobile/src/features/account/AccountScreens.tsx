/**
 * Screens pushed from the account sheet (sprint 2 design 9, 11): "My
 * consents" and account deletion, plus the pieces they share. A pushed screen
 * enters from the end side (left in Hebrew) over the sheet, which stays.
 */
import NetInfo from '@react-native-community/netinfo';
import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  ActivityIndicator,
  I18nManager,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  findNodeHandle,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Button } from '@/components/fields';
import { CheckboxRow, InlineNotice } from '@/components/formControls';
import { BackIcon, NextIcon } from '@/components/icons';
import { useAuth, type AuthUser, type DeleteOutcome } from '@/features/auth/AuthProvider';
import type { AgreedVersions, LegalDocType, LegalDocument } from '@/features/auth/consentStatus';
import { fetchCurrentDocuments, readLocalAgreement } from '@/features/auth/consentStore';
import { GoogleButton } from '@/features/auth/GoogleButton';
import { legalDrafts } from '@/features/auth/legalDrafts';
import { isolateLtr } from '@/features/globe/BoardingPassCard';
import { colors, fonts, layout, radius, type ColorScheme } from '@/theme/tokens';

import { formatDate } from '../trips/tripDates';
import {
  fetchAgreedDates,
  fetchChoices,
  readLocalChoices,
  recordChoice,
  writeLocalChoices,
  type OptionalChoice,
  type OptionalChoices,
} from './accountApi';

const STANDARD = Easing.bezier(0.2, 0, 0, 1);
const ACCELERATE = Easing.bezier(0.3, 0, 1, 1);

interface ScreenProps {
  colorScheme: ColorScheme;
  reduceMotion: boolean;
  insetsTop: number;
  insetsBottom: number;
}

/** A full screen that enters from the end side, with a "back" bar (design 9.1, 14). */
function PushScreen({
  title,
  onBack,
  leavesOnBack = true,
  backDisabled = false,
  colorScheme,
  reduceMotion,
  insetsTop,
  children,
  footer,
  testID,
}: ScreenProps & {
  title: string;
  onBack: () => void;
  /** false: "back" stays on this screen (a step back inside it), so no exit animation. */
  leavesOnBack?: boolean;
  backDisabled?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  testID?: string;
}) {
  const { t } = useTranslation();
  const palette = colors[colorScheme];
  const { width } = useWindowDimensions();
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.set(
      withTiming(1, {
        duration: reduceMotion ? 200 : 300,
        easing: reduceMotion ? Easing.linear : STANDARD,
        reduceMotion: ReduceMotion.Never,
      }),
    );
  }, [progress, reduceMotion]);
  // "Forward" comes in from the end side: from the left in Hebrew.
  const from = I18nManager.isRTL ? -width : width;
  const style = useAnimatedStyle(() =>
    reduceMotion
      ? { opacity: progress.value }
      : { transform: [{ translateX: (1 - progress.value) * from }] },
  );
  const back = () => {
    if (backDisabled) return;
    if (!leavesOnBack) {
      onBack();
      return;
    }
    progress.set(
      withTiming(0, {
        duration: reduceMotion ? 200 : 250,
        easing: reduceMotion ? Easing.linear : ACCELERATE,
        reduceMotion: ReduceMotion.Never,
      }),
    );
    setTimeout(onBack, reduceMotion ? 200 : 250);
  };
  const heading = useRef<ComponentRef<typeof Text>>(null);
  useEffect(() => {
    const node = findNodeHandle(heading.current);
    if (node) AccessibilityInfo.setAccessibilityFocus(node);
  }, [title]);

  return (
    <Modal
      visible
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="none"
      onRequestClose={back}
    >
      <Animated.View
        style={[styles.screen, { backgroundColor: palette.canvas, paddingTop: insetsTop }, style]}
        testID={testID}
      >
        <View style={styles.bar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('consents.back')}
            accessibilityState={{ disabled: backDisabled }}
            onPress={back}
            style={styles.barButton}
            testID={testID ? `${testID}-back` : undefined}
          >
            <BackIcon color={palette.textPrimary} />
          </Pressable>
          <Text
            ref={heading}
            style={[styles.title3, styles.barTitle, { color: palette.textPrimary }]}
            accessibilityRole="header"
            maxFontSizeMultiplier={2}
          >
            {title}
          </Text>
        </View>
        <ScrollView contentContainerStyle={styles.content}>{children}</ScrollView>
        {footer}
      </Animated.View>
    </Modal>
  );
}

/** A 56dp row: icon, label, optional description, and a "next" chevron (design 8.1). */
export function ListRow({
  icon,
  label,
  description,
  chevron = true,
  busy = false,
  onPress,
  colorScheme,
  testID,
}: {
  icon: (color: string) => ReactNode;
  label: string;
  description?: string;
  chevron?: boolean;
  busy?: boolean;
  onPress: () => void;
  colorScheme: ColorScheme;
  testID?: string;
}) {
  const palette = colors[colorScheme];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ busy, disabled: busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [styles.listRow, pressed && { backgroundColor: palette.pressed }]}
      testID={testID}
    >
      {busy ? (
        <ActivityIndicator size={20} color={palette.textSecondary} />
      ) : (
        icon(palette.textSecondary)
      )}
      <View style={styles.grow}>
        <Text style={[styles.body, { color: palette.textPrimary }]}>{label}</Text>
        {description ? (
          <Text style={[styles.footnote, { color: palette.textSecondary }]}>{description}</Text>
        ) : null}
      </View>
      {chevron ? <NextIcon color={palette.textTertiary} /> : null}
    </Pressable>
  );
}

/** "My consents" (AC-13): what was agreed, and the optional choices, saved on each tap. */
export function ConsentsScreen({
  user,
  onBack,
  onDeleteAccount,
  ...screen
}: ScreenProps & { user: AuthUser; onBack: () => void; onDeleteAccount: () => void }) {
  const { t } = useTranslation();
  const palette = colors[screen.colorScheme];
  const [agreed, setAgreed] = useState<AgreedVersions | null>(null);
  const [documents, setDocuments] = useState<LegalDocument[] | null>(null);
  const [choices, setChoices] = useState<OptionalChoices | null>(null);
  const [agreedOn, setAgreedOn] = useState<Partial<Record<LegalDocType, string>>>({});
  const [saving, setSaving] = useState<Partial<Record<OptionalChoice, boolean>>>({});
  const [offline, setOffline] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reading, setReading] = useState<LegalDocType | null>(null);

  useEffect(() => {
    let current = true;
    void (async () => {
      const [local, localChoices] = await Promise.all([
        readLocalAgreement(user.id),
        readLocalChoices(user.id),
      ]);
      if (!current) return;
      setAgreed(local);
      if (localChoices) setChoices(localChoices);
      const [docs, server, dates] = await Promise.all([
        fetchCurrentDocuments(),
        fetchChoices(),
        local ? fetchAgreedDates(local) : null,
      ]);
      if (!current) return;
      if (dates) setAgreedOn(dates);
      setDocuments(docs);
      if (server) {
        setChoices(server);
        await writeLocalChoices(user.id, server);
      } else if (!localChoices) {
        setChoices({ marketing: false, analytics: false });
      }
    })();
    return () => {
      current = false;
    };
  }, [user.id]);

  useEffect(() => NetInfo.addEventListener((net) => setOffline(net.isConnected === false)), []);

  const toggle = async (type: OptionalChoice) => {
    if (!choices || saving[type] || offline) return;
    const before = choices;
    const granted = !before[type];
    setFailed(false);
    setChoices({ ...before, [type]: granted }); // optimistic (design 9.2)
    setSaving((s) => ({ ...s, [type]: true }));
    const result = await recordChoice(user.id, type, granted, before);
    setSaving((s) => ({ ...s, [type]: false }));
    if (result === 'ok') {
      AccessibilityInfo.announceForAccessibility(t('consents.saved'));
      return;
    }
    setChoices((c) => (c ? { ...c, [type]: before[type] } : c));
    if (result === 'offline') setOffline(true);
    else setFailed(true);
  };

  const docRow = (type: LegalDocType) => {
    const version = agreed?.[type];
    const doc = documents?.find((d) => d.docType === type);
    // The agreed version's text: the hosted copy when it is the one in force.
    const url = doc && doc.version === version ? doc.url : null;
    const name = t(type === 'terms' ? 'consent.terms' : 'consent.privacy');
    const date = agreedOn[type];
    return (
      <View key={type}>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={
            date
              ? t('consents.docA11yDated', { doc: name, version, date: formatDate(date, t) })
              : t('consents.docA11y', { doc: name, version: version ?? '–' })
          }
          accessibilityHint={url ? t('consents.docHint') : undefined}
          onPress={() => {
            if (url) Linking.openURL(url).catch(() => setReading(type));
            else setReading(reading === type ? null : type);
          }}
          style={({ pressed }) => [styles.docRow, pressed && { backgroundColor: palette.pressed }]}
        >
          <Text style={[styles.bodyStrong, { color: palette.link }]}>{name}</Text>
          {version !== undefined ? (
            <Text style={[styles.footnote, styles.tabular, { color: palette.textSecondary }]}>
              {date
                ? t('consents.docMetaDated', { version, date: numericDate(date, t) })
                : t('consents.docMeta', { version })}
            </Text>
          ) : null}
        </Pressable>
        {reading === type ? (
          <Text style={[styles.footnote, styles.draft, { color: palette.textPrimary }]}>
            {legalDrafts[type].body}
          </Text>
        ) : null}
      </View>
    );
  };

  return (
    <PushScreen {...screen} title={t('consents.title')} onBack={onBack} testID="consents-screen">
      <Text style={[styles.title3, { color: palette.textPrimary }]} accessibilityRole="header">
        {t('consents.docsTitle')}
      </Text>
      <View style={[styles.card, { backgroundColor: palette.surface }]}>
        {docRow('terms')}
        {docRow('privacy')}
      </View>
      <InlineNotice text={t('consents.withdraw')} colorScheme={screen.colorScheme} />
      <Button
        kind="text"
        label={t('consents.toDelete')}
        onPress={onDeleteAccount}
        colorScheme={screen.colorScheme}
      />

      <Text style={[styles.title3, { color: palette.textPrimary }]} accessibilityRole="header">
        {t('consents.optionalTitle')}
      </Text>
      <Text style={[styles.footnote, { color: palette.textSecondary }]}>
        {t('consents.optionalBody')}
      </Text>
      {offline ? (
        <InlineNotice text={t('consents.offline')} colorScheme={screen.colorScheme} />
      ) : failed ? (
        <InlineNotice text={t('consents.error')} colorScheme={screen.colorScheme} />
      ) : null}
      <View style={[styles.card, { backgroundColor: palette.surface, opacity: offline ? 0.6 : 1 }]}>
        {(['marketing', 'analytics'] as const).map((type) => (
          <CheckboxRow
            key={type}
            checked={choices?.[type] ?? false}
            disabled={offline || !choices}
            onToggle={() => void toggle(type)}
            label={t(type === 'marketing' ? 'consent.marketing' : 'consent.analytics')}
            description={
              saving[type]
                ? t('consents.saving')
                : t(type === 'marketing' ? 'consent.marketingNote' : 'consent.analyticsNote')
            }
            colorScheme={screen.colorScheme}
            testID={`consents-${type}`}
          />
        ))}
      </View>
    </PushScreen>
  );
}

/** "23.10.2026" (design 9.1), from a Postgres date. */
function numericDate(value: string, t: TFunction): string {
  const [yyyy, mm, dd] = value.split('-');
  return t('date.numeric', { dd, mm, yyyy });
}

const DELETE_MESSAGES: Partial<Record<DeleteOutcome, string>> = {
  offline: 'deleteAccount.offline',
  cancelled: 'deleteAccount.cancelled',
  reauthFailed: 'deleteAccount.expired',
  unavailable: 'deleteAccount.unavailable',
  noAnswer: 'deleteAccount.noAnswer',
  expired: 'signIn.expired',
  error: 'deleteAccount.error',
  playServicesUnavailable: 'signIn.playServices',
};

/**
 * Account deletion (AC-15, AC-18): step 1 says what is deleted and what is
 * kept; step 2 is a fresh Google sign-in, and choosing the account deletes.
 */
export function DeleteAccountScreen({
  user,
  onBack,
  ...screen
}: ScreenProps & { user: AuthUser; onBack: () => void }) {
  const { t } = useTranslation();
  const palette = colors[screen.colorScheme];
  const { deleteAccount } = useAuth();
  const [step, setStep] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [outcome, setOutcome] = useState<DeleteOutcome | null>(null);

  useEffect(() => {
    if (deleting) AccessibilityInfo.announceForAccessibility(t('deleteAccount.deleting'));
  }, [deleting, t]);

  const verify = async () => {
    setBusy(true);
    setOutcome(null);
    const result = await deleteAccount(() => setDeleting(true));
    // On success the whole account area unmounts with the signed-in state.
    if (result === 'deleted' || result === 'inProgress') return;
    setBusy(false);
    setDeleting(false);
    setOutcome(result);
  };

  const message =
    outcome === 'wrongAccount'
      ? t('deleteAccount.wrongAccount', { email: user.email ?? '' })
      : outcome && DELETE_MESSAGES[outcome]
        ? t(DELETE_MESSAGES[outcome]!)
        : null;

  const bullet = (text: string) => (
    <View style={styles.bullet} key={text}>
      <Text style={[styles.body, { color: palette.textSecondary }]} importantForAccessibility="no">
        ✓
      </Text>
      <Text style={[styles.body, styles.grow, { color: palette.textPrimary }]}>{text}</Text>
    </View>
  );

  return (
    <>
      <PushScreen
        {...screen}
        title={t('deleteAccount.title')}
        onBack={() => (step === 2 ? setStep(1) : onBack())}
        leavesOnBack={step === 1}
        backDisabled={busy}
        testID="delete-account-screen"
        footer={
          step === 1 ? (
            <View
              style={[
                styles.footer,
                { paddingBottom: screen.insetsBottom + 12, borderTopColor: palette.borderSubtle },
              ]}
            >
              <Button
                kind="primary"
                label={t('deleteAccount.continue')}
                onPress={() => setStep(2)}
                colorScheme={screen.colorScheme}
                testID="delete-account-continue"
              />
              <Button
                kind="text"
                label={t('deleteAccount.cancel')}
                onPress={onBack}
                colorScheme={screen.colorScheme}
              />
            </View>
          ) : null
        }
      >
        <Text style={[styles.step, { backgroundColor: palette.infoBg, color: palette.infoFg }]}>
          {t('deleteAccount.step', { n: step })}
        </Text>
        {step === 1 ? (
          <>
            <Text style={[styles.body, { color: palette.textPrimary }]}>
              {t('deleteAccount.lead')}
            </Text>
            <View style={[styles.card, styles.padded, { backgroundColor: palette.surface }]}>
              <Text
                style={[styles.title3, { color: palette.textPrimary }]}
                accessibilityRole="header"
              >
                {t('deleteAccount.deletedTitle')}
              </Text>
              {[
                t('deleteAccount.deletedAccount'),
                t('deleteAccount.deletedTrips'),
                t('deleteAccount.deletedDevice'),
              ].map(bullet)}
            </View>
            <View style={[styles.card, styles.padded, { backgroundColor: palette.surface }]}>
              <Text
                style={[styles.title3, { color: palette.textPrimary }]}
                accessibilityRole="header"
              >
                {t('deleteAccount.keptTitle')}
              </Text>
              <Text style={[styles.body, { color: palette.textPrimary }]}>
                {t('deleteAccount.kept')}
              </Text>
            </View>
          </>
        ) : (
          <>
            <Text
              style={[styles.title2, { color: palette.textPrimary }]}
              accessibilityRole="header"
            >
              {t('deleteAccount.verifyTitle')}
            </Text>
            <Text style={[styles.body, { color: palette.textPrimary }]}>
              {t('deleteAccount.verifyBody')}
            </Text>
            {user.email ? (
              <Text
                style={[
                  styles.chip,
                  { backgroundColor: palette.surfaceAlt, color: palette.textPrimary },
                ]}
              >
                {isolateLtr(user.email)}
              </Text>
            ) : null}
            <Text style={[styles.bodyStrong, { color: palette.textPrimary }]}>
              {t('deleteAccount.verifyWarning')}
            </Text>
            {message ? (
              <InlineNotice
                text={message}
                colorScheme={screen.colorScheme}
                testID="delete-account-notice"
              />
            ) : null}
            <GoogleButton
              colorScheme={screen.colorScheme}
              busy={busy}
              disabled={false}
              a11yLabel={t('deleteAccount.googleA11y')}
              onPress={() => void verify()}
            />
            <Button
              kind="text"
              label={t('deleteAccount.cancel')}
              disabled={busy}
              onPress={onBack}
              colorScheme={screen.colorScheme}
            />
          </>
        )}
      </PushScreen>
      {deleting ? (
        <BlockingProgress text={t('deleteAccount.deleting')} colorScheme={screen.colorScheme} />
      ) : null}
    </>
  );
}

/** Over everything while the server deletes: back and taps do nothing (design 11.3). */
function BlockingProgress({ text, colorScheme }: { text: string; colorScheme: ColorScheme }) {
  const palette = colors[colorScheme];
  return (
    <Modal
      visible
      transparent={false}
      statusBarTranslucent
      navigationBarTranslucent
      animationType="fade"
      onRequestClose={() => {}}
    >
      <View
        style={[styles.blocking, { backgroundColor: palette.canvas }]}
        accessibilityLiveRegion="assertive"
        testID="deleting-account"
      >
        <ActivityIndicator size={32} color={palette.textPrimary} />
        <Text style={[styles.title3, { color: palette.textPrimary }]}>{text}</Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 },
  barButton: {
    width: layout.touchTargetMin,
    height: layout.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  barTitle: { flex: 1 },
  content: { padding: 16, gap: 12 },
  title2: { fontFamily: fonts.semibold, fontSize: 22, lineHeight: 28, textAlign: 'left' },
  title3: { fontFamily: fonts.semibold, fontSize: 18, lineHeight: 24, textAlign: 'left' },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, textAlign: 'left' },
  bodyStrong: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 24, textAlign: 'left' },
  footnote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, textAlign: 'left' },
  tabular: { fontVariant: ['tabular-nums'] },
  grow: { flex: 1 },
  card: { borderRadius: radius.lg, paddingHorizontal: 16, paddingVertical: 4 },
  padded: { paddingVertical: 16, gap: 8 },
  docRow: { minHeight: layout.listRowMin, justifyContent: 'center', paddingVertical: 8 },
  draft: { paddingBottom: 12 },
  listRow: {
    minHeight: layout.listRowMin,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  step: {
    alignSelf: 'flex-start',
    fontFamily: fonts.semibold,
    fontSize: 12,
    lineHeight: 16,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  bullet: { flexDirection: 'row', gap: 8 },
  chip: {
    alignSelf: 'flex-start',
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  footer: { paddingHorizontal: 16, paddingTop: 12, gap: 4, borderTopWidth: 1 },
  blocking: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
});
