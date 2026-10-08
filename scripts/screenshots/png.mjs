// Minimal PNG helpers (no dependencies): size reader and RGBA -> 24-bit RGB re-encoder.
import zlib from 'node:zlib';
import fs from 'node:fs';

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

export function pngInfo(file) {
  const b = fs.readFileSync(file);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), bitDepth: b[24], colorType: b[25] };
}

/** Re-encode as 24-bit RGB (colour type 2), dropping any alpha channel. Composites onto white if alpha < 255. */
export function toRgb24(file) {
  const b = fs.readFileSync(file);
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20), depth = b[24], ct = b[25];
  if (depth !== 8 || (ct !== 2 && ct !== 6) || b[28] !== 0) throw new Error('unsupported PNG layout in ' + file);
  const bpp = ct === 6 ? 4 : 3;
  const idat = []; let p = 8;
  while (p < b.length) { const len = b.readUInt32BE(p); const type = b.toString('ascii', p + 4, p + 8); if (type === 'IDAT') idat.push(b.subarray(p + 8, p + 8 + len)); p += 12 + len; }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const up = y ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
      let v = src[x];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const pa = Math.abs(up - c), pb = Math.abs(a - c), pc = Math.abs(a + up - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      px[y * stride + x] = v & 255;
    }
  }
  const out = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) {
    const o = y * (w * 3 + 1); out[o] = 0;
    for (let x = 0; x < w; x++) {
      const i = y * stride + x * bpp; const al = bpp === 4 ? px[i + 3] / 255 : 1;
      for (let k = 0; k < 3; k++) out[o + 1 + x * 3 + k] = al === 1 ? px[i + k] : Math.round(px[i + k] * al + 255 * (1 - al));
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(out, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
}
