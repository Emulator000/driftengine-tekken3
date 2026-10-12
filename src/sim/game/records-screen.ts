/**
 * The records (scenes 0x10 and 0x11), after a run: the records saved when they changed, then one
 * of three rankings in turn over a stage seen from a camera slowly circling it: Arcade's best time
 * per character, survival's ten best, and how often each character is played (with its share of
 * all plays as a bar). The ranking fades in, scrolls a page of five at a time from its last page
 * to its first (the plays' bars growing on each page), holds, fades out, and the title follows,
 * the next ranking chosen for next time. Start goes back to the mode menu.
 *
 * A run that set a best time or a survival record takes its name first, to its own song: the
 * record's ranking fades in and scrolls to the page that shows the record's row, which blinks
 * over a band darkened behind it while its holder enters three letters (`name-entry.ts`) under a
 * countdown of 50 seconds; the name is held two seconds, then the ranking fades out as usual.
 * Start cuts the entry short with the character's name.
 *
 * Its record is the screen's state (`recordsScreen`); the stage is the fight's world, set to the
 * stage alone with no one on it, its view the circling camera's.
 */
import type { SceneTables } from '../data/scenes.ts';
import { stepScenery } from '../fight/arena.ts';
import { viewMatrix } from '../fight/camera.ts';
import { groundFadeOf, type FightTables } from '../fight/match.ts';
import { fadeMusic, playSong, stopSounds, voiceLine } from '../fight/voices.ts';
import { cosine, sine } from '../math/angles.ts';
import { goToLogo, goToScene, holdPicture, queueFile, startPressed } from './logo.ts';
import { MenuMode, stopMotors } from './menu.ts';
import { NameResult, NameStep, startNameEntry, stepNameEntry } from './name-entry.ts';
import { print } from './printer.ts';
import { earn, HIDDEN, Naming, playCount, recordsChanged, saveRecords, sortPairs } from './records.ts';
import { fade } from './title.ts';
import { Scene, type GameState } from './state.ts';

/** The rankings, in the order they take turns. */
export const Ranking = { TIMES: 0, SURVIVORS: 1, PLAYS: 2 } as const;
/** The stages the screen takes turns over. */
const STAGES = 0xd;
/** The camera: its angle round to start (across at its cosine, along at its sine), the steps it turns a field, its distance out and its height. */
const ORBIT = { start: 0xc00, step: 3, distance: 5000, height: -0x578 } as const;
/** Where the empty stage's two places stand across. */
const SIDE = 1000;
/** A row's height, a page's rows, where a page's first row stands, how far the list moves a field, and the line rows are drawn above. */
const ROW = 0x48;
const PAGE = 5;
const PAGE_TOP = 0xa8;
const SCROLL = 0xc;
const DRAWN_ABOVE = 0x228;
/** The frames a page stands, the bars' full growth, the frames the last page holds, the fades' step and the front's table entry. */
const STAY = 0x96;
const GROWN = 0x40;
const HOLD = 0x3b;
const FADE_STEP = 8;
const FRONT = 7;
/** The rows' table entry, the most a time shows (99'59"99), the most wins, the first ten characters always ranked, all of them. */
const ROWS_LAYER = 1;
const MOST_FRAMES = 359999;
const MOST_WINS = 999;
const FIRST_TEN = 0x3ff;
const EVERYONE = 0x1fffff;
const CHARACTERS = 0x16;
/** No row lit. */
const NONE = 0xffff;
/** The pads' directions that pick a ranking on the second pad: right the times, left the survivors, up the plays. */
const PICK = { times: 0x2000, survivors: 0x8000, plays: 0x1000 } as const;
const START_SOUND = 0x4cc0;
/** The roster codes past which a character reads the empty code's record. */
const LAST_CODE = 0x5c;
const PAST_CODE = 0x58;
/** What the screen draws: nothing (black), the title's bar, with the list, the name entry, the name ended. */
export const Draws = { BLACK: 0, TITLE: 1, LIST: 2, NAMING: 3, NAMED: 4 } as const;
/**
 * The name entry: its song, the frames it lasts, the sounds of a letter taken and of the letter
 * moving, the frames the name is held after, and the frames the song fades out over; the
 * countdown's colour number, font and place; the darkened band behind the lit row (its top above
 * the row's page place, its height) and the cursor under the name (its left, its step a letter,
 * its line, its size).
 */
const NAMING = { song: 2, frames: 3000, took: 0x50f4, moved: 0x55f5, held: 0x77, songOut: 0x3c } as const;
const COUNTDOWN = { colour: 6, font: 1, x: 0x13c, y: 0x30 } as const;
export const BAND = { top: 0x68, height: 0x48 } as const;
export const CURSOR = { x: 0x129, step: 13, y: 0xa0, w: 0x12, h: 4 } as const;
/** The name entry's scroll: a sixteenth of the way a field, one line at least and sixteen at most. */
const EASE = { shift: 4, least: 1, most: 0x10 } as const;
/** The lit row blinks off one field in four. */
const BLINK = 3;

/** A distance out at an angle's sine or cosine, as the game divides it (toward zero). */
const out = (unit: number): number => Math.trunc((unit * ORBIT.distance) / 4096);

/**
 * The screen's start as its overlay comes in: the attract demo's mode; the next stage in turn
 * (never the four the screen skips) set up alone, its scenery turned back to the camera; the two
 * places a metre either side; the camera 5 m out and 1.4 m up.
 */
function recordsStart(game: GameState, tables: FightTables, scenes: SceneTables): void {
  const world = game.world;
  const records = game.records;
  world.mode = MenuMode.DEMO;
  world.match.trueOgres = 0;
  world.attract = 1;
  let stage = records.stageTurn;
  for (;;) {
    stage %= STAGES;
    if (!scenes.records.skipped.includes(stage)) break;
    stage += 1;
  }
  records.stageTurn = stage + 1;
  world.stage = stage;
  world.groundFade = groundFadeOf(stage);
  const scenery = world.scenery;
  scenery.yaw = 0;
  scenery.yawBefore = world.camera.drawn.yaw & 0xfff;
  scenery.lastYaw = scenery.yawBefore;
  const screen = game.recordsScreen;
  screen.orbit = ORBIT.start;
  const [a, b] = world.fighters;
  a.skeleton.base.translation[0] = -SIDE;
  b.skeleton.base.translation[0] = SIDE;
  a.skeleton.base.translation[2] = 0;
  b.skeleton.base.translation[2] = 0;
  Object.assign(screen.camera, { pitch: 0, yaw: 0, roll: 0 });
  screen.camera.eye.splice(0, 3, out(cosine(tables.math, ORBIT.start)), ORBIT.height, out(sine(tables.math, ORBIT.start)));
}

/** The camera three steps further round, turning to keep facing in; the world's view made from it and the stage laid under it. */
function circleStage(game: GameState, tables: FightTables): void {
  const world = game.world;
  const screen = game.recordsScreen;
  const camera = screen.camera;
  camera.yaw = (camera.yaw - ORBIT.step) | 0;
  screen.orbit = (screen.orbit - ORBIT.step) & 0xfff;
  camera.eye[0] = out(cosine(tables.math, screen.orbit));
  camera.eye[2] = out(sine(tables.math, screen.orbit));
  const drawn = world.camera.drawn;
  Object.assign(drawn, { pitch: camera.pitch, yaw: camera.yaw, roll: camera.roll });
  drawn.eye.splice(0, 3, ...camera.eye);
  viewMatrix(tables, drawn, world.view);
  if (world.nothingDrawn !== 0) return;
  world.groundShown = 0 < sine(tables.math, drawn.pitch + 0xef) ? 1 : 0;
  stepScenery(world, tables);
}

/** A part of a whole in tenths of a percent (1000 when the part is larger), both halved past 22 bits. */
function share(part: number, whole: number): number {
  part >>>= 0;
  whole >>>= 0;
  if (whole < part) return 1000;
  while (0x3fffff < whole) {
    whole >>>= 1;
    part >>>= 1;
  }
  return whole === 0 ? 0 : Math.trunc((part * 1000) / whole);
}

/** The rows' order from sorted pairs. */
function setOrder(game: GameState, pairs: readonly [number, number][]): void {
  const screen = game.recordsScreen;
  screen.count = pairs.length;
  pairs.forEach(([key], row) => (screen.order[row] = key));
}

/** The times ranking: the first ten characters always and any other with a time, fastest first; returns the row of the time just set (-1 none shown). */
function rankTimes(game: GameState): number {
  const times = game.records.times;
  game.recordsScreen.stay = STAY;
  let shown = FIRST_TEN;
  for (let roster = 0; roster < CHARACTERS; roster += 1) if (times[roster]!.frames >>> 0 < MOST_FRAMES) shown |= 1 << roster;
  shown &= EVERYONE;
  const pairs: [number, number][] = [];
  for (let roster = 0; roster < CHARACTERS; roster += 1) if ((shown & (1 << roster)) !== 0) pairs.push([roster, times[roster]!.frames >>> 0]);
  sortPairs(pairs, true);
  setOrder(game, pairs);
  return pairs.findIndex(([roster]) => roster === game.records.timeSet);
}

/**
 * Survival's ten records sorted by wins, most first, in place; returns the row the record just
 * set had before the sort (-1 none), which the game keeps as its row.
 */
function rankSurvivors(game: GameState): number {
  const records = game.records;
  const copy = records.survivors.map((record) => ({ ...record }));
  const pairs = copy.map((record, i): [number, number] => [i, record.wins]);
  sortPairs(pairs, false);
  pairs.forEach(([from], i) => Object.assign(records.survivors[i]!, copy[from]!));
  const screen = game.recordsScreen;
  screen.count = copy.length;
  for (let i = 0; i < copy.length; i += 1) screen.order[i] = i;
  screen.stay = STAY;
  return 0 <= records.survivorSet && records.survivorSet < copy.length ? records.survivorSet : -1;
}

/** The plays ranking: the first ten and any other ever played, most played first, each with its share of all plays. */
function rankPlays(game: GameState): void {
  const screen = game.recordsScreen;
  let shown = FIRST_TEN;
  let total = 0;
  for (let roster = 0; roster < CHARACTERS; roster += 1) {
    const plays = playCount(game, roster);
    if (plays !== 0) {
      shown |= 1 << roster;
      total += plays;
    }
  }
  shown &= EVERYONE;
  const pairs: [number, number][] = [];
  for (let roster = 0; roster < CHARACTERS; roster += 1) {
    if ((shown & (1 << roster)) === 0) continue;
    const plays = playCount(game, roster);
    pairs.push([roster, plays]);
    screen.shares[roster] = share(plays, total);
  }
  sortPairs(pairs, false);
  setOrder(game, pairs);
  screen.stay = STAY;
  screen.largest = screen.shares[pairs[0]![0]]!;
}

/** "1ST", "2ND", "3RD", then "TH" (and "TH" for the 11th to the 20th). */
function rank(scenes: SceneTables, row: number): string {
  let index = row % 10;
  if (3 < index || (row - 10) >>> 0 < 10) index = 3;
  return `${100 < row + 1 ? 99 : row + 1}${scenes.records.suffixes[index]!}`;
}

const two = (n: number): string => String(n).padStart(2, '0');

/** A character's name, by its first costume's code (past the last code, the empty code's). */
function characterName(tables: FightTables, roster: number): string {
  const code = roster << 2;
  return tables.roster.codes[LAST_CODE < code ? PAST_CODE : code]?.name ?? '';
}

/** The rank, and the character's name over its icon's right. */
function printRowStart(game: GameState, tables: FightTables, scenes: SceneTables, row: number, roster: number, y: number, colours: readonly number[]): void {
  print(game, 1, colours[0]!, 0xc, y - 0x22, rank(scenes, row), ROWS_LAYER);
  print(game, 0, colours[1]!, 0x6f, y - 0x38, characterName(tables, roster), ROWS_LAYER);
}

/** A times row: the time as minutes, seconds and hundredths, and the holder's initials; in the lit colours when `lit`. */
function printTimeRow(game: GameState, tables: FightTables, scenes: SceneTables, row: number, roster: number, y: number, lit: boolean): void {
  const colours = scenes.records.colours.times[lit ? 1 : 0]!;
  printRowStart(game, tables, scenes, row, roster, y, colours);
  const record = game.records.times[roster]!;
  const frames = Math.min(record.frames | 0, MOST_FRAMES);
  print(game, 1, colours[2]!, 0xb6, y - 0x26, "'", ROWS_LAYER);
  print(game, 1, colours[2]!, 0xd9, y - 0x26, '"', ROWS_LAYER);
  const seconds = Math.trunc(frames / 60);
  print(game, 1, colours[2]!, 0x9e, y - 0x22, two(Math.trunc(seconds / 60)), ROWS_LAYER);
  print(game, 1, colours[2]!, 0xbf, y - 0x22, two(seconds % 60), ROWS_LAYER);
  print(game, 1, colours[2]!, 0xe3, y - 0x22, two(Math.trunc(((frames % 60) * 100) / 60)), ROWS_LAYER);
  print(game, 1, colours[3]!, 299, y - 0x22, record.initials, ROWS_LAYER);
}

/** A survival row: "n WIN(S)" and the holder's initials; in the lit colours when `lit`. */
function printSurvivorRow(game: GameState, tables: FightTables, scenes: SceneTables, row: number, y: number, lit: boolean): void {
  const colours = scenes.records.colours.survivors[lit ? 1 : 0]!;
  const record = game.records.survivors[game.recordsScreen.order[row]!]!;
  printRowStart(game, tables, scenes, row, record.roster, y, colours);
  const wins = Math.min(record.wins, MOST_WINS);
  const count = String(wins).padStart(3, ' ');
  if (wins < 2) {
    print(game, 1, colours[2]!, 0xab, y - 0x22, count, ROWS_LAYER);
    print(game, 1, colours[2]!, 0xd9, y - 0x22, 'WIN', ROWS_LAYER);
  } else {
    print(game, 1, colours[2]!, 0x9e, y - 0x22, count, ROWS_LAYER);
    print(game, 1, colours[2]!, 0xcc, y - 0x22, 'WINS', ROWS_LAYER);
  }
  print(game, 1, colours[3]!, 299, y - 0x22, record.initials, ROWS_LAYER);
}

/** A plays row: the share grown by `grown` of 64, as a percentage to a tenth. */
function printPlaysRow(game: GameState, tables: FightTables, scenes: SceneTables, row: number, roster: number, grown: number, y: number): void {
  const colours = scenes.records.colours.plays[0]!;
  printRowStart(game, tables, scenes, row, roster, y, colours);
  const screen = game.recordsScreen;
  const permille = screen.shares[roster]!;
  let shown = screen.largest !== 0 ? (permille * grown) >> 6 : 0;
  if (1000 < shown) shown = 1000;
  if (shown === 1000) {
    print(game, 1, colours[2]!, 0x11b, y - 0x22, '100', ROWS_LAYER);
    print(game, 0, colours[2]!, 0x145, y - 0x1e, '%', ROWS_LAYER);
  } else if (shown !== 0) {
    print(game, 1, colours[2]!, 0x119, y - 0x22, two(Math.trunc(shown / 10)), ROWS_LAYER);
    print(game, 0, colours[2]!, 0x134, y - 0x1e, '.', ROWS_LAYER);
    print(game, 0, colours[2]!, 0x13b, y - 0x1e, `${shown % 10}%`, ROWS_LAYER);
  } else {
    print(game, 1, colours[2]!, 0x11b, y - 0x22, '  0', ROWS_LAYER);
    print(game, 0, colours[2]!, 0x145, y - 0x1e, '%', ROWS_LAYER);
  }
}

/** Where a row stands down the screen, from the list's place. */
export const rowLine = (game: GameState, row: number): number => game.recordsScreen.place + row * ROW;

/** The plays' bar growth a row shows: grown on the rows from the page's first on, none above. */
export const rowGrowth = (game: GameState, row: number): number => (game.recordsScreen.barsFrom <= row ? game.recordsScreen.grown : 0);

/**
 * The list's rows printed from its place, those on the screen (the screen cuts them to the list's
 * window); while a name is entered (`naming`), the record's row of a best time or a survival
 * record lit three fields in four.
 */
function printList(game: GameState, tables: FightTables, scenes: SceneTables, naming: boolean): void {
  const screen = game.recordsScreen;
  for (let row = 0; row < screen.count; row += 1) {
    const y = rowLine(game, row);
    if (!(y >>> 0 < DRAWN_ABOVE)) continue;
    const roster = screen.order[row]!;
    const lit = naming && screen.lit === row && (game.world.vsyncSeen & BLINK) !== 0;
    if (game.records.list === Ranking.TIMES) printTimeRow(game, tables, scenes, row, roster, y, lit);
    else if (game.records.list === Ranking.SURVIVORS) printSurvivorRow(game, tables, scenes, row, y, lit);
    else printPlaysRow(game, tables, scenes, row, roster, rowGrowth(game, row), y);
  }
}

/**
 * What the name entry draws besides its type: the darkened band behind the lit row (its top line)
 * while the name is entered, and the cursor under the name's next letter (its place) while the
 * name is open on a best time or a survival record; null where there is none.
 */
export function namingMarks(game: GameState): { band: number | null; cursor: [number, number] | null } {
  const screen = game.recordsScreen;
  if (screen.draws !== Draws.NAMING && screen.draws !== Draws.NAMED) return { band: null, cursor: null };
  const band = screen.draws === Draws.NAMING ? (screen.litPlace * ROW + BAND.top) & 0xffff : null;
  const list = game.records.list;
  const open = (list === Ranking.TIMES || list === Ranking.SURVIVORS) && screen.naming.place < 3;
  const cursor: [number, number] | null = open ? [(screen.naming.place * CURSOR.step + CURSOR.x) & 0xffff, (screen.litPlace * ROW + CURSOR.y) & 0xffff] : null;
  return { band, cursor };
}

/** The name as it stands written into the record (or records) waiting for it. */
function writeName(game: GameState): void {
  const records = game.records;
  const name = game.recordsScreen.naming.name;
  if ((records.naming & Naming.TIME) !== 0) records.times[records.timeSet]!.initials = name;
  if ((records.naming & Naming.SURVIVAL) !== 0) records.survivors[records.survivorSet]!.initials = name;
}

/** A frame of the name entry, `how` it takes it, from its holder's pad; the hidden character earned by the secret name while he is not. Returns whether the name ended. */
function enterName(game: GameState, tables: FightTables, scenes: SceneTables, how: number): boolean {
  const entry = game.recordsScreen.naming;
  const input = game.world.input;
  const result = stepNameEntry(entry, scenes.records.naming, how, input.fresh[entry.pad] ?? 0, game.pads.repeats[entry.pad] ?? 0, characterName(tables, entry.roster));
  if (result === NameResult.SECRET && (game.records.earnedRoster & (1 << HIDDEN)) === 0) earn(game, HIDDEN);
  return result !== NameResult.OPEN;
}

/**
 * Scene 0x10: the picture let go; the sound and the pads stopped, the records saved when no name
 * waits, the screen's overlay loaded; two black fields; the screen's start; on to its scene.
 */
export function recordsLoaderScene(game: GameState, tables: FightTables, scenes: SceneTables): void {
  switch (game.step) {
    case 0:
      holdPicture(game, 0);
      game.step = 1;
      return;
    case 1:
      stopSounds(game.world, false);
      stopMotors(game);
      if (game.records.naming === 0) saveRecords(game);
      queueFile(game);
      goToScene(game, Scene.RECORDS_LOADER, 2);
      return;
    case 2:
    case 3:
      game.step += 1;
      return;
    case 4:
    case 5:
      if (game.step === 4) recordsStart(game, tables, scenes);
      game.scene = Scene.RECORDS;
      game.step = 0;
      return;
  }
}

/**
 * Scene 0x11: the ranking chosen (the second pad's direction can pick it) and built; faded in;
 * scrolled to its last page, then a page back at a time, each standing a while (the plays' bars
 * growing); held; faded out; on to the title, the next ranking chosen for next time. The title's
 * bar shows from the fade in, the list from the scroll; the camera circles while either shows.
 *
 * With a record waiting for its name: its song; its ranking built with its row lit; faded in;
 * scrolled to the row's page; the name entered, written into the record each frame (a letter
 * taken and the letter moving each with its sound); once ended the records changed and the name
 * held; the song faded out with the ranking.
 */
export function recordsScene(game: GameState, tables: FightTables, scenes: SceneTables): void {
  const screen = game.recordsScreen;
  const records = game.records;
  const world = game.world;
  if (1 < game.step && startPressed(game)) {
    if (records.naming !== 0) {
      enterName(game, tables, scenes, NameStep.CUT_SHORT);
      writeName(game);
      records.naming = 0;
      recordsChanged(game, scenes);
    }
    stopSounds(world, true);
    voiceLine(world, tables, 0, START_SOUND, 0);
    goToLogo(game, Scene.MENU);
    return;
  }
  switch (game.step) {
    case 0: {
      if (records.naming === 0) {
        const held = world.input.rawPads[1]!;
        if ((held & PICK.times) !== 0) records.list = Ranking.TIMES;
        else if ((held & PICK.survivors) !== 0) records.list = Ranking.SURVIVORS;
        else if ((held & PICK.plays) !== 0) records.list = Ranking.PLAYS;
      }
      game.step = 1;
      return recordsScene(game, tables, scenes);
    }
    case 1:
      if (records.naming !== 0) {
        playSong(world, NAMING.song, false);
        let lit: number;
        if ((records.naming & Naming.TIME) !== 0) {
          records.list = Ranking.TIMES;
          lit = rankTimes(game);
        } else if ((records.naming & Naming.SURVIVAL) !== 0) {
          records.list = Ranking.SURVIVORS;
          lit = rankSurvivors(game);
          if (lit !== -1) records.survivorSet = lit;
        } else {
          records.list = Ranking.PLAYS;
          records.naming = 0;
          break;
        }
        screen.lit = lit & 0xffff;
        startNameEntry(screen.naming, scenes.records.naming, records.holder.side, records.holder.roster);
        game.step = 2;
        screen.frames = 0;
        screen.draws = Draws.BLACK;
        break;
      }
      if (records.list === Ranking.SURVIVORS) rankSurvivors(game);
      else if (records.list === Ranking.TIMES) rankTimes(game);
      else if (records.list === Ranking.PLAYS) rankPlays(game);
      screen.lit = NONE;
      game.step = 2;
      screen.frames = 0;
      screen.draws = 0;
      break;
    case 2:
      screen.draws = 1;
      game.count = 0;
      game.step = 3;
      return recordsScene(game, tables, scenes);
    case 3:
      fade(game, FRONT, game.count);
      game.count += FADE_STEP;
      if (0xff < game.count) game.step = records.naming === 0 ? 4 : 10;
      break;
    case 4: {
      const count = screen.count;
      screen.barsFrom = count;
      let last = count % PAGE;
      if (last === 0) last = PAGE;
      screen.pageFirst = count - last;
      game.step = 5;
      screen.draws = 2;
      screen.place = ((count * -ROW + PAGE_TOP) << 16) >> 16;
      break;
    }
    case 5:
      screen.going = ((screen.pageFirst * -ROW + PAGE_TOP) << 16) >> 16;
      screen.place = ((screen.place + SCROLL) << 16) >> 16;
      if (screen.going <= screen.place) {
        screen.frames = 0;
        screen.grown = 0;
        game.step = 6;
        screen.barsFrom = screen.pageFirst;
        screen.place = screen.going;
      }
      break;
    case 6:
      screen.grown = Math.min(screen.frames, GROWN);
      screen.frames += 1;
      if (screen.stay <= screen.frames) {
        if (screen.pageFirst < 1) {
          game.count = 0;
          game.step = 7;
        } else {
          game.step = 5;
          screen.pageFirst -= PAGE;
        }
      }
      break;
    case 7:
      game.count += 1;
      if (HOLD < game.count) game.step = 8;
      break;
    case 8:
      game.count = 0x100;
      game.step = 9;
      return recordsScene(game, tables, scenes);
    case 9:
      fade(game, FRONT, game.count);
      game.count -= FADE_STEP;
      if (0 < game.count) break;
      game.step = 0xe;
      screen.draws = 0;
      break;
    case 10: {
      /* The page that shows the lit row: the first for the first two rows, the last for the last three, else with the row third. */
      const count = screen.count;
      if (screen.lit < 2) {
        screen.pageFirst = 0;
        screen.litPlace = screen.lit;
      } else {
        screen.pageFirst = count - PAGE;
        if (count - 3 < screen.lit) screen.litPlace = (PAGE - (count - screen.lit)) & 0xffff;
        else {
          screen.pageFirst = screen.lit - 2;
          screen.litPlace = 2;
        }
      }
      screen.grown = GROWN;
      game.step = 0xb;
      screen.barsFrom = 0;
      screen.draws = Draws.LIST;
      screen.place = ((count * -ROW + PAGE_TOP) << 16) >> 16;
      break;
    }
    case 0xb: {
      /* Scrolled down to that page, easing in. */
      const going = screen.pageFirst * -ROW + PAGE_TOP;
      let step = (((going << 16) >> 16) - screen.place + 0xf) >> EASE.shift;
      screen.going = (going << 16) >> 16;
      if (step === 0) step = EASE.least;
      else if (EASE.most < step) step = EASE.most;
      screen.place = ((screen.place + step) << 16) >> 16;
      if (screen.going <= screen.place) {
        screen.frames = NAMING.frames;
        screen.draws = Draws.NAMING;
        game.step = 0xc;
        screen.place = screen.going;
      }
      break;
    }
    case 0xc: {
      screen.frames = (screen.frames - 1) & 0xffff;
      const ended = enterName(game, tables, scenes, screen.frames === 0 ? NameStep.OUT_OF_TIME : NameStep.PAD);
      writeName(game);
      if (screen.naming.took !== 0) voiceLine(world, tables, 0, NAMING.took, 0);
      if (screen.naming.moved !== 0) voiceLine(world, tables, 0, NAMING.moved, 0);
      if (ended) {
        records.naming = 0;
        recordsChanged(game, scenes);
        screen.draws = Draws.NAMED;
        game.count = 0;
        game.step = 0xd;
      }
      break;
    }
    case 0xd:
      game.count += 1;
      if (NAMING.held < game.count) {
        fadeMusic(world, 0, NAMING.songOut);
        game.step = 8;
      }
      break;
    case 0xe:
      screen.draws = 0;
      records.list = (records.list + 1) % 3;
      goToLogo(game, Scene.TITLE);
      break;
  }
  switch (screen.draws) {
    case Draws.TITLE:
      break;
    case Draws.LIST:
      printList(game, tables, scenes, false);
      break;
    case Draws.NAMING:
    case Draws.NAMED: {
      /* The seconds the name entry has left, then the list with the record's row lit. */
      const seconds = screen.frames === 0 ? 0 : Math.trunc((screen.frames + 59) / 60);
      print(game, COUNTDOWN.font, COUNTDOWN.colour, COUNTDOWN.x, COUNTDOWN.y, String(seconds).padStart(2, ' '), ROWS_LAYER);
      printList(game, tables, scenes, true);
      break;
    }
    default:
      return;
  }
  circleStage(game, tables);
}
