// Generate the electron-builder source icon from the web app's avatar.
//
// The repo ships ui/public/avatar.webp (NOT a .png), so this converts it to a
// 1024×1024 PNG at desktop/build/icon.png. electron-builder then auto-derives
// the platform icons (.icns for macOS, .ico for Windows) from that single PNG.
//
// Non-square sources are letterboxed (contain-fit) onto a transparent canvas
// so the avatar is never cropped or stretched. The generated icon.png is
// committed so `dist:*` works without re-running this first.

import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '..', '..', 'public', 'avatar.webp');
const OUT = resolve(here, '..', 'build', 'icon.png');
const SIZE = 1024;

async function main() {
  await mkdir(dirname(OUT), { recursive: true });

  await sharp(SRC)
    .resize(SIZE, SIZE, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }, // transparent letterbox for non-square art
    })
    .png()
    .toFile(OUT);

  console.log(`Wrote ${OUT} (${SIZE}x${SIZE}) from ${SRC}`);
}

main().catch((err) => {
  console.error('icon generation failed:', err);
  process.exit(1);
});
