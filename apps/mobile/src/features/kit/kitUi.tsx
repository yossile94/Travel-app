/**
 * Parts shared by the travel kit's screens (sprint 8 design 4, 5, 9, 12.3):
 * the full-screen form shell (as FlightScreen), a dial row, a hidden number
 * with show/hide (as the PNR), and opening a URL with a toast on failure.
 */
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState, type ComponentRef, type ReactNode, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AppState,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button } from '@/components/fields';
import { InlineNotice } from '@/components/formControls';
import { BackIcon, PhoneIcon } from '@/components/icons';
import { isolateLtr } from '@/features/globe/BoardingPassCard';
import { colors, fonts, layout, radius, type ColorScheme } from '@/theme/tokens';

import { formatPhone, telUrl } from './phone';

export const MASK = '••••••';
/** The hidden number hides again after 30 s, as the PNR (sprint 5 design 7.2). */
const AUTO_HIDE_MS = 30_000;

/** Opens a URL; false when no app takes it (design 5: a toast, never a crash). */
export async function openUrl(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

export function FormShell({
  title,
  subtitle,
  colorScheme,
  insetsTop,
  insetsBottom,
  onBack,
  footer,
  children,
  testID,
  scrollRef,
}: {
  title: string;
  subtitle: string;
  colorScheme: ColorScheme;
  insetsTop: number;
  insetsBottom: number;
  onBack: () => void;
  footer: ReactNode;
  children: ReactNode;
  testID: string;
  scrollRef?: Ref<ComponentRef<typeof ScrollView>>;
}) {
  const { t } = useTranslation();
  const p = colors[colorScheme];
  return (
    <Modal
      visible
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onBack}
    >
      <KeyboardAvoidingView
        style={[styles.screen, { backgroundColor: p.canvas, paddingTop: insetsTop }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        testID={testID}
      >
        <StatusBar style={colorScheme === 'light' ? 'dark' : 'light'} />
        <View style={styles.bar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('flight.back')}
            onPress={onBack}
            style={styles.back}
            testID={`${testID}-back`}
          >
            <BackIcon color={p.textPrimary} />
          </Pressable>
          <View style={styles.grow}>
            <Text
              style={[styles.barTitle, { color: p.textPrimary }]}
              accessibilityRole="header"
              maxFontSizeMultiplier={2}
            >
              {title}
            </Text>
            <Text style={[styles.footnote, { color: p.textSecondary }]} numberOfLines={1}>
              {subtitle}
            </Text>
          </View>
        </View>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
        <View
          style={[
            styles.footer,
            {
              paddingBottom: insetsBottom + 12,
              borderTopColor: p.borderSubtle,
              backgroundColor: p.canvas,
            },
          ]}
        >
          {footer}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * Design 12.3: a number with its dial circle. The whole row dials (the
 * dialer opens, never a direct call); a failed dial shows the number as
 * selectable text, so it can be copied (Raz design 13).
 */
export function DialRow({
  label,
  number,
  sub,
  large = false,
  colorScheme,
  testID,
}: {
  label: string;
  /** E.164 or a short local number. */
  number: string;
  sub?: string | null;
  large?: boolean;
  colorScheme: ColorScheme;
  testID: string;
}) {
  const { t } = useTranslation();
  const p = colors[colorScheme];
  const [failed, setFailed] = useState(false);
  const shown = formatPhone(number);
  return (
    <View style={styles.gap4}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('emergency.dialA11y', { label, number: shown.split('').join(' ') })}
        accessibilityHint={t('emergency.dialHint')}
        onPress={() => void openUrl(telUrl(number)).then((ok) => setFailed(!ok))}
        style={({ pressed }) => [
          styles.dial,
          { backgroundColor: pressed ? p.pressed : p.surfaceRaised, minHeight: large ? 64 : 56 },
        ]}
        testID={testID}
      >
        <View style={styles.grow}>
          <Text style={[styles.callout, { color: p.textPrimary }]}>{label}</Text>
          {sub ? <Text style={[styles.footnote, { color: p.textSecondary }]}>{sub}</Text> : null}
          <Text style={[large ? styles.numericLg : styles.numeric, { color: p.textPrimary }]}>
            {isolateLtr(shown)}
          </Text>
        </View>
        <View
          style={[
            styles.circle,
            { width: large ? 48 : 40, height: large ? 48 : 40, backgroundColor: p.successSubtleBg },
          ]}
        >
          <PhoneIcon color={p.successSubtleFg} size={large ? 24 : 20} />
        </View>
      </Pressable>
      {failed ? (
        <View>
          <InlineNotice
            text={t('app.noHandler')}
            colorScheme={colorScheme}
            testID={`${testID}-failed`}
          />
          <Text selectable style={[styles.numeric, { color: p.textPrimary }]}>
            {isolateLtr(shown)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** A hidden value with "show" / "hide" (AC-6): hidden on every open, again after 30 s or in the background. */
export function SecretRow({
  label,
  hiddenA11y,
  showLabel,
  hideLabel,
  value,
  colorScheme,
  testID,
}: {
  label: string;
  hiddenA11y: string;
  showLabel: string;
  hideLabel: string;
  value: string;
  colorScheme: ColorScheme;
  testID: string;
}) {
  const { t } = useTranslation();
  const p = colors[colorScheme];
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!shown) return;
    const timer = setTimeout(() => setShown(false), AUTO_HIDE_MS);
    const sub = AppState.addEventListener('change', (s) => s !== 'active' && setShown(false));
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, [shown]);
  return (
    <View style={styles.secret}>
      <View
        style={styles.grow}
        accessible
        accessibilityLabel={shown ? `${label}, ${value}` : hiddenA11y}
      >
        <Text style={[styles.caption, { color: p.textSecondary }]}>{label}</Text>
        <Text
          style={[styles.numeric, styles.ltr, { color: p.textPrimary }]}
          testID={`${testID}-value`}
        >
          {shown ? isolateLtr(value) : MASK}
        </Text>
      </View>
      <Button
        kind="text"
        label={shown ? t('flight.hide') : t('flight.show')}
        a11yLabel={shown ? hideLabel : showLabel}
        onPress={() => setShown((s) => !s)}
        colorScheme={colorScheme}
        testID={`${testID}-toggle`}
      />
    </View>
  );
}

export function SectionTitle({
  text,
  colorScheme,
  testID,
}: {
  text: string;
  colorScheme: ColorScheme;
  testID?: string;
}) {
  const p = colors[colorScheme];
  return (
    <Text
      style={[styles.caption, { color: p.textSecondary }]}
      accessibilityRole="header"
      testID={testID}
    >
      {text}
    </Text>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: {
    minHeight: layout.formBarHeight,
    paddingEnd: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  back: {
    width: layout.touchTargetMin,
    height: layout.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  barTitle: { fontFamily: fonts.semibold, fontSize: 20, lineHeight: 26, textAlign: 'left' },
  grow: { flex: 1 },
  content: { padding: 16, gap: 20 },
  footer: { paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1, gap: 8 },
  section: { gap: 8 },
  gap4: { gap: 4 },
  gap8: { gap: 8 },
  row2: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  cell: { flexGrow: 1, flexBasis: layout.dateFieldMinWidth },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  caption: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, textAlign: 'left' },
  title2: { fontFamily: fonts.semibold, fontSize: 22, lineHeight: 28, textAlign: 'left' },
  title3: {
    fontFamily: fonts.semibold,
    fontSize: 18,
    lineHeight: 24,
    marginTop: 4,
    textAlign: 'left',
  },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22, textAlign: 'left' },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, textAlign: 'left' },
  callout: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 20, textAlign: 'left' },
  footnote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, textAlign: 'left' },
  tabular: { fontVariant: ['tabular-nums'] },
  numeric: {
    fontFamily: fonts.medium,
    fontSize: 17,
    lineHeight: 22,
    fontVariant: ['tabular-nums'],
    textAlign: 'left',
  },
  numericLg: {
    fontFamily: fonts.semibold,
    fontSize: 22,
    lineHeight: 28,
    fontVariant: ['tabular-nums'],
    textAlign: 'left',
  },
  ltr: { writingDirection: 'ltr', letterSpacing: 1.6 },
  card: { borderRadius: radius.md, padding: 12, gap: 8 },
  rowLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dial: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  circle: { borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  secret: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sheetBody: { padding: 16, gap: 16 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  chipText: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
  skeleton: { height: 72, borderRadius: radius.md },
});
