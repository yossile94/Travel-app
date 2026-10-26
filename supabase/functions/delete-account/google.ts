/**
 * Verifies a Google ID token from the app's re-authentication step before an
 * account is deleted (sprint 2 AC-18, ADR-006): Google's signature, issuer,
 * our Web client as audience, not expired, and issued no earlier than the
 * caller's window (60 minutes in production: Play services hands back a
 * cached token, ADR-006 6).
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export interface GoogleTokenOptions {
  /** The Web client ID the app's Google sign-in asks tokens for. */
  audience: string;
  /** How old (by `iat`) a token may be, in seconds. */
  maxAgeSeconds: number;
  /** Google's keys; replaced in tests. */
  keys?: JWTVerifyGetKey;
  now?: Date;
}

/** The Google account (`sub`) the token was issued for; throws if it isn't valid. */
export async function verifyGoogleIdToken(
  token: string,
  { audience, maxAgeSeconds, keys = googleKeys, now }: GoogleTokenOptions,
): Promise<{ sub: string }> {
  const { payload } = await jwtVerify(token, keys, {
    issuer: GOOGLE_ISSUERS,
    audience,
    algorithms: ['RS256'],
    maxTokenAge: `${maxAgeSeconds}s`,
    // Google's clock may run slightly ahead of ours: a token just issued
    // could otherwise look issued in the future.
    clockTolerance: '30s',
    currentDate: now,
  });
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    // A token-level refusal (403), like jose's own claim errors.
    throw Object.assign(new Error('Google token without a subject'), {
      code: 'ERR_JWT_CLAIM_VALIDATION_FAILED',
      claim: 'sub',
    });
  }
  return { sub: payload.sub };
}
