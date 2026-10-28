/**
 * Sprint 8 design 6: "Show to driver" (AC-3, AC-4, AC-5). Full screen, light
 * colours even in dark mode, the screen kept on, content in the first frame,
 * working in airplane mode. The local address steps down 44/36/30/24 until it
 * fits 8 lines; at 24 the screen scrolls, nothing is cut (Raz design 3).
 */
import { useKeepAwake } from 'expo-keep-awake';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/fields';
import { ClearIcon, NavigateIcon, PhoneIcon, ShareIcon } from '@/components/icons';
import { isolateLtr } from '@/features/globe/BoardingPassCard';
import { colors, fonts, layout } from '@/theme/tokens';

import type { Hotel } from './kitModel';
import { formatPhone, telUrl } from './phone';

export const STEPS = [44, 36, 30, 24] as const;
export const MAX_LINES = 8;

/** The next step after a layout of `lines` at step `i`; the same step when it fits or is the last. */
export const nextStep = (i: number, lines: number) =>
  lines > MAX_LINES && i < STEPS.length - 1 ? i + 1 : i;

/** Design 19.2: right to left for Hebrew and Arabic, by the first strong letter. */
export function textDirection(text: string): 'rtl' | 'ltr' {
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (
      (c >= 0x0590 && c <= 0x08ff) ||
      (c >= 0xfb1d && c <= 0xfdff) ||
      (c >= 0xfe70 && c <= 0xfeff)
    ) {
      return 'rtl';
    }
    if (/\p{L}/u.test(ch)) return 'ltr';
  }
  return 'ltr';
}

export const mapsUrl = (h: Pick<Hotel, 'name' | 'addressEn'>) =>
  `geo:0,0?q=${encodeURIComponent(`${h.name}, ${h.addressEn}`)}`;

/** The shared text (design 21.3): no labels, never the booking number (AC-6). */
export const shareText = (h: Hotel) =>
  [h.name, h.addressLocal, h.addressEn, h.phone ? formatPhone(h.phone) : null]
    .filter(Boolean)
    .join('\n');

export function DriverCard({
  hotel,
  insetsTop,
  insetsBottom,
  onClose,
  onOpenUrl,
}: {
  hotel: Hotel;
  insetsTop: number;
  insetsBottom: number;
  onClose: () => void;
  /** Opens a URL; a failure shows the app's toast. */
  onOpenUrl: (url: string) => void;
}) {
  useKeepAwake();
  const { t } = useTranslation();
  // Always the light palette: read from afar, often in daylight (design 6.1).
  const p = colors.light;
  const big = hotel.addressLocal || hotel.addressEn;
  const dir = textDirection(big);
  const [step, setStep] = useState(0);
  const [measured, setMeasured] = useState(false);
  const size = STEPS[step] ?? 24;
  const last = step === STEPS.length - 1;
  const bigStyle = {
    fontSize: size,
    lineHeight: Math.round(size * 1.25),
    writingDirection: dir,
    textAlign: dir === 'rtl' ? ('right' as const) : ('left' as const),
  };

  return (
    <Modal
      visible
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View
        style={[styles.screen, { backgroundColor: p.surface, paddingTop: insetsTop }]}
        testID="driver-card"
      >
        <StatusBar style="dark" />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('driver.close')}
          onPress={onClose}
          style={styles.close}
          testID="driver-card-close"
        >
          <ClearIcon color={p.textPrimary} />
        </Pressable>
        <ScrollView contentContainerStyle={styles.content}>
          {/* Measured off-screen first, so the shown text never jumps (design 6.2). */}
          {!measured ? (
            <Text
              style={[styles.big, bigStyle, styles.measure]}
              allowFontScaling={false}
              importantForAccessibility="no-hide-descendants"
              onTextLayout={(e) => {
                const next = nextStep(step, e.nativeEvent.lines.length);
                if (next === step) setMeasured(true);
                else setStep(next);
              }}
            >
              {big}
            </Text>
          ) : null}
          <Text
            style={[styles.big, bigStyle, { color: p.textPrimary }, !measured && styles.hidden]}
            allowFontScaling={false}
            numberOfLines={last ? undefined : MAX_LINES}
            selectable
            accessibilityLabel={hotel.addressLocal ? `${t('driver.localA11y')}, ${big}` : big}
            testID="driver-card-address"
          >
            {big}
          </Text>
          <View style={[styles.rule, { backgroundColor: p.borderSubtle }]} />
          <Text style={[styles.name, { color: p.textPrimary }]} maxFontSizeMultiplier={2}>
            {hotel.name}
          </Text>
          {hotel.addressLocal ? (
            <Text
              style={[styles.en, styles.ltr, { color: p.textSecondary }]}
              selectable
              maxFontSizeMultiplier={2}
            >
              {hotel.addressEn}
            </Text>
          ) : null}
          {hotel.phone ? (
            <Text
              style={[styles.phone, styles.ltr, { color: p.textPrimary }]}
              maxFontSizeMultiplier={2}
            >
              {isolateLtr(formatPhone(hotel.phone))}
            </Text>
          ) : null}
        </ScrollView>
        <View
          style={[styles.bar, { paddingBottom: insetsBottom + 12, borderTopColor: p.borderSubtle }]}
        >
          <View style={styles.cell}>
            <Button
              kind="secondary"
              label={t('hotel.navigate')}
              a11yLabel={t('hotel.navigateA11y', { name: hotel.name })}
              icon={(c) => <NavigateIcon color={c} size={20} />}
              onPress={() => onOpenUrl(mapsUrl(hotel))}
              colorScheme="light"
              testID="driver-card-navigate"
            />
          </View>
          {hotel.phone ? (
            <View style={styles.cell}>
              <Button
                kind="secondary"
                label={t('hotel.callShort')}
                icon={(c) => <PhoneIcon color={c} size={20} />}
                onPress={() => onOpenUrl(telUrl(hotel.phone!))}
                colorScheme="light"
                testID="driver-card-call"
              />
            </View>
          ) : null}
          <View style={styles.cell}>
            <Button
              kind="secondary"
              label={t('hotel.share')}
              a11yLabel={t('hotel.shareA11y')}
              icon={(c) => <ShareIcon color={c} size={20} />}
              onPress={() => void Share.share({ message: shareText(hotel) }).catch(() => {})}
              colorScheme="light"
              testID="driver-card-share"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  close: {
    width: layout.touchTargetMin,
    height: layout.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
    marginStart: 4,
  },
  content: { paddingHorizontal: 24, paddingVertical: 16, gap: 12 },
  big: { fontFamily: fonts.medium },
  measure: { position: 'absolute', opacity: 0, start: 24, end: 24, top: 16 },
  hidden: { opacity: 0 },
  rule: { height: 1, marginVertical: 8 },
  name: { fontFamily: fonts.semibold, fontSize: 22, lineHeight: 28, textAlign: 'left' },
  en: { fontFamily: fonts.regular, fontSize: 18, lineHeight: 24 },
  phone: { fontFamily: fonts.medium, fontSize: 17, lineHeight: 22, fontVariant: ['tabular-nums'] },
  ltr: { writingDirection: 'ltr', textAlign: 'left' },
  bar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  cell: { flex: 1, minWidth: 120 },
});
