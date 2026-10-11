/**
 * What the modes do between fights: who plays, the stage each match is on (a character's home
 * stage and its song), and Arcade's run: its ten opponents drawn for the human's character (four
 * from the first ten, four from all those earned, the boss ninth, Ogre last; an added character
 * meets its own first opponent first), and each round's opponent put on the computer's side.
 */
import type { FightTables } from '../fight/match.ts';
import type { SceneTables } from '../data/scenes.ts';
import { MenuMode } from './menu.ts';
import { stepNoise } from './select.ts';
import type { GameState } from './state.ts';

/** The roster codes past which a character reads the empty code's record. */
const LAST_CODE = 0x5c;
const PAST_CODE = 0x58;
/** The bosses: Heihachi (Jin's when the human is Heihachi), Ogre, and True Ogre (never in the second costume). */
const HEIHACHI = 0xd;
const JIN = 9;
const OGRE = 0xe;
const TRUE_OGRE = 0x14;
/** The roster ids an Arcade run never draws (Ogre, True Ogre, and the boss hidden beside them), and the ones time attack can. */
const NEVER_DRAWN = 0xffef9fff;
const EARNED = 0x1fffff;
const TIME_ATTACK_EARNED = 0x157fff;
/** The record that adds one more to Arcade's draw. */
const EXTRA = 0x20000;
const FIRST_TEN = 0x3ff;

/** A side's character chosen; two sides on one character in one costume kept apart (the newcomer gives way). */
export function settleCostumes(game: GameState, side: number): void {
  const other = (side + 1) & 1;
  const { roster, costume, chosen } = game.entrants;
  const joined = game.world.joined;
  if (chosen[other] !== 0 && roster[side] === roster[other] && costume[side] === costume[other]) {
    if (joined[other] === 0 && joined[side] !== 0) costume[other] = costume[side]! < 2 ? costume[side]! ^ 1 : 0;
    else costume[side] = costume[other]! < 2 ? costume[other]! ^ 1 : 0;
  }
  chosen[side] = 1;
}

/** Which pads play this match: the humans' sides as bits and their count, the human's and the computer's side with one. */
export function choosePlayers(game: GameState): void {
  const world = game.world;
  const humans = (world.joined[0] !== 0 ? 1 : 0) | (world.joined[1] !== 0 ? 2 : 0);
  world.match.humanCount = (humans & 1) + (humans >> 1);
  world.match.humanSides = humans;
  world.humans = humans;
  world.match.humanSide = humans === 2 ? 1 : 0;
  world.match.computerSide = humans === 1 ? 1 : 0;
}

/** A side's roster code. */
const codeOf = (game: GameState, side: number): number => (game.entrants.roster[side]! << 2) | game.entrants.costume[side]!;

/**
 * The match's stage and its song: the computer's home stage with one human, the first side's with
 * none, the newcomer's with two; versus keeps its stage until both characters change.
 */
export function chooseStage(game: GameState, tables: FightTables): void {
  const world = game.world;
  const run = game.run;
  const record = (code: number): { stage: number; song: number } => tables.roster.codes[LAST_CODE < code ? PAST_CODE : code]!;
  const sideOf = (): number => {
    const humans = world.match.humanCount;
    if (humans === 1) return world.match.computerSide;
    if (humans === 0) return 0;
    if (humans === 2) return run.newcomer;
    throw new Error(`no side to take the stage from with ${humans} humans`);
  };
  let code: number;
  switch (world.mode) {
    case MenuMode.VERSUS: {
      let [a, costume] = [game.entrants.roster[0]!, game.entrants.costume[0]!];
      if (0x15 < a || 3 < costume) [a, costume] = [0x16, 0];
      const first = ((a << 2) | costume) & 0xff;
      const second = 0x15 < game.entrants.roster[1]! || 3 < game.entrants.costume[1]! ? PAST_CODE : codeOf(game, 1) & 0xff;
      code = [first, second][run.newcomer]!;
      const kept = run.versusStage;
      if (kept.code !== -1 && first !== kept.first && second !== kept.second) code = kept.code;
      Object.assign(kept, { code, first, second });
      break;
    }
    case MenuMode.TEAM_BATTLE:
    case MenuMode.PRACTICE:
      code = codeOf(game, run.newcomer);
      break;
    case MenuMode.TEKKEN_BALL:
    case MenuMode.TEKKEN_FORCE:
      throw new Error(`mode ${world.mode}'s stage is not remade`);
    default:
      code = codeOf(game, sideOf());
  }
  const { stage, song } = record(code);
  world.stageSong = song;
  world.stage = stage;
  run.stageChosen = stage;
  run.songChosen = song & 0xff;
}

/**
 * Arcade's ten opponents for the human's `code`: four drawn from the first ten characters, four
 * from all those earned (never Ogre, True Ogre, the boss or the human's own), the boss ninth
 * (Jin when the human is Heihachi), Ogre last; the second costume when the human chose any but
 * the first (never Ogre or True Ogre).
 */
function drawOpponents(game: GameState, scenes: SceneTables, code: number): void {
  const opponents = game.run.opponents;
  const boss = code >> 2 === HEIHACHI ? JIN : HEIHACHI;
  let earned = game.world.mode === MenuMode.TIME_ATTACK ? game.records.earnedRoster & TIME_ATTACK_EARNED : game.records.earnedRoster & EARNED;
  if (game.world.mode !== MenuMode.TIME_ATTACK && game.records.extraDrawn !== 0) earned |= EXTRA;
  let left = (earned & NEVER_DRAWN & ~(1 << ((code >> 2) & 0x1f)) & ~(1 << boss)) >>> 0;
  let pool: number[] = [];
  const fill = (mask: number): void => {
    pool = [];
    for (let roster = 0; roster < 0x16; roster += 1) if ((mask & (1 << roster)) !== 0) pool.push(roster);
  };
  const draw = (): number => {
    const index = stepNoise(game) % pool.length;
    const roster = pool[index]!;
    pool[index] = pool[pool.length - 1]!;
    pool.pop();
    return roster;
  };
  fill(left & FIRST_TEN);
  for (let round = 0; round < 4; round += 1) {
    const roster = draw();
    left = (left & ~(1 << (roster & 0x1f))) >>> 0;
    opponents[round]!.roster = roster;
  }
  fill(left);
  for (let round = 4; round < 8; round += 1) opponents[round]!.roster = draw();
  const first = scenes.select.added.find((a) => a.roster === code >> 2)?.firstOpponent;
  if (first !== undefined) {
    let k = 0;
    while (k < 8 && opponents[k]!.roster !== first) k += 1;
    if (k < 8) opponents[k]!.roster = opponents[0]!.roster;
    opponents[0]!.roster = first;
  }
  opponents[8]!.roster = boss;
  opponents[9]!.roster = OGRE;
  opponents.forEach((opponent, k) => {
    opponent.round = k;
    opponent.costume = opponent.roster === TRUE_OGRE || opponent.roster === OGRE ? 0 : (code & 3) !== 0 ? 1 : 0;
  });
}

/** Arcade's (and time attack's) setup the first time: the opponents drawn for the human's character. */
export function arcadeStart(game: GameState, scenes: SceneTables): void {
  if (game.run.started !== 0) return;
  const human = game.world.joined[0] === 0 ? 1 : 0;
  drawOpponents(game, scenes, codeOf(game, human));
  game.world.match.continueOffered = 0;
}

/** Each round: the computer's strength by the round, and with one human the round's opponent on the computer's side. */
export function arcadeRound(game: GameState): void {
  const world = game.world;
  const record = game.run.opponents[world.match.stage]!;
  world.computer.arcadeStage = record.round;
  if (world.match.humanCount !== 1) return;
  const side = world.match.computerSide;
  game.entrants.roster[side] = record.roster;
  game.entrants.costume[side] = record.costume;
  game.entrants.computer[side] = 1;
  settleCostumes(game, side);
  record.roster = game.entrants.roster[side]!;
  record.costume = game.entrants.costume[side]!;
}
