/**
 * The remake's reachable walls: with the match's walls on (`options.walls`), a regular octagon
 * about the stage's middle that no fighter's root passes, each of its eight sides `WALL_REACH` from
 * the middle less `BODY` (a square, its corners cut).
 * A root is held inside it as it is placed, before the fighter is posed, so no fighter is drawn or
 * hit past it; a push into the wall moves the one pushing instead. Tekken Ball and Tekken Force keep
 * their own bounds.
 */
import { stepAt } from '../data/reactions.ts';
import { hitReaction } from './cancel.ts';
import { targetOf } from './body.ts';
import { moveById } from './moves.ts';
import { transitionType } from './move.ts';
import { Mode, type FightData, type FightState, type Fighter } from './state.ts';

/** How far each wall stands from the stage's middle, and how far inside it a fighter's root is held (mm). */
export const WALL_REACH = 9600;
export const BODY = 400;
const LIMIT = WALL_REACH - BODY;
/** Where the corners' sides hold a root: |x| + |z| at most `LIMIT` times the square root of two, rounded down. */
const DIAGONAL = 13010;
/**
 * A wall splat: how far a hit's knockback must carry a fighter, as it starts, for the wall stopping
 * it to splat it (mm; an ordinary hit's carries it some 350, the hardest's over a metre), the
 * crumple it then plays against the wall (the common move), and the hits it takes after before it
 * falls.
 */
export const SPLAT_TRAVEL = 600;
export const SPLAT_MOVE = 0xa42;
export const SPLAT_HITS = 3;
/** The transition a hit from the front starts its reaction with, and a move's guard bits (a stance it can block from). */
const FRONT_HIT = 0x2a;
const GUARD_BITS = 0x18;
/** A fighter's splat: none, splatted (its clean hits counted), counted out (fallen, or the count reached in the air: no more falls in the combo). */
const Splat = { NONE: 0, ON: 1, COUNTED_OUT: 2 } as const;
/** `carried` while a blocked hit's knockback carries a fighter. */
const BLOCKED = -1;

/** Whether this fight has walls: its match's walls on, and not Tekken Ball's or Tekken Force's. */
export const wallsOn = (state: FightState): boolean => state.options.walls !== 0 && state.mode !== Mode.TEKKEN_BALL && state.mode !== Mode.TEKKEN_FORCE;

/** What holds `v` inside the walls along one axis: 0 within them. */
const back = (v: number): number => (v > LIMIT ? LIMIT - v : v < -LIMIT ? -LIMIT - v : 0);

/** What holds a point inside the walls (mm, each way): the square's sides, then a corner's straight back from it. */
function inside(x: number, z: number): [number, number] {
  let dx = back(x);
  let dz = back(z);
  const over = Math.abs(x + dx) + Math.abs(z + dz) - DIAGONAL;
  if (over > 0) {
    const k = (over + 1) >> 1;
    dx -= Math.sign(x + dx) * k;
    dz -= Math.sign(z + dz) * k;
  }
  return [dx, dz];
}

/** A fighter's root and position moved alike. */
function shift(f: Fighter, dx: number, dz: number): void {
  const r = f.skeleton.base.translation;
  r[0] = (r[0]! + dx) | 0;
  r[2] = (r[2]! + dz) | 0;
  f.position[0] = (f.position[0]! + dx) | 0;
  f.position[2] = (f.position[2]! + dz) | 0;
}

/** A fighter's root held inside the walls, its position moved with it; how far the wall took it back (the more of the two ways, mm) kept as `wallHit`. */
export function holdAtWalls(state: FightState, f: Fighter): void {
  f.wallHit = 0;
  if (!wallsOn(state)) return;
  const r = f.skeleton.base.translation;
  const [dx, dz] = inside(r[0]!, r[2]!);
  if (dx === 0 && dz === 0) return;
  shift(f, dx, dz);
  f.wallHit = Math.max(Math.abs(dx), Math.abs(dz));
}

/** How much of `over` (the wall's way back along an axis) the push `push` along it carried the fighter past the wall. */
const pushedPast = (over: number, push: number): number => (over < 0 && push > 0 ? Math.max(over, -push) : over > 0 && push < 0 ? Math.min(over, -push) : 0);

/**
 * After the push apart: what this frame's push carried a fighter past a wall put back, and the one
 * pushing it moved back as far, so the two stay apart with the wall behind one of them.
 */
export function passWallPush(state: FightState, a: Fighter, b: Fighter): void {
  if (!wallsOn(state)) return;
  for (const [f, other] of [
    [a, b],
    [b, a],
  ] as const) {
    if (f.pushed === 0) continue;
    const r = f.skeleton.base.translation;
    const [ox, oz] = inside(r[0]!, r[2]!);
    const dx = pushedPast(ox, f.push[0]!);
    const dz = pushedPast(oz, f.push[2]!);
    if (dx === 0 && dz === 0) continue;
    shift(f, dx, dz);
    shift(other, dx, dz);
  }
}

/** How far a fighter's knockback has still to carry it (mm): its slide's frames left at its speed, and its steps left with their repeats' extra. */
function travelLeft(data: FightData, f: Fighter): number {
  let left = f.pushFrames > 0 ? f.pushFrames * f.pushSpeed : 0;
  if (f.stepFrames > 0 && f.steps !== null) {
    for (let k = 0; k < f.stepFrames; k += 1) left += stepAt(data.reactions, f.steps, k) + (f.repeats > 0 ? f.repeats * 0x28 + 10 : 0);
  }
  return left;
}

/**
 * The frame's wall splats, after the moves are chosen: a fighter the wall stopped while a clean
 * hit's knockback of `SPLAT_TRAVEL` or more carries it (a blocked hit's never splats), and no move
 * chosen for it this frame, is splatted once in a combo. On the ground it plays the crumple against
 * the wall, its knockback stopped; in a launch or a juggle it drops straight down the wall, its
 * drift stopped. After a splat, the `SPLAT_HITS`th clean hit makes it fall as a knockout's fall
 * does, where it lands on the ground (in the air it is only counted out), once in the combo. A
 * fighter back in a stance it can block from, no longer hit nor in the air, can be splatted anew.
 */
export function wallSplats(state: FightState, data: FightData): void {
  if (!wallsOn(state)) return;
  for (const f of [state.fighters[0]!, state.fighters[1]!]) {
    const carrying = f.pushFrames > 0 || f.stepFrames > 0;
    /* A hit this frame starts the knockback to come: a blocked one's never splats (-1). */
    if (f.hitReacting !== 0) f.carried = f.guarded !== 0 ? BLOCKED : 0;
    if (carrying && f.carried !== BLOCKED) f.carried = Math.max(f.carried, travelLeft(data, f));
    if (f.splatted !== 0) {
      const clean = f.hitReacting !== 0 && f.guarded === 0;
      if (f.splatted === Splat.ON && clean && ++f.splatHits >= SPLAT_HITS) {
        f.splatted = Splat.COUNTED_OUT;
        if (f.inArc === 0 && f.health !== 0) {
          f.inAir = 1;
          f.guarded = 0;
          f.hitClean = 1;
          f.guard = 0;
          hitReaction(data, f, targetOf(state, f));
        }
      } else if (!clean && (f.stance & GUARD_BITS) !== 0 && f.hitReacting === 0 && f.inArc === 0) {
        f.splatted = Splat.NONE;
        f.splatHits = 0;
      }
      continue;
    }
    if (f.wallHit === 0 || f.health === 0 || f.next.move !== null) continue;
    if (f.inArc !== 0) {
      f.arc[0] = 0;
      f.arc[2] = 0;
      f.launchWeight = 0;
      f.stepFrames = 0;
      f.pushFrames = 0;
      f.splatted = Splat.ON;
      f.splatHits = 0;
      continue;
    }
    if (!carrying || f.carried < SPLAT_TRAVEL) continue;
    f.pushFrames = 0;
    f.stepFrames = 0;
    f.carried = 0;
    f.next.id = SPLAT_MOVE;
    f.next.move = moveById(data, f, SPLAT_MOVE);
    f.next.type = transitionType(data, f, FRONT_HIT);
    f.next.turnAround = 0;
    f.next.noBlend = 0;
    f.next.startFrame = f.frame;
    f.transition = 1;
    f.splatted = Splat.ON;
    f.splatHits = 0;
  }
}
