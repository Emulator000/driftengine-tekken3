/**
 * What a scene draws besides the printer's runs (`GameState.drawn`), each after the runs printed
 * so far and in its table entry: rectangles of colour, plain or shaded from their corners, and the
 * pad's buttons the game shows as pictures.
 */
import type { GameState, SceneDraw } from './state.ts';

type Unplaced<T> = T extends SceneDraw ? Omit<T, 'at'> : never;

/** Something drawn, after the runs printed so far. */
export function draw(game: GameState, d: Unplaced<SceneDraw>): void {
  game.drawn.push({ ...d, at: game.printed.length } as SceneDraw);
}

/** A rectangle of colour (0xBBGGRR). */
export function tile(game: GameState, x: number, y: number, w: number, h: number, colour: number, layer: number): void {
  draw(game, { kind: 'tile', x, y, w, h, colour, layer });
}

/** The four buttons' pictures across a line, filling the gaps of `PUSH       OR`: square, triangle, cross, then circle after the OR. */
export function buttonRow(game: GameState, x: number, y: number, layer: number): void {
  const row: readonly (readonly [number, number])[] = [
    [0x80, 0],
    [0x10, 0x12],
    [0x40, 0x24],
    [0x20, 0x50],
  ];
  for (const [bit, dx] of row) draw(game, { kind: 'button', bit, x: x + dx, y, layer });
}
