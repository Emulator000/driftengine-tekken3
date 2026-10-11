/**
 * Where the pause screen's pieces go this field, from the fight's state as its pause step left it:
 * the original's places, in its screen's units (480 lines high, 368 across, x 184 at the middle).
 *
 * The menu (CANCEL, COMMAND, RESET, and in Tekken Ball RULES) in a box at the middle, the chosen
 * word lit, and "1P PAUSE" or "2P PAUSE" blinking at the pauser's side; or, once COMMAND is
 * chosen, each human's command list on its half: six rows a list, scrolled to its place and easing
 * in, each a move (its name, and its command a line below), under the list's title, with the way
 * out at the foot.
 */
import type { FightData, FightState } from '../../sim/fight/state.ts';
import { Mode } from '../../sim/fight/state.ts';
import { PauseDrawn } from '../../sim/fight/pause-menu.ts';

export interface PauseItem {
  readonly text: string;
  readonly selected: boolean;
  /** Its left and top. */
  readonly x: number;
  readonly y: number;
}

export interface PauseRow {
  /** The move's index in its list, and the row's top. */
  readonly move: number;
  readonly y: number;
}

export interface PauseList {
  readonly side: 0 | 1;
  /** The list's half: its left, and its rows' area top to bottom. */
  readonly left: number;
  readonly width: number;
  readonly top: number;
  readonly bottom: number;
  readonly pack: number;
  readonly rows: readonly PauseRow[];
}

export interface PauseView {
  readonly menu: { readonly items: readonly PauseItem[]; readonly box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number } } | null;
  /** The blinking "nP PAUSE": the side that paused and its place, when lit. */
  readonly pause: { readonly side: number; readonly x: number; readonly y: number } | null;
  readonly lists: readonly PauseList[];
  /** "PUSH BUTTON TO EXIT", at the pauser's half's foot. */
  readonly exit: { readonly x: number; readonly y: number } | null;
}

const ITEMS = ['CANCEL', 'COMMAND', 'RESET', 'RULES'] as const;
const MENU = { centre: 0xb8, top: 0x68, step: 0x14, advance: 9, box: { x: 0x94, y: 0x64, w: 0x48, h: 0x41 }, tallBox: 0x55 };
const BLINK = 0x20;
const PAUSE = { left: 0x20, right: 368 - 0x88, y: 0x78 };
const LIST = { half: 0xb8, width: 0xb6, top: 0x74, bottom: 0x1b3, firstRow: 0x76, row: 0x40, rows: 6, single: 0xf6 };
const EXIT = { x: 6, y: 0x1b8 };
/** Mokujin's list is a single row. */
const MOKUJIN = 0xf;

const NOTHING: PauseView = { menu: null, pause: null, lists: [], exit: null };

/** The rows a side's list shows: from its place, less the rows its easing scroll is away, wrapping. */
function rows(state: FightState, data: FightData, side: 0 | 1): PauseRow[] {
  const fighter = state.fighters[side]!;
  const count = data.models[fighter.costume]?.commands ?? 0;
  if (count === 0) return [];
  const { place, offset } = state.pauseMenu.scrolls[side]!;
  const away = ((offset < 0 ? offset + 0x3f : offset) >> 6) + (0 < offset ? 1 : 0);
  let move = place - away;
  let y = offset + LIST.firstRow - away * LIST.row;
  while (move < 0) move += count;
  while (count <= move) move -= count;
  let shown = LIST.rows;
  if (fighter.roster === MOKUJIN) {
    y = LIST.single;
    shown = 1;
  }
  const out: PauseRow[] = [];
  for (let n = 0; n < shown; n += 1) {
    out.push({ move, y });
    move = move + 1 < count ? move + 1 : 0;
    y += LIST.row;
  }
  return out;
}

/** The pause screen this field: nothing unless the fight is paused and its step drew the menu or the lists. */
export function pauseView(state: FightState, data: FightData): PauseView {
  const drawn = state.pauseMenu.drawn;
  if (drawn === PauseDrawn.NOTHING) return NOTHING;
  const side = state.pause.frozen;
  if (drawn === PauseDrawn.MENU) {
    const count = state.mode === Mode.TEKKEN_BALL ? 4 : 3;
    const items = ITEMS.slice(0, count).map((text, i) => ({ text, selected: i === state.pauseMenu.cursor, x: MENU.centre - ((text.length * MENU.advance) >>> 1), y: MENU.top + i * MENU.step }));
    const lit = (state.vsyncSeen & BLINK) !== 0;
    return {
      menu: { items, box: { ...MENU.box, h: count === 4 ? MENU.tallBox : MENU.box.h } },
      pause: lit ? { side, x: side === 1 ? PAUSE.left : PAUSE.right, y: PAUSE.y } : null,
      lists: [],
      exit: null,
    };
  }
  const lists: PauseList[] = [];
  for (const n of [0, 1] as const) {
    if (((state.match.humanSides >> n) & 1) === 0) continue;
    lists.push({ side: n, left: n * LIST.half, width: LIST.width, top: LIST.top, bottom: LIST.bottom, pack: state.fighters[n]!.costume, rows: rows(state, data, n) });
  }
  return { menu: null, pause: null, lists, exit: { x: ((side - 1) * LIST.half) | EXIT.x, y: EXIT.y } };
}
