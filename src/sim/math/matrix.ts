/**
 * Fixed-point matrices as the fight keeps its skeleton and camera: a rotation of nine entries in
 * 4.12, row-major, and a translation of three 32-bit values. The products follow the original's
 * geometry unit exactly: sums taken whole, shifted right by 12 as a floor, kept to 32 bits, and,
 * where the unit holds a result in a 16-bit register, saturated to -0x8000..0x7fff. Inputs the unit
 * takes in 16-bit registers are cut to 16 bits first.
 */
import { s16 } from './integers.ts';

export interface Matrix {
  readonly rotation: number[];
  readonly translation: number[];
}

export const newMatrix = (): Matrix => ({ rotation: [0, 0, 0, 0, 0, 0, 0, 0, 0], translation: [0, 0, 0] });

export function copyMatrix(from: Matrix, to: Matrix): void {
  for (let i = 0; i < 9; i += 1) to.rotation[i] = from.rotation[i]!;
  for (let i = 0; i < 3; i += 1) to.translation[i] = from.translation[i]!;
}

/** A 16-bit register's hold on a value. */
export const saturate = (v: number): number => (v < -0x8000 ? -0x8000 : v > 0x7fff ? 0x7fff : v);

/** The unit's results: `full` kept to 32 bits, `held` saturated to 16. */
export interface Product {
  readonly full: number[];
  readonly held: number[];
}
export const newProduct = (): Product => ({ full: [0, 0, 0], held: [0, 0, 0] });

/** `rotation` times the vector (each component cut to 16 bits), shifted by 12 when `shift`. */
export function rotate(rotation: readonly number[], x: number, y: number, z: number, out: Product, shift = true): void {
  const vx = s16(x);
  const vy = s16(y);
  const vz = s16(z);
  for (let row = 0; row < 3; row += 1) {
    const sum = rotation[row * 3]! * vx + rotation[row * 3 + 1]! * vy + rotation[row * 3 + 2]! * vz;
    const value = shift ? Math.floor(sum / 4096) : sum;
    out.full[row] = value | 0;
    out.held[row] = saturate(value) | 0;
  }
}

const column = newProduct();
const columns = [newProduct(), newProduct(), newProduct()];

/** The columns of `rotation · b`, each held to 16 bits, into `out` (which may be `b`). */
function rotateColumns(rotation: readonly number[], b: readonly number[], out: number[]): void {
  for (let j = 0; j < 3; j += 1) rotate(rotation, b[j]!, b[3 + j]!, b[6 + j]!, columns[j]!);
  for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) out[i * 3 + j] = columns[j]!.held[i]!;
}

/** `a = a · b`, rotations only. */
export function multiplyInto(a: number[], b: readonly number[]): void {
  rotateColumns(a, b, a);
}

/** `out = a · b`, rotations only. */
export function multiply(a: readonly number[], b: readonly number[], out: number[]): void {
  rotateColumns(a, b, out);
}

/**
 * A child placed on its parent: the rotation is parent · child, the translation the parent's
 * rotation of `offset` (each component cut to 16 bits) plus the parent's translation.
 */
export function attach(parent: Matrix, child: Matrix, out: Matrix, offset: readonly number[] = child.translation): void {
  const rotated: number[] = [];
  rotateColumns(parent.rotation, child.rotation, rotated);
  rotate(parent.rotation, offset[0]!, offset[1]!, offset[2]!, column);
  const t0 = (column.full[0]! + parent.translation[0]!) | 0;
  const t1 = (column.full[1]! + parent.translation[1]!) | 0;
  const t2 = (column.full[2]! + parent.translation[2]!) | 0;
  for (let i = 0; i < 9; i += 1) out.rotation[i] = rotated[i]!;
  out.translation[0] = t0;
  out.translation[1] = t1;
  out.translation[2] = t2;
}

const high = newProduct();
const low = newProduct();

/**
 * `rotation` times a vector of 32-bit components, as the geometry library takes a long vector:
 * each component's bits above 15 multiplied unshifted and scaled by 8, the 15 below shifted, summed.
 */
export function rotateLong(rotation: readonly number[], x: number, y: number, z: number, out: number[]): void {
  const split = (c: number): [number, number] => (c < 0 ? [-(-c >> 15), -(-c & 0x7fff)] : [c >> 15, c & 0x7fff]);
  const [hx, lx] = split(x);
  const [hy, ly] = split(y);
  const [hz, lz] = split(z);
  rotate(rotation, hx, hy, hz, high, false);
  rotate(rotation, lx, ly, lz, low, true);
  for (let i = 0; i < 3; i += 1) {
    const h = high.full[i]!;
    const scaled = h < 0 ? -((-h << 3) | 0) : (h << 3) | 0;
    out[i] = (low.full[i]! + scaled) | 0;
  }
}

/** The transpose of a rotation. */
export function transpose(rotation: readonly number[], out: number[]): void {
  const e = rotation.slice();
  for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) out[i * 3 + j] = e[j * 3 + i]!;
}

/**
 * A world matrix into the camera's space: the camera's rotation times the world's, and the
 * camera's rotation of the world's translation (a long vector) plus the camera's translation.
 */
export function toCameraSpace(camera: Matrix, world: Matrix, out: Matrix): void {
  const rotated: number[] = [];
  rotateColumns(camera.rotation, world.rotation, rotated);
  const moved: number[] = [0, 0, 0];
  rotateLong(camera.rotation, world.translation[0]!, world.translation[1]!, world.translation[2]!, moved);
  for (let i = 0; i < 9; i += 1) out.rotation[i] = rotated[i]!;
  for (let i = 0; i < 3; i += 1) out.translation[i] = (moved[i]! + camera.translation[i]!) | 0;
}

/** Each entry of `delta` scaled by `weight` (4.12, both cut to 16 bits, the product held to 16) plus `base`'s, cut to 16 bits. */
export function addScaled(delta: readonly number[], base: readonly number[], weight: number, out: number[]): void {
  const w = s16(weight);
  for (let i = 0; i < 9; i += 1) out[i] = s16(saturate(Math.floor((w * s16(delta[i]!)) / 4096)) + base[i]!);
}

/**
 * A vector made 4.12 long by the inverse-root table: its square length's leading bits pick the
 * table's entry (`inverseRoots`, or for the lengths that overflow and the zero vector the entries
 * before it, `inverseRootsBefore`), each component scaled by it.
 */
export function normalise(x: number, y: number, z: number, inverseRoots: Int16Array, inverseRootsBefore: Int16Array, out: number[]): void {
  const vx = s16(x);
  const vy = s16(y);
  const vz = s16(z);
  const sum = (((vx * vx) | 0) + ((vy * vy) | 0) + ((vz * vz) | 0)) | 0;
  const lead = sum < 0 ? 0 : (sum === 0 ? 32 : Math.clz32(sum)) & 0x1e;
  const shift = (0x1f - lead) >> 1;
  const top = lead >= 0x18 ? sum << (lead - 0x18) : sum >> (0x18 - lead);
  const at = top - 0x40;
  const scale = s16(at >= 0 ? inverseRoots[at]! : inverseRootsBefore[at + inverseRootsBefore.length]!);
  out[0] = ((scale * vx) | 0) >> shift;
  out[1] = ((scale * vy) | 0) >> shift;
  out[2] = ((scale * vz) | 0) >> shift;
}

/** The cross product a × b in 4.12, each input cut to 16 bits, kept to 32 bits. */
export function cross(a: readonly number[], b: readonly number[], out: number[]): void {
  const [d1, d2, d3] = [s16(a[0]!), s16(a[1]!), s16(a[2]!)];
  const [x, y, z] = [s16(b[0]!), s16(b[1]!), s16(b[2]!)];
  out[0] = Math.floor((z * d2 - y * d3) / 4096) | 0;
  out[1] = Math.floor((x * d3 - z * d1) / 4096) | 0;
  out[2] = Math.floor((y * d1 - x * d2) / 4096) | 0;
}
