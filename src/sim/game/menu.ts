/**
 * The mode menu (scene 4): the modes in a list scrolling through seven rows over the title's
 * picture (Tekken Ball and the Theater listed once earned, blinking while new), up and down to
 * pick, start or a button to choose; 480 idle frames go back to the title. Choosing a mode starts
 * it: the match's settings from the options, the entrants cleared, the side whose pad chose made
 * the human, the mode's own switches; then its overlay is loaded (scene 7) and the fight scene
 * begins.
 */
import type { FightData } from '../fight/state.ts';
import { voiceLine } from '../fight/voices.ts';
import type { MenuEntry, SceneTables } from '../data/scenes.ts';
import { goToLogo, goToScene, holdPicture, queueFile } from './logo.ts';
import { print } from './printer.ts';
import { blankPractice, Scene, type GameState } from './state.ts';
import { drawTitle, TitleShows } from './title.ts';
import { motorsOff, stopMotors } from './rumble.ts';

/** The list: its middle across, the first row's line, a row's height, the rows shown, a glyph's advance. */
const LIST = { centre: 0xb8, top: 0x116, row: 0x1c, rows: 7, advance: 0xd } as const;
/** Frames the menu waits before going back to the title. */
const IDLE = 0x1e1;
const UP = 0x1000;
const DOWN = 0x4000;
/** Start and the four buttons choose. */
const CHOOSE = 0x8f0;
const MOVE_SOUND = 0x546c;
const CHOOSE_SOUND = 0x4d87;
/** The colour a new entry blinks in, and the bar's brightness step. */
const NEW_COLOUR = 0xe;
const BAR_STEP = 0x18;
const FULL = 0x100;
/** The modes the menu treats apart. */
export const MenuMode = { ARCADE: 0, VERSUS: 1, TEAM_BATTLE: 2, TIME_ATTACK: 3, SURVIVAL: 4, PRACTICE: 5, DEMO: 6, TEKKEN_BALL: 7, TEKKEN_FORCE: 8, OPTIONS: 9, THEATER: 10, ONLINE: 11 } as const;
/** The remake's own entry, listed after VS MODE: ONLINE MODE's page. */
const ONLINE_ENTRY: MenuEntry = { name: 'ONLINE MODE', mode: MenuMode.ONLINE, twoPads: false, colour: 3 };
/** Earned and no longer new. */
const SHOWN = 3;
/** `toOptions` coming back from ONLINE MODE's page rather than the Options. */
export const BACK_FROM_ONLINE = 2;
/** No character chosen yet: the roster id the select reads as none; and a last choice naming no one (the game's own 0x58 is the first added character's code). */
const NO_ONE = 0x16;
/** A team's size as Team Battle starts. */
const TEAM_SIZE = 4;
export const NO_CHOICE = 0xfc;
/** The replay's record marked unused. */
const NO_REPLAY = 0x17;
/** The round time setting past which the timer stands still. */
const TIMED = 4;

/** Each pad's buttons mapped as its key configuration says (the last eight fixed). */
export function mapPads(game: GameState, scenes: SceneTables): void {
  for (let side = 0; side < 2; side += 1) {
    const map = game.pads.maps[side]!;
    for (let i = 0; i < 8; i += 1) map[i] = scenes.keyBits[game.options.keys[side]![i]!]!;
    for (let i = 0; i < 8; i += 1) map[8 + i] = scenes.fixedKeys[i]!;
  }
}


/** The list drawn: easing to its place, seven rows from three above the picked one, the bar lit once it rests, over the title's picture. */
function drawMenu(game: GameState, scenes: SceneTables): void {
  const menu = game.menu;
  if (menu.scroll !== 0) {
    const size = Math.abs(menu.scroll);
    const eased = Math.max(size - ((size + 3) >> 2), 0);
    menu.scroll = menu.scroll < 0 ? -eased : eased;
  }
  const count = menu.count;
  let index = menu.picked < 3 ? menu.picked - 3 + count : menu.picked - 3;
  let y = menu.scroll + LIST.top;
  for (let row = 0; row < LIST.rows; row += 1) {
    index %= count;
    const item = menu.items[index]!;
    const blink = menu.chosen === 0 && item.fresh && (game.world.vsyncSeen & 3) === 0;
    print(game, 1, blink ? NEW_COLOUR : item.colour, LIST.centre - ((item.name.length * LIST.advance) >> 1), y, item.name);
    index += 1;
    y += LIST.row;
  }
  menu.bar = menu.scroll === 0 ? Math.min(menu.bar + BAR_STEP, FULL) : 0;
  drawTitle(game, scenes, TitleShows.PICTURE);
}

/** Scene 4. */
export function menuScene(game: GameState, data: Pick<FightData, 'sound'>, scenes: SceneTables): void {
  const world = game.world;
  const menu = game.menu;
  const pressed = world.input.fresh[0]! | world.input.fresh[1]!;
  const repeated = game.pads.repeats[0]! | game.pads.repeats[1]!;
  switch (game.step) {
    case 0: {
      stopMotors(game);
      world.joined[1] = 0;
      world.joined[0] = 0;
      mapPads(game, scenes);
      menu.items = [];
      for (const entry of scenes.menu) {
        const earned = entry.mode === MenuMode.TEKKEN_BALL ? game.earned.ball : entry.mode === MenuMode.THEATER ? game.earned.theater : SHOWN;
        if (earned !== 0) menu.items.push({ ...entry, fresh: earned < SHOWN });
        if (entry.mode === MenuMode.VERSUS) menu.items.push({ ...ONLINE_ENTRY, fresh: false });
      }
      menu.count = menu.items.length;
      menu.chosen = 0;
      if (menu.toOptions !== 0) {
        const back = menu.toOptions === BACK_FROM_ONLINE ? MenuMode.ONLINE : MenuMode.OPTIONS;
        menu.toOptions = 0;
        const at = menu.items.findIndex((item) => item.mode === back);
        menu.picked = at < 0 ? menu.count : at;
        if (10 < menu.picked) menu.picked = 0;
      }
      game.count = 0;
      menu.scroll = 0;
      menu.bar = 0;
      game.step = 1;
      break;
    }
    case 1: {
      game.count += 1;
      if (IDLE <= game.count) {
        game.step = 3;
        menu.chosen = 1;
        break;
      }
      const count = menu.count;
      let at = menu.picked;
      let step = ((repeated & DOWN) !== 0 ? 1 : 0) - ((repeated & UP) !== 0 ? 1 : 0);
      if (count <= at) at = 0;
      /* Both pads are in, so an entry that needs both is never skipped. */
      let next = (at + step) >>> 0;
      if (count <= next) next = count - (at + 1);
      menu.scroll += step * LIST.row;
      menu.picked = next;
      if (step !== 0) {
        game.count = 8;
        voiceLine(world, data, 0, MOVE_SOUND, 0);
      }
      if ((pressed & CHOOSE) !== 0) {
        voiceLine(world, data, 0, CHOOSE_SOUND, 0);
        menu.chosen = 1;
        menu.scroll = 0;
        menu.bar = FULL;
        menu.choosers = ((world.input.fresh[0]! & CHOOSE) !== 0 ? 1 : 0) | ((world.input.fresh[1]! & CHOOSE) !== 0 ? 2 : 0);
        game.step = 2;
      }
      break;
    }
    case 2: {
      const mode = menu.items[menu.picked]!.mode;
      if (mode === MenuMode.OPTIONS) goToLogo(game, Scene.OPTIONS);
      else if (mode === MenuMode.ONLINE) {
        game.online.opens = 1;
        goToLogo(game, Scene.OPTIONS);
      }
      else if (mode === MenuMode.THEATER) {
        if (game.earned.theater < SHOWN) game.earned.theater += 1;
        world.humans = 0;
        holdPicture(game, 1);
        game.last = game.scene;
        game.scene = Scene.OVERLAY_LOADER;
        game.next = Scene.MOVIE;
        game.step = 0;
      }
      else {
        if (mode === MenuMode.TEKKEN_BALL && game.earned.ball < SHOWN) game.earned.ball += 1;
        startMode(game, mode, menu.choosers);
      }
      break;
    }
    case 3:
      goToLogo(game, Scene.TITLE);
      break;
  }
  drawMenu(game, scenes);
}

/** Practice's mode overlay. */
const PRACTICE_OVERLAY = 1;

/** The mode overlay each mode loads: the arcade's for most, practice's, Tekken Ball's, Tekken Force's. */
function modeOverlay(mode: number): number {
  if (mode === MenuMode.PRACTICE) return PRACTICE_OVERLAY;
  if (mode === MenuMode.TEKKEN_BALL) return 3;
  if (mode === MenuMode.TEKKEN_FORCE) return 2;
  if (mode <= MenuMode.TEKKEN_FORCE) return 0;
  throw new Error(`no overlay for mode ${mode}`);
}

/** Each mode's switches: pause, challengers join, a challenger chooses again, the streak shown, the draw rule, health back for the poses, the match goes on, the knockout rule, the select skipped. */
const SWITCHES: Readonly<Record<number, readonly number[]>> = {
  [MenuMode.ARCADE]: [1, 1, 0, 1, 0, 0, 0, 1, 0],
  [MenuMode.VERSUS]: [1, 0, 0, 1, 1, 0, 1, 1, 1],
  [MenuMode.TIME_ATTACK]: [0, 0, 0, 0, 0, 0, 0, 1, 0],
  [MenuMode.SURVIVAL]: [0, 0, 0, 1, 0, 1, 1, 1, 0],
  [MenuMode.TEAM_BATTLE]: [1, 1, 1, 0, 1, 1, 1, 1, 1],
  [MenuMode.PRACTICE]: [1, 0, 0, 0, 0, 0, 0, 1, 0],
  [MenuMode.DEMO]: [0, 0, 0, 0, 0, 0, 1, 1, 0],
  [MenuMode.TEKKEN_BALL]: [1, 1, 0, 0, 1, 0, 0, 0, 1],
  [MenuMode.TEKKEN_FORCE]: [1, 0, 0, 0, 0, 0, 0, 0, 0],
};

/**
 * A mode started from the menu (or the title's attract demo): the match's settings from the
 * options, the fighters' records reset, the side whose pad chose made the human, the mode's
 * switches, and on to its overlay (scene 7).
 */
export function startMode(game: GameState, mode: number, choosers: number, chooseDemo?: (game: GameState) => void): void {
  const world = game.world;
  const run = game.run;
  const options = game.options;
  const [a, b, c] = world.fighters;
  a.movesetSlot = 0;
  b.movesetSlot = 1;
  c.movesetSlot = 1;
  a.slot = 0;
  b.slot = 1;
  c.slot = 2;
  run.shoulders = 0;
  run.started = 0;
  world.match.continuing = 0;
  world.match.challenger = 0;
  world.timerStopped = 0;
  world.freezeHealthToo = 0;
  world.match.stage = 0;
  run.versusMatches = 0;
  world.match.fightFrames = 0;
  run.lastTime = 0;
  world.match.totalTime = 0;
  world.match.humanLost = 0;
  world.attract = 0;
  run.continueChooses = options.continueChooses;
  run.modeSetting = options.modeSetting;
  world.options.rounds = options.rounds;
  world.computer.difficulty = options.difficulty;
  world.options.roundTime = options.roundTime;
  world.alwaysChip = options.alwaysChip;
  world.computer.arcadeStage = 0;
  world.mode = mode;
  for (let side = 0; side < 2; side += 1) {
    game.motors[side] = options.vibration[side]!;
    const held = world.input.rawPads[side]!;
    if ((held & 0x800) !== 0) run.shoulders = held === 0x80c ? 1 : 0;
    world.fighters[side]!.health = 0;
    world.fighters[side]!.carriedHealth = 0;
    if (options.keepChoices === 0) options.lastChoices[side] = NO_CHOICE;
    game.entrants.roster[side] = NO_ONE;
    game.entrants.costume[side] = 0;
    game.entrants.chosen[side] = 0;
    world.joined[side] = 0;
  }
  const human = (choosers ^ 1) & 1;
  world.match.streakSide = human;
  run.newcomer = (human + 1) & 1;
  world.match.streak = 0;
  world.joined[human] = 1;
  world.replay.stage = NO_REPLAY;
  const switches = SWITCHES[mode];
  if (switches === undefined) throw new Error(`mode ${mode}'s start is not remade`);
  [world.match.canPause, run.challengers, run.challengerChooses, world.match.showsStreak, world.match.drawRule, world.match.healthBackForPoses, world.match.goesOn, world.knockoutRule, run.skipsSelect] = switches as [number, number, number, number, number, number, number, number, number];
  const clearFirstTime = (): void => {
    Object.assign(run.stageTimes[0]!, { frames: 0, side: 0, roster: 0, costume: 0 });
  };
  let rest = true;
  switch (mode) {
    case MenuMode.ARCADE:
      clearFirstTime();
      break;
    case MenuMode.VERSUS:
      world.joined[1] = 1;
      world.joined[0] = 1;
      world.options.handicaps[0] = 3;
      world.options.handicaps[1] = 3;
      run.versusRecord.wins.fill(0);
      run.versusRecord.draws = 0;
      Object.assign(run.versusStage, { code: -1, first: -1, second: -1 });
      break;
    case MenuMode.TIME_ATTACK:
      run.continueChooses = 0;
      world.computer.difficulty = 1;
      world.options.rounds = 1;
      world.options.roundTime = 2;
      world.alwaysChip = 0;
      clearFirstTime();
      break;
    case MenuMode.TEAM_BATTLE:
      world.options.rounds = 0;
      for (const team of world.match.teams) team.size = TEAM_SIZE;
      run.team.uses.fill(0);
      break;
    case MenuMode.SURVIVAL: {
      world.computer.difficulty = 1;
      world.options.rounds = 0;
      world.options.roundTime = 2;
      world.alwaysChip = 0;
      world.match.survivalRank = 0;
      world.match.survivalWins = 0;
      const survival = run.survival;
      survival.opponent = 0;
      survival.recentAt = 0;
      survival.recent.fill(NO_ONE);
      survival.beaten.fill(0);
      break;
    }
    case MenuMode.PRACTICE:
      world.options.rounds = 0;
      world.options.roundTime = 5;
      world.freezeHealthToo = 1;
      world.alwaysChip = 0;
      rest = false;
      break;
    case MenuMode.TEKKEN_BALL: {
      world.options.roundTime = 5;
      world.alwaysChip = 0;
      world.options.handicaps[0] = 3;
      world.options.handicaps[1] = 3;
      const ball = world.match.ball;
      ball.server = 0;
      ball.kind = 0;
      ball.replaysShown = 0;
      ball.replaysWanted = 0;
      Object.assign(run.versusStage, { code: -1, first: -1, second: -1 });
      run.ball.met.fill(0xffff, 0, 6);
      break;
    }
    case MenuMode.TEKKEN_FORCE:
      world.options.roundTime = 4;
      world.options.rounds = 0;
      world.alwaysChip = 0;
      break;
    case MenuMode.DEMO:
      motorsOff(game);
      world.options.roundTime = 2;
      world.attract = 1;
      if (chooseDemo === undefined) throw new Error("the attract demo's fighters are not remade");
      chooseDemo(game);
      rest = false;
      break;
    default:
      throw new Error(`mode ${mode}'s start is not remade`);
  }
  if (rest) game.records.list = 2;
  if (TIMED < world.options.roundTime) world.timerStopped = 1;
  run.overlay = modeOverlay(mode);
  game.scene = Scene.MODE;
  game.step = 0;
}

/** Scene 7: the picture held a field and let go, the mode's overlay loaded if another is in, then the fight scene. */
export function modeScene(game: GameState): void {
  switch (game.step) {
    case 0:
      holdPicture(game, 1);
      game.step = 1;
      return;
    case 1:
      holdPicture(game, 0);
      game.step = 2;
      return;
    case 2:
      if (game.modeOverlay !== game.run.overlay) {
        game.modeOverlay = game.run.overlay;
        /* Practice's overlay comes with its state blank. */
        if (game.modeOverlay === PRACTICE_OVERLAY) game.practice = blankPractice();
        queueFile(game);
        goToScene(game, Scene.MODE, 2);
        return;
      }
      game.step = 3;
      return;
    case 3:
      game.scene = Scene.FIGHT;
      game.step = 0;
  }
}
