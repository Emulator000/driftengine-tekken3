/**
 * The PS2's VIF codes, as a Tekken 4 model's DMA packets carry them: what each writes into the
 * vector unit's memory. `UNPACK` decodes its elements; everything else is named and stepped over.
 */

/** UNPACK's element layouts, by `vn` (components less one) and `vl` (32, 16, 8 bits, or 5:5:5:1). */
const LAYOUTS = [
  [['S-32', 1, 4], ['S-16', 1, 2], ['S-8', 1, 1], null],
  [['V2-32', 2, 4], ['V2-16', 2, 2], ['V2-8', 2, 1], null],
  [['V3-32', 3, 4], ['V3-16', 3, 2], ['V3-8', 3, 1], null],
  [['V4-32', 4, 4], ['V4-16', 4, 2], ['V4-8', 4, 1], ['V4-5', 4, 2]],
];

/**
 * The codes from `start` to `end`, one at a time: `{ code, at, ...fields }`, an UNPACK with
 * `format`, `count`, `address` (in quadwords), `unsigned` and `bytes` (its raw elements in order).
 * `at` is where the code after it starts.
 */
export function* vifCodes(bytes, start, end) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = start;
  while (at + 4 <= end) {
    const word = view.getUint32(at, true);
    at += 4;
    const cmd = (word >>> 24) & 0x7f;
    const num = (word >>> 16) & 0xff;
    const imm = word & 0xffff;
    if ((cmd & 0x60) === 0x60) {
      const layout = LAYOUTS[(cmd >> 2) & 3][cmd & 3];
      if (layout === null) throw new Error(`VIF: UNPACK layout ${cmd.toString(16)} at ${at - 4}`);
      const [format, components, size] = layout;
      const count = num || 256;
      const length = (count * components * size + 3) & ~3;
      const unpack = { code: 'UNPACK', format, components, size, count, address: imm & 0x3ff, unsigned: (imm & 0x4000) !== 0, bytes: bytes.subarray(at, at + length) };
      at += length;
      yield { ...unpack, at };
    } else if (cmd === 0x01) yield { code: 'STCYCL', cl: imm & 0xff, wl: imm >> 8, at };
    else if (cmd === 0x00) yield { code: 'NOP', at };
    else if (cmd === 0x10 || cmd === 0x11 || cmd === 0x13) yield { code: 'FLUSH', at };
    else if (cmd === 0x14 || cmd === 0x15 || cmd === 0x17) yield { code: 'MSCAL', address: imm, at };
    else if (cmd >= 0x02 && cmd <= 0x07) yield { code: 'SET', cmd, value: imm, at };
    else if (cmd === 0x20) {
      at += 4;
      yield { code: 'STMASK', at };
    } else if (cmd === 0x30 || cmd === 0x31) {
      at += 16;
      yield { code: cmd === 0x30 ? 'STROW' : 'STCOL', at };
    } else if (cmd === 0x4a) {
      at += (num || 256) * 8;
      yield { code: 'MPG', at };
    } else if (cmd === 0x50 || cmd === 0x51) {
      const qwc = imm || 0x10000;
      const direct = bytes.subarray(at, at + qwc * 16);
      at += qwc * 16;
      yield { code: 'DIRECT', bytes: direct, at };
    } else throw new Error(`VIF: code ${word.toString(16)} at ${at - 4}`);
  }
}

/** An UNPACK's elements as numbers: floats for 32-bit (`asFloat`), else integers signed or not. */
export function unpackElements(unpack, asFloat = false) {
  const { bytes, components, size, count, unsigned } = unpack;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const element = [];
    for (let c = 0; c < components; c += 1) {
      const at = (i * components + c) * size;
      if (size === 4) element.push(asFloat ? view.getFloat32(at, true) : view.getUint32(at, true));
      else if (size === 2) element.push(unsigned ? view.getUint16(at, true) : view.getInt16(at, true));
      else element.push(unsigned ? view.getUint8(at) : view.getInt8(at));
    }
    out.push(element);
  }
  return out;
}
