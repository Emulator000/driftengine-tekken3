/**
 * The accessories swinging on their springs: hair, ponytails, braids, sashes, the joints a model
 * hangs past its skeleton (18 to 21). Each frame, before the joint is placed, its local rotation
 * becomes its rest rotation turned by a yaw and a pitch toward where its spring wants its tip.
 *
 * The spring works in the frame of the accessory's rest on its parent as the parent now is. There
 * it takes the direction to where the tip was last frame (the joint's world matrix as last placed)
 * from where the joint now hangs, keeps its share of it, adds gravity's pull (none while that tip
 * lay at or below the floor, where it is held) and the rest's own direction for what is left; some
 * springs hang toward a point between the knees instead, some are held off a point on another
 * joint, and some are held within limits.
 */
import type { Spring, SpringAim, SpringClear } from '../data/skeleton.ts';
import type { MathTables } from '../data/tables.ts';
import { libraryAngle } from '../math/angles.ts';
import { s16 } from '../math/integers.ts';
import { multiply, newProduct, normalise, rotate, rotateLong, transpose, type Matrix } from '../math/matrix.ts';
import { libraryRoot, tableRoot } from '../math/roots.ts';
import { eulerRotation } from './skeleton.ts';
import type { FightData, FightState, Fighter, Skeleton } from './state.ts';

/** The first accessory's joint. */
export const FIRST_ACCESSORY = 0x12;
/** Each leg's lower joint, whose origin is its knee. */
const KNEES = [13, 16] as const;

const product = newProduct();
const scratch = {
  rest: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  intoRest: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  swing: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  tip: [0, 0, 0],
  pivot: [0, 0, 0],
  direction: [0, 0, 0],
  target: [0, 0, 0],
  point: [0, 0, 0],
};

/** A direction's yaw and pitch (`across` its length across x and z), by a spring's axes: each arctangent times its own factor. */
function anglesOf(math: MathTables, axes: readonly number[], x: number, y: number, z: number, across: number): [number, number] {
  const yaw = libraryAngle(Math.imul(axes[0]!, z), Math.imul(axes[1]!, x), math);
  const pitch = libraryAngle(Math.imul(axes[2]!, y), Math.imul(axes[3]!, across), math);
  return [Math.imul(yaw, axes[4]!), Math.imul(pitch, axes[5]!)];
}

/** A spring held off a point on another joint: the point's yaw and pitch from the pivot, and whether it lay behind. */
function aimAt(math: MathTables, sk: Skeleton, spring: Spring, aim: SpringAim, pivot: readonly number[]): { yaw: number; pitch: number; behind: boolean } {
  const { point, intoRest } = scratch;
  const on = sk.joints[aim.joint]!.world;
  rotateLong(on.rotation, aim.point[0]!, aim.point[1]!, aim.point[2]!, point);
  for (let i = 0; i < 3; i += 1) point[i] = (point[i]! + on.translation[i]! - pivot[i]!) | 0;
  rotateLong(intoRest, point[0]!, point[1]!, point[2]!, point);
  const [x, y, z] = point as [number, number, number];
  const behind = aim.behind !== null && x < 0;
  const axes = behind ? aim.behind!.aimAxes : spring.axes;
  const [yaw, pitch] = anglesOf(math, axes, x, y, z, tableRoot((Math.imul(x, x) + Math.imul(z, z)) | 0, math));
  return { yaw, pitch, behind };
}

/**
 * The target toward a point 128 mm from the first knee toward the second and 64 mm on along z,
 * from where the first accessory hung last frame, made 4.12 long; with the knees nearer than 128 mm
 * the target is left as it was.
 */
function betweenKnees(data: FightData, sk: Skeleton, target: number[]): void {
  const { point, intoRest } = scratch;
  const a = sk.joints[KNEES[0]]!.world.translation;
  const b = sk.joints[KNEES[1]]!.world.translation;
  const d = [0, 1, 2].map((i) => (b[i]! - a[i]!) | 0) as [number, number, number];
  const square = (((Math.imul(d[0], d[0]) + Math.imul(d[1], d[1])) | 0) + Math.imul(d[2], d[2])) | 0;
  if (square < 0x4000) return;
  let length = tableRoot(square, data.math);
  if (length === 0) length = 1;
  for (let i = 0; i < 3; i += 1) point[i] = ((((d[i]! << 7) / length) | 0) + a[i]!) | 0;
  point[2] = (point[2]! + 0x40) | 0;
  const hung = sk.joints[FIRST_ACCESSORY]!.world.translation;
  for (let i = 0; i < 3; i += 1) point[i] = (point[i]! - hung[i]!) | 0;
  rotateLong(intoRest, point[0]!, point[1]!, point[2]!, point);
  normalise(point[0]!, point[1]!, point[2]!, data.skeleton.inverseRoots, data.skeleton.inverseRootsBefore, target);
}

/** `x` over 4096, rounded toward zero. */
const over4096 = (x: number): number => ((x < 0 ? x + 0xfff : x) | 0) >> 12;
/** A 4.12 rotation applied to a long vector, its result over 4096, rounded toward minus infinity. */
function applyLong(m: readonly number[], x: number, y: number, z: number, out: number[]): void {
  for (let i = 0; i < 3; i += 1) out[i] = Math.floor((m[i * 3]! * x + m[i * 3 + 1]! * y + m[i * 3 + 2]! * z) / 4096);
}

/**
 * The tip kept out of a round about a line on another joint, as an arcade board's spring keeps it:
 * the line's two points (along the joint's x, a millimetre apart, in 4096ths) taken into the rest's
 * frame from the pivot, the point of the line nearest the tip, and the tip, where nearer than the
 * radius, put out on it; `target` the tip's direction (4.12) before, its place (mm) after. In the
 * board's 32-bit arithmetic.
 */
function keepClear(sk: Skeleton, spring: Spring, clear: SpringClear, pivot: readonly number[], target: number[]): void {
  const { intoRest } = scratch;
  const on = sk.joints[clear.joint]!.world;
  const [y, z] = clear.along;
  const ends = [0x1000, 0].map((x) => {
    const p = [0, 0, 0];
    applyLong(on.rotation, x, y << 12, z << 12, p);
    for (let i = 0; i < 3; i += 1) p[i] = (p[i]! + Math.imul(on.translation[i]!, 0x1000) - Math.imul(pivot[i]!, 0x1000)) | 0;
    applyLong(intoRest, p[0]!, p[1]!, p[2]!, p);
    return p.map((v) => v | 0);
  });
  const [far, near] = ends as [number[], number[]];
  const reach = spring.reach;
  const along = [0, 1, 2].map((i) => (far[i]! - near[i]!) | 0);
  const fromTip = [0, 1, 2].map((i) => (near[i]! - Math.imul(reach, target[i]!)) | 0);
  const t = over4096((Math.imul(fromTip[0]!, along[0]!) + Math.imul(fromTip[1]!, along[1]!) + Math.imul(fromTip[2]!, along[2]!)) | 0);
  const nearest = [0, 1, 2].map((i) => over4096((near[i]! - over4096(Math.imul(t, along[i]!))) | 0));
  const off = [0, 1, 2].map((i) => (over4096(Math.imul(reach, target[i]!)) - nearest[i]!) | 0);
  const square = (Math.imul(off[0]!, off[0]!) + Math.imul(off[1]!, off[1]!) + Math.imul(off[2]!, off[2]!)) | 0;
  if (!(square < Math.imul(clear.radius, clear.radius))) return;
  const length = Math.floor(Math.sqrt(square)) || 1;
  for (let i = 0; i < 3; i += 1) target[i] = ((Math.imul(over4096(Math.imul(reach, target[i]!)) - nearest[i]!, clear.radius) / length) | 0) + nearest[i]!;
}

/**
 * An accessory's local rotation this frame, on `parent` (its parent joint's world matrix, or the
 * root's). Paused or frozen, or with no spring, it is left as it was; on its first frame it hangs
 * at rest. A model pack past the game's springs (an added character's) hangs its accessories at
 * rest.
 */
export function swingAccessory(state: FightState, data: FightData, f: Fighter, joint: number, parent: Matrix): void {
  const k = joint - FIRST_ACCESSORY;
  const sk = f.skeleton;
  const local = sk.locals[joint]!;
  const rest = f.accessoryRest[k]!;
  /* A model's own accessories swing on their own springs; one with none hangs at rest. */
  const own = data.models[f.costume]?.accessories;
  const springs = own !== undefined ? own.map((accessory) => accessory?.spring ?? null) : data.skeleton.springs[f.costume];
  if (springs === undefined || (own !== undefined && springs[k] === null)) {
    eulerRotation(data.math, rest[0]!, rest[1]!, rest[2]!, local.rotation);
    f.accessoryHung[k] = 1;
    return;
  }
  if (state.pause.frozen !== 0 || state.pause.paused !== 0) return;
  const spring = springs[k];
  if (spring == null) return;
  if (f.accessoryHung[k] === 0) {
    f.accessoryHung[k] = 1;
    eulerRotation(data.math, rest[0]!, rest[1]!, rest[2]!, local.rotation);
    return;
  }
  const { rest: atRest, intoRest, swing, tip, pivot, direction, target } = scratch;
  const math = data.math;
  const self = sk.joints[joint]!;
  eulerRotation(math, rest[0]!, rest[1]!, rest[2]!, atRest);
  multiply(parent.rotation, atRest, swing);
  transpose(swing, intoRest);
  /* Where the tip was: its reach along the joint's x as last placed, followed over frames where the spring does. */
  rotate(self.world.rotation, spring.reach, 0, 0, product);
  for (let i = 0; i < 3; i += 1) tip[i] = (product.full[i]! + self.world.translation[i]!) | 0;
  if (spring.smoothing > 1) {
    const last = f.accessoryTips[k]!;
    for (let i = 0; i < 3; i += 1) last[i] = tip[i] = (((Math.imul(spring.smoothing - 1, last[i]!) + tip[i]!) | 0) / spring.smoothing) | 0;
  }
  /* Where the joint hangs now: its offset from its parent. */
  rotate(parent.rotation, local.translation[0]!, local.translation[1]!, local.translation[2]!, product);
  for (let i = 0; i < 3; i += 1) pivot[i] = (product.full[i]! + parent.translation[i]!) | 0;
  const fallen = tip[1]! >= 0;
  if (fallen) tip[1] = 0;
  rotateLong(intoRest, (tip[0]! - pivot[0]!) | 0, (tip[1]! - pivot[1]!) | 0, (tip[2]! - pivot[2]!) | 0, tip);
  normalise(tip[0]!, tip[1]!, tip[2]!, data.skeleton.inverseRoots, data.skeleton.inverseRootsBefore, direction);
  const pull = [0, 0, 0];
  if (!fallen) {
    const across = spring.lean ? spring.slant >> 4 : 0;
    rotate(intoRest, across, s16((0x100 - spring.slant) << 4), across, product);
    for (let i = 0; i < 3; i += 1) pull[i] = product.held[i]!;
  }
  for (let i = 0; i < 3; i += 1) {
    const v = (Math.imul(direction[i]!, spring.keep) + Math.imul(pull[i]!, spring.pull)) | 0;
    target[i] = (v < 0 ? v + 0xff : v) >> 8;
  }
  target[0] = (target[0]! + ((0x100 - (spring.keep + spring.pull)) << 4)) | 0;
  if (spring.clear !== null) keepClear(sk, spring, spring.clear, pivot, target);
  const aim = spring.aim === null ? null : aimAt(math, sk, spring, spring.aim, pivot);
  if (aim === null && spring.knees) betweenKnees(data, sk, target);
  const axes = aim !== null && aim.behind ? spring.aim!.behind!.axes : spring.axes;
  const [x, y, z] = target as [number, number, number];
  let [yaw, pitch] = anglesOf(math, axes, x, y, z, libraryRoot((Math.imul(x, x) + Math.imul(z, z)) | 0, math));
  if (aim !== null) {
    /* The point's aim is taken where it is the less, by the aim's weights. */
    const [byYaw, byPitch] = spring.aim!.weights;
    if (((Math.imul(byYaw, aim.yaw) + Math.imul(byPitch, aim.pitch)) | 0) < ((Math.imul(byYaw, yaw) + Math.imul(byPitch, pitch)) | 0)) {
      yaw = aim.yaw;
      pitch = aim.pitch;
    }
  }
  yaw <<= 4;
  pitch <<= 4;
  if (spring.yawHeld) yaw = 0;
  if (spring.pitchAtLeast !== null && pitch < spring.pitchAtLeast) pitch = spring.pitchAtLeast;
  if (spring.limits !== null) {
    const [most, least] = spring.limits;
    if (most < s16(yaw)) yaw = most;
    else if (s16(yaw) < least) yaw = least;
    if (most < s16(pitch)) pitch = most;
    else if (s16(pitch) < least) pitch = least;
  }
  eulerRotation(math, 0, s16(yaw), s16(pitch), swing);
  multiply(atRest, swing, local.rotation);
}
