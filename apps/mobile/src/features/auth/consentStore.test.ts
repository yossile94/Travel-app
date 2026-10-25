import { fetchCurrentDocuments } from './consentStore';

// jest.mock is hoisted above the import.
const mockQuery = { data: [] as object[] | null, error: null as object | null };
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({ select: async () => mockQuery }),
  },
}));

const row = (doc_type: string, version: number) => ({
  doc_type,
  version,
  url: null,
  published_at: '2026-10-24T22:19:05.123456+00:00',
});

describe('fetchCurrentDocuments', () => {
  it('maps the view rows', async () => {
    mockQuery.data = [row('privacy', 0), row('terms', 0)];
    expect(await fetchCurrentDocuments()).toEqual([
      {
        docType: 'privacy',
        version: 0,
        url: null,
        publishedAt: '2026-10-24T22:19:05.123456+00:00',
      },
      { docType: 'terms', version: 0, url: null, publishedAt: '2026-10-24T22:19:05.123456+00:00' },
    ]);
  });

  it('counts half a list as no answer, so no consent goes unrecorded', async () => {
    mockQuery.data = [row('terms', 0)];
    expect(await fetchCurrentDocuments()).toBeNull();
    mockQuery.data = [];
    expect(await fetchCurrentDocuments()).toBeNull();
  });

  it('is null when the server answers with an error (offline)', async () => {
    mockQuery.data = null;
    mockQuery.error = { message: 'Network request failed' };
    expect(await fetchCurrentDocuments()).toBeNull();
    mockQuery.error = null;
  });
});
