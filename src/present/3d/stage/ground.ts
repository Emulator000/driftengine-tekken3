/**
 * The ground as the fight lays it: a patch of tiles (the game's 100, more
 * for a view wider than 4:3), each one of the stage's map cells with the corner UVs the extractor resolved (`GND1`), at the corners the game
 * places it and shaded as the game shades it, texel times shade over 128. Made again when the patch
 * moves or its cells change; its shades, which change with the camera nearly every frame, are
 * rewritten in place.
 */
import type { MeshHandle, RendererApi, SurfaceMaterial, SurfaceTextureHandle } from '@driftengine/core';

const GND_MAGIC = 0x31444e47;
const CELLS = 100;

export interface GroundState {
  readonly drawn: boolean;
  readonly count: number;
  readonly cell: Int16Array;
  readonly x: Int32Array;
  readonly z: Int32Array;
  readonly shade: Uint8Array;
}

export class Ground {
  mesh: MeshHandle | null = null;
  readonly material: SurfaceMaterial<SurfaceTextureHandle>;
  private readonly uvs: Float32Array;
  private readonly renderer: RendererApi;
  private last = { count: 0, x: new Int32Array(0), z: new Int32Array(0), shade: new Uint8Array(0), cell: new Int16Array(0) };
  /** The patch's colours, rewritten when its shades change. */
  private colors = new Float32Array(0);

  constructor(renderer: RendererApi, buffer: ArrayBuffer, atlasWidth: number, atlasHeight: number, texture: SurfaceTextureHandle) {
    this.renderer = renderer;
    const view = new DataView(buffer);
    if (view.getUint32(0, true) !== GND_MAGIC) throw new Error('not a ground file');
    this.uvs = new Float32Array(CELLS * 8);
    for (let i = 0; i < CELLS * 4; i += 1) {
      this.uvs[i * 2] = view.getUint16(8 + i * 4, true) / atlasWidth;
      this.uvs[i * 2 + 1] = view.getUint16(8 + i * 4 + 2, true) / atlasHeight;
    }
    this.material = { albedo: texture, cutout: 0.5, doubleSided: true };
  }

  /** Lays the patch the fight placed this frame; drops it when the fight draws no ground. */
  update(state: GroundState): void {
    if (!state.drawn) {
      this.drop();
      return;
    }
    const n = state.count;
    const placed =
      this.mesh !== null &&
      n === this.last.count &&
      this.last.x.every((v, i) => v === state.x[i]) &&
      this.last.z.every((v, i) => v === state.z[i]) &&
      this.last.cell.every((v, i) => v === state.cell[i]);
    if (placed && this.last.shade.every((v, i) => v === state.shade[i])) return;
    if (placed) {
      this.last.shade.set(state.shade.subarray(0, n * 4));
      this.shade(n);
      this.renderer.updateMeshColors(this.mesh!, this.colors);
      return;
    }
    this.last = {
      count: n,
      x: state.x.slice(0, n * 4),
      z: state.z.slice(0, n * 4),
      shade: state.shade.slice(0, n * 4),
      cell: state.cell.slice(0, n),
    };
    this.colors = new Float32Array(n * 12);
    this.shade(n);
    const positions = new Float32Array(n * 12);
    const uvs = new Float32Array(n * 8);
    const indices = new Uint32Array(n * 6);
    for (let q = 0; q < n; q += 1) {
      indices.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4 + 1, q * 4 + 3, q * 4 + 2], q * 6);
      const cell = state.cell[q]!;
      for (let k = 0; k < 4; k += 1) {
        const v = q * 4 + k;
        /* Game axes to the player's: millimetres to metres, and a half turn about X. */
        positions[v * 3] = state.x[v]! / 1000;
        positions[v * 3 + 1] = 0;
        positions[v * 3 + 2] = -state.z[v]! / 1000;
        uvs[v * 2] = this.uvs[(cell * 4 + k) * 2]!;
        uvs[v * 2 + 1] = this.uvs[(cell * 4 + k) * 2 + 1]!;
      }
    }
    const normals = new Float32Array(n * 12);
    for (let v = 0; v < n * 4; v += 1) normals[v * 3 + 1] = 1;
    this.drop();
    this.mesh = this.renderer.createMesh({ positions, normals, colors: this.colors, emissive: new Float32Array(n * 4), uvs, indices }, { dynamicColors: true });
  }

  /** Each corner's colour, its shade over 128, for the first `n` tiles. */
  private shade(n: number): void {
    const shades = this.last.shade;
    for (let v = 0; v < n * 4; v += 1) this.colors.fill(shades[v]! / 128, v * 3, v * 3 + 3);
  }

  private drop(): void {
    if (this.mesh !== null) this.renderer.disposeMesh(this.mesh);
    this.mesh = null;
  }
}
