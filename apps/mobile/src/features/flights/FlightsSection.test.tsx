import '@/i18n';

import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { Flight } from './flightModel';
import { FlightsSection, updatedText } from './FlightsSection';
import type { TripFlights } from './flightsStore';

const mockState: { value: TripFlights } = {
  value: { flights: [], status: 'ready', fromCache: false, savedAt: null },
};
jest.mock('./flightsStore', () => ({
  useTripFlights: () => mockState.value,
  refreshTripFlights: jest.fn(async () => {}),
}));
jest.mock('./FlightScreen', () => ({
  FlightScreen: ({ onSaved }: { onSaved: (...a: unknown[]) => void }) => {
    const { Pressable, Text } = jest.requireActual('react-native');
    return (
      <Pressable testID="mock-save" onPress={() => onSaved('new', 'LY81', 'out', true)}>
        <Text>screen</Text>
      </Pressable>
    );
  },
}));

const now = Date.now();
const iso = (minutes: number) => new Date(now + minutes * 60_000).toISOString();
const flight = (over: Partial<Flight> = {}): Flight => ({
  id: 'f1',
  tripId: 't1',
  direction: 'out',
  numberInput: 'LY81',
  number: 'LY81',
  depDateLocal: iso(300).slice(0, 10),
  airline: 'אל על',
  depIata: 'TLV',
  depTz: 'Asia/Jerusalem',
  depCountry: 'IL',
  arrIata: 'BKK',
  arrTz: 'Asia/Bangkok',
  arrCountry: 'TH',
  depSched: iso(300),
  arrSched: iso(900),
  depTerminal: '3',
  depGate: null,
  arrTerminal: null,
  arrGate: null,
  pnr: 'ABC123',
  seat: '34A',
  cabin: 'economy',
  watch: {
    state: 'active',
    checkedAt: iso(-4),
    landedAt: null,
    events: [],
    snapshot: {
      number: 'LY81',
      airlineIata: 'LY',
      status: 'Delayed',
      departure: {
        iata: 'TLV',
        timeZone: 'Asia/Jerusalem',
        scheduledUtc: iso(300),
        revisedUtc: iso(390),
        predictedUtc: null,
        runwayUtc: null,
        terminal: '3',
        gate: 'B6',
      },
      arrival: {
        iata: 'BKK',
        timeZone: 'Asia/Bangkok',
        scheduledUtc: iso(900),
        revisedUtc: null,
        predictedUtc: null,
        runwayUtc: null,
        terminal: null,
        gate: null,
      },
    },
  },
  ...over,
});

// The row is one accessible element; its parts are hidden from screen readers.
const hidden = { includeHiddenElements: true };
const trip = {
  id: 't1',
  title: 'תאילנד',
  countryAdm0: 'THA',
  startDate: '2026-12-20',
  endDate: '2027-01-05',
};
const show = (readOnly = false) =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 400, height: 800 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <FlightsSection trip={trip} colorScheme="light" readOnly={readOnly} onToast={jest.fn()} />
    </SafeAreaProvider>,
  );

describe('FlightsSection (sprint 5 design 9–12)', () => {
  it('an empty trip: add, the help line, no credit', async () => {
    mockState.value = { flights: [], status: 'ready', fromCache: false, savedAt: null };
    await show();
    expect(screen.getByTestId('card-flight-add')).toBeOnTheScreen();
    expect(screen.getByTestId('card-flights-empty-help')).toBeOnTheScreen();
    expect(screen.queryByTestId('card-flights-credit')).toBeNull();
  });

  it('a tracked flight: delayed tag, the estimate in red with the schedule struck, gate, credit', async () => {
    mockState.value = { flights: [flight()], status: 'ready', fromCache: false, savedAt: null };
    await show();
    expect(screen.getByTestId('card-flight-f1-chip-delayed', hidden)).toBeOnTheScreen();
    expect(screen.getByTestId('card-flight-f1-dep-scheduled', hidden)).toBeOnTheScreen();
    expect(screen.queryByTestId('card-flight-f1-dep-israel', hidden)).toBeNull();
    expect(screen.getByTestId('card-flight-f1-arr-israel', hidden)).toBeOnTheScreen();
    expect(screen.getByTestId('card-flight-f1-gate-line', hidden)).toHaveTextContent(/B6/);
    expect(screen.getByTestId('card-flight-f1-tracking', hidden)).toHaveTextContent(
      "עודכן לפני 4 דק'",
    );
    expect(screen.getByTestId('card-flights-credit')).toBeOnTheScreen();
    // The booking code never shows on the card (design 7.2).
    expect(screen.getByTestId('card-flight-f1').props.accessibilityLabel).not.toContain('ABC123');
  });

  it('the sheet hides the booking code until "show"', async () => {
    mockState.value = { flights: [flight()], status: 'ready', fromCache: false, savedAt: null };
    await show();
    await fireEvent.press(screen.getByTestId('card-flight-f1'));
    expect(screen.getByTestId('flight-sheet-pnr')).toHaveTextContent('••••••');
    await fireEvent.press(screen.getByTestId('flight-sheet-pnr-toggle'));
    expect(screen.getByTestId('flight-sheet-pnr')).toHaveTextContent(/ABC123/);
  });

  it('offline: adding explains instead of opening', async () => {
    mockState.value = { flights: [flight()], status: 'ready', fromCache: true, savedAt: iso(-60) };
    await show(true);
    await fireEvent.press(screen.getByTestId('card-flight-add'));
    expect(screen.getByTestId('card-flight-readonly')).toBeOnTheScreen();
    expect(screen.queryByTestId('mock-save')).toBeNull();
  });

  it('after adding an outbound flight with no return yet: the return prompt', async () => {
    mockState.value = { flights: [], status: 'ready', fromCache: false, savedAt: null };
    await show();
    await fireEvent.press(screen.getByTestId('card-flight-add'));
    await fireEvent.press(screen.getByTestId('mock-save'));
    expect(screen.getByTestId('return-prompt-add')).toBeOnTheScreen();
  });

  it('"updated X ago" wording (design 9.5)', () => {
    const t = (k: string, o?: Record<string, unknown>) => `${k}${o?.n ?? ''}`;
    const at = new Date('2026-12-20T12:00:00Z');
    expect(updatedText('2026-12-20T11:59:30Z', at, t)).toBe('flight.updated.now');
    expect(updatedText('2026-12-20T11:55:00Z', at, t)).toBe('flight.updated.minMany5');
    expect(updatedText('2026-12-20T10:00:00Z', at, t)).toBe('flight.updated.hourTwo');
  });
});
