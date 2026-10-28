/**
 * The "Sources" sheet (sprint 3 AC-13, design 1.3): the credits for the city
 * list and the climate normals, word for word, with the licence names as
 * links. Static text: it works offline too.
 */
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, Text } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { colors, fonts, type ColorScheme } from '@/theme/tokens';

/** The licence names inside the credits, and where they link (Raz, question 4). */
export const LICENCES: [string, string][] = [
  ['CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/'],
  [
    'Open Government Licence v3.0',
    'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/',
  ],
  // Sprint 4 (design 11): the rate attribution ER-API asks for, and the warnings dataset.
  ['Rates By Exchange Rate API', 'https://www.exchangerate-api.com'],
  ['data.gov.il', 'https://data.gov.il/dataset/travelwarnings'],
  // Sprint 5 (AC-4, AC-7א).
  ['AeroDataBox', 'https://aerodatabox.com'],
  ['OurAirports', 'https://ourairports.com/data/'],
  ['mwgg/Airports', 'https://github.com/mwgg/Airports'],
  // Sprint 8 (AC-14, design 21.8): the emergency numbers and the missions dataset.
  ['FCDO Foreign Travel Advice', 'https://www.gov.uk/foreign-travel-advice'],
  ['ntz-short', 'https://data.gov.il/dataset/ntz-short'],
];

/** The dataset's name and terms as data.gov.il shows them (design 21.8), read on 2026-10-28. */
const MISSIONS_DATASET = {
  he: { dataset: 'רשימת נציגויות ישראל בעולם', terms: 'תנאי השימוש של data.gov.il' },
  en: {
    dataset: 'רשימת נציגויות ישראל בעולם (List of Israeli missions abroad)',
    terms: 'the data.gov.il terms of use',
  },
};

interface Props {
  visible: boolean;
  colorScheme: ColorScheme;
  reduceMotion: boolean;
  insetsBottom: number;
  onClose: () => void;
}

export function SourcesSheet({ visible, onClose, ...sheet }: Props) {
  const { t, i18n } = useTranslation();
  const palette = colors[sheet.colorScheme];

  /** A credit line with each licence name it holds as a link; the wording is unchanged. */
  const credit = (text: string, testID: string, skip: string[] = []) => {
    const parts: (string | [string, string])[] = [text];
    for (const [name, url] of LICENCES) {
      if (skip.includes(name)) continue;
      const at = parts.findIndex((p) => typeof p === 'string' && p.includes(name));
      if (at < 0) continue;
      const [before, ...rest] = (parts[at] as string).split(name);
      parts.splice(at, 1, before!, [name, url], rest.join(name));
    }
    return (
      <Text style={[styles.body, { color: palette.textPrimary }]} testID={testID}>
        {parts.map((part, i) =>
          typeof part === 'string' ? (
            part
          ) : (
            <Text
              key={i}
              accessibilityRole="link"
              style={[styles.link, { color: palette.link }]}
              onPress={() => void Linking.openURL(part[1]).catch(() => {})}
            >
              {part[0]}
            </Text>
          ),
        )}
      </Text>
    );
  };

  return (
    <BottomSheet {...sheet} visible={visible} onClose={onClose} testID="sources-sheet">
      <Text style={[styles.title2, { color: palette.textPrimary }]} accessibilityRole="header">
        {t('sources.title')}
      </Text>
      {credit(t('sources.advisories'), 'sources-advisories')}
      {credit(t('sources.entry'), 'sources-entry')}
      {credit(t('sources.emergency'), 'sources-emergency')}
      {credit(
        t('sources.missions', MISSIONS_DATASET[i18n.language === 'he' ? 'he' : 'en']),
        'sources-missions',
        // Its own dataset link, not the warnings dataset's (Raz review).
        ['data.gov.il'],
      )}
      {credit(t('sources.rates'), 'sources-rates')}
      {credit(t('sources.flights'), 'sources-flights')}
      {credit(t('sources.airports'), 'sources-airports')}
      {credit(t('sources.cities'), 'sources-cities')}
      {credit(t('sources.climate'), 'sources-climate')}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title2: {
    fontFamily: fonts.semibold,
    fontSize: 22,
    lineHeight: 28,
    marginTop: 8,
    marginBottom: 12,
    textAlign: 'left',
  },
  body: {
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 16,
    textAlign: 'left',
  },
  link: { textDecorationLine: 'underline' },
});
