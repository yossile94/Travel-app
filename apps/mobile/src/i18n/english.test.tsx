// Sprint 14 F-044 (AC-7, AC-8): on a non-Hebrew device the main surfaces read
// English, with no Hebrew left in the interface. Data the user typed and
// addresses in the country's script are theirs and may be in any language.
import { render, screen } from '@testing-library/react-native';
import type { ReactTestRendererJSON } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { BoardingPassCard } from '@/features/globe/BoardingPassCard';
import { countryByAdm0 } from '@/features/globe/countryData';
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
