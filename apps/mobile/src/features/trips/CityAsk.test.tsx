// Sprint 11 AC-4 (design 2.5.2, D19): "באיזו עיר תהיו?" before save_trip —
// one call with the picked city, skipping saves without one, closing saves
// nothing, never on an edit, asked once per trip.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import '@/i18n';
import { countryByAdm0 } from '@/features/globe/countryData';

import { TripForm } from './TripForm';
import { saveTrip, type Trip } from './tripsApi';

const mockRecheck = jest.fn(async () => {});
jest.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    recheckConsent: mockRecheck,
    state: { status: 'signedIn', user: { id: 'u1' } },
  }),
}));
jest.mock('@/features/kit/insuranceReminder', () => ({
  syncInsuranceReminder: jest.fn(async () => {}),
  cancelInsuranceReminder: jest.fn(async () => {}),
}));
jest.mock('./tripsApi', () => ({
  saveTrip: jest.fn(async () => 'ok'),
  deleteTrip: jest.fn(async () => 'ok'),
}));
jest.mock('./citiesData', () => ({
  cityAreas: async () =>
    new Map([
      [
        'GRC',
        [
          [264371, 'אתונה', 'Athens', '', 664046],
          [734077, 'סלוניקי', 'Thessaloniki', '', 354290],
        ],
      ],
    ]),
  cityIndex: async () => [],
  cityPoint: () => null,
}));
const mockDates: Date[] = [];
jest.mock('@react-native-community/datetimepicker', () => ({
  DateTimePickerAndroid: {
    open: jest.fn(({ onValueChange }: { onValueChange: (e: unknown, d: Date) => void }) => {
      const next = mockDates.shift();
      if (next) onValueChange({ type: 'set' }, next);
    }),
    dismiss: jest.fn(),
  },
}));

const greece = countryByAdm0('GRC')!;
const existing: Trip = {
  id: 'trip-edit',
  countryAdm0: 'GRC',
  title: 'יוון',
  startDate: '2027-03-10',
  endDate: '2027-03-14',
  notes: null,
  travelers: [],
  cities: [],
};

const open = async (
  target: React.ComponentProps<typeof TripForm>['target'] = { kind: 'new', country: greece },
) => {
  await render(
    <TripForm
      target={target}
      colorScheme="light"
      reduceMotion
      insetsTop={0}
      insetsBottom={0}
      onClose={jest.fn()}
      onDone={jest.fn()}
      onGone={jest.fn()}
    />,
  );
};
const fillDates = async () => {
  mockDates.push(new Date(2027, 2, 10), new Date(2027, 2, 14));
  await fireEvent.press(screen.getByTestId('trip-form-start'));
  await waitFor(() => expect(jest.mocked(DateTimePickerAndroid.open)).toHaveBeenCalledTimes(2), {
    timeout: 5000,
  });
};

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.mocked(saveTrip).mockClear();
  jest.mocked(saveTrip).mockResolvedValue('ok');
  jest.mocked(DateTimePickerAndroid.open).mockClear();
  mockDates.length = 0;
});
jest.setTimeout(20000);

describe('the city question (design 2.5.2)', () => {
  it('asks before saving; a city saves once, with it', async () => {
    await open();
    await fillDates();
    await fireEvent.press(screen.getByTestId('trip-form-save'));
    expect(await screen.findByTestId('city-ask')).toBeOnTheScreen();
    expect(saveTrip).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('city-ask-264371'));
    await waitFor(() => expect(saveTrip).toHaveBeenCalledTimes(1));
    expect(jest.mocked(saveTrip).mock.calls[0]![1].cities).toEqual([
      { geonameId: 264371, name: 'אתונה' },
    ]);
  });

  it('skipping saves without a city, and the question is not asked again for this trip', async () => {
    await open();
    await fillDates();
    await fireEvent.press(screen.getByTestId('trip-form-save'));
    await fireEvent.press(await screen.findByTestId('city-ask-skip'));
    await waitFor(() => expect(saveTrip).toHaveBeenCalledTimes(1));
    expect(jest.mocked(saveTrip).mock.calls[0]![1].cities).toEqual([]);
    const keys = await AsyncStorage.getAllKeys();
    expect(keys.some((k) => k.startsWith('tripForm.askedCity.'))).toBe(true);
  });

  it('closing goes back to the form without saving', async () => {
    await open();
    await fillDates();
    await fireEvent.press(screen.getByTestId('trip-form-save'));
    await fireEvent.press(await screen.findByTestId('city-ask-close'));
    expect(saveTrip).not.toHaveBeenCalled();
    expect(screen.queryByTestId('city-ask')).toBeNull();
  });

  it('never on an edit', async () => {
    await open({ kind: 'edit', country: greece, trip: existing });
    await fireEvent.press(screen.getByTestId('trip-form-save'));
    await waitFor(() => expect(saveTrip).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('city-ask')).toBeNull();
  });
});
