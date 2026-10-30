/**
 * Sprint 12 AC-3: the App Store refuses an icon with an alpha channel, so
 * icon.png stays a 1024×1024, 8-bit RGB PNG (colour type 2).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assets = join(root, 'apps', 'mobile', 'assets');

/** The IHDR chunk follows the 8-byte signature and the chunk's length and type. */
function header(file) {
  const png = readFileSync(join(assets, file));
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG', `${file} is not a PNG`);
  assert.equal(png.subarray(12, 16).toString('ascii'), 'IHDR');
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
    bitDepth: png[24],
    colourType: png[25],
  };
}

describe('the app icon files (sprint 12 F-033)', () => {
  it('icon.png is 1024×1024, 8-bit RGB, no alpha (AC-3)', () => {
    assert.deepEqual(header('icon.png'), { width: 1024, height: 1024, bitDepth: 8, colourType: 2 });
  });

  it('the Android and splash files have the sizes app.json expects', () => {
    for (const [file, size] of [
      ['android-icon-foreground.png', 512],
      ['android-icon-background.png', 512],
      ['android-icon-monochrome.png', 432],
      ['splash-icon.png', 1024],
    ]) {
      const { width, height } = header(file);
      assert.deepEqual([width, height], [size, size], file);
    }
  });
});
