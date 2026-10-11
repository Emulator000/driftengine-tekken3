/**
 * The attract cycle's demo: a fight between two of the characters earned, the computer playing
 * both, started when the title times out (and after the attract overlay's intro): the next of the
 * demo's characters in its order, against another chosen by the clock, both in the second costume
 * once 512 plays are passed.
 */
import type { SceneTables } from '../data/scenes.ts';
import { settleCostumes } from './arcade.ts';
import { MenuMode, startMode } from './menu.ts';
import { playCount } from './records.ts';
import type { GameState } from './state.ts';

const CHARACTERS = 0x16;
/** The plays past which the demo's characters wear their second costume (the bit of the count). */
const SECOND_COSTUME = 0x200;

/** The demo's two characters: the next earned one in the demo's order, and another by the clock. */
export function chooseDemoFighters(game: GameState, scenes: SceneTables): void {
  let plays = 0;
  for (let roster = 0; roster < CHARACTERS; roster += 1) plays += playCount(game, roster);
  const earned = scenes.demoFighters.filter((roster) => (game.records.earnedRoster & (1 << (roster & 0x1f))) !== 0);
  let next = game.records.demoTurn + 1;
  if (earned.length <= next) next = 0;
  const clock = game.world.vsyncSeen & 0xfff;
  game.records.demoTurn = next;
  const costume = (plays & SECOND_COSTUME) !== 0 ? 1 : 0;
  const { roster, computer } = game.entrants;
  computer[0] = 1;
  roster[0] = earned[next]!;
  game.entrants.costume[0] = costume;
  settleCostumes(game, 0);
  computer[1] = 1;
  roster[1] = earned[((clock % (earned.length - 1)) + next + 1) % earned.length]!;
  game.entrants.costume[1] = costume;
  settleCostumes(game, 1);
}

/** The demo's fight started, as a mode is from the menu. */
export function startDemo(game: GameState, scenes: SceneTables): void {
  startMode(game, MenuMode.DEMO, 0, (g) => chooseDemoFighters(g, scenes));
}
