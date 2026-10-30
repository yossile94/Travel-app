/**
 * Sprint 12 F-034 (AC-5 – AC-8, design 1): the system splash hands over to
 * this overlay with no pixel changed, a route is drawn from Israel to a pin
 * while the globe loads underneath, and the overlay fades when the globe is
 * ready, on an error, or at the cap. Decoration only: hidden from TalkBack.
 */
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

import { launchAlertOnce } from '@/features/push/usePushOpen';
import { easing, launch, motion, timing } from '@/theme/tokens';

import { launchShown, launchSignals } from './launchSignals';

/** Raz 5: the UI thread starts an animation a frame or two after it is set. */
const FRAMES_2 = 32;
const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const splashIcon = require('../../../assets/splash-icon.png');

/**
 * Raz 4: the dash starts a cap's width before the path, so frame 0 has no
 * round cap left on a zero-length dash at Israel.
 */
const dashHidden = launch.routeLength + launch.routeUnderlayWidth;
// Raz 10: the next dash starts a cap width after the path ends, so none shows at Bangkok.
const dashArray = [launch.routeLength, launch.routeLength + 2 * launch.routeUnderlayWidth];
/** viewBox units per dp (design 1.2). */
const u = launch.viewBox / launch.iconFrame;
const pinSize = { width: launch.pinWidth / u, height: launch.pinHeight / u };
const pinPosition = {
  left: (launch.pinAt[0] * launch.iconFrame) / launch.viewBox - pinSize.width / 2,
  top: (launch.pinAt[1] * launch.iconFrame) / launch.viewBox - pinSize.height,
};
/** The route starts at the origin dot: Israel (design 1.2). */
const [originX, originY] = launch.routePath.slice(1).split(' ').map(Number);
/** A drop whose tip, stroke included, is the bottom middle of its 60×85 box. */
const pinHalf = launch.pinWidth / 2;
const pinRadius = pinHalf - launch.pinStroke / 2;
const pinTip = launch.pinHeight - launch.pinStroke / 2;
const pinPath =
  `M${pinHalf} ${pinTip} C${pinHalf * 0.7} ${pinTip * 0.8} ${launch.pinStroke / 2} ${pinHalf + 18} ` +
  `${launch.pinStroke / 2} ${pinHalf} A${pinRadius} ${pinRadius} 0 1 1 ${launch.pinWidth - launch.pinStroke / 2} ${pinHalf} ` +
  `C${launch.pinWidth - launch.pinStroke / 2} ${pinHalf + 18} ${pinHalf * 1.3} ${pinTip * 0.8} ${pinHalf} ${pinTip}Z`;

export function LaunchOverlay({
  onFadeStart,
  onGone,
}: {
  /** The screens underneath can be touched and read from here on (design 1.4, 1.6). */
  onFadeStart: () => void;
  /** The fade ended: the overlay leaves the tree. */
  onGone: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const [fading, setFading] = useState(false);

  const opacity = useSharedValue(1);
  const originOpacity = useSharedValue(0);
  const dashOffset = useSharedValue<number>(dashHidden);
  const pinScale = useSharedValue(0);
  const pinOpacity = useSharedValue(0);

  const hidden = useRef(false);
  const frame = useRef<number | undefined>(undefined);
  const faded = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (fn: () => void, ms: number) => timers.current.push(setTimeout(fn, ms));

  const fade = useCallback(() => {
    if (faded.current) return;
    faded.current = true;
    setFading(true);
    onFadeStart();
    // The fade is itself the reduced version, so it always runs (design 1.4).
    opacity.set(
      withTiming(0, {
        duration: motion.short,
        easing: Easing.linear,
        reduceMotion: ReduceMotion.Never,
      }),
    );
    later(onGone, motion.short + FRAMES_2);
  }, [onFadeStart, onGone, opacity]);

  // t=0 (design 1.3): the frame the system splash is hidden on.
  const play = useCallback(() => {
    if (reduceMotion) return;
    void launchAlertOnce().then((alert) => {
      // A cold start from any alert: frame 0, still (AC-8). A fade already under way: nothing to add.
      if (alert || faded.current) return;
      originOpacity.set(
        withTiming(1, {
          duration: motion.launchOrigin,
          easing: Easing.bezier(...easing.standard),
        }),
      );
      dashOffset.set(
        withDelay(
          motion.launchRouteDelay,
          withTiming(0, { duration: motion.launchRoute, easing: Easing.bezier(...easing.flyTo) }),
        ),
      );
      pinScale.set(
        withDelay(
          motion.launchPinDelay,
          withTiming(1, { duration: motion.launchPin, easing: Easing.bezier(...easing.overshoot) }),
        ),
      );
      pinOpacity.set(
        withDelay(
          motion.launchPinDelay,
          withTiming(1, { duration: motion.micro, easing: Easing.linear }),
        ),
      );
    });
  }, [reduceMotion, originOpacity, dashOffset, pinScale, pinOpacity]);

  const hide = useCallback(() => {
    if (hidden.current) return;
    hidden.current = true;
    SplashScreen.hide();
  }, []);

  // The route plays over the globe only: never before the image is drawn, even when
  // the fallback hid the system splash first (device check 30.10: a slow image).
  const played = useRef(false);
  const onImageLoad = useCallback(() => {
    frame.current = requestAnimationFrame(() => {
      hide();
      if (played.current) return;
      played.current = true;
      play();
    });
  }, [hide, play]);

  useEffect(() => {
    launchShown.mark();
    // Asked at mount, once per run, and shared with the globe (design 1.5).
    void launchAlertOnce();
    later(hide, timing.launchHideFallback);
    later(fade, timing.launchCap);
    const unsubscribe = launchSignals.subscribe(fade);
    const pending = timers.current;
    return () => {
      unsubscribe();
      pending.forEach(clearTimeout);
      // Never leave the system splash up, whatever came first (design 1.3).
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      if (!hidden.current) {
        hidden.current = true;
        SplashScreen.hide();
      }
    };
    // Mount only: the overlay lives once per run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const originProps = useAnimatedProps(() => ({ opacity: originOpacity.value }));
  const routeProps = useAnimatedProps(() => ({ strokeDashoffset: dashOffset.value }));
  const underlayProps = useAnimatedProps(() => ({ strokeDashoffset: dashOffset.value }));
  const pinStyle = useAnimatedStyle(() => ({
    opacity: pinOpacity.value,
    transform: [{ scale: pinScale.value }],
  }));

  return (
    <Animated.View
      testID="launch-overlay"
      style={[StyleSheet.absoluteFill, styles.overlay, overlayStyle]}
      pointerEvents={fading ? 'none' : 'auto'}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <View style={styles.frame}>
        <Image
          testID="launch-icon"
          source={splashIcon}
          style={styles.frame}
          onLoad={onImageLoad}
          fadeDuration={0}
        />
        <Svg style={StyleSheet.absoluteFill} viewBox={`0 0 ${launch.viewBox} ${launch.viewBox}`}>
          <AnimatedPath
            d={launch.routePath}
            fill="none"
            stroke={launch.routeUnderlay}
            strokeOpacity={launch.routeUnderlayOpacity}
            strokeWidth={launch.routeUnderlayWidth}
            strokeLinecap="round"
            strokeDasharray={dashArray}
            animatedProps={underlayProps}
          />
          <AnimatedPath
            d={launch.routePath}
            fill="none"
            stroke={launch.route}
            strokeWidth={launch.routeWidth}
            strokeLinecap="round"
            strokeDasharray={dashArray}
            animatedProps={routeProps}
          />
          <AnimatedCircle
            testID="launch-origin"
            cx={originX}
            cy={originY}
            r={launch.originSize / 2}
            fill={launch.originColor}
            animatedProps={originProps}
          />
        </Svg>
        <Animated.View testID="launch-pin" style={[styles.pin, pinStyle]}>
          <Svg width="100%" height="100%" viewBox={`0 0 ${launch.pinWidth} ${launch.pinHeight}`}>
            <Path
              d={pinPath}
              fill={launch.pin}
              stroke={launch.routeUnderlay}
              strokeOpacity={launch.routeUnderlayOpacity}
              strokeWidth={launch.pinStroke}
            />
            <Circle cx={pinHalf} cy={pinHalf} r={launch.pinDotSize / 2} fill={launch.pinDotColor} />
          </Svg>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    backgroundColor: launch.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frame: { width: launch.iconFrame, height: launch.iconFrame },
  pin: { position: 'absolute', ...pinSize, ...pinPosition, transformOrigin: 'bottom' },
});
