/**
 * The remake's own settings, REMAKE OPTION in the Options: a list of sections, each a page of the
 * Options as the game's own lists are (up and down to pick, left and right to change, wrapping; the
 * default in its own colour; select or EXIT back to the list, and from it to the first page, which
 * lists it before its own EXIT). DISPLAY: how the fighters and stages are drawn (and whether from
 * the arcade's data), whether the cloth is kept clear of the legs, the picture's quality, the frame
 * rate shown and the CRT filter over the picture. REMASTER: the remaster (the fight drawn with the
 * engine's lighting and the assets made on this machine) and, listed while it is on, its look, its
 * brightness and whether its floors fade. GAME: the game's speed, the reachable walls, the touch
 * pad and its directions. MUSIC: the player's own songs (`music-page.ts`). Where they are kept,
 * and what they do, is the page's: those that change what is loaded take effect on a restart, which
 * the page makes when the player leaves REMAKE OPTION, and its pages say so under their lists while
 * one differs from the start's.
 */
import type { OptionsItem, OptionsPage } from '../data/scenes.ts';
import { MUSIC_PAGE } from './music-page.ts';
import type { GameState, RemakeSettings } from './state.ts';

/** The list's number, past the game's own pages and the one past them that leaves the Options; its sections' (ONLINE MODE's and MUSIC's between). */
export const REMAKE_PAGE = 0x10;
export const DISPLAY_PAGE = 0x13;
export const REMASTER_PAGE = 0x14;
export const GAME_PAGE = 0x15;

/** Each setting's values: 0 is the default, but for the look's and the brightness's, the middle of their three. */
export const REMAKE_DEFAULTS: Readonly<RemakeSettings> = { textures: 0, models: 0, stages: 0, fighters: 0, cloth: 0, picture: 0, frameRate: 0, speed: 0, touchPad: 0, touchStick: 0, remaster: 0, look: 1, brightness: 1, floorFade: 0, walls: 0, crt: 0 };

/** The settings a restart applies: all but the frame rate's, the remaster's look, brightness and floors, and the CRT filter's. */
export const RESTARTED: readonly (keyof RemakeSettings)[] = ['textures', 'models', 'stages', 'fighters', 'cloth', 'picture', 'touchPad', 'remaster'];

const setting = (value: keyof RemakeSettings, label: string, names: readonly string[], byDefault = 0): OptionsItem => ({ value, label, names, sideways: 1, count: names.length, button: 0, set: byDefault, draw: 2, modes: 0 });
/** A line that opens a page. */
const opens = (label: string, page: number): OptionsItem => ({ value: 'page', label, names: [], sideways: 0, count: 0, button: 1, set: page, draw: 1, modes: 0 });

/** The first page's line that opens REMAKE OPTION. */
export const REMAKE_ITEM: OptionsItem = opens('REMAKE OPTION', REMAKE_PAGE);

/** A page of REMAKE OPTION: its title on the screen's middle, its lines, back to the list (the list's back to the first page). */
const page = (title: string, items: readonly OptionsItem[], back: number): OptionsPage => ({
  title,
  titleX: 184 - ((title.length * 13) >> 1),
  titleY: 40,
  listX: 20,
  listY: 92,
  step: 28,
  width: 324,
  cancel: back,
  items: [...items, opens('EXIT', back)],
});

/** The list of sections. */
export const REMAKE_OPTIONS: OptionsPage = page('REMAKE OPTION', [opens('DISPLAY', DISPLAY_PAGE), opens('REMASTER', REMASTER_PAGE), opens('GAME', GAME_PAGE), opens('MUSIC', MUSIC_PAGE)], 0);

const DISPLAY: OptionsPage = page(
  'DISPLAY',
  [
    setting('textures', 'TEXTURES', ['SMOOTH', 'ORIGINAL']),
    setting('models', 'MODELS', ['AUTO', 'ROUNDED', 'ORIGINAL']),
    setting('stages', 'STAGES', ['ARCADE', 'CONSOLE']),
    setting('fighters', 'FIGHTERS', ['ARCADE', 'CONSOLE']),
    setting('cloth', 'CLOTH', ['CLEAR OF LEGS', 'ORIGINAL']),
    setting('picture', 'PICTURE', ['AUTO', 'HIGH', 'LOW', 'VERY LOW']),
    setting('frameRate', 'FRAME RATE', ['OFF', 'ON']),
    setting('crt', 'CRT FILTER', ['OFF', 'ON']),
  ],
  REMAKE_PAGE,
);
/** The remaster's page, its look, brightness and floors listed while it is on. */
const REMASTER_ON: OptionsPage = page(
  'REMASTER',
  [setting('remaster', 'REMASTER', ['OFF', 'ON']), setting('look', 'LOOK', ['LIGHT', 'NORMAL', 'STRONG'], 1), setting('brightness', 'BRIGHTNESS', ['LOW', 'NORMAL', 'HIGH'], 1), setting('floorFade', 'FLOOR FADE', ['ON', 'OFF'])],
  REMAKE_PAGE,
);
const REMASTER_OFF: OptionsPage = page('REMASTER', [REMASTER_ON.items[0]!], REMAKE_PAGE);
const GAME: OptionsPage = page(
  'GAME',
  [setting('speed', 'GAME SPEED', ['60 HZ', '50 HZ']), setting('walls', 'REACHABLE WALLS', ['ONLINE ONLY', 'ON', 'OFF']), setting('touchPad', 'TOUCH PAD', ['AUTO', 'ON', 'OFF']), setting('touchStick', 'TOUCH DIRECTIONS', ['D-PAD', 'STICK'])],
  REMAKE_PAGE,
);

/** Whether an Options page is one of REMAKE OPTION's: its list, a section, or MUSIC. */
export const inRemakeOptions = (n: number): boolean => n === REMAKE_PAGE || n === DISPLAY_PAGE || n === REMASTER_PAGE || n === GAME_PAGE || n === MUSIC_PAGE;

/** REMAKE OPTION's page `n` as the state lists it (the remaster's lines only while it is on), and its cursor; null for another page (or MUSIC, its own). */
export function remakePage(game: GameState, n: number): { readonly page: OptionsPage; readonly state: { cursor: number; sub: number } } | null {
  const sections = game.remake.sections;
  if (n === REMAKE_PAGE) return { page: REMAKE_OPTIONS, state: game.optionsScreen.remake };
  if (n === DISPLAY_PAGE) return { page: DISPLAY, state: sections[0]! };
  if (n === REMASTER_PAGE) return { page: game.remake.settings.remaster === 1 ? REMASTER_ON : REMASTER_OFF, state: sections[1]! };
  if (n === GAME_PAGE) return { page: GAME, state: sections[2]! };
  return null;
}

/** Where the page's line under its list goes: under its last line. */
export const remakeLineY = (page: OptionsPage): number => page.listY + page.items.length * page.step + 8;

/** The line under the list while a setting a restart applies differs from the start's. */
export const RESTART_LINE = 'LEAVING RESTARTS THE GAME';

/** The line under the list while the remaster is on but its assets were not made on this machine. */
export const REMASTER_LINE = 'RUN NPM RUN REMASTER FIRST';

/** Whether the remaster is asked for but cannot be drawn: its assets not made. */
export const remasterMissing = (game: GameState): boolean => game.remake.settings.remaster === 1 && !game.remake.remasterMade;

/** Whether an Options value is one of the remake's settings. */
export const isRemakeSetting = (value: string): value is keyof RemakeSettings => Object.hasOwn(REMAKE_DEFAULTS, value);

/** Whether a setting a restart applies differs from the one the page started with (the remaster only where its assets were made, as nothing else draws it). */
export const restartWanted = (game: GameState): boolean =>
  RESTARTED.some((key) => (key !== 'remaster' || game.remake.remasterMade) && game.remake.settings[key] !== game.remake.started[key]);
