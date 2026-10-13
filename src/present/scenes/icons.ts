/**
 * A character's icon as the menus and results show it: the original's small icon set in a frame of
 * lines (an outer line, a stripe and an inner line, in one of four colour sets), or the frame alone,
 * as a grid's cell, a slot or a cursor.
 */
import { NO_CHOICE, TAKEN } from '../../sim/game/vs-select.ts';
import type { ScreenLayer } from './screen.ts';

/** A grid cell's frame and the icon set in it (the small icons' sheet: a column a roster id, then a taken cell's blue question mark and no choice's orange one). */
export const FRAME = { w: 36, h: 64, left: 2, top: 3 } as const;
export const ICON = { w: 0x20, h: 0x3a, empty: 23, none: 24 } as const;

/** The small icons' column a code shows: its character's, no choice's orange question mark, or a taken cell's blue one. */
export const iconColumn = (code: number): number => (code < NO_CHOICE ? code >> 2 : code === TAKEN ? ICON.empty : ICON.none);
/** The frame's colour sets: its outer line, its stripe, its inner line (the first the grid's and the slots', the others the cursors'). */
export const SETS: readonly (readonly [string, string, string])[] = [
  ['#000000', '#f888c0', '#e0e0e0'],
  ['#808000', '#c0c000', '#ffff00'],
  ['#800000', '#c00000', '#ff0000'],
  ['#008000', '#00c000', '#00ff00'],
];
/** A frame of lines in a colour set at a level (of 255), as a cell's or a cursor's. */
export function drawFrame(layer: ScreenLayer, x: number, y: number, set: number, level: number): void {
  const [outer, stripe, inner] = SETS[set & 3]!;
  const shade = level / 0x80;
  const colour = (hex: string): [number, number, number, number] => {
    const v = parseInt(hex.slice(1), 16);
    return [Math.min(1, (((v >> 16) & 0xff) / 0xff) * shade), Math.min(1, (((v >> 8) & 0xff) / 0xff) * shade), Math.min(1, ((v & 0xff) / 0xff) * shade), 1];
  };
  layer.fill(x, y, FRAME.w, 1, colour(outer));
  layer.fill(x, y + FRAME.h - 1, FRAME.w, 1, colour(outer));
  layer.fill(x, y, 1, FRAME.h, colour(outer));
  layer.fill(x + FRAME.w - 1, y, 1, FRAME.h, colour(outer));
  layer.fill(x + 1, y + 1, FRAME.w - 2, 1, colour(stripe));
  layer.fill(x + 1, y + FRAME.h - 2, FRAME.w - 2, 1, colour(stripe));
  layer.fill(x + 1, y + 2, FRAME.w - 2, 1, colour(inner));
  layer.fill(x + 1, y + FRAME.h - 3, FRAME.w - 2, 1, colour(inner));
  layer.fill(x + 1, y + 3, 1, FRAME.h - 6, colour(inner));
  layer.fill(x + FRAME.w - 2, y + 3, 1, FRAME.h - 6, colour(inner));
}

/** A character's small icon by code in a frame (in colour set `set`; the empty one past the characters), darker when `dim`. */
export function drawIcon(art: ScreenLayer, smallIcons: ImageBitmap, x: number, y: number, code: number, dim = false, frame = true, set = 0): void {
  if (frame) drawFrame(art, x, y, set, 0x80);
  const column = iconColumn(code);
  const icon = art.original(`icon small ${column}`, smallIcons, column * ICON.w, 0, ICON.w, ICON.h, ICON.w, ICON.h);
  if (icon === null) return;
  if (dim) art.setShade(0.5);
  art.put(icon, x + FRAME.left, y + FRAME.top, ICON.w, ICON.h);
  art.setShade(1);
}
