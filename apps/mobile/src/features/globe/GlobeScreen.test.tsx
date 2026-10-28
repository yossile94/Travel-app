/**
 * Screen-level behaviour of the home globe with Mapbox replaced by a stand-in
 * that records camera moves and answers hit-test queries. Rendering and
 * gestures themselves are checked on the device (Maestro).
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, BackHandler } from 'react-native';
import { withTiming } from 'react-native-reanimated';

import '@/i18n';
import { motion } from '@/theme/tokens';

import { HOME_ZOOM } from './camera';
import { GlobeScreen } from './GlobeScreen';
import { LAYER } from './GlobeLayers';

type Hits = {
  wide?: string;
  tight?: string;
  /** Under the coarse borders' hit layer. */
  country?: { adm0: string; code: string | null };
  /** Under the detailed borders' hit layer, when it answers differently. */
  detailed?: { adm0: string; code: string | null };
  /** Under the next-trip pin's hit layer (sprint 3). */
  pin?: { adm0: string; tripId: string };
};

const mockMap = {
  hits: {} as Hits,
  center: [34.8, 22] as [number, number],
  setCamera: jest.fn(),
  loads: true,
  /** The gestureSettings the map was last rendered with. */
  gestures: undefined as object | undefined,
  /** Mapbox goes idle once the visible tiles are drawn (the globe-ready point). */
  /** How many more times Mapbox will go idle (each mount effect uses one). */
  idles: Infinity,
  /** min/max zoom each fill layer was rendered with, by layer id. */
  fills: {} as Record<string, { minZoomLevel?: number; maxZoomLevel?: number }>,
  /** Last style and filter each circle layer was rendered with, by layer id. */
  circles: {} as Record<string, { style: Record<string, unknown>; filter?: unknown }>,
  /** The filter each line layer was rendered with, by layer id. */
  lines: {} as Record<string, unknown>,
};
let mockReduceMotion: boolean | null = false;
/** Every value the screen passed to useDetailedCountriesAsset. */
const mockDetailedRequests: boolean[] = [];

jest.mock('@rnmapbox/maps', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');

  // Answers per layer, in the order the layers were asked for, like Mapbox.
  const featuresFor = (layers: string[]) => {
    const { hits } = mockMap;
    const answer = (layer: string) =>
      layer === 'next-trip-hit'
        ? (hits.pin ?? null)
        : layer === 'small-countries-hit-wide' && hits.wide
          ? { adm0: hits.wide }
          : layer === 'small-countries-hit-tight' && hits.tight
            ? { adm0: hits.tight }
            : layer === 'countries-detailed-hit'
              ? (hits.detailed ?? null)
              : layer === 'countries-coarse-hit'
                ? (hits.country ?? null)
                : null;
    const props = layers.map(answer).find(Boolean) ?? null;
    return { type: 'FeatureCollection', features: props ? [{ properties: props }] : [] };
  };

  const MapView = React.forwardRef(function MapView(
    props: {
      onDidFinishLoadingMap?: () => void;
      onMapIdle?: () => void;
      gestureSettings?: object;
      children?: React.ReactNode;
    },
    ref,
  ) {
    React.useImperativeHandle(ref, () => ({
      queryRenderedFeaturesAtPoint: async (_point: unknown, _filter: unknown, layers: string[]) =>
        featuresFor(layers),
      getCenter: async () => mockMap.center,
    }));
    const { onDidFinishLoadingMap, onMapIdle } = props;
    React.useEffect(() => {
      if (!mockMap.loads) return;
      onDidFinishLoadingMap?.();
      if (mockMap.idles-- > 0) onMapIdle?.();
    }, [onDidFinishLoadingMap, onMapIdle]);
    mockMap.gestures = props.gestureSettings;
    return React.createElement(View, { testID: 'map' }, props.children);
  });
  const Camera = React.forwardRef(function Camera(_props, ref) {
    React.useImperativeHandle(ref, () => ({ setCamera: mockMap.setCamera }));
    return null;
  });
  const Nothing = () => null;
  const Children = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);

  return {
    __esModule: true,
    default: { setAccessToken: jest.fn() },
    MapView,
    Camera,
    Atmosphere: Nothing,
    BackgroundLayer: Nothing,
    RasterSource: Children,
    RasterLayer: Nothing,
    ShapeSource: Children,
    // Sprint 3: the next-trip pin (its own tests cover it).
    SymbolLayer: Nothing,
    Images: Nothing,
    FillLayer: ({
      id,
      minZoomLevel,
      maxZoomLevel,
    }: Record<string, never> & {
      id: string;
      minZoomLevel?: number;
      maxZoomLevel?: number;
    }) => {
      mockMap.fills[id] = { minZoomLevel, maxZoomLevel };
      return null;
    },
    LineLayer: ({ id, filter }: { id: string; filter?: unknown }) => {
      mockMap.lines[id] = filter;
      return null;
    },
    CircleLayer: ({
      id,
      style,
      filter,
    }: {
      id: string;
      style: Record<string, unknown>;
      filter?: unknown;
    }) => {
      mockMap.circles[id] = { style, filter };
      return null;
    },
  };
});
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
const mockStatusBar = { style: null as string | null };
jest.mock('expo-status-bar', () => ({
  StatusBar: ({ style }: { style: string }) => {
    mockStatusBar.style = style;
    return null;
  },
}));
jest.mock('./mapbox', () => ({ hasMapboxToken: true, turnOffMapboxTelemetryOnce: jest.fn() }));
jest.mock('./useCountriesAsset', () => ({
  useCountriesAsset: () => ({ url: 'file:///countries.geojson', error: null }),
  useOceanMaskAsset: () => ({ url: 'file:///ocean-mask.geojson', error: null }),
  useDetailedCountriesAsset: (enabled: boolean) => (
    mockDetailedRequests.push(enabled),
    {
      url: enabled ? 'file:///countries-detailed.geojson' : null,
      error: null,
    }
  ),
}));
jest.mock('./useReduceMotion', () => ({ useReduceMotion: () => mockReduceMotion }));

// Sprint 9: discovery runs on the real bundled files, read once for this file.
jest.mock('@/features/discover/discoverData', () => {
  const actual = jest.requireActual<typeof import('@/features/discover/discoverData')>(
    '@/features/discover/discoverData',
  );
  const { parseClimate } = jest.requireActual<typeof import('@/features/climate/climateData')>(
    '@/features/climate/climateData',
  );
  const { readFileSync } = jest.requireActual<{
    readFileSync(mockFile: string, mockEncoding: 'utf8'): string;
  }>('fs');
  let base: ReturnType<typeof actual.buildBase> | null = null;
  const load = () => {
    // Jest runs from apps/mobile.
    const dir = `${process.cwd()}/assets/data`;
    const areas = JSON.parse(readFileSync(`${dir}/cities.dat`, 'utf8')).areas;
    return actual.buildBase(
      parseClimate(readFileSync(`${dir}/climate.dat`, 'utf8')),
      new Map(Object.entries(areas)),
    );
  };
  return {
    ...actual,
    useDiscoverData: (mockEnabled: boolean) =>
      mockEnabled
        ? { status: 'ready', base: (base ??= load()), retry: () => {} }
        : { status: 'idle', retry: () => {} },
  };
});
/** Sprint 9: a fixed advisories copy for "family"; null keeps the real store. */
let mockDestination: null | Record<string, unknown> = null;
jest.mock('@/features/destination/destinationData', () => {
  const actual = jest.requireActual<typeof import('@/features/destination/destinationData')>(
    '@/features/destination/destinationData',
  );
  return {
    ...actual,
    useDestination: (mockLoad?: boolean) =>
      mockDestination ? { data: mockDestination, failed: false } : actual.useDestination(mockLoad),
  };
});

/** Sign-in state as the screen sees it; the provider itself is tested on its own. */
const mockAuth = {
  state: { status: 'unavailable' } as Record<string, unknown>,
  notice: null as null | { kind: string; name?: string },
  signInWithGoogle: jest.fn(async () => 'cancelled'),
  abandonSignIn: jest.fn(),
  submitConsent: jest.fn(async () => 'done'),
  signOut: jest.fn(async () => {}),
  clearNotice: jest.fn(),
  acknowledgeExpiry: jest.fn(),
  recheckConsent: jest.fn(async () => false),
};
jest.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => mockAuth,
  useAuthIfAny: () => mockAuth,
}));

// Sprint 2: the screen reads the trips context; these tests are about the globe.
const mockTrips = {
  countries: null as ReadonlySet<string> | null,
  changes: 0,
  changed: jest.fn(),
  firstLoad: false,
  start: jest.fn(),
  nextTrip: null as null | Record<string, unknown>,
  today: '2026-10-22',
};
jest.mock('@/features/trips/TripsProvider', () => ({ useTrips: () => mockTrips }));

const BANGKOK_TAP: Hits = { country: { adm0: 'THA', code: 'TH' } };

// The first test of a cold run also pays for transforming the screen and its
// data; 5 s was once not enough on this machine (sprint 1 review, finding 12d).
jest.setTimeout(15_000);

/** A real tap: finger down and up on the same spot, quickly (AC-10: recognised on lift). */
async function tap(hits: Hits) {
  mockMap.hits = hits;
  const surface = screen.getByTestId('globe-touch-surface');
  const at = { pageX: 100, pageY: 200 };
  await fireEvent(surface, 'touchStart', { nativeEvent: { touches: [at], ...at } });
  await act(async () => {
    await fireEvent(surface, 'touchEnd', { nativeEvent: { touches: [], ...at } });
  });
  // Let the flight effect read the camera centre and issue its move.
  await act(async () => {
    await Promise.resolve();
  });
}

interface CameraMove {
  animationMode?: string;
  animationDuration?: number;
  centerCoordinate?: number[];
  zoomLevel?: number;
  padding?: Record<string, number>;
}

function cameraMoves(): CameraMove[] {
  return mockMap.setCamera.mock.calls.map(([move]) => move as CameraMove);
}

function lastMoveWhere(match: (move: CameraMove) => boolean): CameraMove {
  const move = cameraMoves().filter(match).at(-1);
  if (!move) throw new Error('no matching camera move');
  return move;
}

beforeEach(() => {
  jest.useFakeTimers({ now: new Date(Date.UTC(2026, 9, 22, 17, 53)) });
  mockMap.setCamera.mockClear();
  mockMap.hits = {};
  mockMap.loads = true;
  mockMap.idles = Infinity;
  mockMap.fills = {};
  mockMap.lines = {};
  mockReduceMotion = false;
  mockAuth.state = { status: 'unavailable' };
  mockAuth.notice = null;
  mockTrips.firstLoad = false;
  mockTrips.nextTrip = null;
  mockDestination = null;
});
afterEach(() => jest.useRealTimers());

describe('GlobeScreen', () => {
  it('flies to a tapped country and opens its card (AC-4)', async () => {
    await render(<GlobeScreen />);
    await tap(BANGKOK_TAP);

    expect(screen.getByText('תאילנד')).toBeOnTheScreen();
    const move = lastMoveWhere((m) => m.animationMode === 'flyTo');
    expect(move).toBeDefined();
    expect(move.animationDuration).toBeGreaterThanOrEqual(1200);
    expect(move.animationDuration).toBeLessThanOrEqual(1800);
    expect(move.centerCoordinate).toEqual([101.0732, 15.4597]);
    expect(move.padding?.paddingBottom).toBeGreaterThan(0);
  });

  it('closes the card on the sea and returns to the whole globe', async () => {
    await render(<GlobeScreen />);
    await tap(BANGKOK_TAP);
    await tap({});

    expect(screen.queryByTestId('country-card')).toBeNull();
    const move = lastMoveWhere((m) => m.zoomLevel === HOME_ZOOM);
    expect(move).toBeDefined();
    expect(move.padding).toEqual({
      paddingTop: 0,
      paddingBottom: 0,
      paddingLeft: 0,
      paddingRight: 0,
    });
  });

  it('does nothing on land that is not a destination (Gaza Strip)', async () => {
    await render(<GlobeScreen />);
    await tap({ country: { adm0: 'GAZ', code: null } });
    expect(screen.queryByTestId('country-card')).toBeNull();
    expect(cameraMoves().some((m) => m.animationMode === 'flyTo')).toBe(false);
  });

  it('selects Italy, not the Vatican, for a tap in Rome (AC-5)', async () => {
    await render(<GlobeScreen />);
    await tap({ wide: 'VAT', country: { adm0: 'ITA', code: 'IT' } });
    expect(screen.getByText('איטליה')).toBeOnTheScreen();
  });

  it('selects a small island from its dot over the sea (AC-5)', async () => {
    await render(<GlobeScreen />);
    await tap({ wide: 'MDV' });
    expect(screen.getByText('האיים המלדיביים')).toBeOnTheScreen();
  });

  it('closes the card on Android back (AC-4)', async () => {
    const handlers: (() => boolean)[] = [];
    const spy = jest
      .spyOn(BackHandler, 'addEventListener')
      .mockImplementation((_event, handler) => {
        handlers.push(handler as () => boolean);
        return { remove: () => handlers.splice(handlers.indexOf(handler as () => boolean), 1) };
      });
    await render(<GlobeScreen />);
    await tap(BANGKOK_TAP);

    let consumed = false;
    await act(async () => {
      consumed = handlers.at(-1)!();
    });
    expect(consumed).toBe(true);
    expect(screen.queryByTestId('country-card')).toBeNull();
    spy.mockRestore();
  });

  it('cuts instead of flying when the device asks for reduced motion (AC-6)', async () => {
    mockReduceMotion = true;
    await render(<GlobeScreen />);
    await tap(BANGKOK_TAP);
    await act(async () => jest.advanceTimersByTime(200));

    const moves = mockMap.setCamera.mock.calls.map(([move]) => move);
    expect(moves.some((m) => m.animationMode === 'flyTo')).toBe(false);
    expect(moves.some((m) => m.animationMode === 'none' && m.zoomLevel)).toBe(true);
  });

  it('fades the veil even though the system reduces motion (AC-6)', async () => {
    mockReduceMotion = true;
    jest.mocked(withTiming).mockClear();
    await render(<GlobeScreen />);
    await tap(BANGKOK_TAP);
    await act(async () => jest.advanceTimersByTime(500));

    // The veil's fades, not the card's own entrance.
    const fades = jest
      .mocked(withTiming)
      .mock.calls.filter(([, config]) =>
        [motion.reduceFadeOut, motion.reduceFadeIn].some((ms) => ms === config?.duration),
      );
    expect(fades.map(([target]) => target)).toEqual([1, 0]);
    for (const [, config] of fades) expect(config?.reduceMotion).toBe('never');
  });

  it('rings a selected small island and removes the ring when its card closes (AC-7)', async () => {
    await render(<GlobeScreen />);
    expect(mockMap.circles['small-countries-dot']).toBeUndefined();
    const ring = () => mockMap.circles['small-countries-ring']!;

    await tap({ wide: 'MDV' });
    await act(async () => jest.advanceTimersByTime(1_000));
    expect(JSON.stringify(ring().filter)).toContain('"MDV"');
    expect(ring().style.circleStrokeOpacity).toBe(1);

    await tap({});
    await act(async () => jest.advanceTimersByTime(1_000));
    expect(ring().style.circleStrokeOpacity).toBe(0);
  });

  it('does not auto-rotate while a card is open (AC-2)', async () => {
    await render(<GlobeScreen />);
    await tap(BANGKOK_TAP);
    mockMap.setCamera.mockClear();
    await act(async () => jest.advanceTimersByTime(30_000));
    const rotations = mockMap.setCamera.mock.calls.filter(([m]) => m.animationMode === 'linearTo');
    expect(rotations).toHaveLength(0);
  });

  it('resumes rotation 5 s after a drag ends, even with no fling (AC-2)', async () => {
    await render(<GlobeScreen />);
    const surface = screen.getByTestId('globe-touch-surface');
    await act(async () => jest.advanceTimersByTime(1));
    mockMap.setCamera.mockClear();

    await fireEvent(surface, 'touchStart', { nativeEvent: { touches: [{}] } });
    await act(async () => jest.advanceTimersByTime(10_000)); // finger held still
    expect(cameraMoves().some((m) => m.animationMode === 'linearTo')).toBe(false);

    await fireEvent(surface, 'touchEnd', { nativeEvent: { touches: [] } });
    await act(async () => jest.advanceTimersByTime(4_000));
    expect(cameraMoves().some((m) => m.animationMode === 'linearTo')).toBe(false);
    await act(async () => {
      jest.advanceTimersByTime(1_100);
      await Promise.resolve();
    });
    await act(async () => jest.advanceTimersByTime(10));
    expect(cameraMoves().some((m) => m.animationMode === 'linearTo')).toBe(true);
  });

  it('does not start rotating before the reduce-motion setting is known (AC-6)', async () => {
    mockReduceMotion = null;
    await render(<GlobeScreen />);
    await act(async () => {
      jest.advanceTimersByTime(8_000);
      await Promise.resolve();
    });
    expect(cameraMoves().some((m) => m.animationMode === 'linearTo')).toBe(false);
  });

  it('does not rotate before Mapbox has loaded the map (it would jump to 0°,0°)', async () => {
    mockMap.loads = false;
    await render(<GlobeScreen />);
    await act(async () => {
      jest.advanceTimersByTime(8_000);
      await Promise.resolve();
    });
    expect(cameraMoves().some((m) => m.animationMode === 'linearTo')).toBe(false);
  });

  describe('search (sprint 1 F-002)', () => {
    async function search(text: string) {
      await fireEvent.press(screen.getByTestId('search-open'));
      await fireEvent.changeText(screen.getByTestId('search-input'), text);
    }
    /** The field folds back into the button over motion.medium (design 2.4). */
    async function finishClosing() {
      await act(async () => jest.advanceTimersByTime(300));
    }

    it('flies to a chosen result and opens its card, like a tap (AC-3)', async () => {
      await render(<GlobeScreen />);
      await search('תאי');
      expect(screen.getByTestId('search-result-THA')).toBeOnTheScreen();

      await fireEvent.press(screen.getByTestId('search-result-THA'));
      await act(async () => {
        await Promise.resolve();
      });

      await finishClosing();
      expect(screen.queryByTestId('search-input')).toBeNull();
      expect(screen.getByTestId('search-open')).toBeOnTheScreen();
      expect(screen.getByText('תאילנד')).toBeOnTheScreen();
      expect(lastMoveWhere((m) => m.animationMode === 'flyTo').centerCoordinate).toEqual([
        101.0732, 15.4597,
      ]);
    });

    it('picks the first result from the keyboard search key (design 2.3)', async () => {
      await render(<GlobeScreen />);
      await search('ותיק');
      await fireEvent(screen.getByTestId('search-input'), 'submitEditing');
      expect(screen.getByText('קריית הוותיקן')).toBeOnTheScreen();
    });

    it('keeps the keyboard up when the search key has nothing to pick (design 2.3)', async () => {
      await render(<GlobeScreen />);
      await search('ותיק');
      expect(screen.getByTestId('search-input').props.submitBehavior).toBe('blurAndSubmit');
      await fireEvent.changeText(screen.getByTestId('search-input'), 'qqqq');
      expect(screen.getByTestId('search-input').props.submitBehavior).toBe('submit');
      await fireEvent(screen.getByTestId('search-input'), 'submitEditing');
      expect(screen.getByTestId('search-input')).toBeOnTheScreen();
    });

    it('replaces the country being flown to when a result is chosen mid-flight (AC-3)', async () => {
      await render(<GlobeScreen />);
      await tap(BANGKOK_TAP);
      await search('יפן');
      await fireEvent.press(screen.getByTestId('search-result-JPN'));
      await act(async () => {
        await Promise.resolve();
      });
      await finishClosing();

      expect(screen.getByText('יפן')).toBeOnTheScreen();
      expect(screen.queryByText('תאילנד')).toBeNull();
      const flight = lastMoveWhere((m) => m.animationMode === 'flyTo');
      expect(flight.centerCoordinate).not.toEqual([101.0732, 15.4597]);
    });

    it('shows no list for an empty field, and says when nothing matches (AC-4)', async () => {
      await render(<GlobeScreen />);
      await search('');
      expect(screen.queryByTestId('search-empty')).toBeNull();
      expect(screen.queryByText('תאילנד')).toBeNull();

      await fireEvent.changeText(screen.getByTestId('search-input'), 'עזה');
      expect(screen.getByTestId('search-empty')).toBeOnTheScreen();
    });

    it('closes on Android back before the card does (AC-4, design 5.5)', async () => {
      const handlers: (() => boolean)[] = [];
      const spy = jest
        .spyOn(BackHandler, 'addEventListener')
        .mockImplementation((_event, handler) => {
          handlers.push(handler as () => boolean);
          return { remove: () => handlers.splice(handlers.indexOf(handler as () => boolean), 1) };
        });
      await render(<GlobeScreen />);
      await tap(BANGKOK_TAP);
      await search('יפ');

      // The card steps aside while searching (design 2.2): no touches, not read out.
      const hiddenCard = screen.getByTestId('country-card', { includeHiddenElements: true });
      expect(hiddenCard.props.pointerEvents).toBe('none');
      expect(hiddenCard.props.accessibilityElementsHidden).toBe(true);
      expect(screen.queryByTestId('country-card')).toBeNull();
      expect(handlers).toHaveLength(1);
      await act(async () => {
        handlers.at(-1)!();
      });
      await finishClosing();
      expect(screen.queryByTestId('search-input')).toBeNull();
      // Closed without choosing: the card comes back, and back is the card's again.
      expect(screen.getByTestId('country-card').props.pointerEvents).toBe('auto');
      expect(handlers).toHaveLength(1);
      await act(async () => {
        handlers.at(-1)!();
      });
      expect(screen.queryByTestId('country-card')).toBeNull();
      spy.mockRestore();
    });

    it('does not rotate while search is open (AC-4)', async () => {
      await render(<GlobeScreen />);
      await fireEvent.press(screen.getByTestId('search-open'));
      mockMap.setCamera.mockClear();
      await act(async () => {
        jest.advanceTimersByTime(30_000);
        await Promise.resolve();
      });
      expect(cameraMoves().some((m) => m.animationMode === 'linearTo')).toBe(false);
    });

    it('tells the screen reader how many countries were found, once typing pauses (AC-6)', async () => {
      await render(<GlobeScreen />);
      await search('קוריאה');
      expect(screen.queryByText('נמצאו 2 מדינות')).toBeNull();
      await act(async () => jest.advanceTimersByTime(600));
      expect(screen.getByText('נמצאו 2 מדינות')).toBeOnTheScreen();
    });

    it('never announces the previous count at the start of a new search (AC-6)', async () => {
      await render(<GlobeScreen />);
      await search('ותיק');
      await act(async () => jest.advanceTimersByTime(600));
      expect(screen.getByText('נמצאה מדינה אחת')).toBeOnTheScreen();

      await fireEvent.press(screen.getByTestId('search-clear'));
      await fireEvent.changeText(screen.getByTestId('search-input'), 'קוריאה');
      expect(screen.queryByText('נמצאה מדינה אחת')).toBeNull();
      await act(async () => jest.advanceTimersByTime(600));
      expect(screen.getByText('נמצאו 2 מדינות')).toBeOnTheScreen();
    });

    it('gives the screen reader focus back to the field after clear (AC-6)', async () => {
      const focus = jest
        .spyOn(AccessibilityInfo, 'sendAccessibilityEvent')
        .mockImplementation(() => {});
      await render(<GlobeScreen />);
      await search('fr');
      await fireEvent.press(screen.getByTestId('search-clear'));
      await act(async () => jest.advanceTimersByTime(20));
      expect(focus).toHaveBeenCalledWith(expect.anything(), 'focus');
      focus.mockRestore();
    });

    it('labels a territory with its sovereign (AC-4)', async () => {
      await render(<GlobeScreen />);
      await search('גיברלטר');
      expect(
        screen.getByLabelText('גיברלטר, טריטוריה של הממלכה המאוחדת, Gibraltar'),
      ).toBeOnTheScreen();
    });
  });

  it('shades behind both system bars so their icons stay readable (AC-9)', async () => {
    await render(<GlobeScreen />);
    expect(screen.getByTestId('scrim-top')).toBeOnTheScreen();
    expect(screen.getByTestId('scrim-bottom')).toBeOnTheScreen();
  });

  it('loads the detailed borders only once the globe is ready (AC-13a)', async () => {
    mockMap.loads = false;
    mockDetailedRequests.length = 0;
    await render(<GlobeScreen />);
    expect(mockDetailedRequests.length).toBeGreaterThan(0);
    expect(mockDetailedRequests.every((enabled) => !enabled)).toBe(true);

    mockMap.loads = true;
    mockDetailedRequests.length = 0;
    await render(<GlobeScreen />);
    expect(mockDetailedRequests.at(-1)).toBe(true);
  });

  it("draws Antarctica's lines from its outline, never along the 180° cut (sprint 1 QA)", async () => {
    await render(<GlobeScreen />);
    const lines = ['any', ['has', 'outline'], ['!=', ['get', 'adm0'], 'ATA']];
    expect(mockMap.lines['countries-coarse-border']).toEqual(lines);
    expect(mockMap.lines['countries-detailed-border']).toEqual(lines);
    for (const part of ['glow', 'underlay', 'outline']) {
      const filter = mockMap.lines[`highlight-coarse-${part}`] as unknown[];
      expect(filter[0]).toBe('all');
      expect(filter).toContainEqual(lines);
    }
  });

  it('zooms by pinch only: no double-tap or quick zoom (AC-10)', async () => {
    await render(<GlobeScreen />);
    expect(mockMap.gestures).toEqual({
      doubleTapToZoomInEnabled: false,
      doubleTouchToZoomOutEnabled: false,
      quickZoomEnabled: false,
      pinchZoomEnabled: true,
    });
  });

  it('asks both border levels and takes the one that is drawn (AC-13a)', async () => {
    await render(<GlobeScreen />);
    // Zoomed in: only the detailed layer is drawn, so only it answers.
    await tap({ detailed: { adm0: 'GRC', code: 'GR' } });
    expect(screen.getByText('יוון')).toBeOnTheScreen();
  });

  it('keeps the coarse borders at every zoom until the detailed ones are drawn (AC-13a)', async () => {
    // Mapbox goes idle once (globe ready), then not again for a while.
    mockMap.idles = 1;
    await render(<GlobeScreen />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockMap.fills['countries-detailed-hit']).toEqual({
      minZoomLevel: 3,
      maxZoomLevel: undefined,
    });
    expect(mockMap.fills['countries-coarse-hit']!.maxZoomLevel).toBeUndefined();

    // No idle came: the fallback hands zoom 3+ over to the detailed borders.
    await act(async () => jest.advanceTimersByTime(3_000));
    expect(mockMap.fills['countries-coarse-hit']!.maxZoomLevel).toBe(3);
  });

  it('switches the coarse borders off above zoom 3 at the first idle after the detailed ones mount', async () => {
    await render(<GlobeScreen />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockMap.fills['countries-coarse-hit']!.maxZoomLevel).toBe(3);
  });

  it('still starts if Mapbox never settles after loading (globe-ready fallback)', async () => {
    mockMap.idles = 0;
    await render(<GlobeScreen />);
    await act(async () => {
      jest.advanceTimersByTime(4_000);
      await Promise.resolve();
    });
    expect(cameraMoves().some((m) => m.animationMode === 'linearTo')).toBe(false);
    // The fallback fires at 5 s; rotation then starts on its next timers.
    await act(async () => jest.advanceTimersByTime(1_100));
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        jest.advanceTimersByTime(10);
        await Promise.resolve();
      });
    }
    expect(cameraMoves().some((m) => m.animationMode === 'linearTo')).toBe(true);
  });

  it('selects as the finger lifts, but not after a drag or a long press (AC-10)', async () => {
    await render(<GlobeScreen />);
    mockMap.hits = BANGKOK_TAP;
    const surface = screen.getByTestId('globe-touch-surface');

    // A drag across the globe.
    await fireEvent(surface, 'touchStart', {
      nativeEvent: { touches: [{}], pageX: 100, pageY: 200 },
    });
    await act(async () => {
      await fireEvent(surface, 'touchEnd', {
        nativeEvent: { touches: [], pageX: 180, pageY: 200 },
      });
    });
    expect(screen.queryByTestId('country-card')).toBeNull();

    // A long press.
    await fireEvent(surface, 'touchStart', {
      nativeEvent: { touches: [{}], pageX: 100, pageY: 200 },
    });
    await act(async () => jest.advanceTimersByTime(600));
    await act(async () => {
      await fireEvent(surface, 'touchEnd', {
        nativeEvent: { touches: [], pageX: 100, pageY: 200 },
      });
    });
    expect(screen.queryByTestId('country-card')).toBeNull();

    await tap(BANGKOK_TAP);
    expect(screen.getByTestId('country-card')).toBeOnTheScreen();
  });

  describe('account (sprint 1 F-003a)', () => {
    const user = { id: 'u1', name: 'יוסי לוי', email: 'yossi@example.test' };

    it('shows no account button while sign-in is unavailable or loading', async () => {
      await render(<GlobeScreen />);
      expect(screen.queryByTestId('account-button')).toBeNull();
      mockAuth.state = { status: 'loading' };
      await render(<GlobeScreen />);
      expect(screen.queryByTestId('account-button')).toBeNull();
    });

    it('opens the Google sheet from the account button when signed out (AC-15)', async () => {
      mockAuth.state = { status: 'signedOut', expired: false };
      await render(<GlobeScreen />);
      expect(screen.getByLabelText('התחברות לחשבון')).toBeOnTheScreen();
      await fireEvent.press(screen.getByTestId('account-button'));
      expect(screen.getByTestId('google-sign-in')).toBeOnTheScreen();
      expect(screen.getByText('המשך עם ⁦Google⁩')).toBeOnTheScreen();
    });

    it('opens the sign-in sheet by itself when the session expired (AC-20)', async () => {
      mockAuth.state = { status: 'signedOut', expired: true };
      await render(<GlobeScreen />);
      expect(screen.getByText('פג תוקף ההתחברות. צריך להתחבר שוב.')).toBeOnTheScreen();
    });

    it('shows the initial, never a photo, and signs out from the account sheet (AC-19)', async () => {
      mockAuth.state = { status: 'signedIn', user };
      await render(<GlobeScreen />);
      expect(screen.getByLabelText('החשבון של יוסי לוי')).toBeOnTheScreen();
      expect(screen.getByText('יל')).toBeOnTheScreen();
      await fireEvent.press(screen.getByTestId('account-button'));
      await fireEvent.press(screen.getByTestId('sign-out'));
      expect(mockAuth.signOut).toHaveBeenCalled();
    });

    it('blocks with the consent screen and keeps the globe still (AC-16, design 5.1)', async () => {
      mockAuth.state = {
        status: 'needsConsent',
        user,
        need: { kind: 'first' },
        documents: [
          { docType: 'terms', version: 0, url: null, publishedAt: '2026-10-24T00:00:00Z' },
          { docType: 'privacy', version: 0, url: null, publishedAt: '2026-10-24T00:00:00Z' },
        ],
      };
      await render(<GlobeScreen />);
      // Dark status bar icons over the light consent screen (sprint 1 QA).
      expect(mockStatusBar.style).toBe('dark');
      // The consent Modal opens one tick after mounting (status bar first).
      await act(async () => jest.advanceTimersByTime(0));
      expect(screen.getByText('לפני שממשיכים')).toBeOnTheScreen();
      expect(screen.getByText('גרסה 0 · טיוטה')).toBeOnTheScreen();
      expect(screen.queryByTestId('account-button')).toBeNull();

      // "Continue" stays locked until the mandatory box is ticked; no age statement.
      expect(screen.getByTestId('consent-continue')).toBeDisabled();
      expect(screen.queryByText(/18/)).toBeNull();
      await fireEvent.press(screen.getByTestId('consent-agree'));
      expect(screen.getByTestId('consent-continue')).toBeEnabled();
      await fireEvent.press(screen.getByTestId('consent-marketing'));
      await act(async () => {
        await fireEvent.press(screen.getByTestId('consent-continue'));
      });
      expect(mockAuth.submitConsent).toHaveBeenCalledWith({ marketing: true, analytics: false });

      mockMap.setCamera.mockClear();
      await act(async () => {
        jest.advanceTimersByTime(30_000);
        await Promise.resolve();
      });
      expect(cameraMoves().some((m) => m.animationMode === 'linearTo')).toBe(false);
    });

    it('asks again only for the changed document, without the optional choices (AC-18)', async () => {
      mockAuth.state = {
        status: 'needsConsent',
        user,
        need: { kind: 'updated', docs: ['privacy'] },
        documents: [
          { docType: 'terms', version: 1, url: null, publishedAt: '2026-11-01T00:00:00Z' },
          { docType: 'privacy', version: 2, url: null, publishedAt: '2026-11-01T00:00:00Z' },
        ],
      };
      await render(<GlobeScreen />);
      // The consent Modal opens one tick after mounting (status bar first).
      await act(async () => jest.advanceTimersByTime(0));
      expect(screen.getByText('עדכנו את מדיניות הפרטיות')).toBeOnTheScreen();
      expect(screen.getByText('חדש')).toBeOnTheScreen();
      expect(screen.queryByTestId('consent-marketing')).toBeNull();
      await fireEvent.press(screen.getByTestId('consent-agree'));
      await act(async () => {
        await fireEvent.press(screen.getByTestId('consent-continue'));
      });
      expect(mockAuth.submitConsent).toHaveBeenCalledWith({});
    });

    it('closes the sheet when the account state changes (design 4.2, 5.2)', async () => {
      mockAuth.state = { status: 'signedOut', expired: false };
      const view = await render(<GlobeScreen />);
      await fireEvent.press(screen.getByTestId('account-button'));
      expect(screen.getByTestId('google-sign-in')).toBeOnTheScreen();

      // Signed in and already up to date: no sheet, just the globe (and a toast).
      mockAuth.state = { status: 'signedIn', user };
      await view.rerender(<GlobeScreen />);
      expect(screen.queryByTestId('account-sheet')).toBeNull();

      // Signed out again from the consent screen: the globe, not the sign-in sheet.
      mockAuth.state = { status: 'signedOut', expired: false };
      await view.rerender(<GlobeScreen />);
      expect(screen.queryByTestId('google-sign-in')).toBeNull();
    });

    it('confirms with a toast after signing in (design 5.2)', async () => {
      mockAuth.state = { status: 'signedIn', user };
      mockAuth.notice = { kind: 'signedIn', name: 'יוסי לוי' };
      await render(<GlobeScreen />);
      expect(screen.getByText('התחברת בתור יוסי לוי')).toBeOnTheScreen();
    });
  });

  it('uses the layer ids the tap logic queries', () => {
    expect(LAYER).toEqual({
      countriesCoarseHit: 'countries-coarse-hit',
      countriesDetailedHit: 'countries-detailed-hit',
      smallHitWide: 'small-countries-hit-wide',
      smallHitTight: 'small-countries-hit-tight',
    });
  });

  describe('the next trip (sprint 3 AC-7, AC-8)', () => {
    const signedIn = { id: 'u1', name: 'יוסי לוי', email: 'y@example.test' };
    const greece = {
      id: 'trip-grc',
      countryAdm0: 'GRC',
      title: 'יוון אוקטובר 2026',
      startDate: '2026-10-20',
      endDate: '2026-10-30',
      notes: null,
      travelers: [],
      cities: [],
    };

    it('opens the active trip at launch, with one announcement (AC-8)', async () => {
      const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
      announce.mockClear();
      mockAuth.state = { status: 'signedIn', user: signedIn };
      mockTrips.firstLoad = true;
      mockTrips.nextTrip = greece;
      await render(<GlobeScreen />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByText('יוון')).toBeOnTheScreen();
      const said = announce.mock.calls.map(([text]) => text);
      expect(said).toContain('בנסיעה עכשיו: יוון אוקטובר 2026');
      expect(said.some((text) => text.startsWith('נבחרה'))).toBe(false);
    });

    it('does not open a trip that is only planned', async () => {
      mockAuth.state = { status: 'signedIn', user: signedIn };
      mockTrips.firstLoad = true;
      mockTrips.nextTrip = { ...greece, startDate: '2026-11-01', endDate: '2026-11-05' };
      await render(<GlobeScreen />);
      expect(screen.queryByTestId('country-card')).toBeNull();
    });

    it('does not open when the user touched the globe first', async () => {
      mockAuth.state = { status: 'signedIn', user: signedIn };
      mockTrips.nextTrip = greece;
      const view = await render(<GlobeScreen />);
      const surface = screen.getByTestId('globe-touch-surface');
      await fireEvent(surface, 'touchStart', { nativeEvent: { touches: [{}] } });
      await fireEvent(surface, 'touchEnd', { nativeEvent: { touches: [] } });
      mockTrips.firstLoad = true;
      await view.rerender(<GlobeScreen />);
      expect(screen.queryByText('יוון')).toBeNull();
    });

    it('does not open when the trips arrive more than 3 s after the globe', async () => {
      mockAuth.state = { status: 'signedIn', user: signedIn };
      mockTrips.nextTrip = greece;
      const view = await render(<GlobeScreen />);
      await act(async () => jest.advanceTimersByTime(3_500));
      mockTrips.firstLoad = true;
      await view.rerender(<GlobeScreen />);
      expect(screen.queryByText('יוון')).toBeNull();
    });

    it('does not open after the user was asked to accept the documents (Raz, m7)', async () => {
      mockAuth.state = {
        status: 'needsConsent',
        user: signedIn,
        need: { kind: 'updated', docs: ['terms'] },
        documents: [
          { docType: 'terms', version: 1, url: null, publishedAt: '2026-10-24T00:00:00Z' },
          { docType: 'privacy', version: 0, url: null, publishedAt: '2026-10-24T00:00:00Z' },
        ],
      };
      mockTrips.nextTrip = greece;
      const view = await render(<GlobeScreen />);
      mockAuth.state = { status: 'signedIn', user: signedIn };
      mockTrips.firstLoad = true;
      await view.rerender(<GlobeScreen />);
      expect(screen.queryByText('יוון')).toBeNull();
    });

    it('opens once: closing the card leaves it closed', async () => {
      mockAuth.state = { status: 'signedIn', user: signedIn };
      mockTrips.firstLoad = true;
      mockTrips.nextTrip = greece;
      const view = await render(<GlobeScreen />);
      expect(screen.getByText('יוון')).toBeOnTheScreen();
      await fireEvent.press(screen.getByTestId('card-close'));
      await act(async () => jest.advanceTimersByTime(1_000));
      await view.rerender(<GlobeScreen />);
      expect(screen.queryByText('יוון')).toBeNull();
    });

    it('a tap on the pin opens its trip, over the country under it (AC-7)', async () => {
      mockAuth.state = { status: 'signedIn', user: signedIn };
      mockTrips.nextTrip = { ...greece, startDate: '2026-11-01', endDate: '2026-11-05' };
      await render(<GlobeScreen />);
      await tap({ pin: { adm0: 'GRC', tripId: 'trip-grc' }, country: { adm0: 'TUR', code: 'TR' } });
      expect(screen.getByText('יוון')).toBeOnTheScreen();
    });
  });
});

describe('discovery search (sprint 9 F-023)', () => {
  const matched = () =>
    (
      screen.getByTestId('globe-discover', { includeHiddenElements: true }).props.accessibilityValue
        ?.text as string
    )
      .split(',')
      .filter(Boolean);

  it('"close to Israel" colours Cyprus and Greece, not Thailand, and lists them (AC-4, AC-6)', async () => {
    await render(<GlobeScreen />);
    await fireEvent.press(screen.getByTestId('discover-chip-near'));
    expect(matched()).toEqual(expect.arrayContaining(['CYP', 'GRC']));
    expect(matched()).not.toContain('THA');
    expect(matched()).not.toContain('ISR');
    expect(screen.getByTestId('discover-row-CYP')).toBeOnTheScreen();
    expect(screen.getByTestId('discover-count')).toHaveTextContent(
      `${matched().length} מדינות מתאימות`,
    );
    expect(screen.getByTestId('discover-disclaimer')).toBeOnTheScreen();
    expect(mockMap.lines['discover-coarse-line']).toBeDefined();
  });

  it('December and hot: Thailand, not Greece; the month comes from the one picker (AC-1, AC-3)', async () => {
    await render(<GlobeScreen />);
    await fireEvent.press(screen.getByTestId('discover-chip-weather'));
    // No type yet: the month only, nothing coloured (Raz 2).
    expect(screen.getByTestId('discover-choose-type')).toBeOnTheScreen();
    expect(matched()).toEqual([]);
    await fireEvent.press(screen.getByTestId('discover-month'));
    await fireEvent.press(screen.getByTestId('discover-month-12'));
    await fireEvent.press(screen.getByTestId('discover-type-hot'));
    expect(matched()).toContain('THA');
    expect(matched()).not.toContain('GRC');
    expect(screen.getByTestId('discover-month').props.accessibilityValue.text).toBe('12');
  });

  it('"clear" turns everything off and restores the globe (AC-5)', async () => {
    await render(<GlobeScreen />);
    await fireEvent.press(screen.getByTestId('discover-chip-near'));
    await fireEvent.press(screen.getByTestId('discover-clear'));
    expect(
      screen.getByTestId('globe-discover', { includeHiddenElements: true }).props.accessibilityValue
        .text,
    ).toBe('');
    expect(screen.queryByTestId('discover-panel')).toBeNull();
    expect(screen.getByTestId('discover-chip-near').props.accessibilityValue.text).toBe('off');
  });

  it('back clears discovery when no card is open (design 15)', async () => {
    const handlers: (() => boolean)[] = [];
    const spy = jest
      .spyOn(BackHandler, 'addEventListener')
      .mockImplementation((_event, handler) => {
        handlers.push(handler as () => boolean);
        return { remove: () => handlers.splice(handlers.indexOf(handler as () => boolean), 1) };
      });
    await render(<GlobeScreen />);
    await fireEvent.press(screen.getByTestId('discover-chip-near'));
    await act(async () => {
      handlers.at(-1)!();
    });
    expect(screen.queryByTestId('discover-panel')).toBeNull();
    spy.mockRestore();
  });

  it('family: the card from a row says why it matches (AC-2, AC-7)', async () => {
    mockDestination = {
      rates: new Map(),
      from: 'server',
      advisories: new Map([
        ['CYP', { adm0: 'CYP', entryStatus: 'allowed', nscLevels: [1], fetchedAt: null }],
        ['TUR', { adm0: 'TUR', entryStatus: 'allowed', nscLevels: [3], fetchedAt: null }],
      ]),
    };
    await render(<GlobeScreen />);
    await fireEvent.press(screen.getByTestId('discover-chip-family'));
    await fireEvent.press(screen.getByTestId('discover-month'));
    await fireEvent.press(screen.getByTestId('discover-month-5'));
    expect(matched()).toEqual(['CYP']);
    await fireEvent.press(screen.getByTestId('discover-row-CYP'));
    expect(screen.getByTestId('card-match').props.accessibilityValue.text).toBe('match');
    expect(screen.getByTestId('card-match-level')).toHaveTextContent('אזהרה רמה 1');
    expect(screen.getByTestId('card-match-hours')).toBeOnTheScreen();
  });
});
