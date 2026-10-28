import '@/i18n';

import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking, Share } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { mapsUrl, nextStep, shareText, textDirection } from './DriverCard';
import { HotelsSection } from './HotelsSection';
import type { Hotel } from './kitModel';

jest.mock('expo-keep-awake', () => ({ useKeepAwake: jest.fn() }));
jest.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ recheckConsent: jest.fn() }),
}));
jest.mock('./kitApi', () => ({
  deleteHotel: jest.fn(async () => 'ok'),
  saveHotel: jest.fn(async () => 'ok'),
}));
jest.mock('./kitStore', () => ({ refreshTripKit: jest.fn() }));

const metrics = {
  frame: { x: 0, y: 0, width: 411, height: 900 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};
const trip = {
  id: 't1',
  title: 'תאילנד',
  countryAdm0: 'THA',
  startDate: '2026-12-20',
  endDate: '2027-01-03',
};
const hotel = (o: Partial<Hotel>): Hotel => ({
  id: 'h1',
  tripId: 't1',
  name: 'Amari Watergate',
  addressEn: '847 Phetchaburi Road, Bangkok',
  addressLocal: '847 ถนนเพชรบุรี กรุงเทพฯ',
  phone: '+6626539000',
  checkIn: '2026-12-20',
  checkOut: '2026-12-24',
  bookingRef: 'BK-12345',
  ...o,
});

function show(hotels: Hotel[], offline = false) {
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <HotelsSection
        trip={trip}
        hotels={hotels}
        insurance={null}
        status="ready"
        offline={offline}
        colorScheme="light"
        onToast={jest.fn()}
      />
    </SafeAreaProvider>,
  );
}

describe('HotelsSection (AC-1 to AC-6)', () => {
  it('lists hotels by check-in, with nights and "show to driver"', async () => {
    await show([
      hotel({ id: 'b', name: 'Rayavadee', checkIn: '2026-12-24', checkOut: '2027-01-03' }),
      hotel({ id: 'a' }),
    ]);
    const rows = screen.getAllByTestId(/^card-hotel-[ab]$/).map((r) => r.props.testID);
    expect(rows).toEqual(['card-hotel-a', 'card-hotel-b']);
    expect(screen.getByText(/4 לילות/)).toBeTruthy();
    expect(screen.getByText(/10 לילות/)).toBeTruthy();
  });

  it('"show to driver" opens the full-screen card, also offline (AC-5)', async () => {
    await show([hotel({})], true);
    await fireEvent.press(screen.getByTestId('card-hotel-h1-driver'));
    expect(screen.getByTestId('driver-card')).toBeTruthy();
    expect(screen.getByTestId('driver-card-address').props.children).toBe(
      '847 ถนนเพชรบุรี กรุงเทพฯ',
    );
  });

  it('offline, adding is blocked and says why', async () => {
    await show([], true);
    await fireEvent.press(screen.getByTestId('card-hotel-add'));
    expect(screen.getByTestId('card-hotel-readonly')).toBeTruthy();
    expect(screen.queryByTestId('hotel-screen')).toBeNull();
  });

  it('at 10 hotels the add button gives way to the limit', async () => {
    await show(Array.from({ length: 10 }, (_, i) => hotel({ id: `h${i}` })));
    expect(screen.getByTestId('card-hotel-add-limit')).toBeTruthy();
    expect(screen.queryByTestId('card-hotel-add')).toBeNull();
  });

  it('the sheet hides the booking number until asked (AC-6)', async () => {
    await show([hotel({})]);
    await fireEvent.press(screen.getByTestId('card-hotel-h1-open'));
    expect(screen.getByTestId('hotel-sheet-booking-value').props.children).toBe('••••••');
    await fireEvent.press(screen.getByTestId('hotel-sheet-booking-toggle'));
    expect(String(screen.getByTestId('hotel-sheet-booking-value').props.children)).toContain(
      'BK-12345',
    );
  });

  it('navigates and shares without the booking number (AC-4, AC-6)', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const share = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    await show([hotel({})]);
    await fireEvent.press(screen.getByTestId('card-hotel-h1-open'));
    await fireEvent.press(screen.getByTestId('hotel-sheet-navigate'));
    expect(open).toHaveBeenCalledWith(
      'geo:0,0?q=Amari%20Watergate%2C%20847%20Phetchaburi%20Road%2C%20Bangkok',
    );
    await fireEvent.press(screen.getByTestId('hotel-sheet-share'));
    expect(share.mock.calls[0]![0].message).not.toContain('BK-12345');
  });
});

describe('DriverCard rules (AC-3)', () => {
  it('steps down 44 → 36 → 30 → 24 while over 8 lines, then stays', () => {
    expect(nextStep(0, 9)).toBe(1);
    expect(nextStep(1, 8)).toBe(1);
    expect(nextStep(3, 20)).toBe(3);
  });
  it('sets the direction by the content, not the interface', () => {
    expect(textDirection('847 ถนนเพชรบุรี')).toBe('ltr');
    expect(textDirection('東京都港区')).toBe('ltr');
    expect(textDirection('12 شارع الملك')).toBe('rtl');
    expect(textDirection('רחוב הרצל 1')).toBe('rtl');
  });
  it('the maps query and the shared text', () => {
    expect(mapsUrl({ name: 'A', addressEn: 'B 1' })).toBe('geo:0,0?q=A%2C%20B%201');
    expect(shareText(hotel({}))).toBe(
      'Amari Watergate\n847 ถนนเพชรบุรี กรุงเทพฯ\n847 Phetchaburi Road, Bangkok\n+66 26539000',
    );
  });
});
