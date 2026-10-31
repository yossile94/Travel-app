/**
 * Sprint 13 (Dana's QA 2): the release asks only for what the app uses. The
 * app has no location feature, and the Play Data safety form says so; Mapbox
 * and the Expo template add location and overlay permissions, which app.json
 * blocks.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = JSON.parse(readFileSync(join(root, 'apps', 'mobile', 'app.json'), 'utf8')).expo;

it('blocks location and overlay permissions (docs/release/data-safety-draft.md)', () => {
  for (const permission of [
    'android.permission.ACCESS_FINE_LOCATION',
    'android.permission.ACCESS_COARSE_LOCATION',
    'android.permission.SYSTEM_ALERT_WINDOW',
  ]) {
    assert.ok(app.android.blockedPermissions.includes(permission), permission);
  }
});

it('asks for no location permission of its own', () => {
  const asked = app.android.permissions ?? [];
  assert.deepEqual(
    asked.filter((p) => /LOCATION/.test(p)),
    [],
  );
});
