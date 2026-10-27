import { assertEquals } from '@std/assert';

import { aeroDataBox, toSnapshot, type RawFlight } from './aerodatabox.ts';
import { hasCronSecret } from './cronAuth.ts';

// Shaped like the provider's OpenAPI schema; the values are made up.
const raw: RawFlight = {
  number: 'LY 81',
  status: 'Delayed',
  codeshareStatus: 'IsOperator',
  isCargo: false,
  airline: { iata: 'LY' },
  departure: {
    airport: { iata: 'TLV', timeZone: 'Asia/Jerusalem' },
    scheduledTime: { utc: '2026-10-27 21:30Z' },
    revisedTime: { utc: '2026-10-27 23:40Z' },
    terminal: '3 ',
    gate: '',
    quality: ['Basic', 'Live'],
  },
  arrival: {
    airport: { iata: 'JFK', timeZone: 'America/New_York' },
    scheduledTime: { utc: '2026-10-28 09:05Z' },
  },
};

Deno.test('a provider flight becomes our snapshot', () => {
  const s = toSnapshot(raw);
  assertEquals(s.number, 'LY81');
  assertEquals(s.departure.scheduledUtc, '2026-10-27T21:30:00.000Z');
  assertEquals(s.departure.revisedUtc, '2026-10-27T23:40:00.000Z');
  assertEquals(s.departure.terminal, '3');
  assertEquals(s.departure.gate, null);
  assertEquals(s.arrival.iata, 'JFK');
  assertEquals(s.arrival.quality, []);
});

Deno.test('a FIDS departure row has the airport side in movement', () => {
  const { departure, ...rest } = raw;
  const s = toSnapshot({ ...rest, movement: departure }, 'departure');
  assertEquals(s.departure.iata, 'TLV');
  assertEquals(s.arrival.iata, 'JFK');
});

Deno.test('a FIDS row with legs keeps the airport side in departure', () => {
  assertEquals(toSnapshot(raw, 'departure').departure.iata, 'TLV');
});

Deno.test(
  'the client sends the key in the RapidAPI headers and reads a 204 as no flight',
  async () => {
    const seen: Request[] = [];
    const fake = ((url: string, init: RequestInit) => {
      seen.push(new Request(url, init));
      return Promise.resolve(new Response(null, { status: 204 }));
    }) as typeof fetch;
    const answer = await aeroDataBox('k', fake).flightsByNumber('LY81', '2026-10-27');
    assertEquals(answer, { ok: true, value: [], units: 2 });
    assertEquals(seen[0].headers.get('X-RapidAPI-Key'), 'k');
    assertEquals(new URL(seen[0].url).pathname, '/flights/number/LY81/2026-10-27');
  },
);

Deno.test('an error answer is reported with its status and still costs units', async () => {
  const fake = (() => Promise.resolve(new Response('{}', { status: 429 }))) as typeof fetch;
  assertEquals(
    await aeroDataBox('k', fake).departures('TLV', '2026-10-27T06:00', '2026-10-27T18:00'),
    {
      ok: false,
      status: 429,
      units: 2,
    },
  );
});

Deno.test('a network error or timeout is status 0, never a throw', async () => {
  const fake = (() => Promise.reject(new TypeError('network'))) as typeof fetch;
  assertEquals(await aeroDataBox('k', fake).flightsByNumber('LY81', '2026-10-27'), {
    ok: false,
    status: 0,
    units: 2,
  });
});

Deno.test('the cron secret: right, wrong, missing, and unset', async () => {
  const req = (h?: string) => new Request('http://x', { headers: h ? { 'x-cron-secret': h } : {} });
  assertEquals(await hasCronSecret(req('s3cret'), 's3cret'), true);
  assertEquals(await hasCronSecret(req('s3cre'), 's3cret'), false);
  assertEquals(await hasCronSecret(req(), 's3cret'), false);
  assertEquals(await hasCronSecret(req(''), ''), false);
});
