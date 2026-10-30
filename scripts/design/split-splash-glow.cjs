// Splits the approved splash art into the opaque globe and its glow (s12 design 1.1).
// node scripts/design/split-splash-glow.cjs docs/design/s12-app-icon/splash-icon.png apps/mobile/assets/splash-icon-noglow.png apps/mobile/assets/splash-glow.png
const sharp = require('sharp');
const [src, outNo, outGlow] = process.argv.slice(2);

(async () => {
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const c = (w - 1) / 2;
  const at = (x, y) => (y * w + x) * 4;
  const dist = (x, y) => Math.hypot(x - c, y - c);
  let R = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) if (data[at(x, y) + 3] === 255) R = Math.max(R, dist(x, y));
  const no = Buffer.from(data);
  const glow = Buffer.from(data);
  let bad = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = at(x, y);
      const d = dist(x, y);
      const m = Math.min(1, Math.max(0, R + 0.5 - d));
      no[i + 3] = Math.round(data[i + 3] * m);
      // Over-compositing in the edge ring: the glow fills what the globe leaves of the alpha.
      const a = data[i + 3] / 255;
      const a1 = no[i + 3] / 255;
      glow[i + 3] = m >= 1 || a1 >= 1 ? 0 : Math.round((255 * (a - a1)) / (1 - a1));
      if (d < R - 0.5 && data[i + 3] !== 255) bad++;
      if (d > 0.33 * w && data[i + 3] > 0) bad++;
    }
  // Glow under, globe over: the composite gives back the source.
  let maxErr = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a1 = no[i + 3] / 255;
    const a0 = glow[i + 3] / 255;
    const a = a1 + a0 * (1 - a1);
    if (Math.abs(a * 255 - data[i + 3]) > maxErr) maxErr = Math.abs(a * 255 - data[i + 3]);
  }
  await sharp(no, { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toFile(outNo);
  await sharp(glow, { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toFile(outGlow);
  console.log(
    JSON.stringify({
      R: +R.toFixed(2),
      Rfrac: +(R / w).toFixed(4),
      interiorNot255: bad,
      maxAlphaErr: +maxErr.toFixed(2),
    }),
  );
})();
