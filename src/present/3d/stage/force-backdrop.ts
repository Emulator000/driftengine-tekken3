/**
 * Tekken Force's backdrop: the stage's strip of 64-unit tiles far behind the floor, scrolling one
 * unit for every twenty the camera moves across the view and wrapping round as its map repeats,
 * its bottom on the floor's line 2.5 m ahead of the camera. MISHIMA FORTRESS's strip climbs a step
 * every third column, a black band and black seams behind it. The final stage shows no tiles,
 * only black down to the floor's line.
 *
 * Where the frame is put together from the frames before it (remastered), the backdrop writes a
 * depth of its own (`depthPlane`): drawn as a picture, it would be taken for the farthest thing in
 * sight, which a camera moving across the view does not move at all, and each frame's strip would
 * be blended with where it stood in the last ones, a trail behind every tile while the camera
 * scrolls.
 */
import type { MeshHandle, RendererApi, SurfaceMaterial, SurfaceTextureHandle } from '@driftengine/core';
import { createSpritePass, drawSprite, type SpritePass } from '@driftengine/ui2d';
import { PICTURE_SCALE } from '../../../assets/manifest.ts';
import { cosine, sine } from '../../../sim/math/angles.ts';
import { newProduct, rotate, rotateLong } from '../../../sim/math/matrix.ts';
import { projectPoint } from '../../../sim/math/projection.ts';
import type { FightData, FightState } from '../../../sim/fight/state.ts';

/** Tekken Force's stage records: the first (its first and final stages') and the last. */
export const FORCE_STAGES = { first: 0xf, last: 0x12 } as const;
/** A tile's side; how far the camera moves (in the view's x) for the strip to move a unit; how far ahead of the camera the floor's line is taken (mm). */
const TILE = 64;
const SCROLL = 20;
const AHEAD = 2500;
/** The sloped stage (its index from the first), its slope's angle (4096ths), the columns between its steps, and where its slope starts along the strip. */
const SLOPE = { stage: 3, angle: 0xd8, columns: 3, start: 0xb8 } as const;
/** The black under the sloped strip, the seams under its last row where its map wraps, and the black behind the final stage's floor (its bottom 16 lines under the floor's line). */
const BLACK = { x: 0, y: 20, w: 272, h: 100 } as const;
const SEAM = { w: 64, h: 32 } as const;
const FINAL = { x: 0, y: 20, w: 368, below: 16 } as const;
/** Each column's least and most top (20.12): a tile is drawn only from a tile above the picture to its last line. */
const TOP_FROM = -0x40001;
const TOP_TO = 0x1e0001;
/** The columns the original's picture always covers. */
const COLUMNS = 7;
/** The fight's picture: its middle across, its lines, and its units across a 4:3 picture's height. */
const PICTURE = { middle: 192, lines: 480, across: 288 } as const;
/** How wide the backdrop's depth is, either way, for each metre it stands ahead: past the sides of any view the fight takes. */
const PLANE_REACH = 4;
/** The opacity a draw writing depth alone is drawn at. */
const DEPTH_ONLY = 1 / 1024;

export interface BackdropTile {
  readonly x: number;
  readonly y: number;
  readonly column: number;
  readonly row: number;
}

export interface BackdropRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** What the backdrop draws this frame: black rectangles behind, then its tiles (map column and row) at their places. */
export interface BackdropPlace {
  readonly rects: BackdropRect[];
  readonly tiles: BackdropTile[];
}

/** 20.12 down to a whole unit, as the game shifts it (toward zero). */
const whole = (v: number): number => (v < 0 ? (v + 0xfff) >> 12 : v >> 12);
const floorDiv = (a: number, b: number): number => Math.floor(a / b);
const mod = (a: number, b: number): number => ((a % b) + b) % b;

/** Where the floor's line 2.5 m ahead of the camera falls on the picture (lines). */
export function floorLine(state: FightState): number {
  const eye = state.camera.drawn.eye;
  const p = newProduct();
  rotate(state.view.rotation, eye[0]!, 0, AHEAD, p);
  const t = state.view.translation;
  return projectPoint(state.screen, (p.full[0]! + t[0]!) | 0, (p.full[1]! + t[1]!) | 0, (p.full[2]! + t[2]!) | 0).y;
}

/**
 * The backdrop's pieces this frame in the fight's units, covering the picture from `left` to
 * `right` (at least the original's seven columns).
 */
export function backdropPlace(state: FightState, data: Pick<FightData, 'force' | 'math'>, left: number, right: number): BackdropPlace {
  const rects: BackdropRect[] = [];
  const tiles: BackdropTile[] = [];
  const sy = floorLine(state);
  if (state.force.finalStage !== 0) {
    rects.push({ x: FINAL.x, y: FINAL.y, w: FINAL.w, h: sy - FINAL.below });
    return { rects, tiles };
  }
  const kind = state.stage - FORCE_STAGES.first;
  const map = data.force.stages[kind];
  if (map === undefined) return { rects, tiles };
  const { columns, rows } = map.backdrop;
  const eye = state.camera.drawn.eye;
  const v = [0, 0, 0];
  rotateLong(state.view.rotation, eye[0]!, eye[1]!, eye[2]!, v);
  const width = columns * TILE;
  let scroll = Math.trunc(v[0]! / SCROLL) % width;
  if (scroll < 0) scroll += width;
  const sloped = kind === SLOPE.stage;
  let rise = 0;
  let step = 0;
  if (sloped) {
    const cos = cosine(data.math, SLOPE.angle);
    const sin = sine(data.math, SLOPE.angle);
    rise = Math.trunc((mod(scroll, SLOPE.columns * TILE) * 4096 + SLOPE.start * 4096) / cos) * sin;
    step = Math.trunc((SLOPE.columns * TILE * 4096) / cos) * sin;
    rects.push(BLACK);
  }
  const top = (sy - TILE * rows) * 4096 + rise;
  const first = Math.trunc(scroll / TILE);
  const x0 = -(scroll % TILE);
  const from = Math.min(0, floorDiv(left - x0, TILE));
  const to = Math.max(COLUMNS - 1, Math.ceil((right - x0) / TILE) - 1);
  for (let row = 0; row < rows; row += 1) {
    for (let k = from; k <= to; k += 1) {
      const c = first + k;
      const y = top + TILE * 4096 * row - step * (floorDiv(c, SLOPE.columns) - floorDiv(first, SLOPE.columns));
      const x = x0 + k * TILE;
      if (TOP_FROM < y && y < TOP_TO) tiles.push({ x, y: whole(y), column: mod(c, columns), row });
      if (sloped && row === rows - 1 && mod(c, columns) === 0) rects.push({ x, y: whole(y) + TILE, w: SEAM.w, h: SEAM.h });
    }
  }
  return { rects, tiles };
}

/**
 * Where the backdrop's depth stands, as the model matrix of a square two units across (column-major,
 * metres): square to the view of `view` (column-major, its rows perhaps scaled apart) from `eye`, as
 * far ahead as a wall that slides across the picture as the strip scrolls, a unit for every `SCROLL`
 * the camera moves at the projection's `distance`, so `SCROLL` times that distance (mm).
 */
export function depthPlane(view: ArrayLike<number>, eye: ArrayLike<number>, distance: number, out = new Float32Array(16)): Float32Array {
  const ahead = (SCROLL * distance) / 1000;
  const unit = (v: number[]): number[] => {
    const n = Math.hypot(v[0]!, v[1]!, v[2]!) || 1;
    return v.map((x) => x / n);
  };
  const forward = unit([-view[2]!, -view[6]!, -view[10]!]);
  const across = [view[0]!, view[4]!, view[8]!];
  const along = across[0]! * forward[0]! + across[1]! * forward[1]! + across[2]! * forward[2]!;
  const right = unit(across.map((v, i) => v - forward[i]! * along));
  const up = [right[1]! * forward[2]! - right[2]! * forward[1]!, right[2]! * forward[0]! - right[0]! * forward[2]!, right[0]! * forward[1]! - right[1]! * forward[0]!];
  const half = ahead * PLANE_REACH;
  out.fill(0);
  for (let i = 0; i < 3; i += 1) {
    out[i] = right[i]! * half;
    out[4 + i] = up[i]! * half;
    out[8 + i] = forward[i]!;
    out[12 + i] = eye[i]! + forward[i]! * ahead;
  }
  out[15] = 1;
  return out;
}

/** The backdrop's pass: a sprite per tile from the stage's picture (its map laid out whole), and the black. */
export class ForceBackdrop {
  private readonly renderer: RendererApi;
  private readonly pass: SpritePass;
  private readonly handle: number;
  private readonly transform = new Float32Array(6);
  private readonly columns: number;
  private readonly rows: number;
  /** The backdrop's depth: a square, drawn from either side, and where it stands this frame. */
  private plane: MeshHandle | null = null;
  private readonly planeMaterial: SurfaceMaterial<SurfaceTextureHandle>;
  private readonly planeModel = new Float32Array(16);

  /** `picture` the stage's backdrop laid out whole, enlarged; `white` a white texture. */
  constructor(renderer: RendererApi, picture: ImageBitmap, white: SurfaceTextureHandle) {
    this.renderer = renderer;
    this.planeMaterial = { albedo: white, doubleSided: true };
    this.columns = picture.width / PICTURE_SCALE / TILE;
    this.rows = picture.height / PICTURE_SCALE / TILE;
    this.pass = createSpritePass({ label: 'force backdrop', capacity: 512, slots: 1 });
    this.handle = renderer.registerPass(this.pass);
    this.pass.setTexture(0, picture, { colorSpace: 'srgb', filter: 'linear' });
  }

  /** The backdrop behind everything drawn after it, for a picture of `aspect`. */
  draw(state: FightState, data: Pick<FightData, 'force' | 'math'>, aspect: number): void {
    const half = (PICTURE.across / 2) * aspect;
    const place = backdropPlace(state, data, PICTURE.middle - half, PICTURE.middle + half);
    this.transform.set([1 / half, 0, 0, -2 / PICTURE.lines, -PICTURE.middle / half, 1]);
    const pass = this.pass;
    pass.setTransform(this.transform);
    pass.reset();
    const black = [0, 0, 0, 1];
    for (const r of place.rects) if (0 < r.w && 0 < r.h) drawSprite(pass.batch, pass.white, { x: r.x, y: r.y, w: r.w, h: r.h }, { u0: 0, v0: 0, u1: 1, v1: 1 }, black);
    for (const t of place.tiles) {
      const u0 = t.column / this.columns;
      const v0 = t.row / this.rows;
      drawSprite(pass.batch, 0, { x: t.x, y: t.y, w: TILE, h: TILE }, { u0, v0, u1: u0 + 1 / this.columns, v1: v0 + 1 / this.rows }, null);
    }
    this.renderer.drawPass(this.handle);
  }

  /** The backdrop's depth (`depthPlane`), writing nothing else, for the view `view` from `eye` at the projection's `distance`. */
  drawDepth(view: ArrayLike<number>, eye: ArrayLike<number>, distance: number): void {
    const r = this.renderer;
    this.plane ??= r.createMesh({
      positions: new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
      colors: new Float32Array(12),
      emissive: new Float32Array(4),
      uvs: new Float32Array(8),
      indices: new Uint32Array([0, 1, 2, 1, 3, 2]),
    });
    r.setMaterial(this.planeMaterial);
    r.drawTranslucentMesh(this.plane, depthPlane(view, eye, distance, this.planeModel), DEPTH_ONLY, { depthWrite: true, lit: false, fog: false, tint: [0, 0, 0], reconstructed: true });
    r.setMaterial(null);
  }
}
