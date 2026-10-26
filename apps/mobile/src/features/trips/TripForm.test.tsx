import '@/i18n';

import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { countryByAdm0 } from '@/features/globe/countryData';

import { TripForm } from './TripForm';
import { saveTrip, type Trip } from './tripsApi';

const mockRecheck = jest.fn(async () => true);
// The full suite runs files in parallel; this form's save chain can be slow there (QA S4 #1).
jest.setTimeout(15_000);

jest.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    state: { status: 'signedIn', user: { id: 'u1' } },
    recheckConsent: mockRecheck,
  }),
}));
jest.mock('./tripsApi', () => ({
  saveTrip: jest.fn(async () => 'ok'),
  deleteTrip: jest.fn(async () => 'ok'),
}));
/** Each picker answers with the next date in the queue (local midnight). */
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
const source: Trip = {
  id: 'source-trip',
  countryAdm0: 'GRC',
  title: 'יוון אוקטובר 2026',
  startDate: '2026-10-20',
  endDate: '2026-10-30',
  notes: 'מלון בפלאקה',
  travelers: [{ name: 'דנה', relation: 'partner' }],
  cities: [{ geonameId: 264371, name: 'אתונה' }],
};

const form = (onClose = jest.fn(), onDone = jest.fn()) => (
  <TripForm
    target={{ kind: 'duplicate', country: greece, source }}
    colorScheme="light"
    reduceMotion
    insetsTop={0}
    insetsBottom={0}
    onClose={onClose}
    onDone={onDone}
    onGone={jest.fn()}
  />
);

beforeEach(() => {
  jest.mocked(saveTrip).mockClear();
  jest.mocked(saveTrip).mockResolvedValue('ok');
  mockRecheck.mockClear();
  mockDates.length = 0;
});

describe('TripForm, duplicate (sprint 3 AC-9)', () => {
  it('copies the details without the dates, and says it is a copy', async () => {
    await render(form());
    expect(screen.getByTestId('trip-form-duplicated')).toBeOnTheScreen();
    expect(screen.getByText('דנה')).toBeOnTheScreen();
    expect(screen.getByDisplayValue('מלון בפלאקה')).toBeOnTheScreen();
    // An automatic name waits for the new departure date.
    expect(screen.queryByDisplayValue('יוון אוקטובר 2026')).toBeNull();
  });

  it('closes untouched without asking to discard', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    const onClose = jest.fn();
    await render(form(onClose));
    await fireEvent.press(screen.getByTestId('trip-form-close'));
    expect(onClose).toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });

  it('saves as a new trip with a new id, named from the new date', async () => {
    const onDone = jest.fn();
    await render(form(jest.fn(), onDone));
    mockDates.push(new Date(2027, 2, 10), new Date(2027, 2, 14));
    await fireEvent.press(screen.getByTestId('trip-form-start'));
    await act(async () => {
      await Promise.resolve();
    });
    if (mockDates.length) await fireEvent.press(screen.getByTestId('trip-form-end'));
    await fireEvent.press(screen.getByTestId('trip-form-save'));
    expect(saveTrip).toHaveBeenCalledTimes(1);
    const [mode, trip] = jest.mocked(saveTrip).mock.calls[0]!;
    expect(mode).toBe('create');
    expect(trip.id).not.toBe(source.id);
    expect(trip.startDate).toBe('2027-03-10');
    expect(trip.title).toContain('2027');
    expect(trip.travelers).toEqual(source.travelers);
    expect(trip.cities).toEqual(source.cities);
    expect(onDone).toHaveBeenCalledWith({ kind: 'created', trip });
  });

  it('a consent refusal keeps the form and asks for consent again', async () => {
    jest.mocked(saveTrip).mockResolvedValue('consent');
    const onDone = jest.fn();
    await render(form(jest.fn(), onDone));
    mockDates.push(new Date(2027, 2, 10), new Date(2027, 2, 14));
    await fireEvent.press(screen.getByTestId('trip-form-start'));
    // The return picker opens by itself after the departure: let it run first (QA F-1).
    await act(async () => {
      await Promise.resolve();
    });
    if (mockDates.length) await fireEvent.press(screen.getByTestId('trip-form-end'));
    await waitFor(() => expect(mockDates).toHaveLength(0));
    await fireEvent.press(screen.getByTestId('trip-form-save'));
    // The save, the consent recheck and the notice are async: wait, don't race (QA F-1).
    // Under a full parallel run the form's async steps can take seconds: one
    // wait for the last step (the notice), inside the file's longer test
    // timeout, instead of three waits that together outlast the default 5 s.
    await waitFor(() => expect(screen.getByTestId('trip-form-notice')).toBeOnTheScreen(), {
      timeout: 10_000,
    });
    expect(saveTrip).toHaveBeenCalled();
    expect(mockRecheck).toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(DateTimePickerAndroid.open).toHaveBeenCalled();
  });
});
