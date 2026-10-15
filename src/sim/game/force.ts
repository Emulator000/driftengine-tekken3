/**
 * Tekken Force's run around its fights: the mode set up once (the keys held and the best score
 * read, the run's record cleared, the target switch off); each stage's match (the computer tuned
 * by the stage, the soldiers on the computer's side, the human's pad kept, the target switch set
 * when the four buttons and a shoulder are held, and one human put on the first side); and the
 * fighters the stage brings, which its match is set up with.
 */
import type { FightTables } from '../fight/match.ts';
import { bossCode, SOLDIERS, soldierCode } from '../fight/force-stage.ts';
import { NO_CHOICE } from './menu.ts';
import { drBEarned } from './records.ts';
import type { GameState } from './state.ts';

/** The computer's tuning stage for each of the five stages. */
const TUNING = [0, 3, 4, 5, 5] as const;
/** The final stage, its enemy (Dr. B) and the soldier standing by in it. */
const FINAL_STAGE = 4;
const DOCTOR_B = 0x13 * 4;
const STANDING_BY = SOLDIERS * 4;
/** The run's flags: Dr. B earned before it began. */
const DR_B_EARNED = 0x10;
/** No boss met on a stage yet (no choice's code, past an added character's). */
const NO_BOSS = NO_CHOICE;
/** The four buttons, and the shoulders that may be the target switch (L1, L2, R1, R2; L2 if none). */
const BUTTONS = 0xf0;
const SHOULDERS = [4, 1, 8, 2] as const;

/** The mode's setup, once a run. */
export function forceModeSetup(game: GameState): void {
  const world = game.world;
  const force = world.force;
  force.keysShown = game.records.forceKeys;
  force.score = 0;
  force.best = game.records.forceBest;
  const run = world.match.force;
  run.score = 0;
  run.newRecord = 0;
  run.kills = 0;
  force.drEarned = drBEarned(game);
  run.flags = force.drEarned !== 0 ? DR_B_EARNED : 0;
  run.bosses.fill(NO_BOSS);
  force.manualTarget = 0;
  force.switchButton = 0;
  force.switched = 0;
  force.targetLock = 0;
}

/**
 * A stage's match, after the players are chosen: the computer's tuning and side, the human's pad
 * kept, the target switch, the codes the stage brings (both soldiers and its boss; Dr. B on the
 * final stage), and the one human put on the first side.
 */
export function forceMatch(game: GameState, tables: FightTables): void {
  const world = game.world;
  const force = world.force;
  const match = world.match;
  world.computer.arcadeStage = TUNING[match.stage] ?? 0;
  const side = match.computerSide;
  game.entrants.roster[side] = SOLDIERS;
  game.entrants.costume[side] = 0;
  game.entrants.computer[side] = 1;
  force.pad = match.humanSide;
  match.force.side = match.humanSide;
  const held = world.input.rawPads[force.pad]!;
  if ((held & BUTTONS) === BUTTONS) {
    force.switchButton = SHOULDERS.find((bit) => (held & bit) !== 0) ?? 1;
    force.manualTarget = 1;
  }
  const human = game.entrants.computer[0] === 0 ? 0 : 1;
  const code = game.entrants.roster[human]! * 4 + game.entrants.costume[human]!;
  const stage = match.stage;
  if (stage < FINAL_STAGE) force.codes.splice(0, 3, soldierCode(tables, stage, 0), soldierCode(tables, stage, 1), bossCode(tables, code, stage));
  else force.codes.splice(0, 3, DOCTOR_B, STANDING_BY, -1);
  match.humanSides = 1;
  world.humans = 1;
  match.humanSide = 0;
  match.computerSide = 1;
}
