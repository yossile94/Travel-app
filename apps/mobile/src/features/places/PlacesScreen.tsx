/**
 * Sprint 11 F-029 (design 3 – 7; AC-3 – AC-7; Raz 29.10): "What to see". A
 * city picker on top (the trip's cities, or the largest; "עיר אחרת"; "בכל
 * המדינה" last), then "בעיר" / "ליד המלון" / "שמורים", the category chips and
 * the list. Everything is filtered on the device: neither the picked city nor
 * the hotel's point is sent anywhere (D20, ADR-016 2).
 */
import NetInfo from '@react-native-community/netinfo';
import * as Crypto from 'expo-crypto';
import { StatusBar } from 'expo-status-bar';
import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
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
import { Button } from '@/components/fields';
import { InlineNotice, useToast } from '@/components/formControls';
import { BackIcon, CloudOffIcon, MapPinIcon, NavigateIcon, SearchIcon } from '@/components/icons';
import { useAuth } from '@/features/auth/AuthProvider';
import { dottedDate } from '@/features/destination/DestinationFields';
import { isolateLtr, isolateOwn } from '@/features/globe/BoardingPassCard';
import { countryByAdm0 } from '@/features/globe/countryData';
import { dayHeading } from '@/features/itinerary/dayText';
import { DAY_MAX } from '@/features/itinerary/itineraryModel';
import { tripDays } from '@/features/itinerary/planner';
import { saveItem, useBoard } from '@/features/itinerary/itineraryStore';
import { saveHotel } from '@/features/kit/kitApi';
import { nightsText } from '@/features/kit/HotelsSection';
import { byCheckIn, hotelPayload, numRange, type Hotel } from '@/features/kit/kitModel';
import { refreshTripKit, refreshTripKitNow, tripKitNow, useTripKit } from '@/features/kit/kitStore';
import { MapPointPicker } from '@/features/kit/MapPointPicker';
import { cityAreas, cityPoint } from '@/features/trips/citiesData';
import { CitySearchScreen } from '@/features/trips/CitiesSection';
import { entryOf, type CityEntry } from '@/features/trips/citySearch';
import { countryName } from '@/features/trips/countryName';
import { formatDate } from '@/features/trips/tripDates';
import type { Trip } from '@/features/trips/tripsApi';
import { colors, fonts, layout, radius, type ColorScheme } from '@/theme/tokens';

import { BookmarkIcon } from './icons';
import { pickedCity, rememberCity } from './pickedCities';
import { usePlaces, retryPlaces } from './placesData';
import {
  byCategory,
  CATEGORIES,
  CITY_RADIUS_KM,
  distanceKm,
  cityPickerOptions,
  formatDistance,
  HOTEL_RADII,
  nightCityId,
  PAGE_SIZE,
  placesInCity,
  placesNear,
  type Place,
  type PlaceCategory,
  type PickerOption,
  type ShownPlace,
} from './placesModel';
import { savePlace, unsavePlace, useSaved, type SavedPlace } from './savedPlaces';

type Tab = 'city' | 'hotel' | 'saved';

export interface PlacesScreenProps {
  adm0: string;
  /** The trip the screen is tied to (design 3.1): the opened trip, or the country's context trip. */
  trip: Trip | null;
  signedIn: boolean;
  /** Today's date in the destination ("YYYY-MM-DD"). */
  today: string;
  colorScheme: ColorScheme;
  reduceMotion: boolean;
  insetsTop: number;
  insetsBottom: number;
  onClose: () => void;
  /** Design 2.4: the kit's second row opens "שמורים". */
  initialTab?: 'city' | 'saved';
}

/** The country's bundled cities, largest first; empty while loading or for none. */
function useCities(adm0: string): CityEntry[] | null {
  const [cities, setCities] = useState<{ adm0: string; list: CityEntry[] } | null>(null);
  useEffect(() => {
    let live = true;
    cityAreas()
      .then((areas) => live && setCities({ adm0, list: (areas.get(adm0) ?? []).map(entryOf) }))
      .catch(() => live && setCities({ adm0, list: [] }));
    return () => {
      live = false;
    };
  }, [adm0]);
  return cities?.adm0 === adm0 ? cities.list : null;
}

/** Offline now; null until NetInfo answers. */
function useOnline(): boolean | null {
  const [online, setOnline] = useState<boolean | null>(null);
  useEffect(() => NetInfo.addEventListener((s) => setOnline(s.isConnected !== false)), []);
  return online;
}

/** Design 5.4: the maps app at the coordinates, labelled; built on the device. */
export function navigateUrl(p: { lat: number; lng: number; name: string }): string {
  const name = encodeURIComponent(p.name);
  return Platform.OS === 'ios'
    ? `maps://?ll=${p.lat},${p.lng}&q=${name}`
    : `geo:${p.lat},${p.lng}?q=${p.lat},${p.lng}(${name})`;
}

export function PlacesScreen({
  adm0,
  trip,
  signedIn,
  today,
  colorScheme,
  reduceMotion,
  insetsTop,
  insetsBottom,
  onClose,
  initialTab = 'city',
}: PlacesScreenProps) {
  const { t, i18n } = useTranslation();
  // QA B1: the screen is a Modal, so its toasts are drawn here, or in the open sheet.
  const toast = useToast();
  const onToast = toast.say;
  const p = colors[colorScheme];
  const country = countryByAdm0(adm0);
  const area = country ? countryName(country, i18n.language) : adm0;
  const places = usePlaces(adm0);
  const cities = useCities(adm0);
  const online = useOnline();
  const tripId = signedIn ? (trip?.id ?? null) : null;
  const saved = useSaved(tripId);
  const kit = useTripKit(tripId);
  const { recheckConsent } = useAuth();
  const memoryKey = `${adm0}:${tripId ?? '-'}`;
  const [addingToDay, setAddingToDay] = useState<SavedPlace | null>(null);

  const [tab, setTab] = useState<Tab>(initialTab);
  const [category, setCategory] = useState<PlaceCategory | 'all'>('all');
  const [radiusKm, setRadiusKm] = useState<number>(3);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [searching, setSearching] = useState(false);
  const [opened, setOpened] = useState<ShownPlace | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [picked, setPicked] = useState(() => pickedCity(memoryKey));
  // AC-5 (Raz 29.10): a hotel picked by hand stays until the city changes.
  const [manualHotel, setManualHotel] = useState<string | null>(null);
  const [pinning, setPinning] = useState<Hotel | null>(null);
  // AC-7 (sprint 13): with several hotels and no point yet, which one to place.
  const [choosingHotel, setChoosingHotel] = useState(false);
  const [pinBusy, setPinBusy] = useState(false);

  const hotels = kit.hotels;
  const night = useMemo(
    () => (trip && cities ? nightCityId(trip, hotels, today, cityPoint) : null),
    [trip, cities, hotels, today],
  );
  const picker = useMemo(
    () =>
      cities
        ? cityPickerOptions({
            trip,
            cities,
            nightCityId: night,
            searched: picked?.searched ?? null,
          })
        : null,
    [cities, trip, night, picked?.searched],
  );
  const selectedKey =
    picked && picker?.options.some((o) => o.key === picked.key) ? picked.key : picker?.defaultKey;
  const selected = picker?.options.find((o) => o.key === selectedKey) ?? null;
  const choose = (key: string, searched: CityEntry | null = picked?.searched ?? null) => {
    const next = { key, searched };
    rememberCity(memoryKey, next);
    setPicked(next);
    setManualHotel(null);
    setShown(PAGE_SIZE);
  };

  const cityName = (o: PickerOption | null) =>
    o?.kind === 'city'
      ? i18n.language === 'he' && o.nameHe
        ? o.nameHe
        : isolateOwn(o.nameEn)
      : o?.kind === 'typed'
        ? o.name
        : null;
  const cityPointOf = (o: PickerOption | null) => (o?.kind === 'city' ? cityPoint(o.id) : null);

  // The list for the tab: computed once per change, never per row (26.8).
  const list = places.status === 'ready' ? places.places : [];
  const savedRefs = useMemo(
    () => new Set(saved.status === 'ready' ? saved.places.map((s) => s.ref) : []),
    [saved],
  );
  // Plain expressions: the React Compiler memoizes them by their inputs (Raz ח5:
  // no suppressed hook rule, so the Compiler runs on this screen).
  const cityAt = cityPointOf(selected);
  const cityLng = cityAt ? cityAt[0] : null;
  const cityLat = cityAt ? cityAt[1] : null;
  const typed = selected?.kind === 'typed';
  const withPoint = byCheckIn(hotels.filter((h) => h.point));
  const hotelPoint = (() => {
    const manual = withPoint.find((h) => h.id === manualHotel);
    if (manual) return { id: manual.id, point: manual.point!, name: manual.name };
    if (cityLng !== null && cityLat !== null) {
      // Raz 12: the hotel within 15 km of the picked city, the nearest; none
      // there, the city itself (AC-5, Raz review 10), never a far hotel.
      const near = withPoint
        .map((h) => ({ h, km: distanceKm([cityLng, cityLat], h.point!) }))
        .filter((x) => x.km <= CITY_RADIUS_KM)
        .sort((a, b) => a.km - b.km)[0]?.h;
      return near ? { id: near.id, point: near.point!, name: near.name } : null;
    }
    // Design 3.4: the hotel of tonight, else the first by check-in.
    const first = withPoint.find((h) => h.checkIn <= today && today < h.checkOut) ?? withPoint[0];
    return first ? { id: first.id, point: first.point!, name: first.name } : null;
  })();
  // Design 3.4: "pick on map" when no hotel has a point, for tonight's hotel or the first.
  const unpinned = withPoint.length
    ? null
    : (byCheckIn(hotels).find((h) => h.checkIn <= today && today < h.checkOut) ??
      byCheckIn(hotels)[0] ??
      null);
  // AC-5 (Raz re-review 4): no city picked and no hotel point, the trip's first listed city.
  const firstTripCity = trip?.cities.find((c) => c.geonameId !== null && cityPoint(c.geonameId));
  const tripCityAt = firstTripCity ? cityPoint(firstTripCity.geonameId!) : null;
  const hotelFar = cityLng !== null && !hotelPoint && hotels.some((h) => h.point);
  const inScope: ShownPlace[] = (() => {
    const city: [number, number] | null =
      cityLng !== null && cityLat !== null ? [cityLng, cityLat] : null;
    if (tab === 'hotel') {
      const from = hotelPoint?.point ?? city ?? tripCityAt;
      return from ? placesNear(list, from, radiusKm) : [];
    }
    if (typed) return [];
    return placesInCity(list, city);
  })();
  const filtered = byCategory(inScope, category);

  const toggleSave = async (place: Place) => {
    if (!tripId || busy) return;
    if (online === false) return onToast(t('offline.readOnlyHint'));
    setBusy(place.ref);
    const isSaved = savedRefs.has(place.ref);
    const result = isSaved
      ? await unsavePlace(tripId, place.ref)
      : await savePlace(tripId, place, i18n.language);
    setBusy(null);
    if (result === 'ok') {
      onToast(
        isSaved
          ? t('places.unsaved')
          : trip && trip.title
            ? t('places.savedTo', { trip: trip.title })
            : t('places.saved'),
      );
    } else if (result === 'limit') onToast(t('places.savedLimit'));
    else if (result === 'offline') onToast(t('offline.readOnlyHint'));
    else onToast(t('places.saveError'));
  };
  // Design 3.4: the point is saved at once through save_hotel, the hotel otherwise as it is.
  const pinHotel = async (picked: Hotel, point: [number, number]) => {
    if (!tripId) return;
    setPinBusy(true);
    // Sprint 11 review: the rest of the hotel is sent as the server has it now,
    // never from an older device copy.
    const fromServer = await refreshTripKitNow(tripId);
    const fresh = tripKitNow(tripId);
    const stale = !fromServer || !fresh;
    const hotel = stale ? null : fresh.hotels.find((h) => h.id === picked.id);
    if (!hotel) {
      setPinBusy(false);
      onToast(
        t(!stale ? 'hotel.gone' : online === false ? 'offline.readOnlyHint' : 'hotel.saveError'),
      );
      return;
    }
    const payload = {
      ...hotelPayload({
        name: hotel.name,
        addressEn: hotel.addressEn,
        addressLocal: hotel.addressLocal ?? '',
        phone: hotel.phone ?? '',
        checkIn: hotel.checkIn,
        checkOut: hotel.checkOut,
        bookingRef: hotel.bookingRef ?? '',
      }),
      lat: point[1],
      lng: point[0],
    };
    let result = await saveHotel(hotel.id, tripId, payload);
    // Raz: like the hotel form, an expired consent brings up the gate, then retries once.
    if (result === 'consent' && (await recheckConsent())) {
      result = await saveHotel(hotel.id, tripId, payload);
    }
    if (result === 'ok') await refreshTripKit(tripId);
    setPinBusy(false);
    if (result === 'ok') onToast(t('places.hotelPointSaved', { name: hotel.name }));
    else if (result === 'offline') onToast(t('offline.readOnlyHint'));
    else if (result === 'gone') onToast(t('hotel.gone'));
    else if (result === 'dates') onToast(t('places.hotelDatesOutside', { name: hotel.name }));
    else if (result !== 'consent') onToast(t('hotel.saveError'));
  };
  const navigate = (target: { lat: number; lng: number; name: string }) =>
    void Linking.openURL(navigateUrl(target)).catch(() => onToast(t('places.saveError')));

  const tabs: Tab[] = tripId
    ? ['city', ...(hotels.length ? (['hotel'] as Tab[]) : []), 'saved']
    : ['city'];
  const savedCount = saved.status === 'ready' ? saved.places.length : 0;
  // Sprint 12 P-2: no places in this country and nothing saved: the controls
  // change nothing, so only the empty state shows. Same condition as the
  // 'country-none' empty state; with saved places every control stays (Raz 6).
  // Raz 9 (sprint 12 review): only once the saved list is known, so controls don't blink away.
  const bare =
    places.status === 'ready' &&
    places.places.length === 0 &&
    (!tripId || saved.status === 'ready') &&
    savedCount === 0;
  // Raz 8: the hidden tabs take the active one back to "In the city".
  if (bare && tab !== 'city') setTab('city');

  return (
    <Modal
      visible
      animationType={reduceMotion ? 'fade' : 'slide'}
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View
        style={[styles.screen, { backgroundColor: p.canvas, paddingTop: insetsTop }]}
        testID="places-screen"
      >
        <StatusBar style={colorScheme === 'light' ? 'dark' : 'light'} />
        <View style={styles.bar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('flight.back')}
            onPress={onClose}
            style={styles.back}
            testID="places-back"
          >
            <BackIcon color={p.textPrimary} />
          </Pressable>
          <View style={styles.grow}>
            <Text style={[styles.title3, { color: p.textPrimary }]} accessibilityRole="header">
              {t('places.title', { country: area })}
            </Text>
            {trip && tripId ? (
              <Text style={[styles.footnote, { color: p.textSecondary }]} numberOfLines={1}>
                {trip.title}
              </Text>
            ) : null}
          </View>
        </View>

        {picker && !bare ? (
          <View>
            <Text style={[styles.flabel, { color: p.textSecondary }]}>
              {t('places.cityPicker')}
            </Text>
            <ChipRow label={t('places.cityPicker')} testID="places-city-picker">
              {picker.options.map((o) =>
                o.kind === 'other' ? (
                  <Chip
                    key={o.key}
                    label={t('places.cityOther')}
                    icon={<SearchIcon color={p.textPrimary} size={16} />}
                    role="button"
                    hint={t('places.otherCityHint')}
                    colorScheme={colorScheme}
                    onPress={() => setSearching(true)}
                    testID="places-city-other"
                  />
                ) : (
                  <Chip
                    key={o.key}
                    label={
                      o.kind === 'country'
                        ? t('places.cityAll')
                        : o.kind === 'typed'
                          ? `${o.name} · ${t('places.cityTyped')}`
                          : cityName(o)!
                    }
                    a11y={
                      o.kind === 'typed'
                        ? t('places.cityTypedA11y', { city: o.name })
                        : o.kind === 'city' && o.from === 'search'
                          ? t('places.cityFromSearchA11y', { city: cityName(o) })
                          : undefined
                    }
                    on={o.key === selectedKey}
                    role="radio"
                    colorScheme={colorScheme}
                    onPress={() => choose(o.key)}
                    testID={`places-city-${o.kind === 'city' ? o.id : o.kind}`}
                  />
                ),
              )}
            </ChipRow>
            {picker.noTripCity && trip ? (
              <Text
                style={[styles.footnote, styles.pad, { color: p.textSecondary }]}
                testID="places-no-trip-city"
              >
                {t('places.noTripCity')}
              </Text>
            ) : null}
          </View>
        ) : null}

        {tabs.length > 1 && !bare ? (
          <View
            style={[styles.tabs, { borderBottomColor: p.borderSubtle }]}
            accessibilityRole="tablist"
          >
            {tabs.map((key) => {
              const on = key === tab;
              const label =
                key === 'city'
                  ? t('places.tabCity')
                  : key === 'hotel'
                    ? t('places.tabNearHotel')
                    : savedCount
                      ? t('places.tabSavedCount', { n: savedCount })
                      : t('places.tabSaved');
              return (
                <Pressable
                  key={key}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  onPress={() => {
                    setTab(key);
                    setShown(PAGE_SIZE);
                  }}
                  style={styles.tab}
                  testID={`places-tab-${key}`}
                >
                  <Text style={[styles.tabText, { color: on ? p.primary : p.textSecondary }]}>
                    {label}
                  </Text>
                  {on ? <View style={[styles.indicator, { backgroundColor: p.primary }]} /> : null}
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {tab === 'saved' ? (
          <SavedList
            saved={saved.status === 'ready' ? saved.places : null}
            failed={saved.status === 'failed'}
            colorScheme={colorScheme}
            insetsBottom={insetsBottom}
            onNavigate={(s) => navigate(s)}
            onMenu={(s) =>
              (saved.status === 'ready' && saved.fromCache) || online === false
                ? onToast(t('offline.readOnlyHint'))
                : setAddingToDay(s)
            }
            onRemove={(s) =>
              void unsavePlace(tripId!, s.ref).then((r) =>
                onToast(r === 'ok' ? t('places.unsaved') : t('places.saveError')),
              )
            }
          />
        ) : (
          <>
            {tab === 'hotel' && withPoint.length > 1 ? (
              <ChipRow label={t('places.hotelChooser')} testID="places-hotel-chooser">
                {withPoint.map((h) => (
                  <Chip
                    key={h.id}
                    label={isolateOwn(h.name)}
                    on={hotelPoint?.id === h.id}
                    role="radio"
                    colorScheme={colorScheme}
                    onPress={() => {
                      setManualHotel(h.id);
                      setShown(PAGE_SIZE);
                    }}
                    testID={`places-hotel-${h.id}`}
                  />
                ))}
              </ChipRow>
            ) : null}
            {tab === 'hotel' ? (
              <View style={styles.pad}>
                <Text style={[styles.flabel, { color: p.textSecondary }]}>
                  {t('places.radius')}
                </Text>
                <View
                  style={styles.segments}
                  accessibilityRole="radiogroup"
                  accessibilityLabel={t('places.radius')}
                >
                  {HOTEL_RADII.map((km) => (
                    <Pressable
                      key={km}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: radiusKm === km }}
                      onPress={() => {
                        setRadiusKm(km);
                        setShown(PAGE_SIZE);
                      }}
                      style={[
                        styles.segment,
                        { borderColor: p.borderControl },
                        radiusKm === km && { backgroundColor: p.secondaryBg },
                      ]}
                      testID={`places-radius-${km}`}
                    >
                      <Text
                        style={[
                          styles.body,
                          { color: radiusKm === km ? p.secondaryFg : p.textPrimary },
                        ]}
                      >
                        {t('places.distanceKm', { n: km })}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                {hotelPoint ? (
                  <Text style={[styles.footnote, { color: p.textSecondary }]}>
                    {t('places.near', { name: isolateOwn(hotelPoint.name) })}
                  </Text>
                ) : (
                  <InlineNotice
                    text={
                      hotelFar
                        ? t('places.hotelFar', { city: cityName(selected) ?? '' })
                        : t(
                            selected?.kind === 'city' || tripCityAt
                              ? 'places.hotelNoPoint'
                              : 'places.hotelNoPointNoCity',
                          )
                    }
                    colorScheme={colorScheme}
                    testID="places-hotel-no-point"
                  />
                )}
                {unpinned ? (
                  <Button
                    kind="secondary"
                    // AC-7 (sprint 13): with several hotels, a sheet asks which one first.
                    label={hotels.length > 1 ? t('places.hotelPickWhich') : t('hotel.pointChoose')}
                    busy={pinBusy}
                    blocked={online === false}
                    onPress={() =>
                      online === false
                        ? onToast(t('offline.readOnlyHint'))
                        : hotels.length > 1
                          ? setChoosingHotel(true)
                          : setPinning(unpinned)
                    }
                    colorScheme={colorScheme}
                    testID="places-hotel-no-point-pick"
                  />
                ) : null}
              </View>
            ) : null}
            {bare ? null : (
              <ChipRow label={t('places.catLabel')} testID="places-categories">
                {(['all', ...CATEGORIES] as const).map((c) => (
                  <Chip
                    key={c}
                    label={t(`places.cat.${c}`)}
                    on={category === c}
                    role="radio"
                    colorScheme={colorScheme}
                    onPress={() => {
                      setCategory(c);
                      setShown(PAGE_SIZE);
                    }}
                    testID={`places-cat-${c}`}
                  />
                ))}
              </ChipRow>
            )}
            {tab === 'city' && selected?.kind === 'city' && !bare ? (
              <Text
                style={[styles.footnote, styles.pad, { color: p.textSecondary }]}
                testID="places-scope"
              >
                {t('places.scopeCity', { city: cityName(selected) })}
              </Text>
            ) : null}
            {places.status === 'ready' && places.fromDevice && online === false ? (
              <Text
                style={[styles.footnote, styles.pad, { color: p.textSecondary }]}
                testID="places-cached-at"
              >
                {t('offline.cachedAt', { when: dottedDate(places.savedAt) })}
              </Text>
            ) : null}

            <FlatList
              data={filtered.slice(0, shown)}
              keyExtractor={(s) => s.place.ref}
              onEndReached={() => setShown((n) => (n < filtered.length ? n + PAGE_SIZE : n))}
              onEndReachedThreshold={0.5}
              contentContainerStyle={{ paddingBottom: insetsBottom + 24 }}
              renderItem={({ item }) => (
                <PlaceRow
                  item={item}
                  saved={savedRefs.has(item.place.ref)}
                  canSave={Boolean(tripId)}
                  busy={busy === item.place.ref}
                  colorScheme={colorScheme}
                  onOpen={setOpened}
                  onSave={toggleSave}
                  onNavigate={navigate}
                />
              )}
              ListEmptyComponent={
                <EmptyState
                  state={places}
                  tab={tab}
                  selected={selected}
                  cityLabel={cityName(selected)}
                  category={category}
                  hasInScope={inScope.length > 0}
                  radiusKm={radiusKm}
                  area={area}
                  online={online}
                  colorScheme={colorScheme}
                  onShowAll={() => setCategory('all')}
                  onSeeCountry={() => {
                    setTab('city');
                    choose('country');
                  }}
                  onWiden={(km) => setRadiusKm(km)}
                  onRetry={() => void retryPlaces(adm0)}
                />
              }
              ListFooterComponent={
                filtered.length > 0 ? (
                  <Text
                    style={[styles.footnote, styles.pad, styles.footer, { color: p.textSecondary }]}
                    accessibilityLiveRegion="polite"
                    testID="places-footer"
                  >
                    {shown < filtered.length
                      ? t('places.shown', { shown, total: filtered.length })
                      : t(tab === 'hotel' ? 'places.orderNear' : 'places.order')}
                  </Text>
                ) : undefined
              }
            />
          </>
        )}

        {opened ? (
          <PlaceSheet
            item={opened}
            cityLabel={tab === 'city' ? cityName(selected) : null}
            fromHotel={tab === 'hotel'}
            saved={savedRefs.has(opened.place.ref)}
            canSave={Boolean(tripId)}
            colorScheme={colorScheme}
            reduceMotion={reduceMotion}
            insetsBottom={insetsBottom}
            online={online !== false}
            onClose={() => setOpened(null)}
            onSave={() => void toggleSave(opened.place)}
            onNavigate={navigate}
            onToast={onToast}
            overlay={toast.render(insetsTop + 16)}
          />
        ) : null}

        {addingToDay && trip && tripId ? (
          <AddToDaySheet
            place={addingToDay}
            trip={trip}
            colorScheme={colorScheme}
            reduceMotion={reduceMotion}
            insetsBottom={insetsBottom}
            onClose={() => setAddingToDay(null)}
            onToast={onToast}
            overlay={toast.render(insetsTop + 16)}
          />
        ) : null}

        {choosingHotel ? (
          <HotelPickSheet
            hotels={byCheckIn(hotels)}
            colorScheme={colorScheme}
            reduceMotion={reduceMotion}
            insetsBottom={insetsBottom}
            onClose={() => setChoosingHotel(false)}
            onPick={(hotel) => {
              setChoosingHotel(false);
              setPinning(hotel);
            }}
          />
        ) : null}

        {pinning ? (
          <MapPointPicker
            start={
              cityAt || tripCityAt
                ? { point: (cityAt ?? tripCityAt)!, zoom: 13 }
                : { point: country?.label ?? [0, 20], zoom: 6 }
            }
            colorScheme={colorScheme}
            insetsTop={insetsTop}
            insetsBottom={insetsBottom}
            onClose={() => setPinning(null)}
            onPick={(point) => {
              const hotel = pinning;
              setPinning(null);
              void pinHotel(hotel, point);
            }}
          />
        ) : null}

        {searching && country ? (
          <CitySearchScreen
            country={country}
            mode="pick"
            note={t('places.otherCityNote', { country: area })}
            colorScheme={colorScheme}
            reduceMotion={reduceMotion}
            insetsTop={insetsTop}
            insetsBottom={insetsBottom}
            onClose={() => setSearching(false)}
            onPick={(_city, entry) => {
              setSearching(false);
              if (entry) choose(`city:${entry.id}`, entry);
            }}
          />
        ) : null}
        {opened || addingToDay ? null : toast.render(insetsTop + 64)}
      </View>
    </Modal>
  );
}

// ------------------------------------------------------------- pieces

function ChipRow({
  label,
  testID,
  children,
}: {
  label: string;
  testID: string;
  children: ReactNode;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // QA B2: a horizontal row keeps its own height, neither stretched nor cut.
      style={styles.chipRow}
      contentContainerStyle={styles.chips}
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      testID={testID}
    >
      {children}
    </ScrollView>
  );
}

function Chip({
  label,
  a11y,
  hint,
  on = false,
  role,
  icon,
  colorScheme,
  onPress,
  testID,
}: {
  label: string;
  a11y?: string;
  hint?: string;
  on?: boolean;
  role: 'radio' | 'button';
  icon?: ReactNode;
  colorScheme: ColorScheme;
  onPress: () => void;
  testID: string;
}) {
  const p = colors[colorScheme];
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={a11y ?? label}
      accessibilityHint={hint}
      accessibilityState={role === 'radio' ? { checked: on } : undefined}
      hitSlop={{ top: 4, bottom: 4 }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        on ? { backgroundColor: p.secondaryBg } : { borderColor: p.borderControl, borderWidth: 1 },
        pressed && { opacity: 0.85 },
      ]}
      testID={testID}
    >
      {icon}
      <Text style={[styles.chipText, { color: on ? p.secondaryFg : p.textPrimary }]}>{label}</Text>
    </Pressable>
  );
}

const nameOf = (place: Place, language: string) =>
  language === 'he' && place.nameHe ? place.nameHe : isolateOwn(place.nameEn);
const otherNameOf = (place: Place, language: string) => {
  const other = language === 'he' && place.nameHe ? place.nameEn : place.nameHe;
  return other && other !== nameOf(place, language) ? isolateOwn(other) : null;
};

function useDistanceText() {
  const { t } = useTranslation();
  return (km: number) => {
    const d = formatDistance(km);
    return t(d.unit === 'm' ? 'places.distanceM' : 'places.distanceKm', { n: d.value });
  };
}

const PlaceRow = memo(function PlaceRow({
  item,
  saved,
  canSave,
  busy,
  colorScheme,
  onOpen,
  onSave,
  onNavigate,
}: {
  item: ShownPlace;
  saved: boolean;
  canSave: boolean;
  busy: boolean;
  colorScheme: ColorScheme;
  onOpen: (item: ShownPlace) => void;
  onSave: (place: Place) => void;
  onNavigate: (target: { lat: number; lng: number; name: string }) => void;
}) {
  const { t, i18n } = useTranslation();
  const p = colors[colorScheme];
  const distance = useDistanceText();
  const { place, km } = item;
  const name = nameOf(place, i18n.language);
  const other = otherNameOf(place, i18n.language);
  const meta = [t(`places.cat.${place.category}`), km !== null ? distance(km) : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <View style={[styles.row, { borderBottomColor: p.borderSubtle }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[name, other, place.curated ? t('places.curated') : null, meta]
          .filter(Boolean)
          .join(', ')}
        accessibilityHint={t('places.rowHint')}
        onPress={() => onOpen(item)}
        style={({ pressed }) => [styles.rowMain, pressed && { backgroundColor: p.pressed }]}
        testID={`place-row-${place.ref}`}
      >
        <Text style={[styles.bodyStrong, { color: p.textPrimary }]} numberOfLines={2}>
          {name}
        </Text>
        {other ? (
          <Text style={[styles.footnote, { color: p.textSecondary }]} numberOfLines={1}>
            {other}
          </Text>
        ) : null}
        <View style={styles.metaLine}>
          {place.curated ? (
            <Text style={[styles.badge, { backgroundColor: p.infoBg, color: p.infoFg }]}>
              {t('places.curated')}
            </Text>
          ) : null}
          <Text style={[styles.footnote, { color: p.textSecondary }]}>{meta}</Text>
        </View>
      </Pressable>
      {canSave ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(saved ? 'places.unsave' : 'places.save')}
          accessibilityState={{ selected: saved, busy }}
          onPress={() => onSave(place)}
          style={styles.iconButton}
          testID={`place-save-${place.ref}`}
        >
          {busy ? (
            <ActivityIndicator size="small" color={p.textSecondary} />
          ) : (
            <BookmarkIcon color={saved ? p.primary : p.textSecondary} filled={saved} />
          )}
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('places.navigateA11y', { name })}
        accessibilityHint={t('places.navigateHint')}
        onPress={() => onNavigate({ lat: place.lat, lng: place.lng, name: place.nameEn })}
        style={styles.iconButton}
        testID={`place-navigate-${place.ref}`}
      >
        <NavigateIcon color={p.textSecondary} />
      </Pressable>
    </View>
  );
});

function PlaceSheet({
  item,
  cityLabel,
  fromHotel,
  saved,
  canSave,
  colorScheme,
  reduceMotion,
  insetsBottom,
  online,
  onClose,
  onSave,
  onNavigate,
  onToast,
  overlay,
}: {
  item: ShownPlace;
  cityLabel: string | null;
  fromHotel: boolean;
  saved: boolean;
  canSave: boolean;
  colorScheme: ColorScheme;
  reduceMotion: boolean;
  insetsBottom: number;
  online: boolean;
  onClose: () => void;
  onSave: () => void;
  onNavigate: (target: { lat: number; lng: number; name: string }) => void;
  onToast: (text: string) => void;
  overlay: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const p = colors[colorScheme];
  const distance = useDistanceText();
  const { place, km } = item;
  const open = (url: string) => {
    if (!online) return onToast(t('places.linkOffline'));
    void Linking.openURL(url).catch(() => {});
  };
  const host = place.curated ? safeHost(place.curated.sourceUrl) : null;
  return (
    <BottomSheet
      visible
      colorScheme={colorScheme}
      reduceMotion={reduceMotion}
      insetsBottom={insetsBottom}
      onClose={onClose}
      maxHeight={640}
      overlay={overlay}
      testID="place-sheet"
    >
      <ScrollView>
        <Text style={[styles.title2, { color: p.textPrimary }]} accessibilityRole="header">
          {nameOf(place, i18n.language)}
        </Text>
        {otherNameOf(place, i18n.language) ? (
          <Text style={[styles.callout, { color: p.textSecondary }]}>
            {otherNameOf(place, i18n.language)}
          </Text>
        ) : null}
        <View style={styles.metaLine}>
          {place.curated ? (
            <Text style={[styles.badge, { backgroundColor: p.infoBg, color: p.infoFg }]}>
              {t('places.curated')}
            </Text>
          ) : null}
          <Text style={[styles.footnote, { color: p.textSecondary }]}>
            {t(`places.cat.${place.category}`)}
          </Text>
        </View>
        {km !== null ? (
          <Text style={[styles.footnote, { color: p.textSecondary }]}>
            {fromHotel
              ? t('places.fromHotel', { distance: distance(km) })
              : cityLabel
                ? t('places.fromCity', { distance: distance(km), city: cityLabel })
                : null}
          </Text>
        ) : null}
        <View style={[styles.rule, { backgroundColor: p.borderSubtle }]} />
        {place.curated ? (
          <View style={styles.gap}>
            {place.curated.body ? (
              <Text style={[styles.body, { color: p.textPrimary }]}>{place.curated.body}</Text>
            ) : null}
            {place.category === 'kosher' || place.category === 'chabad' ? (
              // Sprint 11 (QA B5): a fixed line under every kosher and Chabad place.
              <Text
                style={[styles.footnote, { color: p.textSecondary }]}
                testID="place-kosher-note"
              >
                {t('places.kosherNote')}
              </Text>
            ) : null}
            <Text style={[styles.footnote, { color: p.textSecondary }]}>
              <Text
                accessibilityRole="link"
                style={[styles.link, { color: p.link }]}
                onPress={() => open(place.curated!.sourceUrl)}
              >
                {t('places.source', { host })}
              </Text>
              {' · '}
              {t('places.verified', { date: dottedDate(place.curated.verifiedAt) })}
            </Text>
          </View>
        ) : (
          <Text style={[styles.footnote, { color: p.textSecondary }]}>
            {t('places.fromWikidata')} ·{' '}
            <Text
              accessibilityRole="link"
              style={[styles.link, { color: p.link }]}
              onPress={() => open(`https://www.wikidata.org/wiki/${place.ref.slice(3)}`)}
              testID="place-wikidata"
            >
              {t('places.onWikidata')}
            </Text>
          </Text>
        )}
        <View style={[styles.rule, { backgroundColor: p.borderSubtle }]} />
        <View style={styles.gap}>
          {canSave ? (
            <Button
              kind="secondary"
              label={t(saved ? 'places.unsave' : 'places.save')}
              onPress={onSave}
              colorScheme={colorScheme}
              testID="place-sheet-save"
            />
          ) : null}
          <Button
            kind="secondary"
            label={t('places.navigate')}
            icon={(color) => <NavigateIcon color={color} size={20} />}
            onPress={() => onNavigate({ lat: place.lat, lng: place.lng, name: place.nameEn })}
            colorScheme={colorScheme}
            testID="place-sheet-navigate"
          />
        </View>
      </ScrollView>
    </BottomSheet>
  );
}

const safeHost = (url: string) => {
  const m = /^https:\/\/([^/?#]+)/.exec(url);
  return m ? m[1]!.replace(/^www\./, '') : url;
};

function SavedList({
  saved,
  failed,
  colorScheme,
  insetsBottom,
  onNavigate,
  onMenu,
  onRemove,
}: {
  saved: SavedPlace[] | null;
  failed: boolean;
  colorScheme: ColorScheme;
  insetsBottom: number;
  onNavigate: (s: SavedPlace) => void;
  onMenu: (s: SavedPlace) => void;
  onRemove: (s: SavedPlace) => void;
}) {
  const { t } = useTranslation();
  const p = colors[colorScheme];
  if (!saved) {
    return failed ? (
      <View style={styles.pad}>
        <InlineNotice text={t('places.loadError')} colorScheme={colorScheme} />
      </View>
    ) : (
      <ActivityIndicator style={styles.loading} color={p.textTertiary} />
    );
  }
  return (
    <FlatList
      data={saved}
      keyExtractor={(s) => s.ref}
      contentContainerStyle={{ paddingBottom: insetsBottom + 24 }}
      ListHeaderComponent={
        saved.length ? (
          <Text style={[styles.footnote, styles.pad, { color: p.textSecondary }]}>
            {t('places.savedAllCities')}
          </Text>
        ) : undefined
      }
      ListEmptyComponent={
        <Text
          style={[styles.body, styles.empty, { color: p.textSecondary }]}
          testID="places-empty-saved"
        >
          {t('places.emptySaved')}
        </Text>
      }
      renderItem={({ item }) => (
        <View
          style={[styles.row, { borderBottomColor: p.borderSubtle }]}
          testID={`saved-row-${item.ref}`}
        >
          <Text style={[styles.bodyStrong, styles.grow, styles.rowText, { color: p.textPrimary }]}>
            {item.name}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('places.navigateA11y', { name: item.name })}
            onPress={() => onNavigate(item)}
            style={styles.iconButton}
          >
            <NavigateIcon color={p.textSecondary} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('places.unsave')}
            onPress={() => onRemove(item)}
            style={styles.iconButton}
            testID={`saved-remove-${item.ref}`}
          >
            <BookmarkIcon color={p.primary} filled />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('places.addToDayA11y', { name: item.name })}
            onPress={() => onMenu(item)}
            style={styles.iconButton}
            testID={`saved-menu-${item.ref}`}
          >
            <Text style={[styles.more, { color: p.textSecondary }]}>⋮</Text>
          </Pressable>
        </View>
      )}
    />
  );
}

/** AC-7 (sprint 13): "which hotel?" — each hotel with its dates; picking one opens the map. */
function HotelPickSheet({
  hotels,
  colorScheme,
  reduceMotion,
  insetsBottom,
  onClose,
  onPick,
}: {
  hotels: readonly Hotel[];
  colorScheme: ColorScheme;
  reduceMotion: boolean;
  insetsBottom: number;
  onClose: () => void;
  onPick: (hotel: Hotel) => void;
}) {
  const { t } = useTranslation();
  const p = colors[colorScheme];
  return (
    <BottomSheet
      visible
      colorScheme={colorScheme}
      reduceMotion={reduceMotion}
      insetsBottom={insetsBottom}
      onClose={onClose}
      maxHeight={640}
      testID="places-hotel-pick"
    >
      <Text style={[styles.title2, { color: p.textPrimary }]} accessibilityRole="header">
        {t('places.hotelPickTitle')}
      </Text>
      <ScrollView>
        {hotels.map((h) => (
          <Pressable
            key={h.id}
            accessibilityRole="button"
            accessibilityLabel={t('hotels.rowA11y', {
              name: h.name,
              in: formatDate(h.checkIn, t),
              out: formatDate(h.checkOut, t),
              nights: nightsText(h, t),
            })}
            onPress={() => onPick(h)}
            style={({ pressed }) => [
              styles.menuRow,
              { borderBottomColor: p.borderSubtle },
              pressed && { backgroundColor: p.pressed },
            ]}
            testID={`places-hotel-pick-${h.id}`}
          >
            <Text style={[styles.body, { color: p.textPrimary }]}>{isolateOwn(h.name)}</Text>
            <Text style={[styles.footnote, { color: p.textSecondary }]}>
              {t('hotels.rowDates', {
                range: isolateLtr(numRange(h.checkIn, h.checkOut)),
                nights: nightsText(h, t),
              })}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </BottomSheet>
  );
}

/**
 * Design 6 (AC-6; Raz ח4): a saved place to a day of the board, at the end of
 * the day, with its name and no time. A full day (30) is shown and disabled.
 */
function AddToDaySheet({
  place,
  trip,
  colorScheme,
  reduceMotion,
  insetsBottom,
  onClose,
  onToast,
  overlay,
}: {
  place: SavedPlace;
  trip: Trip;
  colorScheme: ColorScheme;
  reduceMotion: boolean;
  insetsBottom: number;
  onClose: () => void;
  onToast: (text: string) => void;
  overlay: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const p = colors[colorScheme];
  const board = useBoard(trip.id);
  const [busy, setBusy] = useState(false);
  const counts = new Map<string, number>();
  if (board.status === 'ready')
    for (const item of board.items) counts.set(item.day, (counts.get(item.day) ?? 0) + 1);
  const add = async (day: string, n: number) => {
    setBusy(true);
    const result = await saveItem(trip.id, Crypto.randomUUID(), {
      day,
      time: null,
      title: place.name,
      note: null,
      placeRef: place.ref,
      placeName: place.name,
      lat: place.lat,
      lng: place.lng,
    });
    setBusy(false);
    if (result === 'ok') {
      onToast(t('places.addedToDay', { n }));
      onClose();
    } else if (result === 'limit') onToast(t('itinerary.dayLimit'));
    else if (result === 'offline') onToast(t('offline.readOnlyHint'));
    else onToast(t('places.saveError'));
  };
  return (
    <BottomSheet
      visible
      colorScheme={colorScheme}
      reduceMotion={reduceMotion}
      insetsBottom={insetsBottom}
      onClose={onClose}
      maxHeight={640}
      overlay={overlay}
      testID="add-to-day"
    >
      <Text style={[styles.title2, { color: p.textPrimary }]} accessibilityRole="header">
        {t('places.addToDay')}
      </Text>
      <Text style={[styles.footnote, { color: p.textSecondary }]}>{isolateOwn(place.name)}</Text>
      <ScrollView>
        {tripDays(trip.startDate, trip.endDate).map((day, i) => {
          const full = (counts.get(day) ?? 0) >= DAY_MAX;
          const disabled = busy || full || board.status === 'loading';
          return (
            <Pressable
              key={day}
              accessibilityRole="button"
              accessibilityState={{ disabled }}
              disabled={disabled}
              onPress={() => void add(day, i + 1)}
              style={({ pressed }) => [
                styles.menuRow,
                { borderBottomColor: p.borderSubtle },
                pressed && { backgroundColor: p.pressed },
              ]}
              testID={`add-to-day-${day}`}
            >
              <Text style={[styles.body, { color: disabled ? p.textTertiary : p.textPrimary }]}>
                {dayHeading(t, i18n.language, i + 1, day)}
                {full ? ` · ${t('itinerary.menu.full')}` : ''}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </BottomSheet>
  );
}

function EmptyState({
  state,
  tab,
  selected,
  cityLabel,
  category,
  hasInScope,
  radiusKm,
  area,
  online,
  colorScheme,
  onShowAll,
  onSeeCountry,
  onWiden,
  onRetry,
}: {
  state: ReturnType<typeof usePlaces>;
  tab: Tab;
  selected: PickerOption | null;
  cityLabel: string | null;
  category: PlaceCategory | 'all';
  hasInScope: boolean;
  radiusKm: number;
  area: string;
  online: boolean | null;
  colorScheme: ColorScheme;
  onShowAll: () => void;
  onSeeCountry: () => void;
  onWiden: (km: number) => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const p = colors[colorScheme];
  const text = (main: string, why?: string, action?: ReactNode, kind?: string) => (
    <View
      style={styles.emptyBox}
      testID="places-empty"
      accessibilityValue={kind ? { text: kind } : undefined}
    >
      <Text style={[styles.body, styles.center, { color: p.textPrimary }]}>{main}</Text>
      {why ? (
        <Text style={[styles.footnote, styles.center, { color: p.textSecondary }]}>{why}</Text>
      ) : null}
      {action}
    </View>
  );
  if (state.status === 'loading')
    return (
      <ActivityIndicator style={styles.loading} color={p.textTertiary} testID="places-loading" />
    );
  if (state.status === 'failed') {
    return text(
      online === false ? t('places.offlineNoCopy') : t('places.loadError'),
      undefined,
      <Button
        kind="secondary"
        label={t('places.retry')}
        onPress={onRetry}
        colorScheme={colorScheme}
        icon={online === false ? (c) => <CloudOffIcon color={c} size={20} /> : undefined}
        testID="places-retry"
      />,
      'failed',
    );
  }
  if (state.places.length === 0) {
    // Sprint 12 P-2: a pin, a heading and why; one element for the screen reader.
    return (
      <View
        style={styles.countryNone}
        testID="places-empty"
        accessibilityValue={{ text: 'country-none' }}
      >
        <View importantForAccessibility="no">
          <MapPinIcon color={p.textTertiary} size={40} />
        </View>
        <View accessible>
          <Text style={[styles.emptyTitle, { color: p.textPrimary }]}>
            {t('places.emptyCountry', { country: area })}
          </Text>
          <Text style={[styles.emptyWhy, { color: p.textSecondary }]}>
            {t('places.emptyCountryWhy', { country: area })}
          </Text>
        </View>
      </View>
    );
  }
  const seeCountry = (
    <Button
      kind="secondary"
      label={t('places.seeCountry')}
      onPress={onSeeCountry}
      colorScheme={colorScheme}
      testID="places-see-country"
    />
  );
  if (tab === 'hotel') {
    const next = HOTEL_RADII.find((r) => r > radiusKm);
    return text(
      t('places.emptyRadius', { n: radiusKm }),
      undefined,
      next ? (
        <Button
          kind="text"
          label={t('places.widen', { n: next })}
          onPress={() => onWiden(next)}
          colorScheme={colorScheme}
          testID="places-widen"
        />
      ) : (
        seeCountry
      ),
      'radius',
    );
  }
  if (selected?.kind === 'typed')
    return text(
      t('places.emptyCityTyped', { city: selected.name }),
      undefined,
      seeCountry,
      'city-manual',
    );
  if (selected?.kind === 'city' && !hasInScope) {
    return text(
      t('places.emptyCity', { city: cityLabel }),
      t('places.emptyCityWhy'),
      seeCountry,
      'city-none',
    );
  }
  const showAll = (
    <Button
      kind="text"
      label={t('places.showAll')}
      onPress={onShowAll}
      colorScheme={colorScheme}
      testID="places-show-all"
    />
  );
  if (category !== 'all' && selected?.kind === 'city') {
    return text(t('places.emptyCityCategory', { city: cityLabel }), undefined, showAll, 'category');
  }
  return text(
    t('places.emptyCategory', { country: area }),
    t('places.emptyCategoryWhy'),
    showAll,
    'category',
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: {
    minHeight: layout.formBarHeight,
    flexDirection: 'row',
    alignItems: 'center',
    paddingEnd: 16,
    gap: 4,
  },
  back: {
    width: layout.touchTargetMin,
    height: layout.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grow: { flex: 1 },
  pad: { paddingHorizontal: 16, gap: 8 },
  flabel: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    lineHeight: 16,
    paddingHorizontal: 16,
    marginTop: 8,
    textAlign: 'left',
  },
  chipRow: { flexGrow: 0, flexShrink: 0 },
  chips: { paddingHorizontal: 16, paddingVertical: 8, gap: 8, flexDirection: 'row' },
  chip: {
    minHeight: 40,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chipText: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20 },
  tabs: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, marginTop: 4 },
  tab: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  tabText: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 22 },
  indicator: {
    position: 'absolute',
    bottom: 0,
    start: 16,
    end: 16,
    height: 3,
    borderTopStartRadius: radius.xs,
    borderTopEndRadius: radius.xs,
  },
  segments: { flexDirection: 'row', gap: 0 },
  segment: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingEnd: 8,
  },
  rowMain: { flex: 1, paddingHorizontal: 16, paddingVertical: 10, gap: 2 },
  rowText: { paddingHorizontal: 16 },
  metaLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  badge: {
    fontFamily: fonts.medium,
    fontSize: 12,
    lineHeight: 16,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  iconButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  more: { fontSize: 24, lineHeight: 28 },
  menuRow: {
    minHeight: layout.listRowMin,
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  loading: { marginTop: 32 },
  emptyBox: { padding: 24, gap: 8, alignItems: 'center' },
  // Sprint 12 P-2: the country with no places yet.
  countryNone: { paddingTop: 48, paddingHorizontal: 24, alignItems: 'center' },
  emptyTitle: {
    fontFamily: fonts.semibold,
    fontSize: 17,
    lineHeight: 22,
    marginTop: 16,
    maxWidth: 320,
    textAlign: 'center',
  },
  emptyWhy: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 8,
    maxWidth: 320,
    textAlign: 'center',
  },
  empty: { padding: 24, textAlign: 'center' },
  center: { textAlign: 'center' },
  footer: { marginTop: 12 },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 12 },
  gap: { gap: 8 },
  link: { textDecorationLine: 'underline' },
  title2: {
    fontFamily: fonts.semibold,
    fontSize: 22,
    lineHeight: 28,
    marginTop: 8,
    textAlign: 'left',
  },
  title3: { fontFamily: fonts.semibold, fontSize: 18, lineHeight: 24, textAlign: 'left' },
  callout: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, textAlign: 'left' },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, textAlign: 'left' },
  bodyStrong: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 22, textAlign: 'left' },
  footnote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, textAlign: 'left' },
});
