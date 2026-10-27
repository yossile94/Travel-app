/**
 * The cron secret (ADR-010): pg_cron sends the Vault's "cron_secret" in the
 * x-cron-secret header, and a function that spends provider units checks it
 * against its CRON_SECRET. Both values are hashed first, so the comparison
 * takes the same time whatever the input's length or first wrong byte.
 */
const encoder = new TextEncoder();

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

export async function hasCronSecret(
  req: Request,
  expected: string | undefined = Deno.env.get('CRON_SECRET'),
): Promise<boolean> {
  // An unset secret never matches, so a missing setting fails closed.
  if (!expected) return false;
  const given = req.headers.get('x-cron-secret') ?? '';
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
