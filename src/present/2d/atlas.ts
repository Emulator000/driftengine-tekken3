/**
 * Pictures painted once into canvases and drawn from them as sprites. Each is asked for by a key
 * and painted the first time, at the size its painter gives in device pixels (so it is drawn one
 * texel to a pixel), into one of the atlas's tiles: canvases `TILE` texels a side, each the texture
 * of a slot of its own, so a picture painted sends only the tile it landed in to the GPU again,
 * where one canvas for the whole atlas sent all of it (a slot's texture goes up whole: 0.8 ms a
 * tile 1024 a side, 42 ms an atlas 5120 a side). A picture larger than a tile has a tile of its
 * own size. In a tile pictures are packed along a skyline (each at the lowest place it fits, so a
 * wide one sits under a row of small ones, where shelves left it no room) with a gap so filtering
 * never reaches a neighbour, each on a multiple of 8 texels (the canvas dithers gradients in a
 * pattern 8 pixels square, so a picture on its grid is painted the same wherever it lands), and
 * stay where they were painted until their tile is emptied.
 *
 * An atlas holds as many texels as its owner gives it (`resize`). A picture that finds no room
 * empties the tiles asked for longest ago, those with nothing asked for this frame or the one
 * before, until its tile fits; with none to empty, or while the owner still draws a frame painted
 * before (`keep`: a dissolve's frame before), a tile is added past that, so an atlas is as large as
 * one frame needs on this display.
 *
 * The canvases are kept in memory rather than on the GPU (`willReadFrequently`): every upload
 * copies a whole canvas into a texture, and from a canvas on the GPU the browser reads it back
 * first, 15 to 230 ms a 2048 or 4096 canvas where from memory it takes 3 to 40.
 */
import type { SpritePass, UvRect } from '@driftengine/ui2d';

export interface AtlasPicture {
  /** The slot of the tile it is in, in each of the atlas's passes. */
  readonly slot: number;
  readonly uv: UvRect;
  /** Its size in device pixels. */
  readonly width: number;
  readonly height: number;
}

type Context = OffscreenCanvasRenderingContext2D;

/**
 * What an atlas is drawn by: a sprite pass, its tiles in its slots from 0 to `TILES`. Its colours
 * are painted for the screen, so every pass decodes them as it reads them (`srgb`) and the screen
 * encode gives them back as painted: inside the frame the resolve's, over the finished picture
 * the 2D layer's own.
 */
export type AtlasPass = Pick<SpritePass, 'setTexture' | 'updateTexture'>;

const GAP = 2;
const ALIGN = 8;
/** A tile's side: what a tile sends up the first time it goes (four times as many at 2048 took five times as long). */
export const TILE = 1024;
/** The most tiles an atlas has: its passes' slots. */
export const TILES = 64;
/** The largest side an atlas's budget is given for: the largest texture every WebGPU device takes. */
export const LARGEST = 8192;
const OPTIONS = { filter: 'linear', colorSpace: 'srgb' } as const;

/**
 * An atlas's side for `screens` windows' worth of pictures of `width` by `height` device pixels,
 * wider than a picture as wide as the window, and at least `least` (to `LARGEST`): its budget is
 * that side squared.
 */
export function sideFor(screens: number, width: number, height: number, least: number): number {
  const side = Math.max(Math.sqrt(screens * width * height), width + GAP * 2 + 1);
  return Math.min(LARGEST, Math.max(least, Math.ceil(side / 256) * 256));
}

/** The texels a picture `size` across (or down) takes in a tile: itself and the gap after it, to a multiple of `ALIGN`. */
const cell = (size: number): number => Math.ceil((size + GAP) / ALIGN) * ALIGN;
/** Where a tile's first cell starts across and down, so the picture in it, a gap on, starts on a multiple of `ALIGN`. */
const START = ALIGN - GAP;

interface Run {
  x: number;
  w: number;
  y: number;
}

interface Tile {
  readonly canvas: OffscreenCanvas;
  readonly context: Context;
  readonly slot: number;
  /** Whether it holds one picture larger than a tile. */
  readonly own: boolean;
  /** The packing's skyline: runs across the tile, each with the top of the free space above it. */
  skyline: Run[];
  readonly keys: string[];
  /** The frame a picture in it was last asked for on. */
  asked: number;
  /** What was painted in it since it last went up, or null. */
  dirty: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Whether its texture went up whole once, so what is painted after goes up alone. */
  sent: boolean;
}

function canvasOf(width: number, height: number): { canvas: OffscreenCanvas; context: Context } {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) throw new Error('no 2D context for a paint atlas');
  return { canvas, context };
}

/**
 * A cell `w` by `h` (a picture and the gap after it, with one gap kept before the tile's edges)
 * reserved at the lowest place along a tile's skyline it fits, leftmost of those; null when it
 * fits nowhere.
 */
function place(tile: Tile, w: number, h: number): { x: number; y: number } | null {
  const line = tile.skyline;
  const { width, height } = tile.canvas;
  let best: { at: number; x: number; y: number } | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const x = line[i]!.x;
    if (width < x + w + GAP) break;
    let y = 0;
    for (let j = i; j < line.length && line[j]!.x < x + w; j += 1) y = Math.max(y, line[j]!.y);
    if (height < y + h + GAP) continue;
    if (best === null || y < best.y) best = { at: i, x, y };
  }
  if (best === null) return null;
  /* The runs under the rectangle give way to one at its foot; one it ends inside keeps its rest. */
  const end = best.x + w;
  const kept = line.slice(0, best.at);
  kept.push({ x: best.x, w, y: best.y + h });
  for (let j = best.at; j < line.length; j += 1) {
    const run = line[j]!;
    const runEnd = run.x + run.w;
    if (runEnd <= end) continue;
    if (run.x < end) kept.push({ x: end, w: runEnd - end, y: run.y });
    else kept.push(run);
  }
  tile.skyline = [];
  for (const run of kept) {
    const before = tile.skyline[tile.skyline.length - 1];
    if (before !== undefined && before.y === run.y) before.w += run.w;
    else tile.skyline.push({ ...run });
  }
  return { x: best.x, y: best.y };
}

export class PaintAtlas {
  /** A context to measure type with (each tile paints with its own). */
  readonly context: Context;
  private readonly pictures = new Map<string, { picture: AtlasPicture; tile: Tile }>();
  private tiles: Tile[] = [];
  /** The tiles' texels together, and what the owner gives the atlas. */
  private texels = 0;
  private budget: number;
  /** Slots whose tile was emptied for good, their textures to be let go at the next upload, and what they hold then (a texel). */
  private readonly released = new Set<number>();
  /** The texel, on a canvas with a context: WebGPU copies nothing from a canvas without one, and throws. */
  private readonly blank = canvasOf(1, 1).canvas;
  /** A tile's canvas kept from one emptied, for the next. */
  private spare: { canvas: OffscreenCanvas; context: Context } | null = null;
  /** The frames it was uploaded on (once each). */
  private frames = 0;
  /** Set while the owner still draws pictures asked for frames ago (a dissolve's frame before): nothing is emptied for room. */
  keep = false;

  private readonly passes: readonly AtlasPass[];

  constructor(passes: readonly AtlasPass[], side = 2048) {
    this.passes = passes;
    this.budget = side * side;
    this.context = canvasOf(1, 1).context;
  }

  /** Everything painted forgotten. */
  clear(): void {
    for (const tile of [...this.tiles]) this.drop(tile);
  }

  /** The atlas emptied, to hold as many texels as a square `side` a side (sized for a new display). */
  resize(side: number): void {
    this.budget = side * side;
    this.clear();
  }

  /** The picture under `key`, painted by `paint` (into the rectangle at its `left`, `top`) the first time; null when no tile has room. */
  picture(key: string, width: number, height: number, paint: (g: Context, left: number, top: number) => void): AtlasPicture | null {
    const found = this.pictures.get(key);
    if (found) {
      found.tile.asked = this.frames;
      return found.picture;
    }
    const w = Math.max(1, Math.ceil(width));
    const h = Math.max(1, Math.ceil(height));
    const room = this.room(cell(w), cell(h));
    if (room === null) return null;
    const { tile } = room;
    const left = room.x + GAP;
    const top = room.y + GAP;
    const g = tile.context;
    g.save();
    g.beginPath();
    g.rect(left, top, w, h);
    g.clip();
    paint(g, left, top);
    g.restore();
    const { width: across, height: down } = tile.canvas;
    const picture = { slot: tile.slot, uv: { u0: left / across, v0: top / down, u1: (left + w) / across, v1: (top + h) / down }, width: w, height: h };
    this.pictures.set(key, { picture, tile });
    tile.keys.push(key);
    tile.asked = this.frames;
    const d = tile.dirty;
    tile.dirty = d === null ? { x0: left, y0: top, x1: left + w, y1: top + h } : { x0: Math.min(d.x0, left), y0: Math.min(d.y0, top), x1: Math.max(d.x1, left + w), y1: Math.max(d.y1, top + h) };
    return picture;
  }

  /**
   * A place for a cell `w` by `h`: in a tile going up this frame anyway if one has room, else in
   * another, else in a new tile (one of its own size when it is larger than a tile); null when no
   * tile can be made.
   */
  private room(w: number, h: number): { tile: Tile; x: number; y: number } | null {
    const own = TILE < START + w + GAP || TILE < START + h + GAP;
    if (!own) {
      for (const going of [true, false]) {
        for (const tile of this.tiles) {
          if (tile.own || (tile.dirty !== null) !== going) continue;
          const spot = place(tile, w, h);
          if (spot !== null) return { tile, ...spot };
        }
      }
    }
    const tile = this.add(own ? START + w + GAP : TILE, own ? START + h + GAP : TILE, own);
    if (tile === null) return null;
    const spot = place(tile, w, h);
    return spot && { tile, ...spot };
  }

  /**
   * A new tile `width` by `height` texels, after the tiles asked for longest ago are emptied until
   * it fits the budget and a slot is free (none emptied while `keep`, nor any asked for this frame
   * or the one before); past the budget when none can be; null when every slot is taken.
   */
  private add(width: number, height: number, own: boolean): Tile | null {
    const stale = this.keep ? [] : this.tiles.filter((t) => t.asked < this.frames - 1).sort((a, b) => a.asked - b.asked);
    for (const tile of stale) {
      if (this.texels + width * height <= this.budget && this.tiles.length < TILES) break;
      this.drop(tile);
    }
    if (TILES <= this.tiles.length) return null;
    let slot = 0;
    while (this.tiles.some((t) => t.slot === slot)) slot += 1;
    let made = !own && this.spare !== null ? this.spare : null;
    if (made !== null) {
      this.spare = null;
      made.context.clearRect(0, 0, width, height);
    } else made = canvasOf(width, height);
    const tile: Tile = { ...made, slot, own, skyline: [{ x: START, w: width - START, y: START }], keys: [], asked: this.frames, dirty: { x0: 0, y0: 0, x1: width, y1: height }, sent: false };
    this.tiles.push(tile);
    this.texels += width * height;
    this.released.delete(slot);
    return tile;
  }

  /** A tile emptied for good: its pictures forgotten, its slot let go. */
  private drop(tile: Tile): void {
    for (const key of tile.keys) this.pictures.delete(key);
    this.tiles = this.tiles.filter((t) => t !== tile);
    this.texels -= tile.canvas.width * tile.canvas.height;
    this.released.add(tile.slot);
    if (!tile.own) this.spare = { canvas: tile.canvas, context: tile.context };
  }

  /**
   * The tiles painted since they last went up, sent to each pass, and the textures of the slots let
   * go replaced by a texel: the one place the atlas reaches the GPU. A tile goes up whole the first
   * time, then only the rectangle painted in it since.
   */
  upload(): void {
    this.frames += 1;
    for (const slot of this.released) for (const pass of this.passes) pass.setTexture(slot, this.blank, OPTIONS);
    this.released.clear();
    for (const tile of this.tiles) {
      const d = tile.dirty;
      if (d === null) continue;
      if (tile.sent) {
        const region = { x: d.x0, y: d.y0, width: d.x1 - d.x0, height: d.y1 - d.y0 };
        for (const pass of this.passes) pass.updateTexture(tile.slot, tile.canvas, region);
      } else {
        for (const pass of this.passes) pass.setTexture(tile.slot, tile.canvas, OPTIONS);
        tile.sent = true;
      }
      tile.dirty = null;
    }
  }
}
