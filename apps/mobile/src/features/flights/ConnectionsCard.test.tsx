import '@/i18n';

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { Flight } from './flightModel';
import { FlightsSection } from './FlightsSection';
import type { TripFlights } from './flightsStore';

// The first render also loads the section's modules: room for a busy parallel run.
jest.setTimeout(15_000);

const mockState: { value: TripFlights } = {
  value: { flights: [], status: 'ready', fromCache: false, savedAt: null },
};
const mockRefresh = jest.fn(async () => {});
jest.mock('./flightsStore', () => ({
  useTripFlights: () => mockState.value,
  refreshTripFlights: () => mockRefresh(),
}));
const mockSetSameBooking = jest.fn(async () => 'ok');
jest.mock('./flightsApi', () => ({
  ...jest.requireActual('./flightsApi'),
  setSameBooking: (...a: unknown[]) => mockSetSameBooking(...(a as [])),
}));
jest.mock('./airportsData', () => ({
  ...jest.requireActual('./airportsData'),
  loadAirports: async () => [
    {
      iata: 'IST',
      adm0: 'TUR',
      country: 'Turkey',
      tz: 'Europe/Istanbul',
      cityHe: 'איסטנבול',
      cityEn: 'Istanbul',
      name: 'Istanbul',
      rank: 0,
      nameHe: '',
    },
    {
      iata: 'TLV',
      adm0: 'ISR',
      country: 'Israel',
      tz: 'Asia/Jerusalem',
      cityHe: 'תל אביב',
      cityEn: 'Tel Aviv',
      name: 'Ben Gurion',
      rank: 0,
      nameHe: '',
    },
  ],
}));
const mockAdvisories: { value: Map<string, unknown> } = { value: new Map() };
jest.mock('@/features/destination/destinationData', () => ({
  ...jest.requireActual('@/features/destination/destinationData'),
  useDestination: () => ({ data: { advisories: mockAdvisories.value }, failed: false }),
}));

const leg = (over: Partial<Flight>): Flight => ({
  id: 'a',
  tripId: 't1',
  direction: 'out',
  numberInput: 'LY81',
  number: 'LY81',
  depDateLocal: '2026-12-20',
  airline: null,
  depIata: 'TLV',
  depTz: 'Asia/Jerusalem',
  depCountry: 'IL',
  arrIata: 'IST',
  arrTz: 'Europe/Istanbul',
  arrCountry: 'TR',
  depSched: '2026-12-20T06:00:00.000Z',
  arrSched: '2026-12-20T08:00:00.000Z',
  depTerminal: null,
  depGate: null,
  arrTerminal: null,
  arrGate: null,
  pnr: null,
  seat: null,
  cabin: null,
  watch: null,
  arrMct: 60,
  ...over,
});
const first = leg({});
const second = leg({
  id: 'b',
  numberInput: 'TK68',
  number: 'TK68',
  depIata: 'IST',
  depTz: 'Europe/Istanbul',
  arrIata: 'BKK',
  arrTz: 'Asia/Bangkok',
  depSched: '2026-12-20T10:10:00.000Z',
  arrSched: '2026-12-20T20:00:00.000Z',
  arrMct: 60,
});

const hidden = { includeHiddenElements: true };
const trip = {
  id: 't1',
  title: 'תאילנד',
  countryAdm0: 'THA',
  startDate: '2026-12-19',
  endDate: '2027-01-05',
};
const show = (flights: Flight[], readOnly = false) => {
  mockState.value = { flights, status: 'ready', fromCache: false, savedAt: null };
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 400, height: 800 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <FlightsSection trip={trip} colorScheme="light" readOnly={readOnly} onToast={jest.fn()} />
    </SafeAreaProvider>,
  );
};

describe('connections in the card (sprint 7 design 2-4)', () => {
  beforeAll(async () => {
    await show([]);
    await screen.unmount();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    mockAdvisories.value = new Map();
  });

  it('two legs make a route with a layover row: 2:10 at IST, enough time', async () => {
    await show([first, second]);
    expect(screen.getByTestId('card-route-a-header')).toBeOnTheScreen();
    const row = screen.getByTestId('card-layover-b');
    expect(row.props.accessibilityValue).toEqual({ text: 'ok' });
    expect(screen.getByTestId('card-layover-b-chip-ok', hidden)).toBeOnTheScreen();
    expect(screen.queryByTestId('card-layover-b-mct', hidden)).toBeNull();
    expect(screen.getByTestId('card-layover-b-booking').props.accessibilityValue).toEqual({
      text: 'unknown',
    });
  });

  it('a tight one says its minimum; under it, at risk', async () => {
    await show([first, leg({ ...second, depSched: '2026-12-20T08:40:00.000Z' })]);
    expect(screen.getByTestId('card-layover-b').props.accessibilityValue).toEqual({
      text: 'risky',
    });
    expect(screen.getByTestId('card-layover-b-mct', hidden)).toBeOnTheScreen();
  });

  it('"change" → separate tickets: saved on the later leg, about the leg before (the E2E path)', async () => {
    await show([first, second]);
    await fireEvent.press(screen.getByTestId('card-layover-b-booking-change'));
    await fireEvent.press(screen.getByTestId('same-booking-no'));
    expect(mockSetSameBooking).toHaveBeenCalledWith('b', 'a', false);
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('separate tickets warn; an answer about another leg does not count', async () => {
    await show([first, { ...second, sameBooking: false, sameBookingPrev: 'a' }]);
    expect(screen.getByTestId('card-layover-b-separate')).toBeOnTheScreen();
    await screen.unmount();
    await show([first, { ...second, sameBooking: false, sameBookingPrev: 'zzz' }]);
    expect(screen.queryByTestId('card-layover-b-separate')).toBeNull();
  });

  it('a transit country with restricted entry warns, with its source (AC-5)', async () => {
    mockAdvisories.value = new Map([
      ['TUR', { adm0: 'TUR', entryStatus: 'restricted', entrySourceUrl: 'https://example.test' }],
    ]);
    await show([first, second]);
    await act(async () => {});
    expect(screen.getByTestId('card-layover-b-transit').props.accessibilityValue).toEqual({
      text: 'restricted',
    });
    expect(screen.getByTestId('card-layover-b-transit-source')).toBeOnTheScreen();
  });

  it('offline, "change" is blocked and says why', async () => {
    await show([first, second], true);
    await fireEvent.press(screen.getByTestId('card-layover-b-booking-change'));
    expect(screen.queryByTestId('same-booking-sheet')).toBeNull();
    expect(screen.getByTestId('card-flight-readonly')).toBeOnTheScreen();
  });
});
