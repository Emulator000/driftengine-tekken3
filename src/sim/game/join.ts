/**
 * A player joining with start on a pad that has not: that side becomes a human's (its character
 * to be chosen again), and the newcomer's side is noted.
 */
import type { GameState } from './state.ts';

const START = 0x800;
/** Start with both shoulders held as a player joins. */
const SHOULDERS = 0x80c;

/** Start newly pressed on a pad not in makes its side a human's (true), unless a human has lost the match. */
export function joinWithStart(game: GameState, side: number): boolean {
  const world = game.world;
  if ((world.input.fresh[side]! & START) === 0 || world.match.humanLost !== 0 || world.joined[side] !== 0) return false;
  const held = world.input.rawPads[side]!;
  if ((held & START) !== 0) game.run.shoulders = held === SHOULDERS ? 1 : 0;
  world.joined[side] = 1;
  game.entrants.chosen[side] = 0;
  game.run.newcomer = side;
  return true;
}
