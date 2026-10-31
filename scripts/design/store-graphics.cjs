// Sprint 13 AC-17: Play's 512 icon and 1024x500 feature graphic from the
// app's own art. sharp isn't a dependency of the repo; run it with:
//   npx -p sharp@0.34 node scripts/design/store-graphics.cjs
const sharp = require('sharp');
const { join } = require('node:path');

const root = join(__dirname, '..', '..');
const assets = join(root, 'apps', 'mobile', 'assets');
const out = join(root, 'docs', 'release', 'assets');
const NIGHT = '#060B18';

(async () => {
  // Play wants a 32-bit PNG; icon.png is RGB (sprint 12 AC-3), so add alpha.
  await sharp(join(assets, 'icon.png'))
    .resize(512, 512)
    .ensureAlpha()
    .png()
    .toFile(join(out, 'play-icon-512.png'));

  // Play wants a 24-bit PNG here, no alpha.
  // The globe with its glow, on the launch night, beside the name.
  const globe = await sharp(join(assets, 'splash-icon-noglow.png')).resize(420, 420).toBuffer();
  const glow = await sharp(join(assets, 'splash-glow.png')).resize(420, 420).toBuffer();
  const text = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="560" height="500">
    <text x="0" y="230" font-family="Segoe UI, Arial, sans-serif" font-size="64" font-weight="700" fill="#F1F5F9">[Name]</text>
    <text x="0" y="300" font-family="Segoe UI, Arial, sans-serif" font-size="30" fill="#CBD5E1">Your trips on a globe</text>
  </svg>`);
  await sharp({ create: { width: 1024, height: 500, channels: 3, background: NIGHT } })
    .composite([
      { input: glow, left: 40, top: 40 },
      { input: globe, left: 40, top: 40 },
      { input: text, left: 480, top: 0 },
    ])
    .flatten({ background: NIGHT })
    .removeAlpha()
    .png()
    .toFile(join(out, 'play-feature-graphic.png'));
  console.log('written to', out);
})();
