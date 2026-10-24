import { agreedFromLog, consentNeed, type LegalDocument } from './consentStatus';

const docs = (terms: number, privacy: number): LegalDocument[] => [
  { docType: 'terms', version: terms, url: null, publishedAt: '2026-10-23T00:00:00Z' },
  { docType: 'privacy', version: privacy, url: null, publishedAt: '2026-10-23T00:00:00Z' },
];

describe('consentNeed', () => {
  it('asks a user who has never agreed, even offline (AC-18a)', () => {
    expect(consentNeed(null, docs(0, 0))).toEqual({ kind: 'first' });
    expect(consentNeed(null, null)).toEqual({ kind: 'first' });
  });

  it('lets a user who agreed to the current versions through', () => {
    expect(consentNeed({ terms: 0, privacy: 0 }, docs(0, 0))).toEqual({ kind: 'none' });
  });

  it('asks again for each document published since (AC-18)', () => {
    expect(consentNeed({ terms: 0, privacy: 0 }, docs(1, 0))).toEqual({
      kind: 'updated',
      docs: ['terms'],
    });
    expect(consentNeed({ terms: 0, privacy: 0 }, docs(1, 1))).toEqual({
      kind: 'updated',
      docs: ['privacy', 'terms'],
    });
  });

  it("doesn't block offline once the user has agreed before (AC-19)", () => {
    expect(consentNeed({ terms: 0, privacy: 0 }, null)).toEqual({ kind: 'none' });
  });
});

describe('agreedFromLog', () => {
  const granted = (docType: string, docVersion: number | null) => ({
    docType,
    docVersion,
    action: 'granted',
  });

  it('reads the latest decision per document (rows are newest first)', () => {
    expect(
      agreedFromLog([granted('terms', 1), granted('privacy', 0), granted('terms', 0)]),
    ).toEqual({ terms: 1, privacy: 0 });
  });

  it('knows nothing when either document is missing or withdrawn', () => {
    expect(agreedFromLog([])).toBeNull();
    expect(agreedFromLog([granted('terms', 0)])).toBeNull();
    expect(
      agreedFromLog([
        { docType: 'privacy', docVersion: 0, action: 'withdrawn' },
        granted('terms', 0),
        granted('privacy', 0),
      ]),
    ).toBeNull();
  });

  it('ignores the optional choices', () => {
    expect(
      agreedFromLog([
        { docType: 'marketing', docVersion: null, action: 'withdrawn' },
        granted('terms', 0),
        granted('privacy', 0),
      ]),
    ).toEqual({ terms: 0, privacy: 0 });
  });
});
