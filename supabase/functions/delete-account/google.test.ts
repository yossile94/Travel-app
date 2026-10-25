// Run with: npx -y deno@2.9.6 test --config supabase/functions/deno.json supabase/functions
import { assertEquals, assertRejects } from '@std/assert';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';

import { verifyGoogleIdToken } from './google.ts';

const AUDIENCE = 'web-client.apps.googleusercontent.com';
const NOW = new Date('2026-10-25T20:00:00Z');
const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256' };
const keys = createLocalJWKSet({ keys: [jwk] });

function token(claims: Record<string, unknown> = {}, iatSecondsAgo = 30) {
  const iat = seconds(NOW) - iatSecondsAgo;
  return new SignJWT({ sub: 'google-me', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer((claims.iss as string) ?? 'https://accounts.google.com')
    .setAudience((claims.aud as string) ?? AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(iat + 3600)
    .sign(privateKey);
}

const verify = (idToken: string) =>
  verifyGoogleIdToken(idToken, { audience: AUDIENCE, maxAgeSeconds: 300, keys, now: NOW });

Deno.test('accepts a fresh Google ID token for our client', async () => {
  assertEquals(await verify(await token()), { sub: 'google-me' });
  assertEquals(await verify(await token({ iss: 'accounts.google.com' })), { sub: 'google-me' });
});

Deno.test('accepts a token issued a few seconds in our future (clock skew)', async () => {
  assertEquals(await verify(await token({}, -5)), { sub: 'google-me' });
});

Deno.test('refuses a token without a subject', async () => {
  const noSub = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer('https://accounts.google.com')
    .setAudience(AUDIENCE)
    .setIssuedAt(seconds(NOW) - 30)
    .setExpirationTime(seconds(NOW) + 3600)
    .sign(privateKey);
  await assertRejects(() => verify(noSub));
});

Deno.test('refuses a token for another client', async () => {
  await assertRejects(async () => verify(await token({ aud: 'someone-else' })));
});

Deno.test('refuses a token from another issuer', async () => {
  await assertRejects(async () => verify(await token({ iss: 'https://evil.example' })));
});

Deno.test(
  'refuses a token issued more than 5 minutes ago (not a fresh re-authentication)',
  async () => {
    await assertRejects(async () => verify(await token({}, 6 * 60)));
  },
);

Deno.test('refuses an expired token', async () => {
  await assertRejects(async () => verify(await token({}, 2 * 3600)));
});

Deno.test('refuses a token signed with another key', async () => {
  const other = await generateKeyPair('RS256');
  const forged = await new SignJWT({ sub: 'google-me' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer('https://accounts.google.com')
    .setAudience(AUDIENCE)
    .setIssuedAt(seconds(NOW) - 30)
    .setExpirationTime(seconds(NOW) + 3600)
    .sign(other.privateKey);
  await assertRejects(() => verify(forged));
});

Deno.test('refuses a token that is not RS256', async () => {
  const hs = await new SignJWT({ sub: 'google-me' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('https://accounts.google.com')
    .setAudience(AUDIENCE)
    .setIssuedAt(seconds(NOW) - 30)
    .setExpirationTime(seconds(NOW) + 3600)
    .sign(new TextEncoder().encode('a-shared-secret-of-enough-length-1234567890'));
  await assertRejects(() => verify(hs));
});
