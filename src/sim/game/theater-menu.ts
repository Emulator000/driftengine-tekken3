/**
 * The Theater mode's menu (scene 0x13 from the mode menu): the movies' page, a grid of six across
 * of the game's movies (each open once its ending is seen, the opening and the arcade's always),
 * a movie chosen played whole and the menu back; and the music page, the game's songs in a list
 * (the arrangement's or the arcade's, BGM SELECT turning between them), a song chosen played once.
 * The movies' page goes to the music page once every movie is open. Over each page the title
 * holds until no button has been held for eight seconds, then turns with the line to play. EXIT
 * or select leaves for the mode menu. The remake reads the Tekken 3 disc alone, so the DISC button
 * (for the Tekken and Tekken 2 discs' movies and music) is left out.
 */
import type { SceneTables, TheaterBox, TheaterMovie, TheaterTables } from '../data/scenes.ts';
import type { FightData } from '../fight/state.ts';
import { playTheaterSong, stopMusic, voiceLine } from '../fight/voices.ts';
import { draw, tile } from './draw.ts';
import { print } from './printer.ts';
import type { GameState } from './state.ts';

export type TheaterData = Pick<FightData, 'sound' | 'music'>;

/** The menu's pages. */
export const TheaterPage = { MOVIES: 1, REMIXED: 2, ARCADE: 3 } as const;
/** What has the focus: the list, EXIT, MUSIC (on the music page THEATER), BGM SELECT. */
const Focus = { LIST: 0, EXIT: 1, OTHER_PAGE: 2, BGM: 4 } as const;
/** What a frame's input asks: nothing, play the chosen movie or song, leave. */
export const TheaterChoice = { NONE: 0, PLAY: 1, LEAVE: 4 } as const;

const UP = 0x1000;
const RIGHT = 0x2000;
const DOWN = 0x4000;
const LEFT = 0x8000;
const SELECT = 0x100;
const CHOOSE = 0x8f0;
const MOVE_SOUND = 0x546c;
const CHOOSE_SOUND = 0x4ceb;
/** The grid's columns and the rows it shows; the music list's rows. */
const COLUMNS = 6;
const GRID_ROWS = 4;
const SONG_ROWS = 14;
/** An entry: open (its movie), closed, empty. */
const CLOSED = -1;
const EMPTY = -2;
/** The second endings: Panda's, Gun Jack's second's, Tiger's. */
const SECOND = { kuma: 0x800, gunJack: 0x10000, tiger: 0x100 } as const;
/** The endings each shared entry's name reads (its first ending's, its second's, and in which word of the endings). */
const SHARED: readonly (readonly [number, number, number])[] = [
  [0x10, 0x80000, 0],
  [0x800, 0x800, 1],
  [0x10000, 0x10000, 1],
  [0x4000, 0x100000, 0],
];
/** The help line by the focus, on the movies' page and the music page. */
const HELP: readonly Readonly<Record<number, number>>[] = [
  { [Focus.EXIT]: 7, [Focus.OTHER_PAGE]: 5 },
  { [Focus.EXIT]: 7, [Focus.OTHER_PAGE]: 4, [Focus.BGM]: 6 },
];
/** The fonts' advances, and the screen's width and middle. */
const SMALL = 9;
const LARGE = 13;
const WIDTH = 0x170;
const MIDDLE = 0xb8;
/** The blue of a focused button's fill and the list's bar, pulsing; an unfocused button's fill; white. */
const BLUE = 0xff4020;
const NAVY = 0x800000;
const WHITE = 0xffffff;
/** The title's and the line to play's line; the frames before they turn and a turn's frames. */
const BANNER = { y: 0x22, wait: 0x1e0, away: 0x228 } as const;

const triangle = (v: number): number => {
  v &= 0x1ff;
  return 0xff < v ? 0x1ff - v : v;
};
const scaled = (colour: number, level: number): number => [0, 8, 16].reduce((out, shift) => out | (Math.min((((colour >> shift) & 0xff) * level) >> 8, 0xff) << shift), 0);
const pulse = (game: GameState): number => scaled(BLUE, (triangle(game.world.vsyncSeen << 4) >> 1) + 0x80);

/** An entry's movie as the endings seen open it: its movie (the second ending's where that is seen), closed, or empty. */
export function entryState(game: GameState, entry: TheaterMovie): number {
  if (entry.bits === 0) return entry.movie;
  const [first, second] = game.records.endings as [number, number];
  switch (entry.kind) {
    case 0:
      return (first & entry.bits) !== 0 ? entry.movie : CLOSED;
    case 1:
      if ((second & SECOND.kuma) !== 0) return entry.alt;
      return (first & SECOND.kuma) !== 0 ? entry.movie : CLOSED;
    case 2:
      if ((second & SECOND.gunJack) !== 0) return entry.alt;
      return (first & SECOND.gunJack) !== 0 ? entry.movie : CLOSED;
    default:
      return (second & SECOND.tiger) !== 0 ? entry.movie : CLOSED;
  }
}

/** Whether every entry is open (none closed). */
export function allSeen(game: GameState, tables: TheaterTables): boolean {
  return tables.movies.every((entry) => entryState(game, entry) !== CLOSED);
}

/** An open entry's name: the four shared entries' as the endings seen name them. */
function entryName(game: GameState, tables: TheaterTables, entry: TheaterMovie): string {
  const shared = SHARED[entry.name.charCodeAt(0) - 0x30];
  if (shared === undefined || entry.name.length !== 1) return entry.name;
  const [first, second, word] = shared;
  const endings = game.records.endings;
  const seen = ((endings[0]! & first) !== 0 ? 1 : 0) | ((endings[word]! & second) !== 0 ? 2 : 0);
  return seen === 0 ? entry.name : tables.endingNames[SHARED.indexOf(shared)]![seen - 1]!;
}

/** The cursor, the scroll and the focus back to the list's start, and the banner's wait. */
export function resetCursor(game: GameState): void {
  Object.assign(game.theater, { cursor: 0, scroll: 0, focus: 0, idle: 0 });
}

function sound(game: GameState, data: TheaterData, code: number): void {
  voiceLine(game.world, data, 0, code, 0);
}

/** The movies' page's input. */
function moviesInput(game: GameState, data: TheaterData, tables: TheaterTables): number {
  const theater = game.theater;
  const repeats = game.pads.repeats[0]! | game.pads.repeats[1]!;
  const fresh = game.world.input.fresh[0]! | game.world.input.fresh[1]!;
  const entries = tables.movies;
  const count = entries.length;
  const state = (i: number): number => (entries[i] === undefined ? EMPTY : entryState(game, entries[i]!));
  const [oldCursor, oldFocus] = [theater.cursor, theater.focus];
  let column = theater.cursor % COLUMNS;
  let row = Math.trunc(theater.cursor / COLUMNS);
  if (theater.focus === Focus.LIST) {
    if ((repeats & LEFT) !== 0) {
      if (0 < column && CLOSED <= state(row * COLUMNS + column - 1)) column -= 1;
    } else if ((repeats & RIGHT) !== 0) {
      if (column < COLUMNS - 1 && CLOSED <= state(row * COLUMNS + column + 1)) column += 1;
    }
    if ((repeats & UP) !== 0) {
      if (0 < row) row -= 1;
      if (row < theater.scroll) theater.scroll -= 1;
    } else if ((repeats & DOWN) !== 0) {
      row += 1;
      if (!(row < Math.trunc(count / COLUMNS))) {
        theater.focus = theater.allSeen !== 0 ? Focus.OTHER_PAGE : Focus.EXIT;
        row -= 1;
      } else if (state(row * COLUMNS + column) < CLOSED) {
        const step = column < 3 ? 1 : -1;
        while (state(row * COLUMNS + column) < CLOSED) column += step;
      }
      if (theater.scroll + GRID_ROWS <= row) theater.scroll += 1;
    }
  } else {
    if (theater.allSeen !== 0) {
      if ((repeats & LEFT) !== 0 && theater.focus === Focus.EXIT) theater.focus = Focus.OTHER_PAGE;
      else if ((repeats & RIGHT) !== 0 && theater.focus === Focus.OTHER_PAGE) theater.focus = Focus.EXIT;
    }
    if ((repeats & UP) !== 0) theater.focus = Focus.LIST;
  }
  let at = column + row * COLUMNS;
  if (at < 0) at = count - 1;
  else if (count <= at) at = 0;
  theater.cursor = at;
  if (theater.cursor !== oldCursor || theater.focus !== oldFocus) sound(game, data, MOVE_SOUND);
  if ((fresh & CHOOSE) === 0) {
    if ((fresh & SELECT) === 0) return TheaterChoice.NONE;
    sound(game, data, CHOOSE_SOUND);
    return TheaterChoice.LEAVE;
  }
  switch (theater.focus) {
    case Focus.LIST: {
      const movie = state(theater.cursor);
      if (movie < 0) return TheaterChoice.NONE;
      stopMusic(game.world);
      theater.movie = movie;
      return TheaterChoice.PLAY;
    }
    case Focus.OTHER_PAGE:
      sound(game, data, CHOOSE_SOUND);
      resetCursor(game);
      theater.mode = TheaterPage.REMIXED;
      return TheaterChoice.NONE;
    case Focus.EXIT:
      sound(game, data, CHOOSE_SOUND);
      return TheaterChoice.LEAVE;
    default:
      return TheaterChoice.NONE;
  }
}

/** The music page's input. */
function musicInput(game: GameState, data: TheaterData, tables: TheaterTables): number {
  const theater = game.theater;
  const repeats = game.pads.repeats[0]! | game.pads.repeats[1]!;
  const fresh = game.world.input.fresh[0]! | game.world.input.fresh[1]!;
  const count = tables.songs.length;
  const [oldCursor, oldFocus] = [theater.cursor, theater.focus];
  let cursor = theater.cursor;
  if (theater.focus === Focus.LIST) {
    if ((repeats & RIGHT) !== 0) theater.focus = Focus.OTHER_PAGE;
    else if ((repeats & UP) !== 0) {
      if (0 < cursor) {
        cursor -= 1;
        if (cursor < theater.scroll) theater.scroll -= 1;
      }
    } else if ((repeats & DOWN) !== 0) {
      if (cursor < count - 1) {
        cursor += 1;
        if (theater.scroll + SONG_ROWS <= cursor) theater.scroll += 1;
      }
    }
  } else if ((repeats & LEFT) !== 0) theater.focus = Focus.LIST;
  else if ((repeats & UP) !== 0) theater.focus = ({ [Focus.EXIT]: Focus.BGM, [Focus.BGM]: Focus.OTHER_PAGE } as Record<number, number>)[theater.focus] ?? theater.focus;
  else if ((repeats & DOWN) !== 0) theater.focus = ({ [Focus.OTHER_PAGE]: Focus.BGM, [Focus.BGM]: Focus.EXIT } as Record<number, number>)[theater.focus] ?? theater.focus;
  theater.cursor = cursor;
  if (theater.cursor !== oldCursor || theater.focus !== oldFocus) sound(game, data, MOVE_SOUND);
  if ((fresh & CHOOSE) === 0) {
    if ((fresh & SELECT) === 0) return TheaterChoice.NONE;
    sound(game, data, CHOOSE_SOUND);
    return TheaterChoice.LEAVE;
  }
  switch (theater.focus) {
    case Focus.LIST:
      theater.song = tables.songs[theater.cursor]!.code | (theater.mode === TheaterPage.ARCADE ? 1 : 0);
      stopMusic(game.world);
      return TheaterChoice.PLAY;
    case Focus.OTHER_PAGE:
      stopMusic(game.world);
      sound(game, data, CHOOSE_SOUND);
      resetCursor(game);
      theater.mode = TheaterPage.MOVIES;
      return TheaterChoice.NONE;
    case Focus.BGM:
      stopMusic(game.world);
      sound(game, data, CHOOSE_SOUND);
      theater.mode ^= 1;
      return TheaterChoice.NONE;
    case Focus.EXIT:
      sound(game, data, CHOOSE_SOUND);
      return TheaterChoice.LEAVE;
    default:
      return TheaterChoice.NONE;
  }
}

/** A line printed in turns of colour, `%c` changing to the next. */
function printParts(game: GameState, font: number, colours: readonly number[], x: number, y: number, text: string): void {
  let pen = x;
  text.split('%c').forEach((part, i) => {
    pen = print(game, font, colours[Math.min(i, colours.length - 1)]!, pen, y, part);
  });
}

/** A box: its corners' shade, then its border's four bars. */
function box(game: GameState, record: TheaterBox, dx = 0, dy = 0): (() => void)[] {
  const out: (() => void)[] = [];
  const { x, y, w, h, across, down, border } = record;
  if ((record.flags & 1) !== 0) {
    const [a, b, c, d] = record.corners as [number, number, number, number];
    out.push(() => draw(game, { kind: 'shade', x: x + dx, y: y + dy, w, h, colours: [a | (record.flags & 2), b, c, d], layer: 7 }));
  }
  if (across !== 0) {
    out.push(() => {
      tile(game, x + dx, y + dy, w, down, border, 7);
      tile(game, x + dx, y + dy, across, h, border, 7);
      tile(game, x + dx, y + dy + h - down, w, down, border, 7);
      tile(game, x + dx + w - across, y + dy, across, h, border, 7);
    });
  }
  return out;
}

/** A button: its fill (blue pulsing when it has the focus), its white border, its name. */
function button(game: GameState, x: number, y: number, text: string, focused: boolean): (() => void)[] {
  const w = 16 + text.length * SMALL;
  return [
    () => tile(game, x - 8, y - 8, w, 28, focused ? pulse(game) : NAVY, 7),
    () => {
      tile(game, x - 8 + w - 2, y - 6, 2, 28, WHITE, 7);
      tile(game, x - 8, y - 6 + 26, w, 2, WHITE, 7);
      tile(game, x - 8, y - 6, 2, 28, WHITE, 7);
      tile(game, x - 8, y - 6, w, 2, WHITE, 7);
    },
    () => print(game, 0, focused ? 5 : 10, x, y, text),
  ];
}

/** The title, and the line to play turning in once no button has been held a while. */
function banner(game: GameState, tables: TheaterTables): (() => void)[] {
  const theater = game.theater;
  const held = game.world.input.rawPads[0]! | game.world.input.rawPads[1]!;
  theater.idle = held === 0 ? (theater.idle + 1) & 0xffff : 0;
  const turn = BANNER.wait <= theater.idle ? theater.idle - BANNER.wait : 0;
  let base = (turn & 0x100) !== 0 ? BANNER.away : MIDDLE;
  if ((turn & 0xe0) === 0xe0) {
    const slide = ((turn & 0x1f) * 0x17) >> 1;
    base += (turn & 0x100) !== 0 ? -slide : slide;
  }
  const title = tables.titles[theater.mode - 1] ?? '';
  return [
    () => printParts(game, 0, [6, 5, 6, 5], base - ((SMALL * tables.play.length) >> 1) - WIDTH, BANNER.y, tables.play),
    () => printParts(game, 1, [6, theater.mode === TheaterPage.REMIXED ? 1 : 6], base - ((LARGE * title.length) >> 1), BANNER.y, title),
  ];
}

/** The help line for what has the focus. */
function help(game: GameState, tables: TheaterTables, page: number): (() => void)[] {
  const line = tables.help[HELP[page]![game.theater.focus] ?? -1];
  return line === undefined ? [] : [() => print(game, 0, 6, (WIDTH - SMALL * line.length) >> 1, 0x190, line)];
}

/** The movies' page, back to front. */
function moviesPage(game: GameState, tables: TheaterTables): (() => void)[] {
  const theater = game.theater;
  const entries = tables.movies;
  const out = [...box(game, tables.boxes[0]!), ...box(game, tables.boxes[1]!), ...banner(game, tables)];
  if (theater.focus !== Focus.LIST) out.push(...help(game, tables, 0));
  else if (theater.cursor < entries.length) {
    const entry = entries[theater.cursor]!;
    const state = entryState(game, entry);
    if (0 <= state) {
      const [first, second] = entry.lines;
      if (second === undefined) out.push(() => print(game, 0, 5, ((0xe6 - SMALL * first!.length) >> 1) + 100, 0x1a6, first!));
      else {
        out.push(() => print(game, 0, 5, ((0xe6 - SMALL * second.length) >> 1) + 100, 0x1af, second));
        out.push(() => print(game, 0, 5, ((0xe6 - SMALL * first!.length) >> 1) + 100, 0x19d, first!));
      }
      const name = entryName(game, tables, entry);
      out.push(() => print(game, 1, 6, ((0xe9 - LARGE * name.length) >> 1) + 0x60, 0x182, name));
      if (0 < entry.picture) out.push(() => draw(game, { kind: 'thumb', picture: entry.picture, x: 0x1e, y: 0x180, layer: 7 }));
    } else if (state === CLOSED && 1 <= entry.picture) out.push(() => print(game, 1, 6, 0xc1, 0x182, tables.unknown));
  }
  if (theater.allSeen !== 0) {
    out.push(...button(game, 0xfc, 0x158, tables.buttons.exit, theater.focus === Focus.EXIT));
    out.push(...button(game, 0xa2, 0x158, tables.buttons.music, theater.focus === Focus.OTHER_PAGE));
  } else out.push(...button(game, 0xa2, 0x158, tables.buttons.exit, theater.focus === Focus.EXIT));
  for (let cell = GRID_ROWS * COLUMNS - 1; 0 <= cell; cell -= 1) {
    const [column, row] = [cell % COLUMNS, Math.trunc(cell / COLUMNS)];
    const entry = entries[column + (row + theater.scroll) * COLUMNS];
    if (entry === undefined) continue;
    const state = entryState(game, entry);
    if (state === EMPTY) continue;
    const [x, y] = [0x28 + 0x30 * column, 0x48 + 0x40 * row];
    out.push(() => draw(game, { kind: 'thumb', picture: state === CLOSED ? 0 : entry.picture, x, y, layer: 7 }));
    out.push(() => draw(game, { kind: 'film', x, y, layer: 7 }));
  }
  if (theater.focus === Focus.LIST && (game.world.frameCount & 0x1c) !== 0) {
    const column = theater.cursor % COLUMNS;
    const row = Math.trunc(theater.cursor / COLUMNS) - theater.scroll;
    out.push(...box(game, tables.boxes[2]!, 0x26 + 0x30 * column, 0x45 + 0x40 * row));
  }
  return out;
}

/** The music page, back to front. */
function musicPage(game: GameState, tables: TheaterTables): (() => void)[] {
  const theater = game.theater;
  const out = [...box(game, tables.boxes[0]!), ...box(game, tables.boxes[1]!), ...banner(game, tables)];
  out.push(() => draw(game, { kind: 'picture', picture: 'caption', x: 0xf2, y: 0x15a, layer: 7 }));
  out.push(() => draw(game, { kind: 'picture', picture: 'cover', x: 0xf2, y: 0x5a, layer: 7 }));
  if (theater.focus !== Focus.LIST) out.push(...help(game, tables, 1));
  else if (theater.cursor < tables.songs.length) {
    const name = tables.songs[theater.cursor]!.name;
    const u = (WIDTH - LARGE * name.length) >>> 1;
    out.push(() => print(game, 0, 5, 0x104, 0x1a6, tables.sets[theater.mode === TheaterPage.ARCADE ? 1 : 0]!));
    out.push(() => draw(game, { kind: 'picture', picture: 'disc', x: u - 0xe, y: 0x182, layer: 7 }));
    out.push(() => print(game, 1, 6, u + 0x10, 0x186, name));
  }
  out.push(...button(game, 0xfa, 0x122, tables.buttons.exit, theater.focus === Focus.EXIT));
  out.push(...button(game, 0xfa, 0xe6, tables.buttons.bgm, theater.focus === Focus.BGM));
  out.push(...button(game, 0xfa, 200, tables.buttons.theater, theater.focus === Focus.OTHER_PAGE));
  for (let k = SONG_ROWS - 1; 0 <= k; k -= 1) {
    const i = theater.scroll + k;
    const song = tables.songs[i];
    if (song === undefined) continue;
    const picked = theater.focus === Focus.LIST && i === theater.cursor;
    if (picked) out.push(() => tile(game, 0x19, 0x4f + 0x14 * k, 0xcc, 0x12, pulse(game), 7));
    out.push(() => print(game, 0, picked ? 5 : theater.mode === TheaterPage.REMIXED ? 0xb : 10, 0x1e, 0x50 + 0x14 * k, `${String(i + 1).padStart(2, ' ')}:${song.name}`));
  }
  out.push(() => {
    tile(game, 0xe4, 0x48, 2, 0x122, WHITE, 7);
    tile(game, 0x18, 0x168, 0xce, 2, WHITE, 7);
    tile(game, 0x18, 0x48, 2, 0x122, WHITE, 7);
    tile(game, 0x18, 0x48, 0xce, 2, WHITE, 7);
  });
  return out;
}

/**
 * The menu's frame: the page drawn (as the frame began: what this frame's input changes shows the
 * next), then its input. Returns what was chosen.
 */
export function theaterMenu(game: GameState, data: TheaterData, scenes: SceneTables): number {
  const tables = scenes.theater;
  const movies = game.theater.mode === TheaterPage.MOVIES;
  const page = movies ? moviesPage(game, tables) : musicPage(game, tables);
  /* Front to back: within a table entry what is drawn later lies under what was drawn before. */
  for (let i = page.length - 1; 0 <= i; i -= 1) page[i]!();
  const choice = movies ? moviesInput(game, data, tables) : musicInput(game, data, tables);
  if (choice === TheaterChoice.PLAY && !movies) playTheaterSong(game.world, game.theater.song >> 1, game.theater.song & 1);
  return choice;
}
