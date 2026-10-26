/**
 * Form fields and buttons for the sprint 2 screens (design 3.1, 3.3, 16.2):
 * a label above, help or an error below (icon and text, never colour alone),
 * a counter that appears near the limit, and buttons at least 48 tall.
 */
import type { ComponentRef, ReactNode, Ref } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import { AlertIcon, CalendarIcon } from '@/components/icons';
import { colors, fonts, layout, radius, type ColorScheme } from '@/theme/tokens';

interface FieldFrame {
  label: string;
  /** Help under the field; replaced by the error when there is one. */
  help?: string | null;
  /** Translated error text. */
  error?: string | null;
  /** "64/80", shown at the end of the help row. */
  counter?: string | null;
  colorScheme: ColorScheme;
}

function Below({ help, error, counter, colorScheme }: Omit<FieldFrame, 'label'>) {
  const palette = colors[colorScheme];
  if (!help && !error && !counter) return null;
  return (
    <View style={styles.below}>
      {error ? (
        <View style={styles.errorRow} accessibilityLiveRegion="polite">
          <AlertIcon color={palette.textAlert} />
          <Text style={[styles.footnote, styles.grow, { color: palette.textAlert }]}>{error}</Text>
        </View>
      ) : (
        <Text style={[styles.footnote, styles.grow, { color: palette.textSecondary }]}>
          {help ?? ''}
        </Text>
      )}
      {counter ? (
        <Text
          style={[styles.footnote, styles.counter, { color: palette.textSecondary }]}
          importantForAccessibility="no"
        >
          {counter}
        </Text>
      ) : null}
    </View>
  );
}

export type TextInputHandle = ComponentRef<typeof TextInput>;
export type ViewHandle = ComponentRef<typeof View>;

export function TextField({
  label,
  help,
  error,
  counter,
  colorScheme,
  style,
  multiline,
  ref,
  ...input
}: FieldFrame & Omit<TextInputProps, 'ref'> & { ref?: Ref<TextInputHandle> }) {
  const palette = colors[colorScheme];
  return (
    <View>
      <Text style={[styles.label, { color: palette.textSecondary }]} importantForAccessibility="no">
        {label}
      </Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        accessibilityHint={error ?? help ?? undefined}
        placeholderTextColor={palette.textTertiary}
        multiline={multiline}
        style={[
          styles.input,
          multiline && styles.multiline,
          {
            color: palette.textPrimary,
            backgroundColor: palette.surface,
            borderColor: error ? palette.textAlert : palette.borderControl,
            borderWidth: error ? 2 : 1,
          },
          style,
        ]}
        maxFontSizeMultiplier={2}
        {...input}
      />
      <Below help={help} error={error} counter={counter} colorScheme={colorScheme} />
    </View>
  );
}

/** A field that is a button: shows the date and opens the system picker (design 3.1). */
export function DateField({
  label,
  help,
  error,
  colorScheme,
  value,
  placeholder,
  a11yLabel,
  a11yHint,
  disabled,
  onPress,
  testID,
  ref,
}: FieldFrame & {
  value: string | null;
  placeholder: string;
  a11yLabel: string;
  a11yHint: string;
  disabled?: boolean;
  onPress: () => void;
  testID?: string;
  ref?: Ref<ViewHandle>;
}) {
  const palette = colors[colorScheme];
  return (
    <View style={styles.dateWrap}>
      <Text style={[styles.label, { color: palette.textSecondary }]} importantForAccessibility="no">
        {label}
      </Text>
      <Pressable
        ref={ref}
        accessibilityRole="button"
        accessibilityLabel={error ? `${a11yLabel}, ${error}` : a11yLabel}
        accessibilityHint={a11yHint}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [
          styles.input,
          styles.dateField,
          {
            backgroundColor: pressed ? palette.pressed : palette.surface,
            borderColor: error ? palette.textAlert : palette.borderControl,
            borderWidth: error ? 2 : 1,
          },
        ]}
        testID={testID}
      >
        <Text
          style={[styles.value, { color: value ? palette.textPrimary : palette.textTertiary }]}
          maxFontSizeMultiplier={2}
        >
          {value ?? placeholder}
        </Text>
        <CalendarIcon color={palette.textSecondary} />
      </Pressable>
      <Below help={help} error={error} colorScheme={colorScheme} />
    </View>
  );
}

type ButtonKind = 'primary' | 'secondary' | 'cta' | 'text' | 'link';

export function Button({
  kind,
  label,
  onPress,
  colorScheme,
  busy = false,
  busyLabel,
  disabled = false,
  icon,
  a11yLabel,
  outlined = false,
  blocked = false,
  testID,
}: {
  kind: ButtonKind;
  label: string;
  onPress: () => void;
  colorScheme: ColorScheme;
  busy?: boolean;
  busyLabel?: string;
  disabled?: boolean;
  icon?: (color: string) => ReactNode;
  a11yLabel?: string;
  /** A 1dp outline, for a secondary button on a surface of the same colour (design 2.1). */
  outlined?: boolean;
  /**
   * Looks and reads as disabled but still answers a tap, so it can say why
   * (sprint 4 design 10.3: offline, view only).
   */
  blocked?: boolean;
  testID?: string;
}) {
  const palette = colors[colorScheme];
  const fg = blocked
    ? palette.disabledFg
    : kind === 'primary'
      ? palette.onPrimary
      : kind === 'cta'
        ? palette.ctaFg
        : kind === 'secondary'
          ? palette.secondaryFg
          : kind === 'link'
            ? palette.link
            : palette.textPrimary;
  const bg = (pressed: boolean) =>
    blocked
      ? kind === 'text' || kind === 'link'
        ? 'transparent'
        : palette.disabledBg
      : kind === 'primary'
        ? palette.primary
        : kind === 'cta'
          ? pressed
            ? palette.ctaPressed
            : palette.ctaBg
          : kind === 'secondary'
            ? palette.secondaryBg
            : pressed
              ? palette.pressed
              : 'transparent';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={busy && busyLabel ? busyLabel : (a11yLabel ?? label)}
      accessibilityState={{ disabled: disabled || busy || blocked, busy }}
      // Pressable's own `disabled` overrides accessibilityState.disabled, so it's
      // left unset unless the button really can't be pressed (a blocked one can).
      disabled={disabled || busy || undefined}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        (kind === 'text' || kind === 'link') && styles.textButton,
        {
          backgroundColor: bg(pressed),
          opacity: disabled ? 0.6 : 1,
          borderWidth: outlined ? 1 : 0,
          borderColor: palette.borderControl,
          transform: [{ scale: pressed && kind !== 'text' && kind !== 'link' ? 0.98 : 1 }],
        },
      ]}
      testID={testID}
    >
      {busy ? <ActivityIndicator size={20} color={fg} /> : icon?.(fg)}
      <Text style={[styles.buttonLabel, { color: fg }]} maxFontSizeMultiplier={2}>
        {busy && busyLabel ? busyLabel : label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 6,
    textAlign: 'left',
  },
  input: {
    minHeight: 56,
    borderRadius: radius.xs * 2,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 24,
  },
  multiline: { minHeight: 96, maxHeight: 8 * 24 + 24, textAlignVertical: 'top' },
  dateWrap: { flexGrow: 1, flexBasis: layout.dateFieldMinWidth },
  dateField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  // Shrinks before the icon: a long date in a narrow field never runs into it.
  value: {
    flexShrink: 1,
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 24,
    fontVariant: ['tabular-nums'],
  },
  below: { flexDirection: 'row', gap: 8, marginTop: 6 },
  errorRow: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  grow: { flex: 1, textAlign: 'left' },
  footnote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  counter: { fontVariant: ['tabular-nums'] },
  button: {
    minHeight: layout.touchTargetMin,
    borderRadius: radius.pill,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  textButton: { paddingHorizontal: 12, alignSelf: 'flex-start' },
  buttonLabel: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 24, textAlign: 'center' },
});
