// v0.14.1 (Raz 1): a flight write that hangs on a weak network ends as
// 'offline' after 15s, so the screen unlocks and keeps what was filled.
import { deleteFlight, loadFlights, saveFlight } from './flightsApi';

const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => mockRpc(...a) } }));
jest.mock('@react-native-community/netinfo', () => ({
  fetch: async () => ({ isConnected: true }),
}));

beforeEach(() => {
  jest.useFakeTimers();
  mockRpc.mockReset();
});
afterEach(() => jest.useRealTimers());

const never = () => new Promise(() => {});

it('a save that never answers is offline after 15s', async () => {
  mockRpc.mockReturnValue(never());
  const result = saveFlight('f1', 't1', {} as Parameters<typeof saveFlight>[2]);
  await jest.advanceTimersByTimeAsync(15_000);
  await expect(result).resolves.toBe('offline');
});

it('a delete that never answers is offline after 15s', async () => {
  mockRpc.mockReturnValue(never());
  const result = deleteFlight('f1');
  await jest.advanceTimersByTimeAsync(15_000);
  await expect(result).resolves.toBe('offline');
});

it('an answer in time is used as before', async () => {
  mockRpc.mockResolvedValue({ data: 'ok', error: null });
  await expect(saveFlight('f1', 't1', {} as Parameters<typeof saveFlight>[2])).resolves.toBe('ok');
  mockRpc.mockResolvedValue({ data: 'gone', error: null });
  await expect(deleteFlight('f1')).resolves.toBe('gone');
});

it('Dana 1: a read that never reached the server is offline (the device copy shows)', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockRpc.mockResolvedValue({
    data: null,
    error: { message: 'TypeError: Network request failed' },
    status: 0,
  });
  await expect(loadFlights(['t1'])).resolves.toEqual({ ok: false, reason: 'offline' });
  mockRpc.mockResolvedValue({
    data: null,
    error: { message: 'permission denied', code: '42501' },
    status: 403,
  });
  await expect(loadFlights(['t1'])).resolves.toEqual({ ok: false, reason: 'error' });
});
