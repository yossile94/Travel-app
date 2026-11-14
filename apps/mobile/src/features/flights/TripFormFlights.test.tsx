// Sprint 15 design 6.1 (Raz 5): the trip form has no toast, so a flight saved
// without tracking leaves its reason under the list; a plain save or a delete clears it.
import i18n from '@/i18n';

import { fireEvent, render, screen } from '@testing-library/react-native';

import { TripFormFlights } from './TripFormFlights';

const mockNotice: { value: string | undefined; bookingFailed: boolean } = {
  value: 'past a cap',
  bookingFailed: false,
};
jest.mock('./flightsStore', () => ({
  useTripFlights: () => ({ flights: [], status: 'ready', fromCache: false, savedAt: null }),
  refreshTripFlights: jest.fn(async () => {}),
}));
jest.mock('./FlightScreen', () => ({
  FlightScreen: ({
    onSaved,
    onDeleted,
  }: {
    onSaved: (...a: unknown[]) => void;
    onDeleted: (id: string) => void;
  }) => {
    const { Pressable, Text, View } = jest.requireActual('react-native');
    return (
      <View>
        <Pressable
          testID="mock-save"
          onPress={() =>
            onSaved('new', 'LY81', 'out', true, mockNotice.bookingFailed, mockNotice.value)
          }
        >
          <Text>save</Text>
        </Pressable>
        <Pressable testID="mock-delete" onPress={() => onDeleted('new')}>
          <Text>delete</Text>
        </Pressable>
      </View>
    );
  },
}));

const trip = {
  id: 't1',
  title: 'תאילנד',
  countryAdm0: 'THA',
  startDate: '2026-12-20',
  endDate: '2026-12-30',
};

const show = () =>
  render(
    <TripFormFlights
      trip={trip}
      saved
      disabled={false}
      colorScheme="light"
      reduceMotion
      insetsTop={0}
      insetsBottom={0}
    />,
  );

const openScreen = async () => fireEvent.press(screen.getByTestId('trip-form-flight-add'));

it('a save past a cap shows its reason; a plain save clears it', async () => {
  await show();
  mockNotice.value = 'past a cap';
  await openScreen();
  await fireEvent.press(screen.getByTestId('mock-save'));
  expect(screen.getByTestId('trip-form-flight-untracked')).toHaveTextContent('past a cap');
  mockNotice.value = undefined;
  await openScreen();
  await fireEvent.press(screen.getByTestId('mock-save'));
  expect(screen.queryByTestId('trip-form-flight-untracked')).toBeNull();
});

// Sprint 15 QA 1, 2: FlightScreen already announced it; the notice isn't a live region too,
// and shows the failed booking answer as well.
it('the notice is not a live region and carries a failed booking answer', async () => {
  await show();
  mockNotice.value = 'past a cap';
  mockNotice.bookingFailed = true;
  await openScreen();
  await fireEvent.press(screen.getByTestId('mock-save'));
  mockNotice.bookingFailed = false;
  const notice = screen.getByTestId('trip-form-flight-untracked');
  expect(notice.props.accessibilityLiveRegion).toBe('none');
  expect(notice).toHaveTextContent(`past a cap ${i18n.t('flight.sameBookingFailed')}`);
});

it('deleting the flight clears the reason', async () => {
  await show();
  mockNotice.value = 'past a cap';
  await openScreen();
  await fireEvent.press(screen.getByTestId('mock-save'));
  await openScreen();
  await fireEvent.press(screen.getByTestId('mock-delete'));
  expect(screen.queryByTestId('trip-form-flight-untracked')).toBeNull();
});
