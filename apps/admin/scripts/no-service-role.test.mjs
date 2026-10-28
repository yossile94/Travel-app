// Sprint 10 D15 (AC-16): the panel acts only as the signed-in person. No
// service_role key, no admin API and no secret in its code; CI fails if one
// appears. (The publishable key is public by design.)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const root = path.join(import.meta.dirname, '..');
const files = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|tsx|js|mjs|json|env.*)$/.test(entry.name) && !entry.name.endsWith('.test.mjs'))
      files.push(full);
  }
};
walk(root);

describe('no service_role in apps/admin (D15)', () => {
  it('finds the panel files', () => {
    assert.ok(files.some((f) => f.endsWith('save.ts')));
  });
  for (const pattern of [
    /service_role/i,
    /SERVICE_ROLE/,
    /auth\.admin\./,
    /SUPABASE_SECRET/i,
    /sb_secret_/,
  ]) {
    it(`nothing matches ${pattern}`, () => {
      const hits = files.filter((f) => pattern.test(fs.readFileSync(f, 'utf8')));
      assert.deepEqual(
        hits.map((f) => path.relative(root, f)),
        [],
      );
    });
  }
});
