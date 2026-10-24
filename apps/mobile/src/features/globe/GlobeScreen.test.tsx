/**
 * Screen-level behaviour of the home globe with Mapbox replaced by a stand-in
 * that records camera moves and answers hit-test queries. Rendering and
 * gestures themselves are checked on the device (Maestro).
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { BackHandler } from 'react-native';
import { withTiming } from 'react-native-reanimated';

import '@/i18n';
import { motion } from '@/theme/tokens';

import { HOME_ZOOM } from './camera';
import { GlobeScreen } from './GlobeScreen';
import { LAYER } from './GlobeLayers';

type Hits = { wide?: string; tight?: string; country?: { adm0: string; code: string | null } };

const mockMap = {
  hits: {} as Hits,
  center: [34.8, 22] as [number, number],
  setCamera: jest.fn(),
  loads: true,
  /** Mapbox goes idle once the visible tiles are drawn (the globe-ready point). */
  idles: true,
  /** Last style and filter each circle layer was rendered with, by layer id. */
  circles: {} as Record<string, { style: Record<string, unknown>; filter?: unknown }>,
};
let mockReduceMotion: boolean | null = false;
/** Every value the screen passed to useDetailedCountriesAsset. */
const mockDetailedRequests: boolean[] = [];

jest.mock('@rnmapbox/maps', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');

  const featuresFor = (layer: string) => {
    const { hits } = mockMap;
    const props =
      layer === 'small-countries-hit-wide' && hits.wide
        ? { adm0: hits.wide }
        : layer === 'small-countries-hit-tight' && hits.tight
          ? { adm0: hits.tight }
          : (layer === 'countries-coarse-hit' || layer === 'countries-detailed-hit') && hits.country
            ? hits.country
            : null;
    return { type: 'FeatureCollection', features: props ? [{ properties: props }] : [] };
  };

  const MapView = React.forwardRef(function MapView(
    props: {
      onDidFinishLoadingMap?: () => void;
      onMapIdle?: () => void;
      children?: React.ReactNode;
    },
    ref,
  ) {
    React.useImperativeHandle(ref, () => ({
      queryRenderedFeaturesAtPoint: async (_point: unknown, _filter: unknown, layers: string[]) =>
        featuresFor(layers[0]!),
      getCenter: async () => mockMap.center,
    }));
    const { onDidFinishLoadingMap, onMapIdle } = props;
    React.useEffect(() => {
      if (!mockMap.loads) return;
      onDidFinishLoadingMap?.();
      if (mockMap.idles) onMapIdle?.();
    }, [onDidFinishLoadingMap, onMapIdle]);
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
    FillLayer: Nothing,
    LineLayer: Nothing,
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
jest.mock('./mapbox', () => ({ hasMapboxToken: true }));
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
  mockMap.idles = true;
  mockReduceMotion = false;
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
  });

  it('selects from the detailed borders when they answer the tap', async () => {
    await render(<GlobeScreen />);
    await tap({ country: { adm0: 'GRC', code: 'GR' } });
    expect(screen.getByText('יוון')).toBeOnTheScreen();
  });

  it('still starts if Mapbox never settles after loading (globe-ready fallback)', async () => {
    mockMap.idles = false;
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

  it('uses the layer ids the tap logic queries', () => {
    expect(LAYER).toEqual({
      countriesCoarseHit: 'countries-coarse-hit',
      countriesDetailedHit: 'countries-detailed-hit',
      smallHitWide: 'small-countries-hit-wide',
      smallHitTight: 'small-countries-hit-tight',
    });
  });
});
