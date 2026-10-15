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
  /** Whether it is the sky over the stage: a picture, drawn unlit as the game draws it. */
  readonly far?: boolean;
}

/** How high up (metres) the sky over a stage lies, and how level (its normal's upward share) or how far facing down. */
const HIGH_UP = 4.5;
const LEVEL = 0.9;
const DOWN = 0.3;

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
  /** Drawn lit, by the normals its polygons' faces give it. */
  readonly lit: boolean;
}

/**
 * How a stage is drawn lit: the scene's light (toward the sun, its colour, the sky's and the
 * ground's ambient) and how bright a surface is against its own colours in shade and in full sun;
 * with its maps where it has them.
 */
export interface StageLook {
  readonly light: {
    readonly dir: ArrayLike<number>;
    readonly sun: ArrayLike<number>;
    readonly sky: ArrayLike<number>;
    readonly ground: ArrayLike<number>;
    readonly shade: number;
    readonly sunlit: number;
  };
  readonly normal?: SurfaceTextureHandle | null;
  readonly orm?: SurfaceTextureHandle | null;
  /** Whether the scenery is rock, whose free edges take the relief too. */
  readonly ragged?: boolean;
  /** The atlas's heights (0 low, 255 high), which the solid scenery is cut finer and raised by, `relief` metres between. */
  readonly height?: ImageData | null;
  readonly relief?: number;
}

/** The longest a cut edge is (metres) and the most pieces a polygon's edge is cut into. */
const CUT_EDGE = 0.25;
const MOST_CUTS = 24;
/** The most a polygon's relief spans, as a share of its narrowest width; and the narrowest width (metres) below which it is left flat and whole: a step's riser and tread keep their straight shape and their even light. */
const NARROW_RELIEF = 0.15;
const FLAT_BELOW = 0.5;

/** A height map's broad forms (0 to 1): its fine grain is the normal map's, which in the geometry would be spikes. */
interface Heights {
  readonly width: number;
  readonly height: number;
  readonly data: Float32Array;
}

/** The height map blurred `r` texels each way. */
function broadHeights(image: ImageData, r: number): Heights {
  const { width: w, height: h } = image;
  const src = new Float32Array(w * h);
  for (let i = 0; i < w * h; i += 1) src[i] = image.data[i * 4]! / 255;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    let sum = 0;
    for (let x = -r; x <= r; x += 1) sum += src[y * w + Math.min(w - 1, Math.max(0, x))]!;
    for (let x = 0; x < w; x += 1) {
      tmp[y * w + x] = sum / (2 * r + 1);
      sum += src[y * w + Math.min(w - 1, x + r + 1)]! - src[y * w + Math.max(0, x - r)]!;
    }
  }
  for (let x = 0; x < w; x += 1) {
    let sum = 0;
    for (let y = -r; y <= r; y += 1) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]!;
    for (let y = 0; y < h; y += 1) {
      out[y * w + x] = sum / (2 * r + 1);
      sum += tmp[Math.min(h - 1, y + r + 1) * w + x]! - tmp[Math.max(0, y - r) * w + x]!;
    }
  }
  return { width: w, height: h, data: out };
}

/** A height map's value at (u, v), read smoothly. */
function heightAt(image: Heights, u: number, v: number): number {
  const x = Math.min(image.width - 1, Math.max(0, u * image.width - 0.5));
  const y = Math.min(image.height - 1, Math.max(0, v * image.height - 0.5));
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const at = (a: number, b: number): number => image.data[Math.min(image.height - 1, b) * image.width + Math.min(image.width - 1, a)]!;
  return at(i, j) * (1 - fx) * (1 - fy) + at(i + 1, j) * fx * (1 - fy) + at(i, j + 1) * (1 - fx) * fy + at(i + 1, j + 1) * fx * fy;
}

/** A mesh's attributes, as `createMesh` takes them. */
interface Attributes {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

/**
 * A piece's polygons cut into a grid fine enough to carry its texture's relief, each point
 * raised along its normal by the height under it; toward an edge another polygon shares the rise
 * fades out over two cuts, so no crack opens, and toward a free edge too unless `ragged` (a cliff's
 * top against the sky, which takes it in full and stops being straight), so what is built keeps its
 * straight edges. Unless it is rock, it only sinks into its plane, its carvings cut in, and never
 * stands out of it over a neighbour's edge (a riser over its tread). A narrow polygon rises less,
 * and one narrower still not at all, left whole (`NARROW_RELIEF`, `FLAT_BELOW`). Each point is lit
 * as the raised surface faces there, turning back to the polygon's own normal as its rise fades
 * toward an edge.
 */
function raised(own: readonly number[], positions: Float32Array, normals: Float32Array, colors: Float32Array, uvs: Float32Array, shared: (a: number, b: number) => boolean, image: Heights, relief: number, ragged: boolean): Attributes {
  const P: number[] = [];
  const N: number[] = [];
  const C: number[] = [];
  const U: number[] = [];
  const I: number[] = [];
  /* Each point's share of its raised surface's own facing (1 where it rises in full, 0 at a shared edge). */
  const facing: number[] = [];
  for (let t = 0; t < own.length; t += 3) {
    const [a, b, c] = [own[t]!, own[t + 1]!, own[t + 2]!];
    const length = (i: number, j: number): number => Math.hypot(positions[i * 3]! - positions[j * 3]!, positions[i * 3 + 1]! - positions[j * 3 + 1]!, positions[i * 3 + 2]! - positions[j * 3 + 2]!);
    const longest = Math.max(length(a, b), length(b, c), length(c, a));
    /* Its narrowest width: twice its area over its longest side. */
    const from = (j: number): [number, number, number] => [positions[j * 3]! - positions[a * 3]!, positions[j * 3 + 1]! - positions[a * 3 + 1]!, positions[j * 3 + 2]! - positions[a * 3 + 2]!];
    const [ab, ac] = [from(b), from(c)];
    const narrow = Math.hypot(ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]) / (longest || 1);
    const span = narrow < FLAT_BELOW ? 0 : Math.min(relief, NARROW_RELIEF * narrow);
    const n = span === 0 ? 1 : Math.min(MOST_CUTS, Math.max(1, Math.ceil(longest / CUT_EDGE)));
    /* Each edge shared or free, by the weight that is zero along it: bc by a's, ca by b's, ab by c's. */
    const held = ragged ? [shared(b, c), shared(c, a), shared(a, b)] : [true, true, true];
    const base = P.length / 3;
    const index = (i: number, j: number): number => base + (i * (2 * n + 3 - i)) / 2 + j;
    for (let i = 0; i <= n; i += 1) {
      for (let j = 0; j <= n - i; j += 1) {
        const w = [1 - (i + j) / n, i / n, j / n];
        const mix = (array: Float32Array, size: number, k: number): number => w[0]! * array[a * size + k]! + w[1]! * array[b * size + k]! + w[2]! * array[c * size + k]!;
        const u = mix(uvs, 2, 0);
        const v = mix(uvs, 2, 1);
        let nx = mix(normals, 3, 0);
        let ny = mix(normals, 3, 1);
        let nz = mix(normals, 3, 2);
        const l = Math.hypot(nx, ny, nz) || 1;
        [nx, ny, nz] = [nx / l, ny / l, nz / l];
        let near = 1;
        for (let e = 0; e < 3; e += 1) if (held[e]) near = Math.min(near, (w[e]! * n) / 2);
        const out = n > 1 || !held.every(Boolean) ? (heightAt(image, u, v) - 0.5) * span * Math.min(1, near) : 0;
        const rise = ragged ? out : Math.min(0, out);
        P.push(mix(positions, 3, 0) + nx * rise, mix(positions, 3, 1) + ny * rise, mix(positions, 3, 2) + nz * rise);
        N.push(nx, ny, nz);
        facing.push(span > 0 && (n > 1 || !held.every(Boolean)) ? Math.min(1, near) : 0);
        C.push(mix(colors, 3, 0), mix(colors, 3, 1), mix(colors, 3, 2));
        U.push(u, v);
      }
    }
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n - i; j += 1) {
        I.push(index(i, j), index(i + 1, j), index(i, j + 1));
        if (j < n - i - 1) I.push(index(i + 1, j), index(i + 1, j + 1), index(i, j + 1));
      }
    }
  }
  /* The raised surface's facing at each point, from the triangles round it. */
  const faced = new Float32Array(P.length);
  for (let t = 0; t < I.length; t += 3) {
    const [a, b, c] = [I[t]!, I[t + 1]!, I[t + 2]!];
    const e1 = [P[b * 3]! - P[a * 3]!, P[b * 3 + 1]! - P[a * 3 + 1]!, P[b * 3 + 2]! - P[a * 3 + 2]!];
    const e2 = [P[c * 3]! - P[a * 3]!, P[c * 3 + 1]! - P[a * 3 + 1]!, P[c * 3 + 2]! - P[a * 3 + 2]!];
    const across = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    for (const v of [a, b, c]) for (let k = 0; k < 3; k += 1) faced[v * 3 + k] = faced[v * 3 + k]! + across[k]!;
  }
  for (let v = 0; v < P.length / 3; v += 1) {
    const own = [N[v * 3]!, N[v * 3 + 1]!, N[v * 3 + 2]!];
    let f = [faced[v * 3]!, faced[v * 3 + 1]!, faced[v * 3 + 2]!];
    const l = Math.hypot(...f);
    if (l === 0) continue;
    f = f.map((x) => x / l);
    /* The triangles' winding may face either way: the raised facing turned the way the polygon's own faces. */
    if (f[0]! * own[0]! + f[1]! * own[1]! + f[2]! * own[2]! < 0) f = f.map((x) => -x);
    const k = facing[v]!;
    const mixed = own.map((x, i) => x * (1 - k) + f[i]! * k);
    const m = Math.hypot(...mixed) || 1;
    for (let i = 0; i < 3; i += 1) N[v * 3 + i] = mixed[i]! / m;
  }
  return { positions: new Float32Array(P), normals: new Float32Array(N), colors: new Float32Array(C), uvs: new Float32Array(U), indices: new Uint32Array(I) };
}

/**
 * Each vertex's normal, its own faces' and those of the faces meeting it at its place
 * turned less than 60 degrees from them, so curved rock is smooth and a corner stays sharp.
 */
function normalsOf(positions: Float32Array, indices: Uint32Array): Float32Array {
  const faces = new Float32Array(indices.length);
  const at = new Map<string, number[]>();
  const keyOf = (i: number): string => `${Math.round(positions[i * 3]! * 1000)},${Math.round(positions[i * 3 + 1]! * 1000)},${Math.round(positions[i * 3 + 2]! * 1000)}`;
  const own = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t]!, indices[t + 1]!, indices[t + 2]!];
    const u = [0, 1, 2].map((k) => positions[b * 3 + k]! - positions[a * 3 + k]!);
    const v = [0, 1, 2].map((k) => positions[c * 3 + k]! - positions[a * 3 + k]!);
    const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    faces.set(n, t);
    for (const i of [a, b, c]) {
      for (let k = 0; k < 3; k += 1) own[i * 3 + k]! += n[k]!;
      const key = keyOf(i);
      let list = at.get(key);
      if (list === undefined) at.set(key, (list = []));
      list.push(t);
    }
  }
  const out = new Float32Array(positions.length);
  const unit = (x: number, y: number, z: number): [number, number, number] => {
    const l = Math.hypot(x, y, z) || 1;
    return [x / l, y / l, z / l];
  };
  for (let i = 0; i < positions.length / 3; i += 1) {
    const mine = unit(own[i * 3]!, own[i * 3 + 1]!, own[i * 3 + 2]!);
    const sum = [0, 0, 0];
    for (const t of new Set(at.get(keyOf(i)) ?? [])) {
      const f = unit(faces[t]!, faces[t + 1]!, faces[t + 2]!);
      if (f[0] * mine[0] + f[1] * mine[1] + f[2] * mine[2] < 0.5) continue;
      for (let k = 0; k < 3; k += 1) sum[k]! += faces[t + k]!;
    }
    out.set(sum[0] === 0 && sum[1] === 0 && sum[2] === 0 ? mine : unit(sum[0]!, sum[1]!, sum[2]!), i * 3);
  }
  return out;
}

export function createStage(renderer: RendererApi, buffer: ArrayBuffer, texture: SurfaceTextureHandle, look: StageLook | null = null): Stage {
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
  const smooth = look === null ? null : normalsOf(positions, indices);
  if (look !== null && smooth !== null) {
    /*
     * Each vertex's colour over the light the scene will give it, times the light it is meant to
     * show: its own colour in shade, brighter where the sun falls full on it.
     */
    const { dir, sun, sky, ground, shade, sunlit } = look.light;
    const l = Math.hypot(dir[0]!, dir[1]!, dir[2]!) || 1;
    const lum = (c: ArrayLike<number>): number => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    for (let i = 0; i < n; i += 1) {
      const [nx, ny, nz] = [smooth[i * 3]!, smooth[i * 3 + 1]!, smooth[i * 3 + 2]!];
      const ndl = Math.max(0, (nx * dir[0]! + ny * dir[1]! + nz * dir[2]!) / l);
      const ambient = (lum(sky) * (1 + ny)) / 2 + (lum(ground) * (1 - ny)) / 2;
      const k = (shade + sunlit * ndl) / (ambient + lum(sun) * ndl);
      for (let c = 0; c < 3; c += 1) colors[i * 3 + c]! *= k;
    }
  }
  /* A triangle's kind, by its first vertex: its layer, whether its back is drawn and whether it is cut out. */
  const kindOf = (i: number): number => flags[i]! & (ONE_SIDED | (3 << LAYER_SHIFT) | CUT);
  /* Which edges two polygons share, by where their ends lie. */
  const edges = new Map<string, number>();
  const placeOf = (i: number): string => `${Math.round(positions[i * 3]! / UNIT_M)},${Math.round(positions[i * 3 + 1]! / UNIT_M)},${Math.round(positions[i * 3 + 2]! / UNIT_M)}`;
  const edgeOf = (i: number, j: number): string => [placeOf(i), placeOf(j)].sort().join('|');
  if (look?.height != null) {
    for (let t = 0; t < indexCount; t += 3) {
      for (const [i, j] of [[indices[t]!, indices[t + 1]!], [indices[t + 1]!, indices[t + 2]!], [indices[t + 2]!, indices[t]!]] as const) {
        const key = edgeOf(i, j);
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
  }
  const shared = (i: number, j: number): boolean => (edges.get(edgeOf(i, j)) ?? 0) > 1;
  const broad = look?.height != null ? broadHeights(look.height, Math.max(2, Math.round(look.height.width / 512))) : null;
  const piece = (own: number[], kind: number): StagePiece => {
    /* The sky: in the farthest layer, wholly high up, level or facing down to the arena. */
    let far = ((kind >> LAYER_SHIFT) & 3) === 0 && smooth !== null;
    for (const i of own) {
      if (!far) break;
      const ny = smooth![i * 3 + 1]!;
      far = positions[i * 3 + 1]! > HIGH_UP && (Math.abs(ny) > LEVEL || ny < -DOWN);
    }
    if (broad !== null && smooth !== null && (kind & CUT) === 0 && !far && (look?.relief ?? 0.3) > 0) {
      const raisedPiece = raised(own, positions, smooth, colors, uvs, shared, broad, look?.relief ?? 0.3, look?.ragged === true);
      const mesh = renderer.createMesh({ ...raisedPiece, emissive: new Float32Array(raisedPiece.positions.length / 3) });
      return { mesh, layer: (kind >> LAYER_SHIFT) & 3, oneSided: (kind & ONE_SIDED) !== 0, cut: false, far };
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (const i of own) {
      lo = Math.min(lo, i);
      hi = Math.max(hi, i);
    }
    const m = hi - lo + 1;
    const normals = smooth !== null ? smooth.slice(lo * 3, (hi + 1) * 3) : new Float32Array(m * 3);
    if (smooth === null) for (let i = 0; i < m; i += 1) normals[i * 3 + 1] = 1;
    const mesh = renderer.createMesh({
      positions: positions.slice(lo * 3, (hi + 1) * 3),
      normals,
      colors: colors.slice(lo * 3, (hi + 1) * 3),
      emissive: new Float32Array(m),
      uvs: uvs.slice(lo * 2, (hi + 1) * 2),
      indices: Uint32Array.from(own, (i) => i - lo),
    });
    return { mesh, layer: (kind >> LAYER_SHIFT) & 3, oneSided: (kind & ONE_SIDED) !== 0, cut: (kind & CUT) !== 0, far };
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
  const maps = { ...(look?.normal == null ? {} : { normal: look.normal, normalStrength: 1 }), ...(look?.orm == null ? {} : { orm: look.orm }) };
  return {
    cells,
    cellSize,
    grid,
    atlasWidth: width,
    atlasHeight: height,
    material: { albedo: texture, cutout: 0.5, doubleSided: true, ...maps },
    oneSidedMaterial: { albedo: texture, cutout: 0.5, doubleSided: false, ...maps },
    lit: look !== null,
  };
}

/** A stage mesh's atlas size, which its ground's texture coordinates are in too. */
export function stageAtlasSize(buffer: ArrayBuffer): { width: number; height: number } {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== STG_MAGIC || view.getUint32(4, true) !== STG_VERSION) throw new Error(`not a version ${STG_VERSION} stage mesh; run \`npm run extract\``);
  return { width: view.getUint16(16, true), height: view.getUint16(18, true) };
}
