/**
 * Remastered, puddles lying on a stage's floor (`StageLook.puddles`): flat, dark water a few
 * millimetres over it, scattered by seeded numbers over the stage round the arena (none in its
 * middle, where the fight starts), each one of four outlines of seeded noise turned its own way,
 * mirror-smooth, so the screen's reflections and the stage's probe show in it. They lie where the
 * floor's tiles do, fixed whatever the fight does.
 */
import type { MeshHandle, RendererApi, SurfaceMaterial, SurfaceTextureHandle } from '@driftengine/core';

/** The outlines' picture: two by two of them, each so many texels a side. */
const SHAPES = 2;
const SIDE = 256;
/** How high over the floor the water lies (metres); how far it is scattered each way from the arena's middle, and how far from it none lies. */
const OVER = 0.004;
const REACH = 24;
const DRY = 2.5;
/** A puddle's side, least and most (metres). */
const SIZE = [1.2, 3.2] as const;
/** Water over dark ground: its colour, its roughness (of 255) and its reflectance at the vertices. */
const WATER = [18, 21, 25] as const;
const ROUGHNESS = 6;
const SPECULAR = 0.5;

/** mulberry32: a seeded random source. */
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

/** The outlines: each a blob of smooth noise, round on the whole and ragged at its edge, opaque within it (alpha) and the water's colour. */
function outlines(seed: number): ImageData {
  const next = random(seed);
  const lattice = Float32Array.from({ length: 64 * 64 }, next);
  const value = (x: number, y: number): number => {
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    const at = (p: number, q: number): number => lattice[(p & 63) * 64 + (q & 63)]!;
    return at(i, j) * (1 - u) * (1 - v) + at(i + 1, j) * u * (1 - v) + at(i, j + 1) * (1 - u) * v + at(i + 1, j + 1) * u * v;
  };
  const size = SHAPES * SIDE;
  const image = new ImageData(size, size);
  for (let shape = 0; shape < SHAPES * SHAPES; shape += 1) {
    const ox = (shape % SHAPES) * SIDE;
    const oy = Math.floor(shape / SHAPES) * SIDE;
    const offset = shape * 13.7;
    for (let y = 0; y < SIDE; y += 1) {
      for (let x = 0; x < SIDE; x += 1) {
        const dx = (x + 0.5) / SIDE - 0.5;
        const dy = (y + 0.5) / SIDE - 0.5;
        const noise = 0.6 * value(x / 48 + offset, y / 48) + 0.3 * value(x / 20 + offset + 7, y / 20 + 3) + 0.1 * value(x / 8 + offset, y / 8 + 11);
        /* Wetter toward the middle, gone well inside the square's edge. */
        const wet = noise + 0.55 - 2.6 * Math.hypot(dx, dy) * Math.hypot(dx, dy) * 4;
        const i = ((oy + y) * size + ox + x) * 4;
        image.data.set([WATER[0], WATER[1], WATER[2], wet > 0.5 ? 255 : 0], i);
      }
    }
  }
  return image;
}

export class Puddles {
  readonly mesh: MeshHandle;
  readonly material: SurfaceMaterial<SurfaceTextureHandle>;

  /** `perHundred`: how many puddles lie on a hundred square metres; `seed` the stage's. */
  constructor(renderer: RendererApi, perHundred: number, seed: number) {
    const next = random(seed * 977 + 5);
    const options = { colorSpace: 'srgb', filter: 'linear', mipmap: true, wrap: 'clamp', anisotropy: 16 } as const;
    const albedo = renderer.createSurfaceTexture(outlines(seed), options);
    const orm = renderer.createSurfaceTexture(new ImageData(new Uint8ClampedArray([255, ROUGHNESS, 0, 255]), 1, 1), { colorSpace: 'linear', filter: 'nearest', mipmap: false, wrap: 'clamp' });
    this.material = { albedo, orm, cutout: 0.5, reflectivity: 1 };
    const count = Math.round(((2 * REACH) ** 2 * perHundred) / 100);
    const spots: { x: number; z: number; side: number; turn: number; shape: number }[] = [];
    while (spots.length < count) {
      const x = (next() * 2 - 1) * REACH;
      const z = (next() * 2 - 1) * REACH;
      const side = SIZE[0] + (SIZE[1] - SIZE[0]) * next();
      const turn = next() * Math.PI * 2;
      const shape = Math.floor(next() * SHAPES * SHAPES);
      if (Math.hypot(x, z) < DRY + side / 2) continue;
      spots.push({ x, z, side, turn, shape });
    }
    const positions = new Float32Array(count * 12);
    const normals = new Float32Array(count * 12);
    const uvs = new Float32Array(count * 8);
    const indices = new Uint32Array(count * 6);
    spots.forEach(({ x, z, side, turn, shape }, q) => {
      const c = (Math.cos(turn) * side) / 2;
      const s = (Math.sin(turn) * side) / 2;
      const u0 = (shape % SHAPES) / SHAPES;
      const v0 = Math.floor(shape / SHAPES) / SHAPES;
      /* Corners round the square, wound counter-clockwise seen from above. */
      const corners = [
        [-c + s, -s - c, u0, v0],
        [-c - s, -s + c, u0, v0 + 1 / SHAPES],
        [c - s, s + c, u0 + 1 / SHAPES, v0 + 1 / SHAPES],
        [c + s, s - c, u0 + 1 / SHAPES, v0],
      ] as const;
      corners.forEach(([dx, dz, u, v], k) => {
        positions.set([x + dx, OVER, z + dz], (q * 4 + k) * 3);
        normals.set([0, 1, 0], (q * 4 + k) * 3);
        uvs.set([u, v], (q * 4 + k) * 2);
      });
      indices.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
    });
    this.mesh = renderer.createMesh({
      positions,
      normals,
      colors: new Float32Array(count * 12).fill(1),
      emissive: new Float32Array(count * 4),
      uvs,
      indices,
      specular: new Float32Array(count * 4).fill(SPECULAR),
    });
  }
}
