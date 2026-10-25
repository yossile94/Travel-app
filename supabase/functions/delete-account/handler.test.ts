// Run with: npx deno@2.9.6 test supabase/functions
import { assertEquals } from '@std/assert';

import { createHandler, type Deps, type SessionUser } from './handler.ts';

const ME: SessionUser = { id: 'user-me', googleSubs: ['google-me'] };

function setup(overrides: Partial<Deps> = {}) {
  const deleted: string[] = [];
  const deps: Deps = {
    userFromToken: (token) => Promise.resolve(token === 'valid-session' ? ME : null),
    verifyGoogle: (idToken) => {
      if (idToken === 'google-token-me') return Promise.resolve({ sub: 'google-me' });
      if (idToken === 'google-token-other') return Promise.resolve({ sub: 'google-other' });
      return Promise.reject(new Error('invalid'));
    },
    deleteUser: (id) => {
      deleted.push(id);
      return Promise.resolve(true);
    },
    ...overrides,
  };
  return { handler: createHandler(deps), deleted };
}

function request(body: unknown, { auth = 'Bearer valid-session', method = 'POST' } = {}) {
  return new Request('http://localhost/delete-account', {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
}

async function call(handler: (req: Request) => Promise<Response>, req: Request) {
  const res = await handler(req);
  return { status: res.status, body: await res.json() };
}

Deno.test('deletes the signed-in user after a fresh Google re-authentication', async () => {
  const { handler, deleted } = setup();
  assertEquals(await call(handler, request({ idToken: 'google-token-me' })), {
    status: 200,
    body: { deleted: true },
  });
  assertEquals(deleted, ['user-me']);
});

Deno.test('a user_id in the body never chooses who is deleted', async () => {
  const { handler, deleted } = setup();
  await call(
    handler,
    request({ idToken: 'google-token-me', user_id: 'someone-else', userId: 'x' }),
  );
  assertEquals(deleted, ['user-me']);
});

Deno.test(
  'answers deleted: false when the user is already gone (retry after a lost response)',
  async () => {
    const { handler } = setup({ deleteUser: () => Promise.resolve(false) });
    assertEquals(await call(handler, request({ idToken: 'google-token-me' })), {
      status: 200,
      body: { deleted: false },
    });
  },
);

Deno.test('refuses a Google token for another account', async () => {
  const { handler, deleted } = setup();
  assertEquals(await call(handler, request({ idToken: 'google-token-other' })), {
    status: 403,
    body: { error: 'wrong_account' },
  });
  assertEquals(deleted, []);
});

Deno.test('refuses an invalid, old or foreign Google token', async () => {
  const { handler, deleted } = setup();
  assertEquals(await call(handler, request({ idToken: 'forged' })), {
    status: 403,
    body: { error: 'reauth_failed' },
  });
  assertEquals(deleted, []);
});

Deno.test('needs a session', async () => {
  const { handler, deleted } = setup();
  assertEquals(
    (await call(handler, request({ idToken: 'google-token-me' }, { auth: '' }))).status,
    401,
  );
  assertEquals(
    (await call(handler, request({ idToken: 'google-token-me' }, { auth: 'Bearer gone' }))).status,
    401,
  );
  assertEquals(
    (await call(handler, request({ idToken: 'google-token-me' }, { auth: 'Basic valid-session' })))
      .status,
    401,
  );
  assertEquals(deleted, []);
});

Deno.test('needs an ID token in the body', async () => {
  const { handler } = setup();
  for (const body of [{}, { idToken: '' }, { idToken: 42 }, { idToken: 'x'.repeat(5000) }, null]) {
    assertEquals((await call(handler, request(body))).status, 400);
  }
  const notJson = new Request('http://localhost/delete-account', {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-session' },
    body: '{',
  });
  assertEquals((await call(handler, notJson)).status, 400);
});

Deno.test('accepts only POST', async () => {
  const { handler } = setup();
  assertEquals((await call(handler, request(null, { method: 'GET' }))).status, 405);
});

Deno.test('a failed deletion is a server error that logs no personal data', async () => {
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => logged.push(args);
  try {
    const { handler } = setup({
      deleteUser: () =>
        Promise.reject(Object.assign(new Error('user-me secret'), { code: 'XX000' })),
    });
    assertEquals(await call(handler, request({ idToken: 'google-token-me' })), {
      status: 500,
      body: { error: 'server_error' },
    });
  } finally {
    console.error = original;
  }
  const text = JSON.stringify(logged);
  assertEquals(text.includes('user-me'), false);
  assertEquals(text.includes('google-token-me'), false);
  assertEquals(text.includes('XX000'), true);
});
