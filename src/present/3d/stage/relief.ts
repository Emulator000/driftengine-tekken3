/**
 * A floor's tiles sunk where their joints lie, in 3D. A tile's relief is its kind's (the
 * region of the floor's atlas its cell shows, and which way round), made once a kind, a grid sunk
 * under the stones' tops by the floor's heights, and every tile is drawn as an instance of its
 * kind's grid, placed where the tile lies: nothing is made again as the fight moves, and the floor
 * is a draw a kind. Every tile is cut alike (`FloorRelief.cuts`): a tile cut finer shows its joints
 * sunk deeper, so its stones darker, and tiles cut finer round the fight than past it showed a square
 * of darker floor. Where two tiles meet, both take the same heights: each kind's border at the
 * coarsest cut, averaged with the kind beside it as the ground lays them, and a finer cut's border
 * drawn straight between those points.
 */
import { createMeshInstances, type InstancedHandle, type MeshHandle, type MeshInstances, type RendererApi, type SurfaceMaterial, type SurfaceTextureHandle, type TranslucentMeshOptions } from '@driftengine/core';

/** A floor's heights by its atlas's texels (0 the deepest joint, 1 a stone's top), how far its joints sink (metres), and how many times each tile is cut each way. */
export interface FloorRelief {
  readonly heights: Float32Array;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly cuts: number;
}

/** How many times every tile is cut each way: for the picture at its best, and otherwise (the coarsest cut, which the tiles' borders are laid at). */
export const RELIEF_CUTS = 48;
export const LOW_RELIEF_CUTS = 16;
const FAR_CUTS = LOW_RELIEF_CUTS;
/** A ground map's cells to a row. */
const MAP_COLUMNS = 10;

/** The patch a frame, as the ground lays it: its near tiles' corners (mm), cells, and how many. */
export interface ReliefPatch {
  readonly x: Int32Array;
  readonly z: Int32Array;
  readonly cell: Int16Array;
  readonly count: number;
}

/** A height field's value at (u, v) of its atlas, read smoothly. */
function heightAt(relief: FloorRelief, u: number, v: number): number {
  const { heights: h, width, height } = relief;
  const x = Math.min(width - 1, Math.max(0, u * width - 0.5));
  const y = Math.min(height - 1, Math.max(0, v * height - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  return (h[y0 * width + x0]! * (1 - fx) + h[y0 * width + x1]! * fx) * (1 - fy) + (h[y1 * width + x0]! * (1 - fx) + h[y1 * width + x1]! * fx) * fy;
}

/**
 * Each map cell's kind, from its corners' texture coordinates (`uvs`, four a cell): cells that show
 * the same region of the atlas the same way round are one, and share their meshes; and a cell of
 * each kind.
 */
function kindsOf(uvs: Float32Array): { kindOf: Int16Array; sample: number[] } {
  const cells = uvs.length / 8;
  const kindOf = new Int16Array(cells);
  const sample: number[] = [];
  const kinds = new Map<string, number>();
  for (let c = 0; c < cells; c += 1) {
    const key = Array.from(uvs.subarray(c * 8, c * 8 + 8), (v) => Math.round(v * 65536)).join(',');
    let kind = kinds.get(key);
    if (kind === undefined) {
      kind = sample.length;
      kinds.set(key, kind);
      sample.push(c);
    }
    kindOf[c] = kind;
  }
  return { kindOf, sample };
}

/** A kind's grid at a level and the batch its tiles are drawn with. */
interface Level {
  readonly mesh: MeshHandle;
  readonly batch: InstancedHandle;
  readonly instances: MeshInstances;
}

export class ReliefTiles {
  /** Each cell's corners' texture coordinates (the near corner 2, then 3 along x, 0 along z, 1 across). */
  private readonly corners: Float32Array;
  /** Each kind's border at the coarsest cut, `FAR_CUTS + 1` points a side, joined with its neighbours' once they are known; and the tile's side (mm). */
  private borders: Float32Array[] | null = null;
  private side = 0;
  private readonly levels = new Map<string, Level>();
  private lastKey = '';

  /** Each map cell's kind, and a cell of each (`kindsOf`). */
  private readonly kindOf: Int16Array;
  private readonly sample: number[];

  constructor(
    private readonly renderer: RendererApi,
    private readonly relief: FloorRelief,
    /** The ground's corners' texture coordinates, four a cell. */
    uvs: Float32Array,
    private readonly tint: readonly [number, number, number],
    private readonly specular: number | null,
  ) {
    this.corners = uvs;
    ({ kindOf: this.kindOf, sample: this.sample } = kindsOf(uvs));
  }

  /** Lays the patch's tiles: each an instance of its kind's grid. */
  lay(patch: ReliefPatch): void {
    const { x, z, cell, count } = patch;
    if (count === 0) {
      for (const level of this.levels.values()) level.instances.count = 0;
      this.lastKey = '';
      return;
    }
    const side = Math.max(x[0]!, x[1]!, x[2]!, x[3]!) - Math.min(x[0]!, x[1]!, x[2]!, x[3]!) || 1;
    this.ready(side, MAP_COLUMNS, count);
    const key = `${count}:${x[2]},${z[2]}:${x[count * 4 - 2]},${z[count * 4 - 2]}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    for (const level of this.levels.values()) level.instances.count = 0;
    for (let q = 0; q < count; q += 1) {
      const level = this.levelOf(this.kindOf[cell[q]!]!, this.relief.cuts, count);
      const m = level.instances.models;
      const at = level.instances.count * 16;
      m.fill(0, at, at + 16);
      m[at] = 1;
      m[at + 5] = 1;
      m[at + 10] = 1;
      m[at + 12] = x[q * 4 + 2]! / 1000;
      m[at + 14] = -z[q * 4 + 2]! / 1000;
      m[at + 15] = 1;
      level.instances.tints.fill(1, level.instances.count * 3, level.instances.count * 3 + 3);
      level.instances.count += 1;
    }
    for (const level of this.levels.values()) this.renderer.uploadInstanced(level.batch, level.instances);
  }

  /** Draws the tiles laid, with the material set; or blended at `opacity`, as `options` say (whether they write depth). */
  draw(opacity?: number, options?: TranslucentMeshOptions): void {
    for (const level of this.levels.values()) {
      if (level.instances.count === 0) continue;
      if (opacity === undefined) this.renderer.drawInstanced(level.batch, level.instances);
      else this.renderer.drawTranslucentInstanced(level.batch, level.instances, opacity, options);
    }
  }

  /** Whether any tile is laid. */
  get laid(): boolean {
    for (const level of this.levels.values()) if (level.instances.count > 0) return true;
    return false;
  }

  /** Compiles the pipelines its batches are drawn with, `material` the ground's, and the blended ones with `translucent`. */
  prepare(material: SurfaceMaterial<SurfaceTextureHandle>, translucent = false): void {
    for (const level of this.levels.values()) this.renderer.prepareInstanced(level.batch, material, { translucent });
  }

  /** A kind's texture coordinate at (s, t) across its tile, `o` 0 for u and 1 for v. */
  private uvAt(kind: number, s: number, t: number, o: number): number {
    const c = this.corners;
    const cell = this.sample[kind]!;
    const at = (k: number): number => c[(cell * 4 + k) * 2 + o]!;
    return (at(2) + (at(3) - at(2)) * s) * (1 - t) + (at(0) + (at(1) - at(0)) * s) * t;
  }

  /**
   * Each kind's border at the coarsest level, then joined with the kinds beside it, as the ground's
   * map lays its cells (`columns` to a row, the next along x, the row before along z, wrapping): each
   * side's points the mean of the two kinds' there, each corner the mean of the four kinds' that meet
   * at it; then every kind's grid at every level, `capacity` tiles to a batch, so none is made while
   * the fight goes on. `side` is a tile's (mm).
   */
  ready(side: number, columns: number, capacity: number): void {
    if (this.borders !== null && this.side === side) return;
    this.side = side;
    const k = FAR_CUTS;
    const borders = Array.from({ length: this.sample.length }, (_, c) => {
      const grid = new Float32Array((k + 1) * (k + 1));
      for (let j = 0; j <= k; j += 1) for (let i = 0; i <= k; i += 1) grid[j * (k + 1) + i] = heightAt(this.relief, this.uvAt(c, i / k, j / k, 0), this.uvAt(c, i / k, j / k, 1));
      return grid;
    });
    const cells = this.kindOf.length;
    const rows = Math.max(1, Math.floor(cells / columns));
    const right = new Map<number, number>();
    const up = new Map<number, number>();
    for (let cell = 0; cell < cells; cell += 1) {
      const row = Math.floor(cell / columns);
      const column = cell % columns;
      const kind = this.kindOf[cell]!;
      if (!right.has(kind)) right.set(kind, this.kindOf[row * columns + ((column + 1) % columns)]!);
      if (!up.has(kind)) up.set(kind, this.kindOf[((row + rows - 1) % rows) * columns + column]!);
    }
    const at = (c: number, i: number, j: number): number => borders[c]![j * (k + 1) + i]!;
    const put = (c: number, i: number, j: number, h: number): void => {
      borders[c]![j * (k + 1) + i] = h;
    };
    for (const [c, r] of right) {
      for (let j = 1; j < k; j += 1) {
        const h = (at(c, k, j) + at(r, 0, j)) / 2;
        put(c, k, j, h);
        put(r, 0, j, h);
      }
    }
    for (const [c, u] of up) {
      for (let i = 1; i < k; i += 1) {
        const h = (at(c, i, k) + at(u, i, 0)) / 2;
        put(c, i, k, h);
        put(u, i, 0, h);
      }
    }
    /* Each corner: the kind, the one beyond it along x, along z, and across. */
    for (const [c, r] of right) {
      const u = up.get(c);
      const across = u === undefined ? undefined : right.get(u);
      if (u === undefined || across === undefined) continue;
      const h = (at(c, k, k) + at(r, 0, k) + at(u, k, 0) + at(across, 0, 0)) / 4;
      put(c, k, k, h);
      put(r, 0, k, h);
      put(u, k, 0, h);
      put(across, 0, 0, h);
    }
    this.borders = borders;
    for (const level of this.levels.values()) {
      this.renderer.disposeInstanced(level.batch);
      this.renderer.disposeMesh(level.mesh);
    }
    this.levels.clear();
    for (let kind = 0; kind < this.sample.length; kind += 1) this.levelOf(kind, this.relief.cuts, capacity);
  }

  /** A kind's grid at `cuts` and its batch, made the first time a tile asks for it. */
  private levelOf(kind: number, cuts: number, capacity: number): Level {
    const key = `${kind}:${cuts}`;
    const made = this.levels.get(key);
    if (made !== undefined && made.instances.capacity >= capacity) return made;
    /* More tiles than its batch holds: a larger batch of the same grid. */
    if (made !== undefined) this.renderer.disposeInstanced(made.batch);
    const mesh = made?.mesh ?? this.renderer.createMesh(this.grid(kind, cuts));
    const level = { mesh, batch: this.renderer.createInstanced(mesh, capacity), instances: createMeshInstances(capacity) };
    this.levels.set(key, level);
    return level;
  }

  /** A kind's grid cut `cuts` each way, in its tile's frame (its near corner at the origin, metres). */
  private grid(kind: number, cuts: number): Parameters<RendererApi['createMesh']>[0] {
    const side = cuts + 1;
    const count = side * side;
    const k = FAR_CUTS;
    const border = this.borders![kind]!;
    const depth = this.relief.depth;
    const ratio = k / cuts;
    /* A border point's height: straight between the coarsest level's, along that side. */
    const edge = (i: number, j: number): number => {
      const fi = i * ratio;
      const fj = j * ratio;
      if (j === 0 || j === cuts) {
        const a = Math.floor(fi);
        const b = Math.min(k, a + 1);
        const row = (j === 0 ? 0 : k) * (k + 1);
        return border[row + a]! * (1 - (fi - a)) + border[row + b]! * (fi - a);
      }
      const a = Math.floor(fj);
      const b = Math.min(k, a + 1);
      const col = i === 0 ? 0 : k;
      return border[a * (k + 1) + col]! * (1 - (fj - a)) + border[b * (k + 1) + col]! * (fj - a);
    };
    const ys = new Float32Array(count);
    for (let j = 0; j <= cuts; j += 1) {
      for (let i = 0; i <= cuts; i += 1) {
        const onBorder = i === 0 || j === 0 || i === cuts || j === cuts;
        const h = onBorder ? edge(i, j) : heightAt(this.relief, this.uvAt(kind, i / cuts, j / cuts, 0), this.uvAt(kind, i / cuts, j / cuts, 1));
        ys[j * side + i] = -depth * (1 - h);
      }
    }
    const step = this.side / cuts / 1000;
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    const colors = new Float32Array(count * 3);
    const [r, g, b] = this.tint;
    for (let j = 0; j <= cuts; j += 1) {
      for (let i = 0; i <= cuts; i += 1) {
        const v = j * side + i;
        /* Game axes to the player's: x as it is, z turned back. */
        positions[v * 3] = i * step;
        positions[v * 3 + 1] = ys[v]!;
        positions[v * 3 + 2] = -j * step;
        uvs[v * 2] = this.uvAt(kind, i / cuts, j / cuts, 0);
        uvs[v * 2 + 1] = this.uvAt(kind, i / cuts, j / cuts, 1);
        const left = ys[j * side + Math.max(0, i - 1)]!;
        const right = ys[j * side + Math.min(cuts, i + 1)]!;
        const near = ys[Math.max(0, j - 1) * side + i]!;
        const far = ys[Math.min(cuts, j + 1) * side + i]!;
        const gx = (right - left) / ((Math.min(cuts, i + 1) - Math.max(0, i - 1)) * step);
        const gz = (far - near) / ((Math.min(cuts, j + 1) - Math.max(0, j - 1)) * step);
        const l = Math.hypot(gx, 1, gz);
        normals[v * 3] = -gx / l;
        normals[v * 3 + 1] = 1 / l;
        normals[v * 3 + 2] = gz / l;
        colors[v * 3] = r;
        colors[v * 3 + 1] = g;
        colors[v * 3 + 2] = b;
      }
    }
    const indices = new Uint32Array(cuts * cuts * 6);
    let t = 0;
    for (let j = 0; j < cuts; j += 1) {
      for (let i = 0; i < cuts; i += 1) {
        const a = j * side + i;
        const c = a + side;
        indices.set([c, c + 1, a, c + 1, a + 1, a], t);
        t += 6;
      }
    }
    return { positions, normals, colors, emissive: new Float32Array(count), uvs, indices, ...(this.specular === null ? {} : { specular: new Float32Array(count).fill(this.specular) }) };
  }
}
