/**
 * The ground as the fight lays it: a patch of tiles (the game's 100, more
 * for a view wider than 4:3 and on an arcade stage), each one of the stage's map cells with the corner UVs the extractor resolved (`GND1`), at the corners the game
 * places it and shaded as the game shades it, texel times shade over 128 (times a tint the scene's
 * light is undone by, so the lit floor keeps the game's colours where nothing shades it). Made again
 * when the patch moves or its cells change; its shades, which change with the camera nearly every
 * frame, are rewritten in place.
 */
import type { MeshHandle, RendererApi, SurfaceMaterial, SurfaceTextureHandle } from '@driftengine/core';
import { ReliefTiles, type FloorRelief } from './relief.ts';

/** The display's gamma, which the game's colour arithmetic works in. */
const DISPLAY_GAMMA = 2.2;
/** Each shade over 128, taken into linear light. */
const LINEAR_SHADES = Float32Array.from({ length: 256 }, (_, k) => (k / 128) ** DISPLAY_GAMMA);

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

/** A floor redrawn, each of the atlas's ground regions (`size` texels square from its corner) a `cell`-texel square in rows of `columns`. */
export interface FloorLayout {
  readonly cell: number;
  readonly columns: number;
  readonly regions: readonly (readonly [number, number])[];
  readonly size: number;
  /** Whether the regions were drawn anew (their stones sharp), so the floor's own maps carry its relief: what they were drawn from, or true. */
  readonly drawn?: boolean | readonly (string | number)[];
}

/** The redrawn floor's atlas and maps, where each region went, and the atlas's size. */
export interface FloorLook {
  readonly texture: SurfaceTextureHandle;
  readonly normal: SurfaceTextureHandle | null;
  readonly orm: SurfaceTextureHandle | null;
  readonly layout: FloorLayout | null;
  readonly width: number;
  readonly height: number;
  /** How wet it is: how much it mirrors, its maps' roughness scaled, and its reflectance at the vertices. */
  readonly wet: { readonly reflectivity: number; readonly roughnessScale: number; readonly specular: number; readonly grain: number } | null;
  /** Its stones' heights, which the tiles round the fight are cut finer and sunk by. */
  readonly relief?: FloorRelief | null;
  /** Whether its picture has holes the floor is seen through (a grating, or the game's own picture), cut out where it is clear. */
  readonly seeThrough: boolean;
}

export class Ground {
  mesh: MeshHandle | null = null;
  /** The tiles sunk where their floor's joints lie (`FloorLook.relief`), each an instance of its cell's grid. */
  private readonly reliefTiles: ReliefTiles | null;
  readonly material: SurfaceMaterial<SurfaceTextureHandle>;
  private readonly uvs: Float32Array;
  /** The corners' coordinates in the stage's atlas, whatever the floor is drawn with. */
  readonly sourceUvs: Float32Array;
  private readonly renderer: RendererApi;
  private last = { count: 0, x: new Int32Array(0), z: new Int32Array(0), shade: new Uint8Array(0), cell: new Int16Array(0) };
  /** The patch's colours, rewritten when its shades change. */
  private colors = new Float32Array(0);
  private readonly tint: readonly [number, number, number];
  /** A wet floor's reflectance, at every vertex. */
  private readonly specular: number | null;
  /** A lit floor (a redrawn one) takes no shade from the game, which brightens it round the fighters where the scene's own light now falls; every corner at 128. */
  private readonly steady: boolean;
  private unshaded = new Uint8Array(0);
  /** The tiles `prepare` compiles the patch's pipelines with. */
  private warm: MeshHandle[] | null = null;
  /** For each of the flat tiles' vertices, its tile and where it lies across it (0 to 1 each way), which its shade is mixed by. */

  constructor(renderer: RendererApi, buffer: ArrayBuffer, atlasWidth: number, atlasHeight: number, texture: SurfaceTextureHandle, tint: readonly [number, number, number] = [1, 1, 1], floor: FloorLook | null = null) {
    this.renderer = renderer;
    this.tint = tint;
    const view = new DataView(buffer);
    if (view.getUint32(0, true) !== GND_MAGIC) throw new Error('not a ground file');
    this.uvs = new Float32Array(CELLS * 8);
    for (let i = 0; i < CELLS * 4; i += 1) {
      this.uvs[i * 2] = view.getUint16(8 + i * 4, true) / atlasWidth;
      this.uvs[i * 2 + 1] = view.getUint16(8 + i * 4 + 2, true) / atlasHeight;
    }
    this.sourceUvs = this.uvs.slice();
    if (floor !== null && floor.layout !== null) {
      const { cell, columns, regions, size } = floor.layout;
      /* A cell's region is the one at its corners' least u and v (regions may touch, so not each corner's own). */
      for (let c = 0; c < CELLS; c += 1) {
        const corners = [0, 1, 2, 3].map((k) => [view.getUint16(8 + (c * 4 + k) * 4, true), view.getUint16(8 + (c * 4 + k) * 4 + 2, true)] as const);
        const low = [Math.min(...corners.map(([u]) => u)), Math.min(...corners.map(([, v]) => v))];
        const k = regions.findIndex(([x, y]) => x === low[0] && y === low[1]);
        if (k < 0) continue;
        const [x, y] = regions[k]!;
        corners.forEach(([u, v], j) => {
          this.uvs[(c * 4 + j) * 2] = ((k % columns) * cell + ((u - x) * cell) / size) / floor.width;
          this.uvs[(c * 4 + j) * 2 + 1] = (Math.floor(k / columns) * cell + ((v - y) * cell) / size) / floor.height;
        });
      }
    }
    this.material =
      floor === null
        ? { albedo: texture, cutout: 0.5, doubleSided: true }
        : {
            albedo: floor.texture,
            ...(floor.seeThrough ? { cutout: 0.5 } : {}),
            doubleSided: true,
            ...(floor.normal === null ? {} : { normal: floor.normal, normalStrength: floor.wet?.grain ?? 1 }),
            ...(floor.orm === null ? {} : { orm: floor.orm }),
            ...(floor.wet === null ? {} : { reflectivity: floor.wet.reflectivity, roughnessScale: floor.wet.roughnessScale }),
          };
    this.specular = floor?.wet?.specular ?? null;
    this.steady = floor !== null;
    this.reliefTiles = floor?.relief == null ? null : new ReliefTiles(renderer, floor.relief, this.uvs, tint, this.specular);
  }

  /**
   * Has the pipelines a patch is drawn with compiled before the fight shows: a tile made the two
   * ways a patch is (its colours rewritten in place, and cut to a square), never drawn.
   */
  prepare(side?: number): void {
    /* A sunk floor's grids, all made now, `side` mm to a tile, as many as a wide picture's patch has. */
    if (side !== undefined) this.reliefTiles?.ready(side, 10, 1024);
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
    this.reliefTiles?.prepare(this.material);
  }

  /** Lays the patch the fight placed this frame, cut to `clip` where there is one; drops it when the fight draws no ground. */
  update(given: GroundState, clip: GroundClip | null = null): void {
    let state = given;
    if (this.steady) {
      if (this.unshaded.length !== given.shade.length) this.unshaded = new Uint8Array(given.shade.length).fill(128);
      state = { ...given, shade: this.unshaded };
    }
    if (!state.drawn) {
      this.drop();
      this.dropRelief();
      return;
    }
    if (clip !== null) {
      this.cutTo(state, clip);
      return;
    }
    const n = state.count;
    const placed =
      (this.mesh !== null || this.reliefTiles?.laid === true) &&
      n === this.last.count &&
      this.last.x.every((v, i) => v === state.x[i]) &&
      this.last.z.every((v, i) => v === state.z[i]) &&
      this.last.cell.every((v, i) => v === state.cell[i]);
    if (placed) {
      if (!this.last.shade.every((v, i) => v === state.shade[i])) {
        this.last.shade.set(state.shade.subarray(0, n * 4));
        this.shadeFlat(n);
        if (this.mesh !== null) this.renderer.updateMeshColors(this.mesh, this.colors);
      }
      return;
    }
    this.last = {
      count: n,
      x: state.x.slice(0, n * 4),
      z: state.z.slice(0, n * 4),
      shade: state.shade.slice(0, n * 4),
      cell: state.cell.slice(0, n),
    };
    this.layNear(state, n);
  }

  /** The near tiles: on a floor with relief each an instance of its cell's sunk grid; otherwise one mesh of quads. */
  private layNear(state: GroundState, n: number): void {
    if (this.reliefTiles !== null) {
      this.reliefTiles.lay({ x: state.x, z: state.z, cell: state.cell, count: n });
      this.drop();
      return;
    }
    this.layFlat(state, n);
  }

  /** The sunk tiles drawn as instances, with the ground's material set. */
  drawRelief(): void {
    this.reliefTiles?.draw();
  }

  /** The near tiles, one quad each, in one mesh. */
  private layFlat(state: GroundState, n: number): void {
    const positions = new Float32Array(n * 12);
    const uvs = new Float32Array(n * 8);
    const normals = new Float32Array(n * 12);
    const indices = new Uint32Array(n * 6);
    for (let q = 0; q < n; q += 1) {
      indices.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4 + 1, q * 4 + 3, q * 4 + 2], q * 6);
      const cell = state.cell[q]!;
      for (let k = 0; k < 4; k += 1) {
        const v = q * 4 + k;
        /* Game axes to the player's: millimetres to metres, and a half turn about X. */
        positions.set([state.x[v]! / 1000, 0, -state.z[v]! / 1000], v * 3);
        uvs.set([this.uvs[(cell * 4 + k) * 2]!, this.uvs[(cell * 4 + k) * 2 + 1]!], v * 2);
        normals[v * 3 + 1] = 1;
      }
    }
    this.colors = new Float32Array(n * 12);
    this.shadeFlat(n);
    this.drop();
    if (n > 0) this.mesh = this.renderer.createMesh({ positions, normals, colors: this.colors, emissive: new Float32Array(n * 4), uvs, indices, ...this.wetAt(n * 4) }, { dynamicColors: true });
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
    for (let q = 0; q < state.count; q += 1) {
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
        const k = LINEAR_SHADES[corner[6]]!;
        colors.push(k * r, k * g, k * b);
      }
      for (let i = 1; i + 1 < outline.length; i += 1) indices.push(base, base + i, base + i + 1);
    }
    this.drop();
    this.dropRelief();
    this.last = { count: 0, x: new Int32Array(0), z: new Int32Array(0), shade: new Uint8Array(0), cell: new Int16Array(0) };
    if (indices.length === 0) return;
    const n = positions.length / 3;
    const normals = new Float32Array(n * 3);
    for (let v = 0; v < n; v += 1) normals[v * 3 + 1] = 1;
    this.mesh = this.renderer.createMesh({ positions: new Float32Array(positions), normals, colors: new Float32Array(colors), emissive: new Float32Array(n), uvs: new Float32Array(uvs), indices: new Uint32Array(indices), ...this.wetAt(n) });
  }

  /**
   * The near tiles' colours: each corner's shade over 128 times the tint (the game scales the
   * texel's displayed colour by the shade, so the scale is taken into linear light), for the first
   * `n` tiles.
   */
  private shadeFlat(n: number): void {
    const shades = this.last.shade;
    const [r, g, b] = this.tint;
    for (let v = 0; v < n * 4; v += 1) {
      const k = LINEAR_SHADES[shades[v]!]!;
      this.colors[v * 3] = k * r;
      this.colors[v * 3 + 1] = k * g;
      this.colors[v * 3 + 2] = k * b;
    }
  }

  /** A wet floor's reflectance for `n` vertices, or nothing. */
  private wetAt(n: number): { specular?: Float32Array } {
    return this.specular === null ? {} : { specular: new Float32Array(n).fill(this.specular) };
  }

  private drop(): void {
    if (this.mesh !== null) this.renderer.disposeMesh(this.mesh);
    this.mesh = null;
  }

  /** The sunk tiles unlaid. */
  private dropRelief(): void {
    this.reliefTiles?.lay({ x: new Int32Array(0), z: new Int32Array(0), cell: new Int16Array(0), count: 0 });
  }
}
