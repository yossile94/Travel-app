import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { withTiming } from 'react-native-reanimated';

import '@/i18n';
import { motion } from '@/theme/tokens';

import { BoardingPassCard, isolateLtr, isolateOwn } from './BoardingPassCard';
import { countryByAdm0 } from './countryData';

// 20:53 in Israel on 22 Oct 2026 (Israel on summer time, UTC+3).
const NOW = new Date(Date.UTC(2026, 9, 22, 17, 53, 10));

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
});
afterEach(() => {
  jest.useRealTimers();
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

  it('shows the live local time and the difference from Israel (AC-4)', async () => {
    await renderCard('THA');
    expect(screen.getByText(isolateLtr('00:53'))).toBeOnTheScreen();
    expect(screen.getByText('4 שעות יותר מבישראל')).toBeOnTheScreen();
  });

  it('names the city when a country spans several time zones', async () => {
    await renderCard('USA');
    expect(screen.getByText('שעה מקומית · וושינגטון')).toBeOnTheScreen();
    expect(screen.getByText(isolateLtr('13:53'))).toBeOnTheScreen();
    expect(screen.getByText('7 שעות פחות מבישראל')).toBeOnTheScreen();
  });

  it('shows the currency with its Hebrew name, symbol and code (AC-4)', async () => {
    await renderCard('THA');
    expect(screen.getByText('בהט תאילנדי')).toBeOnTheScreen();
    expect(screen.getByText(isolateLtr(`${isolateOwn('฿')} · THB`))).toBeOnTheScreen();
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
    expect(screen.getByText(isolateLtr(`${isolateOwn('د.ب.')} · BHD`))).toBeOnTheScreen();
  });

  it('shows the code alone where there is no other symbol (Switzerland)', async () => {
    await renderCard('CHE');
    expect(screen.getByText(isolateLtr('CHF'))).toBeOnTheScreen();
  });

  it('hides time and currency where there are none (Antarctica)', async () => {
    await renderCard('ATA');
    expect(screen.getByText('אנטארקטיקה')).toBeOnTheScreen();
    expect(screen.queryByTestId('card-time')).toBeNull();
    expect(screen.queryByTestId('card-currency')).toBeNull();
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
    expect(screen.queryByTestId('card-time')).toBeNull();
    expect(screen.getByTestId('card-currency')).toBeOnTheScreen();
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
    expect(screen.getByText('כמו בישראל')).toBeOnTheScreen();
  });

  it('exposes the country code to screen readers, not the flipping letters', async () => {
    await renderCard('THA');
    expect(screen.getByLabelText('קוד המדינה THA')).toBeOnTheScreen();
  });
});
