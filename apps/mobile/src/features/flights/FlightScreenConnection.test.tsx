import '@/i18n';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { FlightScreen } from './FlightScreen';
import { lookupFlight, saveFlight, setSameBooking } from './flightsApi';
import type { Flight, FlightSnapshot } from './flightModel';

// The first test also loads the screen's modules: room for a busy CI.
jest.setTimeout(15_000);

jest.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ recheckConsent: jest.fn(async () => true) }),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => '20000000-0000-4000-8000-000000000002' }));
jest.mock('./flightsApi', () => ({
  lookupFlight: jest.fn(),
  saveFlight: jest.fn(async () => 'ok'),
  deleteFlight: jest.fn(async () => 'ok'),
  setSameBooking: jest.fn(async () => 'ok'),
}));
jest.mock('./airportsData', () => {
  const real = jest.requireActual('./airportsData');
  const rows = [
    ['TLV', 'ISR', 'IL', 'Asia/Jerusalem', 'תל אביב', 'Tel Aviv', 'Ben Gurion', 0, ''],
    ['ATH', 'GRC', 'GR', 'Europe/Athens', 'אתונה', 'Athens', 'Athens International Airport', 0, ''],
    ['BKK', 'THA', 'TH', 'Asia/Bangkok', 'בנגקוק', 'Bangkok', 'Suvarnabhumi Airport', 0, ''],
  ];
  return { ...real, loadAirports: jest.fn(async () => rows.map(real.airportOf)) };
});
// The trip already has the first leg, TLV→ATH, landing 20:00 UTC.
const mockFirst = {
  id: '20000000-0000-4000-8000-000000000001',
  tripId: 't1',
  direction: 'out',
  numberInput: 'LY541',
  number: 'LY541',
  depDateLocal: '2026-12-20',
  airline: null,
  depIata: 'TLV',
  depTz: 'Asia/Jerusalem',
  depCountry: 'IL',
  arrIata: 'ATH',
  arrTz: 'Europe/Athens',
  arrCountry: 'GR',
  depSched: '2026-12-20T17:00:00.000Z',
  arrSched: '2026-12-20T20:00:00.000Z',
  depTerminal: null,
  depGate: null,
  arrTerminal: null,
  arrGate: null,
  pnr: null,
  seat: null,
  cabin: null,
  watch: null,
  arrMct: 60,
} as Flight;
jest.mock('./flightsStore', () => ({
  useTripFlights: () => ({
    flights: [mockFirst],
    status: 'ready',
    fromCache: false,
    savedAt: null,
  }),
}));

const side = (iata: string, tz: string, utc: string) => ({
  iata,
  timeZone: tz,
  scheduledUtc: utc,
  revisedUtc: null,
  predictedUtc: null,
  runwayUtc: null,
  terminal: null,
  gate: null,
});
// ATH→BKK leaves 21:40 UTC: 1:40 after the landing.
const onward: FlightSnapshot = {
  number: 'TG945',
  airlineIata: 'TG',
  airlineName: 'Thai',
  status: 'Expected',
  departure: side('ATH', 'Europe/Athens', '2026-12-20T21:40:00.000Z'),
  arrival: side('BKK', 'Asia/Bangkok', '2026-12-21T10:15:00.000Z'),
};

const trip = {
  id: 't1',
  title: 'תאילנד',
  countryAdm0: 'THA',
  startDate: '2026-12-20',
  endDate: '2027-01-05',
};

const search = async (onSaved = jest.fn()) => {
  jest.mocked(lookupFlight).mockResolvedValue({ kind: 'found', legs: [onward] });
  await render(
    <FlightScreen
      trip={trip}
      flight={null}
      direction="return"
      colorScheme="light"
      reduceMotion
      insetsTop={0}
      insetsBottom={0}
      onClose={jest.fn()}
      onSaved={onSaved}
      onDeleted={jest.fn()}
    />,
  );
  await fireEvent.changeText(screen.getByTestId('flight-number'), 'TG945');
  await fireEvent.press(screen.getByTestId('flight-search'));
  await waitFor(() => expect(screen.getByTestId('flight-notice-found')).toBeOnTheScreen());
  return onSaved;
};

beforeEach(() => jest.clearAllMocks());

describe('the form and connections (sprint 7 design 6)', () => {
  it('a leg that continues one takes its direction, and says why', async () => {
    await search();
    expect(screen.getByTestId('flight-direction-auto')).toBeOnTheScreen();
    expect(screen.getByTestId('flight-dir-outbound').props.accessibilityState.checked).toBe(true);
  });

  it('the connection section: the wait, and the answer saved on the later leg', async () => {
    const onSaved = await search();
    const prevId = mockFirst.id;
    expect(screen.getByTestId('flight-connection')).toBeOnTheScreen();
    expect(screen.getByTestId(`flight-connection-${prevId}-wait`).props.accessibilityValue).toEqual(
      {
        text: 'ok',
      },
    );
    await fireEvent.press(screen.getByTestId(`flight-same-booking-${prevId}-no`));
    expect(screen.getByTestId(`flight-warning-separate-${prevId}`)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('flight-save'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(saveFlight).toHaveBeenCalled();
    expect(setSameBooking).toHaveBeenCalledWith(
      '20000000-0000-4000-8000-000000000002',
      prevId,
      false,
    );
    expect(onSaved.mock.calls[0]![4]).toBe(false);
  });

  it('no answer, no call; a failed answer still saves the flight and says so', async () => {
    const onSaved = await search();
    await fireEvent.press(screen.getByTestId('flight-save'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(setSameBooking).not.toHaveBeenCalled();
    await screen.unmount();

    jest.mocked(setSameBooking).mockResolvedValueOnce('offline');
    const again = await search();
    await fireEvent.press(screen.getByTestId(`flight-same-booking-${mockFirst.id}-yes`));
    await fireEvent.press(screen.getByTestId('flight-save'));
    await waitFor(() => expect(again).toHaveBeenCalled());
    expect(again.mock.calls[0]![4]).toBe(true);
  });

  it('a user pick of the direction stays', async () => {
    await search();
    await fireEvent.press(screen.getByTestId('flight-dir-internal'));
    expect(screen.queryByTestId('flight-direction-auto')).toBeNull();
    expect(screen.getByTestId('flight-dir-internal').props.accessibilityState.checked).toBe(true);
  });
});

describe('editing a leg of a connection (Raz review 2, 9)', () => {
  const second = {
    ...mockFirst,
    id: '20000000-0000-4000-8000-000000000003',
    direction: 'return',
    numberInput: 'TG945',
    number: 'TG945',
    depIata: 'ATH',
    depTz: 'Europe/Athens',
    depCountry: 'GR',
    arrIata: 'BKK',
    arrTz: 'Asia/Bangkok',
    arrCountry: 'TH',
    depSched: '2026-12-20T21:40:00.000Z',
    arrSched: '2026-12-21T10:15:00.000Z',
  } as Flight;
  const edit = (flight = second) =>
    render(
      <FlightScreen
        trip={trip}
        flight={flight}
        direction="return"
        colorScheme="light"
        reduceMotion
        insetsTop={0}
        insetsBottom={0}
        onClose={jest.fn()}
        onSaved={jest.fn()}
        onDeleted={jest.fn()}
      />,
    );

  it('editing never changes the saved direction by itself', async () => {
    await edit();
    expect(screen.queryByTestId('flight-direction-auto')).toBeNull();
    expect(screen.getByTestId('flight-dir-return').props.accessibilityState.checked).toBe(true);
  });

  it('an answer is a change: leaving asks first', async () => {
    const { Alert } = jest.requireActual('react-native');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    // Nothing else changed: closing goes straight away...
    await edit({ ...second, direction: 'out' });
    await fireEvent.press(screen.getByTestId('flight-screen-back'));
    expect(alert).not.toHaveBeenCalled();
    await screen.unmount();
    // ...an answer alone makes it ask.
    await edit({ ...second, direction: 'out' });
    await fireEvent.press(screen.getByTestId(`flight-same-booking-${mockFirst.id}-yes`));
    await fireEvent.press(screen.getByTestId('flight-screen-back'));
    expect(alert).toHaveBeenCalled();
    alert.mockRestore();
  });
});
