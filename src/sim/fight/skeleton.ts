/**
 * A fighter's skeleton, built each frame as the original builds it: the local matrices of its 22
 * joints from the motion's 49 channels (ten joints by Euler angles, three of them corrected, and
 * each arm and leg by a two-bone solve toward the target the motion gives it), the root placed by
 * the fighter's position, lean and heading, and each joint's world matrix (its parent's times its
 * local) and its camera-space matrix.
 *
 * Channels: 0 to 2 the root's position, 3 to 14 the hands' and feet's targets, 15 to 18 the limbs'
 * twists, 19 on the Euler angles, three a joint.
 */
import type { SkeletonTables } from '../data/skeleton.ts';
import type { MathTables } from '../data/tables.ts';
import { s16, s8 } from '../math/integers.ts';
import { addScaled, attach, copyMatrix, cross, multiplyInto, newMatrix, normalise, rotateLong, toCameraSpace, transpose, type Matrix } from '../math/matrix.ts';
import { libraryRoot } from '../math/roots.ts';

/** The sine and cosine of a 16-bit turn, from the 4096-step table. */
export const sineOf = (math: MathTables, turn: number): number => math.sine[(turn >> 4) & 0xfff]!;
export const cosineOf = (math: MathTables, turn: number): number => math.sine[((turn >> 4) & 0xfff) + 0x400]!;
const product = (a: number, b: number): number => (a * b) >> 12;

/** Rz · Ry · Rx from three 16-bit turns, into a rotation's entries. */
export function eulerRotation(math: MathTables, rx: number, ry: number, rz: number, out: number[]): void {
  const sx = sineOf(math, rx);
  const cx = cosineOf(math, rx);
  const sy = sineOf(math, ry);
  const cy = cosineOf(math, ry);
  const sz = sineOf(math, rz);
  const cz = cosineOf(math, rz);
  const a1 = product(sx, cz);
  const a2 = product(sx, sz);
  const cxcz = product(cx, cz);
  const cxsz = product(cx, sz);
  out[7] = s16(product(sx, cy));
  out[6] = s16(-sy);
  out[1] = s16(product(sy, a1) - cxsz);
  out[4] = s16(cxcz + product(sy, a2));
  out[2] = s16(a2 + product(sy, cxcz));
  out[5] = s16(product(cxsz, sy) - a1);
  out[0] = s16(product(cy, cz));
  out[3] = s16(product(cy, sz));
  out[8] = s16(product(cy, cx));
}

/** The root's rotation from three 16-bit turns, in its own order. */
export function rootRotation(math: MathTables, rx: number, ry: number, rz: number, out: number[]): void {
  const sx = sineOf(math, rx);
  const cx = cosineOf(math, rx);
  const sy = sineOf(math, ry);
  const cy = cosineOf(math, ry);
  const sz = sineOf(math, rz);
  const cz = cosineOf(math, rz);
  const a1 = product(sx, cz);
  const a2 = product(sx, sz);
  const cxcz = product(cx, cz);
  const cxsz = product(cx, sz);
  out[5] = s16(-product(sx, cy));
  out[2] = s16(sy);
  out[3] = s16(product(sy, a1) + cxsz);
  out[4] = s16(cxcz - product(sy, a2));
  out[6] = s16(a2 - product(sy, cxcz));
  out[7] = s16(product(cxsz, sy) + a1);
  out[0] = s16(product(cy, cz));
  out[1] = s16(product(cy, -sz));
  out[8] = s16(product(cy, cx));
}

/** The first two columns of a rotation turned by an angle given as its sine and cosine. */
function bend(m: number[], s: number, c: number): void {
  for (const row of [0, 3, 6]) {
    const x = m[row]!;
    const y = m[row + 1]!;
    m[row] = s16((x * c + y * s) >> 12);
    m[row + 1] = s16((-x * s + y * c) >> 12);
  }
}

function straighten(lower: number[]): void {
  lower.fill(0);
  lower[0] = 0x1000;
  lower[4] = 0x1000;
  lower[8] = 0x1000;
}

/**
 * A two-bone limb toward a target in the limb root's frame, twisted about the aim: the upper bone's
 * rotation into `upper`, the lower's into `lower`. The arm and the leg have their own lengths;
 * beyond reach the limb is straight, too close the lower bone is left as it was.
 */
function limb(math: MathTables, target: readonly number[], twist: number, upper: number[], lower: number[], arm: boolean): void {
  const [tx, ty, tz] = [target[0]!, target[1]!, target[2]!];
  const square = tx * tx + ty * ty + tz * tz;
  if (square === 0) return;
  const length = libraryRoot(square | 0, math);
  const inverse = (0x400000 / length) | 0;
  const nx = (tx * inverse) >> 10;
  let d = nx + 0x1000;
  const ny = (ty * inverse) >> 10;
  const nz = (tz * inverse) >> 10;
  let b: number;
  let g: number;
  if (d === 0) {
    d = -0x800;
    b = (ty * inverse) >> 11;
    g = -0x1000;
  } else {
    if (d < 0x2000) {
      d = (-0x1000000 / d) | 0;
      b = (d * ny) >> 12;
    } else {
      d = -0x800;
      b = -ny >> 1;
    }
    g = 0x1000;
  }
  const e = ((b * ny) >> 12) + g;
  const h = (d * nz) >> 12;
  upper[0] = s16(nx);
  upper[3] = s16(ny);
  upper[6] = s16(nz);
  const c = cosineOf(math, twist);
  const s = sineOf(math, twist);
  const p = (b * (g + nx)) >> 12;
  const q = (h * (g + nx)) >> 12;
  const r = (h * ny) >> 12;
  const t = (b * nz) >> 12;
  const u = ((h * nz) >> 12) + 0x1000;
  upper[1] = s16((c * p + s * q) >> 12);
  upper[4] = s16((c * e + s * r) >> 12);
  upper[7] = s16((c * t + s * u) >> 12);
  upper[2] = s16((-s * p + c * q) >> 12);
  upper[5] = s16((-s * e + c * r) >> 12);
  upper[8] = s16((-s * t + c * u) >> 12);
  let upperCos: number;
  let lowerCos: number;
  if (!arm) {
    if (length > 0x37b) return straighten(lower);
    if (length < 3) return;
    const k = (inverse * 0x6f8) >> 11;
    upperCos = (length * 0x800 + k) * 0x92;
    lowerCos = (length * 0x800 - k) * 0x93;
  } else {
    if (length > 0x215) return straighten(lower);
    if (length < 0x47) return;
    const k = (inverse * 0x9204) >> 11;
    upperCos = (length * 0x800 + k) * 0xd9;
    lowerCos = (length * 0x800 - k) * 0x11a;
  }
  upperCos >>= 16;
  lowerCos >>= 16;
  let upperSin = 0;
  if (upperCos > 0x1000) upperCos = 0x1000;
  else if (upperCos < -0x1000) upperCos = -0x1000;
  else {
    upperSin = libraryRoot(0x1000000 - upperCos * upperCos, math);
    if (!arm) upperSin = -upperSin;
  }
  bend(upper, s16(upperSin), upperCos);
  let lowerSin = 0;
  if (lowerCos > 0x1000) lowerCos = 0x1000;
  else if (lowerCos < -0x1000) lowerCos = -0x1000;
  else lowerSin = arm ? (upperSin * -0x14d4) >> 12 : (upperSin * -0x1012) >> 12;
  let cosine = upperCos * lowerCos + upperSin * lowerSin;
  if (cosine < 0) cosine += 0xfff;
  let sine = -upperSin * lowerCos + upperCos * lowerSin;
  if (sine < 0) sine += 0xfff;
  lower[0] = s16(cosine >> 12);
  lower[4] = s16(cosine >> 12);
  lower[1] = s16(-(sine >> 12));
  lower[3] = s16(sine >> 12);
  lower[5] = 0;
  lower[7] = 0;
  lower[6] = 0;
  lower[2] = 0;
  lower[8] = 0x1000;
}

const scratch = { root: newMatrix(), chest: newMatrix(), shoulders: [newMatrix(), newMatrix()], hips: newMatrix(), frame: [0, 0, 0, 0, 0, 0, 0, 0, 0] };

/** A point (three shorts) in a frame whose rotation is `frame` (transposed), from `origin`, plus `add`. */
function toLocal(frame: readonly number[], x: number, y: number, z: number, origin: readonly number[], add: readonly number[], out: number[]): void {
  rotateLong(frame, s16(x) - origin[0]!, s16(y) - origin[1]!, s16(z) - origin[2]!, out);
  for (let i = 0; i < 3; i += 1) out[i] = (out[i]! + add[i]!) | 0;
}

/** The 22 local rotations of a pose from its channels (only rotations: each local's translation is its joint's offset, set when the character loads). */
export function localRotations(math: MathTables, skeleton: SkeletonTables, channels: ArrayLike<number>, locals: readonly Matrix[]): void {
  for (let i = 0; i < 10; i += 1) {
    const at = 19 + i * 3;
    eulerRotation(math, channels[at]!, channels[at + 1]!, channels[at + 2]!, locals[skeleton.eulerJoints[i]!]!.rotation);
  }
  for (const joint of [2, 3, 7]) multiplyInto(locals[joint]!.rotation, skeleton.fixup);
  const { root, chest, shoulders, hips, frame } = scratch;
  for (let i = 0; i < 9; i += 1) root.rotation[i] = locals[0]!.rotation[i]!;
  for (let i = 0; i < 3; i += 1) root.translation[i] = s16(channels[i]!);
  const offsets = skeleton.offsets;
  attach(root, locals[1]!, chest, offsets.chest);
  attach(chest, locals[3]!, shoulders[0]!, offsets.shoulders[0]);
  attach(chest, locals[7]!, shoulders[1]!, offsets.shoulders[1]);
  attach(root, locals[11]!, hips, offsets.hips);
  const targets = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  transpose(shoulders[0]!.rotation, frame);
  toLocal(frame, channels[3]!, channels[4]!, channels[5]!, shoulders[0]!.translation, offsets.hands[0], targets[0]!);
  transpose(shoulders[1]!.rotation, frame);
  toLocal(frame, channels[6]!, channels[7]!, channels[8]!, shoulders[1]!.translation, offsets.hands[1], targets[1]!);
  transpose(hips.rotation, frame);
  toLocal(frame, channels[9]!, channels[10]!, channels[11]!, hips.translation, offsets.feet[0], targets[2]!);
  toLocal(frame, channels[12]!, channels[13]!, channels[14]!, hips.translation, offsets.feet[1], targets[3]!);
  limb(math, targets[0]!, channels[15]!, locals[4]!.rotation, locals[5]!.rotation, true);
  limb(math, targets[1]!, channels[16]!, locals[8]!.rotation, locals[9]!.rotation, true);
  limb(math, targets[2]!, channels[17]!, locals[12]!.rotation, locals[13]!.rotation, false);
  limb(math, targets[3]!, channels[18]!, locals[15]!.rotation, locals[16]!.rotation, false);
}

/** A blended rotation made orthonormal again: column 0, column 1 off it, their cross. */
export function orthonormalise(skeleton: SkeletonTables, m: readonly number[], out: number[]): void {
  const c0 = [0, 0, 0];
  normalise(m[0]!, m[3]!, m[6]!, skeleton.inverseRoots, skeleton.inverseRootsBefore, c0);
  out[0] = s16(c0[0]!);
  out[3] = s16(c0[1]!);
  out[6] = s16(c0[2]!);
  const along = (s16(m[1]!) * c0[0]! + s16(m[4]!) * c0[1]! + s16(m[7]!) * c0[2]!) >> 12;
  const c1 = [0, 0, 0];
  normalise(m[1]! - ((along * c0[0]!) >> 12), m[4]! - ((along * c0[1]!) >> 12), m[7]! - ((along * c0[2]!) >> 12), skeleton.inverseRoots, skeleton.inverseRootsBefore, c1);
  out[1] = s16(c1[0]!);
  out[4] = s16(c1[1]!);
  out[7] = s16(c1[2]!);
  const c2 = [0, 0, 0];
  cross(c0, c1, c2);
  out[2] = s16(c2[0]!);
  out[5] = s16(c2[1]!);
  out[8] = s16(c2[2]!);
}

/** A blend's step on each joint 1 to 17: the local rotation plus its delta scaled by `weight`, made orthonormal. */
export function blendLocals(skeleton: SkeletonTables, locals: readonly Matrix[], deltas: readonly (readonly number[])[], weight: number): void {
  const blended = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let j = 1; j < 0x12; j += 1) {
    addScaled(deltas[j - 1]!, locals[j]!.rotation, weight, blended);
    orthonormalise(skeleton, blended, locals[j]!.rotation);
  }
}

/** A joint's world matrix on its parent and its camera-space matrix. */
export function placeJoint(parent: Matrix, local: Matrix, camera: Matrix, world: Matrix, view: Matrix): void {
  attach(parent, local, world);
  toCameraSpace(camera, world, view);
}

export { copyMatrix, s8 };
