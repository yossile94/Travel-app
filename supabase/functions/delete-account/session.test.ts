// Run with: npx -y deno@2.9.6 test --config supabase/functions/deno.json supabase/functions
import { assertEquals, assertRejects, assertThrows } from '@std/assert';

import { deleteUserWith, lookupFrom, sessionUserFrom, type Rpc } from './session.ts';

Deno.test("takes each Google identity's sub, and no other provider's", () => {
  assertEquals(
    sessionUserFrom({
      id: 'user-1',
      identities: [
        { provider: 'google', id: 'provider-id-1', identity_data: { sub: 'google-sub-1' } },
        { provider: 'google', id: 'google-sub-2', identity_data: {} },
        { provider: 'apple', id: 'apple-sub', identity_data: { sub: 'apple-sub' } },
        { provider: 'email', id: 'user-1', identity_data: { sub: 'user-1' } },
      ],
    }),
    { id: 'user-1', googleSubs: ['google-sub-1', 'google-sub-2'] },
  );
  assertEquals(sessionUserFrom({ id: 'user-2', identities: null }), {
    id: 'user-2',
    googleSubs: [],
  });
});

Deno.test('a validly signed token whose user is gone means "already deleted"', () => {
  assertEquals(lookupFrom(null, { status: 403, code: 'user_not_found' }), 'gone');
});

Deno.test('a token or session that is not valid is "invalid" (401)', () => {
  for (const error of [
    { status: 401, code: 'bad_jwt' },
    { status: 403, code: 'bad_jwt' },
    { status: 403, code: 'session_not_found' },
    { status: 401 },
  ]) {
    assertEquals(lookupFrom(null, error), 'invalid');
  }
});

Deno.test('Auth failing throws, so the handler answers 500 and nothing is wiped', () => {
  for (const error of [{ status: 500, code: 'unexpected_failure' }, { status: 0 }, {}]) {
    assertThrows(() => lookupFrom(null, error));
  }
  assertThrows(() => lookupFrom(null, null), Error, 'Auth lookup failed');
});

Deno.test('a user comes back with their Google subs', () => {
  assertEquals(lookupFrom({ id: 'u', identities: [{ provider: 'google', id: 's' }] }, null), {
    id: 'u',
    googleSubs: ['s'],
  });
});

Deno.test(
  'deletes through admin_delete_user with the session user and the fixed reason',
  async () => {
    const calls: unknown[] = [];
    const rpc: Rpc = (fn, args) => {
      calls.push([fn, args]);
      return Promise.resolve({ data: true, error: null });
    };
    assertEquals(await deleteUserWith(rpc, 'user-1'), true);
    assertEquals(calls, [['admin_delete_user', { target: 'user-1', why: 'user_request' }]]);
  },
);

Deno.test('true only when the SQL function answers true; its errors are thrown', async () => {
  assertEquals(
    await deleteUserWith(() => Promise.resolve({ data: false, error: null }), 'u'),
    false,
  );
  assertEquals(
    await deleteUserWith(() => Promise.resolve({ data: null, error: null }), 'u'),
    false,
  );
  await assertRejects(() =>
    deleteUserWith(() => Promise.resolve({ data: null, error: { code: '42501' } }), 'u'),
  );
});
