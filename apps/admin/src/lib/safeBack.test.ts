// Sprint 10, Dana bug 5: the language switch's way back stays on the site.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { safeBackPath } from './validate.ts';

describe('safeBackPath', () => {
  it('keeps a path of the panel', () => {
    assert.equal(safeBackPath('/countries/THA?x=1'), '/countries/THA?x=1');
    assert.equal(safeBackPath('/'), '/');
  });
  for (const bad of [
    '//evil.example',
    '/\\evil.example',
    '/x\\y',
    'https://evil.example',
    'javascript:alert(1)',
    '/a\nb',
    '/a\tb',
    '',
    null,
    42,
    `/${'a'.repeat(600)}`,
  ]) {
    it(`sends ${JSON.stringify(bad)?.slice(0, 30)} home`, () => {
      assert.equal(safeBackPath(bad), '/');
    });
  }
});
