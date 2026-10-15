/**
 * The head turning toward the opponent. While the fight is on, on a move that lets it (bit 30 of its
 * hit flags; an attack only from its active window's end, or from 17 frames before its own end where
 * that is later), and while the head keeps no angle of the motion's own (`lookFixed`), the point
 * between the opponent's neck and head, as both were last placed, is taken into the fighter's neck's
 * frame from its head: the head pitches toward it, as far as 60 degrees up and 25 down, and turns
 * toward it as far as 80 degrees while the neck stands upright, narrowing to 30 as it bends over
 * (Gon's head does not turn). It goes half its way there a frame, at most 10 degrees; a target close
 * in front (within 400 mm ahead and 300 to the side) it keeps for a second before taking the next; it starts from the motion's own head the frame it first
 * turns, and takes its target at once on a round's first. The head's local rotation is then a quarter
 * turn about x and about z times those angles.
 */
import type { MathTables } from '../data/tables.ts';
import type { Move } from '../data/moveset.ts';
import { headingOf } from '../math/angles.ts';
import { s16 } from '../math/integers.ts';
import { multiply, newProduct, rotate, type Matrix } from '../math/matrix.ts';
import { tableRoot } from '../math/roots.ts';
import { eulerRotation } from './skeleton.ts';

export const NECK = 1;
export const HEAD = 2;
const GON = 0x11;
/** The match's status while the fight is on. */
const FIGHTING = 2;
/** How far the head pitches up and down, how far it turns upright and bent over, and how far a frame (16-bit turns). */
const UPWARD = -0x2aaa;
const DOWNWARD = 0x11c7;
const WIDEST = 0x38e3;
const NARROWEST = 0x1555;
const STEP = 0x71c;
/** How close in front a target is kept (ahead and to the side, in the neck's frame, mm), and for how many frames. */
const AHEAD = 400;
const ASIDE = 300;
const KEEP = 60;
/** The angles each side's head starts a round with. */
const START = [0, 0x38e, 0] as const;

/** A side's head: its angles as drawn, those it goes toward, whether it turned last frame, whether it takes its target at once, how long it has kept one. */
export interface Look {
  readonly angles: number[];
  readonly target: number[];
  turned: number;
  snap: number;
  held: number;
}

export const newLook = (): Look => ({ angles: [0, 0, 0], target: [0, 0, 0], turned: 0, snap: 0, held: 0 });

/** As a round starts: each head at its starting angles, taking its target at once. */
export function resetLooks(looks: readonly Look[]): void {
  for (const look of looks) {
    for (let k = 0; k < 3; k += 1) look.angles[k] = START[k]!;
    look.turned = 0;
    look.snap = 1;
  }
}

/** Whether the head may turn this frame: on a move that lets it, from the frame it lets it, while the fight is on. */
export function headMayTurn(status: number, move: Move, frame: number): boolean {
  if (((move.hitFlags >>> 30) & 1) !== 1 || status !== FIGHTING) return false;
  if (move.activeWindow.first === 0) return true;
  const late = move.length - 0x11;
  return frame >= (move.activeWindow.last < late ? late : move.activeWindow.last);
}

/** A 16-bit turn's place in the sine table, rounded toward zero. */
const entry = (turn: number): number => ((turn < 0 ? turn + 15 : turn) >> 4) & 0xfff;
/** A product of 4.12 values back to 4.12, rounded toward zero. */
const fixed = (v: number): number => (v < 0 ? v + 0xfff : v) >> 12;

/** The angles about x, y and z a head's local rotation `l` (row-major) has, to start turning from. */
export function anglesOf(math: MathTables, l: readonly number[], out: number[]): void {
  const ax = l[0]!;
  let ay = l[3]!;
  let az = l[6]!;
  let bx = l[2]!;
  let by = l[5]!;
  let bz = l[8]!;
  const z = s16(headingOf(s16(ay), s16(az), math));
  let i = entry(-z);
  let s = math.sine[i]!;
  let c = math.sine[i + 0x400]!;
  [ay, az] = [fixed(ay * c - az * s), fixed(ay * s + az * c)];
  [by, bz] = [fixed(by * c - bz * s), fixed(by * s + bz * c)];
  const y = s16(headingOf(s16(ax), s16(ay), math) - 0x4000);
  i = entry(-y);
  s = math.sine[i]!;
  c = math.sine[i + 0x400]!;
  bx = fixed(bx * c - by * s);
  out[0] = s16(headingOf(s16(bz), s16(bx), math) - 0x4000);
  out[1] = y;
  out[2] = z;
}

const toward = newProduct();
const turn = [0, 0, 0, 0, 0, 0, 0, 0, 0];
const base = [0, 0, 0, 0, 0, 0, 0, 0, 0];
const neckAxes = [0, 0, 0, 0, 0, 0, 0, 0, 0];

/** Half the way toward a target, at most `STEP`. */
const ease = (d: number): number => {
  const step = d - Math.trunc(d / 2);
  return step > STEP ? STEP : step < -STEP ? -STEP : step;
};

/**
 * One frame of the head turning: `neck` and `head` the fighter's joints as last placed, `aim` the
 * opponent's point between neck and head, `local` the head's local rotation this frame's motion gave,
 * replaced by the turned one.
 */
export function turnHead(math: MathTables, look: Look, roster: number, neck: Matrix, head: Matrix, aim: readonly number[], local: number[]): void {
  const r = neck.rotation;
  for (let row = 0; row < 3; row += 1) for (let col = 0; col < 3; col += 1) neckAxes[row * 3 + col] = r[col * 3 + row]!;
  rotate(neckAxes, s16(s16(aim[0]!) - s16(head.translation[0]!)), s16(s16(aim[1]!) - s16(head.translation[1]!)), s16(s16(aim[2]!) - s16(head.translation[2]!)), toward);
  const [ax, ay, az] = toward.full as [number, number, number];
  /* Up or down toward it. */
  const along = headingOf(s16(tableRoot((Math.imul(ay, ay) + Math.imul(az, az)) | 0, math)), s16(ax), math);
  const pitch = Math.max(UPWARD, Math.min(DOWNWARD, s16(-along)));
  /* Round toward it, as far as the neck's lean allows. */
  const lean = s16(headingOf(s16(tableRoot((Math.imul(r[0]!, r[0]!) + Math.imul(r[6]!, r[6]!)) | 0, math)), s16(r[3]!), math));
  const tilt = lean + 0x4000;
  const reach = tilt < 0xaab ? WIDEST : tilt < WIDEST ? WIDEST - Math.trunc(((lean + 0x3556) * 0x238e) / 0x2e39) : NARROWEST;
  const round = roster === GON ? 0 : s16(headingOf(s16(ay), s16(az), math));
  const yaw = Math.max(-reach, Math.min(reach, round));
  /* A target close in front is kept a while; one farther off, or the first, is taken at once. */
  let take = true;
  if (look.turned === 0 || (ay < 0 ? (-ay | 0) >= AHEAD : ay >= AHEAD) || (az < 0 ? (-az | 0) >= ASIDE : az >= ASIDE)) look.held = 0;
  else {
    look.held = (look.held + 1) & 0xff;
    if (look.held < KEEP) take = false;
    else look.held = 0;
  }
  const first = look.turned === 0;
  look.turned = 1;
  if (take || look.snap !== 0) {
    look.target[0] = 0;
    look.target[1] = pitch;
    look.target[2] = yaw;
  }
  if (look.snap !== 0) {
    for (let k = 0; k < 3; k += 1) look.angles[k] = look.target[k]!;
    look.snap = 0;
  } else if (first) anglesOf(math, local, look.angles);
  else {
    look.angles[1] = s16(look.angles[1]! + ease(look.target[1]! - look.angles[1]!));
    look.angles[2] = s16(look.angles[2]! + ease(look.target[2]! - look.angles[2]!));
    look.angles[0] = look.target[0]!;
  }
  eulerRotation(math, 0x4000, 0, 0x4000, base);
  eulerRotation(math, look.angles[0]!, look.angles[1]!, look.angles[2]!, turn);
  multiply(base, turn, local);
}
