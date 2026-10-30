// Splits the approved splash art into the opaque globe and its glow (s12 design 1.1, ADR-018).
// sharp isn't a dependency of the repo; run it with:
//   npx -p sharp@0.34 node scripts/design/split-splash-glow.cjs \
//     docs/design/s12-app-icon/splash-icon.png \
//     apps/mobile/assets/splash-icon-noglow.png apps/mobile/assets/splash-glow.png
// It exits non-zero when a rule of 1.1 fails.
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
  let interiorNot255 = 0;
  let glowTooStrong = 0;
  let beyondFrame = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = at(x, y);
      const d = dist(x, y);
      const m = Math.min(1, Math.max(0, R + 0.5 - d));
      no[i + 3] = Math.round(data[i + 3] * m);
      // Over-compositing in the edge ring (Raz): the glow fills what the globe leaves.
      const a = data[i + 3] / 255;
      const a1 = no[i + 3] / 255;
      glow[i + 3] = m >= 1 || a1 >= 1 ? 0 : Math.round((255 * (a - a1)) / (1 - a1));
      if (d < R - 0.5 && data[i + 3] !== 255) interiorNot255++;
      if (d > R + 1 && data[i + 3] >= 200) glowTooStrong++;
      if (d > 0.33 * w && data[i + 3] > 0) beyondFrame++;
    }
  // Glow under, globe over: the composite gives back the source.
  let maxErr = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a1 = no[i + 3] / 255;
    const a0 = glow[i + 3] / 255;
    const a = a1 + a0 * (1 - a1);
    maxErr = Math.max(maxErr, Math.abs(a * 255 - data[i + 3]));
  }
  await sharp(no, { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toFile(outNo);
  await sharp(glow, { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toFile(outGlow);
  const report = {
    R: +R.toFixed(2),
    Rfrac: +(R / w).toFixed(4),
    interiorNot255,
    glowTooStrong,
    beyondFrame,
    maxAlphaErr: +maxErr.toFixed(2),
  };
  console.log(JSON.stringify(report));
  if (interiorNot255 || glowTooStrong || beyondFrame || maxErr > 1) process.exitCode = 1;
})();
