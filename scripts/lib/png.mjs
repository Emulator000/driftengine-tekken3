/**
 * RGBA8 images written as PNG and read back, with nothing but `node:zlib`. Rows top first, as a TIM
 * stores them.
 */
import { crc32, deflateSync, inflateSync } from 'node:zlib';

function chunk(type, body) {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'latin1');
  body.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

export function encodePng(width, height, pixels) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let row = 0; row < height; row += 1) {
    raw[row * (stride + 1)] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + row * stride, stride).copy(raw, row * (stride + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A PNG of 8-bit grey, RGB or RGBA, with or without alpha, not interlaced, as RGBA8. */
export function decodePng(bytes) {
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let kind = 0;
  const data = [];
  for (let at = 8; at < view.length; ) {
    const length = view.readUInt32BE(at);
    const type = view.toString('latin1', at + 4, at + 8);
    const body = view.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      kind = body[9];
      if (body[8] !== 8 || body[12] !== 0 || ![0, 2, 4, 6].includes(kind)) throw new Error('only 8-bit, uninterlaced grey, RGB and RGBA PNGs are read');
    } else if (type === 'IDAT') data.push(body);
    at += 12 + length;
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[kind];
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const rows = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x += 1) {
      const value = raw[y * (stride + 1) + 1 + x];
      const left = x >= channels ? rows[y * stride + x - channels] : 0;
      const up = y > 0 ? rows[(y - 1) * stride + x] : 0;
      const corner = x >= channels && y > 0 ? rows[(y - 1) * stride + x - channels] : 0;
      const guess = left + up - corner;
      const paeth = Math.abs(guess - left) <= Math.abs(guess - up) && Math.abs(guess - left) <= Math.abs(guess - corner) ? left : Math.abs(guess - up) <= Math.abs(guess - corner) ? up : corner;
      const add = [0, left, up, (left + up) >> 1, paeth][filter];
      if (add === undefined) throw new Error(`PNG filter ${filter} is not one of the five`);
      rows[y * stride + x] = (value + add) & 0xff;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const p = rows.subarray(i * channels, i * channels + channels);
    const grey = channels <= 2;
    rgba.set([p[0], grey ? p[0] : p[1], grey ? p[0] : p[2], channels === 2 ? p[1] : channels === 4 ? p[3] : 255], i * 4);
  }
  return { width, height, rgba };
}
