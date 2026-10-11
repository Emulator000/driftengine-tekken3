/**
 * The mode menu: the title's picture, and drawn new the list's rows set in their colours and cut to the
 * list's band, and under the picked row the bar of light that brightens once the list comes to
 * rest: a band glowing from its middle, with a bright line along each edge, laid opaque, black at
 * its ends, as the original's is. Last, over everything, light is taken away from the band's top
 * and bottom edges (`LightLayer`), as the original takes it: its rows darken there each channel
 * alike, toward black, and so does the foot of the picture's "3" where it reaches into the band.
 */
import type { GameState } from '../../sim/game/state.ts';
import type { LightLayer } from '../2d/light.ts';
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

const grey = (level: number): string => `rgb(${level}, ${level}, ${level})`;

export function drawMenu(game: GameState, art: ScreenLayer, text: ScreenLayer, over: LightLayer, picture: ImageBitmap): void {
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
}
