// Run with: npx -y deno@2.9.6 test --config supabase/functions/deno.json supabase/functions
import { assertEquals } from '@std/assert';

import { createHandler, type Deps, type SessionUser } from './handler.ts';

const ME: SessionUser = { id: 'user-me', googleSubs: ['google-me'] };
// Access tokens are JWTs; their content is up to the fake userFromToken.
const VALID = 'header.valid-session.sig';
const INVALID = 'header.not-a-session.sig';
const DELETED_USER = 'header.deleted-user.sig';

function joseError(code: string, claim?: string) {
  return Object.assign(new Error('jose'), { code, claim });
}

function setup(overrides: Partial<Deps> = {}) {
  const deleted: string[] = [];
  const googleCalls: string[] = [];
  const sessionCalls: string[] = [];
  const deps: Deps = {
    userFromToken: (token) => {
      sessionCalls.push(token);
      if (token === VALID) return Promise.resolve(ME);
      if (token === DELETED_USER) return Promise.resolve('gone');
      return Promise.resolve('invalid');
    },
    verifyGoogle: (idToken) => {
      googleCalls.push(idToken);
      if (idToken === 'google-token-me') return Promise.resolve({ sub: 'google-me' });
      if (idToken === 'google-token-other') return Promise.resolve({ sub: 'google-other' });
      return Promise.reject(joseError('ERR_JWT_CLAIM_VALIDATION_FAILED', 'aud'));
    },
    deleteUser: (id) => {
      deleted.push(id);
      return Promise.resolve(true);
    },
    ...overrides,
  };
  return { handler: createHandler(deps), deleted, googleCalls, sessionCalls };
}

function request(body: unknown, { auth = `Bearer ${VALID}`, method = 'POST' } = {}) {
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

/** Runs fn with console.error/warn captured; returns what was logged. */
async function captureLogs(fn: () => Promise<void>): Promise<string> {
  const logged: unknown[][] = [];
  const { error, warn } = console;
  console.error = (...args: unknown[]) => logged.push(args);
  console.warn = (...args: unknown[]) => logged.push(args);
  try {
    await fn();
  } finally {
    console.error = error;
    console.warn = warn;
  }
  return JSON.stringify(logged);
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

Deno.test('a retry after the account was deleted answers deleted: false (AC-16)', async () => {
  const { handler, deleted, googleCalls } = setup();
  assertEquals(
    await call(
      handler,
      request({ idToken: 'google-token-me' }, { auth: `Bearer ${DELETED_USER}` }),
    ),
    { status: 200, body: { deleted: false } },
  );
  assertEquals(deleted, []);
  assertEquals(googleCalls, [], 'nothing left to re-authenticate');
});

Deno.test(
  'answers deleted: false when the SQL function finds no user (concurrent requests)',
  async () => {
    const { handler } = setup({ deleteUser: () => Promise.resolve(false) });
    assertEquals(await call(handler, request({ idToken: 'google-token-me' })), {
      status: 200,
      body: { deleted: false },
    });
  },
);

Deno.test('refuses a Google token for another account, and logs it without ids', async () => {
  const { handler, deleted } = setup();
  let result;
  const logs = await captureLogs(async () => {
    result = await call(handler, request({ idToken: 'google-token-other' }));
  });
  assertEquals(result, { status: 403, body: { error: 'wrong_account' } });
  assertEquals(deleted, []);
  assertEquals(logs.includes('another Google account'), true);
  assertEquals(logs.includes('google-other'), false);
});

Deno.test('a user without a Google identity is refused', async () => {
  const { handler, deleted } = setup({
    userFromToken: () => Promise.resolve({ id: 'user-apple', googleSubs: [] }),
  });
  let status;
  await captureLogs(async () => {
    status = (await call(handler, request({ idToken: 'google-token-me' }))).status;
  });
  assertEquals(status, 403);
  assertEquals(deleted, []);
});

Deno.test('an invalid Google token is 403 and logs the failed claim, not the token', async () => {
  const { handler, deleted } = setup();
  let result;
  const logs = await captureLogs(async () => {
    result = await call(handler, request({ idToken: 'forged-token-value' }));
  });
  assertEquals(result, { status: 403, body: { error: 'reauth_failed' } });
  assertEquals(deleted, []);
  assertEquals(logs.includes('"claim":"aud"'), true);
  assertEquals(logs.includes('forged-token-value'), false);
});

Deno.test('Google\'s keys unreachable is 503, never "re-authentication failed"', async () => {
  for (const failure of [joseError('ERR_JWKS_TIMEOUT'), new TypeError('fetch failed')]) {
    const { handler, deleted } = setup({ verifyGoogle: () => Promise.reject(failure) });
    let result;
    await captureLogs(async () => {
      result = await call(handler, request({ idToken: 'google-token-me' }));
    });
    assertEquals(result, { status: 503, body: { error: 'unavailable' } });
    assertEquals(deleted, []);
  }
});

Deno.test('needs a valid session, checked before the body or Google', async () => {
  const { handler, deleted, googleCalls, sessionCalls } = setup();
  for (const auth of ['', `Bearer ${INVALID}`, `Basic ${VALID}`, 'Bearer not-a-jwt']) {
    assertEquals(
      (await call(handler, request({ idToken: 'google-token-me' }, { auth }))).status,
      401,
    );
  }
  assertEquals(deleted, []);
  assertEquals(googleCalls, []);
  assertEquals(sessionCalls, [INVALID], 'tokens that are not JWTs never reach Auth');
});

Deno.test('Auth failing is 500, never 401 (the app must not take it for "deleted")', async () => {
  const { handler, deleted } = setup({
    userFromToken: () =>
      Promise.reject(Object.assign(new Error('down'), { code: 'unexpected_failure' })),
  });
  let result;
  await captureLogs(async () => {
    result = await call(handler, request({ idToken: 'google-token-me' }));
  });
  assertEquals(result, { status: 500, body: { error: 'server_error' } });
  assertEquals(deleted, []);
});

Deno.test('needs an ID token in the body', async () => {
  const { handler } = setup();
  for (const body of [{}, { idToken: '' }, { idToken: 42 }, { idToken: 'x'.repeat(5000) }, null]) {
    assertEquals((await call(handler, request(body))).status, 400);
  }
  const notJson = new Request('http://localhost/delete-account', {
    method: 'POST',
    headers: { Authorization: `Bearer ${VALID}` },
    body: '{',
  });
  assertEquals((await call(handler, notJson)).status, 400);
});

Deno.test('refuses a body over 8 KB', async () => {
  const { handler } = setup();
  assertEquals(
    (await call(handler, request({ idToken: 'google-token-me', pad: 'x'.repeat(9000) }))).status,
    413,
  );
});

Deno.test('accepts only POST', async () => {
  const { handler } = setup();
  assertEquals((await call(handler, request(null, { method: 'GET' }))).status, 405);
});

Deno.test('a failed deletion is a server error that logs no personal data', async () => {
  const { handler } = setup({
    deleteUser: () => Promise.reject(Object.assign(new Error('user-me secret'), { code: 'XX000' })),
  });
  let result;
  const logs = await captureLogs(async () => {
    result = await call(handler, request({ idToken: 'google-token-me' }));
  });
  assertEquals(result, { status: 500, body: { error: 'server_error' } });
  assertEquals(logs.includes('user-me'), false);
  assertEquals(logs.includes('google-token-me'), false);
  assertEquals(logs.includes('XX000'), true);
});
