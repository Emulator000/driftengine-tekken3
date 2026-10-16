/**
 * The fight scene (scene 8) as the game runs it around the fight: from the menus the characters are
 * chosen first (the character select through the loader) unless the mode chose them; the mode's
 * setup once for its run; each match its players, the mode's opponent and stage, the versus
 * screen, the match set up and a second's wait; each round the picture held a field and let go and
 * the round set up; then a frame a field until the round's end, the next round or the mode's
 * result: Arcade's next opponent, a continue ("CONTINUE?" counting down), game over, the ending.
 * In Arcade's last stage, the first round won against Ogre ends with him changing into True Ogre
 * (start skips it), and the match goes on against True Ogre, the rounds won kept. A Tekken Force
 * stage asks for its boss mid-round: the picture held two fields while he arrives, then the fight
 * goes on; its end is the next stage, the final stage, the results or game over.
 * A second player's start brings a challenger. Start, select and both shoulders held on a pad (or
 * the pause menu's reset; in the attract demo, start) end what is playing and go back to the menu.
 */
import { fightFrame } from '../fight/fight.ts';
import type { FightTables, MatchSetup } from '../fight/match.ts';
import { MOKUJIN, MOKUJIN_DRAWS, startMatch } from '../fight/match.ts';
import { bossArrives, startForceStage } from '../fight/force-stage.ts';
import { forceMatch, forceModeSetup } from './force.ts';
import { startRoundOfGame } from '../fight/start.ts';
import { Flow } from '../fight/flow.ts';
import { practiceFrame, practiceRoundStart } from './practice.ts';
import { printCall } from '../fight/hud.ts';
import type { FightData } from '../fight/state.ts';
import { effect, fadeMusic, musicFadedOut, playSong, resetMusic, stopSounds, voiceLine } from '../fight/voices.ts';
import type { SceneTables } from '../data/scenes.ts';
import { arcadeRound, arcadeStart, ballMatch, choosePlayers, chooseStage, survivalRound } from './arcade.ts';
import { clearShoves } from '../fight/ball.ts';
import { teamRound, teamStart } from './team.ts';
import { joinWithStart } from './join.ts';
import { goToLogo, goToScene, holdPicture, queueFile, START_SOUND, startPressed } from './logo.ts';
import { MenuMode } from './menu.ts';
import { motorsOff, stopMotors } from './rumble.ts';
import { startOgreChange, stepOgreChange } from './ogre-change.ts';
import { addForceKey, addStreakWin, checkSurvivalRecord, checkTimeRecord, countArcadePlay, countVersusDraw, countVersusResult, earnDrB, earnOnDefeat, recordEnding, recordStageTime, setForceBest, setStreakSide } from './records.ts';
import { Scene, type GameState } from './state.ts';

/** The buttons a soft reset needs held (start and select, nothing but the shoulders besides), and select newly pressed. */
const RESET_HELD = 0x900;
const RESET_MASK = 0xfff3;
const SELECT = 0x100;
/** The pause menu's choice that resets. */
const PAUSE_RESET = 3;
/** The fight scene's states. */
export const FightStep = {
  FROM_MENUS: 0,
  MODE_SETUP: 1,
  MATCH: 2,
  LOAD: 3,
  WAIT: 4,
  HOLD: 5,
  SHOW: 6,
  ROUND_START: 7,
  FIGHTING: 8,
  CONTINUE: 9,
  CONTINUING: 10,
  GAME_OVER: 0xb,
  GAME_OVER_SHOWN: 0xc,
  CHALLENGER: 0xd,
  CHALLENGER_SHOWN: 0xe,
  OGRE_CHANGE: 0xf,
  OGRE_CHANGE_START: 0x10,
  OGRE_CHANGING: 0x11,
  OGRE_CHANGED: 0x12,
  TRUE_OGRE_SHOWN: 0x13,
  TRUE_OGRE: 0x14,
  DEMO_OVER: 0x18,
  /** Tekken Force's boss on his way: the picture held, let go, and the boss arrived. */
  FORCE_HOLD: 0x15,
  FORCE_SHOW: 0x16,
  FORCE_BOSS: 0x17,
  /** Practice's RESET: back to the mode menu. */
  PRACTICE_RESET: 0x19,
} as const;
/** Tekken Force's final stage (its index), the stages before it, and the round flow that asks for the boss. */
const FORCE = { finalStage: 4, bossAsked: 7 } as const;
/** Arcade's last opponent, Ogre, who changes into True Ogre. */
const LAST_OPPONENT = 9;
const TRUE_OGRE = 0x14;
/** Fields the match's load waits after the versus screen began. */
const LOAD_WAIT = 0x3b;
/** How many frames the music takes to fade out as a match's versus screen comes up: about as long as the picture's cut to it. */
const MATCH_SILENCE = 0x14;
/** Fields into a round before a challenger may join. */
const JOIN_WAIT = 8;
/** The continue's count: frames a count, the counts, its announcer's lines (the count's and none left), the music's volume. */
const CONTINUE = { count: 0x5a, frames: 0x328, call: 0x16, line: 0x1004, over: 0x1017, volume: 0x3c } as const;
/** Game over's song and the frames it shows. */
const GAME_OVER = { song: 3, frames: 0x78 } as const;
/** The challenger's sound, how long its lines blink, and where (the second a line down, five letters in). */
const CHALLENGER = { sound: 0x49a1, frames: 0x4a, blink: 0x18, late: 0x17, x: 8, y: 0x120 } as const;
const START = 0x800;
const BUTTONS = 0xf0;
/** Arcade's ten matches; the ending's movie scene. */
const ARCADE_MATCHES = 10;

/** What the fight scene reads: the tables, and the match's data once loaded. */
export interface FightSceneData {
  readonly tables: FightTables;
  readonly scenes: SceneTables;
  /** The match's data, loaded for its setup. */
  load(setup: MatchSetup): FightData;
  /** The data of the match being fought. */
  readonly match: FightData | null;
}

/**
 * The match the game's choices set up: the stage and each side's character and whether the
 * computer plays it; with Mokujin, the characters earned he draws from. A Tekken Force stage's:
 * the human first, then the enemies and the boss the stage brings.
 */
export function matchSetup(game: GameState): MatchSetup {
  const world = game.world;
  if (world.mode === MenuMode.TEKKEN_FORCE) {
    const human = game.entrants.computer[0] === 0 ? 0 : 1;
    const enemy = (code: number): MatchSetup['entrants'][0] => ({ roster: code >> 2, costume: code & 3, computer: true });
    const [first, third, boss] = world.force.codes as [number, number, number];
    const entrants = [{ roster: game.entrants.roster[human]!, costume: game.entrants.costume[human]!, computer: false }, enemy(first)] as const;
    const draws = entrants[0].roster === MOKUJIN || boss >> 2 === MOKUJIN ? game.records.earnedRoster & MOKUJIN_DRAWS : 0;
    return { stage: world.stage, entrants, force: { third: enemy(third), boss: boss < 0 ? null : enemy(boss) }, ...(draws === 0 ? {} : { draws }) };
  }
  const entrants = [0, 1].map((side) => ({ roster: game.entrants.roster[side]!, costume: game.entrants.costume[side]!, computer: game.entrants.computer[side] !== 0 })) as unknown as MatchSetup['entrants'];
  const draws = entrants.some((e) => e.roster === MOKUJIN) ? game.records.earnedRoster & MOKUJIN_DRAWS : 0;
  return { stage: world.stage, entrants, ...(draws === 0 ? {} : { draws }) };
}

/** A soft reset: true when it ended what was playing and went back to the mode menu, the music's driver reset and every sound stopped. */
export function softReset(game: GameState, data: Pick<FightData, 'sound'>): boolean {
  const world = game.world;
  if (world.mode === MenuMode.DEMO) {
    if (!startPressed(game)) return false;
  } else {
    const asked = (pad: number): boolean => (world.input.rawPads[pad]! & RESET_MASK) === RESET_HELD && (world.input.fresh[pad]! & SELECT) !== 0;
    if (!asked(0) && !asked(1) && world.pauseMenu.choice !== PAUSE_RESET) return false;
  }
  world.pauseMenu.choice = 0;
  resetMusic(world);
  stopSounds(world, true);
  stopMotors(game);
  voiceLine(world, data, 0, START_SOUND, 0);
  /* The waiting room left: no more waiting, back to ONLINE MODE's page. */
  if (game.online.warming !== 0) {
    Object.assign(game.online, { warming: 0, opens: 1, ask: 'cancel' });
    goToLogo(game, Scene.OPTIONS);
    return true;
  }
  goToLogo(game, Scene.MENU);
  return true;
}

/** On to the records (the picture held). */
function toRecords(game: GameState): void {
  holdPicture(game, 1);
  game.scene = Scene.RECORDS_LOADER;
  game.step = 0;
}

/** On to `next` through the overlay loader (the picture held). */
function throughLoader(game: GameState, next: number): void {
  holdPicture(game, 1);
  game.last = game.scene;
  game.scene = Scene.OVERLAY_LOADER;
  game.next = next;
  game.step = 0;
}

/** A frame of the fight, drawn (in practice its own frame after it, which may end the round). */
function frame(game: GameState, data: FightSceneData): number {
  let flow = fightFrame(game.world, data.match!);
  if (game.world.mode === MenuMode.PRACTICE) {
    practiceFrame(game, { match: data.match!, scenes: data.scenes });
    flow = (game.world.round.flow << 16) >> 16;
  }
  game.drewFight = 1;
  return flow;
}

/**
 * Arcade's match over: with one human, a win keeps the stage's time, earns the hidden character
 * beaten and moves to the next of the ten (past the tenth the ending is recorded and its movie
 * follows); a loss counts the play and offers a continue. With two, the loser leaves, the play is
 * counted and the winner's streak grows.
 */
function arcadeResult(game: GameState, scenes: SceneTables): void {
  const world = game.world;
  const run = game.run;
  const { roster, costume } = game.entrants;
  const winner = world.match.winnerSide;
  const loser = world.match.loserSide;
  if (world.match.humanCount === 1) {
    if (winner === world.match.humanSide) {
      run.lastTime = 0;
      world.match.totalTime += world.match.fightFrames;
      recordStageTime(game, world.match.stage, roster[winner]!, costume[winner]!, winner, world.match.fightFrames);
      earnOnDefeat(game, roster[world.match.computerSide]!);
      world.match.stage += 1;
      if (world.match.stage < ARCADE_MATCHES) {
        game.step = FightStep.MATCH;
        return;
      }
      run.ending.side = winner;
      run.ending.code = roster[winner]! * 4 + costume[winner]!;
      recordEnding(game, scenes, roster[winner]!, costume[winner]!);
      countArcadePlay(game, scenes, roster[winner]!);
      world.hud.shown = 0;
      world.joined[winner] = 0;
      throughLoader(game, Scene.MOVIE);
      return;
    }
    run.lastTime = world.match.fightFrames;
    world.joined[loser] = 0;
    game.entrants.chosen[loser] = 0;
    countArcadePlay(game, scenes, roster[loser]!);
    game.step = FightStep.CONTINUE;
    return;
  }
  if (world.match.humanCount !== 2) return;
  run.versusMatches += 1;
  countVersusResult(game, scenes, roster[winner]!, roster[loser]!);
  world.joined[loser] = 0;
  game.entrants.chosen[loser] = 0;
  addStreakWin(game, winner);
  game.step = FightStep.MATCH;
}

/**
 * Time Attack's match over: a win keeps the stage's time and moves to the next of the ten (past the
 * tenth the run's time is checked against the record and its results follow); a loss counts the
 * play and offers a continue.
 */
export function timeAttackResult(game: GameState, scenes: SceneTables): void {
  const world = game.world;
  const run = game.run;
  const { roster, costume } = game.entrants;
  const winner = world.match.winnerSide;
  const loser = world.match.loserSide;
  if (winner === world.match.humanSide) {
    run.lastTime = 0;
    world.match.totalTime += world.match.fightFrames;
    recordStageTime(game, world.match.stage, roster[winner]!, costume[winner]!, winner, world.match.fightFrames);
    world.match.stage += 1;
    if (world.match.stage < ARCADE_MATCHES) {
      game.step = FightStep.MATCH;
      return;
    }
    run.ending.side = winner;
    run.ending.code = roster[winner]! * 4 + costume[winner]!;
    checkTimeRecord(game, scenes);
    countArcadePlay(game, scenes, roster[winner]!);
    world.joined[winner] = 0;
    throughLoader(game, Scene.TIME_RESULTS);
    return;
  }
  run.lastTime = world.match.fightFrames;
  world.joined[loser] = 0;
  game.entrants.chosen[loser] = 0;
  countArcadePlay(game, scenes, roster[loser]!);
  game.step = FightStep.CONTINUE;
}

/**
 * A Team Battle bout over: its winner kept; a win adds to the winner's streak and sends the loser's
 * next member in, a draw both sides' (counting the characters as versus does with two humans, the
 * human's play with one); the next bout comes until a team has none left, then the results, every
 * human whose team still stood counted.
 */
export function teamResult(game: GameState, scenes: SceneTables): void {
  const world = game.world;
  const team = game.run.team;
  const { roster } = game.entrants;
  const match = world.match;
  team.bouts[team.bout] = match.winner;
  const human = (): void => countArcadePlay(game, scenes, roster[match.humanSide]!);
  if (match.winner !== 0 && match.winner < 3) {
    addStreakWin(game, match.winnerSide);
    world.match.teams[match.loserSide]!.next += 1;
    if (match.humanCount === 2) countVersusResult(game, scenes, roster[match.winnerSide]!, roster[match.loserSide]!);
    else if (match.humanCount === 1 && match.loserSide === match.humanSide) human();
  } else if (match.winner === 3) {
    world.match.teams[0]!.next += 1;
    world.match.teams[1]!.next += 1;
    if (match.humanCount === 2) countVersusDraw(game, scenes, roster[0]!, roster[1]!);
    else if (match.humanCount === 1) human();
  }
  team.bout += 1;
  if (world.match.teams.every((side) => side.next < side.size)) {
    game.step = FightStep.MATCH;
    return;
  }
  world.match.teams.forEach((side, n) => {
    if (side.next < side.size && ((match.humanSides >> n) & 1) !== 0 && match.winner !== 3) countArcadePlay(game, scenes, roster[n]!);
    world.joined[n] = 0;
    game.entrants.chosen[n] = 0;
  });
  throughLoader(game, Scene.TEAM_RESULTS);
}

/**
 * Survival's match over: a win adds to the streak and to how often the opponent was beaten, and
 * the next comes; a loss ends the run, its wins checked against the records, its results next.
 */
export function survivalResult(game: GameState, scenes: SceneTables): void {
  const world = game.world;
  const run = game.run;
  const human = world.match.humanSide;
  const loser = game.entrants.roster[world.match.loserSide]!;
  if (world.match.winnerSide === human) {
    addStreakWin(game, human);
    world.match.stage += 1;
    const beaten = run.survival.beaten;
    beaten[loser] = (beaten[loser]! + 1) & 0xffff;
    world.match.survivalWins = beaten.reduce((sum, n) => sum + n, 0);
    game.step = FightStep.MATCH;
    return;
  }
  run.ending.side = human;
  run.ending.code = (loser << 2) | game.entrants.costume[human]!;
  checkSurvivalRecord(game, scenes, human, loser, world.match.streak);
  world.joined[human] = 0;
  game.entrants.chosen[human] = 0;
  countArcadePlay(game, scenes, loser);
  throughLoader(game, Scene.SURVIVAL_RESULTS);
}

/**
 * Versus's match over: counted; a win adds to the winner's wins and streak and counts both
 * characters (the winner's as a play too), a draw adds to the draws, starts the streak afresh and
 * counts both; then both sides choose again.
 */
export function versusResult(game: GameState, scenes: SceneTables): void {
  const world = game.world;
  const record = game.run.versusRecord;
  const { roster } = game.entrants;
  game.run.versusMatches += 1;
  const winner = world.match.winnerSide;
  if (world.match.winner !== 0 && world.match.winner < 3) {
    addStreakWin(game, winner);
    record.wins[winner] = (record.wins[winner]! + 1) & 0xffff;
    countVersusResult(game, scenes, roster[winner]!, roster[world.match.loserSide]!);
    countArcadePlay(game, scenes, roster[winner]!);
  } else if (world.match.winner === 3) {
    setStreakSide(game, world.match.streakSide);
    record.draws = (record.draws + 1) & 0xffff;
    countVersusDraw(game, scenes, roster[0]!, roster[1]!);
  }
  game.entrants.chosen[1] = 0;
  game.entrants.chosen[0] = 0;
  game.step = FightStep.FROM_MENUS;
}

/**
 * Tekken Ball's match over: the plays counted (a lone human's, and its opponent earned when it
 * wins; both of two humans', the loser's side then the computer's), and back to the versus select.
 */
function ballResult(game: GameState, scenes: SceneTables): void {
  const world = game.world;
  const match = world.match;
  const { roster } = game.entrants;
  if (match.humanCount === 1) {
    countArcadePlay(game, scenes, roster[match.humanSide]!);
    if (match.winnerSide === match.humanSide) earnOnDefeat(game, roster[match.computerSide]!);
  } else if (match.humanCount === 2) {
    countArcadePlay(game, scenes, roster[0]!);
    countArcadePlay(game, scenes, roster[1]!);
    world.joined[match.loserSide] = 0;
  }
  game.entrants.chosen[0] = 0;
  game.entrants.chosen[1] = 0;
  game.step = FightStep.FROM_MENUS;
}

/**
 * "CONTINUE? n" counting down from nine (a button skips a count, the announcer says each); start
 * continues: 1 with the same character, 2 to choose again (the option). -1 when the count runs
 * out, 0 while it runs.
 */
function askToContinue(game: GameState, data: FightSceneData, side: number): number {
  const world = game.world;
  const pressed = world.input.fresh[side]!;
  if ((pressed & START) !== 0) {
    world.joined[side] = 1;
    voiceLine(world, data.tables, 0, START_SOUND, 0);
    const again = game.run.continueChooses !== 0;
    game.entrants.chosen[side] = again ? 0 : 1;
    return again ? 2 : 1;
  }
  if ((pressed & BUTTONS) !== 0) {
    const short = game.count < CONTINUE.count;
    game.count -= CONTINUE.count;
    if (short) game.count = 0;
  }
  if (game.count === 0) return -1;
  if (0 < game.count) game.count -= 1;
  const count = Math.trunc((game.count + CONTINUE.count) / CONTINUE.count);
  const within = (game.count + CONTINUE.count) % CONTINUE.count;
  if (count < 9 && within === CONTINUE.count - 1) effect(world, data.tables, count === 0 ? CONTINUE.over : count + CONTINUE.line);
  printCall(world, 2, 9, 0x3f, 200, `CONTINUE? ${count}`);
  return 0;
}

/** A challenger's arrival over: the picture held and the fight scene started over for the new match. */
function challengerArrived(game: GameState): void {
  holdPicture(game, 1);
  if (game.run.challengerChooses !== 0) {
    game.entrants.chosen[0] = 0;
    game.entrants.chosen[1] = 0;
  }
  game.step = FightStep.FROM_MENUS;
}

/**
 * The fight: a few frames in, start on a pad not in brings a challenger (where the mode allows);
 * then a frame, and at the round's or match's end the next round or the mode's result.
 */
function fighting(game: GameState, data: FightSceneData): void {
  const world = game.world;
  const mode = world.mode;
  if (game.count === 0) {
    if (game.run.challengers !== 0) {
      const first = joinWithStart(game, 0);
      const second = joinWithStart(game, 1);
      if (first || second) {
        game.step = FightStep.CHALLENGER;
        return;
      }
    }
  } else game.count -= 1;
  world.nothingDrawn = 0;
  const flow = frame(game, data);
  world.nothingDrawn = 0;
  if (mode === MenuMode.DEMO && 2 < flow) {
    game.step = FightStep.DEMO_OVER;
    return;
  }
  /* Tekken Force: a key the stage won kept with the records at once; the boss asked for. */
  if (world.force.keyToSave !== 0) {
    world.force.keyToSave = 0;
    addForceKey(game, data.scenes);
  }
  if (mode === MenuMode.TEKKEN_FORCE && flow === FORCE.bossAsked) {
    game.step = FightStep.FORCE_HOLD;
    return;
  }
  if (flow < 9) return;
  if (flow === Flow.TRUE_OGRE) {
    holdPicture(game, 1);
    game.step = mode !== MenuMode.TIME_ATTACK ? FightStep.OGRE_CHANGE : FightStep.TRUE_OGRE_SHOWN;
    return;
  }
  if (flow === Flow.PRACTICE_RESET) {
    game.step = FightStep.PRACTICE_RESET;
    return;
  }
  /* Practice's PLAYER SELECT: back to the character select, its partner out and both choices cleared. */
  if (mode === MenuMode.PRACTICE) {
    game.step = FightStep.FROM_MENUS;
    world.joined[game.run.newcomer] = 0;
    game.entrants.chosen[0] = 0;
    game.entrants.chosen[1] = 0;
    return;
  }
  if (world.match.winner === 0) {
    game.step = FightStep.HOLD;
    return;
  }
  if (mode === MenuMode.ARCADE) arcadeResult(game, data.scenes);
  else if (mode === MenuMode.VERSUS) versusResult(game, data.scenes);
  else if (mode === MenuMode.TIME_ATTACK) timeAttackResult(game, data.scenes);
  else if (mode === MenuMode.SURVIVAL) survivalResult(game, data.scenes);
  else if (mode === MenuMode.TEAM_BATTLE) teamResult(game, data.scenes);
  else if (mode === MenuMode.TEKKEN_BALL) ballResult(game, data.scenes);
  else if (mode === MenuMode.TEKKEN_FORCE) forceResult(game, data.scenes);
  else if (mode === MenuMode.DEMO) game.step = FightStep.DEMO_OVER;
  else throw new Error(`mode ${mode}'s result is not remade`);
}

/**
 * Tekken Force's stage over: lost (the boss not reached or the player beaten), the play counted,
 * the best score kept and game over (no continue); cleared, on to the next stage, or after the
 * fourth to the final stage when its challenge was earned; otherwise (or with the final stage
 * cleared, which earns Dr. B) the play counted, the best score kept, the run's score kept for the
 * results, and on to them.
 */
function forceResult(game: GameState, scenes: SceneTables): void {
  const world = game.world;
  const roster = world.fighters[0].roster;
  const over = (): void => {
    world.joined.fill(0);
    game.entrants.chosen.fill(0);
    countArcadePlay(game, scenes, roster);
  };
  if (world.force.bossPhase === 0 || world.match.winnerSide !== world.match.humanSide) {
    over();
    setForceBest(game, scenes, world.force.best);
    game.step = FightStep.GAME_OVER;
    return;
  }
  world.match.stage += 1;
  const stage = world.match.stage;
  if (stage < FORCE.finalStage || (stage === FORCE.finalStage && world.force.challenge !== 0)) {
    game.step = FightStep.MATCH;
    return;
  }
  over();
  world.hud.shown = 0;
  if (FORCE.finalStage < stage) earnDrB(game);
  setForceBest(game, scenes, world.force.best);
  world.match.force.score = world.force.score;
  throughLoader(game, Scene.FORCE_RESULTS);
}

/**
 * The match against True Ogre, set up in Ogre's place: Arcade's last opponent made True Ogre, put
 * on the computer's side, his stage chosen and the match loaded with no versus screen, the round
 * and both sides' wins kept (unless a match is a round).
 */
function trueOgreMatch(game: GameState, data: FightSceneData): void {
  const world = game.world;
  game.run.opponents[LAST_OPPONENT]!.roster = TRUE_OGRE;
  world.match.winner = 0;
  world.match.winnerSide = 0;
  world.match.loserSide = 0;
  world.sceneryAtOrigin = 0;
  arcadeRound(game);
  chooseStage(game, data.tables);
  if (world.round.last < 2) {
    world.round.number = 0;
    world.fighters[0].wins = 0;
    world.fighters[1].wins = 0;
  }
  const [round, first, second] = [world.round.number, world.fighters[0].wins, world.fighters[1].wins];
  const setup = matchSetup(game);
  startMatch(world, data.load(setup), setup);
  world.round.number = round;
  world.fighters[0].wins = first;
  world.fighters[1].wins = second;
}

/** The fight scene's step in its state; some states go straight on to the next in the same field. */
function step(game: GameState, data: FightSceneData): void {
  const world = game.world;
  const run = game.run;
  const mode = world.mode;
  switch (game.step) {
    case FightStep.FROM_MENUS:
      world.match.humanLost = 0;
      if (mode === MenuMode.DEMO) {
        motorsOff(game);
        game.step = FightStep.MODE_SETUP;
        return step(game, data);
      }
      game.motors[0] = game.options.vibration[0]!;
      game.motors[1] = game.options.vibration[1]!;
      run.after.scene = Scene.FIGHT;
      run.after.step = FightStep.MODE_SETUP;
      if (run.skipsSelect === 0 && run.modeSetting === 0 && run.shoulders === 0) {
        queueFile(game);
        goToScene(game, Scene.SELECT, 0);
        return;
      }
      holdPicture(game, 1);
      game.scene = Scene.VS_SELECT;
      return;
    case FightStep.MODE_SETUP:
      if (mode === MenuMode.ARCADE || mode === MenuMode.TIME_ATTACK) arcadeStart(game, data.scenes);
      else if (mode === MenuMode.TEAM_BATTLE) teamStart(game);
      else if (mode === MenuMode.TEKKEN_BALL) clearShoves(world);
      else if (mode === MenuMode.TEKKEN_FORCE) forceModeSetup(game);
      run.started = 1;
      for (const scroll of world.pauseMenu.scrolls) Object.assign(scroll, { place: 0, offset: 0 });
      game.step = FightStep.MATCH;
      return step(game, data);
    case FightStep.MATCH:
      choosePlayers(game);
      world.match.winner = 0;
      world.match.winnerSide = 0;
      world.match.loserSide = 0;
      world.match.fightFrames = run.lastTime;
      if (mode === MenuMode.ARCADE || mode === MenuMode.TIME_ATTACK) arcadeRound(game);
      else if (mode === MenuMode.SURVIVAL) survivalRound(game);
      else if (mode === MenuMode.TEAM_BATTLE) teamRound(game);
      else if (mode === MenuMode.TEKKEN_BALL) ballMatch(game);
      else if (mode === MenuMode.TEKKEN_FORCE) forceMatch(game, data.tables);
      game.count = world.vsyncSeen;
      chooseStage(game, data.tables);
      run.after.scene = Scene.FIGHT;
      run.after.step = FightStep.LOAD;
      /* The match loads silent: what still plays (a won match's song fading, the select's) faded out as the picture cuts to the versus screen. */
      musicFadedOut(world, MATCH_SILENCE);
      game.scene = Scene.VERSUS;
      game.step = 0;
      holdPicture(game, 1);
      return;
    case FightStep.LOAD: {
      const setup = matchSetup(game);
      const loaded = data.load(setup);
      startMatch(world, loaded, setup);
      if (mode === MenuMode.TEKKEN_FORCE) startForceStage(world, loaded);
      game.step = FightStep.WAIT;
      return step(game, data);
    }
    case FightStep.WAIT:
      if (LOAD_WAIT < ((world.vsyncSeen - game.count) >>> 0)) game.step = FightStep.HOLD;
      return;
    case FightStep.HOLD:
      holdPicture(game, 1);
      game.step = FightStep.SHOW;
      return;
    case FightStep.SHOW:
      holdPicture(game, 0);
      game.step = FightStep.ROUND_START;
      return;
    case FightStep.ROUND_START:
      startRoundOfGame(world, data.match!);
      if (mode === MenuMode.PRACTICE) practiceRoundStart(game, data.match!);
      game.count = JOIN_WAIT;
      game.step = FightStep.FIGHTING;
      return;
    case FightStep.FIGHTING:
      return fighting(game, data);
    case FightStep.CONTINUE:
      effect(world, data.tables, CONTINUE.call);
      fadeMusic(world, CONTINUE.volume, CONTINUE.volume);
      game.count = CONTINUE.frames;
      world.match.continuing = 1;
      game.step = FightStep.CONTINUING;
      return step(game, data);
    case FightStep.CONTINUING: {
      frame(game, data);
      const answer = askToContinue(game, data, world.match.loserSide);
      if (answer === 0) return;
      world.match.continuing = 0;
      if (answer === 1 || answer === 2) {
        game.step = answer === 1 ? FightStep.MATCH : FightStep.FROM_MENUS;
        setStreakSide(game, world.match.winnerSide);
      } else game.step = FightStep.GAME_OVER;
      return;
    }
    case FightStep.GAME_OVER:
      game.count = 0;
      world.joined[world.match.loserSide] = 0;
      effect(world, data.tables, CONTINUE.over);
      playSong(world, GAME_OVER.song, false);
      game.step = FightStep.GAME_OVER_SHOWN;
      return step(game, data);
    case FightStep.GAME_OVER_SHOWN:
      printCall(world, 2, 1, 0x55, 200, 'GAME OVER');
      frame(game, data);
      game.count += 1;
      if (GAME_OVER.frames < game.count) toRecords(game);
      return;
    case FightStep.CHALLENGER:
      voiceLine(world, data.tables, 0, CHALLENGER.sound, 0);
      fadeMusic(world, 0, 0x1e);
      game.count = 8;
      world.match.challenger = 1;
      if (run.skipsSelect !== 0 || run.modeSetting !== 0 || run.shoulders !== 0) return challengerArrived(game);
      game.step = FightStep.CHALLENGER_SHOWN;
      return step(game, data);
    case FightStep.CHALLENGER_SHOWN: {
      const flow = frame(game, data);
      if (0 < flow || CHALLENGER.late < game.count) world.pause.paused = 1;
      if ((game.count & CHALLENGER.blink) !== 0) {
        printCall(world, 2, 7, CHALLENGER.x, CHALLENGER.y, 'A NEW CHALLENGER');
        printCall(world, 2, 7, CHALLENGER.x + 5 * 22, CHALLENGER.y + 42, 'ENTERS!!');
      }
      game.count += 1;
      if (game.count < CHALLENGER.frames) return;
      return challengerArrived(game);
    }
    case FightStep.OGRE_CHANGE:
      holdPicture(game, 0);
      game.step = FightStep.OGRE_CHANGE_START;
      return;
    case FightStep.OGRE_CHANGE_START:
      startOgreChange(game, data.match!);
      game.step = FightStep.OGRE_CHANGING;
      return;
    case FightStep.OGRE_CHANGING:
      if (stepOgreChange(game, data.match!, data.scenes) || (world.input.fresh[world.match.humanSide]! & START) !== 0) game.step = FightStep.OGRE_CHANGED;
      return;
    case FightStep.OGRE_CHANGED:
      holdPicture(game, 1);
      game.step = FightStep.TRUE_OGRE_SHOWN;
      return;
    case FightStep.TRUE_OGRE_SHOWN:
      holdPicture(game, 0);
      game.step = FightStep.TRUE_OGRE;
      return;
    case FightStep.TRUE_OGRE:
      trueOgreMatch(game, data);
      game.step = FightStep.HOLD;
      return;
    case FightStep.FORCE_HOLD:
      holdPicture(game, 1);
      game.step = FightStep.FORCE_SHOW;
      return;
    case FightStep.FORCE_SHOW:
      holdPicture(game, 0);
      game.step = FightStep.FORCE_BOSS;
      return;
    case FightStep.FORCE_BOSS:
      bossArrives(world, data.match!);
      game.step = FightStep.FIGHTING;
      return;
    case FightStep.DEMO_OVER:
      stopSounds(world, false);
      stopMotors(game);
      if (game.attract.step !== 3) toRecords(game);
      else goToLogo(game, Scene.TITLE);
      return;
    default:
      /* Practice's RESET (and any other state): back to the mode menu. */
      stopSounds(world, true);
      voiceLine(world, data.tables, 0, START_SOUND, 0);
      stopMotors(game);
      goToLogo(game, Scene.MENU);
  }
}

/** Scene 8: the soft reset first, then the state's step. */
export function fightScene(game: GameState, data: FightSceneData): void {
  game.drewFight = 0;
  if (softReset(game, data.tables)) return;
  step(game, data);
}
