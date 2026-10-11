/**
 * One frame of the fight, in the original's order. The phases are remade one at a time; this
 * module holds the small ones that belong to the frame itself.
 */
import { Mode, type FightState, type Fighter } from './state.ts';

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

/** Each fighter's frame, kept as last frame's for the next. */
export function rememberFrames(state: FightState): void {
  for (const f of state.fighters.slice(0, 2)) f.lastFrame = f.frame;
}

/** The round's frame count, kept as last frame's. */
export function rememberRoundFrames(state: FightState): void {
  state.round.framesSeen = state.round.frames;
}
