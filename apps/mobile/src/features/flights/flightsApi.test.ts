// v0.14.1 (Raz 1): a flight write that hangs on a weak network ends as
// 'offline' after 15s, so the screen unlocks and keeps what was filled.
import { deleteFlight, loadFlights, saveFlight, writeFrom } from './flightsApi';

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

// Sprint 15 AC-6: save_flight_v2's answer.
it('saves through save_flight_v2', async () => {
  mockRpc.mockResolvedValue({ data: { status: 'ok' }, error: null });
  await saveFlight('f1', 't1', {} as Parameters<typeof saveFlight>[2]);
  expect(mockRpc.mock.calls[0]![0]).toBe('save_flight_v2');
});

it('reads an untracked save with its reason and renewal', () => {
  expect(
    writeFrom({ status: 'untracked', reason: 'turnover', renews_at: '2027-01-14T08:00:00+00:00' }),
  ).toEqual({ untracked: 'turnover', renewsAt: '2027-01-14T08:00:00+00:00' });
  expect(writeFrom({ status: 'untracked', reason: 'concurrent', renews_at: null })).toEqual({
    untracked: 'concurrent',
    renewsAt: null,
  });
  expect(writeFrom({ status: 'gone' })).toBe('gone');
  expect(writeFrom({ status: 'limit' })).toBe('limit');
});

it('anything outside the contract is an error', () => {
  expect(writeFrom('ok')).toBe('error');
  expect(writeFrom({ status: 'untracked', reason: 'other' })).toBe('error');
  expect(writeFrom(null)).toBe('error');
});

it('an answer in time is used as before', async () => {
  mockRpc.mockResolvedValue({ data: { status: 'ok' }, error: null });
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
