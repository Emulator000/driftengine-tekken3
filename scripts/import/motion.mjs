/**
 * Motions as typed curves. A motion's first halfword holds its
 * frame count (low byte) and its first channel's encoding; 48 more encodings follow a byte each,
 * and the channels' data starts 0x32 bytes in, `encoding` halfwords a channel: 0 nothing, 1 a
 * constant, 2 a start and a slope, the frame count one value per frame, any other count a start
 * value and keys (a signed step above bit 5, shifted by the channel's shift from 0x80096c24, 1 for
 * positions and 5 for angles; a span less one below). Odd channels are stored with their frames
 * reversed. The halfword before a motion is its id, which the motion kinds list. The cubic (0x800387c8) reads its weights from the bytes 0x800966f8 to 0x80096c40,
 * some forward and some backward from their bases; they are laid out here as plain tables.
 */
const CHANNELS = 49;
const CHANNEL_SHIFT = 0x80096c24;
const CURVE = { short: 0x800966f8, long: 0x80096b3c, back: 0x8009691c, after: 0x80096a1c, next: 0x80096b1e, first: 0x80096c20 };

export function curveTables(exe) {
  const segment = Array.from({ length: 33 }, (_, length) =>
    Array.from({ length: length + 1 }, (_, f) => (length === 0 || f === 0 ? 0 : exe.u8(length <= 16 ? CURVE.short + length * 0x20 + f + 3 : CURVE.long - length * 0x20 - f))),
  );
  const weights = (base, direction) => Array.from({ length: 256 }, (_, k) => exe.u16(base + direction * 2 * k));
  return { segment, back: weights(CURVE.back, 1), after: weights(CURVE.after, -1), next: weights(CURVE.next, -1), first: weights(CURVE.first, -1) };
}

/** The motion at byte `at` of `bytes`. */
export function importMotion(bytes, at, exe) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const head = v.getUint16(at, true);
  const frames = head & 0xff;
  let data = at + 0x32;
  const channels = [];
  for (let c = 0; c < CHANNELS; c += 1) {
    const encoding = c === 0 ? head >> 8 : v.getUint8(at + 1 + c);
    const reversed = (c & 1) === 1;
    const half = (i) => v.getInt16(data + i * 2, true);
    if (encoding === 0) channels.push({ kind: 'zero', reversed });
    else if (encoding === 1) channels.push({ kind: 'constant', reversed, value: half(0) });
    else if (encoding === 2) channels.push({ kind: 'linear', reversed, start: v.getUint16(data, true), slope: half(1) });
    else if (encoding === frames) channels.push({ kind: 'samples', reversed, values: Array.from({ length: frames }, (_, i) => half(i)) });
    else {
      const shift = exe.u8(CHANNEL_SHIFT + c);
      const keys = Array.from({ length: encoding - 1 }, (_, i) => half(1 + i));
      const spans = keys.map((k) => (k & 0x1f) + 1);
      let end = 0;
      if (!spans.some((span) => (end += span) === frames - 1)) throw new Error(`the motion at byte ${at} has channel ${c}'s keys not ending on its last frame`);
      channels.push({ kind: 'keys', reversed, start: half(0), steps: keys.map((k) => (k >> 5) << shift), spans });
    }
    data += encoding * 2;
  }
  return { id: v.getInt16(at - 2, true), frames, channels };
}

/** A file's motions in `numberMotions`' order. */
export function importMotions(file, motions, exe) {
  const base = new DataView(file.bytes.buffer, file.bytes.byteOffset, file.bytes.byteLength).getUint32(0x1c, true);
  return { motions: motions.offsets(file.name).map((offset) => importMotion(file.bytes, base + offset, exe)) };
}
