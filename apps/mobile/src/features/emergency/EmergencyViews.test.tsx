import '@/i18n';

import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { Flight } from '@/features/flights/flightModel';

import { SosScreen } from './EmergencyViews';
import { GlobeSos } from './GlobeSos';

const metrics = {
  frame: { x: 0, y: 0, width: 411, height: 900 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};
const wrap = (node: React.ReactNode) => (
  <SafeAreaProvider initialMetrics={metrics}>{node}</SafeAreaProvider>
);

const tha = {
  id: 'tha',
  countryAdm0: 'THA',
  title: 'תאילנד',
  startDate: '2026-12-18',
  endDate: '2027-01-03',
};
const jpn = {
  id: 'jpn',
  countryAdm0: 'JPN',
  title: 'יפן',
  startDate: '2026-12-20',
  endDate: '2026-12-30',
};

const mockTrips = { cache: { upcoming: [tha, jpn] }, today: '2026-12-21', changes: 0 };
jest.mock('@/features/trips/TripsProvider', () => ({ useTrips: () => mockTrips }));
const mockFlights = new Map<string, Flight[]>();
jest.mock('@/features/flights/flightsStore', () => ({
  flightsForTrips: jest.fn(async () => mockFlights),
}));
jest.mock('@/features/kit/kitStore', () => ({ kitsOf: jest.fn(async () => new Map()) }));

const sos = (props: Partial<React.ComponentProps<typeof SosScreen>> = {}) =>
  render(
    wrap(
      <SosScreen
        adm0="THA"
        trip={tha}
        insuranceOf={() => null}
        signedIn
        colorScheme="light"
        insetsTop={0}
        insetsBottom={0}
        onClose={jest.fn()}
        {...props}
      />,
    ),
  );

describe('SosScreen (AC-12 to AC-14)', () => {
  it('Thailand: local numbers with their source, the Bangkok embassy, insurance, the backup', async () => {
    await sos();
    expect(screen.getByTestId('sos-screen').props.accessibilityValue).toEqual({ text: 'THA' });
    expect(screen.getByTestId('sos-local-police')).toBeTruthy();
    expect(screen.getByTestId('sos-local-source')).toBeTruthy();
    expect(screen.getByText(/שגרירות ישראל בבנגקוק/)).toBeTruthy();
    expect(screen.getByText('לא הוספתם ביטוח לנסיעה הזו.')).toBeTruthy();
    expect(screen.getByTestId('sos-mfa')).toBeTruthy();
  });

  it('a country with unchecked numbers: "in progress", the ministry first, never a number (AC-14)', async () => {
    await sos({ adm0: 'MAR', trip: { ...tha, id: 'm', countryAdm0: 'MAR' } });
    expect(screen.getByTestId('sos-local-pending')).toBeTruthy();
    expect(screen.queryByTestId('sos-local-police')).toBeNull();
    expect(screen.getByTestId('sos-mfa-top')).toBeTruthy();
  });

  it('no Israeli mission: says so, with the ministry in that group (AC-13)', async () => {
    await sos({ adm0: 'QAT', trip: { ...tha, id: 'q', countryAdm0: 'QAT' } });
    expect(screen.getByText('אין נציגות ישראלית במדינה.')).toBeTruthy();
    expect(screen.getByTestId('sos-mfa-mission')).toBeTruthy();
  });

  it('signed out: no insurance group at all (AC-17)', async () => {
    await sos({ trip: null, signedIn: false });
    expect(screen.queryByTestId('sos-insurance')).toBeNull();
  });

  it('dials the insurer from the policy', async () => {
    await sos({
      insuranceOf: () => ({
        tripId: 'tha',
        provider: 'הראל',
        policyNumber: null,
        validUntil: null,
        emergencyPhone: '+97239294000',
        notes: null,
      }),
    });
    expect(screen.getByTestId('sos-insurance-dial')).toBeTruthy();
  });
});

describe('the SOS button (AC-15, AC-16)', () => {
  beforeEach(() => mockFlights.clear());

  it('two active trips and a landed flight to Bangkok today: Thailand, on a cold start', async () => {
    mockFlights.set('tha', [
      {
        id: 'f',
        tripId: 'tha',
        depDateLocal: '2026-12-21',
        depSched: '2026-12-21T00:00:00Z',
        arrSched: '2026-12-21T01:00:00Z',
        watch: null,
      } as Flight,
    ]);
    jest.useFakeTimers({
      now: new Date('2026-12-21T12:00:00Z'),
      doNotFake: ['setTimeout', 'setImmediate', 'nextTick'],
    });
    await render(wrap(<GlobeSos visible colorScheme="light" />));
    expect((await screen.findByTestId('sos-button')).props.accessibilityValue).toEqual({
      text: 'THA',
    });
    jest.useRealTimers();
  });

  it('no flight today: the latest start, and the picker offers both', async () => {
    await render(wrap(<GlobeSos visible colorScheme="light" />));
    const button = await screen.findByTestId('sos-button');
    expect(button.props.accessibilityValue).toEqual({ text: 'JPN' });
    await fireEvent.press(button);
    expect(screen.getByTestId('sos-trip-jpn')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('sos-trip-tha'));
    expect(screen.getByTestId('sos-screen').props.accessibilityValue).toEqual({ text: 'THA' });
  });

  it('hidden with "My trips"', async () => {
    await render(wrap(<GlobeSos visible={false} colorScheme="light" />));
    expect(screen.queryByTestId('sos-button')).toBeNull();
  });
});
