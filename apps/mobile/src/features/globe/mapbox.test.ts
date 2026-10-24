const mockMapbox = { setAccessToken: jest.fn(async () => null), setTelemetryEnabled: jest.fn() };
jest.mock('@rnmapbox/maps', () => ({ __esModule: true, default: mockMapbox }));

describe('Mapbox setup', () => {
  const original = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
  afterEach(() => {
    process.env.EXPO_PUBLIC_MAPBOX_TOKEN = original;
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('sets the public token and turns usage telemetry off (sprint 1 AC-14)', () => {
    process.env.EXPO_PUBLIC_MAPBOX_TOKEN = 'pk.test-only';
    jest.isolateModules(() => {
      // The module reads the token when it loads, so each case loads it fresh.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { hasMapboxToken } = require('./mapbox') as typeof import('./mapbox');
      expect(hasMapboxToken).toBe(true);
    });
    expect(mockMapbox.setAccessToken).toHaveBeenCalledWith('pk.test-only');
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
