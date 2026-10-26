/**
 * The country card's sprint 4 parts, in the design's order (1.1): the entry
 * tag and the NSC warning under the names, the exchange rate under the fields,
 * and "Sources" last. Each opens its own sheet over the card.
 */
import { useRef, useState, type ComponentRef } from 'react';
import { AccessibilityInfo, findNodeHandle, Pressable, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { SourcesSheet } from '@/features/climate/SourcesSheet';
import type { CountryInfo } from '@/features/globe/countryData';
import { countryName } from '@/features/trips/countryName';
import { colors, fonts, type ColorScheme } from '@/theme/tokens';

import { useDestination } from './destinationData';
import {
  CalculatorSheet,
  CardAdvisory,
  CardRate,
  EntryTag,
  TravelInfoSheet,
  useOffline,
} from './DestinationFields';
import type { Rate } from './rateFormat';

interface Props {
  country: CountryInfo;
  colorScheme: ColorScheme;
  reduceMotion: boolean;
  insetsBottom: number;
}

/** Entry tag and NSC warning (design 1.1, items 1 and 2). Israel has neither. */
export function CardSafety({ country, colorScheme, reduceMotion, insetsBottom }: Props) {
  const { data, failed } = useDestination();
  const offline = useOffline();
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  if (country.adm0 === 'ISR') return null;
  const advisory = data?.advisories.get(country.adm0);
  return (
    <>
      <EntryTag
        status={advisory?.entryStatus ?? null}
        colorScheme={colorScheme}
        onPress={() => setOpen(true)}
      />
      <CardAdvisory
        advisory={advisory}
        loading={!data && (!failed || offline === null)}
        failed={failed}
        offline={offline === true}
        colorScheme={colorScheme}
        onOpen={() => setOpen(true)}
      />
      <TravelInfoSheet
        visible={open}
        countryName={countryName(country, i18n.language)}
        advisory={advisory}
        colorScheme={colorScheme}
        reduceMotion={reduceMotion}
        insetsBottom={insetsBottom}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

/** The exchange rate and its calculator (design 1.1, item 4). */
export function CardRateBlock({ country, colorScheme, reduceMotion, insetsBottom }: Props) {
  const { data, failed } = useDestination();
  const offline = useOffline();
  const { i18n } = useTranslation();
  const [calc, setCalc] = useState<Rate | null>(null);
  const currency = country.currency;
  if (!currency) return null;
  // The Hebrew name in Hebrew; the ISO code in English (Raz, S4-m5).
  const currencyName = i18n.language === 'he' ? currency.nameHe : currency.code;
  return (
    <>
      <CardRate
        currency={currency.code}
        currencyName={currencyName}
        rate={data?.rates.get(currency.code)}
        loading={!data && (!failed || offline === null)}
        failed={failed}
        offline={offline === true}
        colorScheme={colorScheme}
        onOpen={setCalc}
      />
      <CalculatorSheet
        visible={calc !== null}
        rate={calc}
        usdIls={data?.rates.get('USD')?.rateToIls ?? null}
        currencyName={currencyName}
        colorScheme={colorScheme}
        reduceMotion={reduceMotion}
        insetsBottom={insetsBottom}
        onClose={() => setCalc(null)}
      />
    </>
  );
}

/** "Sources", last in the card, for the temperature, the rate and the warnings (design 1.1, item 6). */
export function CardSources({ colorScheme, reduceMotion, insetsBottom }: Omit<Props, 'country'>) {
  const { t } = useTranslation();
  const palette = colors[colorScheme];
  const [open, setOpen] = useState(false);
  const link = useRef<ComponentRef<typeof Pressable>>(null);
  const close = () => {
    setOpen(false);
    // Focus goes back to "Sources" (sprint 3 design 1.3).
    const node = findNodeHandle(link.current);
    if (node) AccessibilityInfo.setAccessibilityFocus(node);
  };
  return (
    <>
      <Pressable
        ref={link}
        accessibilityRole="button"
        accessibilityLabel={t('sources.linkA11y')}
        onPress={() => setOpen(true)}
        style={styles.sources}
        testID="card-sources"
      >
        <Text style={[styles.footnote, { color: palette.link }]}>{t('sources.link')}</Text>
      </Pressable>
      <SourcesSheet
        visible={open}
        colorScheme={colorScheme}
        reduceMotion={reduceMotion}
        insetsBottom={insetsBottom}
        onClose={close}
      />
    </>
  );
}

const styles = StyleSheet.create({
  footnote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, textAlign: 'left' },
  // A 48dp target that doesn't add 48dp to the card (sprint 3 design 1.1).
  sources: {
    minHeight: 48,
    minWidth: 48,
    marginTop: 8,
    marginBottom: -14,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
});
