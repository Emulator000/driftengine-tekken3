/**
 * An arcade stage's background, laid out as its game lays it, behind everything else: its
 * panorama's tiles in rows of 64 lines down the picture's 480, scrolled as the camera turns (the
 * stage's own number of degrees across the game's 512-pixel screen, each pixel 1.25 lines wide on
 * a 4:3 picture, and as far again on each side of a wider one); each place round the turn showing
 * its tile, the colour below, the filled tiles' colour or nothing; its top moving with the camera's
 * pitch; the colour above it, and the colour below it down to three quarters of the picture, where
 * the stage draws them. Stage 3 has a gradient in place of its tiles, and stage 6 its colour over
 * the whole picture. The scenery is seen through the console's camera, not the board's, so where the
 * panorama (or the gradient) would end above the line the floor ends at, it is lowered to meet it,
 * and no colour below opens between them; where that, or a camera looking higher than the board's,
 * brings its top into sight lower than the board ever lays it, its sky goes on up in its own colour
 * (the mean of its top texels, or the gradient's first), each column's top texels fading into it,
 * not the colour above. A cell that draws nothing, which the board's scenery always hides, shows
 * that sky too where nothing stands behind the background.
 */
import { srgbColor, type RendererApi } from '@driftengine/core';
import { createSpritePass, drawSprite, type SpritePass } from '@driftengine/ui2d';
import type { ArcadePanorama, Rgb } from '../../../assets/manifest.ts';
import type { ArcadePanoramaFiles } from '../fight-view.ts';

/** The picture's lines; the game's screen across, in its pixels, and a pixel's width in lines. */
const LINES = 480;
const SCREEN = 512;
const PIXEL = (LINES * 4) / 3 / SCREEN;
/** A tile's side, in texels, pixels and lines. */
const TILE = 64;
/** The rows under the panorama repeating its last, then the white texels under them, which the colours are drawn with. */
const EDGE = 4;
/** Where the colour below the panorama ends. */
const BELOW_TO = (LINES * 3) / 4;
const WHITE = 4;
/** A turn, in the camera's 4096ths; the gradient's bands, in lines. */
const TURN = 0x1000;
const BAND = 2;
/** How far above the panorama its top texels fade into its sky, in lines, and in how many steps. */
const FADE = 24;
const FADE_STEPS = 6;
const CAPACITY = 1024;

const mod = (a: number, n: number): number => ((a % n) + n) % n;
const linear = (rgb: Rgb): [number, number, number, number] => [...srgbColor(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255), 1];

export class ArcadeBackground {
  private readonly renderer: RendererApi;
  private readonly layout: ArcadePanorama;
  private readonly pass: SpritePass;
  private readonly handle: number;
  private readonly transform = new Float32Array(6);
  /** A texel's share of the picture, across and down; where its white is. */
  private readonly texel: readonly [number, number];
  private readonly white: { u0: number; v0: number; u1: number; v1: number };
  private readonly colours: { readonly cell: number[]; readonly above: number[]; readonly below: number[]; readonly sky: number[] };

  constructor(renderer: RendererApi, files: ArcadePanoramaFiles) {
    this.renderer = renderer;
    const layout = files.layout;
    this.layout = layout;
    this.pass = createSpritePass({ label: 'arcade background', capacity: CAPACITY, slots: 1 });
    this.pass.setTexture(0, files.picture, { colorSpace: 'srgb', filter: 'linear' });
    this.handle = renderer.registerPass(this.pass);
    const height = layout.rows * TILE + EDGE + WHITE;
    this.texel = [1 / files.picture.width, 1 / files.picture.height];
    this.white = { u0: 0.25, v0: (layout.rows * TILE + EDGE + 1) / height, u1: 0.75, v1: (layout.rows * TILE + EDGE + WHITE - 1) / height };
    this.colours = { cell: linear(layout.colours.cell), above: linear(layout.colours.above), below: linear(layout.colours.below), sky: linear(layout.colours.sky) };
  }

  private fill(x: number, y: number, w: number, h: number, colour: ArrayLike<number>): void {
    if (w > 0 && h > 0) drawSprite(this.pass.batch, 0, { x, y, w, h }, this.white, colour);
  }

  /**
   * The background for a camera looking `look` (its pitch and yaw in 4096ths), `aspect` the
   * picture's, `sceneryYaw` the scenery's turn (4096ths); `floor` the line the floor ends at ahead
   * (null where none is in sight); `skyBehind` where a sky of its own stands behind the background,
   * which a cell that draws nothing shows.
   */
  draw(look: { readonly pitch: number; readonly yaw: number }, aspect: number, sceneryYaw: number, floor: number | null = null, skyBehind = false): void {
    const layout = this.layout;
    const width = LINES * aspect;
    const pass = this.pass;
    this.transform.set([2 / width, 0, 0, -2 / LINES, -1, 1]);
    pass.setTransform(this.transform);
    pass.reset();
    if (layout.whole) {
      this.fill(0, 0, width, LINES, this.colours.above);
      this.renderer.drawPass(this.handle);
      return;
    }
    const pitch = look.pitch & 0x800 ? (look.pitch & 0xfff) - TURN : look.pitch & 0xfff;
    let top = Math.trunc((-pitch * layout.pitch) / 256) + layout.offset;
    if (layout.most !== null && top > layout.most) top = layout.most;
    if (layout.least !== null && top < layout.least) top = layout.least;
    const laid = top;
    /* Down to where the floor ends, a line past it so no seam shows. */
    const height = layout.gradient !== null ? layout.gradient.lines : layout.rows * TILE;
    if (floor !== null && top + height < floor + 1) top = Math.ceil(floor + 1 - height);
    /* Its top in sight where the board never shows it: lowered past where the board lays it, or past the board's most. */
    const skyOn = top > 0 && (top > laid || (layout.most !== null && top > layout.most));

    const gradient = layout.gradient;
    if (gradient !== null) {
      if (skyOn) this.fill(0, 0, width, top, linear(gradient.from));
      for (let y = 0; y < gradient.lines; y += BAND) {
        const t = (y + BAND / 2) / gradient.lines;
        const rgb = [0, 1, 2].map((k) => gradient.from[k]! + (gradient.to[k]! - gradient.from[k]!) * t) as unknown as Rgb;
        this.fill(0, top + y, width, BAND, linear(rgb));
      }
      const end = top + gradient.lines;
      this.fill(0, end, width, BELOW_TO - end, this.colours.below);
      this.renderer.drawPass(this.handle);
      return;
    }

    if (top > 0 && layout.drawn.above && !skyOn) this.fill(0, 0, width, top, this.colours.above);
    if (skyOn) this.fill(0, 0, width, top, this.colours.sky);
    /* The pixel of the panorama at the screen's left edge, as the game counts it from the turn, then as far again as the picture is wider. */
    const unit = Math.trunc((layout.degrees * TURN) / 360);
    const scrolled = Math.trunc((mod(sceneryYaw - look.yaw, TURN) * SCREEN) / unit);
    const left = scrolled - (width - SCREEN * PIXEL) / 2 / PIXEL;
    const first = Math.floor(left / TILE);
    const across = Math.ceil(width / PIXEL / TILE) + 1;
    const pictureHeight = layout.rows * TILE + EDGE + WHITE;
    const [du, dv] = this.texel;
    let y = top;
    for (let r = 0; r < layout.rows; r += 1, y += TILE) {
      if ((y < -TILE || y > LINES) && !(skyOn && r === 0)) continue;
      const cells = layout.mask[r]!;
      const flipped = layout.flipped === r;
      for (let k = 0; k < across; k += 1) {
        const g = first + k;
        const x = (g * TILE - left) * PIXEL;
        const cell = cells[mod(g, layout.perTurn)];
        if (cell === 'p') {
          const c = mod(g, layout.columns);
          const v0 = (r * TILE) / pictureHeight + dv / 2;
          const v1 = ((r + 1) * TILE) / pictureHeight - dv / 2;
          const source = { u0: c / layout.columns + du / 2, u1: (c + 1) / layout.columns - du / 2, v0: flipped ? v1 : v0, v1: flipped ? v0 : v1 };
          drawSprite(pass.batch, 0, { x, y, w: TILE * PIXEL, h: TILE }, source, null);
          /* The sky on up: the column's top texels, fading into the sky's colour. */
          if (skyOn && r === 0) {
            for (let k = 0; k < FADE_STEPS; k += 1) {
              const h = FADE / FADE_STEPS;
              drawSprite(pass.batch, 0, { x, y: y - (k + 1) * h, w: TILE * PIXEL, h }, { ...source, v1: source.v0 }, [1, 1, 1, 1 - (k + 0.5) / FADE_STEPS]);
            }
          }
        } else if (cell === 'b') this.fill(x, skyOn && r === 0 ? 0 : y, TILE * PIXEL, skyOn && r === 0 ? y + TILE : TILE, this.colours.below);
        else if (cell === 't') this.fill(x, skyOn && r === 0 ? 0 : y, TILE * PIXEL, skyOn && r === 0 ? y + TILE : TILE, this.colours.cell);
        else if (!skyBehind) this.fill(x, y, TILE * PIXEL, TILE, this.colours.sky);
      }
    }
    if (y < LINES && layout.drawn.below) {
      const from = Math.max(y, 0);
      this.fill(0, from, width, BELOW_TO - from, this.colours.below);
    }
    this.renderer.drawPass(this.handle);
  }
}
