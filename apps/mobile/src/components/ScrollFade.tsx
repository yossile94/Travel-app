/**
 * Sprint 12 P-4 (polish-audit 4): the last 24dp of a scrolling list fade into
 * the card while more is below, so it's clear the content goes on. A sibling
 * of the ScrollView, drawn over its bottom; decoration only, it takes no
 * touches and the screen reader skips it.
 */
import { useCallback, useId, useRef, useState } from 'react';
import { StyleSheet, type NativeScrollEvent } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { layout, motion } from '@/theme/tokens';

/** More than a point left below the viewport. */
export function hasMoreBelow(
  contentHeight: number,
  scrollY: number,
  viewportHeight: number,
): boolean {
  return contentHeight - (scrollY + viewportHeight) > 1;
}

/**
 * Tracks whether a ScrollView has more below. Feed it the scroll events, the
 * content size and the layout; it re-renders only when the answer changes.
 */
export function useMoreBelow() {
  const metrics = useRef({ content: 0, y: 0, viewport: 0 });
  const [more, setMore] = useState(false);
  const update = useCallback(() => {
    const { content, y, viewport } = metrics.current;
    const next = viewport > 0 && hasMoreBelow(content, y, viewport);
    setMore((was) => (was === next ? was : next));
  }, []);
  return {
    more,
    onScroll: useCallback(
      (event: { nativeEvent: NativeScrollEvent }) => {
        const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
        metrics.current = {
          content: contentSize.height,
          y: contentOffset.y,
          viewport: layoutMeasurement.height,
        };
        update();
      },
      [update],
    ),
    onContentSizeChange: useCallback(
      (_width: number, height: number) => {
        metrics.current.content = height;
        update();
      },
      [update],
    ),
    onLayout: useCallback(
      (event: { nativeEvent: { layout: { height: number } } }) => {
        metrics.current.viewport = event.nativeEvent.layout.height;
        update();
      },
      [update],
    ),
  };
}

export function ScrollFade({ visible, color }: { visible: boolean; color: string }) {
  // An SVG id: useId's colons don't belong in url(#…).
  const id = `fade${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const reduceMotion = useReducedMotion();
  const style = useAnimatedStyle(() => ({
    opacity: withTiming(visible ? 1 : 0, {
      duration: reduceMotion ? 0 : motion.short,
      easing: Easing.linear,
    }),
  }));
  return (
    <Animated.View
      style={[styles.fade, style]}
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      // For tests only: the element is hidden from the screen reader.
      accessibilityValue={{ text: visible ? 'more' : 'end' }}
      testID="scroll-fade"
    >
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity={0} />
            <Stop offset="1" stopColor={color} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fade: {
    position: 'absolute',
    start: 0,
    end: 0,
    bottom: 0,
    height: layout.scrollFadeHeight,
  },
});
