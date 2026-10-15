/**
 * Grass on the floor, tufts of blades the engine scatters, planted where the floor's texel
 * is green and coloured by it, swaying in the wind.
 */
import { createInstanceData, TrampleField, writeInstance, type Camera, type Environment, type RendererApi, type ScatterHandle } from '@driftengine/core';
import type { GroundState } from './ground.ts';

const BLADES = 16;
/** A tuft's reach (metres), a blade's half-width at its foot, and its height. */
const TUFT = 0.07;
const WIDTH = 0.004;
const HEIGHT = [0.05, 0.11] as const;
/** How far apart the tufts stand (metres). */
const SPACING = 0.075;
/** How many tiles a chunk of tufts takes each way, and how far from the patch's middle tiles grow tufts (tiles): past that, too far to see blades. */
const CHUNK = 2;
const REACH = 4;
const MADE_A_FRAME = 2;

/** A stage's wind: where it blows (metres a second, along x and z) and how gusty it is. */
export interface Wind {
  readonly x: number;
  readonly z: number;
  readonly gust: number;
}

/** A small, seeded random source, so every run plants the same field. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One tuft: blades leaning out from its middle, dark at the foot and light at the tip. */
function tuft(): Parameters<RendererApi['createScatter']>[0] {
  const next = random(7);
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (let b = 0; b < BLADES; b += 1) {
    const angle = next() * Math.PI * 2;
    const r = Math.sqrt(next()) * TUFT;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    const h = HEIGHT[0] + next() * (HEIGHT[1] - HEIGHT[0]);
    const facing = next() * Math.PI;
    const [sx, sz] = [Math.cos(facing) * WIDTH, Math.sin(facing) * WIDTH];
    const lean = 0.25 + next() * 0.35;
    const [lx, lz] = [Math.cos(angle) * h * lean, Math.sin(angle) * h * lean];
    const base = positions.length / 3;
    positions.push(x - sx, 0, z - sz, x + sx, 0, z + sz, x + lx * 0.45 - sx * 0.6, h * 0.55, z + lz * 0.45 - sz * 0.6, x + lx * 0.45 + sx * 0.6, h * 0.55, z + lz * 0.45 + sz * 0.6, x + lx, h, z + lz);
    for (let k = 0; k < 5; k += 1) normals.push(0, 1, 0);
    const foot = 0.35;
    const mid = 0.75;
    colors.push(foot, foot, foot, foot, foot, foot, mid, mid, mid, mid, mid, mid, 1.05, 1.1, 0.95);
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4);
  }
  const n = positions.length / 3;
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), colors: new Float32Array(colors), emissive: new Float32Array(n), uvs: new Float32Array(n * 2), indices: new Uint32Array(indices) };
}

const linear = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

/** How dark a tuft is in a fighter's shadow, against its colour in the sun, and the shadow's soft edge (metres). */
const SHADED = 0.32;
const PENUMBRA = 0.06;

/** A bone's shadow on the floor: from (x0, z0) to (x1, z1), so wide either side. */
export interface Caster {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  radius: number;
}

interface Chunk {
  /** The tiles it was made of. */
  readonly tiles: string;
  readonly data: ReturnType<typeof createInstanceData>;
  readonly tints: Float32Array;
  scatter: ScatterHandle | null;
  readonly min: [number, number];
  readonly max: [number, number];
  shaded: boolean;
}

export class Grass {
  /** Each near tile's tufts, by where it lies and its cell; none where it has no green. */
  private readonly tiles = new Map<string, number[] | null>();
  /** The tufts drawn, by chunk. */
  private readonly chunks = new Map<string, Chunk>();
  /** Where the patch lay when last planted. */
  private placed = '';
  private base: ReturnType<typeof tuft> | null = null;
  private readonly trample = new TrampleField(1.2);
  private last = -1;

  constructor(
    private readonly renderer: RendererApi,
    private readonly pixels: ImageData,
    /** The ground's corners' texture coordinates, four a cell, in the atlas `pixels` is. */
    private readonly uvs: Float32Array,
  ) {}

  /**
   * The tufts on the patch's tiles within `REACH` of its middle: a tile's planted as it comes near
   * (the same tufts each time, seeded by where it lies), let go as it leaves; drawn in chunks of
   * `CHUNK` by `CHUNK` tiles, a chunk made again when its tiles change.
   */
  plant(state: GroundState): void {
    if (!state.drawn || state.near === 0) return;
    /* Nothing to do while the patch lies where it lay. */
    const n = state.near;
    const placed = `${n}:${state.x[2]},${state.z[2]}:${state.x[n * 4 - 2]},${state.z[n * 4 - 2]}`;
    if (placed === this.placed) return;
    this.placed = placed;
    const width = Math.max(state.x[0]!, state.x[1]!, state.x[2]!, state.x[3]!) - Math.min(state.x[0]!, state.x[1]!, state.x[2]!, state.x[3]!) || 1;
    let cx = 0;
    let cz = 0;
    for (let v = 0; v < n * 4; v += 1) {
      cx += state.x[v]!;
      cz += state.z[v]!;
    }
    cx /= n * 4;
    cz /= n * 4;
    const wanted = new Map<string, string>();
    for (let q = 0; q < state.near; q += 1) {
      const x = Math.min(state.x[q * 4]!, state.x[q * 4 + 1]!, state.x[q * 4 + 2]!, state.x[q * 4 + 3]!);
      const z = Math.min(state.z[q * 4]!, state.z[q * 4 + 1]!, state.z[q * 4 + 2]!, state.z[q * 4 + 3]!);
      if (Math.max(Math.abs(x + width / 2 - cx), Math.abs(z + width / 2 - cz)) > REACH * width) continue;
      const key = `${x},${z},${state.cell[q]}`;
      wanted.set(key, `${Math.floor(x / (CHUNK * width))},${Math.floor(z / (CHUNK * width))}`);
      if (!this.tiles.has(key)) this.tiles.set(key, this.plantTile(state, q));
    }
    for (const key of [...this.tiles.keys()]) if (!wanted.has(key)) this.tiles.delete(key);
    /* Each chunk's tiles, and the chunks whose tiles are not those they were made of. */
    const members = new Map<string, string[]>();
    for (const [key, chunk] of wanted) members.set(chunk, [...(members.get(chunk) ?? []), key]);
    /* Chunks the patch has left go now; one whose tiles changed is made again, and only then replaced. */
    for (const [key, chunk] of this.chunks) {
      if (members.has(key)) continue;
      if (chunk.scatter !== null) this.renderer.disposeScatter(chunk.scatter);
      this.chunks.delete(key);
    }
    /* At most `MADE_A_FRAME` chunks made a frame; the rest the next, as the patch lies. */
    let made = 0;
    for (const [key, tiles] of members) {
      const joined = tiles.sort().join('|');
      const old = this.chunks.get(key);
      if (old?.tiles === joined) continue;
      if (made === MADE_A_FRAME) {
        this.placed = '';
        break;
      }
      made += 1;
      const planted = this.chunkOf(tiles.map((t) => this.tiles.get(t) ?? null));
      if (old?.scatter != null) this.renderer.disposeScatter(old.scatter);
      this.chunks.set(key, planted !== null ? { ...planted, tiles: joined } : { data: createInstanceData(0), tints: new Float32Array(0), scatter: null, min: [0, 0], max: [0, 0], shaded: false, tiles: joined });
    }
  }

  /** A chunk's tufts, from its tiles'. */
  private chunkOf(lists: (number[] | null)[]): Omit<Chunk, 'tiles'> | null {
    const list = lists.flatMap((l) => l ?? []);
    const n = list.length / 9;
    if (n === 0) return null;
    const instances = createInstanceData(n);
    const tints = new Float32Array(n * 3);
    let [minX, minZ, maxX, maxZ] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i += 1) {
      const v = list.slice(i * 9, i * 9 + 9);
      writeInstance(instances, i, v[0]!, 0, v[1]!, v[2]!, v[3]!, v[4]!, v[5]!, v[6]!, v[7]!, 0.5, v[8]!);
      tints.set([v[4]!, v[5]!, v[6]!], i * 3);
      minX = Math.min(minX, v[0]!);
      maxX = Math.max(maxX, v[0]!);
      minZ = Math.min(minZ, v[1]!);
      maxZ = Math.max(maxZ, v[1]!);
    }
    instances.count = n;
    this.base ??= tuft();
    return { data: instances, tints, scatter: this.renderer.createScatter(this.base, instances), min: [minX, minZ], max: [maxX, maxZ], shaded: false };
  }

  /** A tile's tufts (place, size, turn, colour, lean, phase: nine numbers each), where its texels are green, or none. */
  private plantTile(state: GroundState, q: number): number[] | null {
    const { width, height, data } = this.pixels;
    const cell = state.cell[q]!;
    const next = random((Math.imul(state.x[q * 4 + 2]!, 73856093) ^ Math.imul(state.z[q * 4 + 2]!, 19349663) ^ cell) >>> 0);
    const corner = (k: number): [number, number, number, number] => [state.x[q * 4 + k]! / 1000, -state.z[q * 4 + k]! / 1000, this.uvs[(cell * 4 + k) * 2]!, this.uvs[(cell * 4 + k) * 2 + 1]!];
    const c = [corner(0), corner(1), corner(2), corner(3)];
    const side = Math.max(Math.hypot(c[1]![0] - c[0]![0], c[1]![1] - c[0]![1]), Math.hypot(c[2]![0] - c[0]![0], c[2]![1] - c[0]![1]));
    const steps = Math.max(1, Math.round(side / SPACING));
    const list: number[] = [];
    for (let i = 0; i < steps; i += 1) {
      for (let j = 0; j < steps; j += 1) {
        const s = (i + next()) / steps;
        const t = (j + next()) / steps;
        const w = [(1 - s) * (1 - t), s * (1 - t), (1 - s) * t, s * t];
        const at = (k: number): number => w[0]! * c[0]![k]! + w[1]! * c[1]![k]! + w[2]! * c[2]![k]! + w[3]! * c[3]![k]!;
        const px = Math.min(width - 1, Math.max(0, Math.floor(at(2) * width)));
        const py = Math.min(height - 1, Math.max(0, Math.floor(at(3) * height)));
        const o = (py * width + px) * 4;
        const [r, g, b] = [data[o]!, data[o + 1]!, data[o + 2]!];
        const green = g - Math.max(r, b);
        const pale = (r + g + b) / 3;
        const keep = Math.min(1, Math.max(0, (green - 6) / 18)) * (pale > 150 ? 0 : 1);
        if (next() >= keep) continue;
        const lift = 0.9 + next() * 0.35;
        list.push(at(0), at(1), 0.75 + next() * 0.6, next() * Math.PI * 2, linear(r) * lift * 1.6, linear(g) * lift * 1.5, linear(b) * lift * 1.3, 0.35 + next() * 0.35, next() * 6.283);
      }
    }
    return list.length === 0 ? null : list;
  }

  /** Something heavy on the floor at (x, z) this frame. */
  press(x: number, z: number): void {
    this.trample.press(x, 0, z);
  }

  /**
   * The fighters' shadows on the grass this frame: each tuft of a chunk a shadow reaches darkened
   * by how far inside a bone's shadow it stands, and a chunk it has left given its colours back.
   */
  shade(casters: readonly Caster[]): void {
    let lo = [Infinity, Infinity];
    let hi = [-Infinity, -Infinity];
    for (const c of casters) {
      lo = [Math.min(lo[0]!, c.x0 - c.radius, c.x1 - c.radius), Math.min(lo[1]!, c.z0 - c.radius, c.z1 - c.radius)];
      hi = [Math.max(hi[0]!, c.x0 + c.radius, c.x1 + c.radius), Math.max(hi[1]!, c.z0 + c.radius, c.z1 + c.radius)];
    }
    for (const chunk of this.chunks.values()) {
      if (chunk.scatter === null) continue;
      const reached = chunk.max[0] > lo[0]! && chunk.min[0] < hi[0]! && chunk.max[1] > lo[1]! && chunk.min[1] < hi[1]!;
      if (!reached && !chunk.shaded) continue;
      const { data, tints } = chunk;
      for (let i = 0; i < data.count; i += 1) {
        const x = data.positions[i * 3]!;
        const z = data.positions[i * 3 + 2]!;
        let light = 1;
        if (reached && x > lo[0]! && x < hi[0]! && z > lo[1]! && z < hi[1]!) {
          for (const c of casters) {
            const dx = c.x1 - c.x0;
            const dz = c.z1 - c.z0;
            const len = dx * dx + dz * dz;
            const t = len === 0 ? 0 : Math.min(1, Math.max(0, ((x - c.x0) * dx + (z - c.z0) * dz) / len));
            const d = Math.hypot(x - c.x0 - t * dx, z - c.z0 - t * dz) - c.radius;
            if (d < PENUMBRA) light = Math.min(light, SHADED + (1 - SHADED) * Math.max(0, d / PENUMBRA));
          }
        }
        for (let k = 0; k < 3; k += 1) data.tints[i * 3 + k] = tints[i * 3 + k]! * light;
      }
      chunk.shaded = reached;
      if (chunk.scatter !== null) this.renderer.uploadScatter(chunk.scatter, data);
    }
  }

  draw(camera: Camera, env: Environment, time: number, wind: Wind): void {
    if (this.last >= 0) this.trample.update(Math.max(0, time - this.last));
    this.last = time;
    for (const chunk of this.chunks.values()) if (chunk.scatter !== null) this.renderer.drawScatter(chunk.scatter, chunk.data, camera, env, wind.x, wind.z, wind.gust, time, this.trample.data);
  }
}
