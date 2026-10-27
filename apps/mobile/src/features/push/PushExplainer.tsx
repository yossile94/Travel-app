/**
 * The flight alerts explainer (sprint 6 design 2, AC-1): what comes, an
 * example alert, what an alert never shows, then "allow" or "not now". It
 * only asks: the system prompt and the consent are push.ts's allowPush.
 */
import Constants from 'expo-constants';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/fields';
import { PlaneUpIcon } from '@/components/icons';
import { colors, fonts, radius, type ColorScheme } from '@/theme/tokens';

/** The example's number: never one of the user's own flights (design 2.5). */
export const sampleNumber = (userHas: (n: string) => boolean) =>
  userHas('LY81') ? '6H12' : 'LY81';

export function PushExplainer({
  visible,
  number,
  androidNote,
  colorScheme,
  reduceMotion,
  insetsBottom,
  onAllow,
  onLater,
}: {
  visible: boolean;
  /** The example's flight number (sampleNumber). */
  number: string;
  /** Android 13+ before the permission: the system will ask next. */
  androidNote: boolean;
  colorScheme: ColorScheme;
  reduceMotion: boolean;
  insetsBottom: number;
  onAllow: () => Promise<void>;
  onLater: () => void;
}) {
  const { t } = useTranslation();
  const p = colors[colorScheme];
  const [busy, setBusy] = useState(false);
  const title = t('push.preview.title', { n: number });
  const body = t('push.preview.body');

  return (
    <BottomSheet
      visible={visible}
      colorScheme={colorScheme}
      reduceMotion={reduceMotion}
      insetsBottom={insetsBottom}
      onClose={() => !busy && onLater()}
      testID="push-explainer"
    >
      <View style={styles.body}>
        <Text
          style={[styles.title2, { color: p.textPrimary }]}
          accessibilityRole="header"
          testID="push-explainer-title"
        >
          {t('push.explainer.title')}
        </Text>
        <Text style={[styles.text, { color: p.textSecondary }]}>{t('push.explainer.body')}</Text>
        <View
          style={[
            styles.preview,
            { backgroundColor: p.surface },
            colorScheme === 'dark' && { borderWidth: 1, borderColor: p.borderSubtle },
          ]}
          accessible
          accessibilityLabel={t('push.preview.a11y', { title, body })}
          testID="push-explainer-preview"
        >
          <View style={styles.previewHead}>
            <PlaneUpIcon color={p.link} size={16} />
            <Text style={[styles.caption, styles.grow, { color: p.textSecondary }]}>
              {Constants.expoConfig?.name ?? ''} · {t('push.preview.now')}
            </Text>
            <View style={[styles.tag, { backgroundColor: p.tag }]}>
              <Text style={[styles.caption, { color: p.textSecondary }]}>
                {t('push.preview.example')}
              </Text>
            </View>
          </View>
          <Text style={[styles.strong, { color: p.textPrimary }]}>{title}</Text>
          <Text style={[styles.callout, { color: p.textPrimary }]}>{body}</Text>
        </View>
        <Text style={[styles.footnote, { color: p.textSecondary }]} testID="push-explainer-privacy">
          {t('push.explainer.privacy')}
        </Text>
        {androidNote ? (
          <Text
            style={[styles.footnote, { color: p.textSecondary }]}
            testID="push-explainer-android-note"
          >
            {t('push.explainer.androidNote')}
          </Text>
        ) : null}
        <Button
          kind="primary"
          label={t('push.explainer.allow')}
          busy={busy}
          busyLabel={t('push.explainer.allowing')}
          onPress={() => {
            if (busy) return;
            setBusy(true);
            void onAllow().finally(() => setBusy(false));
          }}
          colorScheme={colorScheme}
          testID="push-explainer-allow"
        />
        <Button
          kind="text"
          label={t('push.explainer.later')}
          disabled={busy}
          onPress={onLater}
          colorScheme={colorScheme}
          testID="push-explainer-later"
        />
        <Text style={[styles.footnote, { color: p.textTertiary }]}>
          {t('push.explainer.footnote')}
        </Text>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 12, marginTop: 8 },
  title2: { fontFamily: fonts.semibold, fontSize: 22, lineHeight: 28, textAlign: 'left' },
  text: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, textAlign: 'left' },
  preview: { borderRadius: radius.md, padding: 12, gap: 2 },
  previewHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  grow: { flex: 1 },
  tag: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  caption: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, textAlign: 'left' },
  strong: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22, textAlign: 'left' },
  callout: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 20, textAlign: 'left' },
  footnote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, textAlign: 'left' },
});
