/**
 * A scene's 2D, drawn new over the finished picture: pictures painted once into an atlas at the
 * display's resolution and placed on the original's screen, 368 pixels across and 480 lines down,
 * stretched to the middle 4:3 of the window as the console's display stretches it. The printer's
 * runs are set in the game's typefaces, in their font's colours, each spaced to span the block the
 * original fills with its glyphs.
 */
import type { RendererApi } from '@driftengine/core';
import { createSpritePass, drawSprite, type SpritePass, type UvRect } from '@driftengine/ui2d';
import type { PrintRun } from '../../sim/game/state.ts';
import { FONTS } from '../../sim/game/printer.ts';
import { PICTURE_SCALE } from '../../assets/manifest.ts';
import { PaintAtlas, sideFor, TILES, type AtlasPicture } from '../2d/atlas.ts';
import { screenTint } from '../2d/tint.ts';
import { setType, type TypeStyle } from '../2d/type.ts';
import { printStyle } from '../hud/theme.ts';

/** The original's screen: its width and height, and the units across a 4:3 display's height. */
export const SCREEN = { width: 368, lines: 480, across: 276 } as const;
const MIDDLE = SCREEN.width / 2;
/** Per printer font: a glyph's cell (its width and height), its capitals' height and its baseline under the cell's top, in lines. */
const GLYPHS = [
  { width: 10, height: 16, cap: 12.5, baseline: 14 },
  { width: 14, height: 24, cap: 18, baseline: 21 },
  { width: 24, height: 40, cap: 32, baseline: 36 },
  { width: 24, height: 40, cap: 32, baseline: 36 },
] as const;
/** How much wider than the original's block a run may set before it is squeezed, and the block's edges its ink stays inside. */
const SLACK = 1.12;
const INSET = 0.75;

/** A sprite as a layer drew it: its texture, place, texels and tint (null none); kept a frame, so the frame can be drawn again fading out. */
export interface DrawnSprite {
  readonly texture: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly uv: UvRect | null;
  readonly tint: readonly [number, number, number, number] | null;
}

/** Set type: its picture, its ink's left edge and baseline in device pixels, and its ink's width in units. */
export interface SetPicture {
  readonly picture: AtlasPicture;
  readonly left: number;
  readonly baseline: number;
  readonly ink: number;
}

/**
 * A rectangle of an original picture (in the original's texels; the picture is `PICTURE_SCALE`
 * times their size) painted over a device rectangle with the browser's best smoothing.
 */
export function paintOriginal(g: OffscreenCanvasRenderingContext2D, source: ImageBitmap, sx: number, sy: number, sw: number, sh: number, left: number, top: number, w: number, h: number): void {
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(source, sx * PICTURE_SCALE, sy * PICTURE_SCALE, sw * PICTURE_SCALE, sh * PICTURE_SCALE, left, top, w, h);
}

export class ScreenLayer {
  readonly atlas: PaintAtlas;
  private readonly pass: SpritePass;
  private readonly handle: number;
  private readonly renderer: RendererApi;
  private readonly transform = new Float32Array(6);
  private readonly tint = new Float32Array(4);
  private lines = 0;
  /** The least side the atlas is sized to. */
  private readonly least: number;
  /** Device pixels a unit across and down, and the window's width. */
  kx = 1;
  ky = 1;
  private width = 1;
  /** What placed pictures are multiplied by: a fade to black, and their opacity. */
  private shade = 1;
  private alpha = 1;
  /** The lines pictures are cut to, top and bottom, or none; and the units across, left and right. */
  private clipping: readonly [number, number] | null = null;
  private across: readonly [number, number] | null = null;
  /** The sprites this frame drew so far. */
  private sprites: DrawnSprite[] = [];

  /**
   * `screens`, when given, sizes the atlas for that many windows' worth of pictures each time the
   * window's height changes (the scenes' large pictures span the window, and a dissolve shows two
   * scenes' at once), never below `atlasSize` a side; without it the atlas holds `atlasSize` a
   * side. Either takes more when what a frame shows does not fit.
   */
  constructor(renderer: RendererApi, label: string, capacity = 2048, atlasSize = 2048, private readonly screens = 0) {
    this.renderer = renderer;
    this.pass = createSpritePass({ label, capacity, slots: TILES });
    this.handle = renderer.registerPass(this.pass);
    this.atlas = new PaintAtlas([this.pass], atlasSize);
    this.least = atlasSize;
  }

  /**
   * A field's drawing begun, for a window `width` by `height` device pixels, with `keep` while
   * sprites drawn frames ago are still drawn again (a dissolve's frame before, whose pictures then
   * stay). Returns true when the atlas was emptied (a new height: every picture drawn before it
   * gone).
   */
  begin(width: number, height: number, keep = false): boolean {
    this.width = width;
    this.atlas.keep = keep;
    let emptied = false;
    if (height !== this.lines) {
      this.lines = height;
      this.kx = height / SCREEN.across;
      this.ky = height / SCREEN.lines;
      this.atlas.resize(this.screens === 0 ? this.least : sideFor(this.screens, width, height, this.least));
      emptied = true;
    }
    const half = (SCREEN.across / 2) * (width / height);
    this.transform.set([1 / half, 0, 0, -2 / SCREEN.lines, -MIDDLE / half, 1]);
    this.pass.setTransform(this.transform);
    this.pass.reset();
    this.shade = 1;
    this.alpha = 1;
    this.clipping = null;
    this.across = null;
    this.sprites = [];
    return emptied;
  }

  /** The sprites drawn since the frame began (taken before the next frame begins, they are the last frame's). */
  get drawn(): readonly DrawnSprite[] {
    return this.sprites;
  }

  /** Sprites a frame drew, drawn again at `alpha` (its pictures still in the atlas). */
  redraw(sprites: readonly DrawnSprite[], alpha: number): void {
    const tint = new Float32Array(4);
    for (const s of sprites) {
      const [r, g, b, a] = s.tint ?? [1, 1, 1, 1];
      tint.set([r, g, b, a * alpha]);
      drawSprite(this.pass.batch, s.texture, { x: s.x, y: s.y, w: s.w, h: s.h }, s.uv, tint);
    }
  }

  private submit(texture: number, x: number, y: number, w: number, h: number, uv: UvRect | null, tint: Float32Array | null): void {
    if (this.across !== null) {
      /* Cut to the units across, its picture's columns cut with it. */
      const [from, to] = this.across;
      const start = Math.max(x, from);
      const end = Math.min(x + w, to);
      if (end <= start) return;
      if (uv !== null) {
        const { u0, u1, v0, v1 } = uv;
        const u = (at: number): number => u0 + ((at - x) / w) * (u1 - u0);
        uv = { u0: u(start), v0, u1: u(end), v1 };
      }
      [x, w] = [start, end - start];
    }
    drawSprite(this.pass.batch, texture, { x, y, w, h }, uv, tint);
    this.sprites.push({ texture, x, y, w, h, uv, tint: tint === null ? null : [tint[0]!, tint[1]!, tint[2]!, tint[3]!] });
  }

  /** How opaque the pictures placed from now on are. */
  setAlpha(alpha: number): void {
    this.alpha = Math.max(0, Math.min(1, alpha));
  }

  /** Pictures placed from now on cut to the lines from `top` to `bottom`, or not cut (null). */
  clip(top: number | null, bottom = 0): void {
    this.clipping = top === null ? null : [top, bottom];
  }

  /** Pictures placed from now on cut to the units across from `left` to `right`, or not cut (null). */
  clipAcross(left: number | null, right = 0): void {
    this.across = left === null ? null : [left, right];
  }

  /** What the pictures placed from now on are multiplied by (1 as painted, 0 black). */
  setShade(shade: number): void {
    this.shade = Math.max(0, Math.min(1, shade));
  }

  /** The window's left and right edges, in units. */
  get edges(): { left: number; right: number } {
    const half = this.width / 2 / this.kx;
    return { left: MIDDLE - half, right: MIDDLE + half };
  }

  /** Type set in a style at a cap height in lines, painted under `key` the first time. */
  type(key: string, text: string, style: TypeStyle, cap: number, maxWidth = Infinity, fill = 0): SetPicture | null {
    const set = setType(this.atlas.context, text, style, cap * this.ky, maxWidth, fill);
    const picture = this.atlas.picture(`${key} ${cap} ${text}`, set.width, set.height, (g, left, top) => set.paint(g, left, top));
    return picture && { picture, left: set.left, baseline: set.baseline, ink: (set.width - set.left * 2) / this.kx };
  }

  /** A picture with its top left at a point in units, on whole device pixels. */
  put(picture: AtlasPicture, x: number, y: number, w = picture.width / this.kx, h = picture.height / this.ky, uv: UvRect = picture.uv): void {
    const px = Math.round(this.width / 2 + (x - MIDDLE) * this.kx);
    const py = Math.round(y * this.ky);
    let [top, height, cut] = [py / this.ky, h, uv];
    if (this.clipping !== null) {
      const [from, to] = this.clipping;
      const start = Math.max(top, from);
      const end = Math.min(top + h, to);
      if (end <= start) return;
      const v = (line: number): number => uv.v0 + ((line - top) / h) * (uv.v1 - uv.v0);
      cut = { u0: uv.u0, v0: v(start), u1: uv.u1, v1: v(end) };
      [top, height] = [start, end - start];
    }
    screenTint(this.tint, [this.shade, this.shade, this.shade, this.alpha]);
    this.submit(picture.slot, MIDDLE + (px - this.width / 2) / this.kx, top, w, height, cut, this.shade < 1 || this.alpha < 1 ? this.tint : null);
  }

  /** A picture at a point in units, at a size, its colours multiplied by `tint` (red, green, blue, alpha, 0 to 1). */
  putTinted(picture: AtlasPicture, x: number, y: number, w: number, h: number, tint: readonly [number, number, number, number]): void {
    const px = Math.round(this.width / 2 + (x - MIDDLE) * this.kx);
    screenTint(this.tint, tint);
    this.submit(picture.slot, MIDDLE + (px - this.width / 2) / this.kx, Math.round(y * this.ky) / this.ky, w, h, picture.uv, this.tint);
  }

  /**
   * A crop of an original picture (`source`, its rectangle in the original's texels; the picture
   * itself already enlarged `PICTURE_SCALE` times) painted at its size on the display, smoothly.
   */
  original(key: string, source: ImageBitmap, sx: number, sy: number, sw: number, sh: number, w: number, h: number): AtlasPicture | null {
    const [pw, ph] = [Math.round(w * this.kx), Math.round(h * this.ky)];
    return this.atlas.picture(`original ${key} ${pw} ${ph}`, pw, ph, (g, left, top) => paintOriginal(g, source, sx, sy, sw, sh, left, top, pw, ph));
  }

  /**
   * A gradient through colours (each at its share of the way, as CSS colours) stretched over a
   * rectangle in units, down it or across it.
   */
  ramp(stops: readonly (readonly [number, string])[], x: number, y: number, w: number, h: number, across = false): void {
    const key = `ramp ${across ? 'across' : 'down'} ${stops.map(([at, colour]) => `${at}:${colour}`).join(' ')}`;
    const [pw, ph] = across ? [256, 4] : [4, 256];
    const picture = this.atlas.picture(key, pw, ph, (g, left, top) => {
      const gradient = across ? g.createLinearGradient(left, 0, left + pw, 0) : g.createLinearGradient(0, top, 0, top + ph);
      for (const [at, colour] of stops) gradient.addColorStop(at, colour);
      g.fillStyle = gradient;
      g.fillRect(left, top, pw, ph);
    });
    if (picture === null) return;
    /* Sampled from the picture's middle, so the edge texels' neighbours never bleed in. */
    const { u0, v0, u1, v1 } = picture.uv;
    const inset = across ? { u0: u0 + (u1 - u0) / pw / 2, v0: (v0 + v1) / 2, u1: u1 - (u1 - u0) / pw / 2, v1: (v0 + v1) / 2 } : { u0: (u0 + u1) / 2, v0: v0 + (v1 - v0) / ph / 2, u1: (u0 + u1) / 2, v1: v1 - (v1 - v0) / ph / 2 };
    this.put(picture, x, y, w, h, inset);
  }

  /** A rectangle of colour (as it looks, with its alpha) in units, cut like the pictures. */
  fill(x: number, y: number, w: number, h: number, colour: readonly [number, number, number, number]): void {
    if (this.clipping !== null) {
      const [from, to] = this.clipping;
      const [start, end] = [Math.max(y, from), Math.min(y + h, to)];
      if (end <= start) return;
      [y, h] = [start, end - start];
    }
    screenTint(this.tint, colour);
    this.submit(this.pass.white, x, y, w, h, null, this.tint);
  }

  /** A fade over everything placed so far: toward black below level 0x100, toward white above. */
  fade(level: number): void {
    if (level === 0x100) return;
    const amount = Math.min(0xff, level < 0x100 ? 0xff - level : level - 0x100) / 0xff;
    this.fillWindow(level < 0x100 ? [0, 0, 0, amount] : [1, 1, 1, amount]);
  }

  /** The whole window in a colour. */
  fillWindow(colour: readonly [number, number, number, number]): void {
    const { left, right } = this.edges;
    this.fill(left, 0, right - left, SCREEN.lines, colour);
  }

  /** Text with its baseline at `y`, from `x`, in a style; returns where its ink ends. */
  text(key: string, text: string, style: TypeStyle, cap: number, x: number, y: number): number {
    const set = this.type(key, text, style, cap);
    if (set === null) return x;
    this.put(set.picture, x - set.left / this.kx, y - set.baseline / this.ky);
    return x + set.ink;
  }

  /** A printed run, set in its font's type and colours over the block the original's glyphs fill. */
  print(run: PrintRun): void {
    const glyph = GLYPHS[run.font] ?? GLYPHS[0];
    const block = (run.text.length - 1) * FONTS[run.font]!.advance + glyph.width;
    /* The fonts draw `@` as the copyright sign. */
    const text = run.text.replaceAll('@', '©');
    const set = this.type(`print ${run.font} ${run.colour} ${block}`, text, printStyle(run.font, run.colour), glyph.cap, block * this.kx * SLACK, (block - INSET * 2) * this.kx);
    if (set === null) return;
    this.put(set.picture, run.x + block / 2 - set.picture.width / 2 / this.kx, run.y + glyph.baseline - set.baseline / this.ky);
  }

  /** The field's 2D drawn over the finished picture. */
  end(): void {
    this.atlas.upload();
    this.renderer.drawPass(this.handle);
  }
}
