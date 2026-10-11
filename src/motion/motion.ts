/**
 * Tekken 3's motions: decoding a frame of a move into its 49 channels, and building the skeleton's
 * local rotations from them.
 *
 * Fixed point follows the game: angles are 16-bit turns, rotations are 4.12, distances millimetres.
 */

/** Constants read from the executable at extraction time. */
export interface MotionTables {
  /** sin in 4.12 over 5120 entries; cos(i) is sin(i + 1024), as the game's two tables overlap. */
  readonly sine: Int16Array;
  /** The keyframe curve's weight tables: executable bytes from `0x800966f8` to `0x80096c40`. */
  readonly curve: Uint8Array;
  /** Per channel, how far a keyframe delta is shifted (`0x80096c24`): 1 for positions, 5 for angles. */
  readonly channelShift: Uint8Array;
  /** The matrix three joints are post-multiplied by (`0x80096eac`), rows of 4.12. */
  readonly fixup: Int16Array;
  /** The generic skeleton's offsets the IK chains use (`0x80096ecc`, eight vectors). */
  readonly offsets: Int32Array;
}

export const CHANNELS = 49;
const CURVE_BASE = 0x800966f8;

/** A motion as stored: a frame count, an encoding per channel, and where each channel's data is. */
export interface Motion {
  readonly frames: number;
  readonly encodings: Uint8Array;
  readonly dataAt: Int32Array;
  readonly view: DataView;
}

/** Reads a motion's header at `offset`: channel data starts 50 bytes in. */
export function readMotion(view: DataView, offset: number): Motion {
  const head = view.getUint16(offset, true);
  const frames = head & 0xff;
  const encodings = new Uint8Array(CHANNELS);
  encodings[0] = head >> 8;
  for (let c = 1; c < CHANNELS; c += 1) encodings[c] = view.getUint8(offset + 1 + c);
  const dataAt = new Int32Array(CHANNELS);
  let at = offset + 50;
  for (let c = 0; c < CHANNELS; c += 1) {
    dataAt[c] = at;
    at += (encodings[c] ?? 0) * 2;
  }
  return { frames, encodings, dataAt, view };
}

function curveU16(tables: MotionTables, address: number): number {
  const at = address - CURVE_BASE;
  return (tables.curve[at] ?? 0) | ((tables.curve[at + 1] ?? 0) << 8);
}

/** The keyframe segment a frame falls in, and the four keys around it. */
interface Segment {
  start: number;
  end: number;
  previous: number;
  current: number;
  next: number;
  after: number;
}

/**
 * A keyframe channel at a frame: a start value, then 16-bit keys holding a signed
 * delta (above bit 5, shifted by the channel's shift) and a segment length less one (the low five
 * bits). Between keys, a cubic over the previous, this, the next and the one after, with weights the
 * game tabulates by the position inside the segment.
 */
function keyframed(view: DataView, at: number, frame: number, frames: number, shift: number): Segment {
  const last = frames - 1;
  let k3 = view.getInt16(at, true);
  let entry = view.getInt16(at + 2, true);
  at += 4;
  let k2 = k3;
  let k7 = ((entry >> 5) << shift) + k3;
  let end = 0;
  let start = 0;
  let next = k7;
  let current = k2;
  let previous = k3;
  for (;;) {
    start = end;
    next = k7;
    current = k2;
    previous = k3;
    end = start + (entry & 0x1f) + 1;
    k7 = next;
    if (end === last) break;
    entry = view.getInt16(at, true);
    at += 2;
    k7 = next + ((entry >> 5) << shift);
    k3 = current;
    k2 = next;
    if (!(frame - end > 0)) break;
  }
  return { start, end, previous, current, next, after: k7 };
}

/** The weight-table index for a position `f` inside a segment `length` frames long. */
function curveIndex(tables: MotionTables, length: number, f: number): number {
  if (f === 0) return 0;
  const address = length - 16 < 1 ? CURVE_BASE + length * 0x20 + f + 3 : 0x80096b3c - length * 0x20 - f;
  return (tables.curve[address - CURVE_BASE] ?? 0) << 1;
}

/** One channel of a motion at a frame, before the game doubles it. */
export function sampleChannel(motion: Motion, channel: number, frame: number, tables: MotionTables): number {
  const count = motion.frames;
  const encoding = motion.encodings[channel] ?? 0;
  const at = motion.dataAt[channel] ?? 0;
  const view = motion.view;
  let f = Math.max(0, Math.min(frame, count - 1));
  /* Odd channels are stored with their frames reversed. */
  if (channel & 1) f = count - (f + 1);
  if (encoding === 0) return 0;
  if (encoding === 1) return view.getInt16(at, true);
  if (encoding === 2) {
    let slope = view.getInt16(at + 2, true) * f;
    if (count > 9) slope >>= 5;
    return view.getUint16(at, true) + slope;
  }
  if (encoding === count) return view.getInt16(at + f * 2, true);

  const shift = tables.channelShift[channel] ?? 0;
  const seg = keyframed(view, at, f, count, shift);
  const offset = f - seg.start;
  const length = seg.end - seg.start;
  const index = curveIndex(tables, length, offset);
  const negative = -index;
  let weightNext: number;
  let sum: number;
  if (seg.start === 0) {
    weightNext = curveU16(tables, 0x80096c20 + negative);
    sum = curveU16(tables, 0x80096a1c + negative) * (seg.after - seg.current);
  } else {
    const back = curveU16(tables, 0x8009691c + index) * (seg.previous - seg.current);
    if (seg.end === count - 1) {
      weightNext = curveU16(tables, 0x80096c20 + negative) + curveU16(tables, 0x80096a1c + negative) + 0x2aab;
      sum = back;
    } else {
      sum = curveU16(tables, 0x80096a1c + negative) * (seg.after - seg.current) + back;
      weightNext = curveU16(tables, 0x80096b1e + negative);
    }
  }
  return ((sum + weightNext * (seg.next - seg.current)) >> 16) + seg.current;
}

/** All 49 channels of a motion at a frame, doubled as the game doubles them, as 16-bit values. */
export function sampleMotion(motion: Motion, frame: number, tables: MotionTables, out = new Int16Array(CHANNELS)): Int16Array {
  for (let c = 0; c < CHANNELS; c += 1) out[c] = sampleChannel(motion, c, frame, tables) << 1;
  return out;
}

/* ---- The pose: local rotations from the channels. ---- */

/** A rotation as 9 numbers, row-major, in units of 1 (not 4.12). */
export type Rotation = Float64Array;

const sinOf = (t: MotionTables, angle: number): number => (t.sine[((angle >> 4) & 0xfff)] ?? 0) / 4096;
const cosOf = (t: MotionTables, angle: number): number => (t.sine[((angle >> 4) & 0xfff) + 1024] ?? 0) / 4096;

/** Rz · Ry · Rx from three 16-bit angles. */
export function eulerMatrix(t: MotionTables, rx: number, ry: number, rz: number, out: Rotation): Rotation {
  const sx = sinOf(t, rx);
  const cx = cosOf(t, rx);
  const sy = sinOf(t, ry);
  const cy = cosOf(t, ry);
  const sz = sinOf(t, rz);
  const cz = cosOf(t, rz);
  out[0] = cy * cz;
  out[1] = sy * sx * cz - cx * sz;
  out[2] = sx * sz + sy * cx * cz;
  out[3] = cy * sz;
  out[4] = cx * cz + sy * sx * sz;
  out[5] = cx * sz * sy - sx * cz;
  out[6] = -sy;
  out[7] = sx * cy;
  out[8] = cy * cx;
  return out;
}

function multiply(a: Rotation, b: Rotation, out: Rotation): Rotation {
  const r = new Float64Array(9);
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      r[i * 3 + j] = (a[i * 3] ?? 0) * (b[j] ?? 0) + (a[i * 3 + 1] ?? 0) * (b[3 + j] ?? 0) + (a[i * 3 + 2] ?? 0) * (b[6 + j] ?? 0);
    }
  }
  out.set(r);
  return out;
}

function apply(m: Rotation, v: readonly number[]): [number, number, number] {
  return [
    (m[0] ?? 0) * (v[0] ?? 0) + (m[1] ?? 0) * (v[1] ?? 0) + (m[2] ?? 0) * (v[2] ?? 0),
    (m[3] ?? 0) * (v[0] ?? 0) + (m[4] ?? 0) * (v[1] ?? 0) + (m[5] ?? 0) * (v[2] ?? 0),
    (m[6] ?? 0) * (v[0] ?? 0) + (m[7] ?? 0) * (v[1] ?? 0) + (m[8] ?? 0) * (v[2] ?? 0),
  ];
}

function applyTransposed(m: Rotation, v: readonly number[]): [number, number, number] {
  return [
    (m[0] ?? 0) * (v[0] ?? 0) + (m[3] ?? 0) * (v[1] ?? 0) + (m[6] ?? 0) * (v[2] ?? 0),
    (m[1] ?? 0) * (v[0] ?? 0) + (m[4] ?? 0) * (v[1] ?? 0) + (m[7] ?? 0) * (v[2] ?? 0),
    (m[2] ?? 0) * (v[0] ?? 0) + (m[5] ?? 0) * (v[1] ?? 0) + (m[8] ?? 0) * (v[2] ?? 0),
  ];
}

/** A transform: a rotation and a translation in millimetres. */
interface Frame {
  r: Rotation;
  t: [number, number, number];
}

/** A child's rotation composed onto a parent, placed at a fixed offset from it. */
function attach(parent: Frame, child: Rotation, offset: readonly number[]): Frame {
  const r = multiply(parent.r, child, new Float64Array(9));
  const o = apply(parent.r, offset);
  return { r, t: [o[0] + parent.t[0], o[1] + parent.t[1], o[2] + parent.t[2]] };
}

/**
 * A two-bone limb aimed at `target` (in the limb root's frame), twisted about the
 * aim by `twist`, its two rotations written to `upper` and `lower`. Arms and legs have the game's
 * built-in lengths, and a limb out of reach is straight.
 */
function limb(t: MotionTables, target: [number, number, number], twist: number, arm: boolean, upper: Rotation, lower: Rotation): void {
  const length = Math.hypot(target[0], target[1], target[2]);
  if (length === 0) return;
  const nx = target[0] / length;
  const ny = target[1] / length;
  const nz = target[2] / length;
  /* The rotation taking the X axis onto the aim, by the game's own construction. */
  let a: number;
  let b: number;
  let g: number;
  const d = nx + 1;
  if (d === 0) {
    a = -0.5;
    b = ny / 2;
    g = -1;
  } else if (d < 2) {
    a = -1 / d;
    b = a * ny;
    g = 1;
  } else {
    a = -0.5;
    b = -ny / 2;
    g = 1;
  }
  const e = b * ny + g;
  const h = a * nz;
  const p = b * (g + nx);
  const q = h * (g + nx);
  const r = h * ny;
  const s = b * nz;
  const u = h * nz + 1;
  const c = cosOf(t, twist);
  const sn = sinOf(t, twist);
  upper[0] = nx;
  upper[3] = ny;
  upper[6] = nz;
  upper[1] = c * p + sn * q;
  upper[4] = c * e + sn * r;
  upper[7] = c * s + sn * u;
  upper[2] = -sn * p + c * q;
  upper[5] = -sn * e + c * r;
  upper[8] = -sn * s + c * u;
  lower.set([1, 0, 0, 0, 1, 0, 0, 0, 1]);

  const reach = arm ? 0x215 : 0x37b;
  const shortest = arm ? 0x47 : 3;
  const mm = Math.round(length);
  if (mm > reach || mm < shortest) return;
  const inverse = Math.trunc(0x400000 / mm);
  let cosUpper: number;
  let cosLower: number;
  if (arm) {
    const k = (inverse * 0x9204) >> 11;
    cosUpper = ((mm * 0x800 + k) * 0xd9) >> 16;
    cosLower = ((mm * 0x800 - k) * 0x11a) >> 16;
  } else {
    const k = (inverse * 0x6f8) >> 11;
    cosUpper = ((mm * 0x800 + k) * 0x92) >> 16;
    cosLower = ((mm * 0x800 - k) * 0x93) >> 16;
  }
  let sinUpper = 0;
  if (cosUpper > 0x1000) cosUpper = 0x1000;
  else if (cosUpper < -0x1000) cosUpper = -0x1000;
  else {
    sinUpper = Math.sqrt(0x1000000 - cosUpper * cosUpper);
    if (!arm) sinUpper = -sinUpper;
  }
  /* Bend the upper bone about its local Z. */
  const cu = cosUpper / 4096;
  const su = sinUpper / 4096;
  for (const row of [0, 3, 6]) {
    const x = upper[row] ?? 0;
    const y = upper[row + 1] ?? 0;
    upper[row] = x * cu + y * su;
    upper[row + 1] = -x * su + y * cu;
  }
  let sinLower = 0;
  if (cosLower > 0x1000) cosLower = 0x1000;
  else if (cosLower < -0x1000) cosLower = -0x1000;
  else sinLower = arm ? (sinUpper * -0x14d4) / 0x1000 : (sinUpper * -0x1012) / 0x1000;
  const cosBend = (cosUpper * cosLower + sinUpper * sinLower) / 0x1000000;
  const sinBend = (-sinUpper * cosLower + cosUpper * sinLower) / 0x1000000;
  lower.set([cosBend, -sinBend, 0, sinBend, cosBend, 0, 0, 0, 1]);
}

/** The joints whose rotations are Euler angles, in channel order (`0x8001a330`). */
const EULER_JOINTS = [0, 1, 11, 2, 3, 7, 6, 10, 14, 17];

/**
 * The 18 local joint rotations of a pose from its 49 channels: ten from Euler angles (three of them
 * corrected by the fix-up matrix), the four limbs by IK toward their targets.
 */
export function poseRotations(values: Int16Array, t: MotionTables, out: Rotation[] = Array.from({ length: 18 }, () => new Float64Array(9))): Rotation[] {
  for (const r of out) r.set([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  EULER_JOINTS.forEach((joint, i) => {
    eulerMatrix(t, values[19 + i * 3] ?? 0, values[20 + i * 3] ?? 0, values[21 + i * 3] ?? 0, out[joint]!);
  });
  const fix = new Float64Array(Array.from(t.fixup, (v) => v / 4096));
  for (const joint of [2, 3, 7]) multiply(out[joint]!, fix, out[joint]!);

  const offset = (i: number): [number, number, number] => [t.offsets[i * 3] ?? 0, t.offsets[i * 3 + 1] ?? 0, t.offsets[i * 3 + 2] ?? 0];
  const root: Frame = { r: out[0]!, t: [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0] };
  const chest = attach(root, out[1]!, offset(0));
  const shoulderA = attach(chest, out[3]!, offset(1));
  const shoulderB = attach(chest, out[7]!, offset(2));
  const hips = attach(root, out[11]!, offset(3));
  const local = (frame: Frame, target: number, add: number): [number, number, number] => {
    const d = applyTransposed(frame.r, [
      (values[target] ?? 0) - frame.t[0],
      (values[target + 1] ?? 0) - frame.t[1],
      (values[target + 2] ?? 0) - frame.t[2],
    ]);
    const o = offset(add);
    return [d[0] + o[0], d[1] + o[1], d[2] + o[2]];
  };
  limb(t, local(shoulderA, 3, 4), values[15] ?? 0, true, out[4]!, out[5]!);
  limb(t, local(shoulderB, 6, 5), values[16] ?? 0, true, out[8]!, out[9]!);
  limb(t, local(hips, 9, 6), values[17] ?? 0, false, out[12]!, out[13]!);
  limb(t, local(hips, 12, 7), values[18] ?? 0, false, out[15]!, out[16]!);
  return out;
}
