/**
 * The Options (scene 5), over the title's picture in blue: a page at a time, each pad's buttons
 * read as they are (not through their key configuration), the two pads together but on the key
 * configuration. The first page lists the others and the way out; GAME OPTION's list changes the
 * options at once (up and down to pick, left and right to change, wrapping), a box at the top
 * right showing the modes the picked one applies to; KEY CONFIGURATION gives each pad its side,
 * where holding a button opens its box's list of values for up and down to change; RECORDS shows
 * four rankings a page at a time; DISPLAY ADJUST moves the picture on the screen; the memory
 * card's page saves and loads the progress and turns the auto save on or off; REMAKE OPTION, listed
 * before the first page's EXIT, sets the remake's own settings (`remake-options.ts`). The progress is
 * kept on the device, not on a card, so that page and its lines are named for saving: SAVE DATA,
 * SAVE and LOAD. Select goes back a page, and from the first leaves for the mode menu, which opens
 * on the Options again.
 */
import type { FightData } from '../fight/state.ts';
import { voiceLine } from '../fight/voices.ts';
import type { OptionsItem, OptionsPage, OptionsTables, OptionValue, SceneTables } from '../data/scenes.ts';
import { softReset } from './fight-scene.ts';
import { goToLogo } from './logo.ts';
import { BACK_FROM_ONLINE, mapPads, MenuMode, startMode, wallsFor } from './menu.ts';
import { ONLINE_PAGE, onlineFrame } from './online-page.ts';
import { print } from './printer.ts';
import { playCount, sortPairs } from './records.ts';
import { share } from './records-screen.ts';
import { isRemakeSetting, REMAKE_ITEM, REMAKE_PAGE, remakeLineY, remakeOptions, REMASTER_LINE, remasterMissing, RESTART_LINE, restartWanted } from './remake-options.ts';
import { restoreProgress, saveProgress } from './save.ts';
import { buttonRow, draw, tile } from './draw.ts';
import { Scene, type GameState, type KeySide } from './state.ts';

/** The data the Options read: the sounds' and the characters' names. */
export type OptionsData = Pick<FightData, 'sound' | 'roster'>;

const Page = { MAIN: 0, GAME: 1, RECORDS: 2, CARD: 3, KEYS: 4, DISPLAY: 5 } as const;
/** The memory card page's screens: its list, a save, a load, turning auto save on. */
const CardScreen = { LIST: 0, SAVE: 1, LOAD: 2, AUTO_SAVE: 3 } as const;
/** The card's answers, one past the console's results: 0 not yet asked, 1 done, 2 an error, 3 no card, 4 unformatted, 5 full, 6 no file. */
const Card = { ASK: 0, DONE: 1, ERROR: 2, NO_CARD: 3, UNFORMATTED: 4, FULL: 5, NO_FILE: 6 } as const;

const START = 0x800;
const SELECT = 0x100;
/** Start or a button; a button; select or a button; up, down, start or a button; left or right. */
const CHOOSE = 0x8f0;
const BUTTONS = 0xf0;
const SELECT_OR_BUTTON = 0x1f0;
const LEAVE_MESSAGE = 0x58f0;
const LEFT_RIGHT = 0xa000;
/** L2, R2 and select held, the key configuration's hidden switch. */
const HIDDEN_HELD = 0x103;

const Sound = { MOVE: 0x546c, BACK: 0x4ceb, DECIDE: 0x4d87, OPEN: 0x45ca } as const;

/** A font 0 glyph's advance, and the table entries the pages use. */
const ADVANCE = 9;
const TEXT = 7;
const BARS = 4;
/** The bar under a picked row (blue), its height, and how far it reaches past its row. */
const BAR = { colour: 0xff4020, height: 0x16, margin: 3 } as const;
/** The box of the modes an option applies to: its place, a label's height, its frame's colour, and the grey a label takes for a mode it does not apply to. */
const MODE_BOX = { x: 0xf7, y: 0x2a, w: 0x60, row: 0xe, frame: 0xc0c0c0 } as const;
/** Tekken Ball's mode, whose label shows once it is earned. */
const TEKKEN_BALL = 7;
/** A card's message's middle across and its line; the prompts' place and their buttons'. */
const MESSAGE = { centre: 0xb8, y: 0x168 } as const;
const PROMPT = { x: 0x24, first: 0x17a, second: 0x19e, buttonsX: 0x98, buttonsY: 0x19c } as const;
/** The key configuration: a side's width, the pad's picture's place, its items' lines, the DualShock's type. */
const SIDE_WIDTH = 0xb8;
const KEY_ITEMS = { x: 0x14, setting: 0x154, vibration: 0x16e, reset: 0x188, exit: 0x1a2 } as const;
const PAD = { x: 0x14, y: 0x88 } as const;
const DUALSHOCK = 9;
/** A key's box: its width, its height closed, a value's line, the line an open box grows, the step arrows' values, the test buzz a vibration switched on plays. */
const KEY_BOX = { w: 0x40, h: 0x16, line: 0x12, grow: 0xd8, values: 13, stepUp: 10, stepDown: 11, buzz: 0xd } as const;
/** The display's place: its limits and its default, and the marks drawn around and across the screen. */
const DISPLAY = { left: -6, right: 0xe, top: 0, bottom: 8, x: -2, y: 0 } as const;
const MARKS = { rx: 0, ry: 0x14, rw: 0x170, rh: 0x1c0, cx: 0xb8, cy: 0xf4, colour: 0xe0e0e0 } as const;
/** The records: their list's rows on a page, the slowest time shown, the first ten characters always listed. */
const RECORD_ROWS = 10;
const NO_TIME = 0x57e3e;
const FIRST_TEN = 0x3ff;
const CHARACTERS = 0x16;
/** Roster 0x15, never listed. */
const UNLISTED = 0xffdfffff;

/** The memory card's words, as the remake names them for the device's own storage. */
const SAVE_WORDS: Readonly<Record<string, string>> = {
  'MEMORY CARD': 'SAVE DATA',
  'CARD SAVE': 'SAVE',
  'CARD LOAD': 'LOAD',
  'NO TEKKEN 3 FILE!': 'NO SAVE DATA!',
};
const said = (text: string): string => SAVE_WORDS[text] ?? text;
/** The big font's advance, to keep a renamed title on its middle. */
const TITLE_ADVANCE = 13;

const dy = (v: number): number => ((v >> 14) & 1) - ((v >> 12) & 1);
const dx = (v: number): number => ((v >> 13) & 1) - ((v >> 15) & 1);
const wrap = (lo: number, v: number, hi: number): number => (v < lo ? hi : hi < v ? lo : v);
const clamp = (lo: number, v: number, hi: number): number => Math.min(Math.max(v, lo), hi);
const triangle = (v: number): number => {
  v &= 0x1ff;
  return 0xff < v ? 0x1ff - v : v;
};
const popcount = (bits: number): number => {
  let count = 0;
  for (let v = bits >>> 0; v !== 0; v >>>= 1) count += v & 1;
  return count;
};
/** A colour (0xBBGGRR) at a level (of 256), each channel at most full. */
const scaled = (colour: number, level: number): number => [0, 8, 16].reduce((out, shift) => out | (Math.min(((colour >> shift) & 0xff) * level >> 8, 0xff) << shift), 0);
/** A number in `cells` places, spaces before it; past them, its last digits. */
const field = (n: number, cells: number): string => String(n).slice(-cells).padStart(cells, ' ');
const two = (n: number): string => String(n).padStart(2, '0');

function sound(game: GameState, data: OptionsData, code: number): void {
  voiceLine(game.world, data, 0, code, 0);
}

/** The bar's colour: pulsing between half and full, or full. */
function pulse(game: GameState, on: boolean): number {
  return on ? scaled(BAR.colour, (triangle(game.world.vsyncSeen << 4) >> 1) + 0x80) : BAR.colour;
}

/** The bar under a picked row from (x, y), `w` across. */
function bar(game: GameState, x: number, y: number, w: number, on: boolean): void {
  tile(game, x - BAR.margin, y - BAR.margin, w + BAR.margin * 2, BAR.height, pulse(game, on), BARS);
}

/** A line in two colours, the second going on from the first. */
function twoColours(game: GameState, x: number, y: number, parts: readonly string[], first: number): void {
  const pen = print(game, 0, first, x, y, parts[0] ?? '');
  print(game, 0, 6, pen, y, parts[1] ?? '');
}

function titleColour(game: GameState): number {
  return game.options.otherTitle !== 0 ? 1 : 6;
}

function valueOf(game: GameState, value: OptionValue): number {
  if (isRemakeSetting(value)) return game.remake.settings[value];
  return value === 'none' ? 0 : value === 'page' ? game.optionsScreen.page : game.options[value];
}

function setValue(game: GameState, value: OptionValue, v: number): void {
  if (isRemakeSetting(value)) game.remake.settings[value] = v & 0xff;
  else if (value === 'page') game.optionsScreen.page = v & 0xff;
  else if (value !== 'none') game.options[value] = v & 0xff;
}

/** The first page with the remake's settings listed before its EXIT. */
const withRemake = new WeakMap<OptionsPage, OptionsPage>();
function mainPage(page: OptionsPage): OptionsPage {
  let listed = withRemake.get(page);
  if (listed === undefined) {
    const items = [...page.items];
    items.splice(items.length - 1, 0, REMAKE_ITEM);
    listed = { ...page, items };
    withRemake.set(page, listed);
  }
  return listed;
}

/** A list's input: up and down move its cursor (wrapping), left and right change the item under it, a button does what the item does, select goes back. */
function listInput(game: GameState, data: OptionsData, page: OptionsPage, state: { cursor: number; sub: number }): void {
  const input = game.world.input;
  const repeats = game.pads.repeats[0]! | game.pads.repeats[1]!;
  const fresh = input.fresh[0]! | input.fresh[1]!;
  const held = input.rawPads[0]! | input.rawPads[1]!;
  const down = dy(repeats);
  const across = dx(repeats);
  const count = page.items.length;
  let cursor = (state.cursor + down) >>> 0;
  if (count <= cursor) cursor = count - (state.cursor + 1);
  if (down !== 0) sound(game, data, Sound.MOVE);
  state.cursor = cursor;
  const item = page.items[cursor]!;
  if (item.sideways !== 0) {
    const value = valueOf(game, item.value);
    let v = (value + across) >>> 0;
    if (item.count <= v) v = item.count - (value + 1);
    if (item.sideways === 1) {
      if (across !== 0) sound(game, data, Sound.MOVE);
      setValue(game, item.value, v);
    } else if (across !== 0) {
      sound(game, data, Sound.MOVE);
      if ((v & 0xff) === 0) setValue(game, item.value, 0);
      else state.sub = CardScreen.AUTO_SAVE;
    }
  }
  if (item.button === 1 || item.button === 2) {
    if ((fresh & CHOOSE) !== 0) {
      setValue(game, item.value, item.set);
      sound(game, data, Sound.BACK);
    }
    if (item.button === 2 && held === HIDDEN_HELD && fresh === SELECT) game.options.otherTitle = (game.options.otherTitle + 1) & 1;
  } else if (item.button === 3 && (fresh & CHOOSE) !== 0) {
    state.sub = cursor + 1;
    sound(game, data, Sound.MOVE);
  }
  if (0 <= page.cancel && (fresh & SELECT) !== 0) {
    game.optionsScreen.page = page.cancel;
    sound(game, data, Sound.BACK);
  }
}

/** A list drawn: its title, each item's label and value (the default in another colour), the bar under the picked one. */
function listDraw(game: GameState, page: OptionsPage, state: { cursor: number }): void {
  if (page.title !== '') {
    const title = said(page.title);
    print(game, 1, titleColour(game), page.titleX + (((page.title.length - title.length) * TITLE_ADVANCE) >> 1), page.titleY, title);
  }
  let y = page.listY;
  page.items.forEach((item: OptionsItem, i) => {
    const value = valueOf(game, item.value) & 0xff;
    let colour = 10;
    if (i === state.cursor) {
      colour = 5;
      bar(game, page.listX, y, item.draw === 1 ? said(item.label).length * ADVANCE : page.width, true);
    }
    const valueColour = item.sideways !== 0 && item.set === value ? 1 : 6;
    if (item.draw !== 0) print(game, 0, colour, page.listX, y, said(item.label));
    if (item.draw === 2) {
      const name = item.names[value] ?? '';
      print(game, 0, valueColour, page.listX + page.width - name.length * ADVANCE, y, name);
    }
    y += page.step;
  });
}

/** The modes' labels the box lists: all but Tekken Ball's until it is earned. */
function listLabels(game: GameState, tables: OptionsTables): void {
  const labels = game.optionsScreen.labels;
  labels.length = 0;
  tables.labels.forEach((label, i) => {
    if (label.mode !== TEKKEN_BALL || game.earned.ball !== 0) labels.push(i);
  });
}

/** The box of the modes an option applies to (`modes`, a bit each): each label in its colour, greyed where it does not apply, on black in a grey frame. */
function modeBox(game: GameState, tables: OptionsTables, modes: number): void {
  const labels = game.optionsScreen.labels;
  let y = MODE_BOX.y;
  for (const label of labels) {
    draw(game, { kind: 'label', label, grey: ((modes >> tables.labels[label]!.mode) & 1) === 0, x: MODE_BOX.x, y, layer: TEXT });
    y += MODE_BOX.row;
  }
  const h = labels.length * MODE_BOX.row;
  tile(game, MODE_BOX.x, MODE_BOX.y, MODE_BOX.w, h, 0, TEXT);
  tile(game, MODE_BOX.x - 1, MODE_BOX.y - 2, MODE_BOX.w + 2, h + 4, MODE_BOX.frame, TEXT);
}

/** A card's message, centred. */
function message(game: GameState, text: string, colour: number, y: number = MESSAGE.y): void {
  print(game, 0, colour, MESSAGE.centre - ((text.length * ADVANCE) >> 1), y, text);
}

/** The two prompts under a card's screen, and the buttons that answer the second. */
function prompts(game: GameState, first: readonly string[], second: readonly string[]): void {
  twoColours(game, PROMPT.x, PROMPT.first, first, 2);
  twoColours(game, PROMPT.x, PROMPT.second, second, 5);
  buttonRow(game, PROMPT.buttonsX, PROMPT.buttonsY, BARS);
}

/** A screen's message for the card's answer, by kind. */
function answer(game: GameState, tables: OptionsTables, card: number, loading: boolean): void {
  const lines = tables.lines;
  if (card === Card.DONE) message(game, loading ? lines.loaded : lines.saved, 1);
  else if (card === Card.ERROR || (loading && card === Card.UNFORMATTED)) message(game, loading ? lines.loadError : lines.saveError, 2);
  else if (card === Card.NO_CARD) message(game, lines.noCard, 2);
  else if (card === Card.FULL) message(game, lines.full, 5);
  else if (card === Card.NO_FILE) message(game, said(lines.noFile), 5);
  else message(game, lines.other, 3);
}

/** CARD SAVE: start saves the progress (the device's storage never fails); true once a button leaves. */
function saveScreen(game: GameState, data: OptionsData, tables: OptionsTables): boolean {
  const screen = game.optionsScreen;
  const fresh = game.world.input.fresh[0]! | game.world.input.fresh[1]!;
  if ((fresh & (screen.card === Card.ASK || screen.card === Card.UNFORMATTED ? BUTTONS : LEAVE_MESSAGE)) !== 0) {
    sound(game, data, Sound.MOVE);
    return true;
  }
  if (screen.card === Card.UNFORMATTED) message(game, tables.lines.format, 7);
  if (screen.card === Card.ASK || screen.card === Card.UNFORMATTED) {
    prompts(game, tables.lines.save, tables.lines.cancel);
    if ((fresh & START) !== 0) {
      saveProgress(game);
      screen.card = Card.DONE;
      sound(game, data, Sound.DECIDE);
    }
    return false;
  }
  answer(game, tables, screen.card, false);
  return false;
}

/** CARD LOAD: start brings back the progress last saved, or finds none; true once a button leaves. */
function loadScreen(game: GameState, data: OptionsData, tables: OptionsTables): boolean {
  const screen = game.optionsScreen;
  const fresh = game.world.input.fresh[0]! | game.world.input.fresh[1]!;
  if ((fresh & (screen.card === Card.ASK ? BUTTONS : LEAVE_MESSAGE)) !== 0) {
    sound(game, data, Sound.MOVE);
    return true;
  }
  if (screen.card === Card.ASK) {
    if ((fresh & START) !== 0) {
      if (game.kept === null) screen.card = Card.NO_FILE;
      else {
        restoreProgress(game, game.kept);
        screen.card = Card.DONE;
      }
      sound(game, data, Sound.DECIDE);
    }
    prompts(game, tables.lines.load, tables.lines.cancel);
    return false;
  }
  answer(game, tables, screen.card, true);
  return false;
}

/**
 * AUTO SAVE turned on: with a progress saved it is on at once; with none, start saves one (with
 * auto save on) and a button refuses. 1 refused, 2 on, 0 still asking.
 */
function autoSaveScreen(game: GameState, data: OptionsData, tables: OptionsTables): number {
  const screen = game.optionsScreen;
  const fresh = game.world.input.fresh[0]! | game.world.input.fresh[1]!;
  const asking = screen.card === Card.ASK || screen.card === Card.UNFORMATTED || screen.card === Card.NO_FILE;
  if ((fresh & (asking ? BUTTONS : LEAVE_MESSAGE)) !== 0) {
    sound(game, data, Sound.MOVE);
    return 1;
  }
  if (screen.card === Card.ASK) {
    screen.card = game.kept === null ? Card.NO_FILE : Card.DONE;
    return 0;
  }
  if (screen.card === Card.DONE) return 2;
  if (screen.card === Card.UNFORMATTED) message(game, tables.lines.format, 7);
  if (screen.card === Card.UNFORMATTED || screen.card === Card.NO_FILE) {
    if ((fresh & START) !== 0) {
      saveProgress(game);
      screen.card = Card.DONE;
      sound(game, data, Sound.DECIDE);
    }
    prompts(game, tables.lines.yes, tables.lines.no);
    return 0;
  }
  answer(game, tables, screen.card, false);
  return 0;
}

/** MEMORY CARD: its list, or the screen it opened over it. */
function cardPage(game: GameState, data: OptionsData, tables: OptionsTables, page: OptionsPage): void {
  const screen = game.optionsScreen;
  const state = screen.pages[Page.CARD]!;
  switch (state.sub) {
    case CardScreen.LIST:
      screen.card = Card.ASK;
      listInput(game, data, page, state);
      break;
    case CardScreen.SAVE:
      if (saveScreen(game, data, tables)) state.sub = CardScreen.LIST;
      break;
    case CardScreen.LOAD:
      if (loadScreen(game, data, tables)) state.sub = CardScreen.LIST;
      break;
    case CardScreen.AUTO_SAVE: {
      game.options.autoSave = 1;
      const result = autoSaveScreen(game, data, tables);
      game.options.autoSave = 0;
      if (result === 1) state.sub = CardScreen.LIST;
      if (result === 2) {
        game.options.autoSave = 1;
        state.sub = CardScreen.LIST;
      }
      break;
    }
  }
  listLabels(game, tables);
  listDraw(game, page, state);
}

/** The key configuration's sides as the page opens (and leaves): their cursors on the setting, no press seen, every box closed; then the pads mapped as their keys say. */
function keyConfigReset(game: GameState, scenes: SceneTables): void {
  for (const side of game.optionsScreen.sides) {
    Object.assign(side, { cursor: 0, active: 0, busy: 0, type: 0 });
    for (const box of side.boxes) Object.assign(box, { state: 0, grow: 0 });
  }
  mapPads(game, scenes);
}

/** A button's box opening while it is held (eight frames), its value changed by up and down once open, closing once let go. */
function keyStep(game: GameState, data: OptionsData, tables: OptionsTables, side: KeySide, pad: number, k: number): void {
  const layout = tables.keys[k]!;
  const box = side.boxes[k]!;
  const was = box.state;
  if ((side.held & layout.bit) === 0) {
    box.grow -= 1;
    if (box.grow < 1) {
      box.grow = 0;
      box.state = 0;
    } else box.state = 3;
  } else {
    box.grow += 1;
    if (box.grow < 9) box.state = 1;
    else {
      box.grow = 8;
      box.state = 2;
    }
  }
  if (box.grow !== 0) side.busy = 1;
  if (was === 0 && box.state === 1) sound(game, data, Sound.OPEN);
  const keys = game.options.keys[pad]!;
  if (box.state === 2) {
    const d = dy(side.repeats);
    if (d !== 0) sound(game, data, Sound.MOVE);
    keys[layout.key] = wrap(0, keys[layout.key]! + d, KEY_BOX.values - 1);
  }
  side.used |= 1 << keys[layout.key]!;
}

/** A key's value in its box: its name centred (STEP with its arrow), the current one's bar under it. */
function keyValue(game: GameState, tables: OptionsTables, x: number, y: number, v: number, layer: number, current: boolean, used: number): void {
  if (KEY_BOX.values <= v) return;
  const colour = current ? 5 : ((used >> v) & 1) !== 0 ? 10 : 6;
  if (v === KEY_BOX.stepUp || v === KEY_BOX.stepDown) draw(game, { kind: 'arrow', x: x + 8, y: y + 3, down: v === KEY_BOX.stepDown, colour, layer });
  const name = tables.keyNames[v]!;
  print(game, 0, colour, x - (((name.length * ADVANCE) >> 1) - KEY_BOX.w / 2), y + 3, name, layer);
  if (current) tile(game, x + 1, y + 2, KEY_BOX.w - 2, KEY_BOX.line, pulse(game, true), layer);
}

/** A button's box: closed, its value; opening, it moves to its place over the pad and grows into the list of values; and its pointer to the button on the pad. */
function keyDraw(game: GameState, tables: OptionsTables, side: KeySide, pad: number, k: number): void {
  const layout = tables.keys[k]!;
  const box = side.boxes[k]!;
  const x0 = pad * SIDE_WIDTH;
  const layer = box.state === 0 ? layout.layer : box.state === 3 ? 3 : 4;
  const value = game.options.keys[pad]![layout.key]!;
  const toward = (from: number, to: number): number => (to <= from ? -1 : 1) * ((Math.abs(to - from) * box.grow) >> 3);
  const x = x0 + layout.closed.x + toward(layout.closed.x, layout.open.x);
  const y = layout.closed.y + toward(layout.closed.y, layout.open.y);
  if (box.state !== 1 && box.state !== 2) keyValue(game, tables, x, layout.closed.y + toward(layout.closed.y, layout.open.y + value * KEY_BOX.line), value, layer, false, 0);
  else {
    for (let v = 0; v < KEY_BOX.values; v += 1) {
      keyValue(game, tables, x, layout.closed.y + toward(layout.closed.y, layout.open.y + v * KEY_BOX.line), v, v === value ? layer + 1 : layer, v === value, side.used);
    }
  }
  const h = (box.grow * KEY_BOX.grow) >> 3;
  tile(game, x + 1, y + 2, KEY_BOX.w - 2, h + KEY_BOX.h - 4, 0, layer);
  tile(game, x, y, KEY_BOX.w, h + KEY_BOX.h, layout.colour, layer);
  const point = tables.padPoints[side.type === DUALSHOCK ? 0 : 1]![layout.key]!;
  draw(game, {
    kind: 'pointer',
    x: x + layout.lineClosed.x + toward(layout.lineClosed.x, layout.lineOpen.x),
    y: y + layout.lineClosed.y + toward(layout.lineClosed.y, layout.lineOpen.y),
    toX: point.x + x0,
    toY: point.y,
    colour: layout.colour,
    layer,
  });
}

/** SETTING: while it is picked, one button held (once the side's pad has pressed one) opens its box; every box and the pad drawn. */
function settingItem(game: GameState, data: OptionsData, tables: OptionsTables, side: KeySide, pad: number, picked: boolean): void {
  side.type = DUALSHOCK;
  side.used = 0;
  if (picked) {
    side.held = side.active === 0 ? 0 : game.world.input.rawPads[pad]!;
    side.repeats = game.pads.repeats[pad]!;
    if ((side.held & 0xff) !== 0) side.busy = 1;
    if (popcount(side.held & 0xff) !== 1) side.held = 0;
    for (let k = 0; k < tables.keys.length; k += 1) keyStep(game, data, tables, side, pad, k);
  }
  for (let k = 0; k < tables.keys.length; k += 1) keyDraw(game, tables, side, pad, k);
  const x0 = pad * SIDE_WIDTH;
  draw(game, { kind: 'pad', x: x0 + PAD.x, y: PAD.y, dualShock: side.type === DUALSHOCK, layer: 0 });
  print(game, 0, picked ? 5 : 10, x0 + KEY_ITEMS.x, KEY_ITEMS.setting, tables.lines.setting);
  if (picked) bar(game, x0 + KEY_ITEMS.x, KEY_ITEMS.setting, 0x3f, side.busy === 0);
}

/** VIBRATION: left or right switches the pad's vibration, which buzzes it. */
function vibrationItem(game: GameState, data: OptionsData, tables: OptionsTables, side: KeySide, pad: number, picked: boolean): void {
  const world = game.world;
  let v = game.options.vibration[pad]!;
  if (picked && (world.input.fresh[pad]! & LEFT_RIGHT) !== 0) {
    v ^= 1;
    game.options.vibration[pad] = v;
    side.busy = 1;
    world.joined[pad] = 1;
    game.motors[pad] = v;
    world.vibrations.push({ pad, pattern: KEY_BOX.buzz });
    sound(game, data, Sound.MOVE);
  }
  const x = pad * SIDE_WIDTH + KEY_ITEMS.x;
  const pen = print(game, 0, picked ? 5 : 10, x, KEY_ITEMS.vibration, tables.lines.vibration);
  print(game, 0, v !== 0 ? 6 : 1, pen, KEY_ITEMS.vibration, tables.vibrationNames[v] ?? '');
  if (picked) bar(game, x, KEY_ITEMS.vibration, 0x90, true);
}

/** KEY CONFIGURATION: each pad's side on its own; true once a side's EXIT or select leaves with both sides at rest. */
function keyConfigFrame(game: GameState, data: OptionsData, scenes: SceneTables): boolean {
  const tables = scenes.options;
  const input = game.world.input;
  let leaving = false;
  game.optionsScreen.sides.forEach((side, pad) => {
    const fresh = input.fresh[pad]!;
    if (side.active === 0 && fresh !== 0) side.active = 1;
    side.busy = 0;
    const x = pad * SIDE_WIDTH + KEY_ITEMS.x;
    for (let item = 0; item < 4; item += 1) {
      const picked = item === side.cursor;
      if (item === 0) settingItem(game, data, tables, side, pad, picked);
      else if (item === 1) vibrationItem(game, data, tables, side, pad, picked);
      else if (item === 2) {
        if (picked && (fresh & CHOOSE) !== 0) {
          game.options.vibration[pad] = 0;
          game.options.keys[pad]!.splice(0, tables.defaultKeys.length, ...tables.defaultKeys);
          side.busy = 1;
          sound(game, data, Sound.DECIDE);
        }
        print(game, 0, picked ? 5 : 10, x, KEY_ITEMS.reset, tables.lines.keyDefault);
        if (picked) bar(game, x, KEY_ITEMS.reset, 0x3f, true);
      } else if (picked && (fresh & CHOOSE) !== 0) leaving = true;
      else {
        print(game, 0, picked ? 5 : 10, x, KEY_ITEMS.exit, tables.lines.keyExit);
        if (picked) bar(game, x, KEY_ITEMS.exit, 0x24, true);
      }
    }
    if (side.busy === 0) {
      const d = dy(game.pads.repeats[pad]!);
      if (d !== 0) sound(game, data, Sound.MOVE);
      side.cursor = wrap(0, side.cursor + d, 3);
    }
  });
  print(game, 1, titleColour(game), 0x4a, 0x28, tables.lines.keyConfig);
  if (((input.fresh[0]! | input.fresh[1]!) & SELECT) !== 0) leaving = true;
  if (!leaving || game.optionsScreen.sides.some((side) => side.busy !== 0)) return false;
  keyConfigReset(game, scenes);
  sound(game, data, Sound.BACK);
  return true;
}

/** How far the picture moves across for the display's place across. */
export function displayShift(x: number): number {
  return x < 0 ? -((-x * 0x5b) >> 6) : (x * 0x5b + 0x3f) >> 6;
}

/** DISPLAY ADJUST: the pads move the display's place (start puts it back); a button or select leaves. */
function displayAdjust(game: GameState, data: OptionsData, tables: OptionsTables): void {
  const fresh = game.world.input.fresh[0]! | game.world.input.fresh[1]!;
  const repeats = game.pads.repeats[0]! | game.pads.repeats[1]!;
  const display = game.options.display;
  if ((fresh & SELECT_OR_BUTTON) !== 0) {
    game.optionsScreen.page = Page.MAIN;
    sound(game, data, Sound.BACK);
  }
  let x = clamp(DISPLAY.left, display.x + dx(repeats), DISPLAY.right);
  let y = clamp(DISPLAY.top, display.y + dy(repeats), DISPLAY.bottom);
  if (fresh === START) {
    x = DISPLAY.x;
    y = DISPLAY.y;
    sound(game, data, Sound.DECIDE);
  } else if (x !== display.x || y !== display.y) sound(game, data, Sound.MOVE);
  display.x = x;
  display.y = y;
  const across = displayShift(x);
  const down = y * 2;
  print(game, 1, titleColour(game), 0x5b - across, 0x28 - down, tables.lines.display);
  twoColours(game, 0x22 - across, 0x17a - down, tables.lines.displayDefault, 2);
  twoColours(game, 0x22 - across, 0x19e - down, tables.lines.displayExit, 5);
  buttonRow(game, 0x9f - across, 0x19c - down, BARS);
  const { rx, ry, rw, rh, cx, cy, colour } = MARKS;
  tile(game, rx + 6, cy - 0x50, 2, 0xa0, colour, 0);
  tile(game, cx - 0x2e, ry + 10, 0x5c, 3, colour, 0);
  tile(game, rx + rw - 8, cy - 0x50, 2, 0xa0, colour, 0);
  tile(game, cx - 0x2e, ry + rh - 0xd, 0x5c, 3, colour, 0);
  tile(game, cx - 1, cy - 0x50, 2, 0xa0, colour, 0);
  tile(game, cx - 0x2e, cy - 1, 0x5c, 3, colour, 0);
}

/** The records' four lists as the page opens: the best times (the first ten and any set), survival's ten, the plays and the win averages (the characters earned). */
function recordsStart(game: GameState): void {
  const records = game.records;
  const list = game.optionsScreen.records;
  const earned = records.earnedRoster & UNLISTED & ((1 << CHARACTERS) - 1);
  let total = 0;
  for (let roster = 0; roster < CHARACTERS; roster += 1) total += playCount(game, roster);
  list.total = total;
  const fill = (k: number, pairs: [number, number][], count: number): void => {
    const into = list.lists[k]!;
    into.first = 0;
    into.count = count;
    pairs.forEach(([roster], i) => (into.order[i] = roster));
  };
  const rosters = (bits: number): number[] => Array.from({ length: CHARACTERS }, (_, roster) => roster).filter((roster) => ((bits >>> roster) & 1) !== 0);
  let timed = FIRST_TEN;
  records.times.forEach((time, roster) => {
    if (roster < CHARACTERS && time.frames >>> 0 <= NO_TIME) timed |= 1 << roster;
  });
  timed &= UNLISTED;
  const times = rosters(timed).map((roster): [number, number] => [roster, records.times[roster]!.frames >>> 0]);
  sortPairs(times, true);
  fill(0, times, popcount(timed));
  fill(1, Array.from({ length: RECORD_ROWS }, (_, i): [number, number] => [i, 0]), RECORD_ROWS);
  const plays = rosters(earned).map((roster): [number, number] => [roster, playCount(game, roster)]);
  sortPairs(plays, false);
  fill(2, plays, popcount(earned));
  const averages = rosters(earned).map((roster): [number, number] => {
    const [won, lost] = [records.plays[roster]![1]!, records.plays[roster]![2]!];
    return [roster, (share(won, won + lost) << 20) + won + lost];
  });
  sortPairs(averages, false);
  fill(3, averages, popcount(earned));
  list.list = 0;
}

/** A rank, as the records write it: its number and its ending. */
function rank(tables: OptionsTables, row: number): string {
  const tens = row % 10;
  return `${field(100 < row + 1 ? 99 : row + 1, 2)}${tables.lines.suffixes[3 < tens || (row - 10) >>> 0 < 10 ? 3 : tens]!}`;
}

/** A share in tenths of a percent, as the records write it (all of it in another colour). */
function rate(game: GameState, tables: OptionsTables, x: number, y: number, part: number): void {
  if (part === 0) print(game, 0, 6, x, y, tables.lines.none);
  else if (part === 1000) print(game, 0, 1, x, y, tables.lines.all);
  else print(game, 0, 6, x, y, `${field(Math.trunc(part / 10), 2)}.${(part % 10).toString(16)}%`);
}

/** A number right-aligned in `cells` places from x. */
function number(game: GameState, x: number, y: number, n: number, cells: number): void {
  const digits = Math.min(String(n).length, cells);
  print(game, 0, 6, x + (cells - digits) * ADVANCE, y, String(n).slice(-cells));
}

/** RECORDS: left and right turn the list, up and down scroll a long one; select or a button leaves (true). */
function recordsFrame(game: GameState, data: OptionsData, tables: OptionsTables): boolean {
  const fresh = game.world.input.fresh[0]! | game.world.input.fresh[1]!;
  const repeats = game.pads.repeats[0]! | game.pads.repeats[1]!;
  if ((fresh & SELECT_OR_BUTTON) !== 0) {
    sound(game, data, Sound.BACK);
    return true;
  }
  const records = game.optionsScreen.records;
  const across = dx(repeats);
  records.list = wrap(0, records.list + across, 3);
  if (across !== 0) sound(game, data, Sound.MOVE);
  const list = records.lists[records.list]!;
  let first = 0;
  if (RECORD_ROWS < list.count) {
    first = (list.first + dy(repeats)) >>> 0;
    if (!(first < list.count - (RECORD_ROWS - 1))) first = list.first;
    if (first !== list.first) sound(game, data, Sound.MOVE);
  }
  list.first = first;
  const lines = tables.lines;
  print(game, 0, 6, 0x75, 0x7e, lines.headers[records.list]!);
  const name = (roster: number): string => data.roster.codes[(roster % CHARACTERS) * 4]?.name ?? '';
  const rows = Math.min(list.count, RECORD_ROWS);
  for (let row = 0; row < rows; row += 1) {
    const i = list.first + row;
    const y = 0x92 + row * 0x14;
    print(game, 0, 6, 0x12, y, rank(tables, i));
    const roster = list.order[i]!;
    if (records.list === 1) {
      const survivor = game.records.survivors[roster]!;
      const named = name(survivor.roster);
      print(game, 0, 6, 0x7e - ((named.length * ADVANCE) >> 1), y, named);
      number(game, 0xc6, y, survivor.wins, 3);
      print(game, 0, 6, 0xc6 + 0x24, y, survivor.wins < 2 ? lines.win : lines.wins);
      print(game, 0, 6, 0x132, y, survivor.initials);
      continue;
    }
    const named = name(roster);
    print(game, 0, 6, 0x7e - ((named.length * ADVANCE) >> 1), y, named);
    if (records.list === 0) {
      const time = game.records.times[roster]!;
      const frames = (time.frames | 0) > 359999 ? 359999 : time.frames;
      const seconds = Math.trunc(frames / 60);
      print(game, 0, 6, 0xc6, y, `${two(Math.trunc(seconds / 60))}'${two(seconds % 60)}"${two(Math.trunc(((frames - seconds * 60) * 100) / 60))}`);
      print(game, 0, 6, 0x132, y, time.initials);
    } else if (records.list === 2) {
      const plays = playCount(game, roster);
      rate(game, tables, 0xe1, y, share(plays, records.total));
      number(game, 0x120, y, plays, 5);
    } else {
      const [won, lost] = [game.records.plays[roster]![1]!, game.records.plays[roster]![2]!];
      rate(game, tables, 0xab, y, share(won, won + lost));
      number(game, 0xea, y, won, 5);
      number(game, 0x120, y, lost, 5);
    }
  }
  print(game, 1, 6, 0x8b, 0x28, lines.records);
  const title = lines.titles[records.list]!;
  print(game, 0, 6, MESSAGE.centre - ((title.length * ADVANCE) >> 1), 0x5a, title);
  print(game, 0, 6, 0xe * ADVANCE, 2 * 18, `${lines.page}${(records.list + 1).toString(16)}`);
  twoColours(game, 0x3f, 0x17c, lines.next, 7);
  twoColours(game, 0x3f, 0x1a4, lines.exit, 2);
  buttonRow(game, 0xa1, 0x1a2, BARS);
  return false;
}

/** The page shown this frame, its input then its drawing. */
function pageFrame(game: GameState, data: OptionsData, scenes: SceneTables): void {
  const tables = scenes.options;
  const screen = game.optionsScreen;
  if (screen.page === ONLINE_PAGE) {
    /* A quick match or a room waited for in Practice, the waiting room's. */
    const asked = onlineFrame(game, data);
    if (asked === 'leave') game.step = 2;
    else if (asked === 'warm') {
      startMode(game, MenuMode.PRACTICE, 1);
      /* The waiting room's walls an online match's. */
      game.world.options.walls = wallsFor(MenuMode.PRACTICE, game.remake.settings.walls, true);
    }
    return;
  }
  if (screen.page === REMAKE_PAGE) {
    /* The list as the remaster leaves it, the cursor kept on it where a line has gone. */
    const remake = remakeOptions(game);
    screen.remake.cursor = Math.min(screen.remake.cursor, remake.items.length - 1);
    listInput(game, data, remake, screen.remake);
    const listed = remakeOptions(game);
    listDraw(game, listed, screen.remake);
    if (remasterMissing(game)) message(game, REMASTER_LINE, 5, remakeLineY(listed));
    else if (restartWanted(game)) message(game, RESTART_LINE, 5, remakeLineY(listed));
    return;
  }
  const page = tables.pages[screen.page];
  const state = screen.pages[screen.page];
  if (page === undefined || state === undefined) {
    game.step = 2;
    return;
  }
  switch (screen.page) {
    case Page.MAIN:
      listInput(game, data, mainPage(page), state);
      listDraw(game, mainPage(page), state);
      break;
    case Page.GAME:
      listInput(game, data, page, state);
      modeBox(game, tables, page.items[state.cursor]!.modes);
      listDraw(game, page, state);
      break;
    case Page.RECORDS:
      if (state.sub === 0) {
        recordsStart(game);
        state.sub += 1;
      }
      if (recordsFrame(game, data, tables)) {
        state.sub = 0;
        screen.page = Math.max(page.cancel, Page.MAIN);
      }
      break;
    case Page.CARD:
      cardPage(game, data, tables, page);
      break;
    case Page.KEYS:
      if (keyConfigFrame(game, data, scenes)) screen.page = Page.MAIN;
      break;
    case Page.DISPLAY:
      displayAdjust(game, data, tables);
      break;
  }
}

/** Scene 5. */
export function optionsScene(game: GameState, data: OptionsData, scenes: SceneTables): void {
  const world = game.world;
  const screen = game.optionsScreen;
  world.vibrations.length = 0;
  const card = screen.pages[Page.CARD]!;
  if (screen.page !== Page.CARD || card.sub === CardScreen.LIST || card.sub === CardScreen.AUTO_SAVE) {
    /* Checked as any mode's, so start alone (the demo's way) never leaves. */
    const mode = world.mode;
    world.mode = 0;
    const reset = softReset(game, data);
    world.mode = mode;
    if (reset) return;
  }
  switch (game.step) {
    case 0:
      game.menu.toOptions = game.online.opens !== 0 ? BACK_FROM_ONLINE : 1;
      listLabels(game, scenes.options);
      keyConfigReset(game, scenes);
      for (const page of [...screen.pages, screen.remake]) Object.assign(page, { cursor: 0, sub: 0 });
      screen.page = game.online.opens !== 0 ? ONLINE_PAGE : Page.MAIN;
      game.online.opens = 0;
      game.step = 1;
      pageFrame(game, data, scenes);
      break;
    case 1:
      pageFrame(game, data, scenes);
      break;
    case 2:
      goToLogo(game, Scene.MENU);
      break;
  }
}
