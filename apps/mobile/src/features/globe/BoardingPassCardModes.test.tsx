/**
 * Sprint 12 AC-12 (design 2): in the switch to Trips mode the strip, the code
 * and the outline stay; only the texts and icons fade. One SplitFlap for both
 * modes, which plays once at most.
 */
import { act, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';

import '@/i18n';
import { motion } from '@/theme/tokens';

import { BoardingPassCard } from './BoardingPassCard';
import { countryByAdm0 } from './countryData';

const mockFlap = { mounts: 0, reduceMotion: [] as boolean[] };
jest.mock('./SplitFlap', () => ({
  SplitFlap: ({ text, reduceMotion }: { text: string; reduceMotion: boolean }) => {
    const { Text: RNText } = jest.requireActual<typeof import('react-native')>('react-native');
    const { useEffect: mockUseEffect } = jest.requireActual<typeof import('react')>('react');
    mockUseEffect(() => {
      mockFlap.mounts += 1;
    }, []);
    mockFlap.reduceMotion.push(reduceMotion);
    return <RNText testID="split-flap">{text}</RNText>;
  },
}));

beforeEach(() => {
  jest.useFakeTimers();
  mockFlap.mounts = 0;
  mockFlap.reduceMotion = [];
});
afterEach(() => jest.useRealTimers());

const props = {
  country: countryByAdm0('THA')!,
  colorScheme: 'light' as const,
  reduceMotion: false,
  bottomInset: 0,
  onClose: jest.fn(),
  coupon: () => <Text testID="coupon">coupon</Text>,
};

/** Whether this element or a view between it and the card fades (has an opacity). */
function fadesUnderCard(testID: string): boolean {
  const card = screen.getByTestId('country-card');
  let node: ReturnType<typeof screen.getByTestId> | null = screen.getByTestId(testID);
  while (node && node !== card) {
    const style = StyleSheet.flatten(node.props.style) as { opacity?: number } | undefined;
    if (style && 'opacity' in style) return true;
    node = node.parent;
  }
  return false;
}

/** The native view behind an element: the same one unless it remounted. */
const hostOf = (el: unknown) => (el as { instance: unknown }).instance;

async function intoTripsMode(rerender: (el: React.ReactElement) => Promise<void>) {
  await rerender(<BoardingPassCard {...props} tripsMode />);
  await act(async () => jest.advanceTimersByTime(motion.cardTripsModeFade * 2));
}

describe('the switch to Trips mode (sprint 12 AC-12)', () => {
  it('one SplitFlap in both modes: no remount, and no flap on the way back (4a, 4b)', async () => {
    const { rerender } = await render(<BoardingPassCard {...props} />);
    await intoTripsMode(rerender);
    await rerender(<BoardingPassCard {...props} tripsMode={false} />);
    await act(async () => jest.advanceTimersByTime(motion.cardTripsModeFade * 2));
    expect(mockFlap.mounts).toBe(1);
    // Opened with the icons and motion on: it plays at mount, and its setting never changes.
    expect(new Set(mockFlap.reduceMotion)).toEqual(new Set([false]));
  });

  it('a card that opens in Trips mode never plays the flap (4b)', async () => {
    await render(<BoardingPassCard {...props} tripsMode />);
    expect(new Set(mockFlap.reduceMotion)).toEqual(new Set([true]));
  });

  it('the strip, the code and the coupon are outside every fading view (2.2)', async () => {
    const { rerender } = await render(<BoardingPassCard {...props} />);
    expect(fadesUnderCard('card-highlight-strip')).toBe(false);
    expect(fadesUnderCard('split-flap')).toBe(false);
    expect(fadesUnderCard('coupon')).toBe(false);
    expect(fadesUnderCard('card-name')).toBe(true);
    expect(fadesUnderCard('card-barcode')).toBe(true);
    await intoTripsMode(rerender);
    expect(fadesUnderCard('card-highlight-strip')).toBe(false);
    expect(fadesUnderCard('split-flap')).toBe(false);
    expect(fadesUnderCard('coupon')).toBe(false);
    expect(fadesUnderCard('card-name')).toBe(true);
  });

  it('the coupon hears the fade and, once the card is in, entered (design 2.4, 3.2)', async () => {
    const coupon = jest.fn(
      (_max: number, _notice: unknown, _mode: boolean, _fade: unknown, _entered: boolean) => null,
    );
    await render(<BoardingPassCard {...props} coupon={coupon} />);
    const [, , , fade, entered] = coupon.mock.calls.at(-1)!;
    expect(fade).toEqual(expect.objectContaining({ value: 1 }));
    expect(entered).toBe(true);
  });

  it('the compact stub is the same 54 + 36: the code stays on the details row (Raz 3)', async () => {
    const { rerender } = await render(<BoardingPassCard {...props} />);
    await intoTripsMode(rerender);
    const stub = screen.getByTestId('split-flap').parent!;
    const style = StyleSheet.flatten(stub.props.style) as Record<string, unknown>;
    expect(style).toEqual(expect.objectContaining({ paddingTop: 54, paddingBottom: 0 }));
  });

  it('the header row and the stub stay the same elements (4a)', async () => {
    const { rerender } = await render(<BoardingPassCard {...props} />);
    const strip = hostOf(screen.getByTestId('card-highlight-strip'));
    const stub = hostOf(screen.getByTestId('split-flap').parent!);
    await intoTripsMode(rerender);
    expect(hostOf(screen.getByTestId('card-highlight-strip'))).toBe(strip);
    expect(hostOf(screen.getByTestId('split-flap').parent!)).toBe(stub);
  });
});
