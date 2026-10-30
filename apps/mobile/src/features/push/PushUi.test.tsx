import '@/i18n';

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { I18nManager, Linking, StyleSheet } from 'react-native';

import { FlightAlertsRow } from './FlightAlertsRow';
import { PushExplainer, sampleNumber } from './PushExplainer';
import * as push from './push';

jest.mock('@/lib/supabase', () => ({ supabase: null }));
jest.mock('./push', () => ({
  ...jest.requireActual('./push'),
  flightAlertsOn: jest.fn(),
  permissionState: jest.fn(),
  channelEnabled: jest.fn(async () => true),
  tokenRegistered: jest.fn(async () => true),
  consentPending: jest.fn(async () => false),
  explainerState: jest.fn(async () => ({ shown: 1, allowed: true })),
  setFlightAlerts: jest.fn(async () => true),
  registerDevice: jest.fn(async () => true),
  allowPush: jest.fn(async () => 'on'),
}));

const m = push as jest.Mocked<typeof push>;
const base = { colorScheme: 'light' as const, reduceMotion: true, insetsBottom: 0 };

describe('PushExplainer (design 2)', () => {
  beforeAll(async () => {
    // The first render pays for transforming the sheet on a cold run.
    await render(
      <PushExplainer
        {...base}
        visible
        number="LY81"
        androidNote={false}
        onAllow={async () => {}}
        onLater={() => {}}
      />,
    );
  }, 15000);

  it('shows the example, the privacy line and the Android note', async () => {
    await render(
      <PushExplainer
        {...base}
        visible
        number="6H12"
        androidNote
        onAllow={async () => {}}
        onLater={() => {}}
      />,
    );
    expect(screen.getByTestId('push-explainer-preview').props.accessibilityLabel).toContain('6H12');
    expect(screen.getByTestId('push-explainer-privacy')).toBeTruthy();
    expect(screen.getByTestId('push-explainer-android-note')).toBeTruthy();
  });

  it('"allow" asks once, "not now" closes', async () => {
    const onAllow = jest.fn(() => new Promise<void>(() => {}));
    const onLater = jest.fn();
    await render(
      <PushExplainer
        {...base}
        visible
        number="LY81"
        androidNote={false}
        onAllow={onAllow}
        onLater={onLater}
      />,
    );
    expect(screen.queryByTestId('push-explainer-android-note')).toBeNull();
    await fireEvent.press(screen.getByTestId('push-explainer-allow'));
    await fireEvent.press(screen.getByTestId('push-explainer-allow'));
    expect(onAllow).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('push-explainer-later'));
    expect(onLater).not.toHaveBeenCalled(); // busy: the answer comes first
  });

  it("the example never uses the user's own number", () => {
    expect(sampleNumber(() => false)).toBe('LY81');
    expect(sampleNumber((n) => n === 'LY81')).toBe('6H12');
  });
});

describe('FlightAlertsRow (design 6)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    m.flightAlertsOn.mockResolvedValue(false);
    m.permissionState.mockResolvedValue('granted');
  });

  const shown = async () => {
    await render(<FlightAlertsRow userId="u" visible colorScheme="light" />);
    await act(async () => {});
    return screen.getByTestId('account-flight-alerts');
  };

  it('off → on: the switch, then this device', async () => {
    const row = await shown();
    expect(row.props.accessibilityValue).toEqual({ text: 'off' });
    m.flightAlertsOn.mockResolvedValue(true);
    await fireEvent.press(row);
    expect(m.setFlightAlerts).toHaveBeenCalledWith('u', true);
    expect(m.registerDevice).toHaveBeenCalled();
    expect(screen.getByTestId('account-flight-alerts').props.accessibilityValue).toEqual({
      text: 'on',
    });
  });

  it('a failed save puts the switch back and says so', async () => {
    m.setFlightAlerts.mockResolvedValueOnce(false);
    await fireEvent.press(await shown());
    expect(screen.getByTestId('account-flight-alerts').props.accessibilityValue).toEqual({
      text: 'off',
    });
    expect(screen.getByTestId('account-flight-alerts-notice')).toBeTruthy();
  });

  it('blocked: a tap opens the settings, the server is left alone', async () => {
    m.permissionState.mockResolvedValue('denied');
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    const row = await shown();
    expect(row.props.accessibilityValue).toEqual({ text: 'blocked' });
    await fireEvent.press(row);
    expect(open).toHaveBeenCalled();
    expect(m.setFlightAlerts).not.toHaveBeenCalled();
  });

  describe('the switch drawn by the app (sprint 12 P-3)', () => {
    const drawn = () =>
      screen.getByTestId('account-flight-alerts-switch', { includeHiddenElements: true });
    const opacity = () => StyleSheet.flatten(drawn().props.style).opacity;

    it('shows the state, takes no touches and is hidden from the screen reader', async () => {
      await shown();
      expect(drawn().props.accessibilityValue).toEqual({ text: 'off' });
      expect(drawn().props.pointerEvents).toBe('none');
      expect(drawn().props.importantForAccessibility).toBe('no-hide-descendants');
      expect(opacity()).toBe(1);
      m.flightAlertsOn.mockResolvedValue(true);
      await fireEvent.press(screen.getByTestId('account-flight-alerts'));
      expect(drawn().props.accessibilityValue).toEqual({ text: 'on' });
    });

    it('loading: 0.38 (John)', async () => {
      m.flightAlertsOn.mockReturnValue(new Promise(() => {}));
      await render(<FlightAlertsRow userId="u" visible colorScheme="light" />);
      expect(opacity()).toBe(0.38);
    });

    it.each([
      [false, 16],
      [true, -16],
    ])('RTL %s: on moves the thumb %d to the end, and it grows to 24 (Raz 9)', async (rtl, x) => {
      jest.replaceProperty(I18nManager, 'isRTL', rtl);
      m.flightAlertsOn.mockResolvedValue(true);
      await shown();
      const thumb = StyleSheet.flatten(drawn().props.children[1].props.style);
      expect(thumb.transform).toEqual([{ translateX: x }]);
      expect([thumb.width, thumb.height]).toEqual([24, 24]);
    });

    it('off: the small thumb at the start', async () => {
      await shown();
      const thumb = StyleSheet.flatten(drawn().props.children[1].props.style);
      expect(thumb.transform).toEqual([{ translateX: 0 }]);
      expect([thumb.width, thumb.height]).toEqual([16, 16]);
    });

    it('blocked: 0.5', async () => {
      m.permissionState.mockResolvedValue('denied');
      await shown();
      expect(opacity()).toBe(0.5);
    });
  });

  it('never asked: the system prompt straight away', async () => {
    m.explainerState.mockResolvedValue({ shown: 0, allowed: false });
    m.permissionState.mockResolvedValue('undetermined');
    const row = await shown();
    expect(row.props.accessibilityValue).toEqual({ text: 'never_asked' });
    await fireEvent.press(row);
    expect(m.allowPush).toHaveBeenCalledWith('u', 'he', expect.any(Object));
  });
});
