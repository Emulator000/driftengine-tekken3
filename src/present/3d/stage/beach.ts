/**
 * Tekken Ball's beach. The panorama the game scrolls behind the court as the camera moves and
 * turns, its bottom on a point of the sea the game picks each frame, drawn over the sand as the
 * game draws it (its sea and shore along the horizon), its sky's colour above it, nothing at all
 * while the knockout's first replay plays. And the court's lines on the sand: the
 * strip down the middle and the two lines either side of it, glowing white at their middle and
 * fading to nothing at both ends, added onto the floor where the fighters stand.
 */
import type { MeshHandle, RendererApi, SurfaceMaterial, SurfaceTextureHandle } from '@driftengine/core';
import { createSpritePass, drawSprite, type SpritePass } from '@driftengine/ui2d';
import { PICTURE_SCALE } from '../../../assets/manifest.ts';
import { cosine, sine } from '../../../sim/math/angles.ts';
import { div } from '../../../sim/math/integers.ts';
import { rotateLong } from '../../../sim/math/matrix.ts';
import { projectPoint } from '../../../sim/math/projection.ts';
import type { FightData, FightState } from '../../../sim/fight/state.ts';

/** Tekken Ball's stage, and its sky (8-bit sRGB). */
export const BEACH_STAGE = 0x13;
export const BEACH_SKY = [0x21, 0x3a, 0x94] as const;
/** The panorama's cells; how far its scroll moves for the eye's sideways movement; where the point its bottom stands on lies (ahead of the origin, and under the floor). */
const TILE = 0x20;
const SCROLL = 0x60;
const HORIZON = { ahead: 0x1a00, below: 0x100 } as const;
/** The knockout's first replay, which shows no panorama. */
const FIRST_REPLAY = 1;
/** The fight's picture: its middle across, its lines, and its units across a 4:3 picture's height. */
const PICTURE = { middle: 192, lines: 480, across: 288 } as const;
/** Copies of the panorama laid side by side, enough to cross the widest picture. */
const COPIES = 3;
/** The court: its rows along z (the first, the step), the middle strip's half-width, each row's grey, how wide a line is drawn and how high over the floor (mm). */
const COURT = { first: -8000, step: 0x600, strip: 100, shades: [0, 0x30, 0x60, 0x90, 0xc0, 0x90, 0x60, 0x30, 0], line: 24, lift: 2 } as const;

const linear = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

/** Where the panorama stands: its texel at the picture's left edge (x 0), and its bottom's line; null while it is not drawn. */
export function panoramaPlace(state: FightState, data: FightData, columns: number): { left: number; bottom: number } | null {
  const phase = state.match.ball.replaysShown;
  if (phase === FIRST_REPLAY) return null;
  const drawn = state.camera.drawn;
  const eye = drawn.eye;
  const s = sine(data.math, drawn.yaw);
  const c = cosine(data.math, drawn.yaw);
  const v = [0, 0, 0];
  rotateLong(state.view.rotation, eye[0]!, eye[1]!, eye[2]!, v);
  const width = columns * TILE;
  let scroll = (div((Math.imul(v[0]!, c) + Math.imul(v[2]!, s)) | 0, SCROLL) >> 12) + ((state.ball.backdrop.refYaw - drawn.yaw) >> 1);
  scroll %= width;
  if (scroll < 0) scroll += width;
  const column = scroll >> 5;
  const flow = state.round.flow;
  const start = flow === 2 && phase !== 0 ? column + 0x10 : 3 <= flow ? column + 10 : column + 2;
  const point = [(eye[0]! - Math.imul(s, HORIZON.ahead)) >> 12, HORIZON.below, (eye[2]! + Math.imul(c, HORIZON.ahead)) >> 12];
  const moved = [0, 0, 0];
  rotateLong(state.view.rotation, point[0]!, point[1]!, point[2]!, moved);
  const t = state.view.translation;
  const bottom = projectPoint(state.screen, (moved[0]! + t[0]!) | 0, (moved[1]! + t[1]!) | 0, (moved[2]! + t[2]!) | 0).y;
  return { left: start * TILE + (scroll & (TILE - 1)), bottom };
}

export class Beach {
  private readonly renderer: RendererApi;
  /** The panorama: a 2D pass of its copies side by side, drawn over the floor where it is asked for. */
  private readonly panorama: SpritePass;
  private readonly panoramaPass: number;
  private readonly transform = new Float32Array(6);
  private readonly columns: number;
  private readonly rows: number;
  private readonly courtMaterial: SurfaceMaterial<SurfaceTextureHandle>;
  private readonly strip: MeshHandle;
  /** The two lines, made for the court's width when it changes. */
  private lines: { width: number; mesh: MeshHandle } | null = null;
  private readonly court = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

  /** `picture` the panorama (enlarged), `white` a white texel for the court's colours. */
  constructor(renderer: RendererApi, picture: ImageBitmap, white: SurfaceTextureHandle) {
    this.renderer = renderer;
    this.columns = picture.width / PICTURE_SCALE / TILE;
    this.rows = picture.height / PICTURE_SCALE / TILE;
    this.panorama = createSpritePass({ label: 'beach panorama', capacity: COPIES, slots: 1 });
    this.panoramaPass = renderer.registerPass(this.panorama);
    this.panorama.setTexture(0, picture, { colorSpace: 'srgb', filter: 'linear' });
    this.courtMaterial = { albedo: white, cutout: 0, doubleSided: true };
    this.strip = this.band([-COURT.strip, COURT.strip]);
  }

  /** A band along the court's rows across the given x ranges (pairs of edges), each row its grey. */
  private band(edges: readonly number[]): MeshHandle {
    const rows = COURT.shades.length;
    const strips = edges.length / 2;
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    for (let k = 0; k < strips; k += 1) {
      const base = positions.length / 3;
      for (let i = 0; i < rows; i += 1) {
        const z = COURT.first + i * COURT.step;
        const grey = linear(COURT.shades[i]!);
        for (const x of [edges[k * 2]!, edges[k * 2 + 1]!]) {
          positions.push(x / 1000, COURT.lift / 1000, -z / 1000);
          colors.push(grey, grey, grey);
        }
        if (i < rows - 1) {
          const v = base + i * 2;
          indices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
        }
      }
    }
    const n = positions.length / 3;
    return this.renderer.createMesh({
      positions: new Float32Array(positions),
      normals: new Float32Array(n * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)),
      colors: new Float32Array(colors),
      emissive: new Float32Array(n),
      uvs: new Float32Array(n * 2),
      indices: new Uint32Array(indices),
    });
  }

  /** The court's lines added onto the floor, along the fighters' middle in depth, `width` from the middle. */
  drawCourt(state: FightState, width: number): void {
    if (this.lines === null || this.lines.width !== width) {
      if (this.lines !== null) this.renderer.disposeMesh(this.lines.mesh);
      const half = COURT.line / 2;
      this.lines = { width, mesh: this.band([-width - half, -width + half, width - half, width + half]) };
    }
    const [a, b] = state.fighters;
    this.court[14] = -((a.skeleton.base.translation[2]! + b.skeleton.base.translation[2]!) >> 1) / 1000;
    const renderer = this.renderer;
    renderer.setMaterial(this.courtMaterial);
    for (const mesh of [this.strip, this.lines.mesh]) renderer.drawTranslucentMesh(mesh, this.court, 1, { additive: true, depthWrite: false, lit: false, fog: false });
    renderer.setMaterial(null);
  }

  /**
   * The panorama where the game puts it on the picture, over the floor and the court's lines and
   * under everything drawn after it, as the game draws its sprites: `aspect` the picture's.
   */
  drawPanorama(state: FightState, data: FightData, aspect: number): void {
    const place = panoramaPlace(state, data, this.columns);
    if (place === null) return;
    const half = (PICTURE.across / 2) * aspect;
    this.transform.set([1 / half, 0, 0, -2 / PICTURE.lines, -PICTURE.middle / half, 1]);
    const pass = this.panorama;
    pass.setTransform(this.transform);
    pass.reset();
    const width = this.columns * TILE;
    const height = this.rows * TILE;
    let x = -place.left;
    while (PICTURE.middle - half < x) x -= width;
    for (let k = 0; k < COPIES; k += 1) drawSprite(pass.batch, 0, { x: x + k * width, y: place.bottom - height, w: width, h: height }, { u0: 0, v0: 0, u1: 1, v1: 1 }, null);
    this.renderer.drawPass(this.panoramaPass);
  }
}

/** The clear colour behind the beach (linear): its sky, or black while the panorama is not drawn. */
export function beachClear(state: FightState): [number, number, number] {
  if (state.match.ball.replaysShown === FIRST_REPLAY) return [0, 0, 0];
  return [linear(BEACH_SKY[0]), linear(BEACH_SKY[1]), linear(BEACH_SKY[2])];
}
