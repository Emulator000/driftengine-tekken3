/**
 * A stage's scenery (`STG1` version 2, scripts/lib/stage.mjs): its 36 cells, each its own mesh so
 * the cells the game culls are left out, in game axes of 8 mm units turned into
 * the player's metres with Y up. Drawn unlit, texture times vertex colour, as the PlayStation draws
 * its stage polygons.
 */
import type { MeshHandle, RendererApi, SurfaceMaterial, SurfaceTextureHandle } from '@driftengine/core';

const STG_MAGIC = 0x31475453;
const UNIT_M = 0.008;
const CELLS = 36;

export interface Stage {
  /** Per cell of the 6 × 6 grid, its mesh, or null where the cell has no polygons. */
  readonly cells: readonly (MeshHandle | null)[];
  /** The model's cell size, which the game's culling grid is built from. */
  readonly cellSize: number;
  readonly atlasWidth: number;
  readonly atlasHeight: number;
  readonly material: SurfaceMaterial<SurfaceTextureHandle>;
}

export function createStage(renderer: RendererApi, buffer: ArrayBuffer, texture: SurfaceTextureHandle): Stage {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== STG_MAGIC || view.getUint32(4, true) !== 2) throw new Error('not a version 2 stage mesh; run `npm run extract`');
  const n = view.getUint32(8, true);
  const indexCount = view.getUint32(12, true);
  const width = view.getUint16(16, true);
  const height = view.getUint16(18, true);
  const cellSize = view.getUint32(20, true);
  const ranges: [number, number][] = [];
  for (let c = 0; c < CELLS; c += 1) ranges.push([view.getUint32(24 + c * 8, true), view.getUint32(28 + c * 8, true)]);
  let at = 24 + CELLS * 8;
  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const uvs = new Float32Array(n * 2);
  for (let i = 0; i < n; i += 1) {
    positions[i * 3] = view.getInt16(at, true) * UNIT_M;
    positions[i * 3 + 1] = -view.getInt16(at + 2, true) * UNIT_M;
    positions[i * 3 + 2] = -view.getInt16(at + 4, true) * UNIT_M;
    /* The PlayStation modulates a texel by the polygon's colour over 128. */
    for (let k = 0; k < 3; k += 1) colors[i * 3 + k] = view.getUint8(at + 6 + k) / 128;
    uvs[i * 2] = view.getUint16(at + 10, true) / width;
    uvs[i * 2 + 1] = view.getUint16(at + 12, true) / height;
    at += 20;
  }
  const indices = new Uint32Array(indexCount);
  for (let i = 0; i < indexCount; i += 1) indices[i] = view.getUint32(at + i * 4, true);
  const cells = ranges.map(([start, count]) => {
    if (count === 0) return null;
    const own = indices.subarray(start, start + count);
    let lo = Infinity;
    let hi = -Infinity;
    for (const i of own) {
      lo = Math.min(lo, i);
      hi = Math.max(hi, i);
    }
    const local = Uint32Array.from(own, (i) => i - lo);
    const m = hi - lo + 1;
    const normals = new Float32Array(m * 3);
    for (let i = 0; i < m; i += 1) normals[i * 3 + 1] = 1;
    return renderer.createMesh({
      positions: positions.slice(lo * 3, (hi + 1) * 3),
      normals,
      colors: colors.slice(lo * 3, (hi + 1) * 3),
      emissive: new Float32Array(m),
      uvs: uvs.slice(lo * 2, (hi + 1) * 2),
      indices: local,
    });
  });
  return { cells, cellSize, atlasWidth: width, atlasHeight: height, material: { albedo: texture, cutout: 0.5, doubleSided: true } };
}
