/**
 * The trip form (sprint 2 F-006, design 3): a full-screen modal for a new
 * trip or an edit. The country is fixed (AC-2). The trip id is made when the
 * form opens, so a retry after a lost answer can't create a second trip
 * (AC-3). Nothing is saved anywhere until "save" succeeds (design 3.4).
 */
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import NetInfo from '@react-native-community/netinfo';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  findNodeHandle,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';

import {
  Button,
  DateField,
  TextField,
  type TextInputHandle,
  type ViewHandle,
} from '@/components/fields';
import { InlineNotice } from '@/components/formControls';
import { TrashIcon } from '@/components/icons';
import { useAuth } from '@/features/auth/AuthProvider';
import type { CountryInfo } from '@/features/globe/countryData';
import {
  colors,
  fonts,
  highlightColor,
  layout,
  limits,
  radius,
  timing,
  type ColorScheme,
} from '@/theme/tokens';

import { codePointLength, formatDate, fromPgDate, toPgDate, todayPg } from './tripDates';
import {
  emptyForm,
  firstErrorField,
  formFromTrip,
  isFormChanged,
  onTitleBlur,
  tripFields,
  validateTripForm,
  withStartDate,
  withTitle,
  type TripFormErrors,
  type TripFormField,
  type TripFormValues,
} from './tripFormRules';
import { createTrip, deleteTrip, updateTrip, type Trip, type WriteResult } from './tripsApi';

export type TripFormTarget =
  { kind: 'new'; country: CountryInfo } | { kind: 'edit'; country: CountryInfo; trip: Trip };

/** How the form ended, for the card and the toast. */
export type TripFormResult =
  | { kind: 'created' | 'updated'; trip: Trip }
  | { kind: 'deleted'; trip: Trip; alreadyGone: boolean };

type Notice = 'offline' | 'saveError' | 'gone' | 'consent' | 'deleteOffline' | 'deleteError' | null;

/** "1,840": Hermes has no Intl, so no toLocaleString. */
function thousands(n: number): string {
  return String(n).replace(/B(?=(d{3})+(?!d))/g, ',');
}

/** The country's name in the app's language (design 3.2). */
export function countryName(country: CountryInfo, language: string): string {
  return language === 'he' ? country.nameHe : country.nameEn;
}

/** A write that takes longer than this counts as failed; a retry sends the same id (design 3.4). */
function withTimeout(write: Promise<WriteResult>, ms: number): Promise<WriteResult> {
  return Promise.race([
    write,
    new Promise<WriteResult>((resolve) => setTimeout(() => resolve('error'), ms)),
  ]);
}

interface Props {
  target: TripFormTarget;
  colorScheme: ColorScheme;
  insetsTop: number;
  insetsBottom: number;
  onClose: () => void;
  onDone: (result: TripFormResult) => void;
}

export function TripForm({ target, colorScheme, insetsTop, insetsBottom, onClose, onDone }: Props) {
  const { t, i18n } = useTranslation();
  const { recheckConsent } = useAuth();
  const palette = colors[colorScheme];
  const country = countryName(target.country, i18n.language);
  const editing = target.kind === 'edit';

  // Made once, when the form opens (AC-3).
  const [tripId] = useState(() => (target.kind === 'edit' ? target.trip.id : Crypto.randomUUID()));
  const [initial] = useState<TripFormValues>(() =>
    target.kind === 'edit' ? formFromTrip(target.trip, country, t) : emptyForm(),
  );
  const [values, setValues] = useState(initial);
  const [submitted, setSubmitted] = useState(false);
  const [returnCleared, setReturnCleared] = useState(false);
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const errors: TripFormErrors = submitted ? validateTripForm(values) : {};

  // "No network" shows as soon as the form opens, and goes when it's back (3.4).
  useEffect(
    () =>
      NetInfo.addEventListener((net) => {
        setNotice((current) =>
          net.isConnected === false
            ? current === 'gone'
              ? current
              : 'offline'
            : current === 'offline'
              ? null
              : current,
        );
      }),
    [],
  );

  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const fieldY = useRef<Partial<Record<TripFormField, number>>>({});
  const startRef = useRef<ViewHandle>(null);
  const endRef = useRef<ViewHandle>(null);
  const titleRef = useRef<TextInputHandle>(null);
  const notesRef = useRef<TextInputHandle>(null);
  const headingRef = useRef<ComponentRef<typeof Text>>(null);
  useEffect(() => {
    const node = findNodeHandle(headingRef.current);
    if (node) AccessibilityInfo.setAccessibilityFocus(node);
  }, []);

  const focusField = (field: TripFormField) => {
    scroll.current?.scrollTo({ y: Math.max(0, (fieldY.current[field] ?? 0) - 16), animated: true });
    if (field === 'title') titleRef.current?.focus();
    else if (field === 'notes') notesRef.current?.focus();
    else {
      const node = findNodeHandle((field === 'startDate' ? startRef : endRef).current);
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }
  };

  const openPicker = (field: 'startDate' | 'endDate') => {
    if (busy) return;
    const isStart = field === 'startDate';
    const current = values[field] ?? (isStart ? todayPg() : (values.startDate ?? todayPg()));
    const maximum = new Date();
    maximum.setFullYear(maximum.getFullYear() + 5);
    DateTimePickerAndroid.open({
      mode: 'date',
      value: fromPgDate(current),
      // The return can be the departure day itself (start of that day, local time).
      minimumDate: !isStart && values.startDate ? fromPgDate(values.startDate) : undefined,
      maximumDate: isStart ? maximum : undefined,
      title: t(isStart ? 'datePicker.titleDeparture' : 'datePicker.titleReturn'),
      positiveButton: { label: t('datePicker.ok') },
      negativeButton: { label: t('datePicker.cancel') },
      onValueChange: (_event, date) => {
        const picked = toPgDate(date);
        if (isStart) {
          const next = withStartDate(values, picked, country, t);
          setValues(next.values);
          setReturnCleared(next.returnCleared);
          // Design 4.1: the return picker follows at once while it is still empty.
          if (!next.values.endDate) setTimeout(() => pickReturnAfter(next.values), 300);
        } else {
          setValues((v) => ({ ...v, endDate: picked }));
          setReturnCleared(false);
        }
      },
    });
  };
  const pickReturnAfter = (after: TripFormValues) => {
    DateTimePickerAndroid.open({
      mode: 'date',
      value: fromPgDate(after.startDate!),
      minimumDate: fromPgDate(after.startDate!),
      title: t('datePicker.titleReturn'),
      positiveButton: { label: t('datePicker.ok') },
      negativeButton: { label: t('datePicker.cancel') },
      onValueChange: (_event, date) => {
        setValues((v) => ({ ...v, endDate: toPgDate(date) }));
        setReturnCleared(false);
      },
    });
  };

  const save = useCallback(async () => {
    if (busy) return;
    setSubmitted(true);
    const found = validateTripForm(values);
    const first = firstErrorField(found);
    if (first) {
      const count = Object.keys(found).length;
      AccessibilityInfo.announceForAccessibility(
        count === 1
          ? t('tripForm.errors.summaryOne')
          : t('tripForm.errors.summaryMany', { n: count }),
      );
      focusField(first);
      return;
    }
    const net = await NetInfo.fetch();
    if (net.isConnected === false) {
      setNotice('offline');
      scroll.current?.scrollTo({ y: 0, animated: true });
      return;
    }
    setBusy('save');
    setNotice(null);
    const fields = tripFields(values);
    const trip: Trip = { id: tripId, countryAdm0: target.country.adm0, ...fields };
    const result = await withTimeout(
      editing ? updateTrip(tripId, fields) : createTrip(trip),
      timing.tripSaveTimeout,
    );
    setBusy(null);
    if (result === 'ok') {
      onDone({ kind: editing ? 'updated' : 'created', trip });
      return;
    }
    if (result === 'consent') {
      // The consent screen opens over this form, which keeps everything (3.4);
      // the user saves again after accepting, seeing what is saved.
      setNotice('consent');
      void recheckConsent();
      return;
    }
    setNotice(result === 'gone' ? 'gone' : result === 'offline' ? 'offline' : 'saveError');
    scroll.current?.scrollTo({ y: 0, animated: true });
  }, [busy, values, tripId, editing, target, t, recheckConsent, onDone]);

  const confirmDelete = () => {
    if (target.kind !== 'edit' || busy) return;
    Alert.alert(t('tripDelete.title'), t('tripDelete.body', { name: target.trip.title }), [
      { text: t('tripDelete.cancel'), style: 'cancel' },
      {
        text: t('tripDelete.confirm'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const net = await NetInfo.fetch();
            if (net.isConnected === false) {
              setNotice('deleteOffline');
              return;
            }
            setBusy('delete');
            const result = await withTimeout(deleteTrip(target.trip.id), timing.tripSaveTimeout);
            setBusy(null);
            if (result === 'ok' || result === 'gone') {
              onDone({ kind: 'deleted', trip: target.trip, alreadyGone: result === 'gone' });
            } else {
              setNotice(result === 'offline' ? 'deleteOffline' : 'deleteError');
            }
          })();
        },
      },
    ]);
  };

  /** ×, Android back: nothing while saving, a confirmation if anything changed (3.5). */
  const requestClose = () => {
    if (busy) return;
    if (notice === 'gone' || !isFormChanged(values, initial)) {
      onClose();
      return;
    }
    Alert.alert(t('tripForm.discardTitle'), t('tripForm.discardBody'), [
      { text: t('tripForm.discardCancel'), style: 'cancel' },
      { text: t('tripForm.discardConfirm'), style: 'destructive', onPress: onClose },
    ]);
  };

  const noticeText =
    notice === 'offline'
      ? t('tripForm.offline')
      : notice === 'saveError'
        ? t('tripForm.saveError')
        : notice === 'gone'
          ? t('tripForm.goneElsewhere')
          : notice === 'consent'
            ? t('tripForm.consentNeeded')
            : notice === 'deleteOffline'
              ? t('tripDelete.offline')
              : notice === 'deleteError'
                ? t('tripDelete.error')
                : null;

  const titleLength = codePointLength(values.title.trim());
  const notesLength = codePointLength(values.notes.trim());
  const errorText = (field: TripFormField) => (errors[field] ? t(errors[field]!) : null);
  const dateA11y = (field: 'startDate' | 'endDate') =>
    t(field === 'startDate' ? 'tripForm.departureA11y' : 'tripForm.returnA11y', {
      date: values[field] ? formatDate(values[field]!, t) : t('tripForm.notSet'),
    });
  const locked = busy !== null;

  return (
    <Modal
      visible
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={requestClose}
    >
      <KeyboardAvoidingView
        style={[styles.screen, { backgroundColor: palette.canvas, paddingTop: insetsTop }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        testID="trip-form"
      >
        <View style={styles.bar}>
          <Text
            ref={headingRef}
            style={[styles.barTitle, { color: palette.textPrimary }]}
            accessibilityRole="header"
            maxFontSizeMultiplier={2}
          >
            {t(editing ? 'tripForm.titleEdit' : 'tripForm.titleNew')}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('tripForm.close')}
            accessibilityState={{ disabled: locked }}
            onPress={requestClose}
            style={styles.close}
            testID="trip-form-close"
          >
            <Svg width={20} height={20} viewBox="0 0 24 24">
              <Path
                d="M6 6l12 12M18 6L6 18"
                stroke={palette.textPrimary}
                strokeWidth={2.2}
                strokeLinecap="round"
                opacity={locked ? 0.38 : 1}
              />
            </Svg>
          </Pressable>
        </View>

        <ScrollView
          ref={scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {noticeText ? (
            <InlineNotice text={noticeText} colorScheme={colorScheme} testID="trip-form-notice" />
          ) : null}

          <View
            style={[
              styles.destination,
              {
                backgroundColor: palette.surface,
                borderColor: colorScheme === 'dark' ? palette.borderSubtle : 'transparent',
              },
            ]}
            accessible
            accessibilityLabel={t('tripForm.destinationA11y', { country })}
          >
            <View style={[styles.strip, { backgroundColor: highlightColor }]} />
            <View style={styles.destinationText}>
              <Text style={[styles.caption, { color: palette.textSecondary }]}>
                {t('tripForm.destination')}
              </Text>
              <Text
                style={[styles.title2, { color: palette.textPrimary }]}
                maxFontSizeMultiplier={2}
              >
                {target.country.nameHe}
              </Text>
              <Text style={[styles.footnote, { color: palette.textSecondary }]} numberOfLines={1}>
                {`⁦${target.country.nameEn}⁩`}
              </Text>
            </View>
            <Text
              style={[styles.code, { backgroundColor: palette.tag, color: palette.textPrimary }]}
            >
              {target.country.adm0}
            </Text>
          </View>

          <View style={styles.dates}>
            <View
              onLayout={(e) => (fieldY.current.startDate = e.nativeEvent.layout.y)}
              style={styles.dateCell}
            >
              <DateField
                ref={startRef}
                label={t('tripForm.departure')}
                value={values.startDate ? formatDate(values.startDate, t) : null}
                placeholder={t('tripForm.pickDate')}
                a11yLabel={dateA11y('startDate')}
                a11yHint={t('tripForm.dateHint')}
                error={errorText('startDate')}
                disabled={locked}
                onPress={() => openPicker('startDate')}
                colorScheme={colorScheme}
                testID="trip-form-start"
              />
            </View>
            <View
              onLayout={(e) => (fieldY.current.endDate = e.nativeEvent.layout.y)}
              style={styles.dateCell}
            >
              <DateField
                ref={endRef}
                label={t('tripForm.return')}
                value={values.endDate ? formatDate(values.endDate, t) : null}
                placeholder={t('tripForm.pickDate')}
                a11yLabel={dateA11y('endDate')}
                a11yHint={t('tripForm.dateHint')}
                error={errorText('endDate')}
                help={returnCleared ? t('tripForm.returnCleared') : null}
                disabled={locked}
                onPress={() => openPicker('endDate')}
                colorScheme={colorScheme}
                testID="trip-form-end"
              />
            </View>
          </View>

          <View onLayout={(e) => (fieldY.current.title = e.nativeEvent.layout.y)}>
            <TextField
              ref={titleRef}
              label={t('tripForm.name')}
              value={values.title}
              placeholder={t('tripForm.namePending')}
              onChangeText={(text) => setValues((v) => withTitle(v, text))}
              onBlur={() => setValues((v) => onTitleBlur(v, country, t))}
              help={values.nameAuto && values.startDate ? t('tripForm.nameAuto') : null}
              error={errorText('title')}
              counter={
                titleLength >= limits.tripNameCounterFrom
                  ? t('tripForm.counter', { n: titleLength, max: limits.tripNameMax })
                  : null
              }
              editable={!locked}
              autoCapitalize="sentences"
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => notesRef.current?.focus()}
              // A safety net only: the real limit counts code points (3.3).
              maxLength={limits.tripNameMax * 2}
              colorScheme={colorScheme}
              testID="trip-form-name"
            />
          </View>

          <View onLayout={(e) => (fieldY.current.notes = e.nativeEvent.layout.y)}>
            <TextField
              ref={notesRef}
              label={t('tripForm.notes')}
              value={values.notes}
              placeholder={t('tripForm.notesPlaceholder')}
              onChangeText={(text) => setValues((v) => ({ ...v, notes: text }))}
              error={errorText('notes')}
              counter={
                notesLength >= limits.tripNotesCounterFrom
                  ? t('tripForm.counter', {
                      n: thousands(notesLength),
                      max: thousands(limits.tripNotesMax),
                    })
                  : null
              }
              editable={!locked}
              multiline
              autoCapitalize="sentences"
              maxLength={limits.tripNotesMax * 2}
              colorScheme={colorScheme}
              testID="trip-form-notes"
            />
          </View>

          {editing ? (
            <View style={styles.deleteRow}>
              <Button
                kind="text"
                label={t('tripForm.delete')}
                busy={busy === 'delete'}
                disabled={locked}
                icon={(color) => <TrashIcon color={color} size={20} />}
                onPress={confirmDelete}
                colorScheme={colorScheme}
                testID="trip-form-delete"
              />
            </View>
          ) : null}
        </ScrollView>

        <View
          style={[
            styles.footer,
            {
              backgroundColor: palette.canvas,
              borderTopColor: palette.borderSubtle,
              paddingBottom: insetsBottom + 12,
            },
          ]}
        >
          {notice === 'gone' ? (
            <Button
              kind="secondary"
              label={t('tripForm.close')}
              onPress={onClose}
              colorScheme={colorScheme}
            />
          ) : (
            <Button
              kind="primary"
              label={t(editing ? 'tripForm.saveEdit' : 'tripForm.save')}
              busy={busy === 'save'}
              busyLabel={t('tripForm.saving')}
              disabled={busy === 'delete'}
              onPress={() => void save()}
              colorScheme={colorScheme}
              testID="trip-form-save"
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: {
    minHeight: layout.formBarHeight,
    paddingStart: 16,
    paddingEnd: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  barTitle: {
    flex: 1,
    fontFamily: fonts.semibold,
    fontSize: 20,
    lineHeight: 26,
    textAlign: 'left',
  },
  close: {
    width: layout.touchTargetMin,
    height: layout.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { padding: 16, gap: 20 },
  destination: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    paddingTop: 20,
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  strip: { position: 'absolute', top: 0, start: 0, end: 0, height: 4 },
  destinationText: { flex: 1 },
  caption: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, textAlign: 'left' },
  title2: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 28, textAlign: 'left' },
  footnote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, textAlign: 'left' },
  code: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    lineHeight: 18,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.xs,
    overflow: 'hidden',
  },
  dates: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  dateCell: { flexGrow: 1, flexBasis: layout.dateFieldMinWidth },
  deleteRow: { marginTop: 4 },
  footer: { paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1 },
});
