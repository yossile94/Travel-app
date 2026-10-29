/**
 * Sprint 11 F-030 (design 12; AC-9, AC-11, D13): an activity, new or edited.
 * A title (1 – 120), a day inside the trip, an optional time, an optional
 * place (from the saved places or the country's list, kept as a snapshot,
 * D4) and an optional note (≤ 500). One save call, a day change included;
 * nothing is saved optimistically.
 */
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import * as Crypto from 'expo-crypto';
import type { TFunction } from 'i18next';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  FlatList,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { Button, DateField, TextField } from '@/components/fields';
import { InlineNotice } from '@/components/formControls';
import { CalendarIcon, ClockIcon, MapPinIcon, NavigateIcon } from '@/components/icons';
import { FormShell } from '@/features/kit/kitUi';
import { navigateUrl } from '@/features/places/PlacesScreen';
import type { Place } from '@/features/places/placesModel';
import type { SavedPlace } from '@/features/places/savedPlaces';
import { codePointLength, formatDate, fromPgDate, toPgDate } from '@/features/trips/tripDates';
import { colors, fonts, layout, type ColorScheme } from '@/theme/tokens';

import { deleteItem, saveItem, type BoardWrite } from './itineraryStore';
import { dayHeading } from './dayText';
import type { Item } from './itineraryModel';

export const TITLE_MAX = 120;
export const NOTE_MAX = 500;

export type ActivityTarget = { kind: 'new'; day: string } | { kind: 'edit'; item: Item };

interface PlaceChoice {
  ref: string;
  name: string;
  lat: number;
  lng: number;
}

/** Design 12.2: the errors, in field order. */
export function activityErrors(
  v: { title: string; day: string | null; note: string },
  trip: { startDate: string; endDate: string },
): { title?: 'titleRequired' | 'titleMax'; day?: 'day'; note?: 'noteMax' } {
  const out: ReturnType<typeof activityErrors> = {};
  const title = v.title.trim();
  if (!title) out.title = 'titleRequired';
  else if (codePointLength(title) > TITLE_MAX) out.title = 'titleMax';
  if (!v.day || v.day < trip.startDate || v.day > trip.endDate) out.day = 'day';
  if (codePointLength(v.note.trim()) > NOTE_MAX) out.note = 'noteMax';
  return out;
}

const toHHMM = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export function ActivityScreen({
  target,
  trip,
  dayIndexOf,
  saved,
  places,
  readOnly,
  colorScheme,
  insetsTop,
  insetsBottom,
  onClose,
  onDone,
}: {
  target: ActivityTarget;
  trip: { id: string; startDate: string; endDate: string };
  /** The 1-based day number of a date, for the toasts. */
  dayIndexOf: (day: string) => number;
  saved: readonly SavedPlace[];
  places: readonly Place[];
  /** Offline: the form shows, nothing saves (design 20). */
  readOnly: boolean;
  colorScheme: ColorScheme;
  insetsTop: number;
  insetsBottom: number;
  onClose: () => void;
  onDone: (toast: string, day: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const p = colors[colorScheme];
  const editing = target.kind === 'edit';
  const start = editing ? target.item : null;
  const [id] = useState(() => (editing ? target.item.id : Crypto.randomUUID()));
  const [title, setTitle] = useState(start?.title ?? '');
  const [day, setDay] = useState<string | null>(editing ? target.item.day : target.day);
  const [time, setTime] = useState<string | null>(start?.time ?? null);
  const [note, setNote] = useState(start?.note ?? '');
  const [place, setPlace] = useState<PlaceChoice | null>(
    start?.placeRef && start.placeName && start.lat !== null && start.lng !== null
      ? { ref: start.placeRef, name: start.placeName, lat: start.lat, lng: start.lng }
      : null,
  );
  const [picking, setPicking] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const errors = activityErrors({ title, day, note }, trip);
  const shownErrors = submitted ? errors : {};

  const pickDay = () =>
    DateTimePickerAndroid.open({
      mode: 'date',
      value: fromPgDate(day ?? trip.startDate),
      minimumDate: fromPgDate(trip.startDate),
      maximumDate: fromPgDate(trip.endDate),
      positiveButton: { label: t('datePicker.ok') },
      negativeButton: { label: t('datePicker.cancel') },
      onValueChange: (_e, d) => setDay(toPgDate(d)),
    });
  const pickTime = () => {
    const at = new Date();
    const [h, m] = (time ?? '09:00').split(':').map(Number);
    at.setHours(h!, m!, 0, 0);
    DateTimePickerAndroid.open({
      mode: 'time',
      is24Hour: true,
      value: at,
      positiveButton: { label: t('datePicker.ok') },
      negativeButton: { label: t('datePicker.cancel') },
      onValueChange: (_e, d) => setTime(toHHMM(d)),
    });
  };

  const save = async () => {
    setSubmitted(true);
    if (Object.keys(errors).length || !day) return;
    if (readOnly) return setNotice(t('activity.offline'));
    setBusy(true);
    setNotice(null);
    const result: BoardWrite = await saveItem(trip.id, id, {
      day,
      time,
      title: title.trim(),
      note: note.trim() || null,
      placeRef: place?.ref ?? null,
      placeName: place?.name ?? null,
      lat: place?.lat ?? null,
      lng: place?.lng ?? null,
    });
    setBusy(false);
    if (result === 'ok')
      return onDone(t('activity.saved', { title: title.trim(), n: dayIndexOf(day) }), day);
    setNotice(
      result === 'offline'
        ? t('activity.offline')
        : result === 'day'
          ? t('activity.datesChanged', {
              range: `${formatDate(trip.startDate, t)} – ${formatDate(trip.endDate, t)}`,
            })
          : result === 'limit'
            ? t('itinerary.dayLimit')
            : result === 'gone'
              ? t('activity.gone')
              : t('activity.saveError'),
    );
  };

  const remove = () => {
    if (!start) return;
    if (readOnly) return setNotice(t('activity.offline'));
    const inRange = start.day >= trip.startDate && start.day <= trip.endDate;
    confirmDelete(t, trip.id, start, inRange ? dayIndexOf(start.day) : null, (r) =>
      r === 'ok' ? onDone(t('activity.deleted'), start.day) : setNotice(t('activity.saveError')),
    );
  };

  return (
    <FormShell
      title={t(editing ? 'activity.titleEdit' : 'activity.titleNew')}
      subtitle={day ? dayHeading(t, i18n.language, dayIndexOf(day), day) : ''}
      colorScheme={colorScheme}
      insetsTop={insetsTop}
      insetsBottom={insetsBottom}
      onBack={onClose}
      testID="activity-screen"
      footer={
        <Button
          kind="primary"
          label={t('activity.save')}
          busy={busy}
          blocked={readOnly}
          onPress={() => void save()}
          colorScheme={colorScheme}
          testID="activity-save"
        />
      }
    >
      {notice ? (
        <InlineNotice text={notice} colorScheme={colorScheme} testID="activity-notice" />
      ) : null}
      <TextField
        label={t('activity.name')}
        value={title}
        onChangeText={setTitle}
        error={shownErrors.title ? t(`activity.err.${shownErrors.title}`) : null}
        help={start?.source === 'auto' ? t('activity.autoHelp') : null}
        editable={!readOnly}
        maxLength={TITLE_MAX * 2}
        colorScheme={colorScheme}
        testID="activity-title"
      />
      <View style={styles.row}>
        <View style={styles.cell}>
          <DateField
            label={t('activity.day')}
            value={day ? formatDate(day, t) : null}
            placeholder={t('activity.day')}
            a11yLabel={`${t('activity.day')}, ${day ? formatDate(day, t) : ''}`}
            a11yHint={t('tripForm.dateHint')}
            error={shownErrors.day ? t('activity.err.day') : null}
            disabled={readOnly}
            onPress={pickDay}
            icon={(c) => <CalendarIcon color={c} />}
            colorScheme={colorScheme}
            testID="activity-day"
          />
        </View>
        <View style={styles.cell}>
          <DateField
            label={t('activity.time')}
            value={time ? `⁦${time}⁩` : null}
            a11yLabel={`${t('activity.time')}, ${time ?? ''}`}
            a11yHint={t('tripForm.dateHint')}
            placeholder={t('activity.time')}
            disabled={readOnly}
            onPress={pickTime}
            icon={(c) => <ClockIcon color={c} />}
            colorScheme={colorScheme}
            testID="activity-time"
          />
        </View>
      </View>
      {time && !readOnly ? (
        <Button
          kind="text"
          label={t('activity.clearTime')}
          onPress={() => setTime(null)}
          colorScheme={colorScheme}
          testID="activity-clear-time"
        />
      ) : null}

      <Text style={[styles.label, { color: p.textSecondary }]}>{t('activity.place')}</Text>
      {place ? (
        <View style={[styles.place, { borderColor: p.borderSubtle }]} testID="activity-place">
          <MapPinIcon color={p.textSecondary} size={20} />
          <Text style={[styles.body, styles.grow, { color: p.textPrimary }]}>{place.name}</Text>
          {!readOnly ? (
            <Button
              kind="text"
              label={t('activity.removePlace')}
              onPress={() => setPlace(null)}
              colorScheme={colorScheme}
              testID="activity-remove-place"
            />
          ) : null}
        </View>
      ) : (
        <Button
          kind="secondary"
          label={t('activity.pickPlace')}
          blocked={readOnly}
          onPress={() => (readOnly ? setNotice(t('activity.offline')) : setPicking(true))}
          colorScheme={colorScheme}
          testID="activity-pick-place"
        />
      )}
      {place ? (
        <Button
          kind="text"
          label={t('itinerary.menu.navigate')}
          icon={(c) => <NavigateIcon color={c} size={20} />}
          onPress={() => void Linking.openURL(navigateUrl(place)).catch(() => {})}
          colorScheme={colorScheme}
          testID="activity-navigate"
        />
      ) : null}

      <TextField
        label={t('activity.note')}
        value={note}
        onChangeText={setNote}
        error={shownErrors.note ? t('activity.err.noteMax') : null}
        multiline
        editable={!readOnly}
        maxLength={NOTE_MAX * 2}
        colorScheme={colorScheme}
        testID="activity-note"
      />
      {editing && !readOnly ? (
        <Button
          kind="text"
          label={t('activity.delete')}
          onPress={remove}
          colorScheme={colorScheme}
          testID="activity-delete"
        />
      ) : null}

      {picking ? (
        <PlacePickerSheet
          saved={saved}
          places={places}
          language={i18n.language}
          colorScheme={colorScheme}
          insetsBottom={insetsBottom}
          onClose={() => setPicking(false)}
          onPick={(choice) => {
            setPicking(false);
            setPlace(choice);
            if (!title.trim()) setTitle(choice.name);
          }}
        />
      ) : null}
    </FormShell>
  );
}

/** Design 12.3: the saved places first, then the country's list, filtered by name. */
function PlacePickerSheet({
  saved,
  places,
  language,
  colorScheme,
  insetsBottom,
  onClose,
  onPick,
}: {
  saved: readonly SavedPlace[];
  places: readonly Place[];
  language: string;
  colorScheme: ColorScheme;
  insetsBottom: number;
  onClose: () => void;
  onPick: (choice: PlaceChoice) => void;
}) {
  const { t } = useTranslation();
  const p = colors[colorScheme];
  const [query, setQuery] = useState('');
  const rows = useMemo(() => {
    const all: (PlaceChoice & { section: 'saved' | 'all' })[] = [
      ...saved.map((s) => ({
        ref: s.ref,
        name: s.name,
        lat: s.lat,
        lng: s.lng,
        section: 'saved' as const,
      })),
      ...places
        .filter((pl) => !saved.some((s) => s.ref === pl.ref))
        .map((pl) => ({
          ref: pl.ref,
          name: (language === 'he' && pl.nameHe) || pl.nameEn,
          lat: pl.lat,
          lng: pl.lng,
          section: 'all' as const,
        })),
    ];
    const q = query.trim().toLowerCase();
    return (q ? all.filter((r) => r.name.toLowerCase().includes(q)) : all).slice(0, 200);
  }, [saved, places, language, query]);
  return (
    <BottomSheet
      visible
      colorScheme={colorScheme}
      reduceMotion={false}
      insetsBottom={insetsBottom}
      onClose={onClose}
      maxHeight={640}
      testID="place-picker"
    >
      <Text style={[styles.title2, { color: p.textPrimary }]} accessibilityRole="header">
        {t('picker.title')}
      </Text>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={t('picker.filter')}
        placeholderTextColor={p.textTertiary}
        accessibilityLabel={t('picker.filter')}
        style={[styles.filter, { borderColor: p.borderControl, color: p.textPrimary }]}
        testID="place-picker-filter"
      />
      <FlatList
        data={rows}
        keyExtractor={(r) => r.ref}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <Text style={[styles.body, { color: p.textSecondary }]}>{t('picker.none')}</Text>
        }
        renderItem={({ item, index }) => (
          <>
            {index === 0 || rows[index - 1]!.section !== item.section ? (
              <Text style={[styles.label, { color: p.textSecondary }]} accessibilityRole="header">
                {t(item.section === 'saved' ? 'picker.saved' : 'picker.all')}
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={() => onPick(item)}
              style={({ pressed }) => [
                styles.pickRow,
                { borderBottomColor: p.borderSubtle },
                pressed && { backgroundColor: p.pressed },
              ]}
              testID={`place-pick-${item.ref}`}
            >
              <Text style={[styles.body, { color: p.textPrimary }]}>{item.name}</Text>
            </Pressable>
          </>
        )}
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  cell: { flexGrow: 1, minWidth: 140 },
  label: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 12,
    textAlign: 'left',
  },
  place: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingStart: 12,
    minHeight: layout.listRowMin,
  },
  grow: { flex: 1 },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, textAlign: 'left' },
  title2: {
    fontFamily: fonts.semibold,
    fontSize: 22,
    lineHeight: 28,
    marginTop: 8,
    textAlign: 'left',
  },
  filter: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 48,
    paddingHorizontal: 12,
    marginVertical: 8,
  },
  pickRow: {
    minHeight: layout.listRowMin,
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});

/**
 * Design 12.4 (Raz ח7): the one delete confirmation, for the form and for the
 * board's menu. `dayIndex` null: the item is outside the trip's dates.
 */
export function confirmDelete(
  t: TFunction,
  tripId: string,
  item: { id: string; title: string },
  dayIndex: number | null,
  onResult: (result: BoardWrite) => void,
) {
  Alert.alert(
    t('activity.deleteTitle'),
    dayIndex !== null
      ? t('activity.deleteBody', { title: item.title, n: dayIndex })
      : t('activity.deleteBodyOut', { title: item.title }),
    [
      { text: t('activity.close'), style: 'cancel' },
      {
        text: t('activity.deleteConfirm'),
        style: 'destructive',
        onPress: () => void deleteItem(tripId, item.id).then(onResult),
      },
    ],
  );
}
