/**
 * Small shared controls for the account screens (sprint 1 design 7.3–7.5).
 */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import {
  colors,
  fonts,
  layout,
  motion,
  radius,
  toastColors,
  type ColorScheme,
} from '@/theme/tokens';

/** A whole-row checkbox: tapping anywhere on the row toggles it (design 7.3). */
export function CheckboxRow({
  checked,
  onToggle,
  label,
  description,
  strong = false,
  disabled = false,
  colorScheme,
  testID,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  description?: string;
  strong?: boolean;
  disabled?: boolean;
  colorScheme: ColorScheme;
  testID?: string;
}) {
  const palette = colors[colorScheme];
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      accessibilityLabel={description ? `${label}. ${description}` : label}
      onPress={onToggle}
      disabled={disabled}
      style={[
        styles.checkRow,
        { minHeight: description ? layout.listRowMin : layout.touchTargetMin },
      ]}
      testID={testID}
    >
      <View
        style={[
          styles.box,
          checked
            ? { backgroundColor: palette.primary, borderColor: palette.primary }
            : { borderColor: palette.borderControl },
        ]}
      >
        {checked ? (
          <Svg width={16} height={16} viewBox="0 0 24 24">
            <Path
              d="M5 12.5l4.5 4.5L19 7.5"
              stroke={palette.onPrimary}
              strokeWidth={3}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        ) : null}
      </View>
      <View style={styles.checkText}>
        <Text style={[strong ? styles.labelStrong : styles.label, { color: palette.textPrimary }]}>
          {label}
        </Text>
        {description ? (
          <Text style={[styles.footnote, { color: palette.textSecondary }]}>{description}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/** A non-alarming message inside a sheet or screen (design 7.4); never red. */
export function InlineNotice({
  text,
  colorScheme,
  testID,
}: {
  text: string;
  colorScheme: ColorScheme;
  testID?: string;
}) {
  const palette = colors[colorScheme];
  return (
    <View
      style={[styles.notice, { backgroundColor: palette.infoBg }]}
      accessibilityLiveRegion="polite"
      testID={testID}
    >
      <Svg width={20} height={20} viewBox="0 0 24 24">
        <Path
          d="M12 3a9 9 0 100 18 9 9 0 000-18zm0 8v5m0-8.5v.5"
          stroke={palette.infoFg}
          strokeWidth={2}
          fill="none"
          strokeLinecap="round"
        />
      </Svg>
      <Text style={[styles.noticeText, { color: palette.infoFg }]}>{text}</Text>
    </View>
  );
}

/** A short confirmation over the globe, gone after 3 s (design 7.5), or 5 s when `long`. */
export function Toast({
  text,
  top,
  onDone,
  long = false,
}: {
  text: string;
  top: number;
  onDone: () => void;
  long?: boolean;
}) {
  useEffect(() => {
    const timer = setTimeout(onDone, long ? motion.toastVisibleLong : motion.toastVisible);
    return () => clearTimeout(timer);
  }, [text, onDone, long]);
  return (
    <View
      pointerEvents="none"
      style={[styles.toastWrap, { top }]}
      accessibilityLiveRegion={long ? 'assertive' : 'polite'}
      testID="toast"
    >
      <Text style={styles.toast}>{text}</Text>
    </View>
  );
}

/**
 * Sprint 11 QA B1: a toast owned by a full-screen Modal. The globe's toast is
 * drawn under any Modal, so a screen shown as one keeps its own: `say` shows
 * a text and `render(top)` draws it, in the screen or in an open sheet.
 */
export function useToast() {
  const [toast, setToast] = useState<{ text: string; at: number } | null>(null);
  const say = useCallback((text: string) => setToast({ text, at: Date.now() }), []);
  const clear = useCallback(() => setToast(null), []);
  const render = (top: number) =>
    toast ? <Toast key={toast.at} text={toast.text} top={top} onDone={clear} /> : null;
  return { say, render };
}

const styles = StyleSheet.create({
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  box: {
    width: 24,
    height: 24,
    borderRadius: radius.xs,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkText: { flex: 1 },
  label: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, textAlign: 'left' },
  labelStrong: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 24, textAlign: 'left' },
  footnote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, textAlign: 'left' },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: radius.md,
  },
  noticeText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 20,
    textAlign: 'left',
  },
  toastWrap: { position: 'absolute', start: 24, end: 24, alignItems: 'center' },
  toast: {
    backgroundColor: toastColors.bg,
    color: toastColors.fg,
    fontFamily: fonts.medium,
    fontSize: 15,
    lineHeight: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.pill,
    overflow: 'hidden',
    textAlign: 'center',
  },
});
