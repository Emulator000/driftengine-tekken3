/**
 * Tekken 4's skeleton on Tekken 3's, for a Tekken 4 character carried into the port (Kazuya,
 * `scripts/lib/t4/kazuya.mjs`): which Tekken 3 joint stands for each of its main nodes, how their
 * frames differ, and the bones Tekken 3 has no joint for, posed here from Tekken 3's joints: the
 * helpers, which Tekken 4 moves by rule from the main nodes every frame and this module by the
 * same rules, and the neck and head, which Tekken 3 turns as one.
 *
 * Rotations are 3 × 3 arrays, row-major, acting on column vectors (Tekken 3's convention). Tekken
 * 4's own matrices act on row vectors: the rows of a node's matrix are its axes in its parent's
 * space, which are the columns here.
 */

type Vec = [number, number, number];
type Mat = number[];

/** A joint's or bone's world frame: rotation and place (mm), in the game's axes. */
export interface Frame {
  readonly r: ArrayLike<number>;
  readonly t: ArrayLike<number>;
}

/** A node of the model's skeleton: its parent (-1 for the root), its offset from it (mm) and its rest rotation (radians). */
export interface RigNode {
  readonly parent: number;
  readonly offset: readonly number[];
  readonly rotation: readonly number[];
}

/** The Tekken 3 joint each of Tekken 4's main nodes moves with (the spine and neck go with the joint above). */
export const JOINT_OF_NODE: ReadonlyMap<number, number> = new Map([
  [0, 0], [1, 1], [2, 1], [3, 2], [4, 2], [5, 3], [6, 4], [7, 5], [8, 6], [9, 7], [10, 8], [11, 9], [12, 10],
  [13, 11], [14, 12], [15, 13], [16, 14], [18, 15], [19, 16], [20, 17],
]);

const IDENTITY: Mat = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const HALF_X: Mat = [1, 0, 0, 0, -1, 0, 0, 0, -1];
const QUARTER_X: Mat = [1, 0, 0, 0, 0, -1, 0, 1, 0];
const QUARTER_Z: Mat = [0, -1, 0, 1, 0, 0, 0, 0, 1];
/**
 * Where the two games' joint frames differ, the turn from Tekken 4's to Tekken 3's (a point's
 * Tekken 3 coordinates are this times its Tekken 4 ones). The root and shoulders are a half turn
 * about their X, the hands a quarter turn about it, the feet a quarter turn about Z; chest, head,
 * hips and the limbs the IK builds agree as they are.
 */
export const CONVENTIONS: Readonly<Record<number, Mat>> = { 0: HALF_X, 3: HALF_X, 7: HALF_X, 6: QUARTER_X, 10: QUARTER_X, 14: QUARTER_Z, 17: QUARTER_Z };
const convention = (joint: number): Mat => CONVENTIONS[joint] ?? IDENTITY;

/** The helper bones, by node: the deltoid, chest and shoulder muscles, the arms' and legs' twists and bends. */
const HELPER_NODES: readonly number[] = Array.from({ length: 26 }, (_, k) => 29 + k);
const NECK = 3;
const HEAD = 4;
/** The nodes posed here, each a joint of its own past Tekken 3's (`rigJoint`). */
export const RIG_NODES: readonly number[] = [NECK, HEAD, ...HELPER_NODES];
/** The joint a node posed here is, numbered past Tekken 3's twenty-two. */
export const rigJoint = (node: number): number => 32 + node;
/**
 * The neck's share of a head's turn from its rest: Tekken 3 turns neck and head as one joint;
 * Tekken 4 turns them apart, and over Kazuya's 124 motions the neck takes a median of 0.47 of the
 * two's turn (a tenth of the frames 0.38 or less, a tenth 0.65 or more).
 */
const NECK_SHARE = 0.5;

/* ---- Vectors, column-vector rotations and Tekken 4's quaternions (x, y, z, w). ---- */

const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** `a` made a unit vector; a zero vector stays zero. */
const unit = (a: Vec): Vec => {
  const length = Math.hypot(a[0], a[1], a[2]);
  return length === 0 ? [0, 0, 0] : scale(a, 1 / length);
};
const mul = (a: Mat, b: Mat): Mat => {
  const r = new Array<number>(9);
  for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) r[i * 3 + j] = a[i * 3]! * b[j]! + a[i * 3 + 1]! * b[3 + j]! + a[i * 3 + 2]! * b[6 + j]!;
  return r;
};
const transpose = (m: Mat): Mat => [m[0]!, m[3]!, m[6]!, m[1]!, m[4]!, m[7]!, m[2]!, m[5]!, m[8]!];
const apply = (m: Mat, v: Vec): Vec => [
  m[0]! * v[0] + m[1]! * v[1] + m[2]! * v[2],
  m[3]! * v[0] + m[4]! * v[1] + m[5]! * v[2],
  m[6]! * v[0] + m[7]! * v[1] + m[8]! * v[2],
];
/** Axis `k` of a frame: a column here, a row of Tekken 4's matrix. */
const axis = (m: Mat, k: number): Vec => [m[k]!, m[3 + k]!, m[6 + k]!];
const fromAxes = (x: Vec, y: Vec, z: Vec): Mat => [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];

type Quat = [number, number, number, number];
/** A turn of `angle` about a unit axis. */
const turn = (angle: number, about: Vec): Quat => {
  const s = Math.sin(angle / 2);
  return [about[0] * s, about[1] * s, about[2] * s, Math.cos(angle / 2)];
};
/** The quaternions' product a · b. */
const qmul = (a: Quat, b: Quat): Quat => {
  const c = cross([a[0], a[1], a[2]], [b[0], b[1], b[2]]);
  return [
    c[0] + a[3] * b[0] + b[3] * a[0],
    c[1] + a[3] * b[1] + b[3] * a[1],
    c[2] + a[3] * b[2] + b[3] * a[2],
    a[3] * b[3] - (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]),
  ];
};
/** The quaternion's matrix as Tekken 4 stores it (rows), so its transpose here. */
const frameOf = ([x, y, z, w]: Quat): Mat =>
  transpose([
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ]);
/** A frame's quaternion, reading Tekken 4's rows. */
function quatOf(frame: Mat): Quat {
  const m = transpose(frame);
  const xx = (1 + m[0]! - m[4]! - m[8]!) / 4;
  const yy = (1 - m[0]! + m[4]! - m[8]!) / 4;
  const zz = (1 - m[0]! - m[4]! + m[8]!) / 4;
  const xy = (m[1]! + m[3]!) / 4;
  const yz = (m[5]! + m[7]!) / 4;
  const xz = (m[6]! + m[2]!) / 4;
  let x = Math.sqrt(Math.max(0, xx));
  let y = Math.sqrt(Math.max(0, yy));
  let z = Math.sqrt(Math.max(0, zz));
  let w = Math.sqrt(Math.max(0, 1 - xx - yy - zz));
  let negative: boolean;
  if (yy < xx && zz < xx) {
    if (xy < 0) y = -y;
    if (xz < 0) z = -z;
    negative = m[7]! - m[5]! < 0;
  } else if (yy >= xx && zz < yy) {
    if (yz < 0) z = -z;
    if (xy < 0) x = -x;
    negative = m[2]! - m[6]! < 0;
  } else {
    if (xz < 0) x = -x;
    if (yz < 0) y = -y;
    negative = m[3]! - m[1]! < 0;
  }
  if (negative) w = -w;
  return [x, y, z, w];
}
/** From a toward b by t, the short way. */
function slerp(t: number, a: Quat, b: Quat): Quat {
  const cosine = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]));
  const angle = Math.acos(Math.abs(cosine));
  if (Math.abs(angle) < 1e-5) return [...a];
  const ka = Math.sin(angle * (1 - t));
  const kb = Math.sin(angle * t) * (cosine > 0 ? 1 : -1);
  const k = 1 / Math.sin(angle);
  return [(a[0] * ka + b[0] * kb) * k, (a[1] * ka + b[1] * kb) * k, (a[2] * ka + b[2] * kb) * k, (a[3] * ka + b[3] * kb) * k];
}
/** Tekken 4's Euler angles (its rest rotations' order, Rx · Ry · Rz on row vectors). */
function euler(rx: number, ry: number, rz: number): Mat {
  const [cx, cy, cz] = [Math.cos(rx), Math.cos(ry), Math.cos(rz)];
  const [sx, sy, sz] = [Math.sin(rx), Math.sin(ry), Math.sin(rz)];
  const x = [1, 0, 0, 0, cx, sx, 0, -sx, cx];
  const y = [cy, 0, -sy, 0, 1, 0, sy, 0, cy];
  const z = [cz, sz, 0, -sz, cz, 0, 0, 0, 1];
  return transpose(mul(mul(x, y), z));
}
/** `share` of a rotation's turn, about its axis. */
function partOf(m: Mat, share: number): Mat {
  const angle = Math.acos(Math.max(-1, Math.min(1, (m[0]! + m[4]! + m[8]! - 1) / 2)));
  if (angle < 1e-6) return [...IDENTITY];
  const [x, y, z] = unit([m[7]! - m[5]!, m[2]! - m[6]!, m[3]! - m[1]!]);
  const c = Math.cos(angle * share);
  const s = Math.sin(angle * share);
  const t = 1 - c;
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c];
}
/** A turn about Z. */
const aboutZ = (angle: number): Mat => [Math.cos(angle), -Math.sin(angle), 0, Math.sin(angle), Math.cos(angle), 0, 0, 0, 1];

/** A frame at `from` whose X looks at `target`, its Z toward `up`. */
function lookAt(from: Vec, target: Vec, up: Vec): Mat {
  const x = unit(sub(target, from));
  const z = unit(sub(up, scale(x, dot(up, x))));
  return fromAxes(x, cross(z, x), z);
}
/** A frame with the given X, its Z toward `toward`. */
function along(x: Vec, toward: Vec): Mat {
  const z = unit(sub(toward, scale(x, dot(toward, x))));
  return fromAxes(x, cross(z, x), z);
}
/** The swing that turns `from` onto `to` (unit vectors), and its angle. */
function swing(to: Vec, from: Vec): { angle: number; about: Vec } {
  return { angle: Math.acos(Math.max(-1, Math.min(1, dot(from, to)))), about: unit(cross(to, from)) };
}

const DEGREE = Math.PI / 180;
/** How high and low a clavicle may lift for the muscles that follow it, and their aim down the arm. */
const CLAVICLE_LIMIT = 20 * DEGREE;
const AIM_ALONG = 0.8 / 3;
/** How quickly that blend goes over to the half-turned swing as the arm nears the rest's Z. */
const BLEND_GAIN = 1.8849130868911743;

/** Each side's nodes: clavicle, upper arm, forearm, hand, and the helpers they drive. */
const ARMS = [
  { side: 1, clavicle: 5, upper: 6, fore: 7, hand: 8, aim: 35, shoulder: 30, upperMuscle: 31, chest: 29, upperSwing: 36, upperTwist: 37, elbow: 40, handTwist: 39, foreTwist: 38, rest: euler(-90 * DEGREE, 0, 70 * DEGREE) },
  { side: -1, clavicle: 9, upper: 10, fore: 11, hand: 12, aim: 41, shoulder: 33, upperMuscle: 34, chest: 32, upperSwing: 42, upperTwist: 43, elbow: 46, handTwist: 45, foreTwist: 44, rest: euler(-90 * DEGREE, 0, -70 * DEGREE) },
] as const;
const LEGS = [
  { thigh: 14, shin: 15, swing: 47, twist: 48, half: 49, knee: 50 },
  { thigh: 18, shin: 19, swing: 51, twist: 52, half: 53, knee: 54 },
] as const;
const HAND_REST = euler(90 * DEGREE, 0, 0);

/**
 * Tekken 4's helper bones on a Tekken 3 pose. Each main node's frame is its Tekken 3 joint's turned by
 * the convention between them, so its local rotation is Tekken 4's own; the helpers' are then made
 * by Tekken 4's rules, and placed on their parents.
 */
export class HelperRig {
  private readonly offsets: Vec[];
  private readonly parents: number[];
  /** The head's rest rotation on the neck. */
  private readonly headRest: Mat;

  constructor(nodes: readonly RigNode[]) {
    this.offsets = nodes.map((n) => [n.offset[0] ?? 0, n.offset[1] ?? 0, n.offset[2] ?? 0]);
    this.parents = nodes.map((n) => n.parent);
    const r = nodes[HEAD]!.rotation;
    this.headRest = euler(r[0] ?? 0, r[1] ?? 0, r[2] ?? 0);
  }

  /** The joints' frames with the rig's added, each at its `rigJoint`. */
  extend<T extends Frame | undefined>(joints: readonly T[]): (T | Frame)[] {
    const world = new Map<number, { r: Mat; t: Vec }>();
    for (const [node, joint] of JOINT_OF_NODE) {
      const j = joints[joint];
      if (j === undefined) return [...joints];
      world.set(node, { r: mul(Array.from(j.r), convention(joint)), t: [j.t[0]!, j.t[1]!, j.t[2]!] });
    }
    /* Tekken 3's chest joint stands at the spine; the chest node sits along it. */
    const chest = world.get(2)!;
    world.set(2, { r: chest.r, t: add(chest.t, apply(chest.r, this.offsets[2]!)) });
    const local = (node: number): Mat => mul(transpose(world.get(this.parents[node]!)!.r), world.get(node)!.r);

    const helpers = new Map<number, Mat>();
    for (const arm of ARMS) this.arm(arm, local, helpers);
    for (const leg of LEGS) {
      const thigh = local(leg.thigh);
      const { angle, about } = swing(axis(thigh, 0), [1, 0, 0]);
      const swung = frameOf(turn(angle, about));
      helpers.set(leg.swing, swung);
      helpers.set(leg.half, frameOf(turn(angle / 2, about)));
      helpers.set(leg.twist, along(axis(thigh, 0), add(axis(thigh, 2), axis(swung, 2))));
      const shin = local(leg.shin);
      helpers.set(leg.knee, aboutZ(-Math.atan2(shin[3]!, shin[0]!) / 2));
    }

    const out: (T | Frame)[] = [...joints];
    const frame = (r: Mat, t: Vec): Frame => ({ r: Float64Array.from(r), t: Float64Array.from(t) });
    for (const node of HELPER_NODES) {
      const parent = world.get(this.parents[node]!)!;
      out[rigJoint(node)] = frame(mul(parent.r, helpers.get(node)!), add(parent.t, apply(parent.r, this.offsets[node]!)));
    }
    /* Tekken 3's head joint, at the neck's foot, turns as the head: the neck takes its share of that turn from the rest, and the head sits on it. */
    const head = world.get(HEAD)!;
    const turned = mul(mul(transpose(chest.r), head.r), transpose(this.headRest));
    const neck = mul(chest.r, partOf(turned, NECK_SHARE));
    out[rigJoint(NECK)] = frame(neck, head.t);
    out[rigJoint(HEAD)] = frame(head.r, add(head.t, apply(neck, this.offsets[HEAD]!)));
    return out;
  }

  /** One arm's helpers, in its chest's, clavicle's and upper arm's spaces. */
  private arm(arm: (typeof ARMS)[number], local: (node: number) => Mat, helpers: Map<number, Mat>): void {
    const o = this.offsets;
    const clavicle = local(arm.clavicle);
    const upper = local(arm.upper);
    const fore = local(arm.fore);
    const hand = local(arm.hand);
    /* Where the upper arm starts, in the chest's space. */
    const shoulderAt = add(o[arm.clavicle]!, apply(clavicle, o[arm.upper]!));
    helpers.set(arm.aim, lookAt(o[arm.aim]!, shoulderAt, [0, 1, 0]));

    /* The clavicle held within its limits, and the upper arm on it: where it starts, and a point down it. */
    const held = (limit: number, past: (angle: number) => boolean): { at: Vec; down: Vec } => {
      const x = axis(clavicle, 0);
      const z = -arm.side * x[2];
      const angle = Math.atan2(x[1], z);
      if (past(angle)) {
        const r = Math.hypot(x[1], z);
        x[1] = Math.sin(limit) * r;
        x[2] = -arm.side * Math.cos(limit) * r;
      }
      const frame = along(x, axis(clavicle, 2));
      const at = add(o[arm.clavicle]!, apply(frame, o[arm.upper]!));
      const down = add(at, scale(apply(frame, axis(upper, 0)), o[arm.fore]![0] * AIM_ALONG));
      return { at, down };
    };
    const raised = held(CLAVICLE_LIMIT, (angle) => angle > CLAVICLE_LIMIT);
    helpers.set(arm.shoulder, lookAt(o[arm.shoulder]!, raised.at, [arm.side, 0, 0]));
    helpers.set(arm.upperMuscle, lookAt(o[arm.upperMuscle]!, raised.down, [-arm.side, 0, 0]));
    const lowered = held(-CLAVICLE_LIMIT, (angle) => angle < -CLAVICLE_LIMIT);
    helpers.set(arm.chest, lookAt(o[arm.chest]!, lowered.down, [0, 1, 0]));

    /*
     * The upper arm's swing from its rest, without its twist. Past a right angle from the rest it is
     * blended with the swing from the rest turned half round about its Z, the more so the nearer the
     * arm points along that Z. Tekken 4 measures that for both arms by the left upper arm (its right
     * arm's code reads the left's node), and so does this.
     */
    const x = axis(upper, 0);
    const toRest = swing(x, axis(arm.rest, 0));
    const rest = quatOf(arm.rest);
    let q = qmul(rest, turn(toRest.angle, toRest.about));
    const cosine = dot(axis(arm.rest, 0), x);
    if (cosine < 0) {
      const other = qmul([0, 0, 1, 0], qmul(rest, turn(-Math.acos(-cosine), toRest.about)));
      const left = axis(local(ARMS[0].upper), 0);
      const t = Math.min(1, arm.side * -dot(left, axis(arm.rest, 2)) * BLEND_GAIN + BLEND_GAIN);
      q = slerp(t, other, q);
    }
    const swung = frameOf(q);
    helpers.set(arm.upperSwing, swung);
    helpers.set(arm.upperTwist, along(x, add(axis(upper, 2), axis(swung, 2))));
    helpers.set(arm.elbow, aboutZ(-Math.atan2(fore[3]!, fore[0]!) / 2));

    /* The hand's twist about its own length, carried up the forearm whole and by half. */
    const toHand = swing(axis(hand, 0), axis(HAND_REST, 0));
    const handSwing = frameOf(qmul(quatOf(HAND_REST), turn(toHand.angle, toHand.about)));
    const twisted = mul(fore, mul(transpose(handSwing), hand));
    helpers.set(arm.handTwist, twisted);
    helpers.set(arm.foreTwist, along(axis(fore, 0), add(axis(twisted, 2), axis(fore, 2))));
  }
}
