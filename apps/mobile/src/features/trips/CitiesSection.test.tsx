import '@/i18n';

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';

import type { CountryInfo } from '@/features/globe/countryData';

import { CitiesSection } from './CitiesSection';
import type { CityRow } from './citySearch';
import type { TripCity } from './tripsApi';

const mockRows: CityRow[] = [
  [1609350, 'בנגקוק', 'Bangkok', '', 5104476],
  [1153671, "צ'יאנג מאי", 'Chiang Mai', '', 200952],
];
jest.mock('./citiesData', () => ({
  cityIndex: jest.fn(async () => {
    const search = jest.requireActual<typeof import('./citySearch')>('./citySearch');
    return search.indexCities(mockRows.map(search.entryOf));
  }),
}));

const thailand = { adm0: 'THA', nameHe: 'תאילנד', nameEn: 'Thailand' } as CountryInfo;

function Harness({ initial = [] as TripCity[] }) {
  const [cities, setCities] = useState(initial);
  return (
    <CitiesSection
      country={thailand}
      cities={cities}
      onChange={setCities}
      disabled={false}
      colorScheme="light"
      reduceMotion
      insetsTop={0}
      insetsBottom={0}
    />
  );
}

describe('CitiesSection (sprint 3 AC-4, AC-5)', () => {
  it('adds from the largest cities, the same one twice, and one typed as written', async () => {
    await render(<Harness />);
    await fireEvent.press(screen.getByTestId('city-add'));
    await act(async () => {});
    expect(screen.getByText('ערים גדולות')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('city-result-1609350'));
    expect(screen.getByLabelText('עיר 1 מתוך 1: בנגקוק')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('city-add'));
    await act(async () => {});
    await fireEvent.press(screen.getByTestId('city-result-1609350'));
    expect(screen.getByLabelText('עיר 2 מתוך 2: בנגקוק')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('city-add'));
    await act(async () => {});
    await fireEvent.changeText(screen.getByTestId('city-search-field'), 'קו טאו');
    expect(screen.getByText('לא מצאנו את „קו טאו” ברשימת הערים של תאילנד.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('city-as-written'));
    expect(screen.getByLabelText('עיר 3 מתוך 3: קו טאו, כמו שנכתב')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('city-remove-0'));
    expect(screen.getByLabelText('עיר 1 מתוך 2: בנגקוק')).toBeTruthy();
  }, 15000);

  it('offers no "as written" when the name is in the list', async () => {
    await render(<Harness />);
    await fireEvent.press(screen.getByTestId('city-add'));
    await act(async () => {});
    await fireEvent.changeText(screen.getByTestId('city-search-field'), 'bangkok');
    expect(screen.getByTestId('city-result-1609350')).toBeTruthy();
    expect(screen.queryByTestId('city-as-written')).toBeNull();
  });

  it('stops at 10 cities with an explanation', async () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({ geonameId: i + 1, name: 'עיר ' + i }));
    await render(<Harness initial={ten} />);
    expect(screen.queryByTestId('city-add')).toBeNull();
    expect(screen.getByText('אפשר להוסיף עד 10 ערים.')).toBeTruthy();
  });
});
