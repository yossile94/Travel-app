// Sprint 14 F-043 (AC-1 – AC-5): the hotel search in the form, end to end
// against a stubbed places client; and the 30-day point refresh.
import '@/i18n';

import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { HotelScreen } from './HotelScreen';
import { refreshHotelPointOnServer, saveHotel } from './kitApi';
import type { Hotel } from './kitModel';
import { resetPlaceSearchForTests } from './PlaceSearchField';
import { pickHotel, refreshHotelPoint, searchHotels } from './placesApi';
import { refreshExpiredPoints, resetPointRefreshForTests } from './pointRefresh';

jest.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ recheckConsent: jest.fn(async () => false) }),
}));
jest.mock('expo-keep-awake', () => ({ useKeepAwake: jest.fn() }));
let mockUuid = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: () => `0b4f9a3e-5c2d-4e8f-9a1b-${String(++mockUuid).padStart(12, '0')}`,
}));
jest.mock('./kitApi', () => ({
  saveHotel: jest.fn(async () => 'ok'),
  refreshHotelPointOnServer: jest.fn(async () => 'ok'),
}));
jest.mock('./placesApi', () => ({
  searchHotels: jest.fn(),
  pickHotel: jest.fn(),
  refreshHotelPoint: jest.fn(),
}));

const search = jest.mocked(searchHotels);
const pick = jest.mocked(pickHotel);
const refresh = jest.mocked(refreshHotelPoint);
const save = jest.mocked(saveHotel);
const writePoint = jest.mocked(refreshHotelPointOnServer);

const trip = {
  id: 't1',
  title: 'תאילנד',
  countryAdm0: 'THA',
  startDate: '2026-12-20',
  endDate: '2027-01-03',
};
const place = {
  placeId: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
  nameLocal: 'โรงแรมสยาม',
  addressLocal: '3/2 ถนนขาว กรุงเทพฯ',
  nameEn: 'Siam Hotel',
  addressEn: '3/2 Khao Rd, Bangkok',
  phone: '+66 2 206 6999',
  lat: 13.78,
  lng: 100.5,
  fetchedAt: '2026-11-08T08:00:00.000Z',
};

beforeEach(() => {
  jest.useFakeTimers();
  for (const m of [search, pick, refresh, save, writePoint]) m.mockClear();
  resetPlaceSearchForTests();
  resetPointRefreshForTests();
  search.mockResolvedValue({
    kind: 'ok',
    suggestions: [{ placeId: place.placeId, name: 'Siam Hotel', place: 'Bangkok, Thailand' }],
  });
  pick.mockResolvedValue({ kind: 'ok', place });
});
afterEach(() => jest.useRealTimers());

async function open(hotel: Hotel | null = null) {
  await render(
    <HotelScreen
      trip={trip}
      hotel={hotel}
      hotels={hotel ? [hotel] : []}
      colorScheme="light"
      insetsTop={0}
      insetsBottom={0}
      onClose={jest.fn()}
      onSaved={jest.fn()}
    />,
  );
}

async function type(text: string) {
  await fireEvent.changeText(screen.getByTestId('place-search-input'), text);
  await act(async () => jest.advanceTimersByTimeAsync(300));
}

it('searches after 3 letters and 300ms, in the trip country (AC-1)', async () => {
  await open();
  await type('si');
  expect(search).not.toHaveBeenCalled();
  await type('siam');
  expect(search).toHaveBeenCalledTimes(1);
  expect(search.mock.calls[0]![0]).toMatchObject({
    session: expect.stringMatching(/^0b4f9a3e-/),
    input: 'siam',
    regions: ['TH'],
    language: 'he',
  });
  expect(screen.getByTestId('place-row-0')).toBeOnTheScreen();
  expect(screen.getByTestId('google-attribution')).toBeOnTheScreen();
});

it('a pick fills the form in both languages, marks it, and saves the link (AC-2, AC-3)', async () => {
  await open();
  await type('siam');
  await act(async () => fireEvent.press(screen.getByTestId('place-row-0')));
  expect(pick).toHaveBeenCalledWith(
    expect.objectContaining({ placeId: place.placeId, localLanguage: 'th' }),
  );
  expect(screen.getByTestId('hotel-name').props.value).toBe('Siam Hotel');
  expect(screen.getByTestId('hotel-name-local').props.value).toBe('โรงแรมสยาม');
  expect(screen.getByTestId('hotel-phone').props.value).toBe('+6622066999');
  expect(screen.getByTestId('place-linked')).toBeOnTheScreen();
  expect(screen.getAllByText('מולא מ-Google. אפשר לערוך.').length).toBeGreaterThan(0);

  await fireEvent.changeText(screen.getByTestId('hotel-phone'), '+66 2 000 0000');
  await act(async () => fireEvent.press(screen.getByTestId('hotel-save')));
  expect(save).toHaveBeenCalledWith(
    expect.any(String),
    't1',
    expect.objectContaining({
      name: 'Siam Hotel',
      nameLocal: 'โรงแรมสยาม',
      lat: 13.78,
      lng: 100.5,
      placeId: place.placeId,
      placeFetchedAt: place.fetchedAt,
      placeEdited: ['phone'],
    }),
  );
});

it('no key on the server hides the search until restart; the form stays (AC-5)', async () => {
  search.mockResolvedValue({ kind: 'unavailable' });
  await open();
  await type('siam');
  expect(screen.queryByTestId('place-search')).toBeNull();
  expect(screen.getByTestId('hotel-name')).toBeOnTheScreen();
});

it('a quota or a failure says so, and the field stays (AC-5)', async () => {
  search.mockResolvedValue({ kind: 'quota' });
  await open();
  await type('siam');
  expect(screen.getByTestId('place-search-unavailable')).toBeOnTheScreen();
  expect(screen.getByTestId('place-search-input')).toBeOnTheScreen();
});

it('nothing found says so, with the attribution', async () => {
  search.mockResolvedValue({ kind: 'ok', suggestions: [] });
  await open();
  await type('zzzz');
  expect(screen.getByTestId('place-search-empty')).toBeOnTheScreen();
  expect(screen.getByTestId('google-attribution')).toBeOnTheScreen();
});

it('a hotel saved without Google offers the search; a manual save sends no link', async () => {
  const manual: Hotel = {
    id: 'h1',
    tripId: 't1',
    name: 'Riva',
    addressEn: '23 Phra Athit Rd',
    addressLocal: null,
    phone: null,
    checkIn: '2026-12-20',
    checkOut: '2026-12-24',
    bookingRef: null,
    point: null,
  };
  await open(manual);
  expect(screen.getByTestId('place-search')).toBeOnTheScreen();
  await act(async () => fireEvent.press(screen.getByTestId('hotel-save')));
  expect(save.mock.calls[0]![2]).toMatchObject({ placeId: null, placeEdited: [] });
});

describe('the point after 30 days (AC-3, ADR-021)', () => {
  const linked = {
    id: 'h1',
    tripId: 't1',
    name: 'Siam Hotel',
    nameLocal: 'โรงแรมสยาม',
    addressEn: '3/2 Khao Rd',
    addressLocal: null,
    phone: null,
    checkIn: '2026-12-20',
    checkOut: '2026-12-24',
    bookingRef: null,
    point: [100.5, 13.78] as [number, number],
    placeId: place.placeId,
    placeFetchedAt: '2026-10-01T00:00:00Z',
    placeEdited: ['phone'],
  };
  const now = new Date('2026-11-08T00:00:00Z');

  it('fetches the point again and writes only it (Raz app review 2)', async () => {
    refresh.mockResolvedValue({
      kind: 'ok',
      refreshed: {
        placeId: 'ChIJnewId1234',
        lat: 13.79,
        lng: 100.51,
        fetchedAt: now.toISOString(),
      },
    });
    expect(await refreshExpiredPoints([linked], now)).toBe(true);
    expect(writePoint).toHaveBeenCalledWith('h1', {
      placeId: 'ChIJnewId1234',
      lat: 13.79,
      lng: 100.51,
      fetchedAt: now.toISOString(),
    });
    expect(save).not.toHaveBeenCalled();
    // Once per launch.
    expect(await refreshExpiredPoints([linked], now)).toBe(false);
  });

  it('a point the daily job cleared is fetched again too (Raz app review 1)', async () => {
    refresh.mockResolvedValue({
      kind: 'ok',
      refreshed: { placeId: place.placeId, lat: 13.79, lng: 100.51, fetchedAt: now.toISOString() },
    });
    expect(await refreshExpiredPoints([{ ...linked, id: 'h2', point: null }], now)).toBe(true);
    expect(writePoint).toHaveBeenCalledTimes(1);
  });

  it('a place Google no longer knows drops the link and the point', async () => {
    refresh.mockResolvedValue({ kind: 'gone' });
    await refreshExpiredPoints([linked], now);
    expect(writePoint).toHaveBeenCalledWith('h1', null);
  });

  it('offline tries again on the next showing', async () => {
    refresh.mockResolvedValueOnce({ kind: 'offline' });
    await refreshExpiredPoints([linked], now);
    expect(writePoint).not.toHaveBeenCalled();
    refresh.mockResolvedValueOnce({ kind: 'failed' });
    await refreshExpiredPoints([linked], now);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});

it('the driver card shows the local name first, and Google Maps for a picked hotel (design 1.7)', async () => {
  const { DriverCard, shareText } =
    jest.requireActual<typeof import('./DriverCard')>('./DriverCard');
  const linked = {
    id: 'h1',
    tripId: 't1',
    name: 'Siam Hotel',
    nameLocal: 'โรงแรมสยาม',
    addressEn: '3/2 Khao Rd, Bangkok',
    addressLocal: '3/2 ถนนขาว กรุงเทพฯ',
    phone: null,
    checkIn: '2026-12-20',
    checkOut: '2026-12-24',
    bookingRef: null,
    placeId: place.placeId,
  };
  await render(
    <DriverCard
      hotel={linked}
      insetsTop={0}
      insetsBottom={0}
      onClose={jest.fn()}
      onOpenUrl={jest.fn()}
    />,
  );
  expect(screen.getByTestId('driver-card-local-name')).toHaveTextContent('โรงแรมสยาม');
  expect(screen.getByTestId('google-attribution')).toBeOnTheScreen();
  expect(shareText(linked).split('\n').slice(0, 2)).toEqual(['Siam Hotel', 'โรงแรมสยาม']);
});

describe('the search field (Raz app review 9)', () => {
  it('one session from the first search to a clear, a new one after it, used by the pick', async () => {
    await open();
    await type('siam');
    const first = search.mock.calls[0]![0].session;
    await type('siam h');
    expect(search.mock.calls[1]![0].session).toBe(first);
    await act(async () => fireEvent.press(screen.getByTestId('place-search-clear')));
    await type('amari');
    const second = search.mock.calls[2]![0].session;
    expect(second).not.toBe(first);
    await act(async () => fireEvent.press(screen.getByTestId('place-row-0')));
    expect(pick.mock.calls[0]![0].session).toBe(second);
  });

  it('only the latest answer counts', async () => {
    const answers: ((v: Awaited<ReturnType<typeof searchHotels>>) => void)[] = [];
    search.mockImplementation(() => new Promise((r) => answers.push(r)));
    await open();
    await type('siam');
    await type('amari');
    await act(async () =>
      answers[1]!({
        kind: 'ok',
        suggestions: [{ placeId: 'ChIJamari123456', name: 'Amari', place: 'Bangkok' }],
      }),
    );
    await act(async () =>
      answers[0]!({
        kind: 'ok',
        suggestions: [{ placeId: 'ChIJsiam12345678', name: 'Siam', place: 'Bangkok' }],
      }),
    );
    expect(screen.getByText(/Amari/)).toBeOnTheScreen();
    expect(screen.queryByText(/Siam$/)).toBeNull();
  });

  it('offline: the search hides; a linked hotel keeps its row with Change off (AC-5)', async () => {
    const NetInfo = jest.requireMock<{ addEventListener: jest.Mock }>(
      '@react-native-community/netinfo',
    );
    NetInfo.addEventListener.mockImplementation((l: (n: { isConnected: boolean }) => void) => {
      l({ isConnected: false });
      return jest.fn();
    });
    try {
      await open();
      expect(screen.queryByTestId('place-search')).toBeNull();
      expect(screen.getByTestId('hotel-name')).toBeOnTheScreen();
      await open({
        id: 'h1',
        tripId: 't1',
        name: 'Siam Hotel',
        addressEn: 'x',
        addressLocal: null,
        phone: null,
        checkIn: '2026-12-20',
        checkOut: '2026-12-24',
        bookingRef: null,
        placeId: place.placeId,
        placeFetchedAt: place.fetchedAt,
        placeEdited: [],
      });
      expect(screen.getByTestId('place-linked')).toBeOnTheScreen();
      expect(screen.getByTestId('place-replace')).toBeDisabled();
    } finally {
      NetInfo.addEventListener.mockImplementation(() => jest.fn());
    }
  });
});
