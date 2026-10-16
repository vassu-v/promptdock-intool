// Generates build/icon.png (256x256) with no image libraries.
import fs from 'node:fs';
import zlib from 'node:zlib';
const S = 256, px = Buffer.alloc(S * S * 4);
const set = (x, y, [r, g, b, a]) => { const i = (y * S + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a; };
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  const dx = x - 127.5, dy = y - 127.5, d = Math.hypot(dx, dy);
  if (d > 124) continue;
  const t = y / S, a = d > 122 ? Math.round(255 * (124 - d) / 2) : 255;
  set(x, y, [Math.round(99 - 40 * t), Math.round(102 + 20 * t), Math.round(241 - 30 * t), a]);
  // ">" chevron
  const cx = x - 70, cy = y - 128;
  if (cx >= 0 && cx <= 62 && Math.abs(Math.abs(cy) - cx * 0.95) < 13 && Math.abs(cy) < 66) set(x, y, [255, 255, 255, 255]);
  // "_" bar
  if (x >= 140 && x <= 196 && y >= 168 && y <= 190) set(x, y, [255, 255, 255, 255]);
}
const crc = (b) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } c = ~0; for (const x of b) c = t[(c ^ x) & 255] ^ (c >>> 8); return (~c) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
fs.writeFileSync('build/icon.png', Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log('build/icon.png written');
