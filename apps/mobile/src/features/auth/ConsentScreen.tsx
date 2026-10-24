/**
 * The blocking consent screen (sprint 1 AC-16, AC-18; design 5). Full screen,
 * no ×: the user either accepts or signs out. Shown for a first sign-in, for
 * a newer document version, and at launch when this device has no record of
 * consent, even offline (AC-18a).
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { CheckboxRow, InlineNotice } from '@/components/formControls';
import { colors, fonts, layout, radius, type ColorScheme } from '@/theme/tokens';

import { useAuth, type ConsentOutcome } from './AuthProvider';
import type { ConsentNeed, LegalDocType, LegalDocument } from './consentStatus';
import { legalDrafts } from './legalDrafts';

interface Props {
  need: Exclude<ConsentNeed, { kind: 'none' }>;
  documents: LegalDocument[] | null;
  colorScheme: ColorScheme;
  reduceMotion: boolean;
  insetsTop: number;
  insetsBottom: number;
}

/** DD.MM.YYYY, written out by hand: Hermes has no Intl formatToParts. */
function shortDate(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
}

export function ConsentScreen({
  need,
  documents,
  colorScheme,
  reduceMotion,
  insetsTop,
  insetsBottom,
}: Props) {
  const { t } = useTranslation();
  const { submitConsent, signOut } = useAuth();
  const palette = colors[colorScheme];
  const [agreed, setAgreed] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<Exclude<ConsentOutcome, 'done'> | null>(null);
  const [reading, setReading] = useState<LegalDocType | null>(null);

  const updated = need.kind === 'updated' ? need.docs : [];
  const firstTime = need.kind === 'first';
  const draftVersion = documents?.find((d) => d.version === 0)?.version;

  const title = firstTime
    ? t('consent.title')
    : updated.length === 2
      ? t('consent.titleUpdatedBoth')
      : updated[0] === 'terms'
        ? t('consent.titleUpdatedTerms')
        : t('consent.titleUpdatedPrivacy');

  const confirmLeave = () =>
    Alert.alert(t('consent.leaveTitle'), t('consent.leaveBody'), [
      { text: t('consent.leaveCancel'), style: 'cancel' },
      { text: t('consent.leaveConfirm'), onPress: () => void signOut() },
    ]);

  const onContinue = async () => {
    if (!agreed || saving) return;
    setSaving(true);
    setProblem(null);
    // Re-consent to a document asks nothing optional again (design 5.3).
    const outcome = await submitConsent(firstTime ? { marketing, analytics } : {});
    setSaving(false);
    if (outcome === 'stale') setAgreed(false);
    if (outcome !== 'done') setProblem(outcome);
  };

  const openDocument = (doc: LegalDocument) => {
    if (doc.url) void Linking.openURL(doc.url);
    else setReading(doc.docType);
  };

  return (
    <Modal
      visible
      animationType={reduceMotion ? 'fade' : 'slide'}
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={confirmLeave}
    >
      <View style={[styles.screen, { backgroundColor: palette.canvas, paddingTop: insetsTop }]}>
        <ScrollView contentContainerStyle={styles.content} testID="consent-screen">
          {draftVersion !== undefined ? (
            <View style={[styles.badge, { backgroundColor: palette.infoBg }]}>
              <Text style={[styles.badgeText, { color: palette.infoFg }]}>
                {t('consent.draftBadge', { version: draftVersion })}
              </Text>
            </View>
          ) : null}
          <Text style={[styles.title, { color: palette.textPrimary }]} accessibilityRole="header">
            {title}
          </Text>
          <Text style={[styles.body, { color: palette.textSecondary }]}>
            {firstTime ? t('consent.body') : t('consent.bodyUpdated')}
          </Text>

          <View style={[styles.card, cardStyle(colorScheme)]}>
            <CheckboxRow
              checked={agreed}
              onToggle={() => setAgreed((v) => !v)}
              label={t('consent.agree')}
              strong
              disabled={saving}
              colorScheme={colorScheme}
              testID="consent-agree"
            />
            <View style={[styles.divider, { backgroundColor: palette.borderSubtle }]} />
            {(documents ?? []).map((doc) => (
              <Pressable
                key={doc.docType}
                accessibilityRole="link"
                onPress={() => openDocument(doc)}
                style={styles.docRow}
                testID={`consent-doc-${doc.docType}`}
              >
                <View style={styles.docText}>
                  <Text style={[styles.docTitle, { color: palette.link }]}>
                    {t(doc.docType === 'terms' ? 'consent.terms' : 'consent.privacy')}
                  </Text>
                  <Text style={[styles.footnote, { color: palette.textSecondary }]}>
                    {t('consent.docMeta', {
                      version: doc.version,
                      date: shortDate(doc.publishedAt),
                    })}
                  </Text>
                </View>
                {updated.includes(doc.docType) ? (
                  <View style={[styles.badge, { backgroundColor: palette.infoBg }]}>
                    <Text style={[styles.badgeText, { color: palette.infoFg }]}>
                      {t('consent.new')}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            ))}
          </View>

          {firstTime ? (
            <>
              <Text style={[styles.subTitle, { color: palette.textPrimary }]}>
                {t('consent.optionalTitle')}
              </Text>
              <Text style={[styles.footnote, { color: palette.textSecondary }]}>
                {t('consent.optionalBody')}
              </Text>
              <View style={[styles.card, cardStyle(colorScheme)]}>
                <CheckboxRow
                  checked={marketing}
                  onToggle={() => setMarketing((v) => !v)}
                  label={t('consent.marketing')}
                  description={t('consent.marketingNote')}
                  disabled={saving}
                  colorScheme={colorScheme}
                  testID="consent-marketing"
                />
                <CheckboxRow
                  checked={analytics}
                  onToggle={() => setAnalytics((v) => !v)}
                  label={t('consent.analytics')}
                  description={t('consent.analyticsNote')}
                  disabled={saving}
                  colorScheme={colorScheme}
                  testID="consent-analytics"
                />
              </View>
            </>
          ) : (
            <Text style={[styles.footnote, styles.unchanged, { color: palette.textSecondary }]}>
              {t('consent.choicesUnchanged')}
            </Text>
          )}
        </ScrollView>

        <View
          style={[
            styles.footer,
            { paddingBottom: insetsBottom + 12, borderTopColor: palette.borderSubtle },
          ]}
        >
          {problem ? (
            <View style={styles.noticeGap}>
              <InlineNotice
                text={problem === 'offline' ? t('consent.offline') : t('consent.error')}
                colorScheme={colorScheme}
                testID="consent-notice"
              />
            </View>
          ) : null}
          {!agreed ? (
            <Text style={[styles.footnote, styles.helper, { color: palette.textSecondary }]}>
              {t('consent.needsTick')}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !agreed || saving, busy: saving }}
            disabled={!agreed || saving}
            onPress={() => void onContinue()}
            style={[
              styles.primary,
              { backgroundColor: agreed ? palette.primary : palette.disabledBg },
            ]}
            testID="consent-continue"
          >
            <Text
              style={[
                styles.primaryLabel,
                { color: agreed ? palette.onPrimary : palette.disabledFg },
              ]}
            >
              {saving ? t('consent.saving') : t('consent.continue')}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={confirmLeave}
            style={styles.textButton}
            testID="consent-leave"
          >
            <Text style={[styles.textButtonLabel, { color: palette.link }]}>
              {t('consent.leave')}
            </Text>
          </Pressable>
        </View>
      </View>

      {reading ? (
        <BottomSheet
          visible
          colorScheme={colorScheme}
          reduceMotion={reduceMotion}
          insetsBottom={insetsBottom}
          onClose={() => setReading(null)}
          testID="legal-draft"
        >
          <ScrollView style={styles.draft}>
            <Text style={[styles.subTitle, { color: palette.textPrimary }]}>
              {legalDrafts[reading].title}
            </Text>
            <Text style={[styles.body, { color: palette.textSecondary }]}>
              {legalDrafts[reading].body}
            </Text>
          </ScrollView>
        </BottomSheet>
      ) : null}
    </Modal>
  );
}

function cardStyle(colorScheme: ColorScheme) {
  const palette = colors[colorScheme];
  return {
    backgroundColor: palette.surface,
    borderColor: palette.borderSubtle,
    borderWidth: colorScheme === 'dark' ? 1 : 0,
  };
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 24, paddingBottom: 24 },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  badgeText: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
  title: { fontFamily: fonts.bold, fontSize: 28, lineHeight: 34, marginTop: 12, textAlign: 'left' },
  subTitle: {
    fontFamily: fonts.semibold,
    fontSize: 18,
    lineHeight: 24,
    marginTop: 24,
    textAlign: 'left',
  },
  body: {
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 24,
    marginTop: 8,
    textAlign: 'left',
  },
  footnote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, textAlign: 'left' },
  unchanged: { marginTop: 20 },
  card: { borderRadius: radius.lg, paddingHorizontal: 16, marginTop: 16 },
  divider: { height: 1 },
  docRow: { minHeight: layout.listRowMin, flexDirection: 'row', alignItems: 'center', gap: 12 },
  docText: { flex: 1, paddingVertical: 8 },
  docTitle: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 24, textAlign: 'left' },
  footer: { paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1 },
  noticeGap: { marginBottom: 12 },
  helper: { marginBottom: 8 },
  primary: {
    height: layout.touchTargetMin,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryLabel: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 24 },
  textButton: { height: layout.touchTargetMin, alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 24 },
  draft: { maxHeight: 480, marginTop: 8 },
});
