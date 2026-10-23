/**
 * Screen-level behaviour of the home globe with Mapbox replaced by a stand-in
 * that records camera moves and answers hit-test queries. Rendering and
 * gestures themselves are checked on the device (Maestro).
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { BackHandler } from 'react-native';

import '@/i18n';

import { HOME_ZOOM } from './camera';
import { GlobeScreen } from './GlobeScreen';
import { LAYER } from './GlobeLayers';

type Hits = { wide?: string; tight?: string; country?: { adm0: string; code: string | null } };

const mockMap = {
  hits: {} as Hits,
  center: [34.8, 22] as [number, number],
  setCamera: jest.fn(),
  onPress: null as null | ((feature: unknown) => Promise<void>),
};
let mockReduceMotion: boolean | null = false;

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
          : layer === 'countries-hit' && hits.country
            ? hits.country
            : null;
    return { type: 'FeatureCollection', features: props ? [{ properties: props }] : [] };
  };

  const MapView = React.forwardRef(function MapView(
    props: { onPress: (feature: unknown) => Promise<void>; children?: React.ReactNode },
    ref,
  ) {
    React.useImperativeHandle(ref, () => ({
      queryRenderedFeaturesAtPoint: async (_point: unknown, _filter: unknown, layers: string[]) =>
        featuresFor(layers[0]!),
      getCenter: async () => mockMap.center,
    }));
    mockMap.onPress = props.onPress;
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
    CircleLayer: Nothing,
  };
});
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
jest.mock('./mapbox', () => ({ hasMapboxToken: true }));
jest.mock('./useCountriesAsset', () => ({
  useCountriesAsset: () => ({ url: 'file:///countries.geojson', error: null }),
}));
jest.mock('./useReduceMotion', () => ({ useReduceMotion: () => mockReduceMotion }));

const BANGKOK_TAP: Hits = { country: { adm0: 'THA', code: 'TH' } };

async function tap(hits: Hits) {
  mockMap.hits = hits;
  await act(async () => {
    await mockMap.onPress!({ properties: { screenPointX: 100, screenPointY: 200 } });
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

  it('uses the layer ids the tap logic queries', () => {
    expect(LAYER).toEqual({
      countriesHit: 'countries-hit',
      smallHitWide: 'small-countries-hit-wide',
      smallHitTight: 'small-countries-hit-tight',
    });
  });
});
