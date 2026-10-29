import '@/i18n';

import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';

import { countryByAdm0 } from '@/features/globe/countryData';

import { OuterScrollContext } from '@/features/globe/BoardingPassCard';

import { CardTrips } from './CardTrips';
import type { Trip } from './tripsApi';

jest.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ state: { status: 'signedIn', user: { id: 'u1' } } }),
}));
const mockTrips = {
  countries: null,
  changes: 0,
  today: '2026-10-22',
  changed: jest.fn(),
  cache: null as null | { savedAt: string; full: boolean; upcoming: Trip[]; past: Trip[] },
  fromCache: false,
};
const onEditTrip = jest.fn();
jest.mock('./TripsProvider', () => ({ useTrips: () => mockTrips }));
// Flights have their own tests (src/features/flights); here the row only hosts them.
jest.mock('@/features/flights/FlightsSection', () => ({ FlightsSection: () => null }));
jest.mock('@/features/kit/TripKitSections', () => ({ TripKitSections: () => null }));
// Sprint 10: the passport banners have tests of their own (PassportBanners.test.tsx).
jest.mock('@/features/kit/PassportBanners', () => ({ PassportBanners: () => null }));
const mockList = {
  status: 'ready',
  upcoming: [] as Trip[],
  past: [] as Trip[],
  hasMore: false,
  loadingMore: false,
  moreError: false,
  showSkeleton: false,
  offlineStale: false,
};
const mockUseTripList = jest.fn((_options: { reloadKey: number | string }) => ({
  state: mockList,
  reload: jest.fn(),
  loadMore: jest.fn(),
}));
jest.mock('./useTripList', () => ({
  useTripList: (options: { reloadKey: number | string }) => mockUseTripList(options),
}));

const trip = (over: Partial<Trip>): Trip => ({
  id: 't1',
  countryAdm0: 'GRC',
  title: 'יוון',
  startDate: '2026-11-01',
  endDate: '2026-11-05',
  notes: null,
  travelers: [],
  cities: [],
  ...over,
});

const greece = countryByAdm0('GRC')!;
/** The first-strong isolates around each city name (built from code points). */
const ISOLATES = new RegExp(
  `[${String.fromCodePoint(0x2068)}${String.fromCodePoint(0x2069)}]`,
  'g',
);
const onDuplicateTrip = jest.fn();
/**
 * The card's Trips mode as GlobeScreen keeps it (fix my-trips-space 2.1): a
 * request to open a trip enters it, and the coupon can enter or leave it.
 */
function Host({ initiallyOpen, openSeq }: { initiallyOpen: string | null; openSeq: number }) {
  const [mode, setMode] = useState(initiallyOpen !== null);
  const [seen, setSeen] = useState(openSeq);
  if (seen !== openSeq) {
    setSeen(openSeq);
    if (initiallyOpen !== null) setMode(true);
  }
  return (
    <CardTrips
      country={greece}
      colorScheme="light"
      maxListHeight={600}
      initiallyOpen={initiallyOpen}
      openSeq={openSeq}
      onNewTrip={jest.fn()}
      onEditTrip={onEditTrip}
      onDuplicateTrip={onDuplicateTrip}
      onToast={jest.fn()}
      tripsMode={mode}
      onTripsMode={setMode}
    />
  );
}
const card = (initiallyOpen: string | null = null, openSeq = 0) => (
  <Host initiallyOpen={initiallyOpen} openSeq={openSeq} />
);

beforeEach(() => {
  mockTrips.cache = null;
  mockTrips.fromCache = false;
  onEditTrip.mockClear();
  mockList.upcoming = [];
  mockList.past = [];
  mockTrips.today = '2026-10-22';
  onDuplicateTrip.mockClear();
});

describe('CardTrips (sprint 3 AC-3, AC-5, AC-6, AC-9)', () => {
  it("shows each row's status, and the traveler count only from 2", async () => {
    mockList.upcoming = [
      trip({ id: 'solo', title: 'לבד', startDate: '2026-10-20', endDate: '2026-10-25' }),
      trip({ id: 'pair', title: 'זוג', travelers: [{ name: 'דנה', relation: 'partner' }] }),
    ];
    mockList.past = [
      trip({ id: 'old', title: 'ישנה', startDate: '2026-01-01', endDate: '2026-01-05' }),
    ];
    await render(card());
    // Hidden from the screen reader: the row's label says it (design 3.3).
    const hidden = { includeHiddenElements: true };
    expect(screen.getByText('בנסיעה עכשיו', hidden)).toBeOnTheScreen();
    expect(screen.getByText('מתוכננת', hidden)).toBeOnTheScreen();
    expect(screen.getByText('הסתיימה', hidden)).toBeOnTheScreen();
    expect(screen.getByText('2 נוסעים', hidden)).toBeOnTheScreen();
    expect(screen.queryByText('1 נוסעים', hidden)).toBeNull();
    expect(screen.queryByText('מתוכננת')).toBeNull();
  });

  it("puts the status and count in the row's label, not as separate stops", async () => {
    mockList.upcoming = [trip({ id: 'pair', travelers: [{ name: 'דנה', relation: null }] })];
    await render(card());
    const label = screen.getByTestId('card-trip-pair').props.accessibilityLabel as string;
    expect(label).toContain('מתוכננת');
    expect(label).toContain('2 נוסעים');
  });

  it('lists the cities in order, repeats included, when the row opens', async () => {
    mockList.upcoming = [
      trip({
        cities: [
          { geonameId: 264371, name: 'אתונה' },
          { geonameId: null, name: 'נקסוס' },
          { geonameId: 264371, name: 'אתונה' },
        ],
      }),
    ];
    await render(card());
    expect(screen.queryByText('ערים')).toBeNull();
    await fireEvent.press(screen.getByTestId('card-trip-t1'));
    const shown = screen.getByText(/נקסוס/).props.children as string;
    expect(shown.replace(ISOLATES, '')).toBe('אתונה · נקסוס · אתונה');
  });

  it('duplicates the open trip (AC-9)', async () => {
    const source = trip({});
    mockList.upcoming = [source];
    await render(card('t1'));
    await fireEvent.press(screen.getByTestId('card-trip-duplicate'));
    expect(onDuplicateTrip).toHaveBeenCalledWith(source);
  });

  it('opens the same trip again on a new request, after the user closed it (Raz, m1)', async () => {
    mockList.upcoming = [trip({})];
    const { rerender } = await render(card('t1', 1));
    expect(screen.getByTestId('card-trip-duplicate')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('card-trip-t1'));
    expect(screen.queryByTestId('card-trip-duplicate')).toBeNull();
    await rerender(card('t1', 2));
    expect(screen.getByTestId('card-trip-duplicate')).toBeOnTheScreen();
  });

  it('a collapse request closes the open row (after a save, design 8.9, Raz R1)', async () => {
    mockList.upcoming = [trip({})];
    const { rerender } = await render(card('t1', 1));
    expect(screen.getByTestId('card-trip-duplicate')).toBeOnTheScreen();
    await rerender(card(null, 2));
    expect(screen.queryByTestId('card-trip-duplicate')).toBeNull();
    // Fix my-trips-space 2.2: a collapse request leaves Trips mode as it is.
    expect(screen.getByTestId('card-trips-heading').props.accessibilityRole).toBe('header');
  });

  it('reads the list again when the day changes (design 3.4, Raz m2)', async () => {
    await render(card());
    const before = mockUseTripList.mock.lastCall![0].reloadKey;
    mockTrips.today = '2026-10-23';
    await render(card());
    expect(mockUseTripList.mock.lastCall![0].reloadKey).not.toBe(before);
  });

  it('offline with the saved copy: says so, and edits explain instead of opening (sprint 4 F-015)', async () => {
    mockTrips.fromCache = true;
    mockTrips.cache = { savedAt: new Date().toISOString(), full: false, upcoming: [], past: [] };
    mockList.upcoming = [trip({})];
    await render(card('t1'));
    expect(screen.getByTestId('card-trips-cached')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('card-trip-edit'));
    expect(onEditTrip).not.toHaveBeenCalled();
    expect(screen.getByTestId('card-trip-readonly')).toBeOnTheScreen();
    expect(screen.getByTestId('card-trip-edit').props.accessibilityState.disabled).toBe(true);
  });
});

describe('Trips mode (fix my-trips-space)', () => {
  const sticky = () => screen.getByTestId('card-trips-list').props.stickyHeaderIndices as number[];

  it('in the destination view a row never opens in place: a tap enters Trips mode with it open', async () => {
    mockList.upcoming = [trip({ id: 't1' }), trip({ id: 't2', title: 'שנייה' })];
    await render(card());
    const heading = screen.getByTestId('card-trips-heading');
    expect(heading.props.accessibilityRole).toBe('button');
    expect(screen.getByTestId('card-trip-t1').props.accessibilityHint).toBe(
      'פותח את הנסיעה בכל הכרטיס',
    );
    await fireEvent.press(screen.getByTestId('card-trip-t2'));
    expect(screen.getByTestId('card-trips-heading').props.accessibilityRole).toBe('header');
    expect(screen.getByTestId('card-trip-t2').props.accessibilityState).toMatchObject({
      expanded: true,
    });
    // Closing the open row keeps Trips mode (2.3).
    await fireEvent.press(screen.getByTestId('card-trip-t2'));
    expect(screen.queryByTestId('card-trip-duplicate')).toBeNull();
    expect(screen.getByTestId('card-trips-heading').props.accessibilityRole).toBe('header');
  });

  it('"Your trips": Trips mode, and the only trip opens with it', async () => {
    mockList.upcoming = [trip({ id: 't1' })];
    await render(card());
    await fireEvent.press(screen.getByTestId('card-trips-heading'));
    expect(screen.getByTestId('card-trip-duplicate')).toBeOnTheScreen();

    mockList.upcoming = [trip({ id: 't1' }), trip({ id: 't2' })];
    await render(card());
    await fireEvent.press(screen.getByTestId('card-trips-heading'));
    expect(screen.queryByTestId('card-trip-duplicate')).toBeNull();
    expect(screen.getByTestId('card-trips-heading').props.accessibilityRole).toBe('header');
  });

  it('the open head and the 0-height view after its trip are sticky, counted over every child (Raz b)', async () => {
    mockList.upcoming = [trip({ id: 'u1', startDate: '2026-11-01' })];
    mockList.past = [
      trip({ id: 'p1', startDate: '2026-01-01', endDate: '2026-01-05' }),
      trip({ id: 'p2', startDate: '2025-01-01', endDate: '2025-01-05' }),
    ];
    mockList.loadingMore = true;
    await render(card('p1', 1));
    // upcoming caption, u1, past caption, p1 head, p1 details, p1 end, p2, the footer.
    expect(sticky()).toEqual([3, 5]);
    mockList.loadingMore = false;
  });

  it('no sticky head in scroll mode, where the card scrolls (3.3)', async () => {
    mockList.upcoming = [trip({ id: 't1' })];
    await render(
      <OuterScrollContext.Provider value={{ nearEnd: 0, scrollToRow: jest.fn() }}>
        {card('t1', 1)}
      </OuterScrollContext.Provider>,
    );
    expect(screen.getByTestId('card-trip-duplicate')).toBeOnTheScreen();
    expect(sticky()).toEqual([]);
  });

  it('leaves Trips mode when the rows are gone, not while a requested trip is loading (2.3)', async () => {
    const onTripsMode = jest.fn();
    const coupon = (status: string) => {
      mockList.status = status;
      return (
        <CardTrips
          country={greece}
          colorScheme="light"
          maxListHeight={600}
          initiallyOpen="t1"
          openSeq={1}
          onNewTrip={jest.fn()}
          onEditTrip={jest.fn()}
          onDuplicateTrip={jest.fn()}
          onToast={jest.fn()}
          tripsMode
          onTripsMode={onTripsMode}
        />
      );
    };
    const { rerender } = await render(coupon('loading'));
    expect(onTripsMode).not.toHaveBeenCalled();
    // A trip asked for but not in the list: Trips mode, nothing open (2.2).
    mockList.upcoming = [trip({ id: 'other' })];
    await rerender(coupon('ready'));
    expect(onTripsMode).not.toHaveBeenCalled();
    expect(screen.queryByTestId('card-trip-duplicate')).toBeNull();
    // The last one deleted (here or elsewhere): back to the icons.
    mockList.upcoming = [];
    await rerender(coupon('ready'));
    expect(onTripsMode).toHaveBeenCalledWith(false);
    mockList.status = 'ready';
  });
});
