import NetInfo from '@react-native-community/netinfo';

import { cancelInsuranceReminder } from '@/features/kit/insuranceReminder';
import { forgetTripKit } from '@/features/kit/kitStore';
import { removePolicy } from '@/features/kit/policyFile';

import { deleteTrip, loadTripCountries, loadTripPage, saveTrip, type Trip } from './tripsApi';

// Sprint 8 AC-9, AC-10 (Dana 1, 2): a deleted trip takes its device-only kit.
jest.mock('@/features/kit/insuranceReminder', () => ({
  cancelInsuranceReminder: jest.fn(async () => {}),
}));
jest.mock('@/features/kit/kitStore', () => ({ forgetTripKit: jest.fn(async () => {}) }));
jest.mock('@/features/kit/policyFile', () => ({ removePolicy: jest.fn() }));

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
    rpc: (fn: string, args?: unknown) => {
      mockCalls.push(args === undefined ? ['rpc', fn] : ['rpc', fn, args]);
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
  travelers: [{ name: 'דנה', relation: 'partner' }],
  cities: [
    { geonameId: 1609350, name: 'בנגקוק' },
    { geonameId: null, name: 'קו טאו' },
  ],
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
      [
        'select',
        'id, country_adm0, title, start_date, end_date, notes, ' +
          'trip_travelers(name, relation, position), trip_cities(geoname_id, name, position)',
      ],
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

  it('saves the whole trip in one call, with its travelers and cities (sprint 3 AC-2, AC-5)', async () => {
    mockAnswer.value = { data: 'ok', error: null };
    expect(await saveTrip('create', trip)).toBe('ok');
    expect(mockCalls).toEqual([
      [
        'rpc',
        'save_trip',
        {
          p_mode: 'create',
          p_id: trip.id,
          p_country_adm0: 'THA',
          p_title: trip.title,
          p_start: '2027-08-01',
          p_end: '2027-08-20',
          p_notes: null,
          p_travelers: [{ name: 'דנה', relation: 'partner' }],
          p_cities: [
            { geonameId: 1609350, name: 'בנגקוק' },
            { geonameId: null, name: 'קו טאו' },
          ],
        },
      ],
    ]);
  });

  it('reads the travelers and cities from the list rows, in position order (Dudi)', async () => {
    mockAnswer.value = {
      data: [
        {
          ...row('b', '2027-01-01'),
          trip_travelers: [
            { name: 'נועם', relation: 'child', position: 1 },
            { name: 'דנה', relation: null, position: 0 },
          ],
          trip_cities: [
            { geoname_id: null, name: 'קו טאו', position: 1 },
            { geoname_id: 1609350, name: 'בנגקוק', position: 0 },
          ],
        },
      ],
      error: null,
    };
    const result = await loadTripPage({ section: 'upcoming', today: '2026-10-26' });
    expect(result.ok && result.value.trips[0]).toMatchObject({
      travelers: [
        { name: 'דנה', relation: null },
        { name: 'נועם', relation: 'child' },
      ],
      cities: [
        { geonameId: 1609350, name: 'בנגקוק' },
        { geonameId: null, name: 'קו טאו' },
      ],
    });
  });

  it('only the consent gate refusal itself means "consent" (ADR-007)', async () => {
    mockAnswer.value = { data: null, error: { code: '42501', hint: 'consent_required' } };
    expect(await saveTrip('create', trip)).toBe('consent');
    mockAnswer.value = { data: null, error: { code: '42501', hint: null } };
    expect(await saveTrip('update', trip)).toBe('error');
    mockAnswer.value = { data: null, error: { code: '23505' } };
    expect(await saveTrip('create', trip)).toBe('error');
  });

  it('an update of a trip deleted elsewhere is "gone" (AC-6 of sprint 2)', async () => {
    mockAnswer.value = { data: 'gone', error: null };
    expect(await saveTrip('update', trip)).toBe('gone');
    mockAnswer.value = { data: [], error: null };
    expect(await deleteTrip(trip.id)).toBe('gone');
    mockAnswer.value = { data: [{ id: trip.id }], error: null };
    expect(await deleteTrip(trip.id)).toBe('ok');
    // Sprint 8: the reminder, the policy file and the kit copy go with it.
    expect(cancelInsuranceReminder).toHaveBeenCalledWith(trip.id);
    expect(removePolicy).toHaveBeenCalledWith(trip.id);
    expect(forgetTripKit).toHaveBeenCalledWith(trip.id);
  });

  it('never writes offline', async () => {
    jest.mocked(NetInfo.fetch).mockResolvedValue({ isConnected: false } as never);
    expect(await saveTrip('create', trip)).toBe('offline');
    expect(await saveTrip('update', trip)).toBe('offline');
    expect(await deleteTrip(trip.id)).toBe('offline');
    expect(mockCalls).toEqual([]);
  });
});
