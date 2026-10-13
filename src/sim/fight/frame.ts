/**
 * One frame of the fight, in the original's order. The phases are remade one at a time; this
 * module holds the small ones that belong to the frame itself.
 */
import { pairOf, targetOf } from './body.ts';
import { face } from './move.ts';
import { Mode, type FightData, type FightState, type Fighter } from './state.ts';

/** Tekken Force's target choice: frames a switch of target holds, the distances the nearer counts within and is a tie, and each facing quadrant's weight (front, a side, back, the other side). */
const TARGET_LOCK = 0x78;
const NEAR = 2500;
const TIE = 400;
const QUADRANT_WEIGHTS = [2, 0, 1, 0] as const;
/** On the picture: a fighter's place across it, from 1 to 399. */
const onPicture = (f: Fighter): number => (((f.screenX - 1) & 0xffff) < 399 ? 1 : 0);

/** Who acts first this frame: fighter 0, unless the computer plays it. */
export function firstAndSecond(state: FightState): [Fighter, Fighter] {
  const [a, b] = state.fighters;
  return a.computer === 0 ? [a, b] : [b, a];
}

/** Each fighter's opponent and target, the other's slot. */
export function assignRoles(state: FightState): void {
  const [first, second] = firstAndSecond(state);
  first.target = second.slot;
  second.target = first.slot;
  first.opponent = second.slot;
  second.opponent = first.slot;
}

/** How many fighters are mid-throw (the third only where there is one). */
export function countThrows(state: FightState): void {
  const [a, b, c] = state.fighters;
  let count = a.throwing !== 0 ? 1 : 0;
  if (b.throwing !== 0) count += 1;
  if (state.mode === Mode.TEKKEN_FORCE && c.throwing !== 0) count += 1;
  state.throwsUnderway = count;
}

/** Each fighter's frame, kept as last frame's for the next (the third's in Tekken Force). */
export function rememberFrames(state: FightState): void {
  for (const f of state.fighters.slice(0, state.mode === Mode.TEKKEN_FORCE ? 3 : 2)) f.lastFrame = f.frame;
}

/**
 * Which of two enemies the player faces more squarely: by how far it is turned from each (the
 * nearer straight ahead within a quadrant's spread), else by the quadrants' weights. The player's
 * facing is put back as it was, and copied as the other's.
 */
function byAngle(data: FightData, p: Fighter, e1: Fighter, e2: Fighter): Fighter {
  const saved = [p.towardTarget, p.heading, p.facingOff, p.facingOffSize, p.facingQuadrant, p.faceTarget] as const;
  face(data, p, e1);
  const [s1, q1] = [p.facingOffSize, p.facingQuadrant];
  face(data, p, e2);
  const [s2, q2] = [p.facingOffSize, p.facingQuadrant];
  let pick: Fighter;
  if (q1 === q2) {
    const spread = q1 === 0 ? 0x1000 : q1 === 2 ? 0x2000 : 0x3000;
    pick = spread <= Math.abs(s1 - s2) ? (s1 < s2 ? e1 : e2) : e1;
  } else pick = QUADRANT_WEIGHTS[q2]! < QUADRANT_WEIGHTS[q1]! ? e1 : e2;
  [p.towardTarget, p.heading, p.facingOff, p.facingOffSize, p.facingQuadrant, p.faceTarget] = saved;
  [p.awayFromTarget, p.theirHeading, p.theirOff, p.theirOffSize, p.theirQuadrant, p.theirFaceTarget] = saved;
  return pick;
}

/**
 * The enemy the player targets: the one in play; of two on the picture, the nearer when either is
 * near (by facing when they are about as near), or the one the manual switch picks; a change of
 * target held for two seconds; one off the picture passed over.
 */
function chooseTarget(state: FightState, data: FightData, p: Fighter, e1: Fighter, e2: Fighter): Fighter {
  const force = state.force;
  if (0 < force.targetLock) force.targetLock -= 1;
  if (force.targetLock < 0) force.targetLock = 0;
  let result = e1;
  if (e1.pushImmune === 0) {
    if (e2.pushImmune !== 0) result = e1;
    else if (force.targetOnScreen !== 0) {
      let pick = e1;
      if (force.otherOnScreen !== 0 && force.targetLock === 0) {
        const d1 = pairOf(state, p.slot, e1.slot).distance;
        const d2 = pairOf(state, p.slot, e2.slot).distance;
        const diff = d1 - d2;
        if (d1 < NEAR || d2 < NEAR) pick = Math.abs(diff) < TIE ? byAngle(data, p, e1, e2) : diff < 1 ? e1 : e2;
        if (force.manualTarget !== 0) {
          if ((state.input.fresh[0]! & force.switchButton) !== 0) force.switched = (force.switched + 1) & 1;
          pick = force.switched === 0 ? e1 : e2;
        }
        if (pick.slot !== e1.slot) force.targetLock = TARGET_LOCK;
      }
      result = pick;
    } else if (force.otherOnScreen !== 0) result = e2;
  } else if (e2.pushImmune === 0) result = e2;
  if (force.manualTarget !== 0) force.switched = result !== e1 ? 1 : 0;
  return result;
}

/**
 * Tekken Force's roles for the frame: the player (always the first fighter), the enemy it targets
 * and the other; the player standing as if on the left while no enemy is in play; each one's
 * target and opponent.
 */
export function forceRoles(state: FightState, data: FightData): [Fighter, Fighter, Fighter] {
  const [p, b, c] = state.fighters;
  const e1 = p.target === 1 ? b : c;
  const e2 = e1 === b ? c : b;
  state.force.targetOnScreen = onPicture(e1);
  state.force.otherOnScreen = onPicture(e2);
  const t = chooseTarget(state, data, p, e1, e2);
  const o = t === e1 ? e2 : e1;
  p.sideHeld = e1.pushImmune !== 0 && e2.pushImmune !== 0 ? 1 : 0;
  p.heldSide = 0;
  p.target = t.slot;
  t.target = p.slot;
  o.target = p.slot;
  for (const f of [p, t, o]) f.opponent = targetOf(state, f).slot;
  return [p, t, o];
}

/** The round's frame count, kept as last frame's. */
export function rememberRoundFrames(state: FightState): void {
  state.round.framesSeen = state.round.frames;
}
