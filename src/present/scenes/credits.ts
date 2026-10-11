/**
 * The credits drawn: each line the roll draws set in type at the original's place, stretched across
 * its width (the roll's font, warm orange, its glyphs twelve lines high and wide as the small type
 * for headings and the large for names have them), as bright as the roll makes it; behind a line its band of light, the game's
 * 25 shaded quads (each corner black, half or the band's colour) painted once a width as a mask
 * and laid in the band's colour; and the namco mark the roll ends on, the original's picture
 * enlarged, at its brightness. The roll's screen is the game's, 368 across and 480 lines.
 */
import type { CreditsTables } from '../../sim/data/scenes.ts';
import type { CreditsDraw, GameState } from '../../sim/game/state.ts';
import type { TypeStyle } from '../2d/type.ts';
import { DISPLAY } from '../2d/typefaces.ts';
import { paintOriginal, type ScreenLayer } from './screen.ts';

/** The roll's type: the font's ramp from its pale top to its deep foot. */
const CREDITS_TYPE: TypeStyle = {
  face: DISPLAY,
  fill: [
    [0, '#f8d8b0'],
    [0.3, '#f8b060'],
    [0.65, '#d07000'],
    [1, '#985000'],
  ],
  outlines: [],
  tracking: 0,
};
/** A glyph's capitals' height and its baseline under its top, in lines (the font's glyphs are twelve high). */
const GLYPH = { cap: 9, baseline: 10.5 } as const;
/** The brightness the glyphs and the mark are drawn at in full (of 128). */
const FULL = 128;
/** The credits' mark: its place and size, and its picture's (the original's texels). */
const MARK = { x: 54, y: 220, w: 260, h: 45 } as const;

/** A line's width in the roll's small or large type, as the roll measures it. */
function widthOf(tables: CreditsTables, text: string, small: boolean): number {
  const widths = small ? tables.smallWidths : tables.largeWidths;
  let w = 0;
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c < 49) w += c === 32 ? (small ? 8 : 10) : (widths[c - 33] ?? 0);
    else w += widths[c - 34] ?? 0;
  }
  return w;
}

/**
 * The band's quads, from the game's: each across from one edge to another (offsets from the
 * band's left edge `x0`, with the line's width `w` where the far edge needs it), in one of five
 * rows of three lines from two lines over the line's top, and its four corners' weights (top left,
 * top right, bottom left, bottom right: 0 black, 1 half, 2 the colour).
 */
type Edge = (w: number) => number;
const QUADS: readonly (readonly [Edge, Edge, number, readonly [number, number, number, number]])[] = [
  [() => -16, () => 24, 0, [0, 1, 0, 1]],
  [() => 24, () => 48, 0, [1, 1, 1, 2]],
  [() => 48, (w) => w + 8, 0, [1, 1, 2, 2]],
  [(w) => w + 32, (w) => w + 8, 0, [1, 1, 1, 2]],
  [(w) => w + 72, (w) => w + 32, 0, [0, 1, 0, 1]],
  [() => -32, () => 36, 1, [0, 2, 0, 2]],
  [() => 36, () => 48, 1, [2, 2, 2, 2]],
  [() => 48, (w) => w + 8, 1, [2, 2, 2, 2]],
  [(w) => w + 8, (w) => w + 20, 1, [2, 2, 2, 2]],
  [(w) => w + 20, (w) => w + 88, 1, [2, 0, 2, 0]],
  [() => -32, () => 22, 2, [0, 1, 0, 2]],
  [() => 22, () => 48, 2, [1, 2, 2, 2]],
  [() => 48, (w) => w + 8, 2, [2, 2, 2, 2]],
  [(w) => w + 34, (w) => w + 8, 2, [1, 2, 2, 2]],
  [(w) => w + 88, (w) => w + 34, 2, [0, 1, 0, 2]],
  [() => -32, () => 36, 3, [0, 2, 0, 2]],
  [() => 36, () => 48, 3, [2, 2, 2, 2]],
  [() => 48, (w) => w + 8, 3, [2, 2, 2, 2]],
  [(w) => w + 8, (w) => w + 20, 3, [2, 2, 2, 2]],
  [(w) => w + 20, (w) => w + 88, 3, [2, 0, 2, 0]],
  [() => 24, () => -16, 4, [1, 0, 1, 0]],
  [() => 48, () => 24, 4, [2, 1, 1, 1]],
  [() => 48, (w) => w + 8, 4, [2, 2, 1, 1]],
  [(w) => w + 8, (w) => w + 32, 4, [2, 1, 1, 1]],
  [(w) => w + 32, (w) => w + 72, 4, [1, 0, 1, 0]],
];
/** The band's left, past its line's band edge, its width beyond the line's, and its height in lines from two over the line. */
const BAND = { left: -32, extra: 120, lines: 15, rowLines: 3 } as const;

/** The band's mask for a line `w` wide, a texel a unit and a line: each quad's corners' weights interpolated across it. */
function bandMask(w: number): ImageData {
  const width = w + BAND.extra;
  const image = new ImageData(width, BAND.lines);
  for (const [from, to, row, corners] of QUADS) {
    let [a, b] = [from(w) - BAND.left, to(w) - BAND.left];
    let [tl, tr, bl, br] = corners;
    if (b < a) {
      [a, b] = [b, a];
      [tl, tr, bl, br] = [tr, tl, br, bl];
    }
    for (let y = 0; y < BAND.rowLines; y += 1) {
      const v = (y + 0.5) / BAND.rowLines;
      for (let x = Math.max(0, a); x < Math.min(width, b); x += 1) {
        const u = (x + 0.5 - a) / (b - a);
        const weight = ((tl * (1 - u) + tr * u) * (1 - v) + (bl * (1 - u) + br * u) * v) / 2;
        const o = ((row * BAND.rowLines + y) * width + x) * 4;
        image.data.set([255, 255, 255, Math.round(Math.min(1, image.data[o + 3]! / 255 + weight) * 255)], o);
      }
    }
  }
  return image;
}

function drawBand(layer: ScreenLayer, draw: Extract<CreditsDraw, { kind: 'band' }>): void {
  const width = draw.width + BAND.extra;
  const [pw, ph] = [Math.max(1, Math.round(width * layer.kx)), Math.max(1, Math.round(BAND.lines * layer.ky))];
  const picture = layer.atlas.picture(`credits band ${draw.width} ${pw} ${ph}`, pw, ph, (g, left, top) => {
    const mask = new OffscreenCanvas(width, BAND.lines);
    mask.getContext('2d')!.putImageData(bandMask(draw.width), 0, 0);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(mask, left, top, pw, ph);
  });
  if (picture === null) return;
  layer.putTinted(picture, draw.x0 + BAND.left, draw.y - 2, width, BAND.lines, [draw.red / 255, draw.green / 255, draw.blue / 255, 1]);
}

function drawLine(layer: ScreenLayer, tables: CreditsTables, draw: Extract<CreditsDraw, { kind: 'text' }>): void {
  if (draw.text.length === 0) return;
  const block = widthOf(tables, draw.text, draw.small);
  /* The font's glyphs are as wide as they are high on a screen of half the lines: the type is stretched across the line's width. */
  const set = layer.type('credits', draw.text, CREDITS_TYPE, GLYPH.cap);
  if (set === null) return;
  const ink = set.picture.width / layer.kx - (set.left * 2) / layer.kx;
  const across = ink <= 0 ? 1 : block / ink;
  layer.setShade(Math.min(1, draw.brightness / FULL));
  layer.put(set.picture, draw.x - (set.left / layer.kx) * across, draw.y + GLYPH.baseline - set.baseline / layer.ky, (set.picture.width / layer.kx) * across, set.picture.height / layer.ky);
  layer.setShade(1);
}

/** This frame's credits: bands under their lines, then the lines and the mark. */
export function drawCredits(game: GameState, tables: CreditsTables, art: ScreenLayer, layer: ScreenLayer, mark: ImageBitmap): void {
  for (const draw of game.credits.drawn) if (draw.kind === 'band') drawBand(art, draw);
  for (const draw of game.credits.drawn) {
    if (draw.kind === 'text') drawLine(layer, tables, draw);
    else if (draw.kind === 'mark') {
      const [w, h] = [MARK.w * layer.kx, MARK.h * layer.ky];
      const picture = layer.atlas.picture(`credits mark ${w} ${h}`, w, h, (g, left, top) => paintOriginal(g, mark, 0, 0, MARK.w, MARK.h, left, top, w, h));
      if (picture === null) continue;
      layer.setShade(Math.min(1, draw.brightness / FULL));
      layer.put(picture, MARK.x, MARK.y, MARK.w, MARK.h);
      layer.setShade(1);
    }
  }
}
