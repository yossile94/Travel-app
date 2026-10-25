import NetInfo from '@react-native-community/netinfo';

import {
  createTrip,
  deleteTrip,
  loadTripCountries,
  loadTripPage,
  updateTrip,
  type Trip,
} from './tripsApi';

/** A query builder that records each call and answers with `mockAnswer`. */
const mockCalls: [string, ...unknown[]][] = [];
const mockAnswer = { value: { data: [] as unknown, error: null as unknown } };
function mockBuilder(): unknown {
  const builder: Record<string, unknown> = {};
  for (const name of ['select', 'gte', 'lt', 'eq', 'or', 'order', 'insert', 'update', 'delete']) {
    builder[name] = (...args: unknown[]) => {
      mockCalls.push([name, ...args]);
      return builder;
    };
  }
  builder.limit = (...args: unknown[]) => {
    mockCalls.push(['limit', ...args]);
    return Promise.resolve(mockAnswer.value);
  };
  // insert / update().select() / delete().select() are awaited directly.
  builder.then = (resolve: (value: unknown) => void) => resolve(mockAnswer.value);
  return builder;
}
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      mockCalls.push(['from', table]);
      return mockBuilder();
    },
    rpc: (fn: string) => {
      mockCalls.push(['rpc', fn]);
      return Promise.resolve(mockAnswer.value);
    },
  },
}));

const row = (id: string, start: string) => ({
  id,
  country_adm0: 'THA',
  title: 'תאילנד',
  start_date: start,
  end_date: '2027-12-31',
  notes: null,
});

const trip: Trip = {
  id: '00000000-0000-4000-8000-0000000000a1',
  countryAdm0: 'THA',
  title: 'תאילנד אוגוסט 2027',
  startDate: '2027-08-01',
  endDate: '2027-08-20',
  notes: null,
};

beforeEach(() => {
  mockCalls.length = 0;
  mockAnswer.value = { data: [], error: null };
  jest.mocked(NetInfo.fetch).mockResolvedValue({ isConnected: true } as never);
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('trips on the server (sprint 2 F-006)', () => {
  it('loads upcoming trips soonest first, keyset on departure then id (AC-5)', async () => {
    mockAnswer.value = { data: [row('b', '2027-01-01'), row('c', '2027-02-01')], error: null };
    const result = await loadTripPage({
      section: 'upcoming',
      today: '2026-10-26',
      cursor: { startDate: '2026-12-01', id: 'a' },
      pageSize: 2,
    });
    expect(mockCalls).toEqual([
      ['from', 'trips'],
      ['select', 'id, country_adm0, title, start_date, end_date, notes'],
      ['gte', 'end_date', '2026-10-26'],
      ['or', 'start_date.gt.2026-12-01,and(start_date.eq.2026-12-01,id.gt.a)'],
      ['order', 'start_date', { ascending: true }],
      ['order', 'id', { ascending: true }],
      ['limit', 2],
    ]);
    expect(result).toEqual({
      ok: true,
      value: {
        trips: [
          expect.objectContaining({ id: 'b', countryAdm0: 'THA', startDate: '2027-01-01' }),
          expect.objectContaining({ id: 'c' }),
        ],
        next: { startDate: '2027-02-01', id: 'c' },
      },
    });
  });

  it('loads past trips latest first, for one country, and knows the last page', async () => {
    mockAnswer.value = { data: [row('x', '2025-02-01')], error: null };
    const result = await loadTripPage({ section: 'past', today: '2026-10-26', countryAdm0: 'THA' });
    expect(mockCalls).toContainEqual(['lt', 'end_date', '2026-10-26']);
    expect(mockCalls).toContainEqual(['eq', 'country_adm0', 'THA']);
    expect(mockCalls).toContainEqual(['order', 'start_date', { ascending: false }]);
    expect(result.ok && result.value.next).toBeNull();
  });

  it('answers offline without a request, and a failure without logging the error object', async () => {
    jest.mocked(NetInfo.fetch).mockResolvedValue({ isConnected: false } as never);
    expect(await loadTripPage({ section: 'upcoming', today: '2026-10-26' })).toEqual({
      ok: false,
      reason: 'offline',
    });
    expect(mockCalls).toEqual([]);

    jest.mocked(NetInfo.fetch).mockResolvedValue({ isConnected: true } as never);
    mockAnswer.value = { data: null, error: { code: 'PGRST301', details: 'row holds notes' } };
    expect(await loadTripPage({ section: 'upcoming', today: '2026-10-26' })).toEqual({
      ok: false,
      reason: 'error',
    });
    expect(JSON.stringify(jest.mocked(console.error).mock.calls)).not.toContain('row holds notes');
  });

  it('reads the highlight countries with one call (AC-10)', async () => {
    mockAnswer.value = { data: ['THA', 'GRC'], error: null };
    const result = await loadTripCountries();
    expect(mockCalls).toEqual([['rpc', 'my_trip_countries']]);
    expect(result.ok && [...result.value]).toEqual(['THA', 'GRC']);
  });

  it('creates with the form id; the same id again counts as saved (AC-3)', async () => {
    expect(await createTrip(trip)).toBe('ok');
    expect(mockCalls).toContainEqual([
      'insert',
      expect.objectContaining({ id: trip.id, country_adm0: 'THA', start_date: '2027-08-01' }),
    ]);
    mockAnswer.value = { data: null, error: { code: '23505' } };
    expect(await createTrip(trip)).toBe('ok');
  });

  it('maps the consent gate (42501) and other failures', async () => {
    mockAnswer.value = { data: null, error: { code: '42501' } };
    expect(await createTrip(trip)).toBe('consent');
    expect(await updateTrip(trip.id, trip)).toBe('consent');
    mockAnswer.value = { data: null, error: { code: '23514' } };
    expect(await createTrip(trip)).toBe('error');
  });

  it('an update or delete that matches no row means "deleted elsewhere" (AC-6)', async () => {
    mockAnswer.value = { data: [], error: null };
    expect(await updateTrip(trip.id, trip)).toBe('gone');
    expect(await deleteTrip(trip.id)).toBe('gone');
    mockAnswer.value = { data: [{ id: trip.id }], error: null };
    expect(await updateTrip(trip.id, trip)).toBe('ok');
    expect(await deleteTrip(trip.id)).toBe('ok');
  });

  it('never writes offline', async () => {
    jest.mocked(NetInfo.fetch).mockResolvedValue({ isConnected: false } as never);
    expect(await createTrip(trip)).toBe('offline');
    expect(await updateTrip(trip.id, trip)).toBe('offline');
    expect(await deleteTrip(trip.id)).toBe('offline');
    expect(mockCalls).toEqual([]);
  });
});
