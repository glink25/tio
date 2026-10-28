import { readFileSync, writeFileSync } from 'node:fs';

import { Resvg } from '@resvg/resvg-js';

// All public icons are derived assets. Edit the source SVG, then run pnpm brand:icons.
const source = readFileSync(new URL('../apps/web/src/brand/logo.svg', import.meta.url), 'utf8');
const square = source.replace(' rx="42"', '');
const contents = source.replace(/<svg[^>]*>|<\/svg>/g, '');
const output = new URL('../apps/web/public/', import.meta.url);
writeFileSync(new URL('icon.svg', output), source);
for (const [name, size, maskable] of [
  ['favicon-32.png', 32, false],
  ['apple-touch-icon.png', 180, false],
  ['pwa-192.png', 192, false],
  ['pwa-512.png', 512, false],
  ['pwa-maskable-512.png', 512, true],
]) {
  // The entire mark stays inside the maskable icon's central safe circle.
  const svg = maskable
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><rect width="240" height="240" fill="#111"/><g transform="translate(48 48) scale(.6)">${contents}</g></svg>`
    : name === 'apple-touch-icon.png'
      ? square
      : source;
  writeFileSync(
    new URL(name, output),
    new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng(),
  );
}
