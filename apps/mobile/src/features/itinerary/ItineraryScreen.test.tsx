// Sprint 11 F-030, F-031 (design 9 – 14, 20; AC-8 – AC-17): the board on
// screen — days and labels, adding and editing, the actions, planning, and
// read only offline.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import i18n from '@/i18n';
import type { Trip } from '@/features/trips/tripsApi';

import { activityErrors } from './ActivityScreen';
import type { Item } from './itineraryModel';
import { ItineraryScreen } from './ItineraryScreen';

const t = i18n.t.bind(i18n);
const BKK: [number, number] = [100.5, 13.75];

const mockBoard = {
  state: { status: 'ready', items: [] as Item[], fromCache: false, savedAt: '' } as unknown,
};
jest.mock('./itineraryStore', () => ({
  useBoard: () => mockBoard.state,
  saveItem: jest.fn(async () => 'ok'),
  moveItem: jest.fn(async () => 'ok'),
  deleteItem: jest.fn(async () => 'ok'),
  applyPlan: jest.fn(async () => ({ result: 'ok', inserted: 2, skipped: [] })),
}));
jest.mock('@/features/flights/flightsStore', () => ({
  useTripFlights: () => ({ flights: [] }),
}));
jest.mock('@/features/kit/kitStore', () => ({
  useTripKit: () => ({ hotels: [], insurance: null, status: 'ready', fromCache: false }),
}));
jest.mock('@/features/places/savedPlaces', () => ({
  useSaved: () => ({ status: 'ready', places: [] }),
}));
/** v0.14.1 (Dana 3): a failed download, when set. */
const mockPlacesState = { failed: false };
const mockRetryPlaces = jest.fn();
jest.mock('@/features/places/placesData', () => ({
  retryPlaces: (...a: unknown[]) => mockRetryPlaces(...a),
  usePlaces: () =>
    mockPlacesState.failed
      ? { status: 'failed' }
      : {
          status: 'ready',
          savedAt: '',
          fromDevice: false,
          places: [
            {
              ref: 'wd:Q1',
              nameHe: 'הארמון הגדול',
              nameEn: 'Grand Palace',
              lat: BKK[1],
              lng: BKK[0],
              category: 'culture',
              popularity: 90,
            },
            {
              ref: 'wd:Q2',
              nameHe: null,
              nameEn: 'Wat Pho',
              lat: BKK[1],
              lng: BKK[0],
              category: 'culture',
              popularity: 80,
            },
          ],
        },
}));
jest.mock('@/features/climate/climateData', () => ({
  useClimate: () => ({ status: 'failed' }),
}));
jest.mock('@/features/trips/citiesData', () => ({
  cityPoint: (id: number) => (id === 1609350 ? [100.5, 13.75] : null),
}));
const store =
  jest.requireMock<Record<'saveItem' | 'moveItem' | 'applyPlan', jest.Mock>>('./itineraryStore');

const trip: Trip = {
  id: 'trip-1',
  countryAdm0: 'THA',
  title: 'תאילנד בדצמבר',
  startDate: '2027-01-05',
  endDate: '2027-01-07',
  notes: null,
  travelers: [],
  cities: [{ geonameId: 1609350, name: 'בנגקוק' }],
};
const item = (id: string, day: string, sortOrder: number, over: Partial<Item> = {}): Item => ({
  id,
  tripId: 'trip-1',
  day,
  time: '09:30',
  title: id,
  note: null,
  placeRef: null,
  placeName: null,
  lat: null,
  lng: null,
  source: 'manual',
  sortOrder,
  ...over,
});

const show = async (today = '2027-01-06', shown: Trip = trip) => {
  await render(
    <ItineraryScreen
      trip={shown}
      today={today}
      colorScheme="light"
      reduceMotion
      insetsTop={0}
      insetsBottom={0}
      onClose={jest.fn()}
    />,
  );
  await act(async () => {});
};
/** QA B1: the toast is drawn inside the screen's Modal. */
const toasted = (text: string | RegExp) =>
  expect(screen.getByTestId('toast')).toHaveTextContent(text);

beforeEach(() => {
  jest.clearAllMocks();
  mockBoard.state = { status: 'ready', items: [], fromCache: false, savedAt: '' };
});

describe('the board (AC-8, design 9)', () => {
  it('a day per date; no flights: a notice and no labels; today marked', async () => {
    await show();
    expect(screen.getByTestId('day-2027-01-05')).toBeOnTheScreen();
    expect(screen.getByTestId('day-2027-01-07')).toBeOnTheScreen();
    expect(screen.getByTestId('itinerary-no-flights')).toBeOnTheScreen();
    expect(screen.getByText(t('itinerary.today'))).toBeOnTheScreen();
  });

  it('activities in order, the automatic ones marked (AC-17)', async () => {
    mockBoard.state = {
      status: 'ready',
      items: [item('b', '2027-01-06', 2048), item('a', '2027-01-06', 1024, { source: 'auto' })],
      fromCache: false,
      savedAt: '',
    };
    await show();
    expect(screen.getByTestId('activity-auto-a')).toBeOnTheScreen();
    expect(screen.queryByTestId('activity-auto-b')).toBeNull();
  });

  it('items outside the dates have their own section and a notice (AC-12)', async () => {
    mockBoard.state = {
      status: 'ready',
      items: [item('x', '2027-02-01', 1)],
      fromCache: false,
      savedAt: '',
    };
    await show();
    expect(screen.getByTestId('day-out')).toBeOnTheScreen();
    expect(screen.getByTestId('itinerary-out-notice')).toBeOnTheScreen();
  });
});

describe('adding, moving (AC-9, AC-10)', () => {
  it('"+ add" opens the form for that day; saving sends one call', async () => {
    await show();
    await fireEvent.press(screen.getByTestId('day-add-2027-01-06'));
    await fireEvent.changeText(screen.getByTestId('activity-title'), "שוק צ'טוצ'ק");
    await fireEvent.press(screen.getByTestId('activity-save'));
    await waitFor(() => expect(store.saveItem).toHaveBeenCalledTimes(1));
    expect(store.saveItem.mock.calls[0]![2]).toMatchObject({
      day: '2027-01-06',
      title: "שוק צ'טוצ'ק",
      time: null,
    });
    toasted(t('activity.saved', { title: "שוק צ'טוצ'ק", n: 2 }));
  });

  it('the menu moves an item down within its day, and to another day at its end', async () => {
    mockBoard.state = {
      status: 'ready',
      items: [item('a', '2027-01-06', 1), item('b', '2027-01-06', 2), item('c', '2027-01-07', 1)],
      fromCache: false,
      savedAt: '',
    };
    await show();
    await fireEvent.press(screen.getByTestId('activity-menu-a'));
    expect(screen.getByTestId('menu-up').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByTestId('menu-down'));
    await waitFor(() =>
      expect(store.moveItem).toHaveBeenCalledWith('trip-1', 'a', '2027-01-06', 1),
    );
    await fireEvent.press(screen.getByTestId('activity-menu-b'));
    await fireEvent.press(screen.getByTestId('menu-move'));
    expect(screen.getByTestId('menu-day-2027-01-06')).toHaveTextContent(
      t('itinerary.menu.current'),
      {
        exact: false,
      },
    );
    await fireEvent.press(screen.getByTestId('menu-day-2027-01-07'));
    await waitFor(() =>
      expect(store.moveItem).toHaveBeenCalledWith('trip-1', 'b', '2027-01-07', 1),
    );
  });
});

describe('planning automatically (AC-14 – AC-16)', () => {
  it('previews the days it fills, applies once, and summarises', async () => {
    mockBoard.state = {
      status: 'ready',
      items: [item('a', '2027-01-06', 1)],
      fromCache: false,
      savedAt: '',
    };
    await show('2026-12-01');
    await fireEvent.press(screen.getByTestId('planner-button'));
    // Day 6 is busy; days 5 and 7 can be filled from the two Bangkok places.
    expect(screen.getByTestId('planner-preview')).toHaveTextContent(
      `${t('planner.previewPlan', { count: 1 })} ${t('planner.previewKept', { count: 1 })}`,
    );
    await fireEvent.press(screen.getByTestId('planner-go'));
    await waitFor(() => expect(store.applyPlan).toHaveBeenCalledTimes(1));
    const sent = store.applyPlan.mock.calls[0]![1] as { day: string }[];
    expect(sent.every((i) => i.day !== '2027-01-06')).toBe(true);
    expect(screen.getByTestId('planner-result')).toBeOnTheScreen();
    toasted(/תכננו/);
  });
});

describe('planning a trip with no city or hotel (QA B7)', () => {
  it('says to add a city or a hotel, and offers no "plan 0 days"', async () => {
    await show('2026-12-01', { ...trip, cities: [] });
    await fireEvent.press(screen.getByTestId('planner-button'));
    expect(screen.getByTestId('planner-preview')).toHaveTextContent(t('planner.needCity'));
    // Raz 2: no button at all, so no "plan 0 days".
    expect(screen.queryByTestId('planner-go')).toBeNull();
    expect(screen.getByTestId('planner-sheet')).not.toHaveTextContent(
      t('planner.go', { count: 0 }),
    );
  });
});

describe('the places could not be downloaded (v0.14.1, Dana 3)', () => {
  afterEach(() => {
    mockPlacesState.failed = false;
  });
  it('says so with a retry, and no plan button', async () => {
    mockPlacesState.failed = true;
    await show('2026-12-01');
    await fireEvent.press(screen.getByTestId('planner-button'));
    expect(screen.getByTestId('planner-places-failed')).toBeOnTheScreen();
    expect(screen.queryByTestId('planner-go')).toBeNull();
    await fireEvent.press(screen.getByTestId('planner-places-retry'));
    expect(mockRetryPlaces).toHaveBeenCalledWith('THA');
  });
});

describe('offline (AC-13, design 20)', () => {
  it('from the device copy: read only, adding and planning blocked with the hint', async () => {
    mockBoard.state = {
      status: 'ready',
      items: [],
      fromCache: true,
      savedAt: '2027-01-06T08:00:00Z',
    };
    await show();
    expect(screen.getByTestId('itinerary-offline')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('day-add-2027-01-06'));
    await fireEvent.press(screen.getByTestId('planner-button'));
    toasted(t('offline.readOnlyHint'));
    expect(screen.queryByTestId('activity-screen')).toBeNull();
    expect(screen.queryByTestId('planner-sheet')).toBeNull();
  });
});

describe('the form rules (design 12.2)', () => {
  const trip3 = { startDate: '2027-01-05', endDate: '2027-01-07' };
  it.each([
    [{ title: '', day: '2027-01-05', note: '' }, { title: 'titleRequired' }],
    [{ title: 'x'.repeat(121), day: '2027-01-05', note: '' }, { title: 'titleMax' }],
    [{ title: 'x', day: '2027-01-09', note: '' }, { day: 'day' }],
    [{ title: 'x', day: '2027-01-05', note: 'y'.repeat(501) }, { note: 'noteMax' }],
    [{ title: 'x', day: '2027-01-05', note: '' }, {}],
  ])('%j → %j', (values, expected) => {
    expect(activityErrors(values, trip3)).toEqual(expected);
  });

  it('deleting asks first', async () => {
    mockBoard.state = {
      status: 'ready',
      items: [item('a', '2027-01-06', 1)],
      fromCache: false,
      savedAt: '',
    };
    const alert = jest.spyOn(Alert, 'alert');
    await show();
    await fireEvent.press(screen.getByTestId('activity-a'));
    await fireEvent.press(screen.getByTestId('activity-delete'));
    expect(alert).toHaveBeenCalledWith(
      t('activity.deleteTitle'),
      expect.any(String),
      expect.any(Array),
    );
    alert.mockRestore();
  });
});

describe('the menu (design 14.1; Raz ח6, ח7)', () => {
  const one = (fromCache: boolean) => ({
    status: 'ready',
    items: [item('a', '2027-01-06', 1, { lat: BKK[1], lng: BKK[0], placeName: 'ארמון' })],
    fromCache,
    savedAt: '2027-01-06T08:00:00Z',
  });

  it('"delete" asks with the same confirmation as the form, then deletes', async () => {
    mockBoard.state = one(false);
    const alert = jest.spyOn(Alert, 'alert');
    await show();
    await fireEvent.press(screen.getByTestId('activity-menu-a'));
    await fireEvent.press(screen.getByTestId('menu-delete'));
    expect(screen.queryByTestId('activity-screen')).toBeNull();
    expect(alert).toHaveBeenCalledWith(
      t('activity.deleteTitle'),
      t('activity.deleteBody', { title: 'a', n: 2 }),
      expect.any(Array),
    );
    const buttons = alert.mock.calls[0]![2] as { style?: string; onPress?: () => void }[];
    await act(async () => buttons.find((b) => b.style === 'destructive')!.onPress!());
    expect(
      jest.requireMock<Record<'deleteItem', jest.Mock>>('./itineraryStore').deleteItem,
    ).toHaveBeenCalledWith('trip-1', 'a');
    toasted(t('activity.deleted'));
    alert.mockRestore();
  });

  it('from the device copy only "navigate" works', async () => {
    mockBoard.state = one(true);
    await show();
    await fireEvent.press(screen.getByTestId('activity-menu-a'));
    for (const id of ['menu-edit', 'menu-up', 'menu-down', 'menu-move', 'menu-delete'])
      expect(screen.getByTestId(id).props.accessibilityState.disabled).toBe(true);
    expect(screen.getByTestId('menu-navigate').props.accessibilityState.disabled).toBe(false);
  });
});
