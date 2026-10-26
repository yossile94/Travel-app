import '@/i18n';

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { CardSources } from '@/features/destination/CardDestination';

import { CardTemperature } from './CardTemperature';
import { parseClimate, type ClimateState } from './climateData';
import { TripTemperature } from './TripTemperature';

declare const __dirname: string;
const { readFileSync } = jest.requireActual<{
  readFileSync(path: string, encoding: 'utf8'): string;
}>('fs');
const climate = parseClimate(readFileSync(`${__dirname}/../../../assets/data/climate.dat`, 'utf8'));

let mockState: ClimateState = { status: 'ready', climate };
jest.mock('./climateData', () => ({
  ...jest.requireActual('./climateData'),
  useClimate: () => mockState,
}));

const LRI = String.fromCodePoint(0x2066);
const PDI = String.fromCodePoint(0x2069);
const MINUS = String.fromCodePoint(0x2212);
const strip = (s: string) => s.replace(new RegExp(`[${LRI}${PDI}]`, 'g'), '');
const card = (adm0: string, today = '2026-10-26') => (
  <CardTemperature adm0={adm0} colorScheme="light" today={today} />
);

beforeEach(() => {
  jest.useFakeTimers({ now: new Date(2026, 9, 26, 12, 0) });
  mockState = { status: 'ready', climate };
});
afterEach(() => jest.useRealTimers());

describe('the country card temperature (sprint 3 AC-10, AC-13)', () => {
  it("shows this month's daily average at the area's city, read as one group", async () => {
    await render(card('THA'));
    expect(screen.getByText('ממוצע יומי באוקטובר')).toBeOnTheScreen();
    expect(strip(screen.getByTestId('card-temp-value').props.children as string)).toMatch(/^\d+°$/);
    expect(screen.getByTestId('card-temp-city').props.children).toBe('בנגקוק');
    const group = screen.getByLabelText(/^ממוצע יומי באוקטובר: \d+ מעלות, בנגקוק$/);
    expect(group).toBeOnTheScreen();
  });

  it('a negative value keeps its minus sign, in an isolate', async () => {
    await render(card('RUS', '2026-01-10'));
    expect(screen.getByText('ממוצע יומי בינואר')).toBeOnTheScreen();
    const value = screen.getByTestId('card-temp-value').props.children as string;
    expect(value.startsWith(`${LRI}${MINUS}`)).toBe(true);
    expect(value.endsWith(`°${PDI}`)).toBe(true);
  });

  it('is hidden where there is no value', async () => {
    await render(card('ATA'));
    expect(screen.queryByTestId('card-temp')).toBeNull();
  });

  it('is hidden when the file failed, and shows a skeleton only after 150 ms', async () => {
    mockState = { status: 'failed' };
    const { rerender } = await render(card('THA'));
    expect(screen.queryByTestId('card-temp')).toBeNull();
    mockState = { status: 'loading', showSkeleton: false };
    await rerender(card('THA'));
    expect(screen.queryByTestId('card-temp-skeleton')).toBeNull();
    mockState = { status: 'loading', showSkeleton: true };
    await rerender(card('THA'));
    // Hidden from the screen reader: nothing is read until the value is there.
    expect(
      screen.getByTestId('card-temp-skeleton', { includeHiddenElements: true }),
    ).toBeOnTheScreen();
  });

  it('"Sources" opens the credits word for word, with the licences as links', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await render(<CardSources colorScheme="light" reduceMotion insetsBottom={0} />);
    await fireEvent.press(screen.getByTestId('card-sources'));
    await act(async () => jest.advanceTimersByTime(500));
    expect(screen.getByTestId('sources-cities')).toHaveTextContent(
      'נתוני ערים: GeoNames (geonames.org), רישיון CC BY 4.0, עובדו.',
    );
    expect(screen.getByTestId('sources-climate')).toHaveTextContent(
      'נתוני אקלים: CRU TS v4.08, Climatic Research Unit, University of East Anglia (Harris, Jones, Osborn), דרך CEDA, רישיון Open Government Licence v3.0. הממוצעים לשנים 1991–2020 חושבו על ידינו.',
    );
    await fireEvent.press(screen.getByText('Open Government Licence v3.0'));
    expect(open).toHaveBeenCalledWith(
      'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/',
    );
  });
});

describe('the trip row temperature (sprint 3 AC-11)', () => {
  const row = (
    startDate: string,
    endDate: string,
    cities = [] as { geonameId: number | null; name: string }[],
  ) => (
    <TripTemperature
      countryAdm0="THA"
      startDate={startDate}
      endDate={endDate}
      cities={cities}
      colorScheme="light"
    />
  );

  it('one month: the value, at the first city with a value', async () => {
    await render(
      row('2026-11-01', '2026-11-05', [
        { geonameId: null, name: 'כפר הדייגים' },
        { geonameId: 1153671, name: "צ'יאנג מאי" },
      ]),
    );
    expect(screen.getByText('ממוצע יומי בנובמבר')).toBeOnTheScreen();
    // In its own isolate (Raz, T6).
    expect(
      screen.getByText(`${String.fromCodePoint(0x2068)}צ'יאנג מאי${String.fromCodePoint(0x2069)}`),
    ).toBeOnTheScreen();
  });

  it("two or three months: a column each, in time order, at the area's city", async () => {
    await render(row('2026-12-20', '2027-01-05'));
    expect(screen.getByText('ממוצע יומי')).toBeOnTheScreen();
    expect(screen.getByText('דצמבר')).toBeOnTheScreen();
    expect(screen.getByText('ינואר')).toBeOnTheScreen();
    expect(screen.getByText('בנגקוק')).toBeOnTheScreen();
    expect(screen.getByTestId('trip-temp').props.accessibilityLabel).toMatch(
      /^ממוצע יומי: דצמבר \d+ מעלות, ינואר \d+ מעלות, בנגקוק$/,
    );
  });

  it('four months or more: the range', async () => {
    await render(row('2026-01-10', '2026-05-02'));
    expect(screen.getByText('ממוצע יומי בחודשי הנסיעה')).toBeOnTheScreen();
    expect(screen.getByTestId('trip-temp').props.accessibilityLabel).toMatch(
      /בין \d+ מעלות ובין \d+ מעלות/,
    );
  });

  it('nothing while the file loads', async () => {
    mockState = { status: 'loading', showSkeleton: true };
    await render(row('2026-11-01', '2026-11-05'));
    expect(screen.queryByTestId('trip-temp')).toBeNull();
  });
});
