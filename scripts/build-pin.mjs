/**
 * Draws the next-trip pin (sprint 3 design 9.1) to PNG at 1x, 2x and 3x,
 * from the designer's SVG, with no image library: the outline is flattened
 * to a polygon, each pixel is sampled 4×4 for fill and stroke, and the PNG
 * is written with node's zlib.
 *   viewBox 0 0 24 32
 *   path M12 31 C10.2 27.4 3.5 19 3.5 11.5 A8.5 8.5 0 0 1 20.5 11.5
 *        C20.5 19 13.8 27.4 12 31 Z   fill #4FCFBE, stroke #03060F 2
 *   circle cx 12 cy 11.5 r 3.5          fill #03060F
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'apps', 'mobile', 'assets', 'images');

const BODY = [0x4f, 0xcf, 0xbe];
const DARK = [0x03, 0x06, 0x0f];
const STROKE = 2;
const DOT = { x: 12, y: 11.5, r: 3.5 };

function cubic(p0, p1, p2, p3, steps = 24) {
  const points = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    points.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return points;
}

/** The outline as a closed polygon, in viewBox units. */
export function pinOutline() {
  const points = [[12, 31]];
  points.push(...cubic([12, 31], [10.2, 27.4], [3.5, 19], [3.5, 11.5]));
  // The arc over the top: from the left point to the right point, centre (12, 11.5).
  for (let i = 1; i <= 32; i++) {
    const a = Math.PI + (Math.PI * i) / 32;
    points.push([12 + 8.5 * Math.cos(a), 11.5 + 8.5 * Math.sin(a)]);
  }
  points.push(...cubic([20.5, 11.5], [20.5, 19], [13.8, 27.4], [12, 31]));
  return points;
}

function inside([x, y], poly) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function edgeDistance([x, y], poly) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j];
    const [bx, by] = poly[i];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
  }
  return best;
}

/** RGBA pixels of the pin at `scale` (1 → 24×32). */
export function renderPin(scale) {
  const width = 24 * scale;
  const height = 32 * scale;
  const poly = pinOutline();
  const pixels = Buffer.alloc(width * height * 4);
  const N = 4;
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const p = [(px + (sx + 0.5) / N) / scale, (py + (sy + 0.5) / N) / scale];
          const near = edgeDistance(p, poly) <= STROKE / 2;
          const inBody = inside(p, poly);
          const inDot = Math.hypot(p[0] - DOT.x, p[1] - DOT.y) <= DOT.r;
          const colour = near || inDot ? DARK : inBody ? BODY : null;
          if (!colour) continue;
          r += colour[0];
          g += colour[1];
          b += colour[2];
          a += 1;
        }
      }
      const i = (py * width + px) * 4;
      if (a > 0) {
        pixels[i] = Math.round(r / a);
        pixels[i + 1] = Math.round(g / a);
        pixels[i + 2] = Math.round(b / a);
        pixels[i + 3] = Math.round((255 * a) / (N * N));
      }
    }
  }
  return { width, height, pixels };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

export function encodePng({ width, height, pixels }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8); // bit depth
  header.writeUInt8(6, 9); // RGBA
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    rows[y * (width * 4 + 1)] = 0; // no filter
    pixels.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function main() {
  await mkdir(outDir, { recursive: true });
  for (const [scale, suffix] of [
    [1, ''],
    [2, '@2x'],
    [3, '@3x'],
  ]) {
    await writeFile(join(outDir, `next-trip-pin${suffix}.png`), encodePng(renderPin(scale)));
  }
  console.log('next-trip-pin: 24×32, 48×64, 72×96');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
