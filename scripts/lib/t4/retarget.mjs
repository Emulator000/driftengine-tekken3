/**
 * A Tekken 4 pose as Tekken 3's 49 motion channels, for a Tekken 4 character carried into the port.
 *
 * Tekken 3 drives ten joints by Euler angles and its four limbs by IK (`src/motion/motion.ts`,
 * `poseRotations`): each limb aimed at a target in character space, measured through a generic
 * skeleton (upper arm 302 mm, forearm 232, thigh 449, shin 446, by its IK constants), with a twist
 * about the aim. Tekken 4 turns every joint (`motion.mjs`). Its skeleton is Tekken 3's in shape:
 *
 *   Tekken 3 joint   0 root  1 chest  2 head  3 4 5 6 shoulder to hand (A, the left)  7 8 9 10 (B)
 *   Tekken 4 node    0       1 · 2    3 · 4  5 6 7 8                                  9 10 11 12
 *   Tekken 3 joint   11 hips  12 13 14 thigh to foot (A)  15 16 17 (B)
 *   Tekken 4 node    13       14 15 16                     18 19 20
 *
 * Character space differs by a half turn about X: Tekken 4 is Y up and faces +Z, Tekken 3 Y down
 * and faces -Z. That turn is put on the root alone, so every other local rotation carries across
 * as it is, Tekken 3's chest and head taking two of Tekken 4's joints each.
 *
 * Rotations here are 3 × 3 arrays, row-major, acting on column vectors (Tekken 3's convention);
 * Tekken 4's row-vector matrices are their transposes.
 */
import { CONVENTIONS } from '../../../src/mod/kazuya/tekken4.ts';
import { groupQuaternion, isRotation, NODE_OF_GROUP } from './motion.mjs';

const TURN = 65536;
const toAngle = (radians) => Math.round((radians / (2 * Math.PI)) * TURN);
/** The generic limbs Tekken 3's IK assumes, from its constants. */
const ARM = { upper: 302, lower: 232, reach: 0x215, shortest: 0x47 };
const LEG = { upper: 449, lower: 446, reach: 0x37b, shortest: 3 };

/* ---- Small linear algebra on column-vector rotations. ---- */

export const mul = (a, b) => {
  const r = new Array(9);
  for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
};
export const transpose = (m) => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
export const apply = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => scale(a, 1 / (norm(a) || 1));
const column = (m, k) => [m[k], m[3 + k], m[6 + k]];
/** Rotation about a unit axis by an angle (radians). */
function axisAngle(axis, angle) {
  const [x, y, z] = axis;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c];
}

/** A Tekken 4 rotation group as the column-vector local rotation it gives its node. */
export function groupRotation(a, b, c) {
  const [x, y, z, w] = groupQuaternion(a, b, c);
  /* The conjugate's rotation: the transpose of the quaternion's own. */
  return [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)];
}

/** Tekken 3's Rz · Ry · Rx (`eulerMatrix` in `src/motion/motion.ts`), read back into three 16-bit angles. */
export function eulerAngles(m) {
  const sy = Math.max(-1, Math.min(1, -m[6]));
  const y = Math.asin(sy);
  let x;
  let z;
  if (Math.abs(sy) < 0.99999) {
    x = Math.atan2(m[7], m[8]);
    z = Math.atan2(m[3], m[0]);
  } else {
    x = Math.atan2(-m[5], m[4]);
    z = 0;
  }
  return [toAngle(x), toAngle(y), toAngle(z)];
}

/** The half turn about X between the two character spaces. */
const FLIP = [1, 0, 0, 0, -1, 0, 0, 0, -1];

/** Where the two games' joint frames differ (`src/mod/kazuya/tekken4.ts`). */
const convention = (joint) => CONVENTIONS[joint] ?? [1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * Tekken 3's IK (`limb` in `src/motion/motion.ts`) for a target at `length` mm: the cosines and
 * sines of the upper bend (about the aim frame's Z) and of the elbow or knee, in the game's fixed
 * point.
 */
function ikBend(length, limb, arm) {
  if (length > limb.reach || length < limb.shortest) return null;
  const inverse = Math.trunc(0x400000 / length);
  let cosUpper;
  let cosLower;
  if (arm) {
    const k = (inverse * 0x9204) >> 11;
    cosUpper = ((length * 0x800 + k) * 0xd9) >> 16;
    cosLower = ((length * 0x800 - k) * 0x11a) >> 16;
  } else {
    const k = (inverse * 0x6f8) >> 11;
    cosUpper = ((length * 0x800 + k) * 0x92) >> 16;
    cosLower = ((length * 0x800 - k) * 0x93) >> 16;
  }
  cosUpper = Math.max(-0x1000, Math.min(0x1000, cosUpper));
  let sinUpper = Math.sqrt(0x1000000 - cosUpper * cosUpper);
  if (!arm) sinUpper = -sinUpper;
  cosLower = Math.max(-0x1000, Math.min(0x1000, cosLower));
  const sinLower = arm ? (sinUpper * -0x14d4) / 0x1000 : (sinUpper * -0x1012) / 0x1000;
  const bendCos = (cosUpper * cosLower + sinUpper * sinLower) / 0x1000000;
  const bendSin = (-sinUpper * cosLower + cosUpper * sinLower) / 0x1000000;
  return { upper: Math.atan2(sinUpper, cosUpper), bend: Math.atan2(bendSin, bendCos) };
}

/** The game's frame for an aim, before its twist (as its IK builds it): columns n, c1, c2. */
function aimFrame(n) {
  const [nx, ny, nz] = n;
  let a;
  let b;
  let g;
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
  return { c1: [b * (g + nx), e, b * nz], c2: [h * (g + nx), h * ny, h * nz + 1] };
}

/** Which way about its frame's Z Tekken 3's IK bends a limb: the sign of its bend angle. */
const bendSign = (limb, arm) => Math.sign(ikBend(Math.round((limb.shortest + limb.reach) / 2), limb, arm).bend) || 1;

/**
 * The target (in the limb root's frame, from the upper joint) and twist that make Tekken 3's IK give
 * an upper bone along `upperX` and a bend of the joint below as close as it can to `bend` radians,
 * the bend's axis `axis` (all in the limb root's frame). `bones` are the character's own two
 * lengths, which place the limb's end: within reach the IK always leaves a little bend, so a limb
 * nearly straight is drawn straight instead when that puts its end nearer, aimed at that end.
 */
function solveLimb(upperX, lowerX, axisIn, bendIn, limb, arm, bones) {
  /* The game bends a limb one way about its frame's Z; turning the axis round turns the angle too. */
  const sign = bendSign(limb, arm);
  const axis = sign < 0 ? scale(axisIn, -1) : axisIn;
  const bend = sign < 0 ? -bendIn : bendIn;
  let best = null;
  for (let length = limb.shortest; length <= limb.reach; length += 1) {
    const ik = ikBend(length, limb, arm);
    if (ik === null) continue;
    const error = Math.abs(ik.bend - bend);
    if (best === null || error < best.error) best = { length, ik, error };
  }
  const end = add(scale(upperX, bones[0]), scale(lowerX, bones[1]));
  /* Where the bent candidate puts the end: the upper bone as asked, the lower turned by its bend. */
  const bentEnd = add(scale(upperX, bones[0]), scale(apply(axisAngle(axis, best.ik.bend), upperX), bones[1]));
  const straightEnd = scale(unit(end), bones[0] + bones[1]);
  if (norm(sub(straightEnd, end)) < norm(sub(bentEnd, end))) {
    const aim = unit(end);
    const { c1, c2 } = aimFrame(aim);
    /* A straight limb's roll still follows the upper bone's own Z. */
    const roll = unit(sub(axis, scale(aim, dot(axis, aim))));
    const twist = Math.atan2(-dot(roll, c1), dot(roll, c2));
    return { target: scale(aim, limb.reach + 1), twist: toAngle(twist), ik: { upper: 0, bend: 0 }, aim };
  }
  /* The upper bone is the aim turned by the upper angle about the bend's axis: undo that. */
  const aim = unit(apply(axisAngle(axis, -best.ik.upper), upperX));
  const { c1, c2 } = aimFrame(aim);
  const twist = Math.atan2(-dot(axis, c1), dot(axis, c2));
  return { target: scale(aim, best.length), twist: toAngle(twist), ik: best.ik, aim };
}

/** The IK's two rotations for a solved limb, as the game builds them. */
function limbRotations(solved) {
  const { aim, ik } = solved;
  const { c1, c2 } = aimFrame(aim);
  const t = (solved.twist / TURN) * 2 * Math.PI;
  const k1 = add(scale(c1, Math.cos(t)), scale(c2, Math.sin(t)));
  const k2 = add(scale(c1, -Math.sin(t)), scale(c2, Math.cos(t)));
  const cu = Math.cos(ik.upper);
  const su = Math.sin(ik.upper);
  const x = add(scale(aim, cu), scale(k1, su));
  const y = add(scale(aim, -su), scale(k1, cu));
  const upper = [x[0], y[0], k2[0], x[1], y[1], k2[1], x[2], y[2], k2[2]];
  const cb = Math.cos(ik.bend);
  const sb = Math.sin(ik.bend);
  return { upper, lower: [cb, -sb, 0, sb, cb, 0, 0, 0, 1] };
}

/** A node's rest rotation (`CHRTK4`'s Rx · Ry · Rz, row vectors) as a column-vector rotation. */
export function restRotation([rx, ry, rz]) {
  const c = [Math.cos(rx), Math.cos(ry), Math.cos(rz)];
  const s = [Math.sin(rx), Math.sin(ry), Math.sin(rz)];
  const x = [1, 0, 0, 0, c[0], s[0], 0, -s[0], c[0]];
  const y = [c[1], 0, -s[1], 0, 1, 0, s[1], 0, c[1]];
  const z = [c[2], s[2], 0, -s[2], c[2], 0, 0, 0, 1];
  return transpose(mul(mul(x, y), z));
}

/**
 * One frame: Tekken 4's 69 values (`motion.mjs`'s `frame`) and the fix-up matrix Tekken 3 puts on
 * its head and shoulders (`fixup`, nine numbers of 1.0) into Tekken 3's 49 channel values as the
 * game uses them (a motion stores half of each). `offsets` are Tekken 3's generic chest, shoulder,
 * hip, hand and foot vectors; `rest` the model's rest rotations (`restRotation`), which the joints no
 * group turns keep; `bones` the character's arm and leg lengths, `{ arm: [upper, lower], leg: [upper,
 * lower] }`.
 *
 * Tekken 3's root is the hips' place from where the move began, so it is Tekken 4's travel (group 0)
 * and the hips' place over it (group 1) together: his walk forward moves group 0 by 670 mm, as
 * Heihachi's moves his root, the other way along Z.
 */
export function convertFrame(values, fixup, offsets, rest, bones) {
  const local = rest.slice();
  /* Group 6 is a place, not a turn: its node is no node, and read as one it would undo the root's turn (group 3). */
  for (let g = 3; g < 23; g += 1) if (isRotation(g * 3)) local[NODE_OF_GROUP[g]] = groupRotation(values[g * 3], values[g * 3 + 1], values[g * 3 + 2]);
  return convertPose(local, [values[0] + values[3], values[1] + values[4], values[2] + values[5]], fixup, offsets, bones);
}

/**
 * A Tekken 4 pose as local rotations of its nodes (column vectors) and the root's place (Tekken 4's
 * character space) into Tekken 3's 49 channels; `convertFrame` says what the rest is.
 */
export function convertPose(local, root, fixup, offsets, bones) {
  const fixT = transpose(fixup);
  const offset = (i) => [offsets[i * 3], offsets[i * 3 + 1], offsets[i * 3 + 2]];
  const channels = new Array(49).fill(0);

  /* The root: Tekken 4's in Tekken 3's character space, in Tekken 3's frame for it. */
  const c = convention;
  const rootR = mul(mul(FLIP, local[0]), transpose(c(0)));
  const rootT = apply(FLIP, root);
  channels[0] = rootT[0];
  channels[1] = rootT[1];
  channels[2] = rootT[2];

  /* A joint's Tekken 3 local rotation: its parent's turn, Tekken 4's local, its own turn undone. */
  const local3 = (parent, rotation, joint) => mul(mul(c(parent), rotation), transpose(c(joint)));
  const euler = {};
  euler[0] = rootR;
  euler[1] = local3(0, mul(local[1], local[2]), 1);
  euler[11] = local3(0, local[13], 11);
  const shoulder = [local3(1, local[5], 3), local3(1, local[9], 7)];
  euler[2] = mul(local3(1, mul(local[3], local[4]), 2), fixT);
  euler[3] = mul(shoulder[0], fixT);
  euler[7] = mul(shoulder[1], fixT);

  /* The generic frames the IK measures from, as the game builds them from these rotations. */
  const chestR = mul(rootR, euler[1]);
  const chestT = add(rootT, apply(rootR, offset(0)));
  const shoulders = [
    { r: mul(chestR, shoulder[0]), t: add(chestT, apply(chestR, offset(1))), add: offset(4) },
    { r: mul(chestR, shoulder[1]), t: add(chestT, apply(chestR, offset(2))), add: offset(5) },
  ];
  const hipsR = mul(rootR, euler[11]);
  const hipsT = add(rootT, apply(rootR, offset(3)));
  const hips = [
    { r: hipsR, t: hipsT, add: offset(6) },
    { r: hipsR, t: hipsT, add: offset(7) },
  ];

  /* Each limb's upper bone from its root's Tekken 3 frame; the IK's own frames need no turn. */
  const limbs = [
    { root: shoulders[0], upper: mul(c(3), local[6]), lower: local[7], end: local[8], limb: ARM, arm: true, bones: bones.arm, target: 3, twist: 15, joint: 6 },
    { root: shoulders[1], upper: mul(c(7), local[10]), lower: local[11], end: local[12], limb: ARM, arm: true, bones: bones.arm, target: 6, twist: 16, joint: 10 },
    { root: hips[0], upper: mul(c(11), local[14]), lower: local[15], end: local[16], limb: LEG, arm: false, bones: bones.leg, target: 9, twist: 17, joint: 14 },
    { root: hips[1], upper: mul(c(11), local[18]), lower: local[19], end: local[20], limb: LEG, arm: false, bones: bones.leg, target: 12, twist: 18, joint: 17 },
  ];
  for (const l of limbs) {
    const upperX = column(l.upper, 0);
    const lowerX = apply(l.upper, column(l.lower, 0));
    /*
     * Tekken 4 bends an elbow or knee about the upper bone's Z, the way Tekken 3's IK bends it. A
     * limb straight, or bent a hair the other way (which Tekken 3 cannot), is straight about that
     * axis: from the cross of two near-parallel bones its direction would be noise, and a roll
     * half a turn out turns the whole limb's skin round its bone.
     */
    const hinge = scale(column(l.upper, 2), bendSign(l.limb, l.arm));
    let axis = cross(upperX, lowerX);
    let bend = Math.atan2(norm(axis), dot(upperX, lowerX));
    if (norm(axis) < 1e-4 || dot(axis, hinge) <= 0) {
      axis = hinge;
      bend = 0;
    } else axis = unit(axis);
    const solved = solveLimb(upperX, lowerX, axis, bend, l.limb, l.arm, l.bones);
    /* The target in character space, from the upper joint's place in the root's frame. */
    const from = sub(solved.target, l.root.add);
    const target = add(l.root.t, apply(l.root.r, from));
    channels[l.target] = target[0];
    channels[l.target + 1] = target[1];
    channels[l.target + 2] = target[2];
    channels[l.twist] = solved.twist;
    /* The hand or foot turned from where the IK leaves the joint above it. */
    const { upper, lower } = limbRotations(solved);
    euler[l.joint] = mul(mul(transpose(mul(upper, lower)), mul(mul(l.upper, l.lower), l.end)), transpose(c(l.joint)));
  }

  [0, 1, 11, 2, 3, 7, 6, 10, 14, 17].forEach((joint, i) => {
    const [x, y, z] = eulerAngles(euler[joint]);
    channels[19 + i * 3] = x;
    channels[20 + i * 3] = y;
    channels[21 + i * 3] = z;
  });
  return channels;
}
