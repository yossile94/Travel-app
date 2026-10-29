import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { withTiming } from 'react-native-reanimated';
import { Platform, StyleSheet } from 'react-native';

import '@/i18n';
import { motion } from '@/theme/tokens';

import { BoardingPassCard, isolateLtr, isolateOwn, spaceEnglishName } from './BoardingPassCard';
import { countryByAdm0 } from './countryData';

// 20:53 in Israel on 22 Oct 2026 (Israel on summer time, UTC+3).
const NOW = new Date(Date.UTC(2026, 9, 22, 17, 53, 10));

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function renderCard(adm0: string, onClose = jest.fn()) {
  const country = countryByAdm0(adm0)!;
  await render(
    <BoardingPassCard
      country={country}
      colorScheme="light"
      reduceMotion
      bottomInset={0}
      onClose={onClose}
    />,
  );
  return { onClose };
}

describe('BoardingPassCard', () => {
  it('shows the destination in Hebrew and English (AC-4)', async () => {
    await renderCard('THA');
    expect(screen.getByText('תאילנד')).toBeOnTheScreen();
    expect(screen.getByText('Thailand')).toBeOnTheScreen();
  });

  it('shows the live local time on its tile, and the difference in its sheet (AC-4, fix 6.2)', async () => {
    await renderCard('THA');
    expect(screen.getByText(isolateLtr('00:53'))).toBeOnTheScreen();
    expect(screen.getByTestId('card-tile-time').props.accessibilityLabel).toBe(
      'שעה מקומית: 00:53, 4 שעות יותר מבישראל',
    );
    await fireEvent.press(screen.getByTestId('card-tile-time'));
    expect(screen.getByTestId('time-sheet-difference')).toHaveTextContent('4 שעות יותר מבישראל');
  });

  it('names the city when a country spans several time zones', async () => {
    await renderCard('USA');
    expect(screen.getByText(isolateLtr('13:53'))).toBeOnTheScreen();
    expect(screen.getByTestId('card-tile-time').props.accessibilityLabel).toBe(
      'שעה מקומית · וושינגטון: 13:53, 7 שעות פחות מבישראל',
    );
  });

  it('shows the currency code on its tile, and its Hebrew name, symbol and code in the sheet (AC-4)', async () => {
    await renderCard('THA');
    expect(screen.getByText(isolateLtr('THB'))).toBeOnTheScreen();
    expect(screen.getByTestId('card-tile-money').props.accessibilityLabel).toMatch(
      /^מטבע: בהט תאילנדי/,
    );
    await fireEvent.press(screen.getByTestId('card-tile-money'));
    expect(
      screen.getByText(`בהט תאילנדי · ${isolateLtr(`${isolateOwn('฿')} · THB`)}`),
    ).toBeOnTheScreen();
  });

  it('fades in with reduced motion, even though Reanimated would skip it (AC-6)', async () => {
    jest.mocked(withTiming).mockClear();
    await renderCard('THA');
    expect(withTiming).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ duration: motion.short, reduceMotion: 'never' }),
    );
  });

  it('shows the local symbol where English has none, in its own direction', async () => {
    await renderCard('BHR');
    await fireEvent.press(screen.getByTestId('card-tile-money'));
    const symbol = isolateLtr(`${isolateOwn('د.ب.')} · BHD`);
    const name = countryByAdm0('BHR')!.currency!.nameHe;
    expect(screen.getByText(`${name} · ${symbol}`)).toBeOnTheScreen();
  });

  it('shows the code alone where there is no other symbol (Switzerland)', async () => {
    await renderCard('CHE');
    expect(screen.getByText(isolateLtr('CHF'))).toBeOnTheScreen();
  });

  it('keeps a long name to two smaller lines, with the full name for the screen reader (AC-11)', async () => {
    await renderCard('SGS');
    const name = screen.getByTestId('card-name');
    expect(name.props.numberOfLines).toBe(2);
    expect(name.props.accessibilityLabel).toBe(countryByAdm0('SGS')!.nameHe);
    expect(StyleSheet.flatten(name.props.style).fontSize).toBe(22);

    await renderCard('THA');
    expect(StyleSheet.flatten(screen.getByTestId('card-name').props.style).fontSize).toBe(28);
  });

  it('ellipsizes a long English name at its end, clear of the close button (sprint 1 QA)', async () => {
    await renderCard('SGS');
    const nameEn = screen.getByTestId('card-name-en');
    expect(nameEn.props.numberOfLines).toBe(1);
    expect(nameEn.props.ellipsizeMode).toBe('tail');
    // A left-to-right row, inside a view that keeps the app's direction and
    // the padding on the close button's side.
    const row = nameEn.parent!;
    expect(StyleSheet.flatten(row.props.style).direction).toBe('ltr');
    const outer = row.parent!;
    expect(StyleSheet.flatten(outer.props.style).direction).toBeUndefined();
    expect(StyleSheet.flatten(outer.props.style).paddingEnd).toBe(48);
  });

  it('keeps the letter spacing only for an English name that surely fits (sprint 1 QA)', async () => {
    // Measured on the A73: the row is ~176 pt wide at 100%.
    expect(spaceEnglishName('SAUDI ARABIA', 1, 176, 'android')).toBe(true);
    expect(spaceEnglishName('UNITED ARAB EMIRATES', 1, 176, 'android')).toBe(false);
    expect(spaceEnglishName('SAUDI ARABIA', 1.3, 176, 'android')).toBe(false);
    // Before the row is measured, no spacing: never a wrongly cut name.
    expect(spaceEnglishName('FIJI', 1, 0, 'android')).toBe(false);
    // The bug is Android's: iOS keeps the designed spacing.
    expect(spaceEnglishName('UNITED ARAB EMIRATES', 1, 176, 'ios')).toBe(true);

    jest.replaceProperty(Platform, 'OS', 'android');
    await renderCard('SGS');
    const nameEn = screen.getByTestId('card-name-en');
    await fireEvent(nameEn.parent!, 'layout', { nativeEvent: { layout: { width: 176 } } });
    expect(StyleSheet.flatten(screen.getByTestId('card-name-en').props.style).letterSpacing).toBe(
      0,
    );

    await renderCard('FJI');
    const fiji = screen.getByTestId('card-name-en');
    await fireEvent(fiji.parent!, 'layout', { nativeEvent: { layout: { width: 176 } } });
    expect(StyleSheet.flatten(screen.getByTestId('card-name-en').props.style).letterSpacing).toBe(
      2,
    );
  });

  it('gives the close button a 48 pt target', async () => {
    await renderCard('THA');
    const close = StyleSheet.flatten(screen.getByTestId('card-close').props.style);
    expect(close.width).toBe(48);
    expect(close.height).toBe(48);
  });

  it('hides time and currency where there are none (Antarctica)', async () => {
    await renderCard('ATA');
    expect(screen.getByText('אנטארקטיקה')).toBeOnTheScreen();
    expect(screen.queryByTestId('card-tile-time')).toBeNull();
    expect(screen.queryByTestId('card-tile-money')).toBeNull();
    // Safety is always there outside Israel (fix 5.1).
    expect(screen.getByTestId('card-tile-safety')).toBeOnTheScreen();
  });

  it('ticks over exactly on the minute', async () => {
    await renderCard('THA');
    expect(screen.getByText(isolateLtr('00:53'))).toBeOnTheScreen();
    await act(() => jest.advanceTimersByTime(50_000)); // to 17:54:00 UTC
    expect(screen.getByText(isolateLtr('00:54'))).toBeOnTheScreen();
  });

  it('closes from the close button', async () => {
    const { onClose } = await renderCard('THA');
    await fireEvent.press(screen.getByLabelText('סגירה'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('hides the time instead of crashing when the runtime rejects the time zone', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const country = { ...countryByAdm0('THA')!, timeZone: 'Not/AZone' };
    await render(
      <BoardingPassCard
        country={country}
        colorScheme="light"
        reduceMotion
        bottomInset={0}
        onClose={jest.fn()}
      />,
    );
    expect(screen.getByText('תאילנד')).toBeOnTheScreen();
    expect(screen.queryByTestId('card-tile-time')).toBeNull();
    expect(screen.getByTestId('card-tile-money')).toBeOnTheScreen();
    warn.mockRestore();
  });

  it('renders in dark mode', async () => {
    await render(
      <BoardingPassCard
        country={countryByAdm0('GRC')!}
        colorScheme="dark"
        reduceMotion
        bottomInset={24}
        onClose={jest.fn()}
      />,
    );
    expect(screen.getByText('יוון')).toBeOnTheScreen();
    expect(screen.getByTestId('card-tile-time').props.accessibilityLabel).toMatch(/כמו בישראל$/);
  });

  it("the coupon's room is measured from its top: the header plus the strip (fix AC-6, Raz Q1)", async () => {
    const coupon = jest.fn((_max: number) => null);
    await render(
      <BoardingPassCard
        country={countryByAdm0('THA')!}
        colorScheme="light"
        reduceMotion
        bottomInset={0}
        topInset={0}
        onClose={jest.fn()}
        coupon={coupon}
      />,
    );
    const layout = (height: number) => ({
      nativeEvent: { layout: { x: 0, y: 0, width: 360, height } },
    });
    await fireEvent(screen.getByTestId('card-header'), 'layout', layout(150));
    await fireEvent(screen.getByTestId('card-strip'), 'layout', layout(110));
    const withStrip = coupon.mock.calls.at(-1)![0];
    await fireEvent(screen.getByTestId('card-strip'), 'layout', layout(220));
    // A strip 110 taller leaves the list 110 less: the strip counts (not just the header).
    expect(withStrip - coupon.mock.calls.at(-1)![0]).toBe(110);
  });

  it('Trips mode: a fade, then the compact header and no strip; its old height no longer counts (Raz 2)', async () => {
    const coupon = jest.fn((_max: number, _notice: unknown, _mode: boolean) => null);
    const props = {
      country: countryByAdm0('THA')!,
      colorScheme: 'light' as const,
      reduceMotion: true,
      bottomInset: 0,
      topInset: 0,
      onClose: jest.fn(),
      coupon,
    };
    const { rerender } = await render(<BoardingPassCard {...props} />);
    const layout = (height: number) => ({
      nativeEvent: { layout: { x: 0, y: 0, width: 360, height } },
    });
    await fireEvent(screen.getByTestId('card-header'), 'layout', layout(150));
    await fireEvent(screen.getByTestId('card-strip'), 'layout', layout(212));
    const destination = coupon.mock.calls.at(-1)![0];

    await rerender(<BoardingPassCard {...props} tripsMode />);
    // Until the fade's first half ends, the destination view stays and taps wait.
    expect(screen.getByTestId('card-strip')).toBeOnTheScreen();
    expect(screen.getByTestId('country-card').props.pointerEvents).toBe('none');
    await act(async () => jest.advanceTimersByTime(motion.cardTripsModeFade));
    expect(screen.queryByTestId('card-strip')).toBeNull();
    expect(screen.queryByTestId('card-tiles')).toBeNull();
    expect(screen.queryByTestId('card-name-en')).toBeNull();
    expect(screen.getByTestId('card-trips-mode')).toBeOnTheScreen();
    await fireEvent(screen.getByTestId('card-header-compact'), 'layout', layout(96));
    const [trips, , mode] = coupon.mock.calls.at(-1)!;
    expect(mode).toBe(true);
    expect(trips - destination).toBe(150 + 212 - 96);
    await act(async () => jest.advanceTimersByTime(motion.cardTripsModeFade));
    expect(screen.getByTestId('country-card').props.pointerEvents).toBe('auto');

    const onExit = jest.fn();
    await rerender(<BoardingPassCard {...props} tripsMode onExitTripsMode={onExit} />);
    await fireEvent.press(screen.getByTestId('card-destination-details'));
    expect(onExit).toHaveBeenCalled();
  });

  it('a card that opens in Trips mode starts there, with no fade (5)', async () => {
    await render(
      <BoardingPassCard
        country={countryByAdm0('THA')!}
        colorScheme="light"
        reduceMotion
        bottomInset={0}
        onClose={jest.fn()}
        coupon={() => null}
        tripsMode
      />,
    );
    expect(screen.getByTestId('card-header-compact')).toBeOnTheScreen();
    expect(screen.queryByTestId('card-header')).toBeNull();
    expect(screen.getByTestId('country-card').props.pointerEvents).toBe('auto');
  });

  it('no tile shows a threat level, and the old warning row is gone (fix AC-2)', async () => {
    await renderCard('THA');
    expect(screen.queryByTestId('card-advisory')).toBeNull();
    expect(screen.queryByTestId('card-advisory-row')).toBeNull();
    expect(screen.getByTestId('card-tile-safety').props.accessibilityLabel).not.toMatch(/רמה/);
  });

  it('exposes the country code to screen readers, not the flipping letters', async () => {
    await renderCard('THA');
    expect(screen.getByLabelText('קוד המדינה THA')).toBeOnTheScreen();
  });
});
