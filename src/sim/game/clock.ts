/**
 * The frame's clock, in fields: where the game's code is within its frame, from the vertical blank
 * the frame started at, as its waits move it on (a wait for the next blank, a movie's stream until a
 * frame's data is read). The next frame starts at the blank after the frame ends, so a frame that
 * waits nowhere ends within its field and one that waits holds the next back by the fields it spent.
 */
import type { GameState } from './state.ts';

/** Until the next vertical blank. */
export function waitVblank(game: GameState): void {
  game.clock.now = Math.floor(game.clock.now) + 1;
}

/** Until `time` (in fields), if that is later. */
export function waitUntil(game: GameState, time: number): void {
  if (game.clock.now < time) game.clock.now = time;
}
