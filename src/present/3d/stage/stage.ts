/**
 * A stage's scenery (`STG1` version 3, scripts/lib/stage.mjs): its cells (the disc's 6 × 6, an
 * arcade stage's 16 × 16), each its own mesh so the cells the game culls are left out, in game
 * axes of 8 mm units turned into the player's metres with Y up. Drawn unlit, texture times vertex
 * colour, as the PlayStation draws its stage polygons. A cell's polygons are split by the layer they
 * lie in over others in their plane, which orders them where a depth buffer cannot, by whether
 * they are seen from their front only, and by whether their texture has clear texels: those are
 * drawn after everything solid, so their soft edges blend over what truly lies behind them.
 */
import type { MeshHandle, RendererApi, SurfaceMaterial, SurfaceTextureHandle } from '@driftengine/core';

const STG_MAGIC = 0x31475453;
const STG_VERSION = 3;
const UNIT_M = 0.008;
/** A vertex's flags: its polygon seen from its front only; the layer it lies in; its texture's clear texels. */
const ONE_SIDED = 2;
const LAYER_SHIFT = 2;
const CUT = 16;

/** Some of a cell's polygons, all in one layer and alike in whether their backs are drawn and whether they are cut out. */
export interface StagePiece {
  readonly mesh: MeshHandle;
  readonly layer: number;
  readonly oneSided: boolean;
  readonly cut: boolean;
}

export interface Stage {
  /** Per cell of the grid, row by row, its pieces, none where the cell has no polygons. */
  readonly cells: readonly (readonly StagePiece[])[];
  /** The model's cell size, which the game's culling grid is built from. */
  readonly cellSize: number;
  /** The grid's cells each way. */
  readonly grid: number;
  readonly atlasWidth: number;
  readonly atlasHeight: number;
  /** Drawn from both sides, and from the front only. */
  readonly material: SurfaceMaterial<SurfaceTextureHandle>;
  readonly oneSidedMaterial: SurfaceMaterial<SurfaceTextureHandle>;
}

export function createStage(renderer: RendererApi, buffer: ArrayBuffer, texture: SurfaceTextureHandle): Stage {
  const view = new DataView(buffer);
  const { width, height } = stageAtlasSize(buffer);
  const n = view.getUint32(8, true);
  const indexCount = view.getUint32(12, true);
  const cellSize = view.getUint32(20, true);
  const grid = view.getUint32(24, true);
  const ranges: [number, number][] = [];
  for (let c = 0; c < grid * grid; c += 1) ranges.push([view.getUint32(28 + c * 8, true), view.getUint32(32 + c * 8, true)]);
  let at = 28 + grid * grid * 8;
  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const uvs = new Float32Array(n * 2);
  const flags = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    positions[i * 3] = view.getInt16(at, true) * UNIT_M;
    positions[i * 3 + 1] = -view.getInt16(at + 2, true) * UNIT_M;
    positions[i * 3 + 2] = -view.getInt16(at + 4, true) * UNIT_M;
    /* The PlayStation modulates a texel by the polygon's colour over 128. */
    for (let k = 0; k < 3; k += 1) colors[i * 3 + k] = view.getUint8(at + 6 + k) / 128;
    flags[i] = view.getUint8(at + 9);
    uvs[i * 2] = view.getUint16(at + 10, true) / width;
    uvs[i * 2 + 1] = view.getUint16(at + 12, true) / height;
    at += 20;
  }
  const indices = new Uint32Array(indexCount);
  for (let i = 0; i < indexCount; i += 1) indices[i] = view.getUint32(at + i * 4, true);
  /* A triangle's kind, by its first vertex: its layer, whether its back is drawn and whether it is cut out. */
  const kindOf = (i: number): number => flags[i]! & (ONE_SIDED | (3 << LAYER_SHIFT) | CUT);
  const piece = (own: number[], kind: number): StagePiece => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const i of own) {
      lo = Math.min(lo, i);
      hi = Math.max(hi, i);
    }
    const m = hi - lo + 1;
    const normals = new Float32Array(m * 3);
    for (let i = 0; i < m; i += 1) normals[i * 3 + 1] = 1;
    const mesh = renderer.createMesh({
      positions: positions.slice(lo * 3, (hi + 1) * 3),
      normals,
      colors: colors.slice(lo * 3, (hi + 1) * 3),
      emissive: new Float32Array(m),
      uvs: uvs.slice(lo * 2, (hi + 1) * 2),
      indices: Uint32Array.from(own, (i) => i - lo),
    });
    return { mesh, layer: (kind >> LAYER_SHIFT) & 3, oneSided: (kind & ONE_SIDED) !== 0, cut: (kind & CUT) !== 0 };
  };
  const cells = ranges.map(([start, count]) => {
    const kinds = new Map<number, number[]>();
    for (let t = start; t < start + count; t += 3) {
      const kind = kindOf(indices[t]!);
      let list = kinds.get(kind);
      if (list === undefined) kinds.set(kind, (list = []));
      list.push(indices[t]!, indices[t + 1]!, indices[t + 2]!);
    }
    return [...kinds.entries()].sort(([a], [b]) => a - b).map(([kind, own]) => piece(own, kind));
  });
  return {
    cells,
    cellSize,
    grid,
    atlasWidth: width,
    atlasHeight: height,
    material: { albedo: texture, cutout: 0.5, doubleSided: true },
    oneSidedMaterial: { albedo: texture, cutout: 0.5, doubleSided: false },
  };
}

/** A stage mesh's atlas size, which its ground's texture coordinates are in too. */
export function stageAtlasSize(buffer: ArrayBuffer): { width: number; height: number } {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== STG_MAGIC || view.getUint32(4, true) !== STG_VERSION) throw new Error(`not a version ${STG_VERSION} stage mesh; run \`npm run extract\``);
  return { width: view.getUint16(16, true), height: view.getUint16(18, true) };
}
