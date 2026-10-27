import '@/i18n';

import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { FlightScreen } from './FlightScreen';
import { lookupFlight, saveFlight } from './flightsApi';
import type { FlightSnapshot } from './flightModel';

// The first test also loads the screen's modules: room for a busy CI (Raz 14).
jest.setTimeout(15_000);

jest.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ recheckConsent: jest.fn(async () => true) }),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => '20000000-0000-4000-8000-000000000001' }));
jest.mock('./flightsApi', () => ({
  lookupFlight: jest.fn(),
  saveFlight: jest.fn(async () => 'ok'),
  deleteFlight: jest.fn(async () => 'ok'),
}));
jest.mock('./airportsData', () => {
  const real = jest.requireActual('./airportsData');
  const rows = [
    [
      'TLV',
      'ISR',
      'IL',
      'Asia/Jerusalem',
      'תל אביב',
      'Tel Aviv',
      'Ben Gurion International Airport',
      0,
      'נתב"ג',
    ],
    ['BKK', 'THA', 'TH', 'Asia/Bangkok', 'בנגקוק', 'Bangkok', 'Suvarnabhumi Airport', 0, ''],
    ['ATH', 'GRC', 'GR', 'Europe/Athens', 'אתונה', 'Athens', 'Athens International Airport', 0, ''],
  ];
  return { ...real, loadAirports: jest.fn(async () => rows.map(real.airportOf)) };
});
/** The time picker answers 23:40; the date picker the date it opened with. */
jest.mock('@react-native-community/datetimepicker', () => ({
  DateTimePickerAndroid: {
    open: jest.fn(({ mode, value, onValueChange }) => {
      const d = new Date(value);
      if (mode === 'time') d.setHours(23, 40);
      onValueChange({ type: 'set' }, d);
    }),
  },
}));

const trip = {
  id: 't1',
  title: 'תאילנד דצמבר',
  countryAdm0: 'THA',
  startDate: '2026-12-20',
  endDate: '2027-01-05',
};
const side = (iata: string, tz: string, utc: string) => ({
  iata,
  timeZone: tz,
  scheduledUtc: utc,
  revisedUtc: null,
  predictedUtc: null,
  runwayUtc: null,
  terminal: iata === 'TLV' ? '3' : null,
  gate: null,
});
const leg = (from: string, to: string): FlightSnapshot => ({
  number: 'LY81',
  airlineIata: 'LY',
  airlineName: 'El Al',
  status: 'Expected',
  departure: side(
    from,
    from === 'TLV' ? 'Asia/Jerusalem' : 'Europe/Athens',
    '2026-12-20T21:40:00.000Z',
  ),
  arrival: side(to, to === 'BKK' ? 'Asia/Bangkok' : 'Europe/Athens', '2026-12-21T10:15:00.000Z'),
});

const show = (onSaved = jest.fn()) =>
  render(
    <FlightScreen
      trip={trip}
      flight={null}
      direction="out"
      colorScheme="light"
      reduceMotion
      insetsTop={0}
      insetsBottom={0}
      onClose={jest.fn()}
      onSaved={onSaved}
      onDeleted={jest.fn()}
    />,
  );

beforeEach(() => {
  jest.mocked(lookupFlight).mockReset();
  jest.mocked(saveFlight).mockClear();
});

describe('FlightScreen (sprint 5 F-016, design 2–8)', () => {
  it('a bad number never reaches the server', async () => {
    await show();
    await fireEvent.changeText(screen.getByTestId('flight-number'), 'hello');
    await fireEvent.press(screen.getByTestId('flight-search'));
    expect(screen.getByText(/קוד החברה ועוד 1–4 ספרות/)).toBeOnTheScreen();
    expect(lookupFlight).not.toHaveBeenCalled();
  });

  it('one leg fills the form; saving sends the normalised number and UTC times', async () => {
    jest.mocked(lookupFlight).mockResolvedValue({ kind: 'found', legs: [leg('TLV', 'BKK')] });
    const onSaved = jest.fn();
    await show(onSaved);
    await fireEvent.changeText(screen.getByTestId('flight-number'), 'ly 081');
    await fireEvent.press(screen.getByTestId('flight-search'));
    await waitFor(() => expect(screen.getByTestId('flight-notice-found')).toBeOnTheScreen());
    expect(lookupFlight).toHaveBeenCalledWith('LY81', '2026-12-20');
    await fireEvent.press(screen.getByTestId('flight-save'));
    await waitFor(() => expect(saveFlight).toHaveBeenCalled());
    const [, tripId, saved] = jest.mocked(saveFlight).mock.calls[0]!;
    expect(tripId).toBe('t1');
    expect(saved).toMatchObject({
      number: 'LY81',
      depIata: 'TLV',
      arrIata: 'BKK',
      depSched: '2026-12-20T21:40:00.000Z',
      airline: 'El Al',
      depTerminal: '3',
    });
    expect(onSaved).toHaveBeenCalledWith(
      '20000000-0000-4000-8000-000000000001',
      'LY81',
      'out',
      true,
      false,
    );
  });

  it('several legs: a list to choose from', async () => {
    jest
      .mocked(lookupFlight)
      .mockResolvedValue({ kind: 'found', legs: [leg('TLV', 'ATH'), leg('ATH', 'BKK')] });
    await show();
    await fireEvent.changeText(screen.getByTestId('flight-number'), 'LY81');
    await fireEvent.press(screen.getByTestId('flight-search'));
    await waitFor(() => expect(screen.getByTestId('flight-legs')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('flight-leg-1'));
    expect(screen.getByTestId('flight-notice-found')).toBeOnTheScreen();
  });

  it('not found, unavailable or the daily limit all land on the manual form', async () => {
    for (const [kind, id] of [
      ['notFound', 'flight-notice-not-found'],
      ['unavailable', 'flight-notice-unavailable'],
      ['rateLimited', 'flight-notice-rate-limited'],
    ] as const) {
      jest.mocked(lookupFlight).mockResolvedValue({ kind });
      await show();
      await fireEvent.changeText(screen.getByTestId('flight-number'), 'LY81');
      await fireEvent.press(screen.getByTestId('flight-search'));
      await waitFor(() => expect(screen.getByTestId(id)).toBeOnTheScreen());
      expect(screen.getByTestId('flight-origin')).toBeOnTheScreen();
      await screen.unmount();
    }
  });

  it('offline: search says so, manual entry still works', async () => {
    jest.mocked(lookupFlight).mockResolvedValue({ kind: 'offline' });
    await show();
    await fireEvent.changeText(screen.getByTestId('flight-number'), 'LY81');
    await fireEvent.press(screen.getByTestId('flight-search'));
    await waitFor(() =>
      expect(screen.getByTestId('flight-notice-search-offline')).toBeOnTheScreen(),
    );
    await fireEvent.press(screen.getByTestId('flight-manual'));
    expect(screen.getByTestId('flight-origin')).toBeOnTheScreen();
  });

  it('manual save needs the airports and a departure time', async () => {
    await show();
    await fireEvent.changeText(screen.getByTestId('flight-number'), 'LY81');
    await fireEvent.press(screen.getByTestId('flight-manual'));
    await fireEvent.press(screen.getByTestId('flight-save'));
    expect(screen.getByTestId('flight-origin-error')).toBeOnTheScreen();
    expect(saveFlight).not.toHaveBeenCalled();
    expect(DateTimePickerAndroid.open).not.toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'time' }),
    );
  });

  it('the booking code is hidden until the eye is tapped', async () => {
    await show();
    await fireEvent.changeText(screen.getByTestId('flight-number'), 'LY81');
    await fireEvent.press(screen.getByTestId('flight-manual'));
    expect(screen.getByTestId('flight-pnr').props.secureTextEntry).toBe(true);
    await fireEvent.press(screen.getByTestId('flight-pnr-toggle'));
    expect(screen.getByTestId('flight-pnr').props.secureTextEntry).toBe(false);
    // And hidden again (QA S5 #1).
    await fireEvent.press(screen.getByTestId('flight-pnr-toggle'));
    expect(screen.getByTestId('flight-pnr').props.secureTextEntry).toBe(true);
  });
});
