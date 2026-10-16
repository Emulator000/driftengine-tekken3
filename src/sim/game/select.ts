/**
 * The character select (scene 9): the characters earned so far in one row or two, a cursor and a
 * portrait per side, a countdown, and the choices written for the match once both sides are done.
 *
 * The grid is 22 cells, eleven a row, each linked to its neighbours up, down, left and right; a
 * row's cells are linked in a ring, and the rows laid against each other, the shorter centred on
 * the longer. An added character shows in its cell from a fresh game, a row's eleventh included;
 * a row of eleven is laid closer to keep the ten's width. Each side steps through its states: set
 * up, choosing, waiting for the other side, choosing for it with the other's pad (practice's
 * partner), the computer's (start joins it), out of play, and chosen (a moment's wait, which start
 * cuts short). Sparkles of light rise over the portraits, the second random generator placing them.
 */
import type { FightData } from '../fight/state.ts';
import { keyOffVoices, playSong, voiceLine } from '../fight/voices.ts';
import type { AddedCharacter, SceneTables } from '../data/scenes.ts';
import { softReset } from './fight-scene.ts';
import { joinWithStart } from './join.ts';
import { MenuMode, NO_CHOICE } from './menu.ts';
import { print } from './printer.ts';
import type { GameState, SelectCell, SelectSide } from './state.ts';

/** No neighbouring cell; no character (the game's 0x16, here apart from an added character's roster id). */
export const NO_CELL = 0x16;
export const NO_ONE = -1;
/** The game's roster ids, and the empty look's row. */
const ROSTER = 0x16;
/** A row: eleven cells, ten shown (an eleventh earned shows the arrows), their spacing and the first's left; the second row's line. */
const ROW = { cells: 11, shown: 10, step: 0x23, left: 0xb, second: 0x3e } as const;
/** A row of eleven (an added character's): spaced closer and starting further left, centred where the ten are. */
const ELEVEN = { step: 0x20, left: 0xa } as const;
/** The spacing of the original's rows, which the presentation's icons are sized to. */
export const CELL_STEP = ROW.step;
/** Frames the arrows pulse once an eleventh character arrives. */
const ARRIVAL = 0xb4;
/** The side states. */
export const SideState = { SET_UP: 0, CHOOSING: 1, WAITING: 2, PARTNER: 3, COMPUTER: 4, OUT: 5, CHOSEN: 6, PARTNER_CHOSEN: 7 } as const;
/** Frames a chosen side waits, and its portrait's fade in. */
const CHOSEN_WAIT = 0x5a;
const FADE_IN = 0x1c;
/** The buttons: a kick (the second costume), start and the fourth button (the third, for a character who has one), cancel, start. */
const KICKS = 0x60;
const THIRD = 0x810;
const BUTTONS = 0xf0;
const CANCEL = 0x100;
const PUNCH = 0x80;
const START = 0x800;
/** The sounds: a cursor's move, a choice, a challenger. */
const MOVE_SOUND = 0x55f5;
const CHOOSE_SOUND = 0x50f4;
const JOIN_SOUND = 0x49a1;
/** The select's song. */
const SONG = 1;
/** The sparkles: how many, every fourth frame one rises, its start level, its rise a frame, its height. */
const SPARKLES = 0x40;
const SPARKLE = { level: 0x60, rise: 0x10, height: 0xa0, across: 0x7e } as const;
/** The modes' titles a side shows when it plays no part. */
const MODE_TITLES: Readonly<Record<number, string>> = { 3: 'TIME ATTACK!', 4: 'SURVIVAL!', 5: 'PRACTICE!', 8: 'TEKKEN FORCE!' };
/** The mode titles' font, colour, glyph advance and how far above the names they sit; the screen's edges they keep inside. */
const TITLE = { font: 1, colour: 5, advance: 0xd, above: 0x1e, left: 8, right: 0x168 } as const;
/** The line under a side not in: its line. */
const COIN_Y = 0x22;

/** The added character holding roster id `roster`, if any. */
const addedOf = (scenes: SceneTables, roster: number): AddedCharacter | undefined => scenes.select.added.find((a) => a.roster === roster);
/** Whether a roster id is a character: one of the game's or an added one. */
export const isCharacter = (scenes: SceneTables, roster: number): boolean => (roster >= 0 && roster < ROSTER) || addedOf(scenes, roster) !== undefined;

/** A roster id and costume's look word; out of range, the empty one's. */
export function lookOf(scenes: SceneTables, roster: number, costume: number): number {
  const added = addedOf(scenes, roster);
  if (added) return added.look;
  if (!(roster >= 0 && roster < ROSTER) || !(costume < 4)) return scenes.select.looks[ROSTER * 4]!;
  return scenes.select.looks[roster * 4 + costume]!;
}

/** A side's standing: bit 1 a human joined, bit 0 its character chosen. */
export const standing = (game: GameState, n: number): number => (game.world.joined[n] !== 0 ? 2 : 0) | (game.entrants.chosen[n] !== 0 ? 1 : 0);

/* ---- The grid. ---- */

/**
 * A row being laid against the other: its cells, the cell to lay next and its last, the next
 * place, which row it is, its phase (0 linking the shorter row's first cells left, 1 placing, 2
 * linking the last right, 3 done), whether it is an odd number shorter, the cell it stops at, the
 * links to skip, how many cells show and how many it is shorter by half, and its cells' spacing.
 */
interface Row {
  next: number;
  last: number;
  x: number;
  y: number;
  step: number;
  which: number;
  phase: number;
  odd: number;
  stop: number;
  skip: number;
  showing: number;
  half: number;
}

/** No row below: a lone row's cells read the byte after the grid's table as their neighbour. */
const NO_ROW = -1;

/** One step of laying a row against the other; returns the cell to step from next. */
function layStep(cells: SelectCell[], row: Row, at: number): number {
  const cell = cells[at]!;
  const across = row.which === 0 ? cell.down : cell.up;
  if (row.phase === 0) {
    if (row.half !== 0) {
      cell.left = across;
      row.half -= 1;
      return at;
    }
    if (row.odd !== 0) cell.left = across;
    row.phase = 1;
  }
  if (row.phase === 1) {
    if (row.showing !== 0) {
      if (row.odd !== 0 && row.showing === row.stop) {
        row.stop = 0xff;
        return at;
      }
      cell.x = row.x;
      cell.y = row.y;
      row.showing = (row.showing - 1) & 0xff;
      row.x += row.step;
      if (row.showing !== 0) return cell.right;
    }
    row.phase = 2;
  }
  if (row.phase === 2) {
    if (row.odd === 0) {
      if (row.skip !== 0) cell.right = cells[across]!.right;
    } else cell.right = across;
    row.phase = 3;
  }
  return at;
}

/** The two rows laid out against each other, the shorter centred on the longer. */
function layRows(cells: SelectCell[], a: Row, b: Row): void {
  let [long, short] = [a, b];
  if (a.showing < b.showing) [long, short] = [b, a];
  if (long.showing === 0) {
    long.next = NO_ROW;
    long.phase = 3;
  }
  if (short.showing === 0) {
    short.next = NO_ROW;
    short.phase = 3;
  } else {
    const gap = long.showing - short.showing;
    if ((gap & 1) !== 0) short.odd = 1;
    short.skip = gap >> 1;
    short.half = gap >> 1;
    short.stop = (short.showing >> 1) + 1;
    short.x += ((Math.max(ROW.shown, long.showing) - short.showing) * short.step) >> 1;
  }
  let p = long.next;
  let q = short.next;
  const index = (at: number): number => (at === NO_ROW ? NO_CELL : at);
  const steps = long.showing;
  for (let i = 0; i < steps; i += 1) {
    if (long.phase < 3) {
      const cell = cells[p]!;
      if (long.which === 0) cell.down = index(q);
      else cell.up = index(q);
    }
    if (short.phase < 3) {
      const cell = cells[q]!;
      if (short.which === 0) cell.down = index(p);
      else cell.up = index(p);
    }
    if (long.phase < 3) p = layStep(cells, long, p);
    if (short.phase < 3) q = layStep(cells, short, q);
  }
}

/** A row's cells linked in a ring (`shows`, whether a cell shows past the row's tenth); returns the row to lay. */
function lay(cells: SelectCell[], first: number, which: number, y: number, shows: (cell: number) => boolean): Row {
  const row: Row = { next: first, last: first, x: ROW.left, y, step: ROW.step, which, phase: 0, odd: 0, stop: NO_CELL, skip: 0, showing: 0, half: 0 };
  let start = -1;
  let last = first;
  for (let i = 0; i < ROW.cells; i += 1) {
    const at = first + i;
    if (cells[at]!.roster === NO_ONE) continue;
    if (start < 0) start = at;
    else {
      cells[last]!.right = at;
      cells[at]!.left = last;
    }
    last = at;
    if (i < ROW.shown || shows(at)) row.showing += 1;
  }
  if (start < 0) start = first;
  cells[last]!.right = start;
  cells[start]!.left = last;
  row.next = start;
  row.last = last;
  return row;
}

/** The grid from the characters earned, in the overlay's order, an added character in its cell. */
function setUpGrid(game: GameState, scenes: SceneTables): void {
  const select = game.select;
  const { grid, added } = scenes.select;
  select.arrivals = 0;
  const earned = game.records.earnedRoster & 0x1fffff;
  const has = (roster: number): boolean => ((earned >> (roster & 0x1f)) & 1) !== 0;
  const addedIn = (i: number): boolean => added.some((a) => a.cell === i);
  const rosterIn = (i: number): number => added.find((a) => a.cell === i)?.roster ?? grid[i]!;
  let shown = 0;
  select.cells.forEach((cell, i) => {
    const roster = rosterIn(i);
    Object.assign(cell, { up: NO_CELL, down: NO_CELL, left: NO_CELL, right: NO_CELL });
    if (!addedIn(i) && !has(roster)) {
      cell.roster = NO_ONE;
      cell.shows = 0;
      return;
    }
    cell.roster = roster;
    if (i % ROW.cells < ROW.shown || addedIn(i)) cell.shows = 1;
    else {
      cell.shows = 0;
      select.arrivals = ARRIVAL;
    }
    shown = (shown | (1 << (roster & 0x1f))) >>> 0;
  });
  let count = 0;
  for (let v = shown; v !== 0; v >>>= 1) count += v & 1;
  select.count = count;
  select.shown = shown;
  const a = lay(select.cells, 0, 0, 0, addedIn);
  const b = lay(select.cells, ROW.cells, 1, ROW.second, addedIn);
  if (Math.max(a.showing, b.showing) > ROW.shown) for (const row of [a, b]) Object.assign(row, { x: ELEVEN.left, step: ELEVEN.step });
  select.twoRows = b.showing === 0 ? 0 : 1;
  layRows(select.cells, a, b);
}

/** The spacing the grid's cells are laid at: the original's, or closer where a row shows eleven. */
export function cellStep(cells: readonly SelectCell[]): number {
  const showing = (first: number): number => cells.slice(first, first + ROW.cells).filter((cell) => cell.shows !== 0).length;
  return Math.max(showing(0), showing(ROW.cells)) > ROW.shown ? ELEVEN.step : ROW.step;
}

/* ---- A side's choosing. ---- */

/** The cell a roster id is in, or -1. */
const cellOf = (game: GameState, roster: number): number => game.select.cells.findIndex((cell) => cell.roster === roster);

/** Where a side's cursor starts, by its standing: on the character it has, on its last choice, the side's first cell when the character is not in the grid. */
function placeCursor(game: GameState, scenes: SceneTables, side: SelectSide, n: number): void {
  let roster = NO_ONE;
  let costume = 0;
  const kind = standing(game, n);
  if (kind === 1) {
    roster = game.entrants.roster[n]!;
    costume = game.entrants.costume[n]!;
  } else if (kind === 2 || kind === 3) {
    roster = kind === 2 ? side.lastRoster : game.entrants.roster[n]!;
    costume = kind === 2 ? side.lastCostume : game.entrants.costume[n]!;
    const at = isCharacter(scenes, roster) ? cellOf(game, roster) : -1;
    if (at < 0) {
      side.cell = scenes.select.sides[n]!.firstCell;
      roster = game.select.cells[side.cell]!.roster;
    } else side.cell = at;
  }
  side.shownRoster = NO_ONE;
  side.roster = roster;
  side.costume = costume;
  side.shownCostume = 1;
}

/** Two choices of one character in one costume made different, the later one giving way. */
export function keepApart(a: SelectSide['apart'], b: SelectSide['apart']): void {
  if (b.chosen === 0 || a.roster !== b.roster || a.costume !== b.costume) return;
  const costume = a.costume;
  if (b.human === 0 && a.human !== 0) b.costume = costume < 2 ? costume ^ 1 : 0;
  else a.costume = b.costume < 2 ? b.costume ^ 1 : 0;
}

/**
 * A side's choice by the buttons newly pressed (or the countdown run out): the costume by the
 * button, the two sides kept apart, and the choice kept as the side's last. False once a
 * character is chosen.
 */
function choose(game: GameState, data: Pick<FightData, 'sound'>, scenes: SceneTables, n: number, buttons: number): boolean {
  const select = game.select;
  const side = select.sides[n]!;
  const third = (game.records.extraCostumes & (1 << (side.roster & 0x1f))) !== 0 ? THIRD : 0;
  if (((third | BUTTONS) & buttons) === 0 && select.countdown !== 0) return true;
  const costume = (third & buttons) !== 0 ? 2 : (buttons & KICKS) !== 0 ? 1 : 0;
  const none = side.roster === NO_ONE;
  if (!none && !isCharacter(scenes, side.roster)) return true;
  side.costume = costume;
  for (const each of select.sides) {
    const [chosen, human] = scenes.select.apart[each.state]!;
    Object.assign(each.apart, { roster: each.roster, costume: each.costume, chosen, human });
  }
  keepApart(side.apart, select.sides[(n + 1) & 1]!.apart);
  for (const each of select.sides) {
    each.roster = each.apart.roster;
    each.costume = each.apart.costume;
  }
  side.lastRoster = side.roster;
  side.lastCostume = side.costume;
  voiceLine(game.world, data, 0, CHOOSE_SOUND, 0);
  return none;
}

/** The cell a pad's direction (repeated, a diagonal's sideways part first) moves to from `at`, or none. */
function moveFrom(game: GameState, at: number, pad: number): number {
  const repeated = game.pads.repeats[pad]!;
  let held = (repeated & 0xafff) | (game.world.input.fresh[pad]! & 0x5000);
  if ((repeated & 0xa000) !== 0) held = repeated & 0xa000;
  const cell = game.select.cells[at]!;
  if (held === 0x2000) return cell.right;
  if (held === 0x1000) return cell.up;
  if (held === 0x4000) return cell.down;
  if (held === 0x8000) return cell.left;
  return NO_CELL;
}

/** A side's cursor moved by a pad, onto the cell's character, in its first costume. */
function steer(game: GameState, data: Pick<FightData, 'sound'>, side: SelectSide, pad: number): void {
  const next = moveFrom(game, side.cell, pad);
  if (next !== NO_CELL) {
    side.cell = next;
    side.costume = 0;
    game.select.refresh = 2;
    voiceLine(game.world, data, 0, MOVE_SOUND, 0);
  }
  side.roster = game.select.cells[side.cell]!.roster;
}

/** A side's step; true once it is done. */
function stepSide(game: GameState, data: Pick<FightData, 'sound'>, scenes: SceneTables, n: number): boolean {
  const select = game.select;
  const other = (n + 1) & 1;
  const side = select.sides[n]!;
  const pressed = (pad: number): number => game.world.input.fresh[pad]!;
  let done = false;
  switch (side.state) {
    case SideState.SET_UP: {
      side.fade = 0;
      const seconds = select.count < 0xb ? 0x3c : (select.count - 10) * 3 + 0x3c;
      select.perCount = seconds;
      select.countdown = seconds * 0x14;
      side.wait = 0;
      side.fade = 0;
      if (game.entrants.chosen[n] !== 0) {
        side.wait = CHOSEN_WAIT;
        side.fade = FADE_IN;
      }
      placeCursor(game, scenes, side, n);
      const joined = game.world.joined[n] !== 0;
      switch (select.mode) {
        case MenuMode.TIME_ATTACK:
        case MenuMode.SURVIVAL:
        case MenuMode.TEKKEN_FORCE:
          side.state = joined ? SideState.CHOOSING : SideState.OUT;
          break;
        case MenuMode.PRACTICE:
          side.state = joined ? SideState.CHOOSING : SideState.WAITING;
          break;
        default: {
          const kind = standing(game, n);
          side.state = kind === 2 ? SideState.CHOOSING : kind === 3 ? SideState.CHOSEN : SideState.COMPUTER;
        }
      }
      break;
    }
    case SideState.CHOOSING:
      steer(game, data, side, n);
      if (!choose(game, data, scenes, n, pressed(n))) {
        side.wait = CHOSEN_WAIT;
        side.fade = FADE_IN;
        side.state = SideState.CHOSEN;
      }
      break;
    case SideState.WAITING:
      if (select.sides[other]!.state === SideState.CHOSEN) {
        side.state = SideState.PARTNER;
        side.cell = select.sides[other]!.cell;
      }
      break;
    case SideState.PARTNER:
      /* The waiting room's partner: any character on the select, at random. */
      if (game.online.warming !== 0) {
        const cells = select.cells.slice(0, select.count).flatMap((cell, at) => (isCharacter(scenes, cell.roster) ? [at] : []));
        if (cells.length > 0) side.cell = cells[(game.world.noise >>> 16) % cells.length]!;
        side.roster = select.cells[side.cell]!.roster;
        choose(game, data, scenes, n, PUNCH);
        side.wait = CHOSEN_WAIT;
        side.fade = FADE_IN;
        side.state = SideState.PARTNER_CHOSEN;
        break;
      }
      steer(game, data, side, other);
      if ((pressed(other) & CANCEL) === 0) {
        if (!choose(game, data, scenes, n, pressed(other))) {
          side.wait = CHOSEN_WAIT;
          side.fade = FADE_IN;
          side.state = SideState.PARTNER_CHOSEN;
        }
      } else {
        select.sides[other]!.state = SideState.CHOOSING;
        side.state = SideState.WAITING;
        select.refresh = 2;
        side.roster = NO_ONE;
        side.costume = 0;
        voiceLine(game.world, data, 0, CHOOSE_SOUND, 0);
      }
      break;
    case SideState.COMPUTER:
      if (game.run.challengers !== 0 && joinWithStart(game, n)) {
        side.state = SideState.SET_UP;
        voiceLine(game.world, data, 0, JOIN_SOUND, 0);
        break;
      }
      done = true;
      break;
    case SideState.OUT:
      done = true;
      break;
    case SideState.CHOSEN:
    case SideState.PARTNER_CHOSEN: {
      if ((pressed(side.state === SideState.CHOSEN ? n : other) & START) !== 0) side.wait = 0;
      if (side.wait < 1) done = true;
      else side.wait -= 1;
      break;
    }
  }
  const [cursor, name] = scenes.select.kinds[side.state]!;
  side.cursor = cursor;
  side.nameKind = name;
  return done;
}

/** The choices written for the match: each side's last choice kept, and for a human (or practice's partner) its character, chosen, a human's. */
function writeChoices(game: GameState): void {
  const select = game.select;
  select.sides.forEach((side, n) => {
    const joined = game.world.joined[n] !== 0;
    let take = select.mode === MenuMode.PRACTICE;
    if (game.world.mode !== MenuMode.PRACTICE || joined) {
      game.options.lastChoices[n] = side.lastRoster === NO_ONE ? NO_CHOICE : ((side.lastRoster << 2) | (side.lastCostume & 3)) & 0xff;
      take = joined || take;
    }
    if (!take) return;
    game.entrants.roster[n] = side.lastRoster;
    game.entrants.costume[n] = side.lastCostume;
    game.entrants.chosen[n] = 1;
    game.entrants.computer[n] = 0;
  });
}

/* ---- What the select shows. ---- */

/** One side a field (in turn) shows the character its cursor is on: whether its portrait faces the other way, and the portrait the versus screen will show. */
function showPortrait(game: GameState, scenes: SceneTables): void {
  const select = game.select;
  select.frames = (select.frames + 1) | 0;
  const n = select.frames & 1;
  const side = select.sides[n]!;
  if (side.shownRoster === side.roster && side.shownCostume === side.costume) return;
  side.shownRoster = side.roster;
  side.shownCostume = side.costume;
  const look = lookOf(scenes, side.roster, side.costume) & 0xff;
  const mirrored = scenes.select.sides[n]!.mirror === 1;
  side.mirrored = ((look & 0x20) !== 0) !== mirrored && side.shownRoster !== NO_ONE ? 1 : 0;
  game.versusPortraits[n] = look & 0x1f;
}

/** Every fourth frame a sparkle rises from somewhere across a portrait (the sides in turn); each rises sixteen lines a frame and fades. */
function stepSparkles(game: GameState, scenes: SceneTables): void {
  const select = game.select;
  const count = select.frames;
  const layout = scenes.select.layouts[select.twoRows]!;
  if ((count & 3) === 0) {
    const free = select.sparkles.find((sparkle) => sparkle.on === 0);
    if (free !== undefined) {
      free.phase = 0;
      const noise = stepNoise(game) | 0;
      free.on = 1;
      const quarter = ((((count >> 3) & 1) << 1) | (((count >> 3) & 3) >> 1)) << 10;
      free.x = ((scenes.select.sides[(count >> 2) & 1]!.portraitX + (((quarter | ((noise >> 2) & 0x3ff)) * SPARKLE.across) >> 12)) << 16) >> 16;
      free.from = layout.nameY;
      free.y = layout.nameY;
    }
  }
  const vsync = game.world.vsyncSeen & 0xffff;
  for (const sparkle of select.sparkles) {
    if (sparkle.on !== 1) continue;
    if (sparkle.phase === 0) {
      sparkle.level = SPARKLE.level;
      sparkle.born = vsync;
      sparkle.phase = 1;
      sparkle.fade = (stepNoise(game) & 3) + 4;
    } else if (sparkle.phase !== 1) continue;
    sparkle.level -= sparkle.fade;
    const y = ((sparkle.from + (vsync - sparkle.born) * -SPARKLE.rise) << 16) >> 16;
    sparkle.y = y;
    if (y + SPARKLE.height < 0 || sparkle.level < 1) sparkle.on = 0;
  }
}

/** The second random generator stepped; its new value. */
export function stepNoise(game: GameState): number {
  game.world.noise = (Math.imul(game.world.noise, 5) + 1) >>> 0;
  return game.world.noise;
}

/** Under each portrait the mode's title, for a side that plays no part; for one not yet in, the lines that call a player in. */
function printNames(game: GameState, scenes: SceneTables): void {
  const select = game.select;
  const layout = scenes.select.layouts[select.twoRows]!;
  select.sides.forEach((side, n) => {
    const centre = scenes.select.sides[n]!.nameCentre;
    if (side.nameKind === 3) {
      /* ONLINE MODE's waiting room is Practice, by its own name. */
      const title = select.mode === MenuMode.PRACTICE && game.online.warming !== 0 ? 'ONLINE!' : (MODE_TITLES[select.mode] ?? '');
      const width = title.length * TITLE.advance;
      let x = centre - (width >> 1);
      let end = x + width;
      if (x < TITLE.left) {
        x = TITLE.left;
        end = width + TITLE.left;
      }
      if (TITLE.right < end) x = TITLE.right - title.length * TITLE.advance;
      print(game, TITLE.font, TITLE.colour, x, layout.nameY - TITLE.above, title);
      return;
    }
    if (side.nameKind === 2) printCoinLine(game, scenes, n, centre, COIN_Y, layout.coinColour);
  });
}

/** The lines under a side not in, blinking, alternating every 64 frames: who should press start, then the credits (both pads are in, here). */
export function printCoinLine(game: GameState, scenes: SceneTables, side: number, x: number, y: number, colour: number): void {
  const vsync = game.world.vsyncSeen;
  if ((vsync & 0x30) === 0) return;
  const line = (vsync & 0x40) === 0 ? scenes.select.coinLines[side === 0 ? 1 : 2]! : scenes.select.creditLines[0]!;
  print(game, 0, colour, x - line.half, y, line.text);
}

/** The select's frame's drawing that changes its state: the sparkles, the portraits' fades, the arrows' frames, the refresh count. */
function drawSelect(game: GameState, scenes: SceneTables): void {
  const select = game.select;
  stepSparkles(game, scenes);
  for (const side of select.sides) if (side.fade !== 0) side.fade -= 1;
  if (select.arrivals !== 0) select.arrivals -= 1;
  printNames(game, scenes);
  if (0 < select.refresh) select.refresh -= 1;
}

/** Scene 9. */
export function selectScene(game: GameState, data: Pick<FightData, 'sound'>, scenes: SceneTables): void {
  const select = game.select;
  if (0 < game.step && 2 < select.frames && softReset(game, data)) return;
  switch (game.step) {
    case 0:
      select.mode = game.world.mode;
      setUpGrid(game, scenes);
      keyOffVoices(game.world, false);
      playSong(game.world, SONG, false);
      select.frames = 0;
      select.refresh = 2;
      select.sides.forEach((side, n) => {
        side.state = SideState.SET_UP;
        const last = game.options.lastChoices[n]!;
        side.lastRoster = last >> 2;
        side.lastCostume = last & 3;
        stepSide(game, data, scenes, n);
      });
      for (const sparkle of select.sparkles) {
        sparkle.on = 0;
        sparkle.phase = 0;
      }
      game.step = 1;
      break;
    case 1: {
      if (0 < select.countdown) select.countdown -= 1;
      const first = stepSide(game, data, scenes, 0);
      const second = stepSide(game, data, scenes, 1);
      if (first && second) game.step = 2;
      break;
    }
    case 2:
      writeChoices(game);
      game.scene = game.run.after.scene;
      game.step = game.run.after.step;
      break;
  }
  showPortrait(game, scenes);
  if (2 < select.frames) drawSelect(game, scenes);
}
