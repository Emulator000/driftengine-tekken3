/**
 * ONLINE MODE's page, on the Options' screen and in its look (its title, its list, the pulsing bar
 * under the line picked, the line under the list): a quick match, a room created (private, its code
 * to give the other player, or listed in the server's room list), a room joined by its code or from
 * the list, the input delay asked for, this player's name and the server's address. What the
 * player asks for is left in `ask` for the page (the app), which tells it how the connection goes
 * (`status`, `lines`, `rooms`); while it waits, the page shows so, select going back. The code, the
 * name and the address are entered with the pad (up and down through the letters, left and right
 * along), or typed, pasted and selected with a keyboard and a mouse, which the page edits them by
 * (the caret, `anchor` the selection's other end), giving this only Enter and Escape (`typed`).
 */
import type { FightData } from '../fight/state.ts';
import { voiceLine } from '../fight/voices.ts';
import { tile } from './draw.ts';
import { print } from './printer.ts';
import type { GameState } from './state.ts';

/** The page's number among the Options' (past REMAKE OPTION's). */
export const ONLINE_PAGE = 0x11;

/** The connection as the page tells it. */
export const OnlineStatus = { OFF: 0, CONNECTING: 1, LOBBY: 2, QUEUED: 3, HOSTING: 4, JOINING: 5, GREETING: 6, PLAYING: 7, OFFERED: 8, RESULT: 9 } as const;

/** The page's screens: its list, the wait, the code's entry, the room list, a text's entry. */
export const OnlineScreen = { LIST: 0, WAIT: 1, CODE: 2, ROOMS: 3, TEXT: 4 } as const;

/** The text being entered on the text screen. */
export const Editing = { NONE: 0, NAME: 1, SERVER: 2 } as const;

/** The input delay's most, and the default. */
export const MOST_DELAY = 6;
export const DEFAULT_DELAY = 2;

/** Room codes: the server's letters, and their count. */
export const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 4;
const NAME_LETTERS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-';
const SERVER_LETTERS = 'abcdefghijklmnopqrstuvwxyz0123456789.:/-_';
const NAME_LENGTH = 12;
const SERVER_LENGTH = 96;
/** The rooms the room list shows at once. */
const ROOM_ROWS = 8;

/** The keys a keyboard gives the page while a text is entered: confirm, go back (the editing itself is the page's own). */
export const TYPED_ENTER = '\n';
export const TYPED_ESCAPE = '\x1b';

/** A room the room list shows. */
export interface OnlineRoom {
  readonly code: string;
  readonly title: string;
  readonly host: string;
  readonly locked: boolean;
  readonly same: boolean;
}

/** The page's state: its own (screens, cursors, text, settings) and what the app tells it and is asked. */
export interface OnlineState {
  screen: number;
  cursor: number;
  roomCursor: number;
  /** The text's caret, the selection's other end (the caret's own place with none), and the first letter shown. */
  caret: number;
  anchor: number;
  scroll: number;
  editing: number;
  code: string;
  text: string;
  delay: number;
  listed: number;
  /** The side this player's fighter is seen on in an online match: 0 the left, 1 the right. */
  side: number;
  name: string;
  server: string;
  /** What the player asked for this field ('' nothing), for the app. */
  ask: string;
  /** Enter and Escape as a keyboard gave them since the last field (the page's own editing changes the text itself). */
  typed: string;
  status: number;
  /** The lines under the list, and the wait's, as the app words them. */
  lines: string[];
  rooms: OnlineRoom[];
  /** Whether the Options open on this page (the menu's ONLINE MODE). */
  opens: number;
  /**
   * The waiting room's practice (a quick match or a room waited for): 0 none, 1 its character
   * chosen (what is asked for, `pending`, asked as its fight starts), 2 its fight waiting; the
   * offer's time left (1 to 0) and this player's answer (0 none, 1 yes, 2 no), as the app tells them.
   */
  warming: number;
  pending: string;
  offerLeft: number;
  answer: number;
  /** Fields the offer's card has shown: a press answers it only once it has settled. */
  card: number;
}

export function blankOnline(): OnlineState {
  return { screen: OnlineScreen.LIST, cursor: 0, roomCursor: 0, caret: 0, anchor: 0, scroll: 0, editing: Editing.NONE, code: '', text: '', delay: DEFAULT_DELAY, listed: 0, side: 0, name: 'PLAYER', server: '', ask: '', typed: '', status: OnlineStatus.OFF, lines: [], rooms: [], opens: 0, warming: 0, pending: '', offerLeft: 0, answer: 0, card: 0 };
}

/** Whether a text is being entered: the keyboard types for the page then, not for the pads. */
export const typing = (game: GameState): boolean => game.online.screen === OnlineScreen.CODE || game.online.screen === OnlineScreen.TEXT;

/* The Options' look and buttons. */
const SELECT = 0x100;
const CHOOSE = 0x8f0;
const START = 0x800;
const L1 = 0x04;
const R1 = 0x08;
const UP = 0x1000;
const DOWN = 0x4000;
const RIGHT = 0x2000;
const LEFT = 0x8000;
const Sound = { MOVE: 0x546c, BACK: 0x4ceb, DECIDE: 0x4d87 } as const;
const ADVANCE = 9;
const TITLE_ADVANCE = 13;
const BARS = 4;
const BAR = { colour: 0xff4020, height: 0x16, margin: 3 } as const;
/** The selected letters' ground: a warm orange (0xBBGGRR), clear on the Options' blue. */
const SELECTED = 0x1868d8;
const LIST = { x: 20, y: 84, step: 26, width: 324 } as const;
/** The text's line on the text screen (its letters, its window's left and line), and the code's boxes. */
const TEXT_BOX = { cells: 36, left: 0xb8 - ((36 * 9) >> 1), y: 196, height: 22 } as const;
const CODE_BOX = { cell: 40, left: 0xb8 - 80, y: 194 } as const;
const CENTRE = 0xb8;
const TITLE_Y = 40;
const LINES_Y = 344;
const LINE_STEP = 20;
const Colour = { ITEM: 10, PICKED: 5, VALUE: 6, DEFAULT: 1, LINE: 6, WARN: 5, GREY: 9 } as const;

const Item = { QUICK: 0, HOST: 1, JOIN: 2, ROOMS: 3, DELAY: 4, ROOM: 5, SIDE: 6, NAME: 7, SERVER: 8, EXIT: 9 } as const;
const LABELS = ['QUICK MATCH', 'CREATE ROOM', 'JOIN ROOM', 'ROOM LIST', 'INPUT DELAY', 'ROOM', 'SIDE', 'NAME', 'SERVER', 'EXIT'] as const;
const ROOM_KINDS = ['PRIVATE', 'LISTED'] as const;
/** The side this player's fighter is seen on in an online match, whichever the server seats them: the other side's view mirrored. */
const SIDES = ['LEFT', 'RIGHT'] as const;

const WAITING = new Set<number>([OnlineStatus.CONNECTING, OnlineStatus.QUEUED, OnlineStatus.OFFERED, OnlineStatus.RESULT, OnlineStatus.HOSTING, OnlineStatus.JOINING, OnlineStatus.GREETING, OnlineStatus.PLAYING]);

type Data = Pick<FightData, 'sound'>;

const sound = (game: GameState, data: Data, code: number): void => voiceLine(game.world, data, 0, code, 0);
const triangle = (v: number): number => {
  v &= 0x1ff;
  return 0xff < v ? 0x1ff - v : v;
};
const scaled = (colour: number, level: number): number => [0, 8, 16].reduce((out, shift) => out | (Math.min((((colour >> shift) & 0xff) * level) >> 8, 0xff) << shift), 0);

function bar(game: GameState, x: number, y: number, w: number): void {
  tile(game, x - BAR.margin, y - BAR.margin, w + BAR.margin * 2, BAR.height, scaled(BAR.colour, (triangle(game.world.vsyncSeen << 4) >> 1) + 0x80), BARS);
}

const centred = (game: GameState, colour: number, y: number, text: string, font = 0): void => {
  print(game, font, colour, CENTRE - ((text.length * (font === 0 ? ADVANCE : TITLE_ADVANCE)) >> 1), y, text);
};

const title = (game: GameState, text: string): void => centred(game, game.options.otherTitle !== 0 ? 1 : 6, TITLE_Y, text, 1);

/**
 * A line of prompts, a button and what it does each, centred on `centre`: each button's word a run of
 * its own, as the page names a keyboard's keys by a run that is START or SELECT alone.
 */
function prompts(game: GameState, colour: number, centre: number, y: number, pairs: readonly (readonly [string, string])[]): void {
  const parts = pairs.map(([button, does]) => [button, `  ${does}`] as const);
  const cells = parts.reduce((n, [button, does], i) => n + button.length + does.length + (i === 0 ? 0 : 5), 0);
  let x = centre - ((cells * ADVANCE) >> 1);
  parts.forEach(([button, does], i) => {
    if (i !== 0) x += 5 * ADVANCE;
    print(game, 0, colour, x, y, button);
    x += button.length * ADVANCE;
    print(game, 0, colour, x, y, does);
    x += does.length * ADVANCE;
  });
}

/** At most `cells` of a text, its end kept (an address's end tells most). */
const fit = (text: string, cells: number): string => (text.length <= cells ? text : `..${text.slice(text.length - cells + 2)}`);

/**
 * One field of the page: its input, then its drawing. 'leave' once the player leaves it (EXIT, or
 * select on its list), 'warm' once a quick match or a room is asked for (the waiting room's
 * practice to start), else null.
 */
export function onlineFrame(game: GameState, data: Data): 'leave' | 'warm' | null {
  const online = game.online;
  const typed = online.typed;
  online.typed = '';
  if (online.screen === OnlineScreen.WAIT && !WAITING.has(online.status)) online.screen = OnlineScreen.LIST;
  switch (online.screen) {
    case OnlineScreen.WAIT:
      waitFrame(game, data);
      return null;
    case OnlineScreen.CODE:
      return codeFrame(game, data, typed) ? warmUp(online, 'join') : null;
    case OnlineScreen.ROOMS:
      return roomsFrame(game, data) ? warmUp(online, 'join') : null;
    case OnlineScreen.TEXT:
      textFrame(game, data, typed);
      return null;
    default:
      return listFrame(game, data);
  }
}

function pads(game: GameState): { fresh: number; repeats: number } {
  return { fresh: game.world.input.fresh[0]! | game.world.input.fresh[1]!, repeats: game.pads.repeats[0]! | game.pads.repeats[1]! };
}

function listFrame(game: GameState, data: Data): 'leave' | 'warm' | null {
  const online = game.online;
  const { fresh, repeats } = pads(game);
  const count = LABELS.length;
  const down = ((repeats & DOWN) !== 0 ? 1 : 0) - ((repeats & UP) !== 0 ? 1 : 0);
  const across = ((repeats & RIGHT) !== 0 ? 1 : 0) - ((repeats & LEFT) !== 0 ? 1 : 0);
  if (down !== 0) {
    online.cursor = (online.cursor + down + count) % count;
    sound(game, data, Sound.MOVE);
  }
  if (across !== 0 && online.cursor === Item.DELAY) {
    online.delay = (online.delay + across + MOST_DELAY + 1) % (MOST_DELAY + 1);
    sound(game, data, Sound.MOVE);
  }
  if (across !== 0 && online.cursor === Item.ROOM) {
    online.listed ^= 1;
    sound(game, data, Sound.MOVE);
  }
  if (across !== 0 && online.cursor === Item.SIDE) {
    online.side ^= 1;
    sound(game, data, Sound.MOVE);
  }
  let leave = (fresh & SELECT) !== 0;
  let warm = false;
  if ((fresh & CHOOSE) !== 0) {
    switch (online.cursor) {
      case Item.QUICK:
        online.pending = 'quick';
        online.screen = OnlineScreen.WAIT;
        warm = true;
        break;
      case Item.HOST:
        online.pending = online.listed !== 0 ? 'host listed' : 'host';
        online.screen = OnlineScreen.WAIT;
        warm = true;
        break;
      case Item.JOIN:
        Object.assign(online, { code: '', caret: 0, anchor: 0 });
        online.screen = OnlineScreen.CODE;
        break;
      case Item.ROOMS:
        online.ask = 'rooms';
        online.roomCursor = 0;
        online.screen = OnlineScreen.ROOMS;
        break;
      case Item.NAME:
      case Item.SERVER:
        online.editing = online.cursor === Item.NAME ? Editing.NAME : Editing.SERVER;
        online.text = online.editing === Editing.NAME ? online.name : online.server;
        Object.assign(online, { caret: online.text.length, anchor: 0, scroll: 0 });
        online.screen = OnlineScreen.TEXT;
        break;
      case Item.EXIT:
        leave = true;
        break;
    }
    if (online.cursor !== Item.DELAY && online.cursor !== Item.ROOM && online.cursor !== Item.SIDE) sound(game, data, leave ? Sound.BACK : Sound.DECIDE);
  } else if (leave) sound(game, data, Sound.BACK);
  if (leave) online.ask = 'leave';
  title(game, 'ONLINE MODE');
  let y = LIST.y;
  LABELS.forEach((label, i) => {
    const picked = i === online.cursor;
    if (picked) bar(game, LIST.x, y, i <= Item.ROOMS || i === Item.EXIT ? label.length * ADVANCE : LIST.width);
    print(game, 0, picked ? Colour.PICKED : Colour.ITEM, LIST.x, y, label);
    const value = i === Item.DELAY ? String(online.delay) : i === Item.ROOM ? ROOM_KINDS[online.listed]! : i === Item.SIDE ? SIDES[online.side]! : i === Item.NAME ? online.name : i === Item.SERVER ? fit(online.server.toUpperCase(), 22) : '';
    const byDefault = (i === Item.DELAY && online.delay === DEFAULT_DELAY) || (i === Item.ROOM && online.listed === 0) || (i === Item.SIDE && online.side === 0);
    if (value !== '') print(game, 0, byDefault ? Colour.DEFAULT : Colour.VALUE, LIST.x + LIST.width - value.length * ADVANCE, y, value);
    y += LIST.step;
  });
  online.lines.slice(0, 4).forEach((line, i) => centred(game, i === 0 ? Colour.LINE : Colour.WARN, LINES_Y + i * LINE_STEP, line));
  if (warm) return warmUp(online, online.pending);
  return leave ? 'leave' : null;
}

/** The waiting room asked for: its character chosen first, then `pending` asked for (a quick match, a room, a room joined) as its fight starts. */
function warmUp(online: OnlineState, pending: string): 'warm' {
  Object.assign(online, { warming: 1, pending, answer: 0, screen: OnlineScreen.WAIT });
  return 'warm';
}

/** The wait: the app's lines, the dots going on; select goes back to the list. */
function waitFrame(game: GameState, data: Data): void {
  const online = game.online;
  const { fresh } = pads(game);
  if ((fresh & SELECT) !== 0) {
    online.ask = 'cancel';
    online.screen = OnlineScreen.LIST;
    sound(game, data, Sound.BACK);
  }
  title(game, 'ONLINE MODE');
  const dots = '.'.repeat((game.world.vsyncSeen >> 4) & 3);
  online.lines.slice(0, 6).forEach((line, i) => {
    const text = i === 0 ? `${line}${dots}`.padEnd(line.length + 3, ' ') : line;
    centred(game, i === 0 ? Colour.PICKED : Colour.LINE, 150 + i * 34, text, i === 1 && online.status === OnlineStatus.HOSTING ? 1 : 0);
  });
  prompts(game, Colour.ITEM, CENTRE, 400, [['SELECT', 'CANCEL']]);
}

/**
 * The code: up and down through its letters at the caret, left and right along it, or typed, pasted
 * and selected as a keyboard and a mouse edit text (the page's, `anchor` the selection's other end);
 * complete, a button or Enter joins.
 */
function codeFrame(game: GameState, data: Data, typed: string): boolean {
  const online = game.online;
  const { fresh, repeats } = pads(game);
  let code = online.code.slice(0, CODE_LENGTH);
  let caret = Math.min(online.caret, code.length, CODE_LENGTH);
  let anchor = Math.min(online.anchor, code.length);
  const back = (fresh & SELECT) !== 0 || typed.includes(TYPED_ESCAPE);
  const done = (fresh & CHOOSE) !== 0 || typed.includes(TYPED_ENTER);
  const cellOf = (at: number): number => Math.min(at, CODE_LENGTH - 1);
  const step = ((repeats & UP) !== 0 ? 1 : 0) - ((repeats & DOWN) !== 0 ? 1 : 0);
  if (step !== 0) {
    const cell = cellOf(caret);
    const at = CODE_LETTERS.indexOf(code[cell] ?? '');
    const next = CODE_LETTERS[at < 0 ? (step > 0 ? 0 : CODE_LETTERS.length - 1) : (at + step + CODE_LETTERS.length) % CODE_LETTERS.length]!;
    code = (code.padEnd(cell, CODE_LETTERS[0]!).slice(0, cell) + next + code.slice(cell + 1)).slice(0, CODE_LENGTH);
    caret = cell;
    anchor = caret;
    sound(game, data, Sound.MOVE);
  }
  const across = ((repeats & RIGHT) !== 0 ? 1 : 0) - ((repeats & LEFT) !== 0 ? 1 : 0);
  if (across !== 0) {
    caret = Math.max(0, Math.min(CODE_LENGTH - 1, code.length, cellOf(caret) + across));
    anchor = caret;
    sound(game, data, Sound.MOVE);
  }
  Object.assign(online, { code, caret, anchor });
  if (back) {
    online.screen = OnlineScreen.LIST;
    sound(game, data, Sound.BACK);
  }
  const joined = !back && done && code.length === CODE_LENGTH;
  if (joined) sound(game, data, Sound.DECIDE);
  title(game, 'JOIN ROOM');
  centred(game, Colour.LINE, 130, 'ENTER THE ROOM CODE');
  const [from, to] = [Math.min(anchor, caret), Math.max(anchor, caret)];
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    const x = CODE_BOX.left + i * CODE_BOX.cell;
    const picked = from < to ? from <= i && i < to : i === cellOf(caret);
    if (picked) bar(game, x + 6, CODE_BOX.y + 2, CODE_BOX.cell - 12);
    tile(game, x + 4, CODE_BOX.y + 28, CODE_BOX.cell - 8, 3, 0xc0c0c0, BARS);
    print(game, 1, picked ? Colour.PICKED : Colour.VALUE, x + ((CODE_BOX.cell - TITLE_ADVANCE) >> 1), CODE_BOX.y, code[i] ?? '');
  }
  centred(game, Colour.ITEM, 300, 'UP DOWN  LETTER   LEFT RIGHT  MOVE');
  centred(game, code.length === CODE_LENGTH ? Colour.PICKED : Colour.GREY, 340, 'BUTTON  JOIN');
  prompts(game, Colour.ITEM, CENTRE, 400, [['SELECT', 'BACK']]);
  return joined;
}

/** The rooms the server lists: up and down to pick, a button to join one of the same game, select back. */
function roomsFrame(game: GameState, data: Data): boolean {
  const online = game.online;
  const { fresh, repeats } = pads(game);
  const rooms = online.rooms;
  const down = ((repeats & DOWN) !== 0 ? 1 : 0) - ((repeats & UP) !== 0 ? 1 : 0);
  if (down !== 0 && rooms.length > 0) {
    online.roomCursor = (online.roomCursor + down + rooms.length) % rooms.length;
    sound(game, data, Sound.MOVE);
  }
  online.roomCursor = Math.min(online.roomCursor, Math.max(0, rooms.length - 1));
  const room = rooms[online.roomCursor];
  if ((fresh & SELECT) !== 0) {
    online.ask = 'unlist';
    online.screen = OnlineScreen.LIST;
    sound(game, data, Sound.BACK);
  }
  const joined = (fresh & SELECT) === 0 && (fresh & CHOOSE) !== 0 && room !== undefined && room.same && !room.locked;
  if (joined) {
    online.code = room.code;
    online.ask = 'unlist';
    sound(game, data, Sound.DECIDE);
  }
  title(game, 'ROOM LIST');
  if (rooms.length === 0) centred(game, Colour.LINE, 200, online.status === OnlineStatus.LOBBY ? 'NO ROOMS ARE LISTED' : 'CONNECTING');
  const first = Math.max(0, Math.min(online.roomCursor - (ROOM_ROWS >> 1), rooms.length - ROOM_ROWS));
  rooms.slice(first, first + ROOM_ROWS).forEach((one, row) => {
    const y = 90 + row * 30;
    const picked = first + row === online.roomCursor;
    const open = one.same && !one.locked;
    if (picked) bar(game, LIST.x, y, LIST.width);
    const colour = !open ? Colour.GREY : picked ? Colour.PICKED : Colour.ITEM;
    print(game, 0, colour, LIST.x, y, one.code);
    print(game, 0, colour, LIST.x + 6 * ADVANCE, y, fit(one.title, 19));
    const side = !one.same ? 'OTHER DATA' : one.locked ? 'LOCKED' : one.host;
    print(game, 0, open ? Colour.VALUE : Colour.GREY, LIST.x + LIST.width - side.length * ADVANCE, y, side);
  });
  prompts(game, Colour.ITEM, CENTRE, 400, [['BUTTON', 'JOIN'], ['SELECT', 'BACK']]);
  return joined;
}

/**
 * A name or the server's address: up and down through the letters at the caret, left and right
 * along it, or typed, pasted and selected as a keyboard and a mouse edit text (the page's, `anchor`
 * the selection's other end); a button or Enter keeps it, select or Escape leaves it.
 */
function textFrame(game: GameState, data: Data, typed: string): void {
  const online = game.online;
  const { fresh, repeats } = pads(game);
  const name = online.editing === Editing.NAME;
  const letters = name ? NAME_LETTERS : SERVER_LETTERS;
  const most = name ? NAME_LENGTH : SERVER_LENGTH;
  let text = online.text.slice(0, most);
  let caret = Math.min(online.caret, text.length);
  let anchor = Math.min(online.anchor, text.length);
  const back = (fresh & SELECT) !== 0 || typed.includes(TYPED_ESCAPE);
  const done = !back && ((fresh & CHOOSE) !== 0 || typed.includes(TYPED_ENTER));
  const step = ((repeats & UP) !== 0 ? 1 : 0) - ((repeats & DOWN) !== 0 ? 1 : 0);
  if (step !== 0 && caret < most) {
    const at = letters.indexOf(text[caret] ?? '');
    const next = letters[at < 0 ? (step > 0 ? 0 : letters.length - 1) : (at + step + letters.length) % letters.length]!;
    text = text.slice(0, caret) + next + text.slice(caret + 1);
    anchor = caret;
    sound(game, data, Sound.MOVE);
  }
  const across = ((repeats & RIGHT) !== 0 ? 1 : 0) - ((repeats & LEFT) !== 0 ? 1 : 0);
  if (across !== 0) {
    caret = Math.max(0, Math.min(text.length, most - 1, caret + across));
    anchor = caret;
    sound(game, data, Sound.MOVE);
  }
  /* The window over a text longer than it, moved to keep the caret in it. */
  let scroll = Math.min(online.scroll, Math.max(0, text.length - TEXT_BOX.cells + 1));
  if (caret < scroll) scroll = caret;
  if (scroll + TEXT_BOX.cells - 1 < caret) scroll = caret - TEXT_BOX.cells + 1;
  Object.assign(online, { text, caret, anchor, scroll });
  if (back) {
    online.screen = OnlineScreen.LIST;
    sound(game, data, Sound.BACK);
  } else if (done) {
    if (name) online.name = text.trim() === '' ? 'PLAYER' : text.trim();
    else online.server = text.trim();
    online.ask = name ? 'name' : 'server';
    online.screen = OnlineScreen.LIST;
    sound(game, data, Sound.DECIDE);
  }
  title(game, name ? 'NAME' : 'SERVER');
  centred(game, Colour.LINE, 130, name ? 'YOUR NAME AS OTHERS SEE IT' : "THE SERVER'S ADDRESS");
  const shown = text.slice(scroll, scroll + TEXT_BOX.cells);
  const [from, to] = [Math.max(Math.min(anchor, caret), scroll), Math.min(Math.max(anchor, caret), scroll + TEXT_BOX.cells)];
  if (from < to) tile(game, TEXT_BOX.left + (from - scroll) * ADVANCE - 1, TEXT_BOX.y - 2, (to - from) * ADVANCE + 2, TEXT_BOX.height, SELECTED, BARS);
  else if ((game.world.vsyncSeen & 0x10) === 0) tile(game, TEXT_BOX.left + (caret - scroll) * ADVANCE, TEXT_BOX.y + 18, ADVANCE - 1, 3, BAR.colour, BARS);
  print(game, 0, Colour.VALUE, TEXT_BOX.left, TEXT_BOX.y, shown);
  if (!name) centred(game, Colour.ITEM, 250, 'EMPTY: THE ONE THIS PAGE CAME FROM');
  centred(game, Colour.ITEM, 290, 'TYPE OR PASTE IT');
  centred(game, Colour.ITEM, 316, 'UP DOWN  LETTER   LEFT RIGHT  MOVE');
  centred(game, Colour.ITEM, 360, 'BUTTON  KEEP');
  prompts(game, Colour.ITEM, CENTRE, 400, [['SELECT', 'BACK']]);
}

/**
 * Where a point of the screen (in its units) puts the caret in the text being entered: the gap
 * between letters nearest it, on the text's line; null off it, or on no screen with text.
 */
export function caretAt(game: GameState, x: number, y: number): number | null {
  const online = game.online;
  if (online.screen === OnlineScreen.TEXT) {
    if (y < TEXT_BOX.y - 8 || TEXT_BOX.y + TEXT_BOX.height + 8 < y) return null;
    const at = online.scroll + Math.round((x - TEXT_BOX.left) / ADVANCE);
    return Math.max(online.scroll, Math.min(online.text.length, online.scroll + TEXT_BOX.cells, at));
  }
  if (online.screen === OnlineScreen.CODE) {
    if (y < CODE_BOX.y - 8 || CODE_BOX.y + 40 < y) return null;
    const at = Math.round((x - CODE_BOX.left) / CODE_BOX.cell);
    return Math.max(0, Math.min(online.code.length, at));
  }
  return null;
}

/* ---- The waiting room: practice while a quick match or a room is waited for. ---- */

/** The offer's card, centred on the screen of the scene under it (`centre`): its box, its lines, its bar. */
const CARD = { half: 184, top: 168, height: 150, bar: 252, barHalf: 120 } as const;
/** Fields the card shows before a press answers it: a press meant for the fight or the select under it does not. */
const CARD_SETTLE = 30;

/**
 * A field of the waiting room's practice, before its scene: 'leave' once nothing is waited for any
 * more (the match was refused or is over, the queue left), the page then shown again; 'hold' while
 * an opponent found is offered or greeted, the practice held under its card, which start answers yes
 * and select no (the buttons the fight does not fight with); else null, the practice playing on, in its fight what is
 * waited for at the foot of the screen. `centre` is the middle of the scene's screen, in its units
 * (the fight's are wider), `fight` whether that scene is the fight.
 */
export function warmUpFrame(game: GameState, data: Data, centre: number, place: 'fight' | 'select' | 'other'): 'leave' | 'hold' | null {
  const online = game.online;
  /* Nothing is waited for while the character is chosen; on the select, L1 and R1 choose the side it is seen on. */
  if (online.warming === 1) {
    if (place === 'select') sideFrame(game, data, centre);
    return null;
  }
  const fight = place === 'fight';
  if (!WAITING.has(online.status)) {
    online.warming = 0;
    online.opens = 1;
    online.screen = OnlineScreen.LIST;
    return 'leave';
  }
  if (online.status === OnlineStatus.OFFERED || online.status === OnlineStatus.GREETING || online.status === OnlineStatus.RESULT) {
    offerCard(game, data, centre);
    return 'hold';
  }
  online.card = 0;
  if (!fight) return null;
  const [line = '', detail = ''] = online.lines;
  const hosting = online.status === OnlineStatus.HOSTING;
  const text = `${line}${'.'.repeat((game.world.vsyncSeen >> 4) & 3)}`.padEnd(line.length + 3, ' ');
  print(game, 0, Colour.PICKED, centre * 2 - 12 - text.length * ADVANCE, hosting ? 416 : 434, text);
  if (hosting) print(game, 0, Colour.VALUE, centre * 2 - 12 - detail.length * ADVANCE, 434, detail);
  return null;
}

/** The side this player's fighter is seen on in the match, on the waiting room's select: L1 the left, R1 the right. */
function sideFrame(game: GameState, data: Data, centre: number): void {
  const online = game.online;
  const fresh = game.world.input.fresh[0]! | game.world.input.fresh[1]!;
  const side = (fresh & L1) !== 0 ? 0 : (fresh & R1) !== 0 ? 1 : online.side;
  if (side !== online.side) {
    online.side = side;
    sound(game, data, Sound.MOVE);
  }
  const line = `L1  SIDE  ${SIDES[online.side]}  R1`;
  print(game, 0, Colour.PICKED, centre - ((line.length * ADVANCE) >> 1), 456, line);
}

/**
 * The card's answers, a row each under the bar: the buttons' words to the right of a column, what
 * each does to its left, the column centred on the card (a keyboard's longer name for a button is
 * fitted to its word's room).
 */
function answers(game: GameState, centre: number, y: number, rows: readonly (readonly [string, string])[]): void {
  const buttons = Math.max(...rows.map(([button]) => button.length));
  const does = Math.max(...rows.map(([, what]) => what.length));
  const left = centre - (((buttons + 2 + does) * ADVANCE) >> 1);
  rows.forEach(([button, what], i) => {
    print(game, 0, Colour.ITEM, left + (buttons - button.length) * ADVANCE, y + i * ANSWER_ROW, button);
    print(game, 0, Colour.ITEM, left + (buttons + 2) * ADVANCE, y + i * ANSWER_ROW, what);
  });
}

/** The card's rows of answers, apart. */
const ANSWER_ROW = 20;

/**
 * The card over the held practice: an opponent found (asking yes or no, the offer's time running
 * down), greeted (the match starting), or a match's result (asking for a rematch or the waiting
 * room, its time running down). Start and select answer, the buttons the waiting fight does not
 * fight with, once the card has settled.
 */
function offerCard(game: GameState, data: Data, centre: number): void {
  const online = game.online;
  const result = online.status === OnlineStatus.RESULT;
  const asking = result || online.status === OnlineStatus.OFFERED;
  online.card = asking ? online.card + 1 : 0;
  if (asking && online.answer === 0 && CARD_SETTLE < online.card) {
    const fresh = game.world.input.fresh[0]! | game.world.input.fresh[1]!;
    if ((fresh & START) !== 0) {
      online.ask = result ? 'rematch' : 'accept';
      online.answer = 1;
      sound(game, data, Sound.DECIDE);
    } else if ((fresh & SELECT) !== 0) {
      online.ask = result ? 'no rematch' : 'decline';
      online.answer = 2;
      sound(game, data, Sound.BACK);
    }
  }
  const [first = '', second = ''] = online.lines;
  const at = (text: string, y: number, colour: number, font = 0): void => {
    print(game, font, colour, centre - ((text.length * (font === 0 ? ADVANCE : TITLE_ADVANCE)) >> 1), y, text);
  };
  at(result ? first : 'OPPONENT FOUND', CARD.top + 14, game.options.otherTitle !== 0 ? 1 : 6, 1);
  at(second, CARD.top + 50, Colour.PICKED, 1);
  if (asking) {
    tile(game, centre - CARD.barHalf, CARD.bar, Math.max(0, Math.round(CARD.barHalf * 2 * online.offerLeft)), 6, BAR.colour, 6);
    tile(game, centre - CARD.barHalf, CARD.bar, CARD.barHalf * 2, 6, 0x303030, 5);
    if (online.answer === 0) {
      if (CARD_SETTLE < online.card) answers(game, centre, CARD.top + 102, result ? [['START', 'REMATCH'], ['SELECT', 'WAITING ROOM']] : [['START', 'FIGHT THEM'], ['SELECT', 'NOT THIS ONE']]);
    } else if (result) at(online.answer === 1 ? 'A REMATCH  WAITING FOR THEM' : 'BACK TO THE WAITING ROOM', CARD.top + 112, Colour.VALUE);
    else at(online.answer === 1 ? 'YOU SAID YES  WAITING FOR THEM' : 'YOU SAID NO', CARD.top + 112, Colour.VALUE);
  } else at('THE MATCH IS STARTING', CARD.top + 100, Colour.VALUE);
  tile(game, centre - CARD.half, CARD.top, CARD.half * 2, CARD.height, 0x000000, 5);
  tile(game, centre - CARD.half - 2, CARD.top - 2, CARD.half * 2 + 4, CARD.height + 4, 0xc0c0c0, 5);
}
