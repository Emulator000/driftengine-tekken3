/**
 * Tekken 4's motions: a frame's values decoded, and its rotation groups as a pose's turns.
 *
 * A motion bank (part 0 of a character's motion container): a version, a count, then 23 and 23, and
 * an offset per motion from the bank's start (motions are shared between entries).
 *
 * A motion is 69 channels, 23 groups of three. Its first short is the frame count; then the 69
 * values of the first frame, the 69 of the last, and from short `0x8b` an offset per block of 16
 * frames. In a block each channel has a header short (the low nine bits the shorts it takes, the top
 * seven the first bits of its stream) and a stream of four-bit codes, read low bits first, one per
 * frame from the first: 0 no change, 1 to 6 a change of 2, 4 or 6 more bits around a bias, 7 a new
 * value of 12 bits, and 8 or more the same as code less 8, on this frame and as many more as four
 * more bits plus one. Groups 0, 1 and 6 are positions (a change times 4), the rest rotations
 * (times 16): group 1 is the hips' place, group 2 a turn about the vertical, groups 3 to 22 the
 * nodes `NODE_OF_GROUP` names.
 *
 * A rotation group is an axis and an angle, all three 16-bit turns: the axis is the third row of
 * Rx(first) · Ry(second), row vectors, and the third value turns about it. As a node's local
 * rotation (row vectors) it is the conjugate of the quaternion that axis and angle make.
 *
 * A model's bind pose is its node table's: each node's rest rotation Rx · Ry · Rz (row vectors) and
 * its offset, under its parent.
 */

const CHANNELS = 69;
const GROUPS = 23;
/** Bit set: the group is a rotation. Groups 0, 1 and 6 are positions. */
const ROTATIONS = 0xffffbc;
const BIAS = [0, -0x54, -0x14, -4, 1, 5, 0x15];
const EXTRA = [0, 6, 4, 2, 2, 4, 6];

export function parseBank(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(2, true);
  const motions = [];
  for (let i = 0; i < count; i += 1) {
    const at = view.getUint32(8 + i * 4, true);
    motions.push(at);
  }
  return { count, offsets: motions, bytes };
}

const isRotation = (channel) => ((ROTATIONS >> Math.floor(channel / 3)) & 1) !== 0;

/** The motion at `at` in `bytes`: its frame count and a reader of a frame's 69 values. */
export function readMotion(bytes, at) {
  const view = new DataView(bytes.buffer, bytes.byteOffset + at, bytes.byteLength - at);
  const short = (i) => view.getUint16(i * 2, true);
  const frames = short(0);
  return {
    frames,
    /** Frame `frame`'s 69 values as signed 16-bit numbers. */
    frame(frame) {
      const out = new Int16Array(CHANNELS);
      if (!(frame + 1 < frames)) {
        for (let c = 0; c < CHANNELS; c += 1) out[c] = short(0x46 + c);
        return out;
      }
      for (let c = 0; c < CHANNELS; c += 1) out[c] = short(1 + c);
      if (frame === 0) return out;
      const step = frame - 1;
      let p = short((step >> 4) + 0x8b);
      for (let c = 0; c < CHANNELS; c += 1) {
        const head = short(p);
        let q = p + 1;
        p += head & 0x1ff;
        let bits = head >> 9;
        let have = 7;
        let value = out[c];
        const shift = isRotation(c) ? 4 : 2;
        let repeat = 0;
        let code = 0;
        for (let n = 0; n <= (step & 0xf); n += 1) {
          if (have < 16) {
            bits += short(q) << have;
            q += 1;
            have += 16;
          }
          /* A run's code applies on the frame it is read and on as many more as its count plus one. */
          if (repeat === 0) {
            code = bits & 0xf;
            bits >>= 4;
            have -= 4;
            if (code > 7) {
              repeat = (bits & 0xf) + 1;
              bits >>= 4;
              have -= 4;
              code -= 8;
            }
          } else repeat -= 1;
          if (code === 7) {
            if (have < 12) {
              bits += short(q) << have;
              q += 1;
              have += 16;
            }
            value = ((((bits << 20) >> 20) << shift) << 16) >> 16;
            bits >>= 12;
            have -= 12;
          } else if (code !== 0) {
            const width = EXTRA[code];
            const mask = (1 << width) - 1;
            value = (((value + ((BIAS[code] + (bits & mask)) << shift)) << 16) >> 16);
            bits >>= width;
            have -= width;
          }
        }
        out[c] = value;
      }
      return out;
    },
  };
}

const TURN = Math.PI / 32768;

/** A rotation group's three values as the quaternion [x, y, z, w] its axis and angle make. */
export function groupQuaternion(a, b, c) {
  const x = a * TURN;
  const y = b * TURN;
  const axis = [Math.sin(y) * Math.cos(x), -Math.sin(x), Math.cos(y) * Math.cos(x)];
  const half = (c * TURN) / 2;
  const s = Math.sin(half);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)];
}

/** The nodes groups 3 to 22 turn; groups 0 to 2 are the root's, and group 6, a place, turns none (its 0 a filler). */
export const NODE_OF_GROUP = [0, 0, 0, 0, 1, 13, 0, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 18, 19, 20];

export { GROUPS, isRotation };
