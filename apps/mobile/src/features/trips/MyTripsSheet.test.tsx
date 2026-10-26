import '@/i18n';

import { render, screen } from '@testing-library/react-native';

import { MyTripsSheet } from './MyTripsSheet';
import type { Trip } from './tripsApi';

const mockTrips = { countries: null, changes: 0, today: '2026-10-22', changed: jest.fn() };
jest.mock('./TripsProvider', () => ({ useTrips: () => mockTrips }));
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

describe('MyTripsSheet (sprint 3 AC-3, QA M-1)', () => {
  it('shows the traveler count from 2, also in the row label', async () => {
    mockList.upcoming = [
      trip({ id: 'pair', title: 'זוג', travelers: [{ name: 'דנה', relation: 'partner' }] }),
      trip({ id: 'solo', title: 'לבד' }),
    ];
    await render(
      <MyTripsSheet
        visible
        colorScheme="light"
        reduceMotion
        insetsTop={0}
        insetsBottom={0}
        onClose={jest.fn()}
        onOpenTrip={jest.fn()}
      />,
    );
    // Shown, but read through the row's label (design 3.3).
    expect(screen.getAllByText('2 נוסעים', { includeHiddenElements: true })).toHaveLength(1);
    const label = screen.getByTestId('my-trip-pair').props.accessibilityLabel as string;
    expect(label).toContain('2 נוסעים');
  });
});
