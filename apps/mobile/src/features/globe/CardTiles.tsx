/**
 * The country card's strip of tiles (country card fix, 5 and 6): one tile per
 * area — Safety, time, currency, temperature, emergency — each opening its
 * details. A tile with no data isn't shown; Safety always is, outside Israel.
 * No threat level anywhere here (Yossi, 29.10): only in the Safety sheet.
 */
import { useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/BottomSheet';
import {
  BanknoteIcon,
  ChevronEndIcon,
  ClockIcon,
  CloudOffIcon,
  HourglassIcon,
  PhoneIcon,
  ShieldIcon,
  ThermometerIcon,
} from '@/components/icons';
import { useAuthIfAny } from '@/features/auth/AuthProvider';
import { useClimate } from '@/features/climate/climateData';
import { formatTemp, tempA11y } from '@/features/climate/tempFormat';
import type { SafetyState, TileBadge } from '@/features/destination/CardDestination';
import { useDestination } from '@/features/destination/destinationData';
import { CalculatorSheet, dottedDate, useOffline } from '@/features/destination/DestinationFields';
import { isStale, rateLine } from '@/features/destination/rateFormat';
import { countryWords } from '@/features/kit/hebrewPrefix';
import { SosScreen } from '@/features/emergency/EmergencyViews';
import { countryName } from '@/features/trips/countryName';
import { colors, fonts, layout, radius, type ColorScheme } from '@/theme/tokens';

import type { CountryInfo } from './countryData';
import { describeDifference, differenceFromIsrael, formatClock, zonedClock } from './localTime';
import { timeDifferenceText } from './timeDifferenceText';
import { useMinuteClock } from './useMinuteClock';

const LRI = String.fromCodePoint(0x2066);
const PDI = String.fromCodePoint(0x2069);
const FSI = String.fromCodePoint(0x2068);
const ltr = (s: string) => `${LRI}${s}${PDI}`;
const own = (s: string) => `${FSI}${s}${PDI}`;

/**
 * How the tiles sit in a strip `width` wide (5.3, 5.4): a list from font scale
 * 1.6; otherwise as many 64-wide columns as fit, in rows of equal length.
 */
export function tileLayout(
  width: number,
  fontScale: number,
  count: number,
): { mode: 'tiles' | 'list'; cols: number } {
  if (fontScale >= layout.cardTilesListFromFontScale) return { mode: 'list', cols: 1 };
  const min = layout.cardTileMinWidth;
  const gap = layout.cardTileGap;
  // The gaps count too: five 64-wide tiles need 352, not 320 (Raz review 1).
  const maxCols = Math.max(
    1,
    Math.min(Math.floor(width / (min * fontScale)), Math.floor((width + gap) / (min + gap))),
  );
  const rows = Math.ceil(Math.max(count, 1) / maxCols);
  return { mode: 'tiles', cols: Math.ceil(Math.max(count, 1) / rows) };
}

interface Tile {
  key: 'safety' | 'time' | 'money' | 'climate' | 'emergency';
  icon: (color: string) => ReactNode;
  /** The value under the icon; none for Safety and emergency. */
  value?: ReactNode;
  label: string;
  badge?: TileBadge;
  a11y: string;
  hint?: string;
  /** Not set: not a control (the shekel). */
  onPress?: () => void;
}

/** The card's tiles, and every sheet they open but Safety's (the card owns that one). */
export function CardTiles({
  country,
  safety,
  colorScheme,
  reduceMotion,
  insetsBottom,
  today,
  city,
  onOpenSafety,
  safetyRef,
}: {
  country: CountryInfo;
  safety: SafetyState;
  colorScheme: ColorScheme;
  reduceMotion: boolean;
  insetsBottom: number;
  today: string;
  city: { id: number; nameHe: string; nameEn: string } | null;
  onOpenSafety: () => void;
  /** Focus comes back here when the Safety sheet closes. */
  safetyRef: React.RefObject<ComponentRef<typeof Pressable> | null>;
}) {
  const { t, i18n } = useTranslation();
  const palette = colors[colorScheme];
  const { fontScale, width: windowWidth } = useWindowDimensions();
  // Until measured, the card's width less its margins and the strip's padding
  // (12 + 12 + 16 + 16): never one column, whose height the coupon would take
  // as the strip's (Raz review 2).
  const [measured, setWidth] = useState(0);
  const width = measured || Math.max(0, windowWidth - 56);
  const [open, setOpen] = useState<'time' | 'money' | 'climate' | 'emergency' | null>(null);
  const refs = {
    time: useRef<ComponentRef<typeof Pressable>>(null),
    money: useRef<ComponentRef<typeof Pressable>>(null),
    climate: useRef<ComponentRef<typeof Pressable>>(null),
    emergency: useRef<ComponentRef<typeof Pressable>>(null),
  };
  const close = () => {
    const from = open;
    setOpen(null);
    // Focus goes back to the tile that opened the sheet (6).
    const node = from ? refs[from].current : null;
    if (node) AccessibilityInfo.sendAccessibilityEvent(node, 'focus');
  };

  const now = useMinuteClock();
  const destination = useDestination();
  const offline = useOffline();
  const climate = useClimate();
  const auth = useAuthIfAny();
  const israel = country.adm0 === 'ISR';

  // Time: hidden when the runtime can't compute it, as before (sprint 0 AC-4).
  let time: { clock: string; difference: string; label: string } | null = null;
  if (country.timeZone) {
    try {
      time = {
        clock: formatClock(zonedClock(country.timeZone, now)),
        difference: timeDifferenceText(
          t,
          describeDifference(differenceFromIsrael(country.timeZone, now)),
        ),
        label: country.city ? t('card.localTimeIn', { city: country.city }) : t('card.localTime'),
      };
    } catch (error) {
      console.warn(`[globe] could not compute local time for ${country.timeZone}`, error);
    }
  }

  // Currency: the Hebrew name in Hebrew, the ISO code in English (Raz, S4-m5).
  const currency = country.currency;
  const currencyName = currency ? (i18n.language === 'he' ? currency.nameHe : currency.code) : '';
  const rate = currency ? (destination.data?.rates.get(currency.code) ?? null) : null;
  const moneyLoading = !destination.data && (!destination.failed || offline === null);
  const moneyFailed = !destination.data && destination.failed && offline !== null;
  // The same rule as the label below, so the badge is always in it (Raz review 4).
  const moneyBadge: TileBadge =
    !rate && moneyFailed && offline === true
      ? 'offline'
      : rate && isStale(rate.fetchedAt)
        ? 'stale'
        : null;

  // Temperature: the area's point, or a city chosen in search (sprint 9 AC-12).
  const month = Number(today.slice(5, 7));
  let temp: { value: number; city: string | null } | 'loading' | null = null;
  if (climate.status === 'loading') temp = 'loading';
  else if (climate.status === 'ready') {
    const chosen = city ? climate.climate.city(city.id) : null;
    const area = chosen ? { normals: chosen, city } : (climate.climate.area(country.adm0) ?? null);
    if (area) {
      temp = {
        value: area.normals[month - 1]!,
        city: area.city
          ? i18n.language === 'he' && area.city.nameHe
            ? area.city.nameHe
            : own(area.city.nameEn)
          : null,
      };
    }
  }
  const tempLabel = t('climate.cardLabel', { month: t(`months.${month}`) });

  const tiles: Tile[] = [];
  if (!israel) {
    const status =
      safety.badge === 'offline'
        ? t('advisory.firstOffline')
        : safety.badge === 'stale'
          ? t('common.maybeStale')
          : safety.failed
            ? t('advisory.error')
            : null;
    tiles.push({
      key: 'safety',
      icon: (color) => <ShieldIcon color={color} />,
      label: t('card.tile.safety'),
      badge: safety.badge,
      // Never the level (Yossi), nor the entry tag: the entry line reads it (9.2).
      a11y: status ? `${t('card.tile.safetyA11y')}, ${status}` : t('card.tile.safetyA11y'),
      hint: t('card.tile.safetyHint'),
      onPress: onOpenSafety,
    });
  }
  if (time) {
    tiles.push({
      key: 'time',
      icon: (color) => <ClockIcon color={color} size={24} />,
      value: ltr(time.clock),
      label: t('card.tile.time'),
      a11y: t('card.tile.timeA11y', time),
      hint: t('card.tile.hint'),
      onPress: () => setOpen('time'),
    });
  }
  if (currency) {
    const ils = currency.code === 'ILS';
    let a11y = t('card.tile.moneyA11y', { name: currencyName });
    if (ils) {
      a11y = t('card.tile.moneyIls', { name: currencyName, symbol: currency.symbol });
    } else if (rate) {
      const line = rateLine(rate)!;
      const units = line.amount.split(' ')[0]!;
      const rateA11y =
        currency.code === 'USD'
          ? t('rate.rowA11yUsd', { ils: line.ils.split(' ')[0] })
          : t(Number(units.replace(/,/g, '')) === 1 ? 'rate.rowA11yOne' : 'rate.rowA11yMany', {
              units,
              currency: currencyName,
              ils: line.ils.split(' ')[0],
              usd: line.usd?.split(' ')[0],
            });
      a11y += `. ${rateA11y}, ${t('card.tile.updated', { date: dottedDate(rate.fetchedAt) })}`;
      if (moneyBadge === 'stale') a11y += `, ${t('common.maybeStale')}`;
    } else {
      a11y += `. ${
        moneyLoading
          ? t('card.tile.moneyLoading')
          : t(moneyFailed ? (offline ? 'rate.firstOffline' : 'rate.error') : 'rate.none')
      }`;
    }
    tiles.push({
      key: 'money',
      icon: (color) => <BanknoteIcon color={color} />,
      value: ltr(currency.code),
      label: t('card.tile.money'),
      badge: ils ? null : moneyBadge,
      a11y,
      hint: ils ? undefined : rate ? t('rate.rowHint') : t('card.tile.hint'),
      onPress: ils ? undefined : () => setOpen('money'),
    });
  }
  if (temp === 'loading' || temp) {
    tiles.push({
      key: 'climate',
      icon: (color) => <ThermometerIcon color={color} />,
      value:
        temp === 'loading' ? (
          climate.status === 'loading' && climate.showSkeleton ? (
            <View
              testID="card-tile-climate-skeleton"
              style={[styles.skeleton, { backgroundColor: palette.skeleton }]}
            />
          ) : null
        ) : (
          formatTemp(temp.value, t)
        ),
      label: t('card.tile.climate'),
      a11y:
        temp === 'loading'
          ? t('card.tile.climate')
          : temp.city
            ? t('climate.cardA11y', {
                label: tempLabel,
                value: tempA11y(temp.value, t),
                city: temp.city,
              })
            : t('climate.cardA11yNoCity', { label: tempLabel, value: tempA11y(temp.value, t) }),
      hint: t('card.tile.hint'),
      onPress: temp === 'loading' ? undefined : () => setOpen('climate'),
    });
  }
  if (!israel && auth?.state.status === 'signedOut') {
    const words = countryWords(countryName(country, i18n.language), i18n.language);
    tiles.push({
      key: 'emergency',
      icon: () => <PhoneIcon color={palette.textAlert} />,
      label: t('card.tile.emergency'),
      a11y: t('card.emergency', words),
      hint: t('card.emergencyHint'),
      onPress: () => setOpen('emergency'),
    });
  }

  const { mode, cols } = tileLayout(width, fontScale, tiles.length);
  const few = tiles.length <= 2;
  const gap = layout.cardTileGap;
  // Whole points: rounding never pushes the last tile to a new row (Raz review 6).
  const column = Math.floor((width - gap * (cols - 1)) / cols);
  const tileWidth = few ? Math.min(layout.cardTileMaxWidthFew, column) : column;
  const refOf = (key: Tile['key']) => (key === 'safety' ? safetyRef : refs[key]);

  return (
    <>
      <View
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        // Not drawn until measured, so the columns never jump (5.3).
        style={[
          mode === 'list' ? styles.list : styles.grid,
          { gap, opacity: measured > 0 ? 1 : 0 },
        ]}
        accessibilityValue={{ text: mode }}
        testID="card-tiles"
      >
        {tiles.map((tile) => (
          <CardTile
            key={tile.key}
            tile={tile}
            list={mode === 'list'}
            width={tileWidth}
            colorScheme={colorScheme}
            reduceMotion={reduceMotion}
            pressRef={refOf(tile.key)}
          />
        ))}
      </View>

      {time ? (
        <BottomSheet
          visible={open === 'time'}
          colorScheme={colorScheme}
          reduceMotion={reduceMotion}
          insetsBottom={insetsBottom}
          onClose={close}
          testID="time-sheet"
        >
          <Text style={[styles.title2, { color: palette.textPrimary }]} accessibilityRole="header">
            {t('card.timeSheetTitle')}
          </Text>
          <Text style={[styles.callout, { color: palette.textSecondary }]}>
            {countryName(country, i18n.language)}
          </Text>
          <Text
            style={[styles.numericLg, { color: palette.textPrimary }]}
            testID="time-sheet-clock"
          >
            {ltr(time.clock)}
          </Text>
          {country.city ? (
            <Text style={[styles.callout, { color: palette.textSecondary }]}>{country.city}</Text>
          ) : null}
          <Text
            style={[styles.body, { color: palette.textPrimary }]}
            testID="time-sheet-difference"
          >
            {time.difference}
          </Text>
        </BottomSheet>
      ) : null}

      {currency && currency.code !== 'ILS' ? (
        <CalculatorSheet
          visible={open === 'money'}
          rate={rate}
          loading={moneyLoading}
          failed={moneyFailed}
          offline={offline === true}
          usdIls={destination.data?.rates.get('USD')?.rateToIls ?? null}
          currencyName={currencyName}
          currencyLine={`${currency.nameHe} · ${ltr(
            currency.symbol === currency.code
              ? currency.code
              : `${own(currency.symbol)} · ${currency.code}`,
          )}`}
          colorScheme={colorScheme}
          reduceMotion={reduceMotion}
          insetsBottom={insetsBottom}
          onClose={close}
        />
      ) : null}

      {temp && temp !== 'loading' ? (
        <BottomSheet
          visible={open === 'climate'}
          colorScheme={colorScheme}
          reduceMotion={reduceMotion}
          insetsBottom={insetsBottom}
          onClose={close}
          testID="climate-sheet"
        >
          <ScrollView>
            <Text
              style={[styles.title2, { color: palette.textPrimary }]}
              accessibilityRole="header"
            >
              {t('card.climateSheetTitle')}
            </Text>
            <Text style={[styles.callout, { color: palette.textSecondary }]}>{tempLabel}</Text>
            <Text
              style={[styles.numericLg, { color: palette.textPrimary }]}
              testID="climate-sheet-value"
            >
              {formatTemp(temp.value, t)}
            </Text>
            {temp.city ? (
              <Text
                style={[styles.callout, { color: palette.textSecondary }]}
                testID="climate-sheet-city"
              >
                {temp.city}
              </Text>
            ) : null}
            <Text style={[styles.body, styles.gapTop, { color: palette.textPrimary }]}>
              {t('card.climateNotForecast')}
            </Text>
            <Text style={[styles.footnote, styles.gapTop, { color: palette.textSecondary }]}>
              {t('sources.climate')}
            </Text>
          </ScrollView>
        </BottomSheet>
      ) : null}

      {open === 'emergency' ? (
        <SignedOutSos adm0={country.adm0} colorScheme={colorScheme} onClose={close} />
      ) : null}
    </>
  );
}

/** Sprint 8 AC-17: signed out, the SOS screen from the bundled data, no insurance. */
function SignedOutSos({
  adm0,
  colorScheme,
  onClose,
}: {
  adm0: string;
  colorScheme: ColorScheme;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <SosScreen
      adm0={adm0}
      trip={null}
      insuranceOf={() => null}
      signedIn={false}
      colorScheme={colorScheme}
      insetsTop={insets.top}
      insetsBottom={insets.bottom}
      onClose={onClose}
    />
  );
}

function CardTile({
  tile,
  list,
  width,
  colorScheme,
  reduceMotion,
  pressRef,
}: {
  tile: Tile;
  list: boolean;
  width: number;
  colorScheme: ColorScheme;
  reduceMotion: boolean;
  pressRef: React.RefObject<ComponentRef<typeof Pressable> | null>;
}) {
  const palette = colors[colorScheme];
  const testID = `card-tile-${tile.key}`;
  const value = tile.value ? (
    <Text
      style={[list ? styles.listValue : styles.value, { color: palette.textPrimary }]}
      numberOfLines={1}
      testID={tile.key === 'climate' ? 'card-tile-climate-value' : undefined}
    >
      {tile.value}
    </Text>
  ) : list ? null : (
    // The same height as the others: Safety and emergency have no value (5.1).
    <View style={styles.valueSpace} />
  );
  const badge = tile.badge ? (
    <Badge kind={tile.badge} colorScheme={colorScheme} list={list} />
  ) : null;
  const body = list ? (
    <>
      {tile.icon(palette.textPrimary)}
      <Text style={[styles.listLabel, { color: palette.textPrimary }]}>{tile.label}</Text>
      {value}
      {badge}
      {tile.onPress ? <ChevronEndIcon color={palette.textTertiary} /> : null}
    </>
  ) : (
    <>
      {tile.icon(palette.textPrimary)}
      {value}
      <Text style={[styles.label, { color: palette.textSecondary }]} numberOfLines={2}>
        {tile.label}
      </Text>
      {badge}
    </>
  );
  const shape = list ? styles.listRow : [styles.tile, { width, backgroundColor: palette.tag }];
  if (!tile.onPress) {
    return (
      <View style={shape} accessible accessibilityLabel={tile.a11y} testID={testID}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      ref={pressRef}
      accessibilityRole="button"
      accessibilityLabel={tile.a11y}
      accessibilityHint={tile.hint}
      onPress={tile.onPress}
      android_ripple={{ color: palette.tilePressed }}
      style={({ pressed }) => [
        shape,
        pressed && { backgroundColor: palette.tilePressed },
        // Reduced motion: the colour only (fix 11).
        pressed && !list && !reduceMotion && styles.pressed,
      ]}
      testID={testID}
    >
      {body}
    </Pressable>
  );
}

function Badge({
  kind,
  colorScheme,
  list,
}: {
  kind: 'offline' | 'stale';
  colorScheme: ColorScheme;
  list: boolean;
}) {
  const palette = colors[colorScheme];
  return (
    <View
      style={[
        list ? styles.badgeInline : styles.badge,
        { backgroundColor: palette.surfaceRaised, borderColor: palette.tag },
      ]}
      importantForAccessibility="no-hide-descendants"
      testID={`card-tile-badge-${kind}`}
    >
      {kind === 'offline' ? (
        <CloudOffIcon color={palette.textSecondary} size={12} />
      ) : (
        <HourglassIcon color={palette.textSecondary} size={12} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  list: { flexDirection: 'column' },
  tile: {
    minHeight: layout.cardTileMinHeight,
    minWidth: layout.cardTileMinWidth,
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: 4,
    alignItems: 'center',
    gap: 2,
  },
  pressed: { transform: [{ scale: 0.96 }] },
  listRow: {
    minHeight: layout.listRowMin,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  value: {
    fontFamily: fonts.medium,
    fontSize: 15,
    lineHeight: 20,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  valueSpace: { height: 22 },
  label: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16, textAlign: 'center' },
  listLabel: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'left',
  },
  listValue: {
    fontFamily: fonts.medium,
    fontSize: 15,
    lineHeight: 20,
    fontVariant: ['tabular-nums'],
  },
  badge: {
    position: 'absolute',
    top: 6,
    end: 6,
    width: layout.cardTileBadge,
    height: layout.cardTileBadge,
    borderRadius: layout.cardTileBadge / 2,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeInline: {
    width: layout.cardTileBadge,
    height: layout.cardTileBadge,
    borderRadius: layout.cardTileBadge / 2,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skeleton: { width: 32, height: 16, borderRadius: 6, marginTop: 4 },
  title2: {
    fontFamily: fonts.semibold,
    fontSize: 22,
    lineHeight: 28,
    marginTop: 8,
    textAlign: 'left',
  },
  callout: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, textAlign: 'left' },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, textAlign: 'left' },
  footnote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, textAlign: 'left' },
  numericLg: {
    fontFamily: fonts.bold,
    fontSize: 28,
    lineHeight: 32,
    marginTop: 8,
    fontVariant: ['tabular-nums'],
    textAlign: 'left',
  },
  gapTop: { marginTop: 12 },
});
