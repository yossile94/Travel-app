/**
 * Sprint 8 design 12–15: "Emergency in [country]" in a trip (AC-11), the SOS
 * screen (AC-12 to AC-14, AC-16), the SOS button on the globe (AC-15) and the
 * signed-out entry on the country card (AC-17). All from bundled data: no
 * loading, no network, and the Foreign Ministry center always there.
 */
import { StatusBar } from 'expo-status-bar';
import { useRef, useState, type ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button } from '@/components/fields';
import { InlineNotice } from '@/components/formControls';
import { ChevronEndIcon, ClearIcon, CloudOffIcon, PhoneIcon } from '@/components/icons';
import { SourcesSheet } from '@/features/climate/SourcesSheet';
import { countryByAdm0 } from '@/features/globe/countryData';
import { useReduceMotion } from '@/features/globe/useReduceMotion';
import { isolateLtr } from '@/features/globe/BoardingPassCard';
import { alignFor, textDirection } from '@/features/kit/DriverCard';
import { countryWords } from '@/features/kit/hebrewPrefix';
import type { Insurance } from '@/features/kit/kitModel';
import { DialRow, openUrl, styles as kit } from '@/features/kit/kitUi';
import { countryName } from '@/features/trips/countryName';
import { formatDate } from '@/features/trips/tripDates';
import { colors, fonts, layout, radius, type ColorScheme } from '@/theme/tokens';

import {
  countryEmergency,
  emergencyRows,
  joinLabels,
  MFA,
  missionsFor,
  sourceName,
  useEmergency,
  type Mission,
} from './emergencyData';
import type { SosTrip } from './sosTarget';

type T = (k: string, o?: Record<string, unknown>) => string;

function nameOf(adm0: string, language: string) {
  const c = countryByAdm0(adm0);
  return c ? countryName(c, language) : adm0;
}

/** Design 13.5: "Source: FCDO · Verified 12.10.2026", the source a link. */
function SourceLine({
  url,
  date,
  colorScheme,
  testID,
}: {
  url: string;
  date: string;
  colorScheme: ColorScheme;
  testID: string;
}) {
  const { t } = useTranslation();
  const p = colors[colorScheme];
  const name = sourceName(url);
  // Design 13.5: "12.10.2026", digits only, so the line never reorders in RTL.
  const when = isolateLtr(date.split('-').reverse().map(Number).join('.'));
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={t('emergency.sourceA11y', { source: name, date: formatDate(date, t) })}
      accessibilityHint={t('emergency.sourceHint')}
      onPress={() => void openUrl(url)}
      style={styles.source}
      testID={testID}
    >
      <Text style={[kit.footnote, { color: p.textSecondary }]}>
        {t('emergency.source', { source: '' })}
        <Text style={{ color: p.link, textDecorationLine: 'underline' }}>{name}</Text>
        {` · ${t('emergency.verified', { date: when })}`}
      </Text>
    </Pressable>
  );
}

function MfaRow({
  colorScheme,
  large,
  testID,
}: {
  colorScheme: ColorScheme;
  large?: boolean;
  testID: string;
}) {
  const { t } = useTranslation();
  return (
    <View style={kit.gap4}>
      <DialRow
        label={t('emergency.mfa')}
        sub={t('emergency.mfaSub')}
        number={MFA.phone}
        large={large}
        colorScheme={colorScheme}
        testID={testID}
      />
      <SourceLine
        url={MFA.sourceUrl}
        date={MFA.verifiedAt}
        colorScheme={colorScheme}
        testID={`${testID}-source`}
      />
    </View>
  );
}

function missionTitle(m: Mission, t: T, language: string) {
  const city = (language === 'he' ? m.cityHe : m.cityEn) ?? m.cityEn ?? m.cityHe ?? '';
  return t(`emergency.mission.${m.kind}`, { city });
}

/** The local numbers, the mission and the backup: one country's groups. */
function Groups({
  adm0,
  insurance,
  showInsurance,
  full,
  colorScheme,
}: {
  adm0: string;
  insurance: Insurance | null;
  /** Signed out (AC-17): no insurance group at all. */
  showInsurance: boolean;
  full: boolean;
  colorScheme: ColorScheme;
}) {
  const { t, i18n } = useTranslation();
  const p = colors[colorScheme];
  const lang = i18n.language;
  const data = useEmergency();
  const c = countryEmergency(data, adm0);
  const words = countryWords(nameOf(adm0, lang), lang);
  const pending = !c || c.numbersStatus === 'pending';
  const missions = missionsFor(data, adm0);
  const missionState =
    c?.missionStatus === 'none'
      ? 'none'
      : missions.length && c?.missionStatus !== 'pending'
        ? 'covered'
        : 'pending';
  const title = (txt: string) =>
    full ? (
      <Text style={[kit.title3, { color: p.textPrimary }]} accessibilityRole="header">
        {txt}
      </Text>
    ) : null;
  const group = {
    backgroundColor: p.surface,
    borderRadius: radius.md,
    padding: full ? 12 : 8,
    gap: 8,
  };
  const labelOf = (k: string) =>
    t(
      k === 'general'
        ? 'emergency.general'
        : `emergency.${k === 'touristPolice' ? 'touristPolice' : k}`,
    );

  return (
    <View style={kit.gap8}>
      {title(t('sos.local'))}
      {pending ? (
        <View style={kit.gap8}>
          <InlineNotice
            text={t('emergency.pending', words)}
            colorScheme={colorScheme}
            testID="sos-local-pending"
          />
          {missionState !== 'none' ? (
            <MfaRow colorScheme={colorScheme} large={full} testID="sos-mfa-top" />
          ) : null}
        </View>
      ) : (
        <View style={group} testID="sos-local">
          {emergencyRows(c).map((r) => (
            <DialRow
              key={r.keys.join('-')}
              label={joinLabels(r.keys.map(labelOf), lang)}
              number={r.number}
              large={full}
              colorScheme={colorScheme}
              testID={`sos-local-${r.keys[0]}`}
            />
          ))}
          {full && c.touristPolice ? (
            <DialRow
              label={t('emergency.touristPolice')}
              number={c.touristPolice}
              large
              colorScheme={colorScheme}
              testID="sos-local-tourist"
            />
          ) : null}
          <SourceLine
            url={c.sourceUrl!}
            date={c.verifiedAt!}
            colorScheme={colorScheme}
            testID="sos-local-source"
          />
        </View>
      )}

      {title(t('sos.mission'))}
      {missionState === 'covered' ? (
        missions.slice(0, full ? 3 : 1).map((m) => {
          const address = (lang === 'he' ? m.addressHe : m.addressEn) ?? m.addressEn ?? m.addressHe;
          const hours = (lang === 'he' ? m.hoursHe : m.hoursEn) ?? m.hoursEn ?? m.hoursHe;
          return (
            <View key={m.id} style={group} testID={`sos-mission-${m.id}`}>
              {m.phone ? (
                <DialRow
                  label={missionTitle(m, t, lang)}
                  sub={
                    m.adm0 !== adm0
                      ? t('emergency.mission.fromNeighbor', {
                          country: words.country,
                          where: nameOf(m.adm0, lang),
                        })
                      : null
                  }
                  number={m.phone}
                  large={full}
                  colorScheme={colorScheme}
                  testID={`sos-mission-${m.id}-dial`}
                />
              ) : (
                <Text style={[kit.callout, { color: p.textPrimary }]}>
                  {missionTitle(m, t, lang)}
                </Text>
              )}
              {full && m.emergencyPhone ? (
                <DialRow
                  label={t('emergency.mission.emergencyPhone')}
                  number={m.emergencyPhone}
                  large
                  colorScheme={colorScheme}
                  testID={`sos-mission-${m.id}-emergency`}
                />
              ) : null}
              {full && address ? (
                <View>
                  <Text style={[kit.caption, { color: p.textSecondary }]}>
                    {t('emergency.mission.address')}
                  </Text>
                  <Text
                    selectable
                    style={[
                      kit.callout,
                      {
                        color: p.textPrimary,
                        writingDirection: textDirection(address),
                        textAlign: alignFor(textDirection(address)),
                      },
                    ]}
                  >
                    {address}
                  </Text>
                </View>
              ) : null}
              {full && hours ? (
                <View>
                  <Text style={[kit.caption, { color: p.textSecondary }]}>
                    {t('emergency.mission.hours')}
                  </Text>
                  <Text style={[kit.callout, { color: p.textPrimary }]}>{hours}</Text>
                </View>
              ) : null}
              <SourceLine
                url={m.sourceUrl}
                date={data.missionsReadOn}
                colorScheme={colorScheme}
                testID={`sos-mission-${m.id}-source`}
              />
            </View>
          );
        })
      ) : (
        <View style={group} testID={`sos-mission-${missionState}`}>
          {missionState === 'none' ? (
            <>
              <Text style={[kit.callout, { color: p.textPrimary }]}>
                {t('emergency.noMission')}
              </Text>
              <Text style={[kit.callout, { color: p.textSecondary }]}>
                {t('emergency.noMissionBody')}
              </Text>
            </>
          ) : (
            <Text style={[kit.callout, { color: p.textPrimary }]}>
              {t('emergency.missionPending', words)}
            </Text>
          )}
          {/* With no mission the backup sits here, and not again below (design 13.4). */}
          {missionState === 'none' || !pending ? (
            <MfaRow colorScheme={colorScheme} large={full} testID="sos-mfa-mission" />
          ) : null}
        </View>
      )}

      {full && showInsurance ? (
        <>
          {title(t('sos.insurance'))}
          <View style={group} testID="sos-insurance">
            {!insurance ? (
              <Text style={[kit.callout, { color: p.textSecondary }]}>
                {t('sos.insuranceNone')}
              </Text>
            ) : insurance.emergencyPhone ? (
              <DialRow
                label={t('sos.insuranceLine', { company: insurance.provider })}
                sub={t('sos.fromPolicy')}
                number={insurance.emergencyPhone}
                large
                colorScheme={colorScheme}
                testID="sos-insurance-dial"
              />
            ) : (
              <Text style={[kit.callout, { color: p.textSecondary }]}>
                {t('sos.insuranceNoHotline')}
              </Text>
            )}
          </View>
        </>
      ) : null}

      {full && missionState === 'covered' && !pending ? (
        <>
          {title(t('sos.backup'))}
          <View style={group}>
            <MfaRow colorScheme={colorScheme} large testID="sos-mfa" />
          </View>
        </>
      ) : null}
    </View>
  );
}

/** Design 12: the section in an open trip row. */
export function EmergencyCard({
  trip,
  colorScheme,
  onOpenAll,
}: {
  trip: SosTrip;
  colorScheme: ColorScheme;
  onOpenAll: () => void;
}) {
  const { t, i18n } = useTranslation();
  const p = colors[colorScheme];
  if (trip.countryAdm0 === 'ISR') return null;
  const words = countryWords(nameOf(trip.countryAdm0, i18n.language), i18n.language);
  return (
    <View style={kit.section} testID="card-emergency">
      <Text style={[kit.caption, { color: p.textSecondary }]} accessibilityRole="header">
        {t('emergency.title', words)}
      </Text>
      <Groups
        adm0={trip.countryAdm0}
        insurance={null}
        showInsurance={false}
        full={false}
        colorScheme={colorScheme}
      />
      <Button
        kind="link"
        label={t('emergency.all')}
        icon={(c) => <ChevronEndIcon color={c} size={16} />}
        onPress={onOpenAll}
        colorScheme={colorScheme}
        testID="card-emergency-all"
      />
    </View>
  );
}

/** Design 13: the full screen. With `choices`, the active trips' picker (from the globe's button). */
export function SosScreen({
  adm0,
  trip,
  choices = [],
  insuranceOf,
  signedIn,
  colorScheme,
  insetsTop,
  insetsBottom,
  onClose,
}: {
  adm0: string;
  trip: SosTrip | null;
  choices?: SosTrip[];
  insuranceOf: (tripId: string) => Insurance | null;
  signedIn: boolean;
  colorScheme: ColorScheme;
  insetsTop: number;
  insetsBottom: number;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const p = colors[colorScheme];
  const [chosen, setChosen] = useState<SosTrip | null>(trip);
  const [sources, setSources] = useState(false);
  const reduceMotion = useReduceMotion() ?? false;
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const shownAdm0 = chosen?.countryAdm0 ?? adm0;
  const name = nameOf(shownAdm0, i18n.language);
  const sameCountry = (x: SosTrip) =>
    choices.filter((c) => c.countryAdm0 === x.countryAdm0).length > 1;

  return (
    <Modal
      visible
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View
        style={[styles.screen, { backgroundColor: p.canvas, paddingTop: insetsTop }]}
        testID="sos-screen"
        accessibilityValue={{ text: shownAdm0 }}
      >
        <StatusBar style={colorScheme === 'light' ? 'dark' : 'light'} />
        <View style={styles.bar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('sos.close')}
            onPress={onClose}
            style={styles.close}
            testID="sos-close"
          >
            <ClearIcon color={p.textPrimary} />
          </Pressable>
          <Text
            style={[kit.title2, kit.grow, { color: p.textPrimary }]}
            accessibilityRole="header"
            maxFontSizeMultiplier={2}
          >
            {t('sos.title', { country: name })}
          </Text>
        </View>
        <ScrollView
          ref={scroll}
          contentContainerStyle={[styles.content, { paddingBottom: insetsBottom + 24 }]}
        >
          {choices.length >= 2 ? (
            <View style={kit.gap8}>
              <Text style={[kit.caption, { color: p.textSecondary }]}>{t('sos.trips')}</Text>
              <View style={kit.actions} accessibilityRole="radiogroup">
                {choices.map((c) => {
                  const on = c.id === chosen?.id;
                  return (
                    <Pressable
                      key={c.id}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: on }}
                      onPress={() => {
                        if (on) return;
                        setChosen(c);
                        scroll.current?.scrollTo({ y: 0, animated: false });
                        AccessibilityInfo.announceForAccessibility(
                          t('sos.switched', { country: nameOf(c.countryAdm0, i18n.language) }),
                        );
                      }}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: on ? p.primary : p.surface,
                          borderColor: on ? p.primary : p.borderControl,
                        },
                      ]}
                      testID={`sos-trip-${c.id}`}
                    >
                      <Text style={[kit.callout, { color: on ? p.onPrimary : p.textPrimary }]}>
                        {sameCountry(c) ? c.title : nameOf(c.countryAdm0, i18n.language)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}
          <Groups
            key={shownAdm0 + (chosen?.id ?? '')}
            adm0={shownAdm0}
            insurance={chosen ? insuranceOf(chosen.id) : null}
            showInsurance={signedIn && chosen !== null}
            full
            colorScheme={colorScheme}
          />
          <View style={kit.rowLine}>
            <CloudOffIcon color={p.textSecondary} size={16} />
            <Text style={[kit.footnote, kit.grow, { color: p.textSecondary }]}>
              {t('sos.offline')}
            </Text>
          </View>
          <Button
            kind="link"
            label={t('sos.sources')}
            onPress={() => setSources(true)}
            colorScheme={colorScheme}
            testID="sos-sources"
          />
        </ScrollView>
      </View>
      <SourcesSheet
        visible={sources}
        colorScheme={colorScheme}
        reduceMotion={reduceMotion}
        insetsBottom={insetsBottom}
        onClose={() => setSources(false)}
      />
    </Modal>
  );
}

/** Design 14: the button over the globe, one row above "My trips", at the end side. */
export function SosButton({
  trip,
  bottom,
  onPress,
}: {
  trip: SosTrip;
  bottom: number;
  onPress: () => void;
}) {
  const { t, i18n } = useTranslation();
  // Always the dark scene's alert red: the light one fails against the ocean (design 23.2).
  const d = colors.dark;
  const name = nameOf(trip.countryAdm0, i18n.language);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('sos.buttonA11y', countryWords(name, i18n.language))}
      accessibilityValue={{ text: trip.countryAdm0 }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.sos,
        { bottom, backgroundColor: d.textAlert, transform: [{ scale: pressed ? 0.96 : 1 }] },
      ]}
      testID="sos-button"
    >
      <PhoneIcon color={d.canvas} size={20} />
      <Text
        style={[styles.sosText, { color: d.canvas }]}
        numberOfLines={1}
        ellipsizeMode="tail"
        maxFontSizeMultiplier={1.6}
      >
        <Text style={styles.sosWord}>SOS</Text>
        {` · ${name}`}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: {
    minHeight: layout.formBarHeight,
    paddingEnd: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  close: {
    width: layout.touchTargetMin,
    height: layout.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { padding: 16, gap: 16 },
  chip: {
    minHeight: layout.touchTargetMin,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    justifyContent: 'center',
  },
  source: { minHeight: layout.touchTargetMin, justifyContent: 'center' },
  sos: {
    position: 'absolute',
    end: 12,
    minHeight: layout.touchTargetMin,
    maxWidth: '90%',
    borderRadius: radius.pill,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 2,
    borderColor: 'rgba(3, 6, 15, 0.6)',
    elevation: 2,
  },
  sosText: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 22, flexShrink: 1 },
  sosWord: { fontFamily: fonts.semibold, letterSpacing: 0.5 },
  link: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: radius.md,
    paddingHorizontal: 4,
  },
});
