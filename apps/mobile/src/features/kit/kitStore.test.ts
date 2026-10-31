// Sprint 13 AC-8 (Raz re-review 1): what a kit refresh answers, and the
// device-copy flag after a failed read.
import { refreshTripKit, refreshTripKitNow, resetKitStore, tripKitNow } from './kitStore';

type Answer =
  | { ok: true; value: { hotels: unknown[]; insurance: unknown[] } }
  | {
      ok: false;
      reason: 'offline' | 'error';
    };
const mockAnswers: Answer[] = [];
const mockCalls: { resolve: () => void }[] = [];
const mockHold = { on: false };
jest.mock('./kitApi', () => ({
  loadKit: jest.fn(async () => {
    if (mockHold.on) await new Promise<void>((resolve) => mockCalls.push({ resolve }));
    return mockAnswers.shift() ?? { ok: true, value: { hotels: [], insurance: [] } };
  }),
}));
jest.mock('@/lib/supabase', () => ({ supabase: null }));
const kitApi = jest.requireMock<{ loadKit: jest.Mock }>('./kitApi');

const hotel = { id: 'h1', tripId: 't1', name: 'Amari' };

beforeEach(() => {
  resetKitStore();
  mockAnswers.length = 0;
  mockCalls.length = 0;
  mockHold.on = false;
  kitApi.loadKit.mockClear();
});

it('a read from the server answers true and is not the device copy', async () => {
  mockAnswers.push({ ok: true, value: { hotels: [hotel], insurance: [] } });
  expect(await refreshTripKit('t1')).toBe(true);
  expect(tripKitNow('t1')).toMatchObject({ fromCache: false, hotels: [hotel] });
});

it('a failed read answers false and keeps the device-copy flag', async () => {
  mockAnswers.push({ ok: true, value: { hotels: [hotel], insurance: [] } });
  await refreshTripKit('t1');
  mockAnswers.push({ ok: false, reason: 'offline' });
  expect(await refreshTripKit('t1')).toBe(false);
  expect(tripKitNow('t1')?.fromCache).toBe(true);
  // Back online but the server fails: still the device copy, not fresh data.
  mockAnswers.push({ ok: false, reason: 'error' });
  expect(await refreshTripKit('t1')).toBe(false);
  expect(tripKitNow('t1')).toMatchObject({ fromCache: true, hotels: [hotel] });
});

it('refreshTripKitNow waits for a read already running, then reads again', async () => {
  mockHold.on = true;
  const running = refreshTripKit('t1');
  await Promise.resolve();
  const now = refreshTripKitNow('t1');
  expect(kitApi.loadKit).toHaveBeenCalledTimes(1);
  mockHold.on = false;
  mockCalls.shift()!.resolve();
  await running;
  expect(await now).toBe(true);
  expect(kitApi.loadKit).toHaveBeenCalledTimes(2);
});
