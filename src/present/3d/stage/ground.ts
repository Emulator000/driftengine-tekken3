/**
 * The ground as the fight lays it: a patch of tiles (the game's 100, more
 * for a view wider than 4:3), each one of the stage's map cells with the corner UVs the extractor resolved (`GND1`), at the corners the game
 * places it and shaded as the game shades it, texel times shade over 128 (times a tint the scene's
 * light is undone by, so the lit floor keeps the game's colours where nothing shades it). Made again
 * when the patch moves or its cells change; its shades, which change with the camera nearly every
 * frame, are rewritten in place.
 */
import type { MeshHandle, RendererApi, SurfaceMaterial, SurfaceTextureHandle } from '@driftengine/core';

/** The display's gamma, which the game's colour arithmetic works in. */
const DISPLAY_GAMMA = 2.2;

const GND_MAGIC = 0x31444e47;
const CELLS = 100;

export interface GroundState {
  readonly drawn: boolean;
  readonly count: number;
  readonly cell: Int16Array;
  readonly x: Int32Array;
  readonly z: Int32Array;
  readonly shade: Uint8Array;
  /** The tiles shaded as the fight goes, the first ones; those past them lie farther, under the floor (`UNDER`), shaded once. */
  readonly near: number;
}

/** How far under the floor a far tile is laid (metres): below an arcade stage's own floors, which show over it. */
const UNDER = 0.04;

/** A square the patch is cut to, in the scenery's frame: the scenery's place (mm) and turn (4096ths), and the square's half-width (mm). */
export interface GroundClip {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly half: number;
}

/** A corner as it is cut: its place in the square's frame and on the floor (mm), its texel and its shade. */
type Corner = readonly [number, number, number, number, number, number, number];

/** The part of a convex outline on the inner side of `limit` along axis `axis` (0 or 1) of its corners, `sign` its direction. */
function cut(outline: readonly Corner[], axis: 0 | 1, sign: number, limit: number): Corner[] {
  const out: Corner[] = [];
  for (let i = 0; i < outline.length; i += 1) {
    const a = outline[i]!;
    const b = outline[(i + 1) % outline.length]!;
    const da = limit - sign * a[axis];
    const db = limit - sign * b[axis];
    if (da >= 0) out.push(a);
    if (da >= 0 !== db >= 0) {
      const t = da / (da - db);
      out.push(a.map((v, k) => v + (b[k]! - v) * t) as unknown as Corner);
    }
  }
  return out;
}

export class Ground {
  mesh: MeshHandle | null = null;
  /** The tiles past the near ones, an arcade stage's floor to its far end: made again only as they move. */
  farMesh: MeshHandle | null = null;
  private lastFar = { count: 0, x: new Int32Array(0), z: new Int32Array(0), cell: new Int16Array(0) };
  readonly material: SurfaceMaterial<SurfaceTextureHandle>;
  private readonly uvs: Float32Array;
  private readonly renderer: RendererApi;
  private last = { count: 0, x: new Int32Array(0), z: new Int32Array(0), shade: new Uint8Array(0), cell: new Int16Array(0) };
  /** The patch's colours, rewritten when its shades change. */
  private colors = new Float32Array(0);
  private readonly tint: readonly [number, number, number];
  /** The tiles `prepare` compiles the patch's pipelines with. */
  private warm: MeshHandle[] | null = null;

  constructor(renderer: RendererApi, buffer: ArrayBuffer, atlasWidth: number, atlasHeight: number, texture: SurfaceTextureHandle, tint: readonly [number, number, number] = [1, 1, 1]) {
    this.renderer = renderer;
    this.tint = tint;
    const view = new DataView(buffer);
    if (view.getUint32(0, true) !== GND_MAGIC) throw new Error('not a ground file');
    this.uvs = new Float32Array(CELLS * 8);
    for (let i = 0; i < CELLS * 4; i += 1) {
      this.uvs[i * 2] = view.getUint16(8 + i * 4, true) / atlasWidth;
      this.uvs[i * 2 + 1] = view.getUint16(8 + i * 4 + 2, true) / atlasHeight;
    }
    this.material = { albedo: texture, cutout: 0.5, doubleSided: true };
  }

  /**
   * Has the pipelines a patch is drawn with compiled before the fight shows: a tile made the two
   * ways a patch is (its colours rewritten in place, and cut to a square), never drawn.
   */
  prepare(): void {
    const tile = (): Parameters<RendererApi['createMesh']>[0] => ({
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1]),
      normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
      colors: new Float32Array(12).fill(1),
      emissive: new Float32Array(4),
      uvs: new Float32Array(8),
      indices: new Uint32Array([0, 1, 2, 1, 3, 2]),
    });
    this.warm ??= [this.renderer.createMesh(tile(), { dynamicColors: true }), this.renderer.createMesh(tile())];
    for (const mesh of this.warm) this.renderer.prepareMesh(mesh, this.material);
  }

  /** Lays the patch the fight placed this frame, cut to `clip` where there is one; drops it when the fight draws no ground. */
  update(state: GroundState, clip: GroundClip | null = null): void {
    if (!state.drawn) {
      this.drop();
      this.dropFar();
      this.lastFar = { count: 0, x: new Int32Array(0), z: new Int32Array(0), cell: new Int16Array(0) };
      return;
    }
    if (clip !== null) {
      this.cutTo(state, clip);
      return;
    }
    this.layFar(state);
    const n = state.near;
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

  /** The patch made again, every tile cut to the square: what lies outside it is not drawn. */
  private cutTo(state: GroundState, clip: GroundClip): void {
    const angle = (-clip.yaw * 2 * Math.PI) / 4096;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const [r, g, b] = this.tint;
    const positions: number[] = [];
    const uvs: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    /* A quad's corners in order round its outline. */
    const round = [0, 1, 3, 2];
    for (let q = 0; q < state.near; q += 1) {
      const cell = state.cell[q]!;
      let outline: Corner[] = round.map((k) => {
        const v = q * 4 + k;
        const x = state.x[v]!;
        const z = state.z[v]!;
        const dx = x - clip.x;
        const dz = z - clip.z;
        return [c * dx - s * dz, s * dx + c * dz, x, z, this.uvs[(cell * 4 + k) * 2]!, this.uvs[(cell * 4 + k) * 2 + 1]!, state.shade[v]!];
      });
      for (const [axis, sign] of [[0, 1], [0, -1], [1, 1], [1, -1]] as const) outline = cut(outline, axis, sign, clip.half);
      if (outline.length < 3) continue;
      const base = positions.length / 3;
      for (const corner of outline) {
        positions.push(corner[2] / 1000, 0, -corner[3] / 1000);
        uvs.push(corner[4], corner[5]);
        const k = (corner[6] / 128) ** DISPLAY_GAMMA;
        colors.push(k * r, k * g, k * b);
      }
      for (let i = 1; i + 1 < outline.length; i += 1) indices.push(base, base + i, base + i + 1);
    }
    this.drop();
    this.last = { count: 0, x: new Int32Array(0), z: new Int32Array(0), shade: new Uint8Array(0), cell: new Int16Array(0) };
    if (indices.length === 0) return;
    const n = positions.length / 3;
    const normals = new Float32Array(n * 3);
    for (let v = 0; v < n; v += 1) normals[v * 3 + 1] = 1;
    this.mesh = this.renderer.createMesh({ positions: new Float32Array(positions), normals, colors: new Float32Array(colors), emissive: new Float32Array(n), uvs: new Float32Array(uvs), indices: new Uint32Array(indices) });
  }

  /**
   * Each corner's colour, its shade over 128 times the tint, for the first `n` tiles: the game
   * scales the texel's displayed colour by the shade, so the scale is taken into linear light.
   */
  private shade(n: number): void {
    const shades = this.last.shade;
    const [r, g, b] = this.tint;
    for (let v = 0; v < n * 4; v += 1) {
      const k = (shades[v]! / 128) ** DISPLAY_GAMMA;
      this.colors.set([k * r, k * g, k * b], v * 3);
    }
  }

  /** The far tiles, made again only when they move: laid under the floor, each corner its shade as laid. */
  private layFar(state: GroundState): void {
    const from = state.near;
    const n = state.count - from;
    const last = this.lastFar;
    const same =
      n === last.count &&
      last.x.every((v, i) => v === state.x[from * 4 + i]) &&
      last.z.every((v, i) => v === state.z[from * 4 + i]) &&
      last.cell.every((v, i) => v === state.cell[from + i]);
    if (same) return;
    this.lastFar = { count: n, x: state.x.slice(from * 4, state.count * 4), z: state.z.slice(from * 4, state.count * 4), cell: state.cell.slice(from, state.count) };
    this.dropFar();
    if (n === 0) return;
    const [r, g, b] = this.tint;
    const positions = new Float32Array(n * 12);
    const colors = new Float32Array(n * 12);
    const uvs = new Float32Array(n * 8);
    const indices = new Uint32Array(n * 6);
    const normals = new Float32Array(n * 12);
    for (let q = 0; q < n; q += 1) {
      indices.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4 + 1, q * 4 + 3, q * 4 + 2], q * 6);
      const cell = state.cell[from + q]!;
      for (let k = 0; k < 4; k += 1) {
        const v = q * 4 + k;
        positions.set([state.x[from * 4 + v]! / 1000, -UNDER, -state.z[from * 4 + v]! / 1000], v * 3);
        uvs.set([this.uvs[(cell * 4 + k) * 2]!, this.uvs[(cell * 4 + k) * 2 + 1]!], v * 2);
        const shade = (state.shade[from * 4 + v]! / 128) ** DISPLAY_GAMMA;
        colors.set([shade * r, shade * g, shade * b], v * 3);
        normals[v * 3 + 1] = 1;
      }
    }
    this.farMesh = this.renderer.createMesh({ positions, normals, colors, emissive: new Float32Array(n * 4), uvs, indices });
  }

  private drop(): void {
    if (this.mesh !== null) this.renderer.disposeMesh(this.mesh);
    this.mesh = null;
  }

  private dropFar(): void {
    if (this.farMesh !== null) this.renderer.disposeMesh(this.farMesh);
    this.farMesh = null;
  }
}
