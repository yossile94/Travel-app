import '@/i18n';

import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';

import { TravelersSection } from './TravelersSection';
import type { TripTraveler } from './tripsApi';

function Harness({ initial = [] as TripTraveler[] }) {
  const [travelers, setTravelers] = useState(initial);
  return (
    <TravelersSection
      travelers={travelers}
      onChange={setTravelers}
      disabled={false}
      colorScheme="light"
      reduceMotion
      insetsBottom={0}
    />
  );
}

describe('TravelersSection (sprint 3 AC-1)', () => {
  it('shows "me" always, adds a traveler with a relation, and removes one', async () => {
    await render(<Harness />);
    expect(screen.getByText('אני')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('traveler-add'));
    await fireEvent.press(screen.getByTestId('traveler-save'));
    expect(screen.getByText('צריך לכתוב שם.')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('traveler-name'), '  דנה  ');
    await fireEvent.press(screen.getByTestId('traveler-rel-partner'));
    await fireEvent.press(screen.getByTestId('traveler-save'));
    expect(screen.getByText('דנה')).toBeTruthy();
    expect(screen.getByText('בן או בת זוג')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('traveler-remove-0'));
    expect(screen.queryByText('דנה')).toBeNull();
  }, 15000);

  it('tapping the chosen relation again clears it (design 6.2)', async () => {
    await render(<Harness />);
    await fireEvent.press(screen.getByTestId('traveler-add'));
    await fireEvent.changeText(screen.getByTestId('traveler-name'), 'נועם');
    await fireEvent.press(screen.getByTestId('traveler-rel-child'));
    await fireEvent.press(screen.getByTestId('traveler-rel-child'));
    await fireEvent.press(screen.getByTestId('traveler-save'));
    expect(screen.getByText('נועם')).toBeTruthy();
    expect(screen.queryByText('ילד או ילדה')).toBeNull();
  });

  it('stops at 9 with an explanation, not a locked button', async () => {
    const nine = Array.from({ length: 9 }, (_, i) => ({ name: 'נוסע ' + i, relation: null }));
    await render(<Harness initial={nine} />);
    expect(screen.queryByTestId('traveler-add')).toBeNull();
    expect(screen.getByText('אפשר להוסיף עד 9 נוסעים.')).toBeTruthy();
  });
});
