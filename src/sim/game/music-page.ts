/**
 * REMAKE OPTION's MUSIC page: the player's own songs (`npm run music`) played in place of the
 * game's music. Its entries are the menus' (where the console plays none), the character select's
 * and each character's theme, as the game picks a fight's song by its character; for the one shown
 * (SONG, left and right), what it plays (PLAYS): the original, a random song of the library each
 * time it starts, or one of them, its whole name under the list. Where the songs are kept and how
 * they play is the page's; an online match plays the original music.
 */
import type { OptionsItem, OptionsPage } from '../data/scenes.ts';
import type { FightTables } from '../fight/match.ts';
import type { GameState, MusicRow } from './state.ts';

/** The page's number, past REMAKE OPTION's and ONLINE MODE's. */
export const MUSIC_PAGE = 0x12;
/** REMAKE OPTION's list, which the page goes back to (`REMAKE_PAGE`). */
const BACK = 0x10;
/** What an entry plays: the original, a random song of the library, and the library's first song (the rest after it). */
export const MusicPlays = { ORIGINAL: 0, RANDOM: 1, FIRST: 2 } as const;
/** The song the character select plays. */
const SELECT_SONG = 1;
/** The line under the list while the library is empty. */
export const MUSIC_LINE = 'RUN NPM RUN MUSIC FIRST';
/** The most of a name the PLAYS line shows, cut with dots past it; where its whole name goes under the list, and the most of a line there. */
const SHOWN = 29;
const NAME_Y = 196;
const NAME_STEP = 22;
const LINE = 36;

/** The MUSIC page's entries: the menus', the character select's, then each character's theme once, named by the first character on the roster whose it is. */
export function musicRows(tables: Pick<FightTables, 'roster'>): MusicRow[] {
  const rows: MusicRow[] = [
    { key: 'menu', song: -1, label: 'MENU' },
    { key: String(SELECT_SONG), song: SELECT_SONG, label: 'SELECT' },
  ];
  const seen = new Set([SELECT_SONG]);
  for (const code of tables.roster.codes) {
    if (code === undefined || !(code.song > SELECT_SONG) || seen.has(code.song)) continue;
    seen.add(code.song);
    rows.push({ key: String(code.song), song: code.song, label: code.name });
  }
  return rows;
}

/** A name cut to fit the PLAYS line. */
const cut = (name: string): string => (name.length <= SHOWN ? name : `${name.slice(0, SHOWN - 3).trimEnd()}...`);

/** The page as the state lists it: its entries' names, and what the library offers (made again as either changes). */
const pages = new WeakMap<object, { readonly rows: readonly MusicRow[]; readonly page: OptionsPage }>();
export function musicOptions(game: GameState): OptionsPage {
  const music = game.remake.music;
  const made = pages.get(music.library);
  if (made !== undefined && made.rows === music.rows) return made.page;
  {
    const rows = music.rows.map((r) => r.label);
    const plays = ['ORIGINAL', 'RANDOM', ...music.library.map((s) => cut(s.title))];
    const item = (value: 'musicRow' | 'musicPlays', label: string, names: readonly string[], set: number): OptionsItem => ({ value, label, names, sideways: 1, count: Math.max(1, names.length), button: 0, set, draw: 2, modes: 0 });
    const page: OptionsPage = {
      title: 'MUSIC',
      titleX: 152,
      titleY: 40,
      listX: 20,
      listY: 92,
      step: 28,
      width: 324,
      cancel: BACK,
      items: [
        item('musicRow', 'SONG', rows, -1),
        item('musicPlays', 'PLAYS', music.library.length === 0 ? ['ORIGINAL'] : plays, MusicPlays.ORIGINAL),
        { value: 'page', label: 'EXIT', names: [], sideways: 0, count: 0, button: 1, set: BACK, draw: 1, modes: 0 },
      ],
    };
    pages.set(music.library, { rows: music.rows, page });
    return page;
  }
}

/** The value of one of the page's lines: the entry shown, or what it plays. */
export function musicValue(game: GameState, value: 'musicRow' | 'musicPlays'): number {
  const music = game.remake.music;
  return value === 'musicRow' ? music.row : (music.chosen[music.row] ?? MusicPlays.ORIGINAL);
}

/** One of the page's lines set. */
export function setMusicValue(game: GameState, value: 'musicRow' | 'musicPlays', v: number): void {
  const music = game.remake.music;
  if (value === 'musicRow') music.row = Math.max(0, Math.min(v, music.rows.length - 1));
  else if (music.row < music.chosen.length) music.chosen[music.row] = v;
}

/** A name in lines of at most `LINE` letters, broken between words (a word longer than a line, cut). */
function wrapped(name: string): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of name.split(' ')) {
    const next = line === '' ? word : `${line} ${word}`;
    if (next.length <= LINE) line = next;
    else {
      if (line !== '') lines.push(line);
      line = word.slice(0, LINE);
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

/** What goes under the list: the song the entry plays, its title and artist whole; or, the library empty, how to make one. */
export function musicLines(game: GameState): { text: string; y: number }[] {
  const music = game.remake.music;
  if (music.library.length === 0) return [{ text: MUSIC_LINE, y: NAME_Y }];
  const song = music.library[(music.chosen[music.row] ?? 0) - MusicPlays.FIRST];
  if (song === undefined) return [];
  return [...wrapped(song.title), ...wrapped(song.artist)].map((text, i) => ({ text, y: NAME_Y + i * NAME_STEP }));
}
