/**
 * Sprint 8 design 3, 5: "Hotels" in an open trip row. Each hotel is a row
 * with "Show to driver", which works offline and is never blocked (AC-5);
 * the row opens the hotel's sheet (address, phone, the hidden booking number,
 * the insurance hotline, edit and delete). Adding and editing need a network.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/fields';
import { InlineNotice } from '@/components/formControls';
import {
  BedIcon,
  CarIcon,
  NavigateIcon,
  PencilIcon,
  PhoneIcon,
  PlusIcon,
  ShareIcon,
  TrashIcon,
} from '@/components/icons';
import { isolateLtr, isolateOwn } from '@/features/globe/BoardingPassCard';
import { useReduceMotion } from '@/features/globe/useReduceMotion';
import { formatDate, formatRange, todayPg } from '@/features/trips/tripDates';
import { colors, type ColorScheme } from '@/theme/tokens';

import { DriverCard, mapsUrl, shareText, textDirection } from './DriverCard';
import { HotelScreen, type KitTrip } from './HotelScreen';
import { deleteHotel } from './kitApi';
import {
  byCheckIn,
  HOTELS_PER_TRIP,
  isNowHotel,
  nights,
  type Hotel,
  type Insurance,
} from './kitModel';
import { refreshTripKit } from './kitStore';
import { formatPhone, telUrl } from './phone';
import { DialRow, openUrl, SecretRow, SectionTitle, styles } from './kitUi';

export function nightsText(h: Hotel, t: (k: string, o?: Record<string, unknown>) => string) {
  const n = nights(h.checkIn, h.checkOut);
  return n === 1 ? t('hotels.nightOne') : t('hotels.nights', { n });
}

function HotelRow({
  hotel,
  today,
  colorScheme,
  onOpen,
  onDriver,
}: {
  hotel: Hotel;
  today: string;
  colorScheme: ColorScheme;
  onOpen: () => void;
  onDriver: () => void;
}) {
  const { t } = useTranslation();
  const p = colors[colorScheme];
  const range = isolateLtr(formatRange(hotel.checkIn, hotel.checkOut, t));
  const n = nightsText(hotel, t);
  const now = isNowHotel(hotel, today);
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: p.surface },
        colorScheme === 'dark' && { borderWidth: 1, borderColor: p.borderSubtle },
      ]}
      testID={`card-hotel-${hotel.id}`}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('hotels.rowA11y', {
          name: hotel.name,
          in: formatDate(hotel.checkIn, t),
          out: formatDate(hotel.checkOut, t),
          nights: n,
        })}
        accessibilityHint={t('hotels.rowHint')}
        onPress={onOpen}
        style={styles.gap4}
        testID={`card-hotel-${hotel.id}-open`}
      >
        <View style={styles.rowLine}>
          <BedIcon color={p.textSecondary} size={20} />
          <Text
            style={[styles.bodyStrong, styles.grow, { color: p.textPrimary }]}
            numberOfLines={2}
          >
            {isolateOwn(hotel.name)}
          </Text>
          {now ? (
            <View
              style={[styles.chip, { backgroundColor: p.successSubtleBg }]}
              testID={`card-hotel-${hotel.id}-now`}
            >
              <Text style={[styles.chipText, { color: p.successSubtleFg }]}>{t('hotels.now')}</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.footnote, styles.tabular, { color: p.textSecondary }]}>
          {t('hotels.rowDates', { range, nights: n })}
        </Text>
      </Pressable>
      <View style={styles.actions}>
        <Button
          kind="secondary"
          outlined={colorScheme === 'dark'}
          label={t('hotels.driver')}
          a11yLabel={t('hotels.driverA11y', { name: hotel.name })}
          a11yHint={t('hotels.driverHint')}
          icon={(c) => <CarIcon color={c} size={20} />}
          onPress={onDriver}
          colorScheme={colorScheme}
          testID={`card-hotel-${hotel.id}-driver`}
        />
      </View>
    </View>
  );
}

export function HotelsSection({
  trip,
  hotels,
  insurance,
  status,
  offline,
  colorScheme,
  onToast,
}: {
  trip: KitTrip;
  hotels: Hotel[];
  insurance: Insurance | null;
  status: 'loading' | 'ready' | 'error';
  /** The card shows the device copy: writes are blocked (sprint 4 design 10.3). */
  offline: boolean;
  colorScheme: ColorScheme;
  onToast: (text: string) => void;
}) {
  const { t } = useTranslation();
  const p = colors[colorScheme];
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion() ?? false;
  const [screen, setScreen] = useState<{ hotel: Hotel | null } | null>(null);
  const [sheet, setSheet] = useState<string | null>(null);
  const [driver, setDriver] = useState<Hotel | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const sorted = byCheckIn(hotels);
  const open = sorted.find((h) => h.id === sheet) ?? null;
  const today = todayPg();
  const guard = (action: () => void) => () => (offline ? setBlocked(true) : action());
  const go = (url: string) => void openUrl(url).then((ok) => !ok && onToast(t('app.noHandler')));

  const remove = (h: Hotel) =>
    Alert.alert(t('hotel.deleteTitle', { name: h.name }), t('hotel.deleteBody'), [
      { text: t('flight.cancel'), style: 'cancel' },
      {
        text: t('hotel.deleteConfirm'),
        style: 'destructive',
        onPress: () =>
          void (async () => {
            setBusy(true);
            const result = await deleteHotel(h.id);
            setBusy(false);
            if (result === 'ok' || result === 'gone') {
              setSheet(null);
              onToast(t('hotel.deleted'));
              void refreshTripKit(trip.id);
            } else if (result === 'offline') onToast(t('hotel.deleteOffline'));
            else onToast(t('hotel.saveError'));
          })(),
      },
    ]);

  return (
    <View style={styles.section} testID="card-hotels">
      <SectionTitle text={t('hotels.title')} colorScheme={colorScheme} />
      {status === 'loading' && sorted.length === 0 ? (
        <View
          style={[styles.skeleton, { backgroundColor: p.skeleton }]}
          testID="card-hotels-skeleton"
        />
      ) : null}
      {sorted.map((h) => (
        <HotelRow
          key={h.id}
          hotel={h}
          today={today}
          colorScheme={colorScheme}
          onOpen={() => setSheet(h.id)}
          onDriver={() => setDriver(h)}
        />
      ))}
      {status === 'error' ? (
        <View style={styles.rowLine}>
          <Text
            style={[styles.footnote, styles.grow, { color: p.textSecondary }]}
            testID="card-hotels-error"
          >
            {t('hotels.loadError')}
          </Text>
          <Button
            kind="text"
            label={t('flights.retry')}
            onPress={() => void refreshTripKit(trip.id)}
            colorScheme={colorScheme}
            testID="card-hotels-retry"
          />
        </View>
      ) : null}
      {blocked ? (
        <InlineNotice
          text={t('offline.readOnly')}
          colorScheme={colorScheme}
          testID="card-hotel-readonly"
        />
      ) : null}
      {sorted.length >= HOTELS_PER_TRIP ? (
        <Text style={[styles.footnote, { color: p.textSecondary }]} testID="card-hotel-add-limit">
          {t('hotels.limit')}
        </Text>
      ) : status === 'ready' ? (
        <Button
          kind="link"
          label={t('hotels.add')}
          icon={(c) => <PlusIcon color={c} size={20} />}
          blocked={offline}
          onPress={guard(() => setScreen({ hotel: null }))}
          colorScheme={colorScheme}
          testID="card-hotel-add"
        />
      ) : null}
      {sorted.length === 0 && status === 'ready' ? (
        <Text style={[styles.footnote, { color: p.textSecondary }]} testID="card-hotels-empty-help">
          {t('hotels.emptyHelp')}
        </Text>
      ) : null}

      {screen ? (
        <HotelScreen
          trip={trip}
          hotel={screen.hotel}
          hotels={sorted}
          colorScheme={colorScheme}
          insetsTop={insets.top}
          insetsBottom={insets.bottom}
          onClose={() => setScreen(null)}
          onSaved={() => {
            setScreen(null);
            void refreshTripKit(trip.id);
          }}
        />
      ) : null}
      <BottomSheet
        visible={open !== null}
        colorScheme={colorScheme}
        reduceMotion={reduceMotion}
        insetsBottom={insets.bottom}
        onClose={() => setSheet(null)}
        maxHeight={640}
        testID="hotel-sheet"
      >
        {open ? (
          <ScrollView contentContainerStyle={styles.sheetBody}>
            <Text style={[styles.title2, { color: p.textPrimary }]} accessibilityRole="header">
              {isolateOwn(open.name)}
            </Text>
            <Text style={[styles.footnote, styles.tabular, { color: p.textSecondary }]}>
              {t('hotels.rowDates', {
                range: isolateLtr(formatRange(open.checkIn, open.checkOut, t)),
                nights: nightsText(open, t),
              })}
            </Text>
            <Button
              kind="primary"
              label={t('hotels.driver')}
              a11yLabel={t('hotels.driverA11y', { name: open.name })}
              icon={(c) => <CarIcon color={c} size={20} />}
              onPress={() => setDriver(open)}
              colorScheme={colorScheme}
              testID="hotel-sheet-driver"
            />
            <View style={styles.actions}>
              <Button
                kind="secondary"
                outlined={colorScheme === 'dark'}
                label={t('hotel.navigate')}
                a11yLabel={t('hotel.navigateA11y', { name: open.name })}
                icon={(c) => <NavigateIcon color={c} size={20} />}
                onPress={() => go(mapsUrl(open))}
                colorScheme={colorScheme}
                testID="hotel-sheet-navigate"
              />
              {open.phone ? (
                <Button
                  kind="secondary"
                  outlined={colorScheme === 'dark'}
                  label={t('hotel.call')}
                  icon={(c) => <PhoneIcon color={c} size={20} />}
                  onPress={() => go(telUrl(open.phone!))}
                  colorScheme={colorScheme}
                  testID="hotel-sheet-call"
                />
              ) : null}
              <Button
                kind="secondary"
                outlined={colorScheme === 'dark'}
                label={t('hotel.share')}
                a11yLabel={t('hotel.shareA11y')}
                icon={(c) => <ShareIcon color={c} size={20} />}
                onPress={() => void Share.share({ message: shareText(open) }).catch(() => {})}
                colorScheme={colorScheme}
                testID="hotel-sheet-share"
              />
            </View>
            <View style={styles.gap4}>
              <SectionTitle text={t('hotel.address')} colorScheme={colorScheme} />
              {open.addressLocal ? (
                <Text
                  selectable
                  style={[
                    styles.body,
                    { color: p.textPrimary, writingDirection: textDirection(open.addressLocal) },
                    textDirection(open.addressLocal) === 'rtl'
                      ? { textAlign: 'right' }
                      : { textAlign: 'left' },
                  ]}
                  testID="hotel-sheet-address-local"
                >
                  {open.addressLocal}
                </Text>
              ) : null}
              <Text
                selectable
                style={[
                  styles.footnote,
                  { color: p.textSecondary, writingDirection: 'ltr', textAlign: 'left' },
                ]}
              >
                {open.addressEn}
              </Text>
            </View>
            {open.phone ? (
              <View style={styles.gap4}>
                <SectionTitle text={t('hotel.phoneLabel')} colorScheme={colorScheme} />
                <Text style={[styles.numeric, { color: p.textPrimary }]}>
                  {isolateLtr(formatPhone(open.phone))}
                </Text>
              </View>
            ) : null}
            {open.bookingRef ? (
              <SecretRow
                label={t('hotel.bookingLabel')}
                hiddenA11y={t('hotel.bookingHidden')}
                showLabel={t('hotel.bookingShow')}
                hideLabel={t('hotel.bookingHide')}
                value={open.bookingRef}
                colorScheme={colorScheme}
                testID="hotel-sheet-booking"
              />
            ) : null}
            {insurance?.emergencyPhone ? (
              <View style={styles.gap8}>
                <SectionTitle text={t('hotel.insurance')} colorScheme={colorScheme} />
                <DialRow
                  label={t('insurance.call')}
                  sub={insurance.provider}
                  number={insurance.emergencyPhone}
                  colorScheme={colorScheme}
                  testID="hotel-sheet-insurance-dial"
                />
              </View>
            ) : null}
            <View style={styles.actions}>
              <Button
                kind="secondary"
                outlined={colorScheme === 'dark'}
                label={t('hotel.edit')}
                icon={(c) => <PencilIcon color={c} size={20} />}
                blocked={offline}
                disabled={busy}
                onPress={guard(() => {
                  setSheet(null);
                  setScreen({ hotel: open });
                })}
                colorScheme={colorScheme}
                testID="hotel-sheet-edit"
              />
              <Button
                kind="text"
                label={t('hotel.delete')}
                icon={(c) => <TrashIcon color={c} size={20} />}
                blocked={offline}
                busy={busy}
                onPress={guard(() => remove(open))}
                colorScheme={colorScheme}
                testID="hotel-sheet-delete"
              />
            </View>
            {blocked ? (
              <InlineNotice text={t('offline.readOnly')} colorScheme={colorScheme} />
            ) : null}
          </ScrollView>
        ) : null}
      </BottomSheet>
      {driver ? (
        <DriverCard
          hotel={driver}
          insetsTop={insets.top}
          insetsBottom={insets.bottom}
          onClose={() => setDriver(null)}
          onOpenUrl={go}
        />
      ) : null}
    </View>
  );
}
