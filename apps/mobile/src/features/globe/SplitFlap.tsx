import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { fonts, radius } from '@/theme/tokens';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const TICK_MS = 60;
/** First letter settles at 300 ms, each next one 140 ms later: 3 letters land by 580 ms (≤ 700, spec 12.3). */
const settleAt = (index: number) => 300 + index * 140;

function randomLetter() {
  return LETTERS[Math.floor(Math.random() * LETTERS.length)]!;
}

interface Props {
  text: string;
  reduceMotion: boolean;
  dark: boolean;
  accessibilityLabel: string;
}

/** Departure-board letters that flip through the alphabet before landing on `text`. */
export function SplitFlap({ text, reduceMotion, dark, accessibilityLabel }: Props) {
  // The card mounts afresh for each country, so the scramble starts on the first render.
  const [shown, setShown] = useState(() =>
    reduceMotion ? text : text.replace(/./g, randomLetter),
  );

  useEffect(() => {
    if (reduceMotion) return;
    const start = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - start;
      const next = [...text]
        .map((ch, i) => (elapsed >= settleAt(i) ? ch : randomLetter()))
        .join('');
      setShown(next);
      if (next === text) clearInterval(timer);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [text, reduceMotion]);

  return (
    <View
      style={styles.row}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    >
      {[...(reduceMotion ? text : shown)].map((ch, i) => (
        <View key={i} style={[styles.cell, dark && styles.cellDark]}>
          <Text style={styles.letter} importantForAccessibility="no">
            {ch}
          </Text>
          <View style={styles.hinge} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // Letters read left to right even in an RTL layout.
  row: { flexDirection: 'row', direction: 'ltr', gap: 2 },
  cell: {
    width: 26,
    height: 36,
    borderRadius: radius.flap,
    backgroundColor: '#121C36',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  cellDark: { backgroundColor: '#060B18' },
  letter: {
    color: '#F4E7D0',
    fontFamily: fonts.semibold,
    fontSize: 22,
    fontVariant: ['tabular-nums'],
  },
  hinge: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
});
