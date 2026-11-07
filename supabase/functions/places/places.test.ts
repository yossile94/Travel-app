import { assertEquals } from '@std/assert';

import {
  ENGLISH_FIELDS,
  googlePlaces,
  PICK_FIELDS,
  places,
  type PlacesDeps,
  type PlacesProvider,
  REFRESH_FIELDS,
} from './places.ts';

const now = new Date('2026-11-08T08:00:00Z');
const SESSION = '0b4f9a3e-5c2d-4e8f-9a1b-2c3d4e5f6a7b';
const PLACE = 'ChIJN1t_tDeuEmsRUsoyG83frY4';

function setup(over: Partial<PlacesProvider> = {}, take = true) {
  const calls: string[] = [];
  const taken: string[] = [];
  const provider: PlacesProvider = {
    autocomplete: (q) => {
      calls.push(`auto:${q.input}:${q.regions.join(',')}:${q.language}`);
      return Promise.resolve({
        ok: true,
        value: Array.from({ length: 7 }, (_, i) => ({
          placeId: `${PLACE}${i}`,
          name: `Hotel ${i}`,
          place: 'Bangkok',
        })),
      });
    },
    details: (q) => {
      calls.push(`details:${q.language}:${q.session ? 'session' : 'none'}:${q.fields.join(',')}`);
      return Promise.resolve({
        ok: true,
        value:
          q.language === 'en'
            ? {
                id: PLACE,
                displayName: 'Siam Hotel',
                formattedAddress: '3/2 Khao Rd, Bangkok',
                location: { latitude: 13.78, longitude: 100.5 },
              }
            : {
                id: PLACE,
                displayName: 'โรงแรมสยาม',
                formattedAddress: '3/2 ถนนขาว กรุงเทพฯ',
                internationalPhoneNumber: '+66 2 206 6999',
                location: { latitude: 13.78, longitude: 100.5 },
              },
      });
    },
    ...over,
  };
  const deps: PlacesDeps = {
    provider,
    take: (_user, kind) => {
      taken.push(kind);
      return Promise.resolve(take);
    },
    now: () => now,
  };
  return { deps, calls, taken };
}

const search = { mode: 'search', input: 'siam', session: SESSION, regions: ['TH'], language: 'he' };

Deno.test('a search asks for lodging in the trip countries and keeps five', async () => {
  const { deps, calls, taken } = setup();
  const answer = await places(deps, 'u1', search);
  assertEquals(answer.status, 200);
  assertEquals((answer.body as { suggestions: unknown[] }).suggestions.length, 5);
  assertEquals(calls, ['auto:siam:TH:he']);
  assertEquals(taken, ['search']);
});

Deno.test('bad input is refused before any count or call', async () => {
  const { deps, calls, taken } = setup();
  for (const body of [
    {},
    { mode: 'other' },
    { ...search, input: 'si' },
    { ...search, input: 'x'.repeat(101) },
    { ...search, session: 'not-a-uuid' },
    { ...search, regions: [] },
    { ...search, regions: ['th'] },
    { ...search, regions: Array.from({ length: 16 }, () => 'TH') },
    { ...search, language: 'hebrew' },
    { mode: 'pick', placeId: 'x', session: SESSION, localLanguage: 'th' },
    { mode: 'pick', placeId: PLACE, session: SESSION, localLanguage: 'TH' },
    { mode: 'refresh', placeId: '../etc' },
  ]) {
    assertEquals((await places(deps, 'u1', body)).status, 400, JSON.stringify(body));
  }
  assertEquals(calls, []);
  assertEquals(taken, []);
});

Deno.test('without a key the answer is "unavailable" (AC-5)', async () => {
  const { deps } = setup();
  const answer = await places({ ...deps, provider: null }, 'u1', search);
  assertEquals(answer, { status: 503, body: { error: 'unavailable' } });
});

Deno.test(
  'over the user or project budget the answer is "quota" and Google is not asked',
  async () => {
    const { deps, calls } = setup({}, false);
    assertEquals((await places(deps, 'u1', search)).body, { error: 'quota' });
    assertEquals(
      (
        await places(deps, 'u1', {
          mode: 'pick',
          placeId: PLACE,
          session: SESSION,
          localLanguage: 'th',
        })
      ).body,
      { error: 'quota' },
    );
    assertEquals(calls, []);
  },
);

Deno.test(
  'a pick asks in the local language with the session, then English without it',
  async () => {
    const { deps, calls, taken } = setup();
    const answer = await places(deps, 'u1', {
      mode: 'pick',
      placeId: PLACE,
      session: SESSION,
      localLanguage: 'th',
    });
    assertEquals(calls, [
      `details:th:session:${PICK_FIELDS.join(',')}`,
      `details:en:none:${ENGLISH_FIELDS.join(',')}`,
    ]);
    assertEquals(taken, ['pick']);
    assertEquals(answer.body, {
      place: {
        placeId: PLACE,
        nameLocal: 'โรงแรมสยาม',
        addressLocal: '3/2 ถนนขาว กรุงเทพฯ',
        nameEn: 'Siam Hotel',
        addressEn: '3/2 Khao Rd, Bangkok',
        phone: '+66 2 206 6999',
        lat: 13.78,
        lng: 100.5,
        fetchedAt: now.toISOString(),
      },
    });
  },
);

Deno.test('an English-speaking country needs one call', async () => {
  const { deps, calls } = setup();
  const answer = await places(deps, 'u1', {
    mode: 'pick',
    placeId: PLACE,
    session: SESSION,
    localLanguage: 'en',
  });
  assertEquals(calls.length, 1);
  const place = (answer.body as { place: { nameEn: string; nameLocal: string } }).place;
  assertEquals(place.nameEn, place.nameLocal);
});

Deno.test('a failed English call still returns the local half', async () => {
  const { deps } = setup({
    details: (q) =>
      Promise.resolve(
        q.language === 'en'
          ? { ok: false, notFound: false }
          : { ok: true, value: { id: PLACE, displayName: 'โรงแรม', formattedAddress: 'ที่อยู่' } },
      ),
  });
  const answer = await places(deps, 'u1', {
    mode: 'pick',
    placeId: PLACE,
    session: SESSION,
    localLanguage: 'th',
  });
  const place = (answer.body as { place: Record<string, unknown> }).place;
  assertEquals([place.nameLocal, place.nameEn, place.lat], ['โรงแรม', null, null]);
});

Deno.test('a place Google no longer knows is "gone"; other failures are "provider"', async () => {
  const gone = setup({ details: () => Promise.resolve({ ok: false, notFound: true }) });
  assertEquals((await places(gone.deps, 'u1', { mode: 'refresh', placeId: PLACE })).body, {
    gone: true,
  });
  const down = setup({
    details: () => Promise.resolve({ ok: false, notFound: false }),
    autocomplete: () => Promise.resolve({ ok: false, notFound: false }),
  });
  assertEquals((await places(down.deps, 'u1', { mode: 'refresh', placeId: PLACE })).body, {
    error: 'provider',
  });
  assertEquals((await places(down.deps, 'u1', search)).body, { error: 'provider' });
});

Deno.test('a refresh asks for the location only and keeps a new place id', async () => {
  const { deps, calls, taken } = setup({
    details: (q) => {
      calls.push(q.fields.join(','));
      return Promise.resolve({
        ok: true,
        value: { id: 'ChIJnewIdForTheSamePlace', location: { latitude: 1, longitude: 2 } },
      });
    },
  });
  const answer = await places(deps, 'u1', { mode: 'refresh', placeId: PLACE });
  assertEquals(calls, [REFRESH_FIELDS.join(',')]);
  assertEquals(taken, ['refresh']);
  assertEquals(answer.body, {
    refreshed: {
      placeId: 'ChIJnewIdForTheSamePlace',
      lat: 1,
      lng: 2,
      fetchedAt: now.toISOString(),
    },
  });
});

Deno.test(
  'the Google client sends the key in a header, the input in the body, and reads the answer',
  async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const fetcher = ((url: string, init?: RequestInit) => {
      seen.push({ url, init });
      if (url.endsWith(':autocomplete')) {
        return Promise.resolve(
          Response.json({
            suggestions: [
              {
                placePrediction: {
                  placeId: PLACE,
                  structuredFormat: {
                    mainText: { text: 'Siam' },
                    secondaryText: { text: 'Bangkok' },
                  },
                },
              },
              { queryPrediction: {} },
            ],
          }),
        );
      }
      if (url.includes('missing')) return Promise.resolve(new Response('{}', { status: 404 }));
      return Promise.resolve(
        Response.json({
          id: PLACE,
          displayName: { text: 'Siam' },
          location: { latitude: 1, longitude: 2 },
        }),
      );
    }) as typeof fetch;
    const google = googlePlaces('KEY', fetcher);

    const auto = await google.autocomplete({
      input: 'siam',
      session: SESSION,
      regions: ['TH'],
      language: 'he',
    });
    assertEquals(auto, { ok: true, value: [{ placeId: PLACE, name: 'Siam', place: 'Bangkok' }] });
    const headers = seen[0].init?.headers as Record<string, string>;
    assertEquals(headers['X-Goog-Api-Key'], 'KEY');
    assertEquals(seen[0].url.includes('siam'), false);
    assertEquals(JSON.parse(seen[0].init?.body as string).includedRegionCodes, ['th']);

    const details = await google.details({
      placeId: PLACE,
      language: 'th',
      session: SESSION,
      fields: PICK_FIELDS,
    });
    assertEquals(details, {
      ok: true,
      value: {
        id: PLACE,
        displayName: 'Siam',
        formattedAddress: undefined,
        internationalPhoneNumber: undefined,
        location: { latitude: 1, longitude: 2 },
      },
    });
    assertEquals(seen[1].url.includes(`sessionToken=${SESSION}`), true);
    assertEquals(
      (seen[1].init?.headers as Record<string, string>)['X-Goog-FieldMask'],
      PICK_FIELDS.join(','),
    );

    assertEquals(
      await google.details({
        placeId: 'missing_place_id',
        language: 'en',
        session: null,
        fields: REFRESH_FIELDS,
      }),
      { ok: false, notFound: true },
    );
  },
);

Deno.test("Google's own quota is 'quota' in every mode (Raz 1)", async () => {
  const full = { ok: false as const, notFound: false, quota: true };
  const { deps } = setup({
    autocomplete: () => Promise.resolve(full),
    details: () => Promise.resolve(full),
  });
  const quota = { error: 'quota' } as const;
  assertEquals((await places(deps, 'u1', search)).body, quota);
  assertEquals(
    (
      await places(deps, 'u1', {
        mode: 'pick',
        placeId: PLACE,
        session: SESSION,
        localLanguage: 'th',
      })
    ).body,
    quota,
  );
  assertEquals((await places(deps, 'u1', { mode: 'refresh', placeId: PLACE })).body, quota);
});

Deno.test("a database that can't count is a failure, not 'quota' (Raz 4)", async () => {
  const { deps, calls } = setup();
  const broken = { ...deps, take: () => Promise.reject(new Error('db')) };
  assertEquals((await places(broken, 'u1', search)).body, { error: 'provider' });
  assertEquals(calls, []);
});

Deno.test('language codes with a region pass, as Google uses them (Raz 3)', async () => {
  const { deps, calls } = setup();
  for (const lang of ['zh-TW', 'zh-HK', 'pt-BR', 'sr-Latn']) {
    const answer = await places(deps, 'u1', {
      mode: 'pick',
      placeId: PLACE,
      session: SESSION,
      localLanguage: lang,
    });
    assertEquals(answer.status, 200, lang);
  }
  assertEquals((await places(deps, 'u1', { ...search, language: 'zh-tw' })).status, 400);
  assertEquals(calls.length > 0, true);
});

Deno.test(
  "the Google client reports its quota and logs only the status and Google's reason (Raz 2)",
  async () => {
    const warned: unknown[][] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => void warned.push(args);
    try {
      const fetcher = ((url: string) =>
        Promise.resolve(
          url.endsWith(':autocomplete')
            ? Response.json({ error: { status: 'RESOURCE_EXHAUSTED' } }, { status: 429 })
            : Response.json({ error: { status: 'PERMISSION_DENIED' } }, { status: 403 }),
        )) as typeof fetch;
      const google = googlePlaces('KEY', fetcher);
      assertEquals(
        await google.autocomplete({
          input: 'secret hotel',
          session: SESSION,
          regions: ['TH'],
          language: 'he',
        }),
        { ok: false, notFound: false, quota: true },
      );
      assertEquals(
        await google.details({
          placeId: PLACE,
          language: 'th',
          session: SESSION,
          fields: PICK_FIELDS,
        }),
        { ok: false, notFound: false, quota: false },
      );
      assertEquals(warned, [
        ['[places] google', 'autocomplete', 429, 'RESOURCE_EXHAUSTED'],
        ['[places] google', 'details', 403, 'PERMISSION_DENIED'],
      ]);
      const timedOut = googlePlaces('KEY', (() =>
        Promise.reject(Object.assign(new Error('t'), { name: 'TimeoutError' }))) as typeof fetch);
      await timedOut.details({
        placeId: PLACE,
        language: 'en',
        session: null,
        fields: REFRESH_FIELDS,
      });
      assertEquals(warned[2], ['[places] google', 'details', 'timeout']);
    } finally {
      console.warn = warn;
    }
  },
);
