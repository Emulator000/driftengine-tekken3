/**
 * Where the HUD's pieces go this field, from what the fight's HUD step decided (`state.hud`): the
 * original's places, in its screen's units (480 lines high, x 192 at the middle of the 4:3
 * picture), in the order it draws them, so a piece drawn over another stays over it.
 *
 * The back (behind the calls): each bar's parts (the health, the damage just taken, the lost rest)
 * and its two end caps, the timer, the round marks, and each name on its plate. The front: the
 * calls, each in the block the original's printer fills, the last printed drawn first.
 */
import type { FightState } from '../../sim/fight/state.ts';

export type BarPart = 'health' | 'damage' | 'lost';

export type HudPiece =
  | { readonly kind: 'bar'; readonly part: BarPart }
  | { readonly kind: 'cap'; readonly end: 0 | 1 }
  | { readonly kind: 'timer'; readonly text: string }
  | { readonly kind: 'mark'; readonly lit: boolean }
  | { readonly kind: 'name'; readonly side: 0 | 1; readonly text: string; readonly costume: number }
  | { readonly kind: 'call'; readonly font: number; readonly colour: number; readonly text: string };

/**
 * A piece and its place. A name's place is its line: `x` where it starts (the first side's) or ends
 * (the second's), `w` 0, its plate under its lower part.
 */
export interface PlacedPiece {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly piece: HudPiece;
}

/** Each side's bar: its place, and which end its parts start from (the first side's from its right). */
const BARS = [
  { x: 10, y: 40, fromRight: true },
  { x: 202, y: 40, fromRight: false },
] as const;
const BAR = { length: 0x98, height: 0x18, inset: 2, capWidth: 6, rightCap: 0x96 };
const PARTS: readonly BarPart[] = ['health', 'damage', 'lost'];
/** The timer: its two digits' cells, the tens a step left of the ones. */
const TIMER = { ones: 0xb8, y: 0x16, step: 0xf, width: 0x10, height: 0x2e };
const MARKS = { x: [0x97, 0xca], step: [-0xe, 0xe], y: 0x46, width: 0xf, height: 0x12 };
const NAMES = { x: [14, 354], y: 66, height: 16 };
/** The printer's fonts' cells: each glyph's advance, width and height. */
const FONTS = [
  { advance: 9, width: 10, height: 16 },
  { advance: 13, width: 14, height: 24 },
  { advance: 22, width: 24, height: 40 },
] as const;
/** The infinity sign the timer shows when it is stopped. */
export const INFINITY = '∞';

/** The calls, each in its printer block, the last printed first. */
function calls(state: FightState): PlacedPiece[] {
  return state.hud.prints
    .filter((print) => FONTS[print.font] !== undefined && print.text.length > 0)
    .map((print) => {
      const font = FONTS[print.font]!;
      return { x: print.x, y: print.y, w: (print.text.length - 1) * font.advance + font.width, h: font.height, piece: { kind: 'call', font: print.font, colour: print.colour, text: print.text } } as const;
    })
    .reverse();
}

/** The back's pieces, in the order they are added (drawn last to first). */
function back(state: FightState, names: readonly string[]): PlacedPiece[] {
  const hud = state.hud;
  const added: PlacedPiece[] = [];
  for (const side of [0, 1] as const) {
    added.push({ x: NAMES.x[side]!, y: NAMES.y, w: 0, h: NAMES.height, piece: { kind: 'name', side, text: names[side] ?? '', costume: state.fighters[side]!.rosterCode & 3 } });
  }
  hud.marksLit.forEach((marks, side) => {
    marks.forEach((lit, i) => {
      added.push({ x: MARKS.x[side]! + i * MARKS.step[side]!, y: MARKS.y, w: MARKS.width, h: MARKS.height, piece: { kind: 'mark', lit: lit !== 0 } });
    });
  });
  const tens = TIMER.ones - TIMER.step;
  const text = hud.timerShown === -1 ? INFINITY : String((hud.timerShown % 100) + 100).slice(1);
  added.push({ x: tens, y: TIMER.y, w: TIMER.ones + TIMER.width - tens, h: TIMER.height, piece: { kind: 'timer', text } });
  for (let side = 0; side < 2; side += 1) {
    const { x, y, fromRight } = BARS[side]!;
    const bar = hud.bars[side]!;
    added.push({ x, y, w: BAR.capWidth, h: BAR.height, piece: { kind: 'cap', end: 0 } });
    added.push({ x: x + BAR.rightCap, y, w: BAR.capWidth, h: BAR.height, piece: { kind: 'cap', end: 1 } });
    const lengths = [bar.shown, bar.damage - bar.shown, BAR.length - bar.damage];
    let cursor = fromRight ? x + BAR.inset + BAR.length : x + BAR.inset;
    PARTS.forEach((part, k) => {
      const length = lengths[k]!;
      if (length === 0) return;
      const left = fromRight ? cursor - length : cursor;
      cursor = fromRight ? left : cursor + length;
      added.push({ x: left, y, w: length, h: BAR.height, piece: { kind: 'bar', part } });
    });
  }
  return added.reverse();
}

/** The HUD's pieces this field, given each side's name: the back's, then the front's, each in drawing order. */
export function layOutHud(state: FightState, names: readonly string[]): { back: PlacedPiece[]; front: PlacedPiece[] } {
  return { back: state.hud.back === 0 ? [] : back(state, names), front: calls(state) };
}
