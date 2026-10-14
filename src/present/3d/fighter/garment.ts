/**
 * Cloth kept off the legs: a coat's panels, which an arcade board's model hangs on the hips alone
 * (`FighterMesh.garment`), and the tails it hangs from the hips on joints of their own, which a leg
 * swinging would pass through. At rest each leg runs straight down the hips' x
 * from its thigh's joint, as the model is made; a leg is its thigh, from its joint to its knee, and
 * its shin, from its knee to its ankle.
 *
 * A point of the cloth below the thigh's joint is kept as far from each part's line as it lies,
 * where the hips and its tails hold it, from the leg's line at rest, though no farther than the
 * part's surface lies that way (and a little more, so the surface stays under it): a part's
 * surface is how far its points lie from its line, by how far along it and by which way round
 * (`profileOf`). A panel's point is turned about where it hangs from, the way a part has swung: as
 * far as the part swung where the point lies square in its way and within its surface of its line
 * at rest, less as it lies aside or farther off, not at all where the part swung away (so a panel
 * stays over a raised thigh as it hung over it); and, where the part has come nearer still, the
 * least that keeps it clear. Each turn is spread along the cloth's edges, a point turning at least as far
 * as its neighbour less a little for every millimetre between them, so the cloth moves as one and
 * does not tear or fold. A point no turn keeps clear is put back out from the part's line, square
 * to it. A tail's point is never turned: it hangs where its spring holds it, and only where that is
 * too near a part is it put back out so. A point is near a part only level with it, between its
 * two ends.
 *
 * Points and frames are the game's: millimetres, a rotation's rows then a place.
 */
import type { Frame } from '../../../mod/kazuya/tekken4.ts';

/** The hips' joint, and each leg's joints: its thigh's, its knee's and its ankle's. */
export const HIPS = 11;
export const LEGS = [
  [12, 13, 14],
  [15, 16, 17],
] as const;

/** How finely a point's turn is sought: steps over a half turn, then halvings between the last two. */
const STEPS = 16;
const HALVINGS = 6;
/** How much less a point turns than its neighbour, a millimetre apart (a quarter turn over 150 mm); how many times the turns are spread. */
const EASING = Math.PI / 2 / 150;
const SPREADS = 8;
/** What the cloth keeps beyond a part's surface, millimetres. */
const MARGIN = 8;
/** A part's surface: by 40 mm along it, and by sixteenths of a turn round it. */
const ALONG = 40;
const ALONG_STEPS = 24;
const ROUND = 16;

/**
 * A leg's part as it is now, in the hips' frame: where it starts, the unit line along it, its
 * length, its joint's turn (a rotation's rows, the hips' frame); how far it has swung from rest,
 * about what axis and toward which side (square to the hips' x); where its leg's line runs at rest
 * (its y and z, from the thigh's joint at `top` down) and how far down it the part starts
 * (`from`); and its surface (`profileOf`).
 */
export interface LimbNow {
  readonly at: number[];
  readonly along: number[];
  length: number;
  readonly turn: number[];
  swing: number;
  readonly about: number[];
  readonly toward: number[];
  readonly line: number[];
  top: number;
  from: number;
  readonly surface: Float32Array;
}

export const newLimb = (surface: Float32Array): LimbNow => ({ at: [0, 0, 0], along: [1, 0, 0], length: 0, turn: [1, 0, 0, 0, 1, 0, 0, 0, 1], swing: 0, about: [0, 0, 1], toward: [0, 1, 0], line: [0, 0], top: 0, from: 0, surface });

/** `(x, y, z)` turned back by `r` (by its transpose), into `out`. */
export function unturn(r: ArrayLike<number>, x: number, y: number, z: number, out: number[]): void {
  for (let i = 0; i < 3; i += 1) out[i] = r[i]! * x + r[3 + i]! * y + r[6 + i]! * z;
}

/**
 * The part from joint `from` to joint `to` of the leg whose thigh is on `thigh`, as it lies in the
 * frame of `hips`, into `out`.
 */
export function placeLimb(hips: Frame, thigh: Frame, from: Frame, to: Frame, out: LimbNow): void {
  const r = hips.r;
  const top = [0, 0, 0];
  unturn(r, thigh.t[0]! - hips.t[0]!, thigh.t[1]! - hips.t[1]!, thigh.t[2]! - hips.t[2]!, top);
  out.top = top[0]!;
  out.line[0] = top[1]!;
  out.line[1] = top[2]!;
  unturn(r, from.t[0]! - hips.t[0]!, from.t[1]! - hips.t[1]!, from.t[2]! - hips.t[2]!, out.at);
  out.from = Math.hypot(from.t[0]! - thigh.t[0]!, from.t[1]! - thigh.t[1]!, from.t[2]! - thigh.t[2]!);
  for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) out.turn[i * 3 + j] = r[i]! * from.r[j]! + r[3 + i]! * from.r[3 + j]! + r[6 + i]! * from.r[6 + j]!;
  unturn(r, to.t[0]! - from.t[0]!, to.t[1]! - from.t[1]!, to.t[2]! - from.t[2]!, out.along);
  const length = Math.hypot(out.along[0]!, out.along[1]!, out.along[2]!);
  out.length = length;
  out.swing = 0;
  if (length === 0) return;
  for (let i = 0; i < 3; i += 1) out.along[i] = out.along[i]! / length;
  const [x, y, z] = out.along as [number, number, number];
  const aside = Math.hypot(y, z);
  if (aside === 0) return;
  out.swing = Math.atan2(aside, x);
  out.about[0] = 0;
  out.about[1] = -z / aside;
  out.about[2] = y / aside;
  out.toward[0] = 0;
  out.toward[1] = y / aside;
  out.toward[2] = z / aside;
}

/** How far a point that hangs at `p` (three at `i`) lies from its leg's line at rest: 0 where it is above the leg. */
function restOf(p: ArrayLike<number>, i: number, limb: LimbNow): number {
  if (limb.length === 0 || !(p[i]! > limb.top)) return 0;
  return Math.hypot(p[i + 1]! - limb.line[0]!, p[i + 2]! - limb.line[1]!);
}

/** Where `surface` lies `s` along its part, the way round of `(y, z)` (the part's frame). */
function surfaceAt(surface: Float32Array, s: number, y: number, z: number): number {
  const a = Math.min(ALONG_STEPS - 1, Math.max(0, Math.floor(s / ALONG)));
  const b = (Math.floor(((Math.atan2(z, y) / (2 * Math.PI)) * ROUND + ROUND) + 0.5) % ROUND + ROUND) % ROUND;
  return surface[a * ROUND + b]!;
}

/**
 * How far the point three at `i` of `p` (where it hangs, the legs aside) is carried round by the
 * part's swing: the whole swing where it lies square in the swing's way, within the part's surface
 * of the leg's line at rest and level with the part as it rests; less aside or farther off.
 */
function carried(p: ArrayLike<number>, i: number, limb: LimbNow): number {
  const rest = restOf(p, i, limb);
  const s = p[i]! - limb.top - limb.from;
  if (rest === 0 || limb.swing === 0 || !(s > 0 && s < limb.length)) return 0;
  const y = p[i + 1]! - limb.line[0]!;
  const z = p[i + 2]! - limb.line[1]!;
  const square = (y * limb.toward[1]! + z * limb.toward[2]!) / rest;
  const near = Math.min(1, Math.max(0, 2 - rest / (surfaceAt(limb.surface, s, y, z) + MARGIN)));
  return limb.swing * Math.max(0, square) * near;
}

/**
 * How much nearer than it is kept the point three at `i` of `p` lies to the part (0 or less where
 * it is clear, level with the part or not): `rest`, how far it lay from the leg's line at rest.
 */
function nearness(p: ArrayLike<number>, i: number, limb: LimbNow, rest: number): number {
  const { at, along, turn } = limb;
  const wx = p[i]! - at[0]!;
  const wy = p[i + 1]! - at[1]!;
  const wz = p[i + 2]! - at[2]!;
  const s = wx * along[0]! + wy * along[1]! + wz * along[2]!;
  if (rest === 0 || !(s > 0 && s < limb.length)) return 0;
  const y = wx * turn[1]! + wy * turn[4]! + wz * turn[7]!;
  const z = wx * turn[2]! + wy * turn[5]! + wz * turn[8]!;
  return Math.min(rest, surfaceAt(limb.surface, s, y, z) + MARGIN) - Math.hypot(wx - s * along[0]!, wy - s * along[1]!, wz - s * along[2]!);
}

/** The point three at `i` of `p` turned by `angle` about the unit `axis` through the hinge three at `i` of `hinges`, into `out` at `o`. */
function turnAbout(p: ArrayLike<number>, i: number, hinges: ArrayLike<number>, axis: readonly number[], angle: number, out: number[] | Float32Array, o: number): void {
  const [ax, ay, az] = axis as [number, number, number];
  const vx = p[i]! - hinges[i]!;
  const vy = p[i + 1]! - hinges[i + 1]!;
  const vz = p[i + 2]! - hinges[i + 2]!;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dot = (ax * vx + ay * vy + az * vz) * (1 - cos);
  out[o] = hinges[i]! + vx * cos + (ay * vz - az * vy) * sin + ax * dot;
  out[o + 1] = hinges[i + 1]! + vy * cos + (az * vx - ax * vz) * sin + ay * dot;
  out[o + 2] = hinges[i + 2]! + vz * cos + (ax * vy - ay * vx) * sin + az * dot;
}

const TRIED = [0, 0, 0];

/** The least turn about its hinge, the way `limb` swung, that keeps the point three at `i` of `p` clear of it (`rest` as `nearness` takes it): 0 where it is clear, the best where none is enough. */
function leastTurn(p: ArrayLike<number>, i: number, hinges: ArrayLike<number>, rest: number, limb: LimbNow): number {
  if (!(nearness(p, i, limb, rest) > 0) || limb.swing === 0) return 0;
  let clear = 0;
  let best = 0;
  let least = Infinity;
  for (let k = 1; k <= STEPS && clear === 0; k += 1) {
    turnAbout(p, i, hinges, limb.about, (k * Math.PI) / STEPS, TRIED, 0);
    const near = nearness(TRIED, 0, limb, rest);
    if (!(near > 0)) clear = (k * Math.PI) / STEPS;
    else if (near < least) [best, least] = [(k * Math.PI) / STEPS, near];
  }
  if (clear === 0) return best;
  let low = clear - Math.PI / STEPS;
  let high = clear;
  for (let k = 0; k < HALVINGS; k += 1) {
    const middle = (low + high) / 2;
    turnAbout(p, i, hinges, limb.about, middle, TRIED, 0);
    if (nearness(TRIED, 0, limb, rest) > 0) low = middle;
    else high = middle;
  }
  return high;
}

/**
 * Cloth kept off the legs: `points` (three a point, the hips' frame) where the hips and the tails
 * hold them, a panel's (those `turning` flags) turned about its hinge (`hinges`, three a point),
 * turns spread along `edges` (two points an edge) as far apart as `lengths` says, a tail's left;
 * then each put out where it is still too near; into `out` (three a point). `turns` is room for a
 * turn a point.
 */
export function keepClothOff(points: Float32Array, turning: Uint8Array, hinges: Float32Array, edges: Uint32Array, lengths: Float32Array, limbs: readonly LimbNow[], turns: Float32Array, out: Float32Array): void {
  out.set(points);
  const count = points.length / 3;
  for (const limb of limbs) {
    if (limb.length === 0 || limb.swing === 0) continue;
    let any = false;
    for (let g = 0; g < count; g += 1) {
      turns[g] = turning[g] === 0 ? 0 : Math.max(carried(points, g * 3, limb), leastTurn(out, g * 3, hinges, restOf(points, g * 3, limb), limb));
      if (turns[g]! > 0) any = true;
    }
    if (!any) continue;
    for (let pass = 0; pass < SPREADS; pass += 1) {
      for (let e = 0; e < edges.length; e += 2) {
        const [a, b] = [edges[e]!, edges[e + 1]!];
        const less = EASING * lengths[e >> 1]!;
        if (turns[b]! - less > turns[a]!) turns[a] = turns[b]! - less;
        if (turns[a]! - less > turns[b]!) turns[b] = turns[a]! - less;
      }
    }
    for (let g = 0; g < count; g += 1) if (turning[g] !== 0 && turns[g]! > 0 && restOf(points, g * 3, limb) > 0) turnAbout(out, g * 3, hinges, limb.about, turns[g]!, out, g * 3);
  }
  /* A point no turn kept clear: out from the line, square to it. */
  for (const limb of limbs) {
    const { at, along } = limb;
    for (let g = 0; g < count; g += 1) {
      const near = nearness(out, g * 3, limb, restOf(points, g * 3, limb));
      if (!(near > 0)) continue;
      const i = g * 3;
      const wx: number = out[i]! - at[0]!;
      const wy: number = out[i + 1]! - at[1]!;
      const wz: number = out[i + 2]! - at[2]!;
      const s: number = wx * along[0]! + wy * along[1]! + wz * along[2]!;
      const qx: number = wx - s * along[0]!;
      const qy: number = wy - s * along[1]!;
      const qz: number = wz - s * along[2]!;
      const d = Math.hypot(qx, qy, qz);
      if (d === 0) continue;
      const k = (d + near) / d;
      out[i] = at[0]! + s * along[0]! + qx * k;
      out[i + 1] = at[1]! + s * along[1]! + qy * k;
      out[i + 2] = at[2]! + s * along[2]! + qz * k;
    }
  }
}

/**
 * Where each of a garment's points hangs from (`points`, three a point, in the hips' frame; those
 * flagged in `garment`): the nearest of them not below `top` (the hips' x of the thighs' joints), or,
 * where there is none, the place above it level with `top`; three a point, into `out`.
 */
export function hingesOf(points: ArrayLike<number>, garment: ArrayLike<number>, top: number, out: Float32Array): void {
  const count = points.length / 3;
  for (let g = 0; g < count; g += 1) {
    if (!garment[g]) continue;
    const [x, y, z] = [points[g * 3]!, points[g * 3 + 1]!, points[g * 3 + 2]!];
    let best = -1;
    let nearest = Infinity;
    if (x > top) {
      for (let h = 0; h < count; h += 1) {
        if (!garment[h] || points[h * 3]! > top) continue;
        const d = Math.hypot(points[h * 3]! - x, points[h * 3 + 1]! - y, points[h * 3 + 2]! - z);
        if (d < nearest) [best, nearest] = [h, d];
      }
    }
    out[g * 3] = best < 0 ? Math.min(x, top) : points[best * 3]!;
    out[g * 3 + 1] = best < 0 ? y : points[best * 3 + 1]!;
    out[g * 3 + 2] = best < 0 ? z : points[best * 3 + 2]!;
  }
}

/**
 * A leg's part's surface: by how far along its line (the joint's x, from the joint on) and which way
 * round, the farthest any point weighing mostly on its joint lies from the line, over the mesh's
 * points (`joints`, `weights` and `points` as `FighterMesh` lays four a vertex), each place as far
 * as the places just above and below it; a way round no point lies at taken from the nearest ways
 * round that have one, on either side, and a place still without one from the farthest along the
 * part that way round, or round it.
 */
export function profileOf(joint: number, joints: ArrayLike<number>, weights: ArrayLike<number>, points: ArrayLike<number>): Float32Array {
  const raw = new Float32Array(ALONG_STEPS * ROUND);
  for (let k = 0; k < joints.length; k += 1) {
    if (joints[k] !== joint || !(weights[k]! >= 0.5) || points[k * 3]! < 0) continue;
    const [s, y, z] = [points[k * 3]!, points[k * 3 + 1]!, points[k * 3 + 2]!];
    const a = Math.min(ALONG_STEPS - 1, Math.floor(s / ALONG));
    const b = (Math.floor(((Math.atan2(z, y) / (2 * Math.PI)) * ROUND + ROUND) + 0.5) % ROUND + ROUND) % ROUND;
    raw[a * ROUND + b] = Math.max(raw[a * ROUND + b]!, Math.hypot(y, z));
  }
  /* Each way round no point lies at, from the nearest that have one on either side. */
  const filled = new Float32Array(raw);
  for (let a = 0; a < ALONG_STEPS; a += 1) {
    for (let b = 0; b < ROUND; b += 1) {
      if (raw[a * ROUND + b]! > 0) continue;
      let [left, right] = [0, 0];
      for (let d = 1; d < ROUND && left === 0; d += 1) left = raw[a * ROUND + ((b - d + ROUND) % ROUND)]!;
      for (let d = 1; d < ROUND && right === 0; d += 1) right = raw[a * ROUND + ((b + d) % ROUND)]!;
      filled[a * ROUND + b] = Math.max(left, right);
    }
  }
  const out = new Float32Array(ALONG_STEPS * ROUND);
  for (let a = 0; a < ALONG_STEPS; a += 1) {
    for (let b = 0; b < ROUND; b += 1) {
      let most = 0;
      for (const da of [-1, 0, 1]) if (a + da >= 0 && a + da < ALONG_STEPS) most = Math.max(most, filled[(a + da) * ROUND + b]!);
      out[a * ROUND + b] = most;
    }
  }
  /* A place no point lies near: as far as the farthest at that place round the part, then as far as the farthest anywhere. */
  const anywhere = Math.max(0, ...out);
  for (let b = 0; b < ROUND; b += 1) {
    let column = 0;
    for (let a = 0; a < ALONG_STEPS; a += 1) column = Math.max(column, out[a * ROUND + b]!);
    for (let a = 0; a < ALONG_STEPS; a += 1) if (out[a * ROUND + b] === 0) out[a * ROUND + b] = column === 0 ? anywhere : column;
  }
  return out;
}
