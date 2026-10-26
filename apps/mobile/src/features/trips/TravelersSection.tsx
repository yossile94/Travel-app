/**
 * Sprint 3 F-007 (AC-1): "Travelers" in the trip form (design 6). "Me" is
 * always first, never stored; up to 9 more, each a name and an optional
 * relation. Added in a small sheet over the form; removed without a dialog
 * (the form isn't saved yet, and "leave without saving?" protects it).
 */
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View, findNodeHandle } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { BottomSheet } from '@/components/BottomSheet';
import { Button, TextField } from '@/components/fields';
import { MinusCircleIcon, PersonIcon, PlusIcon } from '@/components/icons';
import { colors, fonts, layout, radius, type ColorScheme } from '@/theme/tokens';

import { codePointLength } from './tripDates';
import { cleanTypedName } from './tripFormRules';
import type { TravelerRelation, TripTraveler } from './tripsApi';

export const MAX_TRAVELERS = 9;
const NAME_MAX = 40;
const NAME_COUNTER_FROM = 30;
const RELATIONS: TravelerRelation[] = ['partner', 'child', 'parent', 'friend', 'other'];

interface Props {
  travelers: TripTraveler[];
  onChange: (travelers: TripTraveler[]) => void;
  disabled: boolean;
  colorScheme: ColorScheme;
  reduceMotion: boolean;
  insetsBottom: number;
}

export function TravelersSection({
  travelers,
  onChange,
  disabled,
  colorScheme,
  reduceMotion,
  insetsBottom,
}: Props) {
  const { t } = useTranslation();
  const palette = colors[colorScheme];
  const [adding, setAdding] = useState(false);
  const addButton = useRef<ComponentRef<typeof Pressable>>(null);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(focusTimer.current), []);
  const removeButtons = useRef<(ComponentRef<typeof Pressable> | null)[]>([]);
  /** After a removal, focus moves to the row that took its place (design 6.4). */
  const focusAfterRemove = useRef<number | null>(null);
  useEffect(() => {
    const index = focusAfterRemove.current;
    if (index === null) return;
    focusAfterRemove.current = null;
    const target = (index >= 0 ? removeButtons.current[index] : null) ?? addButton.current;
    const node = findNodeHandle(target);
    if (node) AccessibilityInfo.setAccessibilityFocus(node);
  }, [travelers]);

  const relationLabel = (relation: TravelerRelation | null) =>
    relation ? t(`traveler.rel.${relation}`) : null;

  const remove = (index: number) => {
    const name = travelers[index]!.name;
    onChange(travelers.filter((_, i) => i !== index));
    AccessibilityInfo.announceForAccessibility(t('tripForm.travelerRemoved', { name }));
    focusAfterRemove.current = Math.min(index, travelers.length - 2);
  };

  return (
    <View style={styles.section}>
      <Text style={[styles.caption, { color: palette.textSecondary }]} accessibilityRole="header">
        {t('tripForm.travelers')}
      </Text>
      <View
        style={[
          styles.card,
          {
            backgroundColor: palette.surface,
            borderColor: colorScheme === 'dark' ? palette.borderSubtle : 'transparent',
          },
        ]}
      >
        <View style={styles.row} accessible accessibilityLabel={t('tripForm.meA11y')}>
          <View style={[styles.avatar, { backgroundColor: palette.tag }]}>
            <PersonIcon color={palette.textSecondary} />
          </View>
          <View style={styles.grow}>
            <Text style={[styles.body, { color: palette.textPrimary }]}>{t('tripForm.me')}</Text>
            <Text style={[styles.caption, { color: palette.textSecondary }]}>
              {t('tripForm.meNote')}
            </Text>
          </View>
        </View>
        {travelers.map((traveler, index) => {
          const relation = relationLabel(traveler.relation);
          return (
            <View
              key={`${index}-${traveler.name}`}
              style={[styles.row, styles.divider, { borderTopColor: palette.borderSubtle }]}
            >
              <View
                style={styles.rowMain}
                accessible
                accessibilityLabel={
                  relation
                    ? t('tripForm.travelerRowA11y', { name: traveler.name, relation })
                    : traveler.name
                }
              >
                <View style={[styles.avatar, { backgroundColor: palette.tag }]}>
                  <Text style={[styles.initial, { color: palette.textSecondary }]}>
                    {[...traveler.name][0]}
                  </Text>
                </View>
                <View style={styles.grow}>
                  <Text
                    style={[styles.body, { color: palette.textPrimary }]}
                    numberOfLines={2}
                    maxFontSizeMultiplier={2}
                  >
                    {traveler.name}
                  </Text>
                  {relation ? (
                    <Text
                      style={[
                        styles.tag,
                        { backgroundColor: palette.tag, color: palette.textSecondary },
                      ]}
                    >
                      {relation}
                    </Text>
                  ) : null}
                </View>
              </View>
              <Pressable
                ref={(node) => {
                  removeButtons.current[index] = node;
                }}
                accessibilityRole="button"
                accessibilityLabel={t('tripForm.travelerRemove', { name: traveler.name })}
                disabled={disabled}
                onPress={() => remove(index)}
                style={styles.iconButton}
                testID={`traveler-remove-${index}`}
              >
                <MinusCircleIcon color={palette.textSecondary} />
              </Pressable>
            </View>
          );
        })}
        <View style={[styles.divider, { borderTopColor: palette.borderSubtle }]}>
          {travelers.length >= MAX_TRAVELERS ? (
            <Text style={[styles.footnote, styles.limit, { color: palette.textSecondary }]}>
              {t('tripForm.travelersMax')}
            </Text>
          ) : (
            <Pressable
              ref={addButton}
              accessibilityRole="button"
              disabled={disabled}
              onPress={() => setAdding(true)}
              style={({ pressed }) => [styles.add, pressed && { backgroundColor: palette.pressed }]}
              testID="traveler-add"
            >
              <PlusIcon color={palette.link} size={20} />
              <Text style={[styles.bodyStrong, { color: palette.link }]}>
                {t('tripForm.addTraveler')}
              </Text>
            </Pressable>
          )}
        </View>
      </View>
      <Text style={[styles.footnote, { color: palette.textSecondary }]}>
        {t('tripForm.travelersHint')}
      </Text>

      <TravelerSheet
        visible={adding}
        colorScheme={colorScheme}
        reduceMotion={reduceMotion}
        insetsBottom={insetsBottom}
        onClose={() => setAdding(false)}
        onAdd={(traveler) => {
          setAdding(false);
          onChange([...travelers, traveler]);
          AccessibilityInfo.announceForAccessibility(
            t('tripForm.travelerAdded', { name: traveler.name }),
          );
          // After the sheet or screen has gone (design: focus returns to "add").
          clearTimeout(focusTimer.current);
          focusTimer.current = setTimeout(() => {
            const node = findNodeHandle(addButton.current);
            if (node) AccessibilityInfo.setAccessibilityFocus(node);
          }, 400);
        }}
      />
    </View>
  );
}

/** Design 6.2: a name (1–40 code points) and an optional relation; tap a chip again to clear it. */
function TravelerSheet({
  visible,
  onAdd,
  ...sheet
}: {
  visible: boolean;
  colorScheme: ColorScheme;
  reduceMotion: boolean;
  insetsBottom: number;
  onClose: () => void;
  onAdd: (traveler: TripTraveler) => void;
}) {
  const { t } = useTranslation();
  const palette = colors[sheet.colorScheme];
  const [name, setName] = useState('');
  const [relation, setRelation] = useState<TravelerRelation | null>(null);
  const [submitted, setSubmitted] = useState(false);
  // Each opening starts empty (design 6.2: closing discards what was typed).
  const [openedAs, setOpenedAs] = useState(visible);
  if (openedAs !== visible) {
    setOpenedAs(visible);
    if (visible) {
      setName('');
      setRelation(null);
      setSubmitted(false);
    }
  }
  const length = codePointLength(name.trim());
  const error = !submitted
    ? null
    : length === 0
      ? t('traveler.required')
      : length > NAME_MAX
        ? t('traveler.tooLong')
        : null;

  const add = () => {
    setSubmitted(true);
    if (length === 0 || length > NAME_MAX) return;
    onAdd({ name: name.trim(), relation });
  };

  return (
    <BottomSheet {...sheet} visible={visible} testID="traveler-sheet">
      <View style={styles.sheet}>
        <Text style={[styles.title2, { color: palette.textPrimary }]} accessibilityRole="header">
          {t('traveler.titleNew')}
        </Text>
        <TextField
          label={t('traveler.name')}
          value={name}
          // Control and bidi-control characters are dropped as they're typed (design 6.3).
          onChangeText={(text) => setName(cleanTypedName(text))}
          autoFocus
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={add}
          error={error}
          counter={
            length >= NAME_COUNTER_FROM ? t('tripForm.counter', { n: length, max: NAME_MAX }) : null
          }
          maxLength={NAME_MAX * 2}
          colorScheme={sheet.colorScheme}
          testID="traveler-name"
        />
        <View accessibilityRole="radiogroup" accessibilityLabel={t('traveler.relation')}>
          <Text style={[styles.caption, styles.chipsLabel, { color: palette.textSecondary }]}>
            {t('traveler.relation')}
          </Text>
          <View style={styles.chips}>
            {RELATIONS.map((option) => {
              const checked = relation === option;
              return (
                <Pressable
                  key={option}
                  accessibilityRole="radio"
                  accessibilityState={{ checked }}
                  accessibilityHint={checked ? t('traveler.relationHint') : undefined}
                  hitSlop={{ top: 4, bottom: 4 }}
                  onPress={() => setRelation(checked ? null : option)}
                  style={[
                    styles.chip,
                    checked
                      ? { backgroundColor: palette.primary, borderColor: palette.primary }
                      : { borderColor: palette.borderControl },
                  ]}
                  testID={`traveler-rel-${option}`}
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
                  <Text
                    style={[
                      styles.callout,
                      { color: checked ? palette.onPrimary : palette.textPrimary },
                    ]}
                  >
                    {t(`traveler.rel.${option}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        <View style={styles.buttons}>
          <Button
            kind="primary"
            label={t('traveler.add')}
            onPress={add}
            colorScheme={sheet.colorScheme}
            testID="traveler-save"
          />
          <View style={styles.center}>
            <Button
              kind="text"
              label={t('traveler.cancel')}
              onPress={sheet.onClose}
              colorScheme={sheet.colorScheme}
            />
          </View>
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  card: { borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden' },
  row: {
    minHeight: layout.listRowMin,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingStart: 16,
    paddingEnd: 4,
    paddingVertical: 8,
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  divider: { borderTopWidth: 1 },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 20 },
  grow: { flex: 1, gap: 2 },
  caption: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, textAlign: 'left' },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 22, textAlign: 'left' },
  bodyStrong: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 22 },
  callout: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 20 },
  footnote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, textAlign: 'left' },
  tag: {
    alignSelf: 'flex-start',
    fontFamily: fonts.semibold,
    fontSize: 12,
    lineHeight: 16,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  iconButton: {
    width: layout.touchTargetMin,
    height: layout.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  add: {
    minHeight: layout.touchTargetMin,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  limit: { paddingHorizontal: 16, paddingVertical: 14 },
  sheet: { gap: 16, marginTop: 8 },
  title2: { fontFamily: fonts.semibold, fontSize: 22, lineHeight: 28, textAlign: 'left' },
  chipsLabel: { marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  buttons: { gap: 4 },
  center: { alignItems: 'center' },
});
