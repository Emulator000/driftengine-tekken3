/**
 * The fight's pause menu, each paused frame, for the side that paused: CANCEL (back to the fight),
 * COMMAND (each human's command list), RESET, and in Tekken Ball RULES (the rules' page). Up and
 * down move the cursor (wrapping), a button chooses; opening it keys the voices off but four. In
 * the command lists, up and down move a move, left and right five (unless up or down is held), the
 * scroll easing a third of the way a frame, until a button goes back to the menu, as on the rules'
 * page. The presentation draws the menu, the lists and the page from this; `drawn` says which this
 * field shows, as the original draws them (not on its waiting frames).
 */
import { Mode, type FightData, type FightState } from './state.ts';
import { keyOffVoices, voiceLine } from './voices.ts';

/** The cursor that opens the menu, and the choices: back to the fight, the command lists, a reset, Tekken Ball's rules. */
const OPENING = 0xff;
const Choice = { NONE: 0, CANCEL: 1, COMMANDS: 2, RESET: 3, RULES: 4 } as const;
/** What a paused frame shows: nothing, the menu, the command lists, Tekken Ball's rules. */
export const PauseDrawn = { NOTHING: 0, MENU: 1, LISTS: 2, RULES: 3 } as const;
const CURSOR_SOUND = 0x546c;
const CHOICE_SOUND = 0x50f4;
/** Frames the menu's input waits after opening or choosing. */
const WAIT = 2;
/** The wait after the rules' page is left. */
const RULES_WAIT = 3;
const UP = 0x1000;
const RIGHT = 0x2000;
const DOWN = 0x4000;
const LEFT = -0x8000;
const UP_OR_DOWN = 0x5000;
const BUTTONS = 0x8f0;
/** A line of the list, in 64ths of the scroll. */
const ROW = 0x40;
const PAGE = 5;

/** A side's list scrolled by its pad's presses (unless nothing is drawn), then eased toward its place. */
function scrollCommands(state: FightState, data: FightData, side: number, padSide: number): void {
  const scroll = state.pauseMenu.scrolls[side]!;
  const fighter = state.fighters[side]!;
  const count = data.models[fighter.costume]?.commands ?? 0;
  if (state.nothingDrawn === 0) {
    const held = state.input.rawPads[padSide]!;
    const pressed = (state.input.fresh[padSide]! << 16) >> 16;
    let step = pressed === DOWN ? 1 : 0;
    if (pressed === UP) step = -1;
    if ((held & UP_OR_DOWN) === 0) {
      if (pressed === RIGHT) step = PAGE;
      else if (pressed === LEFT) step = -PAGE;
    }
    if (step !== 0) voiceLine(state, data, 0, CURSOR_SOUND, 0);
    let place = count <= scroll.place ? step : scroll.place + step;
    if (place < 0) place += count;
    if (count <= place) place -= count;
    scroll.place = place;
    scroll.offset = (scroll.offset + step * ROW) | 0;
  }
  let offset = scroll.offset;
  let eased = 0;
  if (offset !== 0) {
    const negative = offset < 0;
    if (negative) offset = -offset;
    eased = offset - Math.trunc((offset + 3) / 3);
    if (eased < 1) eased = 0;
    if (negative) eased = -eased;
  }
  scroll.offset = eased;
}

/** The command lists: each human's on its half (in Tekken Force the player's alone, on the human's pad), until a button goes back to the menu. */
function commandLists(state: FightState, data: FightData, side: number): void {
  const menu = state.pauseMenu;
  menu.sides = state.match.humanSides;
  const humans = (n: number): boolean => ((state.match.humanSides >> n) & 1) !== 0;
  const scroll = (): void => {
    if (state.mode === Mode.TEKKEN_FORCE) scrollCommands(state, data, 0, state.force.pad);
    else for (let n = 0; n < 2; n += 1) if (humans(n)) scrollCommands(state, data, n, n);
  };
  if (state.nothingDrawn !== 0) {
    scroll();
    return;
  }
  if (menu.wait !== 0) {
    menu.wait -= 1;
    return;
  }
  const pad = state.input.fresh[side === 1 ? 0 : 1]!;
  if ((pad & BUTTONS) !== 0) {
    menu.choice = Choice.NONE;
    menu.cursor = 0;
    menu.wait = WAIT;
    voiceLine(state, data, 0, CHOICE_SOUND, 0);
  }
  menu.drawn = PauseDrawn.LISTS;
  scroll();
}

/**
 * Practice's COMMAND LIST: the lists of the sides in `sides` (bits), each scrolled by its own pad,
 * drawn once the menu's wait has run; practice's menu closes them.
 */
export function commandListsFor(state: FightState, data: FightData, sides: number): void {
  const menu = state.pauseMenu;
  menu.sides = sides;
  if (state.nothingDrawn === 0) {
    if (menu.wait !== 0) {
      menu.wait -= 1;
      return;
    }
    menu.drawn = PauseDrawn.LISTS;
  }
  for (let n = 0; n < 2; n += 1) if (((sides >> n) & 1) !== 0) scrollCommands(state, data, n, n);
}

/** Tekken Ball's rules: the page, until a button goes back to the menu. */
function rules(state: FightState, data: FightData, side: number): void {
  const menu = state.pauseMenu;
  if (menu.wait !== 0) {
    menu.wait -= 1;
    return;
  }
  const pad = state.input.fresh[side === 1 ? 0 : 1]!;
  if ((pad & BUTTONS) !== 0) {
    menu.cursor = 0;
    menu.choice = Choice.NONE;
    menu.wait = RULES_WAIT;
    voiceLine(state, data, 0, CHOICE_SOUND, 0);
  }
  menu.drawn = PauseDrawn.RULES;
}

/** The menu: the cursor moved, an item chosen. */
function chooseItem(state: FightState, data: FightData, side: number): void {
  const menu = state.pauseMenu;
  if (menu.wait !== 0) {
    menu.wait -= 1;
    return;
  }
  const items = state.mode === Mode.TEKKEN_BALL ? 4 : 3;
  const pad = state.input.fresh[side === 1 ? 0 : 1]!;
  if ((pad & UP) !== 0) {
    if (menu.cursor === 0) menu.cursor = items;
    menu.cursor -= 1;
    voiceLine(state, data, 0, CURSOR_SOUND, 0);
  }
  if ((pad & DOWN) !== 0) {
    menu.cursor = (menu.cursor + 1) % items;
    voiceLine(state, data, 0, CURSOR_SOUND, 0);
  }
  if ((pad & BUTTONS) !== 0) {
    menu.wait = WAIT;
    menu.choice = menu.cursor + 1;
    voiceLine(state, data, 0, CHOICE_SOUND, 0);
  }
  menu.drawn = PauseDrawn.MENU;
}

/** A paused frame's menu for the side that paused (1 or 2). */
export function pauseMenu(state: FightState, data: FightData, side: number): void {
  const menu = state.pauseMenu;
  menu.drawn = PauseDrawn.NOTHING;
  if (state.nothingDrawn !== 0) return;
  if (menu.cursor === OPENING) {
    menu.choice = Choice.NONE;
    menu.cursor = 0;
    menu.wait = WAIT;
    keyOffVoices(state, false);
    voiceLine(state, data, 0, CHOICE_SOUND, 0);
  }
  if (menu.choice === Choice.COMMANDS) commandLists(state, data, side);
  else if (menu.choice === Choice.RULES) rules(state, data, side);
  else chooseItem(state, data, side);
}
