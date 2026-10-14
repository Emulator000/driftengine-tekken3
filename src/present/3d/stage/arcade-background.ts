/**
 * An arcade stage's background, laid out as its game lays it, behind everything else: its
 * panorama's tiles in rows of 64 lines down the picture's 480, scrolled as the camera turns (the
 * stage's own number of degrees across the game's 512-pixel screen, each pixel 1.25 lines wide on
 * a 4:3 picture, and as far again on each side of a wider one); each place round the turn showing
 * its tile, the colour below, the filled tiles' colour or nothing; its top moving with the camera's
 * pitch; the colour above it, and the colour below it down to three quarters of the picture, where
 * the stage draws them. Stage 3 has a gradient in place of its tiles, and stage 6 its colour over
 * the whole picture.
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
/** Where the colour below the panorama ends. */
const BELOW_TO = (LINES * 3) / 4;
/** The white texels under the tiles, which the colours are drawn with. */
const WHITE = 4;
/** A turn, in the camera's 4096ths; the gradient's bands, in lines. */
const TURN = 0x1000;
const BAND = 2;
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
  private readonly colours: { readonly cell: number[]; readonly above: number[]; readonly below: number[] };

  constructor(renderer: RendererApi, files: ArcadePanoramaFiles) {
    this.renderer = renderer;
    const layout = files.layout;
    this.layout = layout;
    this.pass = createSpritePass({ label: 'arcade background', capacity: CAPACITY, slots: 1 });
    this.pass.setTexture(0, files.picture, { colorSpace: 'srgb', filter: 'linear' });
    this.handle = renderer.registerPass(this.pass);
    const height = layout.rows * TILE + WHITE;
    this.texel = [1 / files.picture.width, 1 / files.picture.height];
    this.white = { u0: 0.25, v0: (layout.rows * TILE + 1) / height, u1: 0.75, v1: (layout.rows * TILE + WHITE - 1) / height };
    this.colours = { cell: linear(layout.colours.cell), above: linear(layout.colours.above), below: linear(layout.colours.below) };
  }

  private fill(x: number, y: number, w: number, h: number, colour: ArrayLike<number>): void {
    if (w > 0 && h > 0) drawSprite(this.pass.batch, 0, { x, y, w, h }, this.white, colour);
  }

  /** The background for a camera looking `look` (its pitch and yaw in 4096ths), `aspect` the picture's, `sceneryYaw` the scenery's turn (4096ths). */
  draw(look: { readonly pitch: number; readonly yaw: number }, aspect: number, sceneryYaw: number): void {
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

    const gradient = layout.gradient;
    if (gradient !== null) {
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

    if (top > 0 && layout.drawn.above) this.fill(0, 0, width, top, this.colours.above);
    /* The pixel of the panorama at the screen's left edge, as the game counts it from the turn, then as far again as the picture is wider. */
    const unit = Math.trunc((layout.degrees * TURN) / 360);
    const scrolled = Math.trunc((mod(sceneryYaw - look.yaw, TURN) * SCREEN) / unit);
    const left = scrolled - (width - SCREEN * PIXEL) / 2 / PIXEL;
    const first = Math.floor(left / TILE);
    const across = Math.ceil(width / PIXEL / TILE) + 1;
    const pictureHeight = layout.rows * TILE + WHITE;
    const [du, dv] = this.texel;
    let y = top;
    for (let r = 0; r < layout.rows; r += 1, y += TILE) {
      if (y < -TILE || y > LINES) continue;
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
        } else if (cell === 'b') this.fill(x, y, TILE * PIXEL, TILE, this.colours.below);
        else if (cell === 't') this.fill(x, y, TILE * PIXEL, TILE, this.colours.cell);
      }
    }
    if (y < LINES && layout.drawn.below) {
      const from = Math.max(y, 0);
      this.fill(0, from, width, BELOW_TO - from, this.colours.below);
    }
    this.renderer.drawPass(this.handle);
  }
}
