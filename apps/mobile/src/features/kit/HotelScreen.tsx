/**
 * Sprint 8 design 4: adding or editing a hotel (AC-1). A full screen like
 * FlightScreen: no steps, errors from the first save on, the server's limit
 * and the trip's dates held there too (save_hotel).
 */
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import * as Crypto from 'expo-crypto';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, Alert, Text, View } from 'react-native';

import { Button, DateField, TextField } from '@/components/fields';
import { InlineNotice } from '@/components/formControls';
import { useAuth } from '@/features/auth/AuthProvider';
import { isolateLtr, isolateOwn } from '@/features/globe/BoardingPassCard';
import { codePointLength, formatDate, fromPgDate, toPgDate } from '@/features/trips/tripDates';
import { colors, type ColorScheme } from '@/theme/tokens';

import { saveHotel } from './kitApi';
import {
  HOTEL_FIELDS,
  hotelDefaults,
  hotelErrors,
  hotelPayload,
  LIMITS,
  type Hotel,
  type HotelError,
  type HotelField,
  type HotelForm,
  numDate,
  numRange,
} from './kitModel';
import { alignFor } from './DriverCard';
import { FormShell, styles } from './kitUi';

export interface KitTrip {
  id: string;
  title: string;
  countryAdm0: string;
  startDate: string;
  endDate: string;
}

const formOf = (
  h: Hotel | null,
  defaults: { checkIn: string | null; checkOut: string | null },
): HotelForm =>
  h
    ? {
        name: h.name,
        addressEn: h.addressEn,
        addressLocal: h.addressLocal ?? '',
        phone: h.phone ?? '',
        checkIn: h.checkIn,
        checkOut: h.checkOut,
        bookingRef: h.bookingRef ?? '',
      }
    : { name: '', addressEn: '', addressLocal: '', phone: '', bookingRef: '', ...defaults };

/** A counter from `from` code points on (design 4.2). */
const counter = (v: string, from: number, max: number) => {
  const n = codePointLength(v.trim());
  return n >= from ? `${n}/${max}` : undefined;
};

export function HotelScreen({
  trip,
  hotel,
  hotels,
  colorScheme,
  insetsTop,
  insetsBottom,
  onClose,
  onSaved,
}: {
  trip: KitTrip;
  /** Null: a new hotel. */
  hotel: Hotel | null;
  /** The trip's hotels, for the new one's dates. */
  hotels: Hotel[];
  colorScheme: ColorScheme;
  insetsTop: number;
  insetsBottom: number;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const { t } = useTranslation();
  const p = colors[colorScheme];
  const { recheckConsent } = useAuth();
  const [id] = useState(() => hotel?.id ?? Crypto.randomUUID());
  const [initial] = useState(() => formOf(hotel, hotelDefaults(hotels, trip)));
  const [values, setValues] = useState(initial);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<'offline' | 'limit' | 'dates' | 'gone' | 'error' | null>(
    null,
  );
  const refs = useRef<Partial<Record<HotelField, { focus?: () => void } | null>>>({});
  const range = isolateLtr(numRange(trip.startDate, trip.endDate));

  const errors = tried ? hotelErrors(values, trip) : {};
  const text = (field: HotelField, e: HotelError | undefined): string | undefined => {
    if (!e) return undefined;
    if (e === 'tooLong') {
      if (field === 'bookingRef') return t('hotel.err.bookingRef');
      return t('form.err.tooLong', { max: field === 'name' ? LIMITS.hotelName : LIMITS.address });
    }
    if (e === 'phone') return t('phone.err');
    if (e === 'outsideTrip') return t('hotel.err.outsideTrip', { range });
    if (e === 'order') return t('hotel.err.order');
    return t(`hotel.err.${field}`);
  };
  const set = (patch: Partial<HotelForm>) => setValues((v) => ({ ...v, ...patch }));

  const pick = (field: 'checkIn' | 'checkOut') => {
    DateTimePickerAndroid.open({
      mode: 'date',
      value: fromPgDate(
        values[field] ?? (field === 'checkOut' ? values.checkIn : null) ?? trip.startDate,
      ),
      minimumDate: fromPgDate(trip.startDate),
      maximumDate: fromPgDate(trip.endDate),
      positiveButton: { label: t('datePicker.ok') },
      negativeButton: { label: t('datePicker.cancel') },
      onValueChange: (_e, date) => {
        const picked = toPgDate(date);
        // Design 4.3: a check-in after the check-out empties the check-out, no error.
        if (field === 'checkIn' && values.checkOut && values.checkOut <= picked) {
          set({ checkIn: picked, checkOut: null });
        } else set({ [field]: picked });
      },
    });
  };

  const changed = JSON.stringify(values) !== JSON.stringify(initial);
  const back = () => {
    if (busy) return;
    if (!changed) return onClose();
    Alert.alert(t('flight.discardTitle'), t('flight.discardBody'), [
      { text: t('flight.keep'), style: 'cancel' },
      { text: t('flight.discard'), style: 'destructive', onPress: onClose },
    ]);
  };

  const save = async () => {
    setTried(true);
    const found = hotelErrors(values, trip);
    const first = HOTEL_FIELDS.find((f) => found[f]);
    if (first) {
      refs.current[first]?.focus?.();
      AccessibilityInfo.announceForAccessibility(text(first, found[first]) ?? '');
      return;
    }
    setBusy(true);
    setNotice(null);
    let result = await saveHotel(id, trip.id, hotelPayload(values));
    if (result === 'consent' && (await recheckConsent())) {
      result = await saveHotel(id, trip.id, hotelPayload(values));
    }
    setBusy(false);
    if (result === 'ok') {
      AccessibilityInfo.announceForAccessibility(t('hotel.saved', { name: values.name.trim() }));
      onSaved(values.name.trim());
    } else if (result === 'gone') {
      // The trip (a new hotel) or the hotel (an edit, deleted elsewhere) is gone.
      if (!hotel) {
        Alert.alert(t('flight.tripGone'));
        onClose();
      } else setNotice('gone');
    } else if (result === 'offline' || result === 'limit' || result === 'dates') setNotice(result);
    else if (result !== 'consent') setNotice('error');
  };

  const noticeText = {
    offline: t('hotel.saveOffline'),
    limit: t('hotels.limit'),
    dates: t('hotel.datesChanged', { range }),
    gone: t('hotel.gone'),
    error: t('hotel.saveError'),
  };

  return (
    <FormShell
      title={t(hotel ? 'hotel.titleEdit' : 'hotel.titleNew')}
      subtitle={isolateOwn(trip.title)}
      colorScheme={colorScheme}
      insetsTop={insetsTop}
      insetsBottom={insetsBottom}
      onBack={back}
      testID="hotel-screen"
      footer={
        <>
          {notice ? (
            <InlineNotice
              text={noticeText[notice]}
              colorScheme={colorScheme}
              testID="hotel-notice"
            />
          ) : null}
          {notice === 'gone' ? (
            <Button
              kind="primary"
              label={t('flight.close')}
              onPress={onClose}
              colorScheme={colorScheme}
              testID="hotel-save"
            />
          ) : (
            <Button
              kind="primary"
              label={t('hotel.save')}
              busy={busy}
              busyLabel={t('hotel.saving')}
              onPress={() => void save()}
              colorScheme={colorScheme}
              testID="hotel-save"
            />
          )}
        </>
      }
    >
      <TextField
        ref={(r) => void (refs.current.name = r)}
        label={t('hotel.name')}
        value={values.name}
        onChangeText={(name) => set({ name })}
        autoCapitalize="words"
        error={text('name', errors.name)}
        counter={counter(values.name, 64, LIMITS.hotelName)}
        colorScheme={colorScheme}
        testID="hotel-name"
      />
      <TextField
        ref={(r) => void (refs.current.addressEn = r)}
        label={t('hotel.addressEn')}
        help={t('hotel.addressEnHelp')}
        value={values.addressEn}
        onChangeText={(addressEn) => set({ addressEn })}
        multiline
        style={{ textAlign: alignFor('ltr'), writingDirection: 'ltr' }}
        error={text('addressEn', errors.addressEn)}
        counter={counter(values.addressEn, 180, LIMITS.address)}
        colorScheme={colorScheme}
        testID="hotel-address-en"
      />
      <TextField
        ref={(r) => void (refs.current.addressLocal = r)}
        label={t('hotel.addressLocal')}
        help={t('hotel.addressLocalHelp')}
        value={values.addressLocal}
        onChangeText={(addressLocal) => set({ addressLocal })}
        multiline
        style={{ textAlign: 'auto' }}
        error={text('addressLocal', errors.addressLocal)}
        counter={counter(values.addressLocal, 180, LIMITS.address)}
        colorScheme={colorScheme}
        testID="hotel-address-local"
      />
      <TextField
        ref={(r) => void (refs.current.phone = r)}
        label={t('hotel.phone')}
        help={t('hotel.phoneHelp')}
        value={values.phone}
        onChangeText={(phone) => set({ phone })}
        keyboardType="phone-pad"
        style={{ textAlign: alignFor('ltr'), writingDirection: 'ltr' }}
        error={text('phone', errors.phone)}
        colorScheme={colorScheme}
        testID="hotel-phone"
      />
      <View style={styles.gap8}>
        <View style={styles.row2}>
          <View style={styles.cell}>
            <DateField
              ref={(r) => void (refs.current.checkIn = r)}
              label={t('hotel.checkIn')}
              value={values.checkIn ? isolateLtr(numDate(values.checkIn)) : null}
              placeholder="—"
              a11yLabel={`${t('hotel.checkIn')}, ${values.checkIn ? formatDate(values.checkIn, t) : t('flight.noDataA11y')}`}
              a11yHint={t('tripForm.dateHint')}
              error={text('checkIn', errors.checkIn)}
              onPress={() => pick('checkIn')}
              colorScheme={colorScheme}
              testID="hotel-check-in"
            />
          </View>
          <View style={styles.cell}>
            <DateField
              ref={(r) => void (refs.current.checkOut = r)}
              label={t('hotel.checkOut')}
              value={values.checkOut ? isolateLtr(numDate(values.checkOut)) : null}
              placeholder="—"
              a11yLabel={`${t('hotel.checkOut')}, ${values.checkOut ? formatDate(values.checkOut, t) : t('flight.noDataA11y')}`}
              a11yHint={t('tripForm.dateHint')}
              error={text('checkOut', errors.checkOut)}
              onPress={() => pick('checkOut')}
              colorScheme={colorScheme}
              testID="hotel-check-out"
            />
          </View>
        </View>
        <Text style={[styles.footnote, { color: p.textSecondary }]}>
          {t('hotel.datesHelp', { range })}
        </Text>
      </View>
      <Text style={[styles.title3, { color: p.textPrimary }]} accessibilityRole="header">
        {t('hotel.booking')}
      </Text>
      <TextField
        ref={(r) => void (refs.current.bookingRef = r)}
        label={t('hotel.bookingRef')}
        help={t('hotel.bookingPrivacy')}
        value={values.bookingRef}
        onChangeText={(bookingRef) => set({ bookingRef })}
        autoCapitalize="characters"
        autoCorrect={false}
        style={{ textAlign: alignFor('ltr'), writingDirection: 'ltr' }}
        error={text('bookingRef', errors.bookingRef)}
        counter={counter(values.bookingRef, 32, LIMITS.ref)}
        colorScheme={colorScheme}
        testID="hotel-booking-ref"
      />
    </FormShell>
  );
}
