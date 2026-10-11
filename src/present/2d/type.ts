/**
 * Type for the 2D layer, painted into a canvas at the size it is shown: a string in a typeface at a
 * cap height (in device pixels), filled with a vertical gradient from the capitals' top to the
 * baseline, ringed by outlines (outermost first), with an optional bevel (a darker copy offset
 * under the fill) and a soft shadow under everything. Widths and offsets are shares of the cap
 * height, so a style reads the same at any size.
 */

export interface Typeface {
  readonly family: string;
  readonly weight: number;
}

export interface TypeStyle {
  readonly face: Typeface;
  /** The fill's colours, from the capitals' top (0) to the baseline (1). */
  readonly fill: readonly (readonly [number, string])[];
  /** Rings around the letters, outermost first: each its width and colour. */
  readonly outlines: readonly (readonly [number, string])[];
  /** Space added between letters. */
  readonly tracking: number;
  readonly bevel?: { readonly x: number; readonly y: number; readonly colour: string };
  readonly shadow?: { readonly x: number; readonly y: number; readonly blur: number; readonly colour: string };
}

/** A string set in a style: its size in device pixels, where its ink starts and its baseline lies, and how to paint it with its top left at a point. */
export interface SetType {
  readonly width: number;
  readonly height: number;
  /** From its left to the letters' ink, and from its top to the baseline. */
  readonly left: number;
  readonly baseline: number;
  paint(g: OffscreenCanvasRenderingContext2D, left: number, top: number): void;
}

type Context = OffscreenCanvasRenderingContext2D;

const font = (face: Typeface, px: number): string => `${face.weight} ${px}px "${face.family}", sans-serif`;
const capRatios = new Map<string, number>();

/** A typeface's cap height per pixel of font size. */
function capRatio(g: Context, face: Typeface): number {
  const key = `${face.family} ${face.weight}`;
  let ratio = capRatios.get(key);
  if (ratio === undefined) {
    g.font = font(face, 100);
    ratio = g.measureText('H').actualBoundingBoxAscent / 100 || 0.7;
    capRatios.set(key, ratio);
  }
  return ratio;
}

/** The most a fill widens letters before it spaces them out. */
const MOST_WIDENED = 1.35;

/**
 * `text` set in `style` at `cap` pixels of cap height; squeezed across to `maxWidth` pixels when
 * wider (the outlines and shadow included). With `fill`, set to span that many pixels of ink, as a
 * fixed-width font's glyphs fill their cells: its letters widened (by a third at most), then
 * spaced out evenly.
 */
export function setType(g: Context, text: string, style: TypeStyle, cap: number, maxWidth = Infinity, fill = 0): SetType {
  const px = cap / capRatio(g, style.face);
  g.font = font(style.face, px);
  let tracking = style.tracking * cap;
  g.letterSpacing = `${tracking}px`;
  let metrics = g.measureText(text);
  const gaps = [...text].length - 1;
  const ink = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight;
  let widen = 1;
  if (0 < ink && ink < fill) {
    widen = Math.min(MOST_WIDENED, fill / ink);
    const short = fill / widen - ink;
    if (0 < gaps && 0 < short) {
      tracking += short / gaps;
      g.letterSpacing = `${tracking}px`;
      metrics = g.measureText(text);
    }
  }
  g.letterSpacing = '0px';
  const ring = style.outlines.reduce((sum, [width]) => sum + width, 0) * cap;
  const shadow = style.shadow;
  const reach = shadow ? Math.max(Math.abs(shadow.x), Math.abs(shadow.y)) * cap + shadow.blur * cap * 2 : 0;
  const bevel = style.bevel ? Math.max(Math.abs(style.bevel.x), Math.abs(style.bevel.y)) * cap : 0;
  const margin = Math.ceil(ring + Math.max(reach, bevel) + 1);
  const ascent = Math.max(cap, metrics.actualBoundingBoxAscent);
  const descent = Math.max(0, metrics.actualBoundingBoxDescent);
  const inkLeft = -metrics.actualBoundingBoxLeft;
  const inkWidth = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight;
  const natural = Math.ceil((inkWidth + margin * 2) * widen);
  const across = widen * Math.min(1, maxWidth / natural);
  return {
    width: Math.ceil((inkWidth + margin * 2) * across),
    height: Math.ceil(ascent + descent + margin * 2),
    left: margin * across,
    baseline: margin + ascent,
    paint(c, left, top) {
      const baseline = top + margin + ascent;
      c.save();
      c.translate(left, 0);
      c.scale(across, 1);
      const x = margin - inkLeft;
      c.font = font(style.face, px);
      c.letterSpacing = `${tracking}px`;
      c.lineJoin = 'round';
      let width = ring * 2;
      style.outlines.forEach(([share, colour], i) => {
        c.lineWidth = width;
        c.strokeStyle = colour;
        if (i === 0 && shadow) {
          c.shadowOffsetX = shadow.x * cap;
          c.shadowOffsetY = shadow.y * cap;
          c.shadowBlur = shadow.blur * cap;
          c.shadowColor = shadow.colour;
        }
        c.strokeText(text, x, baseline);
        c.shadowColor = 'transparent';
        width -= share * cap * 2;
      });
      if (style.bevel) {
        c.fillStyle = style.bevel.colour;
        c.fillText(text, x + style.bevel.x * cap, baseline + style.bevel.y * cap);
      }
      const gradient = c.createLinearGradient(0, baseline - cap, 0, baseline);
      for (const [at, colour] of style.fill) gradient.addColorStop(at, colour);
      c.fillStyle = gradient;
      c.fillText(text, x, baseline);
      c.letterSpacing = '0px';
      c.restore();
    },
  };
}
