import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFile, writeFile } from 'node:fs/promises';
const svg = await readFile('public/icon.svg');
const image = await loadImage(svg);
for (const size of [192, 512]) {
  const canvas = createCanvas(size, size);
  const context = canvas.getContext('2d');
  context.fillStyle = '#285b49';
  context.fillRect(0, 0, size, size);
  context.drawImage(image, 0, 0, size, size);
  await writeFile(`public/icon-${size}.png`, canvas.toBuffer('image/png'));
}
