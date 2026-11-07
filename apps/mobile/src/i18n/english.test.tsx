// Sprint 14 F-044 (AC-7, AC-8): on a non-Hebrew device the main surfaces read
// English, with no Hebrew left in the interface. Data the user typed and
// addresses in the country's script are theirs and may be in any language.
import { render, screen } from '@testing-library/react-native';
import type { ReactTestRendererJSON } from 'react-test-renderer';
import { I18nManager } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { SwitchVisual } from '@/components/SwitchVisual';

import { BoardingPassCard } from '@/features/globe/BoardingPassCard';
import { countryByAdm0 } from '@/features/globe/countryData';
import { alignFor, DriverCard } from '@/features/kit/DriverCard';
import { HotelScreen } from '@/features/kit/HotelScreen';
import { HotelsSection } from '@/features/kit/HotelsSection';
import i18n from '@/i18n';

jest.mock('expo-keep-awake', () => ({ useKeepAwake: jest.fn() }));
jest.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ recheckConsent: jest.fn() }),
  useAuthIfAny: () => null,
}));
jest.mock('@/features/kit/kitApi', () => ({
  deleteHotel: jest.fn(async () => 'ok'),
  saveHotel: jest.fn(async () => 'ok'),
}));
jest.mock('@/features/kit/kitStore', () => ({ refreshTripKit: jest.fn() }));

const HEBREW = /[֐-׿]/;

function texts(node: ReactTestRendererJSON | ReactTestRendererJSON[] | null): string[] {
  if (!node) return [];
  if (Array.isArray(node)) return node.flatMap(texts);
  return (node.children ?? []).flatMap((c) =>
    typeof c === 'string' ? [c] : texts(c as ReactTestRendererJSON),
  );
}

beforeAll(async () => {
  await i18n.changeLanguage('en');
});
afterAll(async () => {
  await i18n.changeLanguage('he');
});

it('the hotel list reads English', async () => {
  await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 411, height: 900 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <HotelsSection
        trip={{
          id: 't1',
          title: 'Thailand',
          countryAdm0: 'THA',
          startDate: '2026-12-20',
          endDate: '2027-01-03',
        }}
        hotels={[
          {
            id: 'h1',
            tripId: 't1',
            name: 'Amari Watergate',
            addressEn: '847 Phetchaburi Road, Bangkok',
            addressLocal: '847 ถนนเพชรบุรี กรุงเทพฯ',
            phone: '+6626539000',
            checkIn: '2026-12-20',
            checkOut: '2026-12-24',
            bookingRef: 'BK-12345',
          },
        ]}
        insurance={null}
        status="ready"
        offline={false}
        colorScheme="light"
        onToast={jest.fn()}
      />
    </SafeAreaProvider>,
  );
  expect(screen.getByText(/4 nights/)).toBeOnTheScreen();
  const hebrew = texts(screen.toJSON()).filter((t) => HEBREW.test(t));
  expect(hebrew).toEqual([]);
});

it('the country card reads English, with the English name as its title', async () => {
  await render(
    <BoardingPassCard
      country={countryByAdm0('THA')!}
      colorScheme="light"
      reduceMotion
      bottomInset={0}
      onClose={jest.fn()}
    />,
  );
  expect(screen.getAllByText('Thailand').length).toBeGreaterThan(0);
  const hebrew = texts(screen.toJSON()).filter((t) => HEBREW.test(t));
  expect(hebrew).toEqual([]);
});

const hotel = {
  id: 'h1',
  tripId: 't1',
  name: 'Amari Watergate',
  addressEn: '847 Phetchaburi Road, Bangkok',
  addressLocal: '847 ถนนเพชรบุรี กรุงเทพฯ',
  phone: '+6626539000',
  checkIn: '2026-12-20',
  checkOut: '2026-12-24',
  bookingRef: 'BK-12345',
};

it('the driver card reads English around the local address (AC-8)', async () => {
  await render(
    <DriverCard
      hotel={hotel}
      insetsTop={0}
      insetsBottom={0}
      onClose={jest.fn()}
      onOpenUrl={jest.fn()}
    />,
  );
  expect(screen.getByText(/847 ถนนเพชรบุรี/)).toBeOnTheScreen();
  const hebrew = texts(screen.toJSON()).filter((t) => HEBREW.test(t));
  expect(hebrew).toEqual([]);
});

it('the hotel form reads English (AC-8)', async () => {
  await render(
    <HotelScreen
      trip={{
        id: 't1',
        title: 'Thailand',
        countryAdm0: 'THA',
        startDate: '2026-12-20',
        endDate: '2027-01-03',
      }}
      hotel={hotel}
      hotels={[hotel]}
      colorScheme="light"
      insetsTop={0}
      insetsBottom={0}
      onClose={jest.fn()}
      onSaved={jest.fn()}
    />,
  );
  expect(screen.getAllByText(/hotel/i).length).toBeGreaterThan(0);
  const hebrew = texts(screen.toJSON()).filter((t) => HEBREW.test(t));
  expect(hebrew).toEqual([]);
});

describe('both directions (AC-8, Raz PR 34)', () => {
  afterEach(() => jest.restoreAllMocks());

  function thumbShift(): number {
    const shifts: number[] = [];
    const walk = (node: ReactTestRendererJSON | ReactTestRendererJSON[] | null) => {
      if (!node) return;
      if (Array.isArray(node)) return node.forEach(walk);
      const style = [node.props.style].flat(Infinity) as {
        transform?: { translateX?: number }[];
      }[];
      for (const s of style) {
        for (const t of s?.transform ?? [])
          if (typeof t.translateX === 'number') shifts.push(t.translateX);
      }
      (node.children ?? []).forEach(
        (c) => typeof c !== 'string' && walk(c as ReactTestRendererJSON),
      );
    };
    walk(screen.toJSON());
    return shifts.find((x) => x !== 0) ?? 0;
  }

  it('in English (LTR) an "on" switch moves right, and start is the left edge', async () => {
    jest.replaceProperty(I18nManager, 'isRTL', false);
    await render(<SwitchVisual on colorScheme="light" />);
    expect(thumbShift()).toBeGreaterThan(0);
    expect(alignFor('ltr')).toBe('left');
    expect(alignFor('rtl')).toBe('right');
  });

  it('in Hebrew (RTL) it moves left, and the sides swap', async () => {
    jest.replaceProperty(I18nManager, 'isRTL', true);
    await render(<SwitchVisual on colorScheme="light" />);
    expect(thumbShift()).toBeLessThan(0);
    // React Native swaps left and right in RTL: 'left' is the physical right.
    expect(alignFor('rtl')).toBe('left');
    expect(alignFor('ltr')).toBe('right');
  });
});
