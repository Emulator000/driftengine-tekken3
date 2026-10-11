/**
 * The title, and the attract overlay's fields around its intro (the picture after it, the fade to
 * white over it): the original's picture (the TEKKEN 3 logo over its red kanji) and the namco mark
 * as they are, enlarged smoothly to the display; the printer's lines and this project's own line drawn
 * new; and the scene's fades: over the picture alone from the picture's table entry, over
 * everything from the front's.
 */
import type { GameState } from '../../sim/game/state.ts';
import { TitleShows } from '../../sim/game/title.ts';
import { drawEngineLine } from './logo.ts';
import { paintOriginal, SCREEN, type ScreenLayer } from './screen.ts';

/** The most of the atlas the picture takes, in device pixels either way. */
const MOST = 2040;
/** The fades' table entries: up to the picture's they lie under the lines. */
const PICTURE_LAYER = 3;
/** The namco mark's place and size, and this project's line's centre and top. */
const MARK = { x: 0x97, y: 0x184, w: 0x48, h: 0x10 } as const;
const ENGINE_LINE = { centre: 0xb8, top: 0x1c8 } as const;

/** The title's picture over the whole screen, at most the atlas's size (stretched back when it was painted smaller). */
export function drawTitlePicture(art: ScreenLayer, picture: ImageBitmap, shade = 1): void {
  const fit = Math.min(1, MOST / (SCREEN.width * art.kx), MOST / (SCREEN.lines * art.ky));
  const [w, h] = [SCREEN.width * art.kx * fit, SCREEN.lines * art.ky * fit];
  const painted = art.atlas.picture(`title picture ${w} ${h}`, w, h, (g, left, top) => paintOriginal(g, picture, 0, 0, SCREEN.width, SCREEN.lines, left, top, w, h));
  if (painted === null) return;
  art.setShade(shade);
  art.put(painted, 0, 0, SCREEN.width, SCREEN.lines);
  art.setShade(1);
}

/** The namco mark under the start line, the original's picture enlarged smoothly. */
function drawMark(text: ScreenLayer, mark: ImageBitmap): void {
  const [w, h] = [MARK.w * text.kx, MARK.h * text.ky];
  const painted = text.atlas.picture(`namco ${w} ${h}`, w, h, (g, left, top) => paintOriginal(g, mark, 0, 0, MARK.w, MARK.h, left, top, w, h));
  if (painted !== null) text.put(painted, MARK.x, MARK.y, MARK.w, MARK.h);
}

/** The title's field as `shows` has it (the title's own, or the attract overlay's), its printed lines and its fades. */
export function drawTitle(game: GameState, shows: number, art: ScreenLayer, text: ScreenLayer, pictures: { readonly title: ImageBitmap; readonly namco: ImageBitmap }): void {
  const picture = pictures.title;
  if (shows === TitleShows.BLACK) art.fillWindow([0, 0, 0, 1]);
  else if (shows === TitleShows.DARK_PICTURE) drawTitlePicture(art, picture, 0.5);
  else if (TitleShows.TITLE <= shows && shows <= TitleShows.PICTURE) {
    drawTitlePicture(art, picture);
    if (shows <= TitleShows.NO_START) drawMark(text, pictures.namco);
    if (shows <= TitleShows.NO_MARK) drawEngineLine(text, ENGINE_LINE.centre, ENGINE_LINE.top);
  }
  for (const run of game.printed) text.print(run);
  for (const { layer, level } of game.fades) (layer <= PICTURE_LAYER ? art : text).fade(level);
}
