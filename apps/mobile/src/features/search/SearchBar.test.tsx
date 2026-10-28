import '@/i18n';

import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { SearchBar } from './SearchBar';

const mockCities = jest.fn();
jest.mock('../trips/citiesData', () => ({
  searchAllCities: (query: string, limit: number) => mockCities(query, limit),
  globalCityIndex: () => Promise.resolve(),
}));

const bar = (onSelect = jest.fn()) => (
  <SearchBar
    open
    colorScheme="light"
    reduceMotion
    insetsTop={0}
    insetsBottom={0}
    onOpen={jest.fn()}
    onClose={jest.fn()}
    onSelect={onSelect}
  />
);

beforeEach(() => mockCities.mockReset());

describe('cities in the main search (sprint 4 F-014)', () => {
  it('lists countries first, then cities that lead to their country', async () => {
    mockCities.mockResolvedValue([
      {
        id: 1609350,
        nameHe: 'בנגקוק',
        nameEn: 'Bangkok',
        ascii: 'Bangkok',
        population: 5e6,
        adm0: 'THA',
      },
    ]);
    const onSelect = jest.fn();
    await render(bar(onSelect));
    await fireEvent.changeText(screen.getByTestId('search-input'), 'בנגקוק');
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockCities).toHaveBeenCalledWith('בנגקוק', 5);
    expect(screen.getByText('בנגקוק, תאילנד')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('search-city-1609350'));
    expect(onSelect).toHaveBeenCalledWith('THA', {
      id: 1609350,
      nameHe: 'בנגקוק',
      nameEn: 'Bangkok',
    });
  });

  it('countries do not wait for the city list, and one letter does not load it', async () => {
    mockCities.mockReturnValue(new Promise(() => {}));
    await render(bar());
    await fireEvent.changeText(screen.getByTestId('search-input'), 'ת');
    expect(mockCities).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByTestId('search-input'), 'תאי');
    expect(screen.getByTestId('search-result-THA')).toBeOnTheScreen();
  });

  it('no list of cities: countries only, no error', async () => {
    mockCities.mockRejectedValue(new Error('no file'));
    await render(bar());
    await fireEvent.changeText(screen.getByTestId('search-input'), 'יוון');
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('search-result-GRC')).toBeOnTheScreen();
  });
});
