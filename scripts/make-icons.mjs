// Draws the app icon (a rune in a ring) and writes PNG + SVG files to public/icons.
// No dependencies: a tiny rasterizer and PNG encoder using node:zlib. Run: npm run icons
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve(import.meta.dirname, '../public/icons');
mkdirSync(OUT, { recursive: true });

const BG = [29, 26, 36];
const GOLD = [226, 178, 92];
const EMBER = [196, 82, 58];

// Rune strokes in a 0..1 box: a staff with a branching "giant" rune and a crossbar.
const STROKES = [
  [0.5, 0.24, 0.5, 0.76],
  [0.5, 0.36, 0.66, 0.28],
  [0.5, 0.36, 0.34, 0.28],
  [0.5, 0.52, 0.66, 0.6],
  [0.5, 0.52, 0.34, 0.6],
  [0.4, 0.76, 0.6, 0.76],
];

function segDist(px, py, [ax, ay, bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const cover = (d, half, aa) => Math.max(0, Math.min(1, (half - d) / aa + 0.5));

/** inset: fraction of padding (maskable icons keep art inside the safe zone). rounded: corner radius or 0. */
function draw(size, { inset = 0, rounded = 0.22, transparentCorners = true } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const aa = 1.2 / size;
  const s = 1 - inset * 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size, v = (y + 0.5) / size;
      // Rounded-square mask.
      let alpha = 1;
      if (rounded > 0 && transparentCorners) {
        const qx = Math.max(Math.abs(u - 0.5) - (0.5 - rounded), 0);
        const qy = Math.max(Math.abs(v - 0.5) - (0.5 - rounded), 0);
        alpha = cover(Math.hypot(qx, qy), rounded, aa);
      }
      // Art coordinates.
      const au = (u - 0.5) / s + 0.5, av = (v - 0.5) / s + 0.5;
      const glow = Math.max(0, 1 - Math.hypot(au - 0.5, av - 0.52) / 0.5);
      let c = mix(BG, EMBER, glow * glow * 0.35);
      const r = Math.hypot(au - 0.5, av - 0.5);
      c = mix(c, GOLD, cover(Math.abs(r - 0.4), 0.022, aa / s) * 0.9);
      const d = Math.min(...STROKES.map((sg) => segDist(au, av, sg)));
      c = mix(c, GOLD, cover(d, 0.036, aa / s));
      const i = (y * size + x) * 4;
      px[i] = Math.round(c[0]);
      px[i + 1] = Math.round(c[1]);
      px[i + 2] = Math.round(c[2]);
      px[i + 3] = Math.round(alpha * 255);
    }
  }
  return png(size, px);
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

writeFileSync(resolve(OUT, 'icon-192.png'), draw(192));
writeFileSync(resolve(OUT, 'icon-512.png'), draw(512));
// Maskable: full-bleed background, art inside the 80% safe zone.
writeFileSync(resolve(OUT, 'maskable-512.png'), draw(512, { inset: 0.1, transparentCorners: false }));
// iOS rounds corners itself and shows transparency as black: opaque square.
writeFileSync(resolve(OUT, 'apple-touch-icon.png'), draw(180, { inset: 0.04, transparentCorners: false }));

const rgb = (c) => `rgb(${c.join(',')})`;
const lines = STROKES.map(([a, b, c, d]) => `<line x1="${a * 100}" y1="${b * 100}" x2="${c * 100}" y2="${d * 100}"/>`).join('');
writeFileSync(
  resolve(OUT, 'icon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="${rgb(BG)}"/>` +
    `<circle cx="50" cy="50" r="40" fill="none" stroke="${rgb(GOLD)}" stroke-width="4.4" opacity=".9"/>` +
    `<g stroke="${rgb(GOLD)}" stroke-width="7.2" stroke-linecap="round">${lines}</g></svg>\n`,
);
console.log('icons written to', OUT);
