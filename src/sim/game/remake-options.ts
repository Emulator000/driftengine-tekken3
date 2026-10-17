/**
 * The remake's own settings, a page of the Options as the game's own lists are (up and down to
 * pick, left and right to change, wrapping; the default in its own colour; select or EXIT back to
 * the first page, which lists it before its own EXIT): how the fighters and stages are drawn (and
 * whether from the arcade's data), whether the cloth is kept clear of the legs, the picture's
 * quality, the frame rate shown, the touch pad, and the remaster (the fight drawn with the
 * engine's lighting and the assets made on this machine) and, listed while it is on, its look, its
 * brightness and whether its floors fade; and the CRT filter over the picture. Where they are kept, and what they do,
 * is the page's: those that change what is loaded take effect on a restart, which the page makes
 * when the player leaves this page, and the page says so under its list while one differs from the
 * start's.
 */
import type { OptionsItem, OptionsPage } from '../data/scenes.ts';
import type { GameState, RemakeSettings } from './state.ts';

/** The page's number, past the game's own pages and the one past them that leaves the Options. */
export const REMAKE_PAGE = 0x10;

/** Each setting's values: 0 is the default, but for the look's and the brightness's, the middle of their three. */
export const REMAKE_DEFAULTS: Readonly<RemakeSettings> = { textures: 0, models: 0, stages: 0, fighters: 0, cloth: 0, picture: 0, frameRate: 0, touchPad: 0, remaster: 0, look: 1, brightness: 1, floorFade: 0, crt: 0 };

/** The settings a restart applies: all but the frame rate's, the remaster's look, brightness and floors, and the CRT filter's. */
export const RESTARTED: readonly (keyof RemakeSettings)[] = ['textures', 'models', 'stages', 'fighters', 'cloth', 'picture', 'touchPad', 'remaster'];

const setting = (value: keyof RemakeSettings, label: string, names: readonly string[], byDefault = 0): OptionsItem => ({ value, label, names, sideways: 1, count: names.length, button: 0, set: byDefault, draw: 2, modes: 0 });

/** The first page's line that opens this one. */
export const REMAKE_ITEM: OptionsItem = { value: 'page', label: 'REMAKE OPTION', names: [], sideways: 0, count: 0, button: 1, set: REMAKE_PAGE, draw: 1, modes: 0 };

/** The page: its title on the screen's middle, its list as GAME OPTION's is laid (closer while the remaster's lines are listed), back to the first page. */
export const REMAKE_OPTIONS: OptionsPage = {
  title: 'REMAKE OPTION',
  titleX: 100,
  titleY: 40,
  listX: 20,
  listY: 84,
  step: 24,
  width: 324,
  cancel: 0,
  items: [
    setting('textures', 'TEXTURES', ['SMOOTH', 'ORIGINAL']),
    setting('models', 'MODELS', ['AUTO', 'ROUNDED', 'ORIGINAL']),
    setting('stages', 'STAGES', ['ARCADE', 'CONSOLE']),
    setting('fighters', 'FIGHTERS', ['ARCADE', 'CONSOLE']),
    setting('cloth', 'CLOTH', ['CLEAR OF LEGS', 'ORIGINAL']),
    setting('picture', 'PICTURE', ['AUTO', 'HIGH', 'LOW', 'VERY LOW']),
    setting('frameRate', 'FRAME RATE', ['OFF', 'ON']),
    setting('touchPad', 'TOUCH PAD', ['AUTO', 'ON', 'OFF']),
    setting('remaster', 'REMASTER', ['OFF', 'ON']),
    setting('look', 'LOOK', ['LIGHT', 'NORMAL', 'STRONG'], 1),
    setting('brightness', 'BRIGHTNESS', ['LOW', 'NORMAL', 'HIGH'], 1),
    setting('floorFade', 'FLOOR FADE', ['ON', 'OFF']),
    setting('crt', 'CRT FILTER', ['OFF', 'ON']),
    { value: 'page', label: 'EXIT', names: [], sideways: 0, count: 0, button: 1, set: 0, draw: 1, modes: 0 },
  ],
};

/** The remaster's own lines, listed while it is on. */
const REMASTER_ONLY: readonly string[] = ['look', 'brightness', 'floorFade'];

/** The page while the remaster is off: its lines not listed, the rest as GAME OPTION's are spaced. */
const WITHOUT_REMASTER: OptionsPage = { ...REMAKE_OPTIONS, listY: 100, step: 28, items: REMAKE_OPTIONS.items.filter((item) => !REMASTER_ONLY.includes(item.value)) };

/** The page as it is listed: the remaster's lines only while it is on. */
export const remakeOptions = (game: GameState): OptionsPage => (game.remake.settings.remaster === 1 ? REMAKE_OPTIONS : WITHOUT_REMASTER);

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
