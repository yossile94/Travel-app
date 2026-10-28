/**
 * Sprint 10 AC-2, AC-9, AC-10 (design 8, 9, D2, D7): photographing the
 * details page. Always dark; screenshots blocked (SecureWindow). The camera
 * permission is asked on "take a photo", never before; typing the date is
 * always there. The OCR runs on the device (bundled ML Kit, in the vault);
 * its text goes nowhere, and only a date the person confirms is kept.
 */
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { Button } from '@/components/fields';
import { InlineNotice } from '@/components/formControls';
import { CameraIcon, ClearIcon, ImageIcon } from '@/components/icons';
import { formatDate, fromPgDate, toPgDate, todayPg } from '@/features/trips/tripDates';
import { colors, fonts, radius, toastColors } from '@/theme/tokens';

import { readMrzExpiry } from './mrz';
import { isolateLtr, numDate } from './passportText';
import { SecureWindow, vault } from './vault';

export type CaptureResult =
  | { kind: 'cancelled' }
  | { kind: 'typeInstead' }
  | { kind: 'photo'; uri: string; expiry: string | null; edited: boolean };

/** Design 9.1: the OCR has 5 s, then it's a failure (timing.ocr.timeout). */
export const OCR_TIMEOUT_MS = 5000;

const SPACE = '#03060F';
const FRAME = '#F3F6FC';
const BAND = '#6FB3FA';
const DETECTED = '#4FCFBE';
const dark = colors.dark;

type Phase =
  | { kind: 'camera' }
  | { kind: 'noPermission' }
  | { kind: 'reading'; uri: string }
  | {
      kind: 'confirm';
      uri: string;
      read: 'expiry' | 'failed';
      expiry: string | null;
      edited: boolean;
    };

/** OCR with a time limit; any failure is "couldn't read" (AC-10). */
export async function readExpiry(uri: string): Promise<string | null> {
  const text = await Promise.race([
    vault.recognize(uri),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), OCR_TIMEOUT_MS)),
  ]).catch(() => null);
  if (!text) return null;
  const result = readMrzExpiry(text);
  return result.kind === 'expiry' ? result.date : null;
}

/** Design 8.3: the system photo picker; null when cancelled. */
export async function pickImage(): Promise<string | null> {
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: false,
    exif: false,
  }).catch(() => null);
  return (picked && !picked.canceled ? picked.assets[0]?.uri : undefined) ?? null;
}

export function CaptureScreen({
  start,
  insetsTop,
  insetsBottom,
  onDone,
}: {
  /** The camera, or an image already picked from the gallery. */
  start: { kind: 'camera' } | { kind: 'picked'; uri: string };
  insetsTop: number;
  insetsBottom: number;
  onDone: (result: CaptureResult) => void;
}) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase | null>(() =>
    start.kind === 'picked' ? { kind: 'reading', uri: start.uri } : null,
  );
  const [denied, setDenied] = useState(false);
  const [torch, setTorch] = useState(false);
  const camera = useRef<CameraView>(null);
  const busy = useRef(false);
  const done = useRef(false);

  // Before the camera is up: its permission decides (design 8.2), asked once, here.
  const shown: Phase | null =
    phase ??
    (permission?.granted
      ? { kind: 'camera' }
      : denied || (permission && !permission.canAskAgain)
        ? { kind: 'noPermission' }
        : null);

  const finish = (result: CaptureResult) => {
    if (done.current) return;
    done.current = true;
    onDone(result);
  };

  // A photo to read: the OCR, then the confirm step (design 9.1).
  const reading = phase?.kind === 'reading' ? phase.uri : null;
  useEffect(() => {
    if (!reading) return;
    let alive = true;
    AccessibilityInfo.announceForAccessibility(t('capture.reading'));
    void readExpiry(reading).then((expiry) => {
      if (!alive) return;
      setPhase({
        kind: 'confirm',
        uri: reading,
        read: expiry ? 'expiry' : 'failed',
        expiry,
        edited: false,
      });
      AccessibilityInfo.announceForAccessibility(
        expiry ? t('capture.detectedA11y', { date: formatDate(expiry, t) }) : t('capture.failed'),
      );
    });
    return () => {
      alive = false;
    };
  }, [reading, t]);

  useEffect(() => {
    if (start.kind !== 'camera' || !permission || permission.granted || !permission.canAskAgain)
      return;
    void requestPermission().then((r) => !r.granted && setDenied(true));
  }, [start.kind, permission, requestPermission]);

  const cameraUp = shown?.kind === 'camera';
  useEffect(() => {
    if (cameraUp) AccessibilityInfo.announceForAccessibility(t('capture.opened'));
  }, [cameraUp, t]);

  const pickFromGallery = async (afterDiscard = false) => {
    const uri = await pickImage();
    if (uri) setPhase({ kind: 'reading', uri });
    // The previous photo is gone already: nothing left to confirm (Raz review).
    else if (afterDiscard) finish({ kind: 'cancelled' });
  };

  const shoot = async () => {
    if (busy.current || !camera.current) return;
    busy.current = true;
    try {
      const shot = await camera.current.takePictureAsync({
        quality: 1,
        exif: false,
        skipProcessing: false,
      });
      if (shot?.uri) setPhase({ kind: 'reading', uri: shot.uri });
    } finally {
      busy.current = false;
    }
  };

  const retake = async (uri: string) => {
    await vault.discard(uri).catch(() => {});
    if (start.kind === 'picked') return void pickFromGallery(true);
    setPhase(null);
  };

  const close = () => {
    if (phase?.kind === 'confirm' || phase?.kind === 'reading') {
      const uri = phase.uri;
      Alert.alert(t('capture.discardTitle'), t('capture.discardBody'), [
        { text: t('capture.discardKeep'), style: 'cancel' },
        {
          text: t('capture.discardConfirm'),
          style: 'destructive',
          onPress: () => void vault.discard(uri).finally(() => finish({ kind: 'cancelled' })),
        },
      ]);
      return;
    }
    finish({ kind: 'cancelled' });
  };

  const fixDate = (current: Extract<Phase, { kind: 'confirm' }>) =>
    DateTimePickerAndroid.open({
      mode: 'date',
      value: fromPgDate(current.expiry ?? todayPg()),
      positiveButton: { label: t('datePicker.ok') },
      negativeButton: { label: t('datePicker.cancel') },
      onValueChange: (_e, date) => setPhase({ ...current, expiry: toPgDate(date), edited: true }),
    });

  const frameWidth = width - 48;
  const frameHeight = frameWidth / 1.42;

  let body: ReactNode = <ActivityIndicator color={FRAME} style={styles.center} />;
  if (shown?.kind === 'noPermission') {
    body = (
      <View style={[styles.center, styles.pad]} testID="capture-no-permission">
        <CameraIcon color={dark.textSecondary} size={48} />
        <Text style={[styles.title2, { color: dark.textPrimary }]} accessibilityRole="header">
          {t('capture.noPermTitle')}
        </Text>
        <Text style={[styles.body, styles.centerText, { color: dark.textSecondary }]}>
          {t('capture.noPermBody')}
        </Text>
        <View style={styles.stack}>
          <Button
            kind="primary"
            label={t('capture.openSettings')}
            onPress={() => void Linking.openSettings()}
            colorScheme="dark"
            testID="capture-no-permission-settings"
          />
          <Button
            kind="secondary"
            label={t('capture.gallery')}
            onPress={() => void pickFromGallery()}
            colorScheme="dark"
            testID="capture-no-permission-gallery"
          />
          <Button
            kind="text"
            label={t('capture.typeInstead')}
            onPress={() => finish({ kind: 'typeInstead' })}
            colorScheme="dark"
            testID="capture-no-permission-type"
          />
        </View>
      </View>
    );
  } else if (shown?.kind === 'camera') {
    body = (
      <View style={styles.fill}>
        <CameraView
          ref={camera}
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={torch}
        />
        <View
          style={[styles.frame, { width: frameWidth, height: frameHeight }]}
          accessible
          accessibilityRole="image"
          accessibilityLabel={t('capture.frameA11y')}
          testID="capture-frame"
        >
          <View style={[styles.corner, styles.tl]} />
          <View style={[styles.corner, styles.tr]} />
          <View style={[styles.corner, styles.bl]} />
          <View style={[styles.corner, styles.br]} />
          <View style={[styles.band, { height: frameHeight * 0.22 }]} />
        </View>
        <View style={styles.hints}>
          <Text style={[styles.pill, { backgroundColor: toastColors.bg, color: toastColors.fg }]}>
            {t('capture.hint')}
          </Text>
          <Text style={[styles.footnote, { color: FRAME }]}>{t('capture.hint2')}</Text>
        </View>
        <View style={[styles.shutterRow, { bottom: insetsBottom + 32 }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('capture.gallery')}
            onPress={() => void pickFromGallery()}
            style={styles.round48}
            testID="capture-gallery"
          >
            <ImageIcon color={FRAME} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('capture.shutter')}
            onPress={() => void shoot()}
            style={styles.shutter}
            testID="capture-shutter"
          >
            <View style={styles.shutterFill} />
          </Pressable>
          <View style={styles.round48} />
        </View>
      </View>
    );
  } else if (phase?.kind === 'reading') {
    body = (
      <View style={[styles.center, styles.pad]}>
        <Image
          source={{ uri: phase.uri }}
          style={[styles.preview, { width: frameWidth, height: frameHeight }]}
          resizeMode="contain"
        />
        <View
          style={[styles.row, styles.pillBox, { backgroundColor: toastColors.bg }]}
          accessibilityLiveRegion="polite"
          testID="capture-reading"
        >
          <ActivityIndicator size={16} color={toastColors.fg} />
          <Text style={[styles.callout, { color: toastColors.fg }]}>{t('capture.reading')}</Text>
        </View>
      </View>
    );
  } else if (phase?.kind === 'confirm') {
    const past = phase.expiry && phase.expiry < todayPg();
    body = (
      <ScrollView
        contentContainerStyle={[styles.pad, styles.stack, { paddingBottom: insetsBottom + 24 }]}
        testID="capture-confirm"
      >
        <Image
          source={{ uri: phase.uri }}
          style={[
            styles.preview,
            {
              width: frameWidth,
              height: frameHeight,
              borderColor: phase.read === 'expiry' ? DETECTED : 'transparent',
            },
          ]}
          resizeMode="contain"
        />
        {phase.read === 'failed' ? (
          <View style={styles.stack} testID="capture-failed">
            <InlineNotice text={t('capture.failed')} colorScheme="dark" />
            <Text style={[styles.footnote, { color: dark.textSecondary }]}>
              {t('capture.failedTip')}
            </Text>
          </View>
        ) : null}
        <View style={[styles.dateBox, { backgroundColor: dark.surface }]}>
          <Text style={[styles.caption, { color: dark.textSecondary }]}>
            {t('passport.expiry')}
          </Text>
          <Text style={[styles.numeric, { color: dark.textPrimary }]} testID="capture-date">
            {phase.expiry ? isolateLtr(numDate(phase.expiry)) : '—'}
          </Text>
          {phase.read === 'expiry' ? (
            <Text
              style={[
                styles.footnote,
                styles.tag,
                {
                  backgroundColor: phase.edited ? dark.tag : dark.successSubtleBg,
                  color: phase.edited ? dark.textSecondary : dark.successSubtleFg,
                },
              ]}
            >
              {phase.edited ? t('capture.corrected') : t('capture.detected')}
            </Text>
          ) : null}
          <View style={styles.startAlign}>
            <Button
              kind="text"
              label={t('capture.fix')}
              onPress={() => fixDate(phase)}
              colorScheme="dark"
              testID="capture-fix"
            />
          </View>
        </View>
        {past ? (
          <InlineNotice
            text={t('capture.pastDate', { date: isolateLtr(numDate(phase.expiry!)) })}
            colorScheme="dark"
          />
        ) : null}
        {phase.expiry ? (
          <Button
            kind="primary"
            label={t('capture.saveBoth')}
            onPress={() =>
              finish({
                kind: 'photo',
                uri: phase.uri,
                expiry: phase.expiry,
                edited: phase.edited || phase.read === 'failed',
              })
            }
            colorScheme="dark"
            testID="capture-save"
          />
        ) : null}
        <Button
          kind={phase.expiry ? 'text' : 'primary'}
          label={t('capture.retake')}
          onPress={() => void retake(phase.uri)}
          colorScheme="dark"
          testID="capture-retake"
        />
        {!phase.expiry ? (
          <Button
            kind="text"
            label={t('capture.savePhotoOnly')}
            onPress={() => finish({ kind: 'photo', uri: phase.uri, expiry: null, edited: false })}
            colorScheme="dark"
            testID="capture-save-photo-only"
          />
        ) : null}
      </ScrollView>
    );
  }

  const confirming = phase?.kind === 'confirm' || phase?.kind === 'reading';
  return (
    <Modal
      visible
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={close}
    >
      <SecureWindow style={[styles.screen, { paddingTop: insetsTop }]} testID="capture-screen">
        <StatusBar style="light" />
        <View style={styles.bar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('capture.close')}
            onPress={close}
            style={styles.round48}
            testID="capture-close"
          >
            <ClearIcon color={FRAME} />
          </Pressable>
          <Text style={[styles.barTitle, { color: FRAME }]} accessibilityRole="header">
            {confirming ? t('capture.confirmTitle') : t('capture.title')}
          </Text>
          {shown?.kind === 'camera' ? (
            <Pressable
              accessibilityRole="switch"
              accessibilityLabel={t('capture.torch')}
              accessibilityState={{ checked: torch }}
              onPress={() => setTorch((v) => !v)}
              style={styles.round48}
              testID="capture-torch"
            >
              <Text style={[styles.bodyStrong, { color: torch ? DETECTED : FRAME }]}>⚡</Text>
            </Pressable>
          ) : (
            <View style={styles.round48} />
          )}
        </View>
        {body}
      </SecureWindow>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SPACE },
  fill: { flex: 1 },
  bar: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    zIndex: 2,
  },
  barTitle: {
    flex: 1,
    fontFamily: fonts.semibold,
    fontSize: 18,
    lineHeight: 24,
    textAlign: 'center',
  },
  round48: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  pad: { padding: 24 },
  stack: { gap: 12, alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  startAlign: { alignItems: 'flex-start' },
  frame: { position: 'absolute', top: '30%', alignSelf: 'center' },
  corner: { position: 'absolute', width: 28, height: 28, borderColor: FRAME },
  tl: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 },
  tr: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 },
  br: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 },
  band: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 8,
    borderWidth: 2,
    borderColor: BAND,
    borderRadius: 8,
    backgroundColor: 'rgba(3,6,15,0.25)',
  },
  hints: {
    position: 'absolute',
    top: '72%',
    alignSelf: 'center',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
  },
  pill: {
    fontFamily: fonts.medium,
    fontSize: 15,
    lineHeight: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    textAlign: 'center',
  },
  pillBox: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill },
  shutterRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: FRAME,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterFill: { width: 52, height: 52, borderRadius: 26, backgroundColor: FRAME },
  preview: { borderRadius: radius.md, borderWidth: 2, alignSelf: 'center' },
  dateBox: { borderRadius: radius.md, padding: 16, gap: 6 },
  tag: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  numeric: {
    fontFamily: fonts.semibold,
    fontSize: 28,
    lineHeight: 34,
    fontVariant: ['tabular-nums'],
    textAlign: 'left',
  },
  title2: { fontFamily: fonts.semibold, fontSize: 22, lineHeight: 28 },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24 },
  bodyStrong: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 24 },
  callout: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 20 },
  caption: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, textAlign: 'left' },
  footnote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, textAlign: 'left' },
  centerText: { textAlign: 'center' },
});
