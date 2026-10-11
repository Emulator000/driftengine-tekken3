/**
 * The logo scene drawn new: "NAMCO PRESENTS." over black as the printer laid it, fading in and out
 * with the scene's level, and this project's own line under it (`MADE WITH DRIFTENGINE`), smaller, in
 * the same colours.
 */
import type { GameState } from '../../sim/game/state.ts';
import { printStyle } from '../hud/theme.ts';
import type { ScreenLayer } from './screen.ts';

/** The port's line: its centre and top, as the smallest font at six tenths its size (each glyph's advance and cell), and its capitals' height and baseline. */
const LINE = { centre: 0xb8, top: 0x10e, advance: 9 * 0.6, cell: 6, cap: 7.5, baseline: 8 } as const;
const PARTS = [
  ['MADE WITH', 0],
  ['DRIFTENGINE', 10],
] as const;
/** How far inside its block a part's ink stays at each end. */
const INSET = 0.5;

/** The port's line, centred at `centre` with its top at `top`: each part spaced to fill its glyphs' block. */
export function drawEngineLine(layer: ScreenLayer, centre: number, top: number): void {
  const length = PARTS[1][1] + PARTS[1][0].length;
  const left = centre - ((length - 1) * LINE.advance + LINE.cell) / 2;
  PARTS.forEach(([text, from], k) => {
    const x = left + from * LINE.advance;
    const block = (text.length - 1) * LINE.advance + LINE.cell;
    const set = layer.type(`engine ${k} ${block}`, text, printStyle(0, k === 0 ? 6 : 2), LINE.cap, Infinity, (block - INSET * 2) * layer.kx);
    if (set !== null) layer.put(set.picture, x + block / 2 - set.picture.width / 2 / layer.kx, top + LINE.baseline - set.baseline / layer.ky);
  });
}

export function drawLogo(game: GameState, layer: ScreenLayer): void {
  const { shows, level } = game.logo;
  if (shows === 3) return;
  layer.fillWindow([0, 0, 0, 1]);
  if (shows === 2) return;
  layer.setShade(shows === 0 ? Math.min(level, 0x100) / 0x100 : 1);
  for (const run of game.printed) layer.print(run);
  drawEngineLine(layer, LINE.centre, LINE.top);
  layer.setShade(1);
}
