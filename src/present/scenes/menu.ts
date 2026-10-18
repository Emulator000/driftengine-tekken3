/**
 * The mode menu: the title's picture, and drawn new the list's rows set in their colours and cut to the
 * list's band, and under the picked row the bar of light that brightens once the list comes to
 * rest: a band glowing from its middle, with a bright line along each edge, laid opaque, black at
 * its ends, as the original's is. Last, over everything, light is taken away from the band's top
 * and bottom edges (`LightLayer`), as the original takes it: its rows darken there each channel
 * alike, toward black, and so does the foot of the picture's "3" where it reaches into the band.
 * At the screen's top right, small, the game's version, and a notice where a newer one is out.
 */
import type { GameState } from '../../sim/game/state.ts';
import type { LightLayer } from '../2d/light.ts';
import { printStyle } from '../hud/theme.ts';
import type { ScreenLayer } from './screen.ts';
import { drawTitlePicture } from './title.ts';

/** The list's band (its rows are cut to it), the depth its top and bottom edges darken over, and the strip across it that is darkened. */
const BAND = { top: 0x13c, bottom: 0x1b0, edge: 0x1c, left: 0x44, right: 0x12c } as const;
/** How much light the edges take at the band's top and bottom, of 255, to none at their inner side. */
const TAKEN = { top: 0xe0, bottom: 0xf8 } as const;
const NONE = [0, 0, 0] as const;
/** The bar: its top and bottom lines, its lines' thickness, how far in from the screen's sides it starts. */
const BAR = { top: 0x168, bottom: 0x184, line: 2, inset: 8, width: 368 } as const;
const FULL = 0x100;
/** The corner's line: how far in from the screen's right edge it ends, its baseline, its capitals' height and the gap between its parts. */
const CORNER = { inset: 8, baseline: 24, cap: 9, gap: 4 } as const;
const VERSION_STYLE = printStyle(0, 6);
const NOTICE_STYLE = printStyle(0, 5);

/** The menu's corner, as the page tells it: the game's version, and the notice of a newer one (empty where there is none). */
export interface MenuCorner {
  readonly version: string;
  readonly notice: string;
}

export const NO_CORNER: MenuCorner = { version: '', notice: '' };

const grey = (level: number): string => `rgb(${level}, ${level}, ${level})`;

export function drawMenu(game: GameState, art: ScreenLayer, text: ScreenLayer, over: LightLayer, picture: ImageBitmap, corner: MenuCorner = NO_CORNER): void {
  drawTitlePicture(art, picture);
  const k = game.menu.bar / FULL;
  if (0 < k) {
    const band = [
      [0, grey(0)],
      [0.5, grey(Math.round(0xc0 * k))],
      [1, grey(0)],
    ] as const;
    const line = [
      [0, grey(0)],
      [0.5, grey(Math.round(0xf8 * k))],
      [1, grey(0)],
    ] as const;
    text.ramp(band, BAR.inset, BAR.top, BAR.width - BAR.inset * 2, BAR.bottom - BAR.top, true);
    text.ramp(line, 0, BAR.top, BAR.width, BAR.line, true);
    text.ramp(line, 0, BAR.bottom, BAR.width, BAR.line, true);
  }
  text.clip(BAND.top, BAND.bottom);
  for (const run of game.printed) text.print(run);
  text.clip(null);
  const [top, bottom] = [TAKEN.top / 0xff, TAKEN.bottom / 0xff];
  over.quad('subtract', BAND.left, BAND.top, BAND.right - BAND.left, BAND.edge, [top, top, top], NONE);
  over.quad('subtract', BAND.left, BAND.bottom - BAND.edge, BAND.right - BAND.left, BAND.edge, NONE, [bottom, bottom, bottom]);
  drawCorner(text, corner);
}

/** The corner's line, its right end at the screen's right edge however wide: the version in silver, a newer one's notice after it in gold. */
function drawCorner(text: ScreenLayer, { version, notice }: MenuCorner): void {
  let right = text.edges.right - CORNER.inset;
  for (const [part, style] of [
    [notice, NOTICE_STYLE],
    [version, VERSION_STYLE],
  ] as const) {
    if (part === '') continue;
    const set = text.type('menu corner', part, style, CORNER.cap);
    if (set === null) continue;
    text.text('menu corner', part, style, CORNER.cap, right - set.ink, CORNER.baseline);
    right -= set.ink + CORNER.gap;
  }
}
