/**
 * Sprint 12 on the coupon: AC-13, the focus in a card that opens straight in
 * Trips mode (design 3); AC-12, its content in one fading wrapper (design 2.4);
 * and P-4, the fade at the list's bottom while more is below (polish-audit 4).
 */
import '@/i18n';

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet } from 'react-native';

import { hasMoreBelow } from '@/components/ScrollFade';
import { OuterScrollContext } from '@/features/globe/BoardingPassCard';
import { countryByAdm0 } from '@/features/globe/countryData';

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
  cache: null,
  fromCache: false,
};
jest.mock('./TripsProvider', () => ({ useTrips: () => mockTrips }));
jest.mock('@/features/flights/FlightsSection', () => ({ FlightsSection: () => null }));
jest.mock('@/features/kit/TripKitSections', () => ({ TripKitSections: () => null }));
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
jest.mock('./useTripList', () => ({
  useTripList: () => ({ state: mockList, reload: jest.fn(), loadMore: jest.fn() }),
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

const props = {
  country: countryByAdm0('GRC')!,
  colorScheme: 'light' as const,
  maxListHeight: 600,
  onNewTrip: jest.fn(),
  onEditTrip: jest.fn(),
  onDuplicateTrip: jest.fn(),
  onToast: jest.fn(),
  onTripsMode: jest.fn(),
};
const focuses = () =>
  jest.mocked(AccessibilityInfo.sendAccessibilityEvent).mock.calls.filter(([, e]) => e === 'focus');
/** Raz 2: where the focus went: the testID of the element the ref resolves to. */
const target = (n: number) =>
  (focuses()[n]?.[0] as unknown as { props?: { testID?: string } } | undefined)?.props?.testID;
const rowLaidOut = (id: string) =>
  fireEvent(screen.getByTestId(`card-trip-${id}`), 'layout', {
    nativeEvent: { layout: { x: 0, y: 40, width: 300, height: 64 } },
  });

beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => {});
  jest.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
  mockList.status = 'ready';
  mockList.upcoming = [trip({ id: 't1' }), trip({ id: 't2', title: 'יוון 2' })];
  mockList.past = [];
});
afterEach(() => jest.restoreAllMocks());

describe('AC-13: the focus in a card that opens in Trips mode', () => {
  it('goes to the open row once, after the card is in and the row measured', async () => {
    const { rerender } = await render(
      <CardTrips {...props} tripsMode initiallyOpen="t1" openSeq={1} entered={false} />,
    );
    await rowLaidOut('t1');
    expect(focuses()).toHaveLength(0);
    await rerender(<CardTrips {...props} tripsMode initiallyOpen="t1" openSeq={1} entered />);
    expect(focuses()).toHaveLength(1);
    expect(target(0)).toBe('card-trip-t1');
    await rerender(<CardTrips {...props} tripsMode initiallyOpen="t1" openSeq={1} entered />);
    expect(focuses()).toHaveLength(1);
  });

  it('waits for the row, in whichever order they come', async () => {
    await render(<CardTrips {...props} tripsMode initiallyOpen="t1" openSeq={1} entered />);
    expect(focuses()).toHaveLength(0);
    await rowLaidOut('t1');
    expect(focuses()).toHaveLength(1);
  });

  it('a request with a flight: the flight sheet keeps the focus (Raz 5)', async () => {
    const { rerender } = await render(
      <CardTrips {...props} tripsMode initiallyOpen="t1" openSeq={1} openFlight="f1:1" entered />,
    );
    // The flight shown: the request still came with one.
    await rerender(
      <CardTrips {...props} tripsMode initiallyOpen="t1" openSeq={1} openFlight={null} entered />,
    );
    await rowLaidOut('t1');
    expect(focuses()).toHaveLength(0);
  });

  it('a trip not in the list: "Your trips" takes it', async () => {
    await render(<CardTrips {...props} tripsMode initiallyOpen="gone" openSeq={1} entered />);
    expect(focuses()).toHaveLength(1);
    expect(target(0)).toBe('card-trips-heading');
  });

  it('still loading: nothing until the rows come', async () => {
    mockList.status = 'loading';
    mockList.upcoming = [];
    const { rerender } = await render(
      <CardTrips {...props} tripsMode initiallyOpen="t1" openSeq={1} entered />,
    );
    expect(focuses()).toHaveLength(0);
    mockList.status = 'ready';
    mockList.upcoming = [trip({ id: 't1' })];
    // Raz 2: the same request, now answered.
    await rerender(<CardTrips {...props} tripsMode initiallyOpen="t1" openSeq={1} entered />);
    await rowLaidOut('t1');
    expect(focuses()).toHaveLength(1);
    expect(target(0)).toBe('card-trip-t1');
  });

  it('a repeat tap on the pin of the open trip: once more, with no new layout (Raz 1)', async () => {
    const { rerender } = await render(
      <CardTrips {...props} tripsMode initiallyOpen="t1" openSeq={1} entered />,
    );
    await rowLaidOut('t1');
    expect(focuses()).toHaveLength(1);
    await rerender(<CardTrips {...props} tripsMode initiallyOpen="t1" openSeq={2} entered />);
    expect(focuses()).toHaveLength(2);
  });

  it('another trip asked for: waits for its head to be laid out again (Raz, re-review 1)', async () => {
    const { rerender } = await render(
      <CardTrips {...props} tripsMode initiallyOpen="t1" openSeq={1} entered />,
    );
    await rowLaidOut('t1');
    // t2 measured while closed.
    await rowLaidOut('t2');
    await rerender(<CardTrips {...props} tripsMode initiallyOpen="t2" openSeq={2} entered />);
    expect(focuses()).toHaveLength(1);
    await rowLaidOut('t2');
    expect(focuses()).toHaveLength(2);
    expect(target(1)).toBe('card-trip-t2');
  });

  it('a request left unanswered ends with Trips mode: no focus from a later layout (Raz 1)', async () => {
    const { rerender } = await render(
      <CardTrips {...props} tripsMode initiallyOpen="t1" openSeq={1} entered={false} />,
    );
    await rerender(
      <CardTrips {...props} tripsMode={false} initiallyOpen="t1" openSeq={1} entered />,
    );
    const before = focuses().length;
    await rerender(<CardTrips {...props} tripsMode initiallyOpen="t1" openSeq={1} entered />);
    await rowLaidOut('t1');
    // Only the existing 6.2 event of each switch, none from the old request.
    expect(focuses().length - before).toBe(1);
  });

  it('from the destination view into Trips mode: one event (design 3.4)', async () => {
    const { rerender } = await render(<CardTrips {...props} initiallyOpen={null} entered />);
    await rerender(<CardTrips {...props} tripsMode initiallyOpen={null} entered />);
    expect(focuses()).toHaveLength(1);
  });

  it('a new request while in Trips mode: once more', async () => {
    const { rerender } = await render(
      <CardTrips {...props} tripsMode initiallyOpen="t1" openSeq={1} entered />,
    );
    await rowLaidOut('t1');
    await rerender(<CardTrips {...props} tripsMode initiallyOpen="t2" openSeq={2} entered />);
    await rowLaidOut('t2');
    expect(focuses()).toHaveLength(2);
  });

  it('from the destination view: no focus on mount', async () => {
    await render(<CardTrips {...props} initiallyOpen={null} entered />);
    expect(focuses()).toHaveLength(0);
  });
});

describe('AC-12: one wrapper fades; "New trip" stays', () => {
  it('the content sits in the fading wrapper, "New trip" does not', async () => {
    const fade = { value: 0.25, get: () => 0.25, set: jest.fn() } as never;
    await render(<CardTrips {...props} tripsMode fade={fade} entered />);
    const content = screen.getByTestId('card-trips-content');
    expect(content.props.style).toEqual(expect.arrayContaining([{ opacity: 0.25 }]));
    let node = screen.getByTestId('card-new-trip').parent;
    while (node && node !== content.parent) {
      expect(node).not.toBe(content);
      node = node.parent;
    }
  });
});

describe('AC-12 in scroll mode', () => {
  it('"New trip" fades with the content, having no fixed place (4g)', async () => {
    const fade = { value: 0.25, get: () => 0.25, set: jest.fn() } as never;
    await render(
      <OuterScrollContext.Provider value={{ nearEnd: 0, scrollToRow: jest.fn() }}>
        <CardTrips {...props} tripsMode fade={fade} entered />
      </OuterScrollContext.Provider>,
    );
    const opacities: unknown[] = [];
    for (let n = screen.getByTestId('card-new-trip').parent; n; n = n.parent) {
      const style = StyleSheet.flatten(n.props.style) as { opacity?: number } | undefined;
      if (style?.opacity !== undefined) opacities.push(style.opacity);
    }
    expect(opacities).toContain(0.25);
  });

  it('scrolls to the row with both offsets, whichever layout comes first (Raz 4)', async () => {
    const scrollToRow = jest.fn();
    await render(
      <OuterScrollContext.Provider value={{ nearEnd: 0, scrollToRow }}>
        <CardTrips {...props} tripsMode initiallyOpen="t1" openSeq={1} entered />
      </OuterScrollContext.Provider>,
    );
    const at = (y: number) => ({ nativeEvent: { layout: { x: 0, y, width: 300, height: 300 } } });
    await rowLaidOut('t1');
    // The list's own wrapper first, then the fading wrapper around it.
    await fireEvent(screen.getByTestId('card-trips-list').parent!, 'layout', at(48));
    expect(scrollToRow).not.toHaveBeenCalled();
    await fireEvent(screen.getByTestId('card-trips-content'), 'layout', at(12));
    expect(scrollToRow).toHaveBeenCalledWith(12 + 48 + 40);
  });
});

describe('P-4: the fade at the bottom of the list', () => {
  it.each([
    [600, 0, 300, true],
    [600, 300, 300, false],
    [600, 299.5, 300, false],
    [200, 0, 300, false],
  ])('content %d, scrolled %d, viewport %d: more below %s', (content, y, viewport, more) => {
    expect(hasMoreBelow(content, y, viewport)).toBe(more);
  });

  it('shows while more is below, and goes at the end; it takes no touches', async () => {
    await render(<CardTrips {...props} tripsMode entered />);
    const list = screen.getByTestId('card-trips-list');
    const fade = () => screen.getByTestId('scroll-fade', { includeHiddenElements: true });
    expect(fade().props.pointerEvents).toBe('none');
    await act(async () => {
      fireEvent(list, 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 300 } },
      });
      fireEvent(list, 'contentSizeChange', 300, 900);
    });
    expect(fade().props.accessibilityValue).toEqual({ text: 'more' });
    await act(async () => {
      fireEvent.scroll(list, {
        nativeEvent: {
          contentOffset: { y: 600 },
          contentSize: { height: 900 },
          layoutMeasurement: { height: 300 },
        },
      });
    });
    expect(fade().props.accessibilityValue).toEqual({ text: 'end' });
  });

  it('updates offline too, where the list loads no more (Raz 12)', async () => {
    mockTrips.fromCache = true;
    await render(<CardTrips {...props} tripsMode entered />);
    const list = screen.getByTestId('card-trips-list');
    await act(async () => {
      fireEvent.scroll(list, {
        nativeEvent: {
          contentOffset: { y: 0 },
          contentSize: { height: 900 },
          layoutMeasurement: { height: 300 },
        },
      });
    });
    expect(
      screen.getByTestId('scroll-fade', { includeHiddenElements: true }).props.accessibilityValue,
    ).toEqual({ text: 'more' });
    mockTrips.fromCache = false;
  });
});
