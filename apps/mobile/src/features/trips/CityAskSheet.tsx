/**
 * Sprint 11 AC-4 (design 2.5.2, D19): "באיזו עיר תהיו?" — asked once, on a new
 * or duplicated trip with no city from the list, after validation and before
 * save_trip. One tap on a city saves with it; skipping saves without; closing
 * goes back to the form unsaved. "Asked" is kept on the device per trip and
 * removed on sign-out.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/fields';
import { MapPinIcon, SearchIcon } from '@/components/icons';
import { isolateOwn } from '@/features/globe/BoardingPassCard';
import type { CountryInfo } from '@/features/globe/countryData';
import { LARGEST_CITIES } from '@/features/places/placesModel';
import { colors, fonts, layout, type ColorScheme } from '@/theme/tokens';

import { cityAreas } from './citiesData';
import { CitySearchScreen } from './CitiesSection';
import { entryOf, type CityEntry } from './citySearch';
import type { TripCity } from './tripsApi';

const PREFIX = 'tripForm.askedCity.';

export const wasAskedCity = async (tripId: string) =>
  (await AsyncStorage.getItem(PREFIX + tripId).catch(() => null)) === '1';
export const markAskedCity = (tripId: string) =>
  AsyncStorage.setItem(PREFIX + tripId, '1').catch(() => {});

/** Sign-out and account deletion (AC-4): the marks go with the user. */
export async function forgetAskedCities(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys().catch(() => [] as readonly string[]);
  const ours = keys.filter((k) => k.startsWith(PREFIX));
  if (ours.length) await AsyncStorage.multiRemove(ours).catch(() => {});
}

/** The country's 5 largest bundled cities (D11); empty when it has none. */
export function useLargestCities(adm0: string): CityEntry[] | null {
  const [state, setState] = useState<{ adm0: string; list: CityEntry[] } | null>(null);
  useEffect(() => {
    let live = true;
    cityAreas()
      .then(
        (areas) =>
          live &&
          setState({ adm0, list: (areas.get(adm0) ?? []).slice(0, LARGEST_CITIES).map(entryOf) }),
      )
      .catch(() => live && setState({ adm0, list: [] }));
    return () => {
      live = false;
    };
  }, [adm0]);
  return state?.adm0 === adm0 ? state.list : null;
}

export function CityAskSheet({
  country,
  cities,
  typed,
  colorScheme,
  reduceMotion,
  insetsTop,
  insetsBottom,
  onPick,
  onSkip,
  onClose,
}: {
  country: CountryInfo;
  /** The 5 largest. */
  cities: readonly CityEntry[];
  /** A typed city already in the form, for the other subtitle. */
  typed: string | null;
  colorScheme: ColorScheme;
  reduceMotion: boolean;
  insetsTop: number;
  insetsBottom: number;
  onPick: (city: TripCity) => void;
  onSkip: () => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const p = colors[colorScheme];
  const [searching, setSearching] = useState(false);
  const nameOf = (c: CityEntry) =>
    i18n.language === 'he' && c.nameHe ? c.nameHe : isolateOwn(c.nameEn);
  if (searching) {
    return (
      <CitySearchScreen
        country={country}
        mode="pick"
        colorScheme={colorScheme}
        reduceMotion={reduceMotion}
        insetsTop={insetsTop}
        insetsBottom={insetsBottom}
        onClose={() => setSearching(false)}
        onPick={(city) => onPick(city)}
      />
    );
  }
  return (
    <BottomSheet
      visible
      colorScheme={colorScheme}
      reduceMotion={reduceMotion}
      insetsBottom={insetsBottom}
      onClose={onClose}
      maxHeight={640}
      testID="city-ask"
    >
      <ScrollView>
        <Text style={[styles.title2, { color: p.textPrimary }]} accessibilityRole="header">
          {t('tripForm.askCityTitle')}
        </Text>
        <Text style={[styles.callout, { color: p.textSecondary }]}>
          {typed ? t('tripForm.askCityTyped', { city: typed }) : t('tripForm.askCityBody')}
        </Text>
        <View style={styles.list}>
          {cities.map((c) => (
            <Pressable
              key={c.id}
              accessibilityRole="button"
              accessibilityLabel={nameOf(c)}
              accessibilityHint={t('tripForm.askCityHint')}
              onPress={() => onPick({ geonameId: c.id, name: nameOf(c) })}
              style={({ pressed }) => [
                styles.row,
                { borderBottomColor: p.borderSubtle },
                pressed && { backgroundColor: p.pressed },
              ]}
              testID={`city-ask-${c.id}`}
            >
              <MapPinIcon color={p.textSecondary} size={20} />
              <Text style={[styles.body, { color: p.textPrimary }]}>{nameOf(c)}</Text>
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            onPress={() => setSearching(true)}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: p.pressed }]}
            testID="city-ask-search"
          >
            <SearchIcon color={p.link} size={20} />
            <Text style={[styles.body, { color: p.link }]}>{t('tripForm.askCitySearch')}</Text>
          </Pressable>
        </View>
        <Button
          kind="text"
          label={t('tripForm.askCitySkip')}
          a11yHint={t('tripForm.askCitySkipHint')}
          onPress={onSkip}
          colorScheme={colorScheme}
          testID="city-ask-skip"
        />
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title2: {
    fontFamily: fonts.semibold,
    fontSize: 22,
    lineHeight: 28,
    marginTop: 8,
    textAlign: 'left',
  },
  callout: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, textAlign: 'left' },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, textAlign: 'left' },
  list: { marginVertical: 12 },
  row: {
    minHeight: layout.listRowMin,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
