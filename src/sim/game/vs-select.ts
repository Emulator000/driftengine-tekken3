/**
 * The versus select (scene 10): both players choose at once from a grid of seven characters by
 * three. Each side's cursor steps across the grid (a row's ends wrap, the rows do not), its slot
 * shows the character under it, and a button chooses (a kick the second costume, the fourth
 * button the third where it is earned), the two choices kept apart. In versus each side then sets
 * its handicap on its gauge, select taking the choice back, and a button settles it. The title
 * alternates with the way out once the pads rest, and the game's name and the tournament's line
 * scroll behind. Arcade and the one-player modes come here too when start and both shoulders are
 * held as the mode is chosen; teams and Tekken Ball are not remade.
 */
import type { FightTables } from '../fight/match.ts';
import { keyOffVoices, playSong, voiceLine } from '../fight/voices.ts';
import type { SceneTables } from '../data/scenes.ts';
import { softReset } from './fight-scene.ts';
import { joinWithStart } from './join.ts';
import { holdPicture } from './logo.ts';
import { MenuMode } from './menu.ts';
import { print } from './printer.ts';
import { keepApart, printCoinLine, standing } from './select.ts';
import type { GameState, VsSelectSide } from './state.ts';
import { fade } from './title.ts';

/** The grid: seven cells a row, three rows. */
const COLUMNS = 7;
const ROWS = 3;
/** No choice, and a character earned but not to be chosen (taken already); the codes past the characters'. */
export const NO_CHOICE = 0x58;
export const TAKEN = 0x59;
/** The side states this scene plays. */
export const VsSideState = { SET_UP: 0, CHOOSING: 3, HANDICAP: 4, WAITING: 6, PARTNER: 7, COMPUTER: 8, OUT: 10, CHOSEN: 0xb, SETTLED: 0xc, PARTNER_CHOSEN: 0xd } as const;
/** The buttons: a kick (the second costume), the fourth button and start (the third), the four, select, start. */
const KICKS = 0x60;
const THIRD = 0x810;
const BUTTONS = 0xf0;
const CANCEL = 0x100;
/** The sounds: a cursor's move, a choice, a challenger. */
const MOVE_SOUND = 0x55f5;
const CHOOSE_SOUND = 0x50f4;
const JOIN_SOUND = 0x49a1;
const SONG = 1;
/** The handicaps: eight, and how far a gauge moves a field toward where it is going. */
const HANDICAPS = 8;
const GAUGE_STEP = 0x18;
/** The fade in: its table entry, and its rise a field to 0x100 (clear). */
const FADE = { layer: 7, step: 0x10, clear: 0x100 } as const;
/** A name: its font and its glyphs' advance, the bar under it (a line and a half down, its ends past the name's). */
const NAME = { font: 1, advance: 13, bar: 0x12, overhang: 4 } as const;
const NAME_COLOURS = { character: 6, none: 9, taken: 5 } as const;
/** What a side shows under its name with no part to play, by mode; and the line of a side not yet in, a little below. */
const PLAYING_NO_PART: Readonly<Record<number, string>> = { 3: 'TIME ATTACK!', 4: 'SURVIVAL!', 5: 'PRACTICE!', 8: 'TEKKEN FORCE!' };
const PLEASE_WAIT = 'PLEASE WAIT!';
const LINE_EDGES = { left: 8, right: 0x168 } as const;
const COIN = { below: 4, colour: 10 } as const;
/** The title and the hint: the frames the pads rest before they alternate, the half of each turn, the slide's frames and length, their places. */
const TITLE = { rest: 0x1e0, turn: 0x100, slide: 0xe0, frames: 0x1f, across: 0x170, home: 0xb8, away: 0x228, y: 0x1c, hintY: 0x20, colour: 6 } as const;
const HINT_COLOURS = [5, 6, 5, 6, 5] as const;
/** The game's name scrolls a pixel a field round 0x180, the tournament's line two round 0x344; the line's font, colour and place. */
const STRIP = { period: 0x180 } as const;
const LINE = { period: 0x344, font: 2, colour: 6, y: 0xcb, layer: 0 } as const;
/** "VS" between the slots, outside versus. */
const VERSUS_LINE = { text: 'VS', font: 2, colour: 7, x: 0xa1, y: 0x15c } as const;
/** Versus's record: each side's wins, the dash between them, the draws and their word. */
const RECORD = { wins: [0x78, 0xcc], y: 0x14e, draws: { x: 0xab, y: 0x181 }, dash: { x: 0xad, y: 0x14e }, word: { x: 0xa6, y: 0x16d }, colour: 7 } as const;
/** The gauge's labels: their font and colours. */
const LABELS = { font: 0, life: 5, percent: 6 } as const;
/** The slot a side's choices show in, by mode: one player's, versus's (and Tekken Ball's). */
const SINGLE_SLOT = 0;
const VERSUS_SLOT = 1;

/** The cell at a side's cursor. */
const cellOf = (side: VsSelectSide): number => side.column + side.row * COLUMNS;

/** The code of the character under a side's cursor; one not in its pool reads as taken where earned, else as none. */
export function codeUnder(game: GameState, scenes: SceneTables, side: VsSelectSide): number {
  const code = scenes.vsSelect.grid[cellOf(side)]?.code ?? NO_CHOICE;
  const bit = 1 << ((code >> 2) & 0x1f);
  if ((side.pool & bit) !== 0) return code;
  return (game.records.earnedRoster & bit) !== 0 ? TAKEN : NO_CHOICE;
}

/** The slot a mode shows a side's choices in. */
export const slotOf = (mode: number): number => (mode === MenuMode.VERSUS || mode === MenuMode.TEKKEN_BALL ? VERSUS_SLOT : SINGLE_SLOT);

/* ---- A side's choosing. ---- */

/** A side set up to choose one character: its choice so far (the one it has, or none), its cursor on it, its last choice, or where it starts. */
function setUpOne(game: GameState, scenes: SceneTables, n: number): void {
  const side = game.vsSelect.sides[n]!;
  side.count = 0;
  side.teamSize = 1;
  let code: number;
  if (game.entrants.chosen[n] === 0) {
    code = side.last;
    side.chosen[0] = NO_CHOICE;
  } else {
    side.count = 1;
    code = ((game.entrants.roster[n]! << 2) + game.entrants.costume[n]!) | 0;
    side.chosen[0] = code;
  }
  const wanted = code < NO_CHOICE ? code & ~3 : scenes.vsSelect.sides[n]!.firstCode;
  const at = scenes.vsSelect.grid.findIndex((cell) => cell.code === wanted);
  if (at < 0) return;
  side.column = at % COLUMNS;
  side.row = Math.floor(at / COLUMNS);
}

/**
 * A side's choice by the buttons newly pressed: the character under its cursor (one taken or not
 * earned chooses nothing) in the costume the button gives, the two sides' first choices kept apart
 * (but for teams), taken from its pool. False once it has chosen all it chooses.
 */
function choose(game: GameState, tables: FightTables, scenes: SceneTables, n: number, buttons: number): boolean {
  const vs = game.vsSelect;
  const side = vs.sides[n]!;
  const code = codeUnder(game, scenes, side);
  const third = (game.records.extraCostumes & (1 << ((code >> 2) & 0x1f))) !== 0 ? THIRD : 0;
  if (((third | BUTTONS) & buttons) === 0) return true;
  const costume = (third & buttons) !== 0 ? 2 : (buttons & KICKS) !== 0 ? 1 : 0;
  if (code < NO_CHOICE) {
    let chosen = code + costume;
    side.chosen[side.count] = chosen;
    if (vs.mode !== MenuMode.TEAM_BATTLE) {
      for (const each of vs.sides) {
        const [kept, human] = scenes.vsSelect.apart[each.state]!;
        Object.assign(each.apart, { roster: each.chosen[0]! >> 2, costume: each.chosen[0]! & 3, chosen: kept, human });
      }
      keepApart(side.apart, vs.sides[(n + 1) & 1]!.apart);
      for (const each of vs.sides) each.chosen[0] = (each.apart.roster << 2) | (each.apart.costume & 3);
      chosen = side.chosen[side.count]!;
    }
    side.last = chosen;
    side.count += 1;
    side.pool = (side.pool & ~(1 << ((chosen >> 2) & 0x1f))) >>> 0;
    voiceLine(game.world, tables, 0, CHOOSE_SOUND, 0);
  }
  return side.count < side.teamSize;
}

/** A side's last choice taken back, into its pool again. */
function takeBack(game: GameState, tables: FightTables, side: VsSelectSide): void {
  if (side.count < 1) return;
  const code = side.chosen[side.count - 1]!;
  side.last = code;
  side.chosen[side.count - 1] = NO_CHOICE;
  side.count -= 1;
  side.pool = (side.pool | (1 << ((code >> 2) & 0x1f))) >>> 0;
  voiceLine(game.world, tables, 0, CHOOSE_SOUND, 0);
}

/** Right less left on a pad's repeats; down less up. */
const across = (repeats: number): number => ((repeats >> 13) & 1) - ((repeats >> 15) & 1);
const down = (repeats: number): number => ((repeats >> 14) & 1) - ((repeats >> 12) & 1);

/** A side's cursor moved by a pad's repeats: across first, wrapping at a row's ends; else up or down, within the rows. */
function steer(game: GameState, tables: FightTables, side: VsSelectSide, pad: number): void {
  const repeats = game.pads.repeats[pad]!;
  let column = COLUMNS - 1 < side.column ? 0 : side.column;
  let row = ROWS - 1 < side.row ? 0 : side.row;
  const dx = across(repeats);
  if (dx === 0) {
    const next = row + down(repeats);
    if (0 <= next && next < ROWS) row = next;
  } else {
    const next = column + dx;
    column = 0 <= next && next < COLUMNS ? next : COLUMNS - 1 - column;
  }
  if (side.column !== column || side.row !== row) voiceLine(game.world, tables, 0, MOVE_SOUND, 0);
  side.column = column;
  side.row = row;
}

/** A side's step; true once it is done. */
function stepSide(game: GameState, tables: FightTables, scenes: SceneTables, n: number): boolean {
  const vs = game.vsSelect;
  const side = vs.sides[n]!;
  const other = vs.sides[(n + 1) & 1]!;
  const layout = scenes.vsSelect.sides[n]!;
  const pressed = (pad: number): number => game.world.input.fresh[pad]!;
  let done = false;
  switch (side.state) {
    case VsSideState.SET_UP: {
      side.pool = game.records.earnedRoster;
      const joined = game.world.joined[n] !== 0;
      switch (vs.mode) {
        case MenuMode.ARCADE:
        case MenuMode.DEMO: {
          const kind = standing(game, n);
          side.state = kind === 2 ? VsSideState.CHOOSING : kind === 3 ? VsSideState.CHOSEN : VsSideState.COMPUTER;
          break;
        }
        case MenuMode.VERSUS:
          side.state = VsSideState.CHOOSING;
          side.handicap = game.world.options.handicaps[n]!;
          side.gaugeTarget = layout.gauge.x;
          side.gaugeX = layout.gauge.x;
          break;
        case MenuMode.TIME_ATTACK:
        case MenuMode.SURVIVAL:
        case MenuMode.TEKKEN_FORCE:
          side.state = joined ? VsSideState.CHOOSING : VsSideState.OUT;
          break;
        case MenuMode.PRACTICE:
          side.state = joined ? VsSideState.CHOOSING : VsSideState.WAITING;
          break;
        default:
          throw new Error(`mode ${vs.mode}'s versus select is not remade`);
      }
      setUpOne(game, scenes, n);
      break;
    }
    case VsSideState.CHOOSING:
      steer(game, tables, side, n);
      if (choose(game, tables, scenes, n, pressed(n))) break;
      side.state = vs.mode === MenuMode.VERSUS ? VsSideState.HANDICAP : VsSideState.CHOSEN;
      break;
    case VsSideState.HANDICAP: {
      side.gaugeTarget = layout.gauge.raised;
      let handicap = side.handicap;
      let dx = across(game.pads.repeats[n]!);
      if (game.world.mode === MenuMode.TEKKEN_BALL) dx *= 2;
      if (dx !== 0) {
        if (layout.gauge.mirrored === 0) dx = -dx;
        if (0 <= handicap + dx && handicap + dx < HANDICAPS) handicap += dx;
      }
      if (side.handicap !== handicap) voiceLine(game.world, tables, 0, MOVE_SOUND, 0);
      side.handicap = handicap;
      if ((pressed(n) & CANCEL) !== 0) {
        side.gaugeTarget = layout.gauge.x;
        takeBack(game, tables, side);
        side.state = VsSideState.CHOOSING;
      } else if ((pressed(n) & BUTTONS) !== 0) {
        voiceLine(game.world, tables, 0, CHOOSE_SOUND, 0);
        side.state = VsSideState.SETTLED;
      }
      break;
    }
    case VsSideState.WAITING:
      if (other.state === VsSideState.CHOSEN) {
        side.column = other.column;
        side.row = other.row;
        side.state = VsSideState.PARTNER;
      }
      break;
    case VsSideState.PARTNER: {
      const pad = (n + 1) & 1;
      steer(game, tables, side, pad);
      if ((pressed(pad) & CANCEL) === 0) {
        if (!choose(game, tables, scenes, n, pressed(pad))) side.state = VsSideState.PARTNER_CHOSEN;
      } else {
        takeBack(game, tables, other);
        side.state = VsSideState.WAITING;
        other.state = VsSideState.CHOOSING;
        [other.cursor, other.nameKind, other.slotKind] = scenes.vsSelect.kinds[VsSideState.CHOOSING]!;
      }
      break;
    }
    case VsSideState.COMPUTER:
      if (game.run.challengers !== 0 && joinWithStart(game, n)) {
        side.state = VsSideState.SET_UP;
        voiceLine(game.world, tables, 0, JOIN_SOUND, 0);
        break;
      }
      done = true;
      break;
    case VsSideState.OUT:
    case VsSideState.CHOSEN:
    case VsSideState.SETTLED:
    case VsSideState.PARTNER_CHOSEN:
      done = true;
      break;
    default:
      throw new Error(`the versus select's side state ${side.state} is not remade`);
  }
  [side.cursor, side.nameKind, side.slotKind] = scenes.vsSelect.kinds[side.state]!;
  return done;
}

/** The choices written for the match: each side's last choice kept (and in versus its handicap), and for a human (or practice's partner) its character, chosen, a human's. */
function writeChoices(game: GameState): void {
  const vs = game.vsSelect;
  vs.sides.forEach((side, n) => {
    const joined = game.world.joined[n] !== 0;
    if (vs.mode !== MenuMode.PRACTICE || joined) game.options.lastChoices[n] = side.last & 0xff;
    if (vs.mode === MenuMode.VERSUS) game.world.options.handicaps[n] = side.handicap;
    if (vs.mode !== MenuMode.PRACTICE && !joined) return;
    game.entrants.roster[n] = side.chosen[0]! >> 2;
    game.entrants.costume[n] = side.chosen[0]! & 3;
    game.entrants.chosen[n] = 1;
    game.entrants.computer[n] = 0;
  });
}

/* ---- What the select shows. ---- */

/** Each side's gauge moved toward where it is going, and its labels: its name and its health's share. */
function stepGauges(game: GameState, scenes: SceneTables): void {
  const t = scenes.vsSelect;
  game.vsSelect.sides.forEach((side) => {
    const gap = Math.abs(side.gaugeTarget - side.gaugeX);
    if (gap !== 0) side.gaugeX = gap < GAUGE_STEP ? side.gaugeTarget : side.gaugeX + (side.gaugeX < side.gaugeTarget ? GAUGE_STEP : -GAUGE_STEP);
  });
  game.vsSelect.sides.forEach((side, n) => {
    const gauge = t.sides[n]!.gauge;
    print(game, LABELS.font, LABELS.life, side.gaugeX + gauge.life.x, gauge.life.y, t.life);
    print(game, LABELS.font, LABELS.percent, side.gaugeX + gauge.percent.x, gauge.percent.y, t.percents[side.handicap]!);
  });
}

/** A count of a hundred or more in its own colour, its last two digits shown. */
const twoDigits = (count: number): string => String(count % 100).padStart(2, '0');

/** Versus's record: each side's wins, the draws. */
function printRecord(game: GameState, scenes: SceneTables): void {
  const t = scenes.vsSelect;
  const { wins, draws } = game.run.versusRecord;
  RECORD.wins.forEach((x, n) => print(game, 2, t.winColours[Math.floor(wins[n]! / 100) & 3]!, x, RECORD.y, twoDigits(wins[n]!)));
  print(game, 1, t.drawColours[Math.floor(draws / 100) & 3]!, RECORD.draws.x, RECORD.draws.y, twoDigits(draws));
  print(game, 2, RECORD.colour, RECORD.dash.x, RECORD.dash.y, '-');
  print(game, 0, RECORD.colour, RECORD.word.x, RECORD.word.y, 'DRAW');
}

/** Under each slot its name, by its kind: the character under the cursor, or the one chosen last (with its costume's bar); a side with no part, its line. */
function printNames(game: GameState, tables: FightTables, scenes: SceneTables): void {
  const vs = game.vsSelect;
  vs.sides.forEach((side, n) => {
    const { x: centre, y } = scenes.vsSelect.sides[n]!.name;
    side.bar.width = 0;
    let code: number;
    switch (side.nameKind) {
      case 2:
        code = codeUnder(game, scenes, side);
        break;
      case 3: {
        const last = side.teamSize <= side.count ? side.teamSize - 1 : 0 < side.count ? side.count - 1 : side.count;
        code = side.chosen[last]!;
        break;
      }
      case 4:
        printCoinLine(game, scenes, n, centre, y + COIN.below, COIN.colour);
        return;
      case 5: {
        const text = PLAYING_NO_PART[vs.mode] ?? PLEASE_WAIT;
        const width = text.length * NAME.advance;
        let x = centre - (width >> 1);
        if (x < LINE_EDGES.left) x = LINE_EDGES.left;
        if (LINE_EDGES.right < x + width) x = LINE_EDGES.right - width;
        print(game, NAME.font, NAME_COLOURS.taken, x, y, text);
        return;
      }
      default:
        return;
    }
    const text = code < NO_CHOICE ? (tables.roster.codes[code]?.name ?? '') : code === NO_CHOICE ? 'NO ENTRY' : 'SELECTED';
    const colour = code < NO_CHOICE ? NAME_COLOURS.character : code === NO_CHOICE ? NAME_COLOURS.none : NAME_COLOURS.taken;
    const x = centre - ((text.length * NAME.advance) >> 1);
    print(game, NAME.font, colour, x, y, text);
    if (code < NO_CHOICE) Object.assign(side.bar, { x: x - NAME.overhang, y: y + NAME.bar, width: text.length * NAME.advance + NAME.overhang * 2 + 2, costume: code & 3 });
  });
}

/** The title, or once the pads have rested a while the way out, the two sliding across in turn. */
function printTitle(game: GameState, scenes: SceneTables): void {
  const vs = game.vsSelect;
  const pads = game.world.input.rawPads;
  vs.idle = pads[0] === 0 && pads[1] === 0 ? vs.idle + 1 : 0;
  const since = TITLE.rest - 1 < vs.idle ? vs.idle - TITLE.rest : 0;
  const away = (since & TITLE.turn) !== 0;
  let x: number = away ? TITLE.away : TITLE.home;
  if ((since & TITLE.slide) === TITLE.slide) {
    const slid = ((since & TITLE.frames) * TITLE.across) >> 5;
    x += away ? -slid : slid;
  }
  const title = scenes.vsSelect.titles[vs.mode]!;
  print(game, NAME.font, TITLE.colour, x - ((title.length * NAME.advance) >> 1), TITLE.y, title);
  /* The hint's colours switch at each `%c`, its place reckoned from its whole format. */
  const hint = scenes.vsSelect.hint;
  let pen = x - ((hint.length * 9) >> 1) - TITLE.across;
  hint.split('%c').forEach((part, k) => {
    pen = print(game, 0, k === 0 ? TITLE.colour : HINT_COLOURS[k - 1]!, pen, TITLE.hintY, part);
  });
}

/** The background's scrolls: the game's name a pixel a field, the tournament's line two (printed under everything). */
function printBackground(game: GameState, scenes: SceneTables): void {
  const vs = game.vsSelect;
  vs.strip = (vs.strip + STRIP.period - 1) % STRIP.period;
  vs.line = (vs.line + LINE.period - 2) % LINE.period;
  for (let x = vs.line - LINE.period; x < TITLE.across; x += LINE.period) print(game, LINE.font, LINE.colour, x, LINE.y, scenes.vsSelect.tournament, LINE.layer);
}

/** The frame's drawing that changes the scene's state, and its text. */
function drawVsSelect(game: GameState, tables: FightTables, scenes: SceneTables): void {
  const vs = game.vsSelect;
  if (vs.fading === 1) {
    fade(game, FADE.layer, vs.fade);
    vs.fade += FADE.step;
    if (FADE.clear < vs.fade) vs.fading = 0;
  }
  if (vs.mode === MenuMode.VERSUS) {
    stepGauges(game, scenes);
    printRecord(game, scenes);
  } else if (vs.mode !== MenuMode.TEKKEN_BALL) print(game, VERSUS_LINE.font, VERSUS_LINE.colour, VERSUS_LINE.x, VERSUS_LINE.y, VERSUS_LINE.text);
  printNames(game, tables, scenes);
  printTitle(game, scenes);
  printBackground(game, scenes);
}

/** Scene 10. */
export function vsSelectScene(game: GameState, tables: FightTables, scenes: SceneTables): void {
  const vs = game.vsSelect;
  if (game.step !== 0 && vs.fading === 0 && softReset(game, tables)) return;
  switch (game.step) {
    case 0:
      holdPicture(game, 0);
      game.step = 1;
      return;
    case 1:
      vs.fade = 0;
      vs.idle = 0;
      vs.strip = 0;
      vs.line = 0;
      vs.mode = game.world.mode;
      vs.fading = 1;
      vs.sides.forEach((side, n) => {
        side.state = VsSideState.SET_UP;
        side.last = game.options.lastChoices[n]!;
        stepSide(game, tables, scenes, n);
      });
      playSong(game.world, SONG, false);
      keyOffVoices(game.world, false);
      game.step = 2;
      break;
    case 2: {
      const first = stepSide(game, tables, scenes, 0);
      const second = stepSide(game, tables, scenes, 1);
      if (first && second) game.step = 3;
      break;
    }
    case 3:
      writeChoices(game);
      game.scene = game.run.after.scene;
      game.step = game.run.after.step;
      break;
  }
  drawVsSelect(game, tables, scenes);
}
