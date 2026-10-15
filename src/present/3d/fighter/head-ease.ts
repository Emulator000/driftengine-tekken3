/**
 * A fighter's head, as drawn, eased against where the game turns it. The game turns the head toward
 * the opponent's from frame to frame, so it nods with every bounce of a stance (Hwoarang's), and moves
 * it at once between where it had turned it and the motion's own pose where a move switches the turn
 * on or off. Drawn, a turning head (against the joint it hangs from) lets the game's drift up to 6
 * degrees from it before following, settling toward it slowly meanwhile, and a switch's difference is
 * closed over a few fields while the game's own turning goes on; what hangs from the head (hair, a
 * headband's tails) turns with it.
 */
import type { JointTransform } from './fighter.ts';

export const HEAD = 2;
/** The joint the head hangs from. */
const UNDER = 1;
/** The fields a switch's difference is closed over. */
const FIELDS = 6;
/** How far a turning head lets the game's drift from it (radians), and the share of the way it settles a field. */
const SLACK = (6 * Math.PI) / 180;
const SETTLE = 0.02;

type Quaternion = [number, number, number, number];

/** A rotation (row-major) as a unit quaternion (x, y, z, w). */
function quaternionOf(m: ArrayLike<number>): Quaternion {
  const trace = m[0]! + m[4]! + m[8]!;
  let q: Quaternion;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    q = [(m[7]! - m[5]!) / s, (m[2]! - m[6]!) / s, (m[3]! - m[1]!) / s, s / 4];
  } else if (m[0]! > m[4]! && m[0]! > m[8]!) {
    const s = Math.sqrt(1 + m[0]! - m[4]! - m[8]!) * 2;
    q = [s / 4, (m[1]! + m[3]!) / s, (m[2]! + m[6]!) / s, (m[7]! - m[5]!) / s];
  } else if (m[4]! > m[8]!) {
    const s = Math.sqrt(1 + m[4]! - m[0]! - m[8]!) * 2;
    q = [(m[1]! + m[3]!) / s, s / 4, (m[5]! + m[7]!) / s, (m[2]! - m[6]!) / s];
  } else {
    const s = Math.sqrt(1 + m[8]! - m[0]! - m[4]!) * 2;
    q = [(m[2]! + m[6]!) / s, (m[5]! + m[7]!) / s, s / 4, (m[3]! - m[1]!) / s];
  }
  const l = Math.hypot(...q) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

/** `a` then `b` applied after it: b · a. */
function after(b: Quaternion, a: Quaternion): Quaternion {
  return [
    b[3] * a[0] + b[0] * a[3] + b[1] * a[2] - b[2] * a[1],
    b[3] * a[1] - b[0] * a[2] + b[1] * a[3] + b[2] * a[0],
    b[3] * a[2] + b[0] * a[1] - b[1] * a[0] + b[2] * a[3],
    b[3] * a[3] - b[0] * a[0] - b[1] * a[1] - b[2] * a[2],
  ];
}

const inverse = (q: Quaternion): Quaternion => [-q[0], -q[1], -q[2], q[3]];
const IDENTITY: Quaternion = [0, 0, 0, 1];

/** The angle between two rotations (radians). */
const between = (a: Quaternion, b: Quaternion): number => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])));

/** `share` of the way from `a` to `b`, the short way round. */
function toward(a: Quaternion, b: Quaternion, share: number): Quaternion {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const s = dot < 0 ? -1 : 1;
  dot *= s;
  if (dot > 0.9995) {
    const q = a.map((v, i) => v + (s * b[i]! - v) * share) as Quaternion;
    const l = Math.hypot(...q) || 1;
    return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
  }
  const angle = Math.acos(Math.min(1, dot));
  const ka = Math.sin((1 - share) * angle) / Math.sin(angle);
  const kb = (s * Math.sin(share * angle)) / Math.sin(angle);
  return [ka * a[0] + kb * b[0], ka * a[1] + kb * b[1], ka * a[2] + kb * b[2], ka * a[3] + kb * b[3]];
}

/** A turning head's next place: where it was, settling toward the game's, at most `SLACK` from it. */
function follow(held: Quaternion, game: Quaternion): Quaternion {
  const angle = between(held, game);
  return toward(held, game, angle > SLACK ? Math.max(SETTLE, 1 - SLACK / angle) : SETTLE);
}

function matrixOf(q: Quaternion, out: Float64Array): void {
  const [x, y, z, w] = q;
  out.set([1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]);
}

const turn = new Float64Array(9);
const product = new Float64Array(9);

export class HeadEase {
  private turned = 0;
  private field = -1;
  /** The head followed, against the joint it hangs from: the game's, calmly while it turns; none before the first field. */
  private held: Quaternion | null = null;
  /** What turns the drawn head from the one followed since a switch, and the fields left to close it. */
  private offset: Quaternion = IDENTITY;
  private left = 0;

  /**
   * The fighter's joints this field (`joints`, by joint), the head eased: `turned` whether the game
   * turns it now, `field` the fight's field count, `below` the joints that hang from the head.
   */
  apply(joints: (JointTransform | undefined)[], below: readonly number[], turned: number, field: number): void {
    const head = joints[HEAD];
    const under = joints[UNDER];
    if (head === undefined || under === undefined) return;
    const holder = quaternionOf(under.r);
    const game = after(inverse(holder), quaternionOf(head.r));
    if (field !== this.field) {
      if (this.held === null || field !== this.field + 1) {
        this.held = game;
        this.offset = IDENTITY;
        this.left = 0;
      } else {
        const drawn = after(this.offset, this.held);
        this.held = turned !== 0 && this.turned !== 0 ? follow(this.held, game) : game;
        if (turned !== this.turned) {
          this.offset = after(drawn, inverse(this.held));
          this.left = FIELDS;
        }
        if (this.left > 0) {
          this.offset = toward(this.offset, IDENTITY, 1 / this.left);
          this.left -= 1;
        }
      }
      this.turned = turned;
      this.field = field;
    }
    const drawn = after(this.offset, this.held!);
    /* What turns the game's head into the drawn one, about the head. */
    const gap = after(after(holder, drawn), inverse(after(holder, game)));
    if (Math.abs(gap[3]) > 0.999999) return;
    matrixOf(gap, turn);
    const [hx, hy, hz] = head.t as unknown as [number, number, number];
    for (const j of [HEAD, ...below]) {
      const joint = joints[j];
      if (joint === undefined) continue;
      for (let row = 0; row < 3; row += 1) {
        for (let col = 0; col < 3; col += 1) product[row * 3 + col] = turn[row * 3]! * joint.r[col]! + turn[row * 3 + 1]! * joint.r[3 + col]! + turn[row * 3 + 2]! * joint.r[6 + col]!;
      }
      joint.r.set(product);
      if (j === HEAD) continue;
      const [dx, dy, dz] = [joint.t[0]! - hx, joint.t[1]! - hy, joint.t[2]! - hz];
      joint.t[0] = hx + turn[0]! * dx + turn[1]! * dy + turn[2]! * dz;
      joint.t[1] = hy + turn[3]! * dx + turn[4]! * dy + turn[5]! * dz;
      joint.t[2] = hz + turn[6]! * dx + turn[7]! * dy + turn[8]! * dz;
    }
  }
}
