const mockMapbox = { setAccessToken: jest.fn(async () => null), setTelemetryEnabled: jest.fn() };
jest.mock('@rnmapbox/maps', () => ({ __esModule: true, default: mockMapbox }));

describe('Mapbox setup', () => {
  const original = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
  afterEach(() => {
    process.env.EXPO_PUBLIC_MAPBOX_TOKEN = original;
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('sets the public token at load, but not the telemetry switch (AC-14)', () => {
    process.env.EXPO_PUBLIC_MAPBOX_TOKEN = 'pk.test-only';
    jest.isolateModules(() => {
      // The module reads the token when it loads, so each case loads it fresh.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { hasMapboxToken } = require('./mapbox') as typeof import('./mapbox');
      expect(hasMapboxToken).toBe(true);
    });
    expect(mockMapbox.setAccessToken).toHaveBeenCalledWith('pk.test-only');
    // On Android the switch builds a hidden map view: never at startup (review finding 6).
    expect(mockMapbox.setTelemetryEnabled).not.toHaveBeenCalled();
  });

  it('turns usage telemetry off once per session (AC-14)', () => {
    process.env.EXPO_PUBLIC_MAPBOX_TOKEN = 'pk.test-only';
    let turnOff: () => void = () => {};
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      ({ turnOffMapboxTelemetryOnce: turnOff } = require('./mapbox') as typeof import('./mapbox'));
    });
    turnOff();
    turnOff();
    expect(mockMapbox.setTelemetryEnabled).toHaveBeenCalledTimes(1);
    expect(mockMapbox.setTelemetryEnabled).toHaveBeenCalledWith(false);
  });

  it('refuses a secret token', () => {
    process.env.EXPO_PUBLIC_MAPBOX_TOKEN = 'sk.not-allowed';
    jest.isolateModules(() => {
      // The module reads the token when it loads, so each case loads it fresh.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { hasMapboxToken } = require('./mapbox') as typeof import('./mapbox');
      expect(hasMapboxToken).toBe(false);
    });
    expect(mockMapbox.setAccessToken).not.toHaveBeenCalled();
  });
});
