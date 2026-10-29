/**
 * Sprint 10 F-025 (design 3–5, 10–14): "My passports" and one passport.
 * Everything stays on this device: the details in SecureStore, the photo in
 * the native vault (ADR-015). The trips' traveler names come in as a prop;
 * this module never reads trips or the network (D8, design 3.3).
 */
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import * as Crypto from 'expo-crypto';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
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

import { BottomSheet } from '@/components/BottomSheet';
import { Button, DateField, TextField } from '@/components/fields';
import { InlineNotice } from '@/components/formControls';
import {
  BackIcon,
  CameraIcon,
  ChevronEndIcon,
  ImageIcon,
  LockIcon,
  PlusIcon,
  TrashIcon,
} from '@/components/icons';
import { formatDate, fromPgDate, toPgDate, todayPg } from '@/features/trips/tripDates';
import { colors, fonts, layout, radius, type ColorScheme } from '@/theme/tokens';

import { CaptureScreen, pickImage, type CaptureResult } from './CaptureScreen';
import {
  holderErrors,
  last4Input,
  LIMITS,
  ME_ID,
  sortHolders,
  type Holder,
  type HolderError,
} from './passportModel';
import {
  deleteHolder,
  loadPassports,
  passportsSnapshot,
  reconcileVault,
  saveHolder,
  usePassports,
} from './passportStore';
import { isolateLtr, isolateOwn, numDate, spaced } from './passportText';
import { PhotoViewer } from './PhotoViewer';
import { vault } from './vault';

interface ScreenBase {
  colorScheme: ColorScheme;
  insetsTop: number;
  insetsBottom: number;
  onToast: (text: string) => void;
}

/** What opens the passport screen: a saved holder, or a new one (maybe with a name). */
export type OpenPassport = { holder: Holder } | { newName: string } | { me: true };

/** Design 3.1: a full screen with a back bar, no bottom bar. */
function Shell({
  title,
  subtitle,
  colorScheme,
  insetsTop,
  insetsBottom,
  onBack,
  footer,
  children,
  testID,
}: {
  title: string;
  subtitle: string;
  colorScheme: ColorScheme;
  insetsTop: number;
  insetsBottom: number;
  onBack: () => void;
  footer?: ReactNode;
  children: ReactNode;
  testID: string;
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
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
        {footer ? (
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
        ) : (
          <View style={{ height: insetsBottom }} />
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Design 5: a screen lock is what protects the photo; checked on every opening and return. */
function useDeviceSecure(): boolean | null {
  const [secure, setSecure] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    const check = () =>
      void vault
        .isDeviceSecure()
        .then((s) => alive && setSecure(s))
        .catch(() => alive && setSecure(false));
    check();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && check());
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return secure;
}

/** Design 3: "me" first, then the others; names from the trips to add. */
export function PassportsScreen({
  suggestions,
  open: initialOpen,
  onBack,
  ...base
}: ScreenBase & {
  suggestions: readonly string[];
  /** Opened straight to one passport (a banner row in the trip kit). */
  open?: OpenPassport;
  onBack: () => void;
}) {
  const { t, i18n } = useTranslation();
  const p = colors[base.colorScheme];
  const { status, holders } = usePassports();
  const [open, setOpen] = useState<OpenPassport | null>(initialOpen ?? null);
  const [dropped, setDropped] = useState<'noLock' | 'invalidated' | null>(null);

  // Raz review (important 1-2): a lock removed, or a key the system dropped,
  // is noticed here, without opening a photo; the explanation shows once.
  useEffect(() => {
    let alive = true;
    const check = () =>
      void reconcileVault().then((kind) => alive && kind !== 'none' && setDropped(kind));
    check();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && check());
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  const [showAll, setShowAll] = useState(false);

  const me = holders.find((h) => h.isMe) ?? null;
  const others = sortHolders(
    holders.filter((h) => !h.isMe),
    i18n.language,
  );
  const shown = showAll ? suggestions : suggestions.slice(0, LIMITS.suggestions);
  const full = holders.filter((h) => !h.isMe).length >= LIMITS.holders;
  const today = todayPg();

  const row = (h: Holder | null, isMe: boolean) => {
    const name = isMe ? t('passport.me') : h!.name;
    const expired = !!h?.expiry && h.expiry < today;
    const state = !h?.expiry ? 'no-date' : expired ? 'expired' : 'ok';
    const line = h?.expiry
      ? t('passport.validUntil', { date: isolateLtr(numDate(h.expiry)) })
      : t('passport.noDate');
    const a11y = [
      name,
      h?.expiry
        ? t('passport.validUntil', { date: formatDate(h.expiry, t) })
        : t('passport.noDate'),
      expired ? t('passport.expired') : null,
      h?.hasPhoto ? t('passport.hasPhotoA11y') : null,
    ]
      .filter(Boolean)
      .join(', ');
    return (
      <Pressable
        key={isMe ? ME_ID : h!.id}
        accessibilityRole="button"
        accessibilityLabel={a11y}
        accessibilityValue={{ text: state }}
        onPress={() => setOpen(h ? { holder: h } : { me: true })}
        style={({ pressed }) => [styles.holderRow, pressed && { backgroundColor: p.pressed }]}
        testID={isMe ? 'passport-holder-me' : `passport-holder-${h!.id}`}
      >
        <View style={[styles.avatar, { backgroundColor: p.tag }]} importantForAccessibility="no">
          <Text style={[styles.bodyStrong, { color: p.textPrimary }]}>{[...name][0] ?? ''}</Text>
        </View>
        <View style={styles.grow} importantForAccessibility="no-hide-descendants">
          <Text style={[styles.bodyStrong, { color: p.textPrimary }]}>
            {isMe ? name : isolateOwn(name)}
          </Text>
          <View style={styles.inline}>
            <Text style={[styles.footnote, { color: p.textSecondary }]}>{line}</Text>
            {expired ? (
              <Text style={[styles.chipAlert, { color: p.textAlert, borderColor: p.textAlert }]}>
                {t('passport.expired')}
              </Text>
            ) : null}
            {h?.hasPhoto ? <CameraIcon color={p.textSecondary} size={16} /> : null}
          </View>
        </View>
        <ChevronEndIcon color={p.textTertiary} />
      </Pressable>
    );
  };

  return (
    <>
      <Shell
        title={t('passport.listTitle')}
        subtitle={t('passport.screenSub')}
        onBack={onBack}
        testID="passports-screen"
        {...base}
      >
        {status === 'error' ? (
          <View style={styles.gap}>
            <InlineNotice
              text={t('passport.readError')}
              colorScheme={base.colorScheme}
              testID="passport-read-error"
            />
            <Button
              kind="text"
              label={t('passport.retry')}
              onPress={() => void loadPassports()}
              colorScheme={base.colorScheme}
              testID="passport-read-error-retry"
            />
          </View>
        ) : status === 'loading' ? (
          <ActivityIndicator color={p.textSecondary} />
        ) : (
          <>
            <View style={[styles.card, { backgroundColor: p.surface }]}>
              {row(me, true)}
              {others.map((h) => row(h, false))}
            </View>
            {shown.length ? (
              <View style={styles.gap}>
                <Text
                  style={[styles.caption, { color: p.textSecondary }]}
                  accessibilityRole="header"
                >
                  {t('passport.fromTrips')}
                </Text>
                <View style={styles.chips}>
                  {shown.map((name, i) => (
                    <Pressable
                      key={name}
                      accessibilityRole="button"
                      accessibilityLabel={t('passport.suggestA11y', { name })}
                      accessibilityHint={t('passport.suggestHint')}
                      disabled={full}
                      onPress={() => setOpen({ newName: name })}
                      hitSlop={4}
                      style={[styles.chip, { borderColor: p.borderControl }]}
                      testID={`passport-suggest-${i}`}
                    >
                      <PlusIcon color={p.textPrimary} size={16} />
                      <Text style={[styles.callout, { color: p.textPrimary }]}>
                        {isolateOwn(name)}
                      </Text>
                    </Pressable>
                  ))}
                  {!showAll && suggestions.length > LIMITS.suggestions ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setShowAll(true)}
                      style={[styles.chip, { borderColor: p.borderControl }]}
                      testID="passport-suggest-more"
                    >
                      <Text style={[styles.callout, { color: p.textPrimary }]}>
                        {t('passport.more', { n: suggestions.length - LIMITS.suggestions })}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ) : null}
            {full ? (
              <Text style={[styles.footnote, { color: p.textSecondary }]} testID="passport-limit">
                {t('passport.limit')}
              </Text>
            ) : (
              <View style={styles.start}>
                <Button
                  kind="link"
                  label={t('passport.addPerson')}
                  onPress={() => setOpen({ newName: '' })}
                  colorScheme={base.colorScheme}
                  testID="passport-add-person"
                />
              </View>
            )}
            <View style={[styles.divider, { backgroundColor: p.borderSubtle }]} />
            <Text style={[styles.footnote, { color: p.textSecondary }]}>
              {t('passport.listFooter')}
            </Text>
          </>
        )}
      </Shell>
      <BottomSheet
        visible={dropped !== null && !open}
        colorScheme={base.colorScheme}
        reduceMotion={false}
        insetsBottom={base.insetsBottom}
        onClose={() => setDropped(null)}
        testID="passport-key-invalidated"
      >
        <View style={styles.gap}>
          <Text style={[styles.title2, { color: p.textPrimary }]} accessibilityRole="header">
            {t('passport.keyGone.title')}
          </Text>
          <Text style={[styles.body, { color: p.textPrimary }]}>
            {dropped === 'noLock' ? t('passport.keyGone.bodyNoLock') : t('passport.keyGone.body')}
          </Text>
          <Button
            kind="text"
            label={t('passport.keyGone.later')}
            onPress={() => setDropped(null)}
            colorScheme={base.colorScheme}
            testID="passport-key-invalidated-later"
          />
        </View>
      </BottomSheet>
      {open ? (
        <PassportScreen
          open={open}
          holders={holders}
          onClose={() => {
            setOpen(null);
            // Opened straight from the trip kit: back returns there.
            if (initialOpen) onBack();
          }}
          {...base}
        />
      ) : null}
    </>
  );
}

const errorKey: Record<HolderError, string> = {
  nameRequired: 'passport.err.nameRequired',
  nameMax: 'passport.err.nameMax',
  nameTaken: 'passport.err.nameTaken',
  last4: 'passport.err.last4',
};

type PhotoState = { kind: 'idle' } | { kind: 'busy' } | { kind: 'error' };

/** Design 4: one person's passport. */
export function PassportScreen({
  open,
  holders,
  onClose,
  colorScheme,
  insetsTop,
  insetsBottom,
  onToast,
}: ScreenBase & { open: OpenPassport; holders: readonly Holder[]; onClose: () => void }) {
  const { t } = useTranslation();
  const p = colors[colorScheme];
  const secure = useDeviceSecure();
  const [saved, setSaved] = useState<Holder | null>(() =>
    'holder' in open ? open.holder : 'me' in open ? (holders.find((h) => h.isMe) ?? null) : null,
  );
  const isMe = 'me' in open || saved?.isMe === true;
  const [id] = useState(() => saved?.id ?? (isMe ? ME_ID : Crypto.randomUUID()));
  const initial = {
    name: saved?.name ?? ('newName' in open ? open.newName : ''),
    expiry: saved?.expiry ?? null,
    last4: saved?.last4 ?? '',
  };
  const [first] = useState(initial);
  const [values, setValues] = useState(initial);
  const [tried, setTried] = useState(false);
  const [trimmed, setTrimmed] = useState(false);
  const [auto, setAuto] = useState<'auto' | 'manual' | null>(null);
  const [photo, setPhoto] = useState<PhotoState>({ kind: 'idle' });
  const [capture, setCapture] = useState<
    { kind: 'camera' } | { kind: 'picked'; uri: string } | null
  >(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const [keyGone, setKeyGone] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const hasPhoto = saved?.hasPhoto === true;
  const noLock = secure === false;

  const form = {
    id: saved?.id ?? null,
    isMe,
    name: values.name,
    last4: noLock ? '' : values.last4,
  };
  const errors = tried ? holderErrors(form, holders) : {};
  const changed = JSON.stringify(values) !== JSON.stringify(first);
  const title = isMe
    ? t('passport.titleMine')
    : values.name.trim() || saved
      ? t('passport.titleOf', { name: isolateOwn(saved?.name || values.name.trim()) })
      : t('passport.titleNew');

  const holderNow = (patch: Partial<Holder> = {}): Holder => ({
    id,
    isMe,
    name: isMe ? '' : values.name.trim(),
    expiry: values.expiry,
    last4: noLock ? null : values.last4 || null,
    hasPhoto,
    ...patch,
  });

  const back = () => {
    if (photo.kind === 'busy') {
      AccessibilityInfo.announceForAccessibility(t('passport.savingPhoto'));
      return;
    }
    if (!changed) return onClose();
    Alert.alert(t('passport.discardTitle'), t('passport.discardBody'), [
      { text: t('passport.discardKeep'), style: 'cancel' },
      { text: t('passport.discardConfirm'), style: 'destructive', onPress: onClose },
    ]);
  };

  const validNow = () => {
    setTried(true);
    const found = holderErrors(form, holders);
    const firstError = found.name ?? found.last4;
    if (firstError) {
      AccessibilityInfo.announceForAccessibility(t(errorKey[firstError]));
      return false;
    }
    return true;
  };

  const save = async () => {
    if (!validNow()) return;
    setSaveError(false);
    try {
      await saveHolder(holderNow());
    } catch {
      setSaveError(true);
      return;
    }
    const text = isMe ? t('passport.savedMine') : t('passport.saved', { name: values.name.trim() });
    AccessibilityInfo.announceForAccessibility(text);
    onToast(text);
    onClose();
  };

  const remove = () => {
    const name = values.name.trim();
    Alert.alert(
      isMe ? t('passport.deleteTitleMine') : t('passport.deleteTitleOf', { name }),
      isMe ? t('passport.deleteBodyMine') : t('passport.deleteBodyOf'),
      [
        { text: t('passport.cancel'), style: 'cancel' },
        {
          text: t('passport.deleteConfirm'),
          style: 'destructive',
          onPress: () =>
            void deleteHolder(id).then(() => {
              AccessibilityInfo.announceForAccessibility(t('passport.deleted'));
              onToast(t('passport.deleted'));
              onClose();
            }),
        },
      ],
    );
  };

  /** Design 4.4: the photo is kept the moment it's confirmed, with the details so far. */
  const keepPhoto = async (result: CaptureResult) => {
    setCapture(null);
    if (result.kind === 'cancelled') return;
    if (result.kind === 'typeInstead') return;
    if (!isMe && !validNow()) {
      await vault.discard(result.uri).catch(() => {});
      return;
    }
    const expiry = result.expiry ?? values.expiry;
    if (result.expiry) {
      setValues((v) => ({ ...v, expiry: result.expiry! }));
      setAuto(result.edited ? 'manual' : 'auto');
    }
    setPhoto({ kind: 'busy' });
    try {
      await vault.savePhoto(id, result.uri);
      const next = holderNow({ hasPhoto: true, expiry });
      await saveHolder(next);
      setSaved(next);
      setPhoto({ kind: 'idle' });
    } catch {
      await vault.discard(result.uri).catch(() => {});
      setPhoto({ kind: 'error' });
    }
  };

  const showPhoto = async () => {
    const result = await vault.openPhoto(id, {
      title: t('viewer.promptTitle'),
      subtitle: isMe
        ? t('viewer.promptSubMine')
        : t('viewer.promptSubOf', { name: values.name.trim() }),
      cancel: t('passport.cancel'),
    });
    if (result.ok) return setViewer(result.base64);
    if (result.error === 'cancelled') return;
    if (result.error === 'invalidated' || result.error === 'missing' || result.error === 'noLock') {
      // Design 11: the photo can't be read any more. A lost key or lock took every
      // photo, so every record follows (Raz review); a missing file is this one only.
      if (result.error === 'missing') {
        const next = holderNow({ hasPhoto: false });
        await saveHolder(next).catch(() => {});
        setSaved(next);
        return onToast(t('passport.fileGone'));
      }
      await reconcileVault(true).catch(() => 'none');
      const mine = passportsSnapshot().holders.find((h) => h.id === id);
      if (mine) setSaved(mine);
      if (result.error === 'noLock') setValues((v) => ({ ...v, last4: '' }));
      return setKeyGone(true);
    }
    onToast(t('viewer.authFailed'));
  };

  const removePhoto = () =>
    Alert.alert(t('passport.removePhotoTitle'), t('passport.removePhotoBody'), [
      { text: t('passport.cancel'), style: 'cancel' },
      {
        text: t('passport.removePhotoConfirm'),
        style: 'destructive',
        onPress: () =>
          void (async () => {
            await vault.deletePhoto(id).catch(() => {});
            const next = holderNow({ hasPhoto: false });
            await saveHolder(next).catch(() => {});
            setSaved(next);
            onToast(t('passport.photoRemoved'));
          })(),
      },
    ]);

  const openDate = () =>
    DateTimePickerAndroid.open({
      mode: 'date',
      value: fromPgDate(values.expiry ?? todayPg()),
      minimumDate: new Date(new Date().getFullYear() - 10, 0, 1),
      maximumDate: new Date(new Date().getFullYear() + 11, 11, 31),
      positiveButton: { label: t('datePicker.ok') },
      negativeButton: { label: t('datePicker.cancel') },
      onValueChange: (_e, date) => {
        setValues((v) => ({ ...v, expiry: toPgDate(date) }));
        if (auto === 'auto') setAuto('manual');
      },
    });

  return (
    <>
      <Shell
        title={title}
        subtitle={t('passport.screenSub')}
        colorScheme={colorScheme}
        insetsTop={insetsTop}
        insetsBottom={insetsBottom}
        onBack={back}
        testID="passport-screen"
        footer={
          <>
            {saveError ? (
              <InlineNotice text={t('passport.saveError')} colorScheme={colorScheme} />
            ) : null}
            <Button
              kind="primary"
              label={t('passport.save')}
              disabled={photo.kind === 'busy'}
              onPress={() => void save()}
              colorScheme={colorScheme}
              testID="passport-save"
            />
          </>
        }
      >
        {noLock ? (
          <View style={[styles.notice, { backgroundColor: p.infoBg }]} testID="passport-no-lock">
            <Text style={[styles.callout, { color: p.infoFg }]}>{t('passport.noLock')}</Text>
            <View style={styles.start}>
              <Button
                kind="text"
                label={t('passport.noLockSettings')}
                onPress={() =>
                  void Linking.sendIntent('android.settings.SECURITY_SETTINGS').catch(() =>
                    Linking.openSettings(),
                  )
                }
                colorScheme={colorScheme}
                testID="passport-no-lock-settings"
              />
            </View>
          </View>
        ) : (
          <View
            style={[styles.notice, styles.row, { backgroundColor: p.infoBg }]}
            testID="passport-notice"
          >
            <LockIcon color={p.infoFg} size={20} />
            <Text style={[styles.callout, styles.grow, { color: p.infoFg }]}>
              {t('passport.notice')}
            </Text>
          </View>
        )}

        {!isMe ? (
          <TextField
            label={t('passport.name')}
            value={values.name}
            onChangeText={(name) => setValues((v) => ({ ...v, name }))}
            error={errors.name ? t(errorKey[errors.name]) : null}
            counter={
              [...values.name.trim()].length >= 50
                ? `${[...values.name.trim()].length}/${LIMITS.name}`
                : null
            }
            maxLength={LIMITS.name * 2}
            colorScheme={colorScheme}
            testID="passport-name"
          />
        ) : null}

        {!noLock && secure !== null ? (
          <View style={styles.gap}>
            <Text style={[styles.caption, { color: p.textSecondary }]} accessibilityRole="header">
              {t('passport.photo')}
            </Text>
            {photo.kind === 'error' ? (
              <InlineNotice
                text={t('passport.photoSaveError')}
                colorScheme={colorScheme}
                testID="passport-photo-error"
              />
            ) : null}
            {hasPhoto || photo.kind === 'busy' ? (
              <View style={[styles.tile, { backgroundColor: p.surface }]}>
                <View
                  style={styles.row}
                  accessible
                  accessibilityLabel={`${t('passport.photoTile')}, ${t('passport.photoTileSub')}`}
                  testID="passport-photo-tile"
                >
                  <View style={[styles.thumb, { backgroundColor: p.tag }]}>
                    {photo.kind === 'busy' ? (
                      <ActivityIndicator color={p.textSecondary} />
                    ) : (
                      <LockIcon color={p.textSecondary} size={24} />
                    )}
                  </View>
                  <View style={styles.grow}>
                    <Text style={[styles.bodyStrong, { color: p.textPrimary }]}>
                      {photo.kind === 'busy' ? t('passport.savingPhoto') : t('passport.photoTile')}
                    </Text>
                    <Text style={[styles.footnote, { color: p.textSecondary }]}>
                      {t('passport.photoTileSub')}
                    </Text>
                  </View>
                </View>
                {photo.kind !== 'busy' ? (
                  <>
                    <Button
                      kind="secondary"
                      label={t('passport.show')}
                      a11yHint={t('passport.showHint')}
                      onPress={() => void showPhoto()}
                      colorScheme={colorScheme}
                      testID="passport-show"
                    />
                    <View style={styles.inline}>
                      <Button
                        kind="text"
                        label={t('passport.retake')}
                        onPress={() => setCapture({ kind: 'camera' })}
                        colorScheme={colorScheme}
                        testID="passport-retake"
                      />
                      <Button
                        kind="text"
                        label={t('passport.removePhoto')}
                        onPress={removePhoto}
                        colorScheme={colorScheme}
                        testID="passport-remove-photo"
                      />
                    </View>
                  </>
                ) : null}
              </View>
            ) : (
              <>
                <View style={styles.buttons}>
                  <View style={styles.half}>
                    <Button
                      kind="secondary"
                      label={t('passport.take')}
                      icon={(c) => <CameraIcon color={c} size={20} />}
                      onPress={() => setCapture({ kind: 'camera' })}
                      colorScheme={colorScheme}
                      testID="passport-take"
                    />
                  </View>
                  <View style={styles.half}>
                    <Button
                      kind="secondary"
                      label={t('passport.gallery')}
                      icon={(c) => <ImageIcon color={c} size={20} />}
                      onPress={() =>
                        void pickImage().then((uri) => uri && setCapture({ kind: 'picked', uri }))
                      }
                      colorScheme={colorScheme}
                      testID="passport-gallery"
                    />
                  </View>
                </View>
                <Text style={[styles.footnote, { color: p.textSecondary }]}>
                  {t('passport.photoHelp')}
                </Text>
              </>
            )}
          </View>
        ) : null}

        <DateField
          label={t('passport.expiry')}
          value={values.expiry ? isolateLtr(numDate(values.expiry)) : null}
          placeholder={t('passport.expiryPlaceholder')}
          a11yLabel={`${t('passport.expiry')}, ${values.expiry ? formatDate(values.expiry, t) : t('passport.noDate')}`}
          a11yHint={t('passport.expiryHint')}
          help={noLock ? t('passport.dateOnlyHelp') : undefined}
          onPress={openDate}
          colorScheme={colorScheme}
          testID="passport-expiry"
        />
        {auto ? (
          <View
            style={[
              styles.autoTag,
              { backgroundColor: auto === 'auto' ? p.successSubtleBg : p.tag },
            ]}
            accessibilityValue={{ text: auto }}
            testID="passport-auto-tag"
          >
            <Text
              style={[
                styles.footnote,
                { color: auto === 'auto' ? p.successSubtleFg : p.textSecondary },
              ]}
            >
              {auto === 'auto' ? t('capture.detected') : t('capture.corrected')}
            </Text>
          </View>
        ) : null}

        {!noLock && secure !== null ? (
          <TextField
            label={t('passport.last4')}
            accessibilityLabel={`${t('passport.last4')}, ${t('passport.last4A11y')}${values.last4 ? `, ${spaced(values.last4)}` : ''}`}
            value={values.last4}
            onChangeText={(text) => {
              const next = last4Input(text);
              setTrimmed(next.trimmed);
              setValues((v) => ({ ...v, last4: next.value }));
            }}
            keyboardType="number-pad"
            autoComplete="off"
            importantForAutofill="no"
            style={styles.ltr}
            help={trimmed ? t('passport.last4Trimmed') : undefined}
            error={errors.last4 ? t(errorKey[errors.last4]) : null}
            colorScheme={colorScheme}
            testID="passport-last4"
          />
        ) : null}

        {saved ? (
          <>
            <View style={[styles.divider, { backgroundColor: p.borderSubtle }]} />
            <View style={styles.start}>
              <Button
                kind="text"
                label={t('passport.delete')}
                icon={(c) => <TrashIcon color={c} size={20} />}
                onPress={remove}
                colorScheme={colorScheme}
                testID="passport-delete"
              />
            </View>
          </>
        ) : null}
      </Shell>

      {capture ? (
        <CaptureScreen
          start={capture}
          insetsTop={insetsTop}
          insetsBottom={insetsBottom}
          onDone={(r) => void keepPhoto(r)}
        />
      ) : null}
      {viewer ? (
        <PhotoViewer
          base64={viewer}
          label={isMe ? t('viewer.a11yMine') : t('viewer.a11yOf', { name: values.name.trim() })}
          insetsTop={insetsTop}
          onClose={() => setViewer(null)}
        />
      ) : null}
      <BottomSheet
        visible={keyGone}
        colorScheme={colorScheme}
        reduceMotion={false}
        insetsBottom={insetsBottom}
        onClose={() => setKeyGone(false)}
        testID="passport-key-invalidated"
      >
        <View style={styles.gap}>
          <Text style={[styles.title2, { color: p.textPrimary }]} accessibilityRole="header">
            {t('passport.keyGone.title')}
          </Text>
          <Text style={[styles.body, { color: p.textPrimary }]}>
            {noLock ? t('passport.keyGone.bodyNoLock') : t('passport.keyGone.body')}
          </Text>
          {!noLock ? (
            <Button
              kind="primary"
              label={t('passport.keyGone.retake')}
              onPress={() => {
                setKeyGone(false);
                setCapture({ kind: 'camera' });
              }}
              colorScheme={colorScheme}
              testID="passport-key-invalidated-retake"
            />
          ) : null}
          <Button
            kind="text"
            label={t('passport.keyGone.later')}
            onPress={() => setKeyGone(false)}
            colorScheme={colorScheme}
            testID="passport-key-invalidated-later"
          />
        </View>
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, gap: 4 },
  back: {
    width: layout.touchTargetMin,
    height: layout.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  barTitle: { fontFamily: fonts.semibold, fontSize: 20, lineHeight: 26, textAlign: 'left' },
  content: { padding: 16, gap: 16 },
  footer: { paddingHorizontal: 16, paddingTop: 12, gap: 8, borderTopWidth: 1 },
  grow: { flex: 1 },
  gap: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  start: { alignItems: 'flex-start' },
  card: { borderRadius: radius.lg, overflow: 'hidden' },
  holderRow: {
    minHeight: 64,
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: 40,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  chipAlert: {
    fontFamily: fonts.medium,
    fontSize: 12,
    lineHeight: 16,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 6,
  },
  notice: { borderRadius: radius.md, padding: 12, gap: 8 },
  tile: { borderRadius: radius.md, padding: 12, gap: 12 },
  thumb: {
    width: 72,
    height: 96,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  half: { flexGrow: 1, flexBasis: 160 },
  autoTag: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 2,
    marginTop: -8,
  },
  ltr: { textAlign: 'left', writingDirection: 'ltr', fontVariant: ['tabular-nums'] },
  divider: { height: 1 },
  caption: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, textAlign: 'left' },
  title2: { fontFamily: fonts.semibold, fontSize: 22, lineHeight: 28, textAlign: 'left' },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, textAlign: 'left' },
  bodyStrong: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 24, textAlign: 'left' },
  callout: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 20, textAlign: 'left' },
  footnote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, textAlign: 'left' },
});
