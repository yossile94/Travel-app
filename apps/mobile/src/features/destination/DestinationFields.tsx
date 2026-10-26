/**
 * The country card's sprint 4 fields (design 1-8): the entry tag, the NSC
 * warning row and its sheet, the exchange rate and its calculator, and the
 * status line in a trip's open row. Data from destinationData (ADR-008).
 */
import NetInfo from '@react-native-community/netinfo';
import type { TFunction } from 'i18next';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { Button, type TextInputHandle } from '@/components/fields';
import {
  CalculatorIcon,
  ChevronEndIcon,
  CloudOffIcon,
  ExternalLinkIcon,
  NoEntryIcon,
  WarningIcon,
} from '@/components/icons';
import { colors, fonts, motion, radius, type ColorScheme } from '@/theme/tokens';

import type { Advisory, EntryStatus } from './destinationData';
import {
  formatAmount,
  isStale,
  parseAmount,
  rateLine,
  rateLineText,
  type Rate,
} from './rateFormat';

const LRI = String.fromCodePoint(0x2066);
const PDI = String.fromCodePoint(0x2069);
const FSI = String.fromCodePoint(0x2068);
const ltr = (s: string) => `${LRI}${s}${PDI}`;
const DAY = 24 * 60 * 60 * 1000;

/** "26.10.2026", in the device's local date, isolated (sprint 2 date format). */
export function dottedDate(iso: string): string {
  const d = new Date(iso);
  return ltr(`${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`);
}

/** An advisory checked over 30 days ago, by the device clock (design 6.3). */
function checkedLongAgo(fetchedAt: string, now = Date.now()): boolean {
  return now - Date.parse(fetchedAt) > 30 * DAY;
}

/** The NSC warning, in AC-7's states (Raz, design change 1). */
export type AdvisoryState =
  | { kind: 'level'; level: 1 | 2 | 3 | 4; mixed: boolean }
  | { kind: 'unrecognized' }
  /** Checked by the daily job, but the source has no NSC text for the area (Raz, S4-m4). */
  | { kind: 'noNsc' }
  | { kind: 'pending' };

export function advisoryState(advisory: Advisory | undefined | null): AdvisoryState {
  if (!advisory || !advisory.fetchedAt) return { kind: 'pending' };
  if (advisory.nscLevel) {
    return { kind: 'level', level: advisory.nscLevel, mixed: advisory.nscLevels.length > 1 };
  }
  return advisory.nscText ? { kind: 'unrecognized' } : { kind: 'noNsc' };
}

// ------------------------------------------------------------------ entry

export function EntryTag({
  status,
  colorScheme,
  onPress,
}: {
  status: EntryStatus | null;
  colorScheme: ColorScheme;
  onPress?: () => void;
}) {
  const { t } = useTranslation();
  const palette = colors[colorScheme];
  if (status !== 'banned' && status !== 'restricted') return null;
  const banned = status === 'banned';
  const bg = banned ? palette.entryBannedBg : palette.entryRestrictedBg;
  const fg = banned ? palette.entryBannedFg : palette.entryRestrictedFg;
  const body = (
    <View style={[styles.tag, { backgroundColor: bg }]}>
      {banned ? <NoEntryIcon color={fg} /> : <WarningIcon color={fg} />}
      <Text style={[styles.caption, { color: fg }]}>{t(`entry.${status}`)}</Text>
    </View>
  );
  if (!onPress) {
    return <View importantForAccessibility="no-hide-descendants">{body}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(banned ? 'entry.bannedA11y' : 'entry.restrictedA11y')}
      accessibilityHint={t('entry.tagHint')}
      onPress={onPress}
      hitSlop={{ top: 12, bottom: 12 }}
      style={styles.tagPress}
      testID="card-entry-tag"
    >
      {body}
    </Pressable>
  );
}

// -------------------------------------------------------------- advisory

const SIZES = {
  card: { w: 12, h: 8, gap: 3, r: 2 },
  trip: { w: 8, h: 6, gap: 2, r: 1.5 },
  sheet: { w: 0, h: 8, gap: 4, r: 2 },
} as const;

export function AdvisoryBar({
  level,
  size,
  colorScheme,
}: {
  level: 1 | 2 | 3 | 4;
  size: keyof typeof SIZES;
  colorScheme: ColorScheme;
}) {
  const palette = colors[colorScheme];
  const s = SIZES[size];
  const fill = palette[`advisory${level}`];
  return (
    <View
      style={[styles.bar, { gap: s.gap }, size === 'sheet' && styles.barFull]}
      importantForAccessibility="no-hide-descendants"
      testID={`advisory-bar-${level}`}
    >
      {[1, 2, 3, 4].map((n) => (
        <View
          key={n}
          style={[
            {
              height: s.h,
              borderRadius: s.r,
              ...(size === 'sheet' ? { flex: 1 } : { width: s.w }),
            },
            n <= level
              ? { backgroundColor: fill }
              : { borderWidth: 1, borderColor: palette.advisoryEmpty },
          ]}
        />
      ))}
    </View>
  );
}

/** "רמה 2 · איום מזדמן" / "עד רמה 4 · איום גבוה". */
function levelText(state: Extract<AdvisoryState, { kind: 'level' }>, t: TFunction) {
  const word = t(`advisory.word.${state.level}`);
  return t(state.mixed ? 'advisory.levelUpTo' : 'advisory.level', { n: state.level, word });
}

export function CardAdvisory({
  advisory,
  loading,
  failed,
  offline,
  colorScheme,
  onOpen,
}: {
  advisory: Advisory | null | undefined;
  loading: boolean;
  failed: boolean;
  offline: boolean;
  colorScheme: ColorScheme;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const palette = colors[colorScheme];
  const showSkeleton = useDelayed(loading, 150);
  let content: ReactNode;
  let tappable = false;
  let a11y = '';
  if (loading) {
    content = showSkeleton ? <Skeleton widths={[57, 140]} colorScheme={colorScheme} /> : null;
  } else if (failed && !advisory) {
    const text = t(offline ? 'advisory.firstOffline' : 'advisory.error');
    content = <Muted text={text} offline={offline} colorScheme={colorScheme} />;
    a11y = text;
  } else {
    const state = advisoryState(advisory);
    if (state.kind === 'level') {
      tappable = true;
      const alert = state.level === 4;
      content = (
        <View style={styles.advisoryLine}>
          <AdvisoryBar level={state.level} size="card" colorScheme={colorScheme} />
          <Text
            style={[
              styles.callout,
              { color: alert ? palette.textAlert : palette.textPrimary },
              alert && styles.strong,
            ]}
          >
            {levelText(state, t)}
          </Text>
        </View>
      );
      a11y = t('advisory.rowA11y', {
        level: t(state.mixed ? 'advisory.levelOfUpTo' : 'advisory.levelOf', { n: state.level }),
        word: t(`advisory.word.${state.level}`),
      });
      if (state.mixed) a11y += `, ${t('advisory.mixed')}`;
    } else if (state.kind === 'unrecognized') {
      tappable = true;
      content = (
        <Text style={[styles.callout, { color: palette.textPrimary }]}>
          {t('advisory.unrecognized')}
        </Text>
      );
      a11y = `${t('advisory.label')}: ${t('advisory.unrecognized')}`;
    } else if (state.kind === 'noNsc') {
      // The sheet still has the Foreign Ministry's text, when there is one.
      tappable = Boolean(advisory?.mfaText);
      content = (
        <Text style={[styles.callout, { color: palette.textPrimary }]}>{t('advisory.noNsc')}</Text>
      );
      a11y = `${t('advisory.label')}: ${t('advisory.noNsc')}`;
    } else {
      content = (
        <View>
          <Text style={[styles.callout, { color: palette.textSecondary }]}>
            {t('advisory.pending')}
          </Text>
          <Text style={[styles.footnote, { color: palette.textTertiary }]}>
            {t('advisory.pendingNote')}
          </Text>
        </View>
      );
      a11y = `${t('advisory.label')}: ${t('advisory.pending')}. ${t('advisory.pendingNote')}`;
    }
  }
  const state = advisoryState(advisory);
  const fetched = advisory?.fetchedAt ?? null;
  const stale = fetched !== null && checkedLongAgo(fetched);
  // The row reads its check date too (design 6.3, QA S4 #7).
  const rowA11y =
    a11y && fetched && state.kind !== 'pending'
      ? `${a11y}, ${t('advisory.checked', { date: dottedDate(fetched) })}`
      : a11y;
  const rowMain = (
    <View style={styles.rowMain}>
      {content}
      {state.kind === 'level' && state.mixed ? (
        <Text style={[styles.footnote, { color: palette.textSecondary }]}>
          {t('advisory.mixed')}
        </Text>
      ) : null}
    </View>
  );
  return (
    <View style={styles.block} testID="card-advisory">
      <Text
        style={[styles.caption, { color: palette.textSecondary }]}
        importantForAccessibility="no"
      >
        {t('advisory.label')}
      </Text>
      {tappable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={rowA11y || undefined}
          accessibilityHint={t('advisory.rowHint')}
          onPress={onOpen}
          style={({ pressed }) => [styles.row, pressed && { backgroundColor: palette.pressed }]}
          testID="card-advisory-row"
        >
          {rowMain}
          <ChevronEndIcon color={palette.textTertiary} />
        </Pressable>
      ) : (
        // Not a control: TalkBack reads the words, not "disabled" (Raz, S4-m6).
        <View
          accessible
          accessibilityLabel={rowA11y || undefined}
          style={styles.row}
          testID="card-advisory-row"
        >
          {rowMain}
        </View>
      )}
      {fetched && state.kind !== 'pending' ? (
        <View style={styles.updatedLine}>
          <Text style={[styles.footnote, { color: palette.textSecondary }]}>
            {t('advisory.checked', { date: dottedDate(fetched) })}
          </Text>
          {stale ? <StaleTag colorScheme={colorScheme} /> : null}
        </View>
      ) : null}
    </View>
  );
}

/** One line in a trip's open row: the entry tag and the small bar (design 8). */
export function TripStatusLine({
  advisory,
  colorScheme,
}: {
  advisory: Advisory | null | undefined;
  colorScheme: ColorScheme;
}) {
  const { t } = useTranslation();
  const palette = colors[colorScheme];
  const state = advisoryState(advisory);
  const entry = advisory?.entryStatus ?? null;
  const hasEntry = entry === 'banned' || entry === 'restricted';
  // Nothing worth a line: no tag and nothing checked yet.
  if (!hasEntry && state.kind === 'pending') return null;
  let words = '';
  if (state.kind === 'level') {
    words = t('trips.statusLine', {
      level: t(state.mixed ? 'trips.statusLineUpTo' : 'trips.statusLineLevel', { n: state.level }),
    });
  } else if (state.kind === 'unrecognized') words = t('advisory.unrecognized');
  else if (state.kind === 'noNsc') words = t('advisory.noNsc');
  else words = t('advisory.pending');
  // Read as the card row is: "level 4 of 4, high threat" (design 8, QA S4 #7).
  const spoken =
    state.kind === 'level'
      ? `${t('advisory.label')}: ${t(state.mixed ? 'advisory.levelOfUpTo' : 'advisory.levelOf', { n: state.level })}, ${t(`advisory.word.${state.level}`)}`
      : words;
  const a11y = [
    hasEntry ? t(entry === 'banned' ? 'entry.bannedA11y' : 'entry.restrictedA11y') : null,
    spoken,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <View style={styles.statusLine} accessible accessibilityLabel={a11y} testID="trip-status-line">
      <EntryTag status={entry} colorScheme={colorScheme} />
      <View style={styles.advisoryLine}>
        {state.kind === 'level' ? (
          <AdvisoryBar level={state.level} size="trip" colorScheme={colorScheme} />
        ) : null}
        <Text
          style={[
            styles.footnote,
            {
              color:
                state.kind === 'level' && state.level === 4
                  ? palette.textAlert
                  : palette.textSecondary,
            },
          ]}
        >
          {words}
        </Text>
      </View>
    </View>
  );
}

/** "כניסה ואזהרות מסע" (design 7): the entry part, the NSC part, the texts, the source. */
/** About 8 lines of body text in the sheet's width. */
const LONG_TEXT = 360;

/**
 * An official text, capped at 8 lines with "עוד" when it is long (design 7.1,
 * QA S4 #4). The full text stays in the accessibility label.
 */
function OfficialText({
  text,
  testID,
  color,
  link,
}: {
  text: string;
  testID: string;
  color: string;
  link: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const clean = text.replace(/\n{3,}/g, '\n\n').trim();
  const long = clean.length > LONG_TEXT;
  return (
    <View>
      <Text
        style={[styles.body, styles.rtl, { color }]}
        numberOfLines={long && !open ? 8 : undefined}
        accessibilityLabel={clean}
        testID={testID}
      >
        {clean}
      </Text>
      {long && !open ? (
        <Pressable
          onPress={() => setOpen(true)}
          accessibilityRole="button"
          hitSlop={12}
          testID={`${testID}-more`}
        >
          <Text style={[styles.callout, styles.rtl, { color: link }]}>{t('advisory.more')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function TravelInfoSheet({
  visible,
  countryName,
  advisory,
  colorScheme,
  reduceMotion,
  insetsBottom,
  onClose,
}: {
  visible: boolean;
  countryName: string;
  advisory: Advisory | null | undefined;
  colorScheme: ColorScheme;
  reduceMotion: boolean;
  insetsBottom: number;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const palette = colors[colorScheme];
  const state = advisoryState(advisory);
  const entry = advisory?.entryStatus ?? null;
  const official = advisory?.nscUrl ?? advisory?.mfaUrl ?? null;
  const hebrewOnly = i18n.language !== 'he';
  const officialText = (text: string, testID: string) => (
    <OfficialText text={text} testID={testID} color={palette.textPrimary} link={palette.link} />
  );
  return (
    <BottomSheet
      visible={visible}
      colorScheme={colorScheme}
      reduceMotion={reduceMotion}
      insetsBottom={insetsBottom}
      onClose={onClose}
      maxHeight={640}
      testID="travel-info-sheet"
    >
      <ScrollView>
        <Text style={[styles.title2, { color: palette.textPrimary }]} accessibilityRole="header">
          {t('advisory.sheetTitle')}
        </Text>
        <Text style={[styles.callout, { color: palette.textSecondary }]}>{countryName}</Text>

        {entry === 'banned' || entry === 'restricted' ? (
          <View style={styles.section}>
            <Text
              style={[styles.title3, { color: palette.textPrimary }]}
              accessibilityRole="header"
            >
              {t('entry.title')}
            </Text>
            <EntryTag status={entry} colorScheme={colorScheme} />
            <Text style={[styles.body, { color: palette.textPrimary }]}>
              {t(entry === 'banned' ? 'entry.bannedBody' : 'entry.restrictedBody')}
            </Text>
            {advisory?.entryNote ? officialText(advisory.entryNote, 'sheet-entry-note') : null}
            <View style={styles.updatedLine}>
              {advisory?.entryVerifiedAt ? (
                <Text style={[styles.footnote, { color: palette.textSecondary }]}>
                  {t('entry.verified', { date: dottedDate(advisory.entryVerifiedAt) })}
                </Text>
              ) : null}
              {advisory?.entrySourceUrl ? (
                <Text
                  accessibilityRole="link"
                  style={[styles.footnote, styles.link, { color: palette.link }]}
                  onPress={() => void Linking.openURL(advisory.entrySourceUrl!).catch(() => {})}
                >
                  {t('entry.sourceLink')}
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={[styles.title3, { color: palette.textPrimary }]} accessibilityRole="header">
            {t('advisory.label')}
          </Text>
          {state.kind === 'level' ? (
            <View
              accessible
              accessibilityLabel={[
                t(state.mixed ? 'advisory.levelOfUpTo' : 'advisory.levelOf', { n: state.level }),
                t(`advisory.word.${state.level}`),
                t(`advisory.rec.${state.level}`),
                state.mixed ? t('advisory.mixed') : null,
              ]
                .filter(Boolean)
                .join(', ')}
            >
              <AdvisoryBar level={state.level} size="sheet" colorScheme={colorScheme} />
              <Text style={[styles.bodyStrong, { color: palette.textPrimary }]}>
                {t(state.mixed ? 'advisory.levelOfUpTo' : 'advisory.levelOf', { n: state.level })}
              </Text>
              <Text style={[styles.body, { color: palette.textPrimary }]}>
                {t('advisory.wordRec', {
                  word: t(`advisory.word.${state.level}`),
                  rec: t(`advisory.rec.${state.level}`),
                })}
              </Text>
              {state.mixed ? (
                <Text style={[styles.footnote, { color: palette.textSecondary }]}>
                  {t('advisory.mixedSheet')}
                </Text>
              ) : null}
            </View>
          ) : state.kind === 'unrecognized' || state.kind === 'noNsc' ? (
            <Text style={[styles.body, { color: palette.textPrimary }]}>
              {t(state.kind === 'noNsc' ? 'advisory.noNsc' : 'advisory.unrecognized')}
            </Text>
          ) : (
            <Text style={[styles.body, { color: palette.textSecondary }]}>
              {t('advisory.pendingSheet')}
            </Text>
          )}
          {advisory?.fetchedAt && state.kind !== 'pending' ? (
            <Text style={[styles.footnote, { color: palette.textSecondary }]}>
              {t('advisory.checked', { date: dottedDate(advisory.fetchedAt) })}
            </Text>
          ) : null}
        </View>

        {state.kind !== 'pending' && (advisory?.nscText || advisory?.mfaText) ? (
          <View style={styles.section}>
            {hebrewOnly ? (
              <Text style={[styles.footnote, { color: palette.textSecondary }]}>
                {t('advisory.hebrewOnly')}
              </Text>
            ) : null}
            {advisory?.nscText ? (
              <View>
                <Text
                  style={[styles.caption, { color: palette.textSecondary }]}
                  accessibilityRole="header"
                >
                  {t('advisory.body.nsc')}
                </Text>
                {officialText(advisory.nscText, 'sheet-nsc-text')}
              </View>
            ) : null}
            {advisory?.mfaText ? (
              <View>
                <Text
                  style={[styles.caption, { color: palette.textSecondary }]}
                  accessibilityRole="header"
                >
                  {t('advisory.body.mfa')}
                </Text>
                {officialText(advisory.mfaText, 'sheet-mfa-text')}
              </View>
            ) : null}
          </View>
        ) : null}

        {official ? (
          <View style={styles.section}>
            <Button
              kind="secondary"
              label={t('advisory.official')}
              icon={(color) => <ExternalLinkIcon color={color} />}
              onPress={() => void Linking.openURL(official).catch(() => {})}
              colorScheme={colorScheme}
              testID="sheet-official"
            />
          </View>
        ) : null}

        <Text style={[styles.footnote, styles.disclaimer, { color: palette.textSecondary }]}>
          {t('advisory.disclaimer')}
        </Text>
      </ScrollView>
    </BottomSheet>
  );
}

// ------------------------------------------------------------------ rate

const ERAPI_URL = 'https://www.exchangerate-api.com';

function Attribution({
  source,
  colorScheme,
}: {
  source: Rate['source'];
  colorScheme: ColorScheme;
}) {
  const { t } = useTranslation();
  const palette = colors[colorScheme];
  if (source === 'boi') {
    return (
      <Text style={[styles.footnote, { color: palette.textSecondary }]}>{t('rate.attrBoi')}</Text>
    );
  }
  return (
    <Text
      accessibilityRole="link"
      style={[styles.footnote, styles.link, styles.attr, { color: palette.link }]}
      onPress={() => void Linking.openURL(ERAPI_URL).catch(() => {})}
      testID="rate-attribution"
    >
      {ltr(t('rate.attrErapi'))}
    </Text>
  );
}

export function CardRate({
  currency,
  currencyName,
  rate,
  loading,
  failed,
  offline,
  colorScheme,
  onOpen,
}: {
  currency: string;
  currencyName: string;
  rate: Rate | null | undefined;
  loading: boolean;
  failed: boolean;
  offline: boolean;
  colorScheme: ColorScheme;
  onOpen: (rate: Rate) => void;
}) {
  const { t } = useTranslation();
  const palette = colors[colorScheme];
  const showSkeleton = useDelayed(loading, 150);
  // ILS: no block at all (AC-1א).
  if (currency === 'ILS') return null;
  let body: ReactNode;
  if (loading) {
    body = showSkeleton ? <Skeleton widths={[180, 96]} colorScheme={colorScheme} /> : null;
  } else if (!rate) {
    const key = failed ? (offline ? 'rate.firstOffline' : 'rate.error') : 'rate.none';
    body = <Muted text={t(key)} offline={failed && offline} colorScheme={colorScheme} />;
  } else {
    const line = rateLine(rate)!;
    const unit = Number(line.amount.split(' ')[0]!.replace(/,/g, ''));
    const ilsNumber = line.ils.split(' ')[0];
    const usdNumber = line.usd?.split(' ')[0];
    const a11y =
      currency === 'USD'
        ? t('rate.rowA11yUsd', { ils: ilsNumber })
        : t(unit === 1 ? 'rate.rowA11yOne' : 'rate.rowA11yMany', {
            units: line.amount.split(' ')[0],
            currency: currencyName,
            ils: ilsNumber,
            usd: usdNumber,
          });
    body = (
      <View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={a11y}
          accessibilityHint={t('rate.rowHint')}
          onPress={() => onOpen(rate)}
          style={({ pressed }) => [styles.row, pressed && { backgroundColor: palette.pressed }]}
          testID="card-rate-row"
        >
          <Text style={[styles.numeric, styles.rowMain, { color: palette.textPrimary }]}>
            {ltr(rateLineText(line))}
          </Text>
          <CalculatorIcon color={palette.textSecondary} />
        </Pressable>
        <View style={styles.updatedLine}>
          <Text style={[styles.footnote, { color: palette.textSecondary }]}>
            {t('rate.updated', { date: dottedDate(rate.fetchedAt) })}
          </Text>
          {isStale(rate.fetchedAt) ? <StaleTag colorScheme={colorScheme} /> : null}
        </View>
        <Attribution source={rate.source} colorScheme={colorScheme} />
      </View>
    );
  }
  return (
    <View style={styles.block} testID="card-rate">
      <Text style={[styles.caption, { color: palette.textSecondary }]}>{t('card.rate')}</Text>
      {body}
    </View>
  );
}

type Field = 'local' | 'ils' | 'usd';

/** The calculator (design 4): the last edited field drives the others. */
export function CalculatorSheet({
  visible,
  rate,
  usdIls,
  currencyName,
  colorScheme,
  reduceMotion,
  insetsBottom,
  onClose,
}: {
  visible: boolean;
  rate: Rate | null;
  usdIls: number | null;
  currencyName: string;
  colorScheme: ColorScheme;
  reduceMotion: boolean;
  insetsBottom: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const palette = colors[colorScheme];
  // autoFocus inside the opening sheet doesn't raise the Android keyboard:
  // focus the local field once the sheet has slid in (design 4.1, QA S4 #3).
  const localInput = useRef<TextInputHandle>(null);
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(
      () => localInput.current?.focus(),
      (reduceMotion ? motion.short : motion.sheet) + 50,
    );
    return () => clearTimeout(timer);
  }, [visible, reduceMotion]);
  const line = rate ? rateLine(rate) : null;
  const unit = line ? line.amount.split(' ')[0]!.replace(/,/g, '') : '1';
  const [source, setSource] = useState<{ field: Field; text: string }>({
    field: 'local',
    text: unit,
  });
  const [invalid, setInvalid] = useState(false);
  // A new opening starts again from the line's amount (nothing is kept, 4.1).
  const [openedWith, setOpenedWith] = useState<string | null>(null);
  const key = visible && rate ? `${rate.currency}:${rate.fetchedAt}` : null;
  if (key !== openedWith) {
    setOpenedWith(key);
    if (key) {
      setSource({ field: 'local', text: unit });
      setInvalid(false);
    }
  }
  if (!rate || !line) return null;
  const isUsd = rate.currency === 'USD';
  const usdToIls = usdIls ?? rate.rateToIls / rate.rateToUsd;

  const value = parseAmount(source.text);
  const ilsOf = (field: Field, x: number) =>
    field === 'local' ? x * rate.rateToIls : field === 'ils' ? x : x * usdToIls;
  const shown = (field: Field): string => {
    if (field === source.field) return source.text;
    if (value === null) return '';
    const ils = ilsOf(source.field, value);
    const v = field === 'ils' ? ils : field === 'usd' ? ils / usdToIls : ils / rate.rateToIls;
    return formatAmount(v) ?? '—';
  };
  const change = (field: Field, text: string) => {
    const normal = text.replace(',', '.').replace(/^\./, '0.');
    if (normal === '' || parseAmount(normal) !== null) {
      setSource({ field, text: normal });
      setInvalid(false);
      return;
    }
    // A pasted value that isn't a number is refused whole, with a note; a key is just ignored.
    if (Math.abs(text.length - shown(field).length) > 1) setInvalid(true);
  };

  const fields: { field: Field; label: string; name: string; unitLabel: string }[] = [
    {
      field: 'local',
      label: t('calc.local', { name: currencyName, code: rate.currency }),
      name: currencyName,
      unitLabel: rate.currency,
    },
    { field: 'ils', label: t('calc.ils'), name: t('calc.ilsName'), unitLabel: '₪' },
    ...(isUsd
      ? []
      : [{ field: 'usd' as const, label: t('calc.usd'), name: t('calc.usdName'), unitLabel: '$' }]),
  ];

  return (
    <BottomSheet
      visible={visible}
      colorScheme={colorScheme}
      reduceMotion={reduceMotion}
      insetsBottom={insetsBottom}
      onClose={onClose}
      testID="calculator-sheet"
    >
      <ScrollView keyboardShouldPersistTaps="handled">
        <Text style={[styles.title2, { color: palette.textPrimary }]} accessibilityRole="header">
          {t('calc.title')}
        </Text>
        <Text style={[styles.callout, { color: palette.textSecondary }]}>
          {ltr(rateLineText(line))}
        </Text>
        {fields.map(({ field, label, name, unitLabel }) => (
          <View key={field} style={styles.calcField}>
            <Text
              style={[styles.caption, { color: palette.textSecondary }]}
              importantForAccessibility="no"
            >
              {label}
            </Text>
            <View
              style={[
                styles.calcInput,
                { borderColor: palette.borderControl, backgroundColor: palette.surface },
              ]}
            >
              <TextInput
                accessibilityLabel={t('calc.fieldA11y', { name })}
                value={shown(field)}
                onChangeText={(text) => change(field, text)}
                keyboardType="decimal-pad"
                autoCorrect={false}
                selectTextOnFocus
                ref={field === 'local' ? localInput : undefined}
                style={[styles.calcText, { color: palette.textPrimary }]}
                testID={`calc-${field}`}
              />
              <Text style={[styles.callout, { color: palette.textSecondary }]}>{unitLabel}</Text>
            </View>
          </View>
        ))}
        {invalid ? (
          <Text
            style={[styles.footnote, { color: palette.textSecondary }]}
            accessibilityLiveRegion="polite"
            testID="calc-invalid"
          >
            {t('calc.invalid')}
          </Text>
        ) : null}
        <Text style={[styles.footnote, styles.disclaimer, { color: palette.textSecondary }]}>
          {t('calc.disclaimer')}
        </Text>
        <View style={styles.updatedLine}>
          <Text style={[styles.footnote, { color: palette.textSecondary }]}>
            {t('rate.updated', { date: dottedDate(rate.fetchedAt) })}
          </Text>
          {isStale(rate.fetchedAt) ? <StaleTag colorScheme={colorScheme} /> : null}
        </View>
        <Attribution source={rate.source} colorScheme={colorScheme} />
      </ScrollView>
    </BottomSheet>
  );
}

// ---------------------------------------------------------------- shared

function StaleTag({ colorScheme }: { colorScheme: ColorScheme }) {
  const { t } = useTranslation();
  const palette = colors[colorScheme];
  return (
    <View style={[styles.tag, { backgroundColor: palette.tag }]}>
      <Text style={[styles.caption, { color: palette.textSecondary }]}>
        {t('common.maybeStale')}
      </Text>
    </View>
  );
}

function Muted({
  text,
  offline,
  colorScheme,
}: {
  text: string;
  offline: boolean;
  colorScheme: ColorScheme;
}) {
  const palette = colors[colorScheme];
  return (
    <View style={styles.advisoryLine}>
      {offline ? <CloudOffIcon color={palette.textSecondary} size={16} /> : null}
      <Text style={[styles.body, { color: palette.textSecondary }]}>{text}</Text>
    </View>
  );
}

function Skeleton({ widths, colorScheme }: { widths: number[]; colorScheme: ColorScheme }) {
  const palette = colors[colorScheme];
  return (
    <View importantForAccessibility="no-hide-descendants" testID="destination-skeleton">
      {widths.map((w, i) => (
        <View
          key={i}
          style={{
            width: w,
            height: i === 0 ? 16 : 12,
            borderRadius: 6,
            marginTop: 6,
            backgroundColor: palette.skeleton,
          }}
        />
      ))}
    </View>
  );
}

/** True once `on` has lasted `ms` (skeletons only after 150 ms, design 2.2). */
function useDelayed(on: boolean, ms: number): boolean {
  const [late, setLate] = useState(false);
  const [wasOn, setWasOn] = useState(on);
  if (wasOn !== on) {
    setWasOn(on);
    if (!on) setLate(false);
  }
  useEffect(() => {
    if (!on) return;
    const timer = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(timer);
  }, [on, ms]);
  return on && late;
}

/**
 * Whether the device is offline now (for the first-run messages); null until
 * NetInfo answers, so a first offline launch never flashes the error text
 * first (Raz, S4-m3).
 */
export function useOffline(): boolean | null {
  const [offline, setOffline] = useState<boolean | null>(null);
  useEffect(() => NetInfo.addEventListener((net) => setOffline(net.isConnected === false)), []);
  return offline;
}

export const FSI_MARK = FSI;

const styles = StyleSheet.create({
  block: { marginTop: 12 },
  row: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: -8,
    paddingHorizontal: 8,
    borderRadius: radius.xs,
  },
  rowMain: { flex: 1 },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  tagPress: { alignSelf: 'flex-start', marginTop: 8 },
  bar: { flexDirection: 'row', alignItems: 'center' },
  barFull: { marginVertical: 8 },
  advisoryLine: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  statusLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  updatedLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  section: { marginTop: 16, gap: 6 },
  caption: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, textAlign: 'left' },
  callout: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, textAlign: 'left' },
  strong: { fontFamily: fonts.medium },
  footnote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, textAlign: 'left' },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, textAlign: 'left' },
  bodyStrong: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 22, textAlign: 'left' },
  title2: {
    fontFamily: fonts.semibold,
    fontSize: 22,
    lineHeight: 28,
    marginTop: 8,
    textAlign: 'left',
  },
  title3: { fontFamily: fonts.semibold, fontSize: 18, lineHeight: 24, textAlign: 'left' },
  numeric: {
    fontFamily: fonts.medium,
    fontSize: 17,
    lineHeight: 22,
    fontVariant: ['tabular-nums'],
    textAlign: 'left',
  },
  link: { textDecorationLine: 'underline' },
  attr: { minHeight: 48, marginVertical: -15, textAlignVertical: 'center' },
  rtl: { writingDirection: 'rtl', textAlign: 'right' },
  disclaimer: { marginTop: 16 },
  calcField: { marginTop: 12, gap: 4 },
  calcInput: {
    minHeight: 56,
    borderWidth: 1,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 8,
  },
  calcText: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 17,
    fontVariant: ['tabular-nums'],
    writingDirection: 'ltr',
    textAlign: 'right',
  },
});
