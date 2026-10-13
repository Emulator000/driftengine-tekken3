/**
 * Tekken Force's +LIFE items: each one lying on the stage drawn as the game draws it, a picture
 * facing the camera sized by its depth (0.72 m across at any distance), standing a picture's height
 * over the point it was placed at, a dim shadow behind its lower part (the shadow's picture at a
 * quarter of its colour, half over what is behind). Both are laid in the camera's space and drawn
 * among the fighters, nearer ones over farther ones.
 */
import type { MeshHandle, RendererApi, SurfaceMaterial, SurfaceTextureHandle } from '@driftengine/core';
import { projectPoint } from '../../../sim/math/projection.ts';
import type { FightState } from '../../../sim/fight/state.ts';

/** An item lying on the stage. */
const LYING = 1;
/** The picture's width and height (screen units, times a quarter of the depth), and the shadow's strength. */
const SIZE = { width: 0x15e00, height: 0x2bc00 } as const;
const SHADOW = { colour: 0.25, alpha: 0.5 } as const;

/** A rectangle facing the camera: across from `left` to `right`, down from `top` to `bottom` (screen units from the point), at the point's depth. */
export interface ItemRect {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/**
 * An item's picture and its shadow on the screen about the item's point, for its depth: the
 * picture two of its heights over the point to one, the shadow its width high under the picture's
 * bottom, both centred across.
 */
export function itemRects(depth: number): { item: ItemRect; shadow: ItemRect } {
  let z = depth >> 2;
  if (z === 0) z = 1;
  const w = Math.trunc(SIZE.width / z);
  const h = Math.trunc(SIZE.height / z);
  const left = -Math.trunc(w / 2);
  return { item: { left, right: left + w, top: -2 * h, bottom: -h }, shadow: { left, right: left + w, top: -h - w, bottom: -h } };
}

/** The inverse of a 3 × 3 matrix (row by row). */
function inverse(m: readonly number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m as [number, number, number, number, number, number, number, number, number];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C || 1;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}

export class ForceItems {
  private readonly renderer: RendererApi;
  private readonly quad: MeshHandle;
  private readonly item: SurfaceMaterial<SurfaceTextureHandle>;
  private readonly shadow: SurfaceMaterial<SurfaceTextureHandle>;
  private readonly model = new Float32Array(16);

  constructor(renderer: RendererApi, item: SurfaceTextureHandle, shadow: SurfaceTextureHandle) {
    this.renderer = renderer;
    this.item = { albedo: item, cutout: 0.5, doubleSided: true };
    this.shadow = { albedo: shadow, cutout: 0.5, doubleSided: true };
    this.quad = renderer.createMesh({
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
      colors: new Float32Array(12).fill(1),
      emissive: new Float32Array(4),
      uvs: new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
      indices: new Uint32Array([0, 1, 2, 1, 3, 2]),
    });
  }

  /**
   * The model matrix taking the unit quad onto a rectangle facing the camera at camera-space point
   * `p` (mm), the rectangle in screen units about it at depth `depth`, back to the world's place in
   * the engine's axes.
   */
  private place(state: FightState, back: readonly number[], p: readonly number[], depth: number, rect: ItemRect): Float32Array {
    const per = depth / (state.screen.distance || 500);
    const t = state.view.translation;
    const world = (sx: number, sy: number): number[] => {
      const c = [p[0]! + sx * per - t[0]!, p[1]! + sy * per - t[1]!, p[2]! - t[2]!];
      const w = [0, 1, 2].map((row) => back[row * 3]! * c[0]! + back[row * 3 + 1]! * c[1]! + back[row * 3 + 2]! * c[2]!);
      return [w[0]! / 1000, -w[1]! / 1000, -w[2]! / 1000];
    };
    const o = world(rect.left, rect.top);
    const across = world(rect.right, rect.top);
    const down = world(rect.left, rect.bottom);
    const ex = [0, 1, 2].map((k) => across[k]! - o[k]!);
    const ey = [0, 1, 2].map((k) => down[k]! - o[k]!);
    this.model.set([ex[0]!, ex[1]!, ex[2]!, 0, ey[0]!, ey[1]!, ey[2]!, 0, 0, 0, 1, 0, o[0]!, o[1]!, o[2]!, 1]);
    return this.model;
  }

  /** Each item lying on the stage, its shadow and then its picture. */
  draw(state: FightState): void {
    if (!state.force.items.some((item) => item.state === LYING)) return;
    const r = state.view.rotation;
    const t = state.view.translation;
    const back = inverse(r.map((v) => v / 4096));
    const renderer = this.renderer;
    for (const item of state.force.items) {
      if (item.state !== LYING) continue;
      const p = [0, 1, 2].map((row) => (r[row * 3]! * item.x + r[row * 3 + 1]! * item.y + r[row * 3 + 2]! * item.z) / 4096 + t[row]!);
      const { depth } = projectPoint(state.screen, Math.round(p[0]!), Math.round(p[1]!), Math.round(p[2]!));
      if (depth <= 0) continue;
      const rects = itemRects(depth);
      renderer.setMaterial(this.shadow);
      renderer.drawTranslucentMesh(this.quad, this.place(state, back, p, p[2]!, rects.shadow), SHADOW.alpha, { lit: false, fog: false, depthWrite: false, tint: [SHADOW.colour, SHADOW.colour, SHADOW.colour] });
      renderer.setMaterial(this.item);
      renderer.drawTranslucentMesh(this.quad, this.place(state, back, p, p[2]!, rects.item), 1, { lit: false, fog: false, depthWrite: false });
    }
    renderer.setMaterial(null);
  }
}
