// The country card fix (docs/sprints/fix-country-card.md, AC-1 – AC-5): the
// strip's columns, the Safety tile with no threat level anywhere on the card,
// the badges, the entry line, and which tiles show.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

import i18n from '@/i18n';
import {
  CardEntryLine,
  safetyState,
  type SafetyState,
} from '@/features/destination/CardDestination';
import type { Advisory, Destination } from '@/features/destination/destinationData';
import type { Rate } from '@/features/destination/rateFormat';

import { BoardingPassCard } from './BoardingPassCard';
import { CardTiles, rowWidths, tileArrangement, tileLayout } from './CardTiles';
import { countryByAdm0 } from './countryData';

const t = i18n.t.bind(i18n);
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

const advisory = (over: Partial<Advisory> = {}): Advisory => ({
  adm0: 'THA',
  entryStatus: null,
  entryNote: null,
  entrySourceUrl: null,
  entryVerifiedAt: null,
  nscLevel: 4,
  nscLevels: [4],
  nscText: 'טקסט',
  nscUrl: null,
  mfaText: null,
  mfaUrl: null,
  fetchedAt: daysAgo(1),
  ...over,
});
const rate = (over: Partial<Rate> = {}): Rate => ({
  currency: 'THB',
  rateToIls: 0.11,
  rateToUsd: 0.03,
  source: 'erapi',
  rateDate: '2026-10-26',
  fetchedAt: daysAgo(1),
  ...over,
});
const data = (over: Partial<Destination> = {}): Destination => ({
  rates: new Map([['THB', rate()]]),
  advisories: new Map([['THA', advisory()]]),
  from: 'server',
  ...over,
});

const mockDestination = { state: { data: null as Destination | null, failed: false } };
jest.mock('@/features/destination/destinationData', () => ({
  ...jest.requireActual('@/features/destination/destinationData'),
  useDestination: () => mockDestination.state,
}));
// The temperature's own states are covered in Temperature.test; here it is loading.
jest.mock('@/features/climate/climateData', () => ({
  ...jest.requireActual('@/features/climate/climateData'),
  useClimate: () => ({ status: 'loading', showSkeleton: false }),
}));
/** Jest's window by default: 750 wide at font scale 2, which shows the list. */
const mockWindow = { width: 750, height: 1334, scale: 2, fontScale: 2 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));
const mockAuth = { status: 'signedIn' as string };
jest.mock('@/features/auth/AuthProvider', () => ({
  useAuthIfAny: () => ({ state: { status: mockAuth.status } }),
}));

const quiet: SafetyState = {
  advisory: undefined,
  loading: false,
  failed: false,
  offline: false,
  stale: false,
  badge: null,
};
const tiles = (adm0: string, safety: SafetyState = quiet) =>
  render(
    <CardTiles
      country={countryByAdm0(adm0)!}
      safety={safety}
      colorScheme="light"
      reduceMotion
      insetsBottom={0}
      today="2026-10-26"
      city={null}
      onOpenSafety={jest.fn()}
      safetyRef={{ current: null }}
    />,
  );
const order = () =>
  screen
    .getAllByTestId(/^card-tile-(safety|time|money|climate|emergency)$/)
    .map((el) => el.props.testID as string);

beforeEach(() => {
  Object.assign(mockWindow, { width: 750, fontScale: 2 });
  mockDestination.state = { data: data(), failed: false };
  mockAuth.status = 'signedIn';
  jest.mocked(NetInfo.addEventListener).mockImplementation((listener) => {
    (listener as (s: { isConnected: boolean }) => void)({ isConnected: true });
    return jest.fn();
  });
});

describe('the strip (AC-3, fix 5.3, 5.4)', () => {
  it.each([
    // [width, font scale, tiles, expected]
    [355, 1, 5, { mode: 'tiles', cols: 5 }],
    [355, 1.3, 5, { mode: 'tiles', cols: 3 }],
    [355, 1.3, 4, { mode: 'tiles', cols: 4 }],
    [304, 1, 5, { mode: 'tiles', cols: 3 }],
    // An iPhone 12–16: the gaps make five 64-wide tiles too wide (Raz review 1).
    [334, 1, 5, { mode: 'tiles', cols: 3 }],
    [352, 1, 5, { mode: 'tiles', cols: 5 }],
    [355, 1, 6, { mode: 'tiles', cols: 3 }],
    [355, 1.6, 5, { mode: 'list', cols: 1 }],
    [355, 2, 1, { mode: 'list', cols: 1 }],
  ] as const)('%d wide at %d: %d tiles → %j', (width, scale, count, expected) => {
    expect(tileLayout(width, scale, count)).toEqual(expected);
  });

  it('the order: Safety, time, currency, temperature', async () => {
    await tiles('THA');
    expect(order()).toEqual([
      'card-tile-safety',
      'card-tile-time',
      'card-tile-money',
      'card-tile-climate',
    ]);
  });

  it('signed out, emergency comes last (sprint 8 AC-17)', async () => {
    mockAuth.status = 'signedOut';
    await tiles('THA');
    expect(order().at(-1)).toBe('card-tile-emergency');
    expect(screen.getByTestId('card-tile-emergency').props.accessibilityLabel).toBe(
      t('card.emergency', { inCountry: 'בתאילנד' }),
    );
  });

  it('Israel: no Safety and no emergency; the shekel is not a control', async () => {
    mockAuth.status = 'signedOut';
    await tiles('ISR');
    expect(order()).toEqual(['card-tile-time', 'card-tile-money', 'card-tile-climate']);
    const money = screen.getByTestId('card-tile-money');
    expect(money.props.accessibilityRole).toBeUndefined();
    expect(money.props.accessibilityLabel).toBe('מטבע: שקל חדש, ₪');
  });
});

describe('data, then actions (sprint 12 P-1)', () => {
  /** The strip as measured: the card's width less its margins and padding. */
  const measure = (width: number) =>
    fireEvent(screen.getByTestId('card-tiles'), 'layout', {
      nativeEvent: { layout: { width, height: 76 } },
    });

  it.each([
    // [width, font scale, tiles, expected]
    [355, 1, 5, 'one-row'],
    [334, 1, 5, 'two-rows'],
    [355, 1.3, 5, 'two-rows'],
    [355, 1.3, 4, 'one-row'],
    [355, 1.6, 5, 'list'],
    [355, 2, 1, 'list'],
  ] as const)('%d wide at %d: %d tiles → %s', (width, scale, count, expected) => {
    expect(tileArrangement(width, scale, count)).toBe(expected);
  });

  it('sprint 13 AC-8: three data tiles in two columns leave no hole; the last one takes the row', () => {
    expect(rowWidths(3, 2, 300, 8)).toEqual([146, 146, 300]);
    expect(rowWidths(4, 2, 300, 8)).toEqual([146, 146, 146, 146]);
    expect(rowWidths(3, 3, 300, 8)).toEqual([94, 94, 94]);
  });

  it('one row: time, currency, temperature, then Safety and What to see', async () => {
    Object.assign(mockWindow, { width: 411, fontScale: 1 });
    await render(
      <CardTiles
        country={countryByAdm0('THA')!}
        safety={quiet}
        colorScheme="light"
        reduceMotion
        insetsBottom={0}
        today="2026-10-26"
        city={null}
        onOpenSafety={jest.fn()}
        safetyRef={{ current: null }}
        onOpenPlaces={jest.fn()}
      />,
    );
    await measure(355);
    expect(screen.getByTestId('card-tiles').props.accessibilityValue).toEqual({ text: 'tiles' });
    expect(
      screen
        .getAllByTestId(/^card-tile-(safety|time|money|climate|places|emergency)$/)
        .map((el) => el.props.testID as string),
    ).toEqual([
      'card-tile-time',
      'card-tile-money',
      'card-tile-climate',
      'card-tile-safety',
      'card-tile-places',
    ]);
    expect(screen.queryByTestId('card-tiles-actions')).toBeNull();
  });

  it('two rows: the data in one, the actions wide and low in the next', async () => {
    Object.assign(mockWindow, { width: 411, fontScale: 1.3 });
    await render(
      <CardTiles
        country={countryByAdm0('THA')!}
        safety={quiet}
        colorScheme="light"
        reduceMotion
        insetsBottom={0}
        today="2026-10-26"
        city={null}
        onOpenSafety={jest.fn()}
        safetyRef={{ current: null }}
        onOpenPlaces={jest.fn()}
      />,
    );
    await measure(355);
    const ids = (row: string) =>
      screen
        .getByTestId(row)
        .props.children.filter(Boolean)
        .map((el: { props: { tile: { key: string } } }) => el.props.tile.key);
    expect(ids('card-tiles-data')).toEqual(['time', 'money', 'climate']);
    expect(ids('card-tiles-actions')).toEqual(['safety', 'places']);
    // Wide and low, with no empty value line.
    const safety = screen.getByTestId('card-tile-safety');
    expect(JSON.stringify(safety.props.style)).toContain('"minHeight":56');
  });

  it('signed out: three actions, too narrow for the chevron', async () => {
    mockAuth.status = 'signedOut';
    Object.assign(mockWindow, { width: 411, fontScale: 1.3 });
    await render(
      <CardTiles
        country={countryByAdm0('THA')!}
        safety={quiet}
        colorScheme="light"
        reduceMotion
        insetsBottom={0}
        today="2026-10-26"
        city={null}
        onOpenSafety={jest.fn()}
        safetyRef={{ current: null }}
        onOpenPlaces={jest.fn()}
      />,
    );
    await measure(355);
    expect(screen.getByTestId('card-tiles-actions').props.children).toHaveLength(3);
    expect(screen.queryByTestId('card-tile-chevron')).toBeNull();
  });

  it('two actions: wide enough for the chevron (polish-audit 1)', async () => {
    Object.assign(mockWindow, { width: 411, fontScale: 1.3 });
    await render(
      <CardTiles
        country={countryByAdm0('THA')!}
        safety={quiet}
        colorScheme="light"
        reduceMotion
        insetsBottom={0}
        today="2026-10-26"
        city={null}
        onOpenSafety={jest.fn()}
        safetyRef={{ current: null }}
        onOpenPlaces={jest.fn()}
      />,
    );
    await measure(355);
    expect(screen.getAllByTestId('card-tile-chevron')).toHaveLength(2);
  });

  it('three data tiles too wide for a narrow strip split into rows (Raz 5)', async () => {
    Object.assign(mockWindow, { width: 320, fontScale: 1.5 });
    await tiles('THA');
    await measure(264);
    const time = StyleSheet.flatten(screen.getByTestId('card-tile-time').props.style);
    // 264 at 1.5: two 96-wide columns, not three of 82.
    expect(time.width).toBeGreaterThanOrEqual(64 * 1.5);
  });

  it('one data tile alone keeps the narrow width (John, Raz 3)', async () => {
    Object.assign(mockWindow, { width: 411, fontScale: 1.3 });
    await render(
      <CardTiles
        country={countryByAdm0('ATA')!}
        safety={quiet}
        colorScheme="light"
        reduceMotion
        insetsBottom={0}
        today="2026-10-26"
        city={null}
        onOpenSafety={jest.fn()}
        safetyRef={{ current: null }}
        onOpenPlaces={jest.fn()}
      />,
    );
    await measure(200);
    const data = screen.queryByTestId('card-tiles-data');
    if (data) {
      for (const tile of data.props.children.filter(Boolean)) {
        expect(tile.props.width).toBeLessThanOrEqual(112);
      }
    }
    expect(screen.getByTestId('card-tiles-actions')).toBeOnTheScreen();
  });

  it('Israel: the data row only', async () => {
    Object.assign(mockWindow, { width: 411, fontScale: 1 });
    await tiles('ISR');
    await measure(355);
    expect(screen.queryByTestId('card-tiles-actions')).toBeNull();
  });
});

describe('no threat level on the card (AC-2, Yossi)', () => {
  it('the Safety tile has no value, no level colour and no level in its label', async () => {
    await tiles('THA', safetyState('THA', { data: data(), failed: false }, false));
    const safety = screen.getByTestId('card-tile-safety');
    expect(safety.props.accessibilityLabel).toBe(t('card.tile.safetyA11y'));
    expect(safety.props.accessibilityLabel).not.toMatch(/רמה|4|איום גבוה/);
    expect(screen.queryByTestId('advisory-bar-4', { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByText(t('advisory.word.4'))).toBeNull();
  });

  it('the Safety tile opens the sheet', async () => {
    const onOpenSafety = jest.fn();
    await render(
      <CardTiles
        country={countryByAdm0('THA')!}
        safety={quiet}
        colorScheme="light"
        reduceMotion
        insetsBottom={0}
        today="2026-10-26"
        city={null}
        onOpenSafety={onOpenSafety}
        safetyRef={{ current: null }}
      />,
    );
    await fireEvent.press(screen.getByTestId('card-tile-safety'));
    expect(onOpenSafety).toHaveBeenCalled();
  });
});

describe('badges (AC-4, fix 5.5)', () => {
  it('Safety: offline on a first offline launch; it wins over stale', () => {
    expect(safetyState('THA', { data: null, failed: true }, true).badge).toBe('offline');
  });

  it('Safety: stale offline from the saved copy, or checked over 30 days ago', () => {
    expect(safetyState('THA', { data: data({ from: 'device' }), failed: false }, true).badge).toBe(
      'stale',
    );
    const old = data({ advisories: new Map([['THA', advisory({ fetchedAt: daysAgo(31) })]]) });
    expect(safetyState('THA', { data: old, failed: false }, false).badge).toBe('stale');
  });

  it('Safety: nothing while loading, after an online error, or when all is well', () => {
    expect(safetyState('THA', { data: null, failed: false }, false).badge).toBeNull();
    expect(safetyState('THA', { data: null, failed: false }, false).loading).toBe(true);
    expect(safetyState('THA', { data: null, failed: true }, false)).toMatchObject({
      badge: null,
      failed: true,
    });
    expect(safetyState('THA', { data: data(), failed: false }, false).badge).toBeNull();
  });

  it('the badge is on the tile and in its label', async () => {
    await tiles('THA', safetyState('THA', { data: data({ from: 'device' }), failed: false }, true));
    expect(
      screen.getByTestId('card-tile-badge-stale', { includeHiddenElements: true }),
    ).toBeTruthy();
    expect(screen.getByTestId('card-tile-safety').props.accessibilityLabel).toBe(
      `${t('card.tile.safetyA11y')}, ${t('common.maybeStale')}`,
    );
  });

  it('currency: stale after 3 days, with the date in its label', async () => {
    mockDestination.state = {
      data: data({ rates: new Map([['THB', rate({ fetchedAt: daysAgo(4) })]]) }),
      failed: false,
    };
    await tiles('THA');
    const money = screen.getByTestId('card-tile-money');
    expect(money.props.accessibilityLabel).toMatch(/עודכן ב-/);
    expect(money.props.accessibilityLabel).toMatch(/ייתכן שלא מעודכן$/);
  });

  it('currency: offline with no saved rate', async () => {
    mockDestination.state = { data: null, failed: true };
    jest.mocked(NetInfo.addEventListener).mockImplementation((listener) => {
      (listener as (s: { isConnected: boolean }) => void)({ isConnected: false });
      return jest.fn();
    });
    await tiles('THA');
    expect(
      screen.getByTestId('card-tile-badge-offline', { includeHiddenElements: true }),
    ).toBeTruthy();
    expect(screen.getByTestId('card-tile-money').props.accessibilityLabel).toBe(
      `מטבע: בהט תאילנדי. ${t('rate.firstOffline')}`,
    );
  });
});

describe('the entry line (AC-1, fix 4.2)', () => {
  const line = (over: Partial<Advisory> | undefined, adm0 = 'THA', onOpen = jest.fn()) =>
    render(
      <CardEntryLine
        country={countryByAdm0(adm0)!}
        advisory={over === undefined ? undefined : advisory(over)}
        colorScheme="light"
        onOpen={onOpen}
      />,
    );

  it('only banned or restricted, and it opens the sheet', async () => {
    const onOpen = jest.fn();
    await line({ entryStatus: 'restricted' }, 'THA', onOpen);
    const row = screen.getByTestId('card-entry-line');
    expect(row.props.accessibilityLabel).toBe(t('entry.restrictedA11y'));
    expect(screen.getByTestId('card-entry-tag', { includeHiddenElements: true })).toBeTruthy();
    await fireEvent.press(row);
    expect(onOpen).toHaveBeenCalled();
    await screen.unmount();
    await line({ entryStatus: 'banned' });
    expect(screen.getByTestId('card-entry-line').props.accessibilityLabel).toBe(
      t('entry.bannedA11y'),
    );
  });

  it('hidden when allowed, unknown, still loading (no advisory) or in Israel', async () => {
    for (const [over, adm0] of [
      [{ entryStatus: 'allowed' }, 'THA'],
      [{ entryStatus: null }, 'THA'],
      [undefined, 'THA'],
      [{ entryStatus: 'banned' }, 'ISR'],
    ] as const) {
      await line(over, adm0);
      expect(screen.queryByTestId('card-entry-line')).toBeNull();
      await screen.unmount();
    }
  });

  it('never a threat level beside it', async () => {
    await line({ entryStatus: 'restricted', nscLevel: 4, nscLevels: [4] });
    expect(screen.queryByTestId('advisory-bar-4', { includeHiddenElements: true })).toBeNull();
    expect(screen.getByTestId('card-entry-line').props.accessibilityLabel).not.toMatch(/רמה/);
  });
});

describe('focus comes back to what opened the sheet (fix 6, AC-1)', () => {
  const card = () =>
    render(
      <BoardingPassCard
        country={countryByAdm0('THA')!}
        colorScheme="light"
        reduceMotion
        bottomInset={0}
        onClose={jest.fn()}
      />,
    );

  const focused = () => {
    const focus = jest
      .spyOn(AccessibilityInfo, 'sendAccessibilityEvent')
      .mockImplementation(() => {});
    return () => {
      const [node, event] = focus.mock.calls.at(-1) ?? [];
      return event === 'focus'
        ? (node as unknown as { props?: { testID?: string } }).props?.testID
        : undefined;
    };
  };
  afterEach(() => jest.restoreAllMocks());

  beforeEach(() => {
    mockDestination.state = {
      data: data({ advisories: new Map([['THA', advisory({ entryStatus: 'restricted' })]]) }),
      failed: false,
    };
  });

  it('the entry line or the Safety tile, whichever opened the sheet', async () => {
    const last = focused();
    await card();
    await fireEvent.press(screen.getByTestId('card-entry-line'));
    await fireEvent.press(screen.getByTestId('travel-info-sheet-close'));
    expect(last()).toBe('card-entry-line');
    await fireEvent.press(screen.getByTestId('card-tile-safety'));
    await fireEvent.press(screen.getByTestId('travel-info-sheet-close'));
    expect(last()).toBe('card-tile-safety');
  });

  it('a tile, when it opened its own sheet', async () => {
    const last = focused();
    await card();
    await fireEvent.press(screen.getByTestId('card-tile-time'));
    await fireEvent.press(screen.getByTestId('time-sheet-close'));
    expect(last()).toBe('card-tile-time');
  });
});
