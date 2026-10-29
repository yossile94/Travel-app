// Sprint 11 AC-5 (design 8.2, D9; Raz design approval 6): the hotel's point —
// typed coordinates, the TalkBack moves, and what is handed back.
import { fireEvent, render, screen } from '@testing-library/react-native';

import '@/i18n';

import { MapPointPicker, parseCoordinates, pointText, roundPoint } from './MapPointPicker';

jest.mock('@rnmapbox/maps', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    MapView: ({ children }: { children: React.ReactNode }) => (
      <View testID="mock-map">{children}</View>
    ),
    Camera: React.forwardRef(() => null),
  };
});

describe('typed coordinates (the way without dragging)', () => {
  it.each([
    ['13.7563, 100.5018', [100.5018, 13.7563]],
    ['  -33.8688 151.2093 ', [151.2093, -33.8688]],
    ['13.7563,100.5018', [100.5018, 13.7563]],
  ] as const)('%s → %j', (text, expected) => {
    expect(parseCoordinates(text)).toEqual(expected);
  });
  it.each(['', 'Bangkok', '91, 10', '10, 181', '13.7563'])('%j → null', (text) => {
    expect(parseCoordinates(text)).toBeNull();
  });
  it('six decimals, latitude first', () => {
    expect(roundPoint([100.50181234, 13.75634567])).toEqual([100.501812, 13.756346]);
    expect(pointText([100.5, 13.75])).toBe('⁦13.750000, 100.500000⁩');
  });
});

describe('the picker', () => {
  const show = () => {
    const onPick = jest.fn();
    return render(
      <MapPointPicker
        start={{ point: [100.5, 13.75], zoom: 13 }}
        colorScheme="light"
        insetsTop={0}
        insetsBottom={0}
        onClose={jest.fn()}
        onPick={onPick}
      />,
    ).then(() => onPick);
  };

  it('a typed point moves the pin there; choosing hands it back, rounded', async () => {
    const onPick = await show();
    await fireEvent.changeText(screen.getByTestId('map-point-type'), '13.7465, 100.4927');
    await fireEvent(screen.getByTestId('map-point-type'), 'submitEditing');
    expect(screen.getByTestId('map-point-coords')).toHaveTextContent('13.746500, 100.492700', {
      exact: false,
    });
    await fireEvent.press(screen.getByTestId('map-point-choose'));
    expect(onPick).toHaveBeenCalledWith([100.4927, 13.7465]);
  });

  it('a wrong entry says so and keeps the point', async () => {
    await show();
    await fireEvent.changeText(screen.getByTestId('map-point-type'), 'Bangkok');
    await fireEvent(screen.getByTestId('map-point-type'), 'submitEditing');
    expect(screen.getByText(/צריך להזין קו רוחב/)).toBeOnTheScreen();
  });

  it('TalkBack moves the map north with an action', async () => {
    await show();
    const map = screen.getByTestId('map-point-map');
    expect(map.props.accessibilityActions.map((a: { name: string }) => a.name)).toEqual([
      'north',
      'south',
      'east',
      'west',
      'zoomIn',
      'zoomOut',
    ]);
    await fireEvent(map, 'accessibilityAction', { nativeEvent: { actionName: 'north' } });
    expect(map.props.accessibilityLabel).not.toContain('13.750000,');
  });
});
