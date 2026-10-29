// Sprint 11 F-029 (design 3 – 7; AC-3 – AC-7; Raz 29.10): "What to see" on
// the screen — the city picker, the tabs, the list, saving and navigating.
import NetInfo from '@react-native-community/netinfo';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Linking, Platform } from 'react-native';

import i18n from '@/i18n';
import type { Trip } from '@/features/trips/tripsApi';

import { forgetPickedCities } from './pickedCities';
import { navigateUrl, PlacesScreen } from './PlacesScreen';
import type { Place } from './placesModel';

const t = i18n.t.bind(i18n);
const BANGKOK = 1609350;
const KRABI = 1607779;
const POINTS: Record<number, [number, number]> = {
  [BANGKOK]: [100.5018, 13.7563],
  [KRABI]: [98.9063, 8.0863],
};
jest.mock('@/features/trips/citiesData', () => ({
  cityAreas: async () =>
    new Map([
      [
        'THA',
        [
          [1609350, 'בנגקוק', 'Bangkok', '', 5000000],
          [1607779, 'קרבי', 'Krabi', '', 30000],
        ],
      ],
    ]),
  cityPoint: (id: number) =>
    ({ 1609350: [100.5018, 13.7563], 1607779: [98.9063, 8.0863] })[id] ?? null,
  cityIndex: async () => [],
}));

const place = (
  ref: string,
  popularity: number,
  at: [number, number],
  over: Partial<Place> = {},
): Place => ({
  ref,
  nameHe: null,
  nameEn: `Place ${ref}`,
  lat: at[1],
  lng: at[0],
  category: 'culture',
  popularity,
  ...over,
});
const palace = place('wd:Q1', 90, POINTS[BANGKOK]!, {
  nameHe: 'הארמון הגדול',
  nameEn: 'Grand Palace',
});
const beach = place('wd:Q2', 50, POINTS[KRABI]!, { category: 'nature' });
const chabad = place('cu:0f0e0d0c-0000-4000-8000-000000000001', 0, POINTS[BANGKOK]!, {
  nameHe: 'בית חב"ד',
  category: 'chabad',
  curated: {
    body: 'ארוחות שבת',
    sourceUrl: 'https://chabad.example',
    verifiedAt: '2026-10-12',
    wikidataQid: null,
  },
});

const mockPlaces = {
  state: {
    status: 'ready',
    places: [chabad, palace, beach],
    savedAt: '2026-10-29T08:00:00Z',
    fromDevice: false,
  } as unknown,
};
jest.mock('./placesData', () => ({
  usePlaces: () => mockPlaces.state,
  retryPlaces: jest.fn(async () => {}),
}));
const mockSaved = {
  places: [] as { ref: string; name: string; lat: number; lng: number; createdAt: string }[],
};
jest.mock('./savedPlaces', () => ({
  useSaved: (tripId: string | null) =>
    tripId ? { status: 'ready', places: mockSaved.places } : { status: 'loading' },
  savePlace: jest.fn(async () => 'ok'),
  unsavePlace: jest.fn(async () => 'ok'),
}));
const hotel = (
  id: string,
  name: string,
  point: [number, number] | null,
  checkIn = '2026-12-20',
) => ({
  id,
  tripId: 'trip-1',
  name,
  addressEn: 'Somewhere 1',
  addressLocal: null,
  phone: null,
  checkIn,
  checkOut: '2027-01-03',
  bookingRef: null,
  point,
});
const mockHotels = { list: [] as ReturnType<typeof hotel>[] };
jest.mock('@/features/kit/kitStore', () => ({
  useTripKit: () => ({
    hotels: mockHotels.list,
    insurance: null,
    status: 'ready',
    fromCache: false,
  }),
  refreshTripKit: jest.fn(async () => {}),
}));
jest.mock('@/features/kit/kitApi', () => ({ saveHotel: jest.fn(async () => 'ok') }));
const kitApi = jest.requireMock<Record<'saveHotel', jest.Mock>>('@/features/kit/kitApi');
const saved = jest.requireMock<Record<'savePlace' | 'unsavePlace', jest.Mock>>('./savedPlaces');
// D20 (Raz ח9): picking a city or the hotel tab never reaches the server.
const mockServer = { from: jest.fn(), rpc: jest.fn() };
jest.mock('@/lib/supabase', () => ({ supabase: mockServer }));
jest.mock('@/features/itinerary/itineraryStore', () => ({
  useBoard: () => ({ status: 'ready', items: [], fromCache: false, savedAt: '' }),
  saveItem: jest.fn(async () => 'ok'),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'new-item' }));
const board = jest.requireMock<Record<'saveItem', jest.Mock>>(
  '@/features/itinerary/itineraryStore',
);

const trip = (over: Partial<Trip> = {}): Trip => ({
  id: 'trip-1',
  countryAdm0: 'THA',
  title: 'תאילנד בדצמבר',
  startDate: '2026-12-20',
  endDate: '2027-01-03',
  notes: null,
  travelers: [],
  cities: [{ geonameId: KRABI, name: 'קרבי' }],
  ...over,
});

const show = async (over: Partial<React.ComponentProps<typeof PlacesScreen>> = {}) => {
  await render(
    <PlacesScreen
      adm0="THA"
      trip={null}
      signedIn={false}
      today="2026-10-29"
      colorScheme="light"
      reduceMotion
      insetsTop={0}
      insetsBottom={0}
      onClose={jest.fn()}
      {...over}
    />,
  );
  await act(async () => {});
};
/** QA B1: the toast is drawn inside the screen's Modal. */
const toasted = (text: string | RegExp) =>
  expect(screen.getByTestId('toast')).toHaveTextContent(text);
const checked = (testID: string) => screen.getByTestId(testID).props.accessibilityState?.checked;

let online = true;
beforeEach(() => {
  forgetPickedCities();
  online = true;
  mockHotels.list = [];
  mockSaved.places = [];
  mockPlaces.state = {
    status: 'ready',
    places: [chabad, palace, beach],
    savedAt: '2026-10-29T08:00:00Z',
    fromDevice: false,
  };
  jest.clearAllMocks();
  jest.mocked(NetInfo.addEventListener).mockImplementation((listener) => {
    (listener as (s: { isConnected: boolean }) => void)({ isConnected: online });
    return jest.fn();
  });
});

describe('without a trip (design 3.1, 3.7.1)', () => {
  it('the largest city is picked, "other" and "whole country" last; one tab, no save', async () => {
    await show();
    expect(checked(`places-city-${BANGKOK}`)).toBe(true);
    expect(screen.getByTestId('places-scope')).toHaveTextContent('עד 15 ק"מ ממרכז בנגקוק');
    expect(screen.queryByTestId('places-tab-saved')).toBeNull();
    expect(screen.queryByTestId(`place-save-${palace.ref}`)).toBeNull();
  });

  it('the city list: curated first, then by popularity; a place 15 km away is not in it', async () => {
    await show();
    expect(screen.getByTestId(`place-row-${chabad.ref}`)).toBeOnTheScreen();
    expect(screen.getByTestId(`place-row-${palace.ref}`)).toBeOnTheScreen();
    expect(screen.queryByTestId(`place-row-${beach.ref}`)).toBeNull();
    expect(screen.getByText(t('places.curated'))).toBeOnTheScreen();
  });

  it('"whole country": every place, no scope line', async () => {
    await show();
    await fireEvent.press(screen.getByTestId('places-city-country'));
    expect(screen.getByTestId(`place-row-${beach.ref}`)).toBeOnTheScreen();
    expect(screen.queryByTestId('places-scope')).toBeNull();
  });

  it('a category with nothing in the city says so, and "all" brings the list back', async () => {
    await show();
    await fireEvent.press(screen.getByTestId('places-cat-family'));
    expect(screen.getByTestId('places-empty').props.accessibilityValue).toEqual({
      text: 'category',
    });
    await fireEvent.press(screen.getByTestId('places-show-all'));
    expect(screen.getByTestId(`place-row-${palace.ref}`)).toBeOnTheScreen();
  });
});

describe('with a trip (design 3.1, 5.2; Raz 29.10)', () => {
  it("the trip's city is picked; the tabs and saving are there", async () => {
    await show({ trip: trip(), signedIn: true });
    expect(checked(`places-city-${KRABI}`)).toBe(true);
    expect(screen.getByTestId('places-tab-saved')).toBeOnTheScreen();
    expect(screen.getByTestId(`place-save-${beach.ref}`)).toBeOnTheScreen();
  });

  it('a city with no places nearby: says so, and "see the whole country" switches to it', async () => {
    mockPlaces.state = {
      status: 'ready',
      places: [palace],
      savedAt: '2026-10-29T08:00:00Z',
      fromDevice: false,
    };
    await show({ trip: trip(), signedIn: true });
    expect(screen.getByTestId('places-empty').props.accessibilityValue).toEqual({
      text: 'city-none',
    });
    await fireEvent.press(screen.getByTestId('places-see-country'));
    expect(checked('places-city-country')).toBe(true);
    expect(screen.getByTestId(`place-row-${palace.ref}`)).toBeOnTheScreen();
  });

  it('a typed city: kept in the picker, with its own empty state', async () => {
    await show({ trip: trip({ cities: [{ geonameId: null, name: 'קוסמוי' }] }), signedIn: true });
    expect(screen.getByText(`קוסמוי · ${t('places.cityTyped')}`)).toBeOnTheScreen();
    expect(screen.getByTestId('places-empty').props.accessibilityValue).toEqual({
      text: 'city-manual',
    });
  });

  it('a trip with no listed city: the largest, and the help line', async () => {
    await show({ trip: trip({ cities: [] }), signedIn: true });
    expect(checked(`places-city-${BANGKOK}`)).toBe(true);
    expect(screen.getByTestId('places-no-trip-city')).toBeOnTheScreen();
  });

  it('saving goes to the trip and says to which', async () => {
    await show({ trip: trip(), signedIn: true });
    await fireEvent.press(screen.getByTestId(`place-save-${beach.ref}`));
    expect(saved.savePlace).toHaveBeenCalledWith('trip-1', beach, 'he');
    toasted(t('places.savedTo', { trip: 'תאילנד בדצמבר' }));
  });

  it('a saved place is unsaved without asking', async () => {
    mockSaved.places = [{ ref: beach.ref, name: 'x', lat: 0, lng: 0, createdAt: '' }];
    await show({ trip: trip(), signedIn: true });
    expect(screen.getByTestId(`place-save-${beach.ref}`).props.accessibilityState.selected).toBe(
      true,
    );
    await fireEvent.press(screen.getByTestId(`place-save-${beach.ref}`));
    expect(saved.unsavePlace).toHaveBeenCalledWith('trip-1', beach.ref);
  });

  it('offline, saving is blocked with the read-only hint', async () => {
    online = false;
    await show({ trip: trip(), signedIn: true });
    await fireEvent.press(screen.getByTestId(`place-save-${beach.ref}`));
    expect(saved.savePlace).not.toHaveBeenCalled();
    toasted(t('offline.readOnlyHint'));
  });

  it('the saved tab lists every saved place of the trip', async () => {
    mockSaved.places = [
      { ref: 'wd:Q9', name: "שוק צ'טוצ'ק", lat: 13.8, lng: 100.55, createdAt: '' },
    ];
    await show({ trip: trip(), signedIn: true });
    await fireEvent.press(screen.getByTestId('places-tab-saved'));
    expect(screen.getByTestId('saved-row-wd:Q9')).toBeOnTheScreen();
    expect(screen.getByText(t('places.savedAllCities'))).toBeOnTheScreen();
  });
});

describe('states and navigating (design 5.4, 7)', () => {
  it('no copy and offline: says a connection is needed the first time', async () => {
    online = false;
    mockPlaces.state = { status: 'failed' };
    await show();
    expect(screen.getByText(t('places.offlineNoCopy'))).toBeOnTheScreen();
    expect(checked(`places-city-${BANGKOK}`)).toBe(true);
  });

  it('a place opens its sheet: Wikidata credited, a curated place with its source and date', async () => {
    await show();
    await fireEvent.press(screen.getByTestId(`place-row-${palace.ref}`));
    expect(screen.getByTestId('place-wikidata')).toBeOnTheScreen();
  });

  it('a Chabad or kosher place carries the fixed "check before you go" line (QA B5)', async () => {
    await show();
    await fireEvent.press(screen.getByTestId(`place-row-${chabad.ref}`));
    expect(screen.getByTestId('place-kosher-note')).toHaveTextContent(t('places.kosherNote'));
    await fireEvent.press(screen.getByTestId('place-sheet-close'));
    await fireEvent.press(screen.getByTestId(`place-row-${palace.ref}`));
    expect(screen.queryByTestId('place-kosher-note')).toBeNull();
  });

  it('navigating opens the maps app at the coordinates, built on the device', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await show();
    await fireEvent.press(screen.getByTestId(`place-navigate-${palace.ref}`));
    expect(open).toHaveBeenCalledWith(
      navigateUrl({ lat: palace.lat, lng: palace.lng, name: 'Grand Palace' }),
    );
    jest.replaceProperty(Platform, 'OS', 'android');
    expect(navigateUrl({ lat: 13.75, lng: 100.5, name: 'Grand Palace' })).toBe(
      'geo:13.75,100.5?q=13.75,100.5(Grand%20Palace)',
    );
    open.mockRestore();
  });
});

describe('no server calls for the picker, and "add to day" from saved (D20; AC-6, Raz ח4)', () => {
  it('picking another city and the hotel tab call nothing on the server', async () => {
    mockHotels.list = [hotel('h1', 'Krabi Inn', [98.91, 8.09])];
    await show({ trip: trip(), signedIn: true });
    await fireEvent.press(screen.getByTestId('places-city-country'));
    await fireEvent.press(screen.getByTestId(`places-city-${KRABI}`));
    await fireEvent.press(screen.getByTestId('places-tab-hotel'));
    expect(mockServer.from).not.toHaveBeenCalled();
    expect(mockServer.rpc).not.toHaveBeenCalled();
  });

  it('a saved place goes to the end of the day picked, with its name and no time', async () => {
    mockSaved.places = [{ ref: 'wd:Q9', name: 'שוק', lat: 13.8, lng: 100.55, createdAt: '' }];
    await show({ trip: trip(), signedIn: true });
    await fireEvent.press(screen.getByTestId('places-tab-saved'));
    await fireEvent.press(screen.getByTestId('saved-menu-wd:Q9'));
    await fireEvent.press(screen.getByTestId('add-to-day-2026-12-21'));
    expect(board.saveItem).toHaveBeenCalledWith('trip-1', 'new-item', {
      day: '2026-12-21',
      time: null,
      title: 'שוק',
      note: null,
      placeRef: 'wd:Q9',
      placeName: 'שוק',
      lat: 13.8,
      lng: 100.55,
    });
    toasted(t('places.addedToDay', { n: 2 }));
  });

  it('offline, "add to day" says view only and opens nothing', async () => {
    online = false;
    mockSaved.places = [{ ref: 'wd:Q9', name: 'שוק', lat: 13.8, lng: 100.55, createdAt: '' }];
    await show({ trip: trip(), signedIn: true });
    await fireEvent.press(screen.getByTestId('places-tab-saved'));
    await fireEvent.press(screen.getByTestId('saved-menu-wd:Q9'));
    expect(screen.queryByTestId('add-to-day')).toBeNull();
    toasted(t('offline.readOnlyHint'));
  });
});

describe('"near the hotel" (AC-5, design 3.4; QA B4)', () => {
  it('two hotels with a point: chips by check-in; one picked by hand is the one measured from', async () => {
    mockHotels.list = [
      hotel('h2', 'Krabi Inn', [98.91, 8.09], '2026-12-27'),
      hotel('h1', 'Amari', [100.5, 13.75], '2026-12-20'),
    ];
    await show({ trip: trip({ cities: [] }), signedIn: true, today: '2026-12-21' });
    await fireEvent.press(screen.getByTestId('places-city-country'));
    await fireEvent.press(screen.getByTestId('places-tab-hotel'));
    expect(screen.getByTestId('places-hotel-h1').props.accessibilityState?.checked).toBe(true);
    expect(screen.getByTestId(`place-row-${palace.ref}`)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('places-hotel-h2'));
    expect(screen.getByTestId('places-hotel-h2').props.accessibilityState?.checked).toBe(true);
    expect(screen.getByTestId(`place-row-${beach.ref}`)).toBeOnTheScreen();
    expect(screen.queryByTestId(`place-row-${palace.ref}`)).toBeNull();
  });

  it('no hotel with a point: "pick on map" saves the point at once and says so', async () => {
    mockHotels.list = [hotel('h1', 'Amari', null)];
    await show({ trip: trip(), signedIn: true });
    await fireEvent.press(screen.getByTestId('places-tab-hotel'));
    expect(screen.getByTestId('places-hotel-no-point')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('places-hotel-no-point-pick'));
    await fireEvent.changeText(screen.getByTestId('map-point-type'), '13.7465, 100.4927');
    await fireEvent(screen.getByTestId('map-point-type'), 'submitEditing');
    await fireEvent.press(screen.getByTestId('map-point-choose'));
    await act(async () => {});
    expect(kitApi.saveHotel).toHaveBeenCalledWith(
      'h1',
      'trip-1',
      expect.objectContaining({
        name: 'Amari',
        lat: 13.7465,
        lng: 100.4927,
        checkIn: '2026-12-20',
      }),
    );
    toasted(t('places.hotelPointSaved', { name: 'Amari' }));
  });
});
