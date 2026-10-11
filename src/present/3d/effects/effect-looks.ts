/**
 * How each effect looks, built new on the original's sheets: from a piece (its point, drift, age,
 * colour and seed) the particles, sprites and lights that draw it this frame. Every one is a
 * function of the piece alone, so a held frame holds and a replay draws the same. Light is drawn
 * sharp and saturated, past white where it should bloom; dust and breath cover.
 *
 * Effects are composed from layers (a flash, a flare, rays, needles, shards, a shock ring, arcs,
 * a web of filaments, crescents, orbs, sparkles, a spray, smoke and a light on the world), and
 * each fighter's heavy spark is a recipe of them reconstructing its own sheet. The Mishimas'
 * lightning is their sheet itself: each frame's bolts, traced at import, drawn as the engine's
 * bolts over the sprite's square at the size the game gives it, frame by frame.
 */
import type { BoltSegments } from '@driftengine/core';
import type { LightningStroke } from '../../../sim/data/effects.ts';
import type { EffectPiece } from './effect-pieces.ts';
import { Shape } from './flipbooks.ts';

export type Vec3 = readonly [number, number, number];

/** Particles as the engine's particle batches read them. */
export interface ParticleSet {
  readonly positions: Float32Array;
  readonly velocities: Float32Array;
  readonly sizes: Float32Array;
  readonly spins: Float32Array;
  readonly colors: Float32Array;
  readonly alphas: Float32Array;
  readonly ages: Float32Array;
  readonly seeds: Float32Array;
  /** A sprite's cell, and its half-height where it is not square (0 square); read by the sprites alone. */
  readonly frames: Float32Array;
  readonly heights: Float32Array;
  count: number;
  readonly capacity: number;
}

/** Lights the effects cast on the world this frame. */
export interface EffectLights {
  readonly positions: Float32Array;
  readonly colors: Float32Array;
  readonly radii: Float32Array;
  count: number;
  readonly capacity: number;
}

export interface EffectBuffers {
  /** Streaks of light (rays, shards, rings, arcs, filaments, bursts), added. */
  readonly streaks: ParticleSet;
  /** Points of light (flashes, orbs, sparkles), added. */
  readonly glows: ParticleSet;
  /** Shapes from the sheet (rings, stars, blobs, crescents, sprays, flames), added. */
  readonly shapes: ParticleSet;
  /** Soft puffs from the sheet (dust, breath), blended. */
  readonly puffs: ParticleSet;
  /** The Mishimas' lightning: the segments of its arcs, drawn as the engine's bolts. */
  readonly bolts: BoltSegments;
  readonly lights: EffectLights;
}

function boltSegments(capacity: number): BoltSegments {
  return {
    from: new Float32Array(capacity * 3),
    to: new Float32Array(capacity * 3),
    along: new Float32Array(capacity),
    fade: new Float32Array(capacity),
    seed: new Float32Array(capacity),
    brightness: new Float32Array(capacity),
    count: 0,
    capacity,
  };
}

export function particleSet(capacity: number): ParticleSet {
  return {
    positions: new Float32Array(capacity * 3),
    velocities: new Float32Array(capacity * 3),
    sizes: new Float32Array(capacity),
    spins: new Float32Array(capacity),
    colors: new Float32Array(capacity * 3),
    alphas: new Float32Array(capacity),
    ages: new Float32Array(capacity),
    seeds: new Float32Array(capacity),
    frames: new Float32Array(capacity),
    heights: new Float32Array(capacity),
    count: 0,
    capacity,
  };
}

export function effectBuffers(): EffectBuffers {
  const lights = 8;
  return {
    streaks: particleSet(4096),
    glows: particleSet(1024),
    shapes: particleSet(1024),
    puffs: particleSet(256),
    bolts: boltSegments(512),
    lights: { positions: new Float32Array(lights * 3), colors: new Float32Array(lights * 3), radii: new Float32Array(lights), count: 0, capacity: lights },
  };
}

/** Seconds of travel a streak is stretched over; the streak batch is made with the same. */
export const STRETCH = 0.04;

/**
 * How large the effects are against the sizes their recipes are written in: an original frame is
 * about half a metre across where it is drawn, measured against the fighters' bodies.
 */
const SCALE = 1.6;

/** The view's right and up, in the world: what shapes across the view are laid on. */
export interface ViewBasis {
  readonly right: Vec3;
  readonly up: Vec3;
}

/* ---- Helpers. ---- */

/** A number in [0, 1) from a seed and an index, the same every time. */
function unit(seed: number, i: number): number {
  let h = Math.imul(seed ^ Math.imul(i + 1, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** A direction from a seed: even over the sphere, bent toward `toward` by `bias`. */
function direction(seed: number, i: number, toward: Vec3, bias: number): [number, number, number] {
  const z = unit(seed, i * 2) * 2 - 1;
  const a = unit(seed, i * 2 + 1) * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  const d: [number, number, number] = [r * Math.cos(a) + toward[0] * bias, z + toward[1] * bias, r * Math.sin(a) + toward[2] * bias];
  const length = Math.hypot(d[0], d[1], d[2]) || 1;
  return [d[0] / length, d[1] / length, d[2] / length];
}

const easeOut = (t: number): number => 1 - (1 - t) ** 3;
const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
/** Where `t` is within `[from, to]`, 0 to 1. */
const within = (t: number, from: number, to: number): number => clamp01((t - from) / (to - from));
const unitOf = (v: Vec3): [number, number, number] => {
  const length = Math.hypot(v[0], v[1], v[2]);
  return length === 0 ? [0, 0, 0] : [v[0] / length, v[1] / length, v[2] / length];
};
const scaled = (c: Vec3, k: number): Vec3 => [c[0] * k, c[1] * k, c[2] * k];
const mixed = (from: Vec3, to: Vec3, t: number): Vec3 => [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t];
const along = (p: Vec3, d: Vec3, k: number): Vec3 => [p[0] + d[0] * k, p[1] + d[1] * k, p[2] + d[2] * k];
const WHITE: Vec3 = [1, 1, 1];

/** The frame of the effect's life it is on, for flicker and re-striking. */
const frameOf = (p: EffectPiece): number => Math.floor(p.age * p.frames);
/** A twinkle: a brightness from 0.35 to 1, new each `every` frames. */
const twinkle = (p: EffectPiece, i: number, every = 1): number => 0.35 + 0.65 * unit(p.seed + Math.floor(frameOf(p) / every) * 7919, i);

function put(set: ParticleSet, p: Vec3, v: Vec3, size: number, colour: Vec3, alpha: number, age: number, seed: number): number {
  if (set.count >= set.capacity) return -1;
  const i = set.count;
  set.positions.set(p, i * 3);
  set.velocities.set(v, i * 3);
  set.sizes[i] = size;
  set.spins[i] = 0;
  set.frames[i] = 0;
  set.heights[i] = 0;
  set.colors.set(colour, i * 3);
  set.alphas[i] = alpha;
  set.ages[i] = age;
  set.seeds[i] = (seed % 1000) / 1000;
  set.count += 1;
  return i;
}

/**
 * How far the streak batch stretches a particle, as a share of its travel over `STRETCH`: about its
 * centre, half each way, through the quad's corners, which lie at 45° to its travel. A particle at a
 * segment's middle travelling the segment times this over `STRETCH` reaches both its ends, its tips
 * fading out a half-width past them.
 */
const STRETCH_REACH = Math.SQRT2;

/** The particle drawing a streak from `from` to `to`: at its middle, travelling so it is stretched end to end. */
export function streakParticle(from: Vec3, to: Vec3): { position: Vec3; velocity: Vec3 } {
  const k = STRETCH_REACH / STRETCH;
  return { position: mixed(from, to, 0.5), velocity: [(to[0] - from[0]) * k, (to[1] - from[1]) * k, (to[2] - from[2]) * k] };
}

/** A streak of light from `from` to `to`. */
function streak(out: EffectBuffers, from: Vec3, to: Vec3, width: number, colour: Vec3, age: number, seed: number): void {
  const { position, velocity } = streakParticle(from, to);
  put(out.streaks, position, velocity, width, colour, 1, age, seed);
}

/** A shape from the sheet at a point, `size` its half-width, turned by `spin` across the view. */
function shape(out: EffectBuffers, cell: number, at: Vec3, size: number, colour: Vec3, spin: number, age: number, seed: number): void {
  const i = put(out.shapes, at, [0, 0, 0], size, colour, 1, age, seed);
  if (i < 0) return;
  out.shapes.spins[i] = spin;
  out.shapes.frames[i] = cell;
}

/** A point across the view from `centre`, at an angle and a radius. */
function acrossView(view: ViewBasis, centre: Vec3, angle: number, radius: number): Vec3 {
  const c = Math.cos(angle) * radius;
  const s = Math.sin(angle) * radius;
  return [centre[0] + view.right[0] * c + view.up[0] * s, centre[1] + view.right[1] * c + view.up[1] * s, centre[2] + view.right[2] * c + view.up[2] * s];
}

/** The view's depth axis: across both its right and its up. */
function depthOf(view: ViewBasis): Vec3 {
  const [r, u] = [view.right, view.up];
  return [r[1] * u[2] - r[2] * u[1], r[2] * u[0] - r[0] * u[2], r[0] * u[1] - r[1] * u[0]];
}

/** The blow's direction as an angle across the view. */
function blowAngle(view: ViewBasis, p: EffectPiece): number {
  const v = p.velocity;
  return Math.atan2(v[0] * view.up[0] + v[1] * view.up[1] + v[2] * view.up[2], v[0] * view.right[0] + v[1] * view.right[1] + v[2] * view.right[2]);
}

/* ---- Layers. ---- */

/** The flash of impact: a hard point of light, white only in its first instants. */
function flash(out: EffectBuffers, p: EffectPiece, colour: Vec3, size: number, heat: number, length = 1): void {
  const t = within(p.age, 0, length);
  if (t >= 1) return;
  const hot = mixed(WHITE, colour, Math.min(1, t * 5));
  put(out.glows, p.position, [0, 0, 0], (size * (1 - t) ** 1.5 + 0.004) * SCALE, scaled(hot, heat * (1 - t) ** 2), 1, p.age, p.seed);
}

/** A sheet shape swelling from `from` to `to` (half-widths) over a window of the life, fading. */
function bloomShape(out: EffectBuffers, p: EffectPiece, cell: number, colour: Vec3, from: number, to: number, heat: number, start: number, end: number, spin = 0): void {
  const t = within(p.age, start, end);
  if (p.age < start || t >= 1) return;
  shape(out, cell, p.position, (from + (to - from) * easeOut(t)) * SCALE, scaled(colour, heat * (1 - t) ** 1.5), spin, p.age, p.seed + cell);
}

/** Rays: thin spikes bursting from the point along the blow, full at once and drawing back in. */
function rays(out: EffectBuffers, p: EffectPiece, colour: Vec3, count: number, reach: number, width: number, heat: number, bias = 0.8, end = 1): void {
  const t = within(p.age, 0, end);
  if (t >= 1) return;
  const blow = unitOf(p.velocity);
  for (let i = 0; i < count; i += 1) {
    const d = direction(p.seed, i, blow, bias);
    const length = reach * SCALE * (0.45 + 0.55 * unit(p.seed, 40 + i)) * easeOut(Math.min(1, t * 6)) * (1 - t) ** 0.6;
    const start = reach * SCALE * 0.12 * easeOut(t);
    streak(out, along(p.position, d, start), along(p.position, d, start + length), width * SCALE * (1 - t * 0.6), scaled(colour, heat * (1 - t) ** 1.4), p.age, p.seed + i);
  }
}

/** Sparks thrown off fast and slowing (and falling, by `gravity`), each a trail as long as its speed. */
function shards(out: EffectBuffers, p: EffectPiece, colour: Vec3, count: number, speed: number, gravity: number, heat: number, width = 0.007, bias = 0.7): void {
  const seconds = (p.age * p.frames) / 60;
  const blow = unitOf(p.velocity);
  const DRAG = 5;
  for (let i = 0; i < count; i += 1) {
    const d = direction(p.seed, 100 + i, blow, bias);
    const v0 = speed * SCALE * (0.4 + 0.9 * unit(p.seed, 140 + i));
    const travelled = (v0 * (1 - Math.exp(-DRAG * seconds))) / DRAG;
    const v = v0 * Math.exp(-DRAG * seconds);
    const drop = 0.5 * gravity * seconds * seconds;
    const at: Vec3 = [p.position[0] + d[0] * travelled, p.position[1] + d[1] * travelled - drop, p.position[2] + d[2] * travelled];
    const velocity: Vec3 = [d[0] * v, d[1] * v - gravity * seconds, d[2] * v];
    const tail: Vec3 = [at[0] - velocity[0] * STRETCH * 1.5, at[1] - velocity[1] * STRETCH * 1.5, at[2] - velocity[2] * STRETCH * 1.5];
    streak(out, tail, at, width * SCALE, scaled(colour, heat * (1 - p.age) ** 1.2 * twinkle(p, i, 3)), p.age, p.seed + 100 + i);
  }
}

/** A ring of short streaks running round a circle across the view, swelling out and thinning. */
function shock(out: EffectBuffers, p: EffectPiece, view: ViewBasis, colour: Vec3, count: number, reach: number, heat: number, width = 0.012, end = 1): void {
  const t = within(p.age, 0, end);
  if (t >= 1) return;
  const r = reach * SCALE * (0.2 + 0.8 * easeOut(Math.min(1, t * 2.5)));
  const turn = unit(p.seed, 99) * Math.PI * 2;
  const arc = ((Math.PI * 2) / count) * 0.75;
  for (let i = 0; i < count; i += 1) {
    const a = turn + (i / count) * Math.PI * 2;
    const radius = r * (1 + (unit(p.seed, 200 + i) - 0.5) * 0.2);
    streak(out, acrossView(view, p.position, a, radius), acrossView(view, p.position, a + arc, radius), (width * (1 - t) + 0.002) * SCALE, scaled(colour, heat * (1 - t) ** 1.6), p.age, p.seed + 200 + i);
  }
}

/**
 * A chain of streaks along nodes, narrowing and dimming toward its end by `taper`. A streak fades
 * out toward its tips, so each runs half a segment on past the nodes it shares with its neighbours,
 * and the chain stays lit through every node.
 */
function chain(out: EffectBuffers, nodes: readonly Vec3[], width: number, colour: Vec3, age: number, seed: number, taper = 0.6): void {
  const last = nodes.length - 1;
  for (let n = 1; n <= last; n += 1) {
    const s = n / last;
    const [a, b] = [nodes[n - 1]!, nodes[n]!];
    const half: Vec3 = [(b[0] - a[0]) / 2, (b[1] - a[1]) / 2, (b[2] - a[2]) / 2];
    const from = n > 1 ? along(a, half, -1) : a;
    const to = n < last ? along(b, half, 1) : b;
    streak(out, from, to, width * (1 - s * taper), scaled(colour, 1 - s * taper * 0.6), age, seed + n);
  }
}

/**
 * The Mishimas' lightning in the colours the console shows it in (its bolts measured on screen: a
 * deep blue, 20 80 225, round a pale periwinkle, 150 170 250; never white or cyan), linear.
 */
const ELECTRIC: Vec3 = [0.007, 0.08, 0.753];
const ELECTRIC_CORE: Vec3 = [0.305, 0.402, 0.956];
/** The lightning's bolts: the filament's colour and the glow's (blue past white, for the bloom, the other channels kept under it so the middle stays blue), the arcs' half-width in metres (the sheet's strokes, two or three texels with their fringe, over a 0.75 m sprite), the filament's gain, and the least half-width a metre away. */
export const LIGHTNING = { core: scaled(ELECTRIC_CORE, 0.75), edge: scaled(ELECTRIC, 1.8), width: 0.046, coreGain: 2.5, leastWidth: 0.0015 } as const;

/** The sheet's brightest texels' brightness, which a bolt's full brightness stands for. */
const SHEET_BRIGHTEST = 0.67;
/** How far (texels) a bolt's straightened path may stray from the traced texels: under a texel's diagonal half. */
const STRAIGHTEN = 0.75;

/** A frame's bolts as drawn: polylines in the sheet's texels, with the brightness at each point. */
export interface BoltPath {
  readonly points: number[];
  readonly brightness: number[];
}

/**
 * A frame's strokes as bolts to draw: at every point where strokes meet, the two that go on most
 * nearly straight through it are joined into one path (a fork's third branch stays a path of its
 * own), and each path is straightened where its texels only staircase (Douglas and Peucker's
 * simplification), so a bolt is drawn as a few long segments rather than one a texel. A segment of
 * the engine's bolts is a quad as wide as its glow with square ends; a texel's segment is shorter
 * than that glow is wide, and a run of them reads as a row of separate blocks.
 */
export function boltPaths(strokes: readonly LightningStroke[]): BoltPath[] {
  const paths: BoltPath[] = strokes.map((s) => ({ points: [...s.points], brightness: [...s.brightness] }));
  const count = (path: BoltPath): number => path.points.length / 2;
  const point = (path: BoltPath, n: number): [number, number] => [path.points[n * 2]!, path.points[n * 2 + 1]!];
  /** A path's end (0 its first point, 1 its last): where it is, and the way the path leaves it. */
  const endOf = (path: BoltPath, end: 0 | 1): { key: string; out: [number, number] } => {
    const [n, m] = end === 0 ? [0, 1] : [count(path) - 1, count(path) - 2];
    const [x, y] = point(path, n);
    const [nx, ny] = point(path, m);
    const length = Math.hypot(nx - x, ny - y) || 1;
    return { key: `${x},${y}`, out: [(nx - x) / length, (ny - y) / length] };
  };
  const reversed = (path: BoltPath): BoltPath => {
    const points: number[] = [];
    for (let n = count(path) - 1; n >= 0; n -= 1) points.push(...point(path, n));
    return { points, brightness: [...path.brightness].reverse() };
  };
  /* Two ends join where they leave the point at least this far apart (cosine): a bolt bends, it does not double back. */
  const STRAIGHT_ENOUGH = -0.3;
  for (;;) {
    const at = new Map<string, { path: number; end: 0 | 1; out: [number, number] }[]>();
    paths.forEach((path, i) => {
      for (const end of [0, 1] as const) {
        const e = endOf(path, end);
        at.set(e.key, [...(at.get(e.key) ?? []), { path: i, end, out: e.out }]);
      }
    });
    let best: { a: { path: number; end: 0 | 1 }; b: { path: number; end: 0 | 1 }; cosine: number } | null = null;
    for (const ends of at.values()) {
      for (let i = 0; i < ends.length; i += 1) {
        for (let j = i + 1; j < ends.length; j += 1) {
          const [a, b] = [ends[i]!, ends[j]!];
          if (a.path === b.path) continue;
          const cosine = a.out[0] * b.out[0] + a.out[1] * b.out[1];
          if (cosine <= STRAIGHT_ENOUGH && (best === null || cosine < best.cosine)) best = { a, b, cosine };
        }
      }
    }
    if (best === null) break;
    /* The first path made to end at the point, the second to start there, and the two joined. */
    const first = best.a.end === 1 ? paths[best.a.path]! : reversed(paths[best.a.path]!);
    const second = best.b.end === 0 ? paths[best.b.path]! : reversed(paths[best.b.path]!);
    paths[best.a.path] = { points: [...first.points, ...second.points.slice(2)], brightness: [...first.brightness, ...second.brightness.slice(1)] };
    paths.splice(best.b.path, 1);
  }
  return paths.map(straightened);
}

/** A path with only the points it needs to stay within `STRAIGHTEN` of every point it had. */
function straightened(path: BoltPath): BoltPath {
  const count = path.points.length / 2;
  const keep = new Uint8Array(count);
  keep[0] = 1;
  keep[count - 1] = 1;
  const x = (n: number): number => path.points[n * 2]!;
  const y = (n: number): number => path.points[n * 2 + 1]!;
  const spans: [number, number][] = [[0, count - 1]];
  while (spans.length > 0) {
    const [a, b] = spans.pop()!;
    const [dx, dy] = [x(b) - x(a), y(b) - y(a)];
    const length = Math.hypot(dx, dy);
    let far = -1;
    let most = STRAIGHTEN;
    for (let n = a + 1; n < b; n += 1) {
      const off = length === 0 ? Math.hypot(x(n) - x(a), y(n) - y(a)) : Math.abs((x(n) - x(a)) * dy - (y(n) - y(a)) * dx) / length;
      if (off > most) [far, most] = [n, off];
    }
    if (far < 0) continue;
    keep[far] = 1;
    spans.push([a, far], [far, b]);
  }
  const points: number[] = [];
  const brightness: number[] = [];
  for (let n = 0; n < count; n += 1) {
    if (keep[n] === 0) continue;
    points.push(x(n), y(n));
    brightness.push(path.brightness[n]!);
  }
  return { points, brightness };
}

/** Each frame's bolt paths, made once. */
const pathsOfFrame = new WeakMap<readonly LightningStroke[], BoltPath[]>();

/**
 * The Mishimas' lightning as the original's sheet draws it: each frame its own bolts, traced from
 * the sheet, laid over the sprite's square facing the view (mirrored as the game mirrors it) and as
 * large as the game makes it against the world, so a bolt runs the whole height of the square when
 * the sheet's does. Each traced stroke is an arc of the engine's bolts (a saturated glow round a
 * white-hot filament), as bright as the sheet is along it, all of them darkening over the sheet's
 * last frames as its shade does.
 */
function lightning(out: EffectBuffers, p: EffectPiece, view: ViewBasis): void {
  const sheet = p.sheet;
  if (sheet === undefined || sheet.shade <= 0) return;
  const right = unitOf(view.right);
  const up = unitOf(view.up);
  const across = sheet.mirrored ? -sheet.size : sheet.size;
  const place = (x: number, y: number): Vec3 => along(along(p.position, right, (x / 32 - 0.5) * across), up, (0.5 - y / 32) * sheet.size);
  const bolts = out.bolts;
  let paths = pathsOfFrame.get(sheet.strokes);
  if (paths === undefined) pathsOfFrame.set(sheet.strokes, (paths = boltPaths(sheet.strokes)));
  paths.forEach((stroke, k) => {
    const points = stroke.points.length / 2;
    const seed = ((p.seed + k * 977) % 997) / 997;
    const reach: number[] = [0];
    for (let n = 1; n < points; n += 1) reach.push(reach[n - 1]! + Math.hypot(stroke.points[n * 2]! - stroke.points[n * 2 - 2]!, stroke.points[n * 2 + 1]! - stroke.points[n * 2 - 1]!));
    const length = Math.max(1e-6, reach[points - 1]!);
    for (let n = 1; n < points && bolts.count < bolts.capacity; n += 1) {
      const i = bolts.count;
      bolts.from.set(place(stroke.points[n * 2 - 2]!, stroke.points[n * 2 - 1]!), i * 3);
      bolts.to.set(place(stroke.points[n * 2]!, stroke.points[n * 2 + 1]!), i * 3);
      bolts.along[i] = reach[n - 1]! / length;
      bolts.fade[i] = sheet.shade;
      bolts.seed[i] = seed;
      bolts.brightness[i] = 0.25 + Math.min(1, (stroke.brightness[n - 1]! + stroke.brightness[n]!) / 2 / SHEET_BRIGHTEST);
      bolts.count += 1;
    }
  });
}

/** A web of filaments over a sphere about the point, its strands jagged and struck again every few frames. */
function web(out: EffectBuffers, p: EffectPiece, colour: Vec3, strands: number, from: number, to: number, heat: number, every = 2): void {
  const t = p.age;
  const r = (from + (to - from) * easeOut(t)) * SCALE;
  const strike = Math.floor(frameOf(p) / every);
  const SEGMENTS = 8;
  for (let i = 0; i < strands; i += 1) {
    const seed = p.seed + strike * 53 + i * 29;
    const a = direction(seed, 1, [0, 0, 0], 0);
    const b = direction(seed, 2, a, 1.2);
    const nodes: Vec3[] = [];
    for (let n = 0; n <= SEGMENTS; n += 1) {
      const d = unitOf(mixed(a, b, n / SEGMENTS));
      nodes.push(along(p.position, d, r * (1 + (unit(seed, 10 + n) - 0.5) * 0.35)));
    }
    chain(out, nodes, 0.009 * SCALE, scaled(colour, heat * (1 - t) ** 1.3 * twinkle(p, i, every)), t, seed, 0.2);
  }
}

/** Crescents sweeping round the point across the view, turning as they grow. */
function swirl(out: EffectBuffers, p: EffectPiece, view: ViewBasis, colour: Vec3, arms: number, reach: number, heat: number, end: number): void {
  const t = within(p.age, 0, end);
  if (t >= 1) return;
  const turn = unit(p.seed, 3) * Math.PI * 2 + easeOut(t) * Math.PI * 1.4;
  for (let i = 0; i < arms; i += 1) {
    const a = turn + (i / arms) * Math.PI * 2;
    const r = reach * SCALE * (0.35 + 0.65 * easeOut(t));
    shape(out, Shape.CRESCENT, acrossView(view, p.position, a, r * 0.35), r, scaled(colour, heat * (1 - t) ** 1.2), a, p.age, p.seed + i);
  }
}

/** Orbs circling out from the point (`inward`: circling in to it), each a hot core in a soft glow. */
function orbs(out: EffectBuffers, p: EffectPiece, view: ViewBasis, colour: Vec3, count: number, reach: number, heat: number, start: number, end: number, inward = false): void {
  const t = within(p.age, start, end);
  if (p.age < start || t >= 1) return;
  const turn = unit(p.seed, 4) * Math.PI * 2 + t * Math.PI * 2.2 * (inward ? -1 : 1);
  const r = reach * SCALE * (inward ? 1 - easeOut(t) : easeOut(t));
  for (let i = 0; i < count; i += 1) {
    const at = acrossView(view, p.position, turn + (i / count) * Math.PI * 2, r);
    put(out.glows, at, [0, 0, 0], 0.03 * SCALE, scaled(mixed(WHITE, colour, 0.4), heat), 1, p.age, p.seed + i);
    shape(out, Shape.GLOW, at, 0.07 * SCALE, scaled(colour, heat * 0.5), 0, p.age, p.seed + i);
  }
}

/** Sparkles: points twinkling in a ball about the point (or on a ring across the view), spreading out. */
function sparkles(out: EffectBuffers, p: EffectPiece, colour: Vec3, count: number, reach: number, size: number, heat: number, start = 0, view: ViewBasis | null = null, end = 1): void {
  const t = within(p.age, start, end);
  if (p.age < start || t >= 1) return;
  for (let i = 0; i < count; i += 1) {
    const spread = reach * SCALE * (0.3 + 0.7 * unit(p.seed, 400 + i)) * (0.5 + 0.5 * easeOut(t));
    const at = view ? acrossView(view, p.position, unit(p.seed, 450 + i) * Math.PI * 2, reach * SCALE * (0.85 + 0.3 * unit(p.seed, 470 + i))) : along(p.position, direction(p.seed, 400 + i, [0, 0, 0], 0), spread);
    put(out.glows, at, [0, 0, 0], size * SCALE * (0.5 + unit(p.seed, 500 + i)), scaled(colour, heat * (1 - t) ** 1.2 * twinkle(p, i)), 1, p.age, p.seed + 400 + i);
  }
}

/** Soft energy: lumpy blobs from the sheet about the point, swelling and fading. */
function energy(out: EffectBuffers, p: EffectPiece, colour: Vec3, count: number, size: number, spread: number, heat: number, start: number, end: number): void {
  const t = within(p.age, start, end);
  if (p.age < start || t >= 1) return;
  for (let i = 0; i < count; i += 1) {
    const at = along(p.position, direction(p.seed, 600 + i, [0, 0, 0], 0), spread * SCALE * unit(p.seed, 620 + i) * (0.4 + easeOut(t)));
    shape(out, Shape.BLOB, at, size * SCALE * (0.6 + 0.4 * easeOut(t)) * (0.7 + 0.5 * unit(p.seed, 640 + i)), scaled(colour, heat * (1 - t) ** 1.4), unit(p.seed, 660 + i) * 6.28, p.age, p.seed + 600 + i);
  }
}

/**
 * A spray, the generic hit and guards: a soft lump swelling at the point, sheared off along the
 * blow into a fan of fine droplets that drift on and thin out; translucent, added.
 */
function spray(out: EffectBuffers, p: EffectPiece, view: ViewBasis, colour: Vec3, heat: number): void {
  const t = p.age;
  const angle = blowAngle(view, p);
  const early = within(t, 0, 0.45);
  if (early < 1) shape(out, Shape.BLOB, p.position, (0.07 + 0.08 * easeOut(early)) * SCALE, scaled(colour, heat * (1 - early) ** 1.3), angle, t, p.seed);
  const fan = within(t, 0.08, 1);
  const forward = acrossView(view, [0, 0, 0], angle, 1);
  if (t > 0.08 && fan < 1) shape(out, Shape.FAN, along(p.position, forward, (0.05 + 0.06 * easeOut(fan)) * SCALE), (0.13 + 0.07 * easeOut(fan)) * SCALE, scaled(colour, heat * 0.9 * (1 - fan) ** 1.1), angle, t, p.seed + 1);
  const seconds = (t * p.frames) / 60;
  const blow = unitOf(p.velocity);
  for (let i = 0; i < 36; i += 1) {
    const d = direction(p.seed, 700 + i, blow, 1.6);
    const v0 = (1.2 + 2.2 * unit(p.seed, 740 + i)) * SCALE;
    const travelled = (v0 * (1 - Math.exp(-4 * seconds))) / 4;
    put(out.glows, along(p.position, d, travelled), [0, 0, 0], (0.004 + 0.006 * unit(p.seed, 780 + i)) * SCALE, scaled(colour, heat * 0.8 * (1 - t) ** 1.2), 1, t, p.seed + 700 + i);
  }
}

/** A light cast on the world from the effect's point, in its colour, fading with it. */
function light(out: EffectBuffers, p: EffectPiece, colour: Vec3, strength: number, radius: number, length = 1): void {
  const lights = out.lights;
  const t = within(p.age, 0, length);
  if (t >= 1 || lights.count >= lights.capacity) return;
  const i = lights.count;
  lights.positions.set(p.position, i * 3);
  lights.colors.set(scaled(colour, strength * (1 - t) ** 2), i * 3);
  lights.radii[i] = radius;
  lights.count += 1;
}

/* ---- The heavy sparks, one recipe per fighter's sheet. ---- */

const GOLD: Vec3 = [1, 0.8, 0.2];
const FIRE: Vec3 = [1, 0.12, 0.02];
const EMBER: Vec3 = [1, 0.35, 0.05];

function heavy(out: EffectBuffers, p: EffectPiece, view: ViewBasis): void {
  const c = p.colour;
  const t = p.age;
  switch (p.design) {
    case 'fire ring': {
      /* Paul: a ring of fire bursting out, red at its body and yellow at its edges, flame tongues off it, embers falling. */
      const fire = mixed(c, FIRE, 0.45);
      flash(out, p, mixed(c, GOLD, 0.5), 0.09, 5, 0.3);
      bloomShape(out, p, Shape.GLOW, fire, 0.13, 0.22, 1.4, 0, 0.5);
      bloomShape(out, p, Shape.RING, fire, 0.07, 0.25, 3.5, 0, 0.8);
      bloomShape(out, p, Shape.RING, mixed(c, GOLD, 0.6), 0.06, 0.22, 2, 0, 0.6);
      const r = (0.05 + 0.17 * easeOut(Math.min(1, t * 1.6))) * SCALE;
      for (let i = 0; i < 14; i += 1) {
        const a = unit(p.seed, 800 + i) * Math.PI * 2;
        shape(out, Shape.FLAME, acrossView(view, p.position, a, r), (0.08 * (1 - t) + 0.02) * SCALE, scaled(mixed(fire, GOLD, unit(p.seed, 850 + i) * 0.5), 2.6 * (1 - t) ** 1.3 * twinkle(p, i, 2)), a, t, p.seed + 800 + i);
      }
      shards(out, p, mixed(c, EMBER, 0.5), 22, 4.5, 4, 2.6);
      light(out, p, c, 2.2, 1.5);
      return;
    }
    case 'swirl':
      /* Law: crescents sweeping round the point, then breaking into embers. */
      flash(out, p, c, 0.07, 4, 0.25);
      swirl(out, p, view, mixed(c, GOLD, 0.3), 3, 0.2, 3.2, 0.65);
      shock(out, p, view, c, 20, 0.18, 2, 0.01, 0.5);
      sparkles(out, p, mixed(c, EMBER, 0.5), 40, 0.22, 0.007, 2.6, 0.45);
      light(out, p, c, 2.4, 1.5);
      return;
    case 'bloom':
      /* Lei: a large violet bloom, white-hot at its heart, its edges fizzing, breaking into wisps. */
      flash(out, p, mixed(WHITE, c, 0.25), 0.16, 6, 0.45);
      bloomShape(out, p, Shape.GLOW, mixed(c, WHITE, 0.3), 0.18, 0.28, 2.2, 0, 0.6);
      energy(out, p, c, 8, 0.16, 0.07, 2.4, 0, 0.75);
      energy(out, p, mixed(c, WHITE, 0.6), 4, 0.1, 0.03, 2.6, 0, 0.45);
      sparkles(out, p, mixed(c, WHITE, 0.35), 70, 0.2, 0.006, 3);
      energy(out, p, c, 5, 0.07, 0.18, 1.4, 0.6, 1);
      light(out, p, c, 2.2, 1.5);
      return;
    case 'gold sphere':
      /* King: a starburst, then a sphere of golden filaments, which loosens into a tangle. */
      flash(out, p, GOLD, 0.09, 5, 0.25);
      bloomShape(out, p, Shape.STAR_EIGHT, mixed(c, WHITE, 0.4), 0.08, 0.2, 3, 0, 0.25, unit(p.seed, 1));
      rays(out, p, c, 10, 0.26, 0.01, 3, 0.4, 0.3);
      if (t > 0.12) web(out, p, mixed(c, GOLD, 0.4), 14, 0.1, 0.2, 3.2, 3);
      energy(out, p, c, 3, 0.12, 0.03, 1, 0.1, 0.6);
      light(out, p, c, 2.4, 1.65);
      return;
    case 'needles':
      /* Yoshimitsu: needles of light, then a green burst flecked with red. */
      rays(out, p, mixed(c, WHITE, 0.6), 10, 0.38, 0.005, 4, 0.2, 0.3);
      flash(out, p, mixed(c, WHITE, 0.5), 0.07, 4, 0.35);
      energy(out, p, c, 5, 0.1, 0.05, 2.2, 0.15, 0.85);
      sparkles(out, p, mixed(c, WHITE, 0.3), 36, 0.16, 0.006, 2.8, 0.2);
      sparkles(out, p, [1, 0.08, 0.04], 12, 0.14, 0.006, 2.4, 0.3);
      light(out, p, c, 2.4, 1.5);
      return;
    case 'web':
      /* Nina, Anna: a web of orange lightning wrapping a sphere, crackling. */
      flash(out, p, mixed(c, WHITE, 0.3), 0.08, 5, 0.3);
      web(out, p, c, 12, 0.07, 0.19, 3.6, 2);
      rays(out, p, mixed(c, WHITE, 0.4), 6, 0.2, 0.006, 3, 0.5, 0.4);
      shards(out, p, c, 10, 4, 0, 2.4);
      light(out, p, c, 2.4, 1.65);
      return;
    case 'cyan sphere':
      /* Hwoarang: a sphere of cyan light with a ring flashing off it, falling into glittering dust. */
      flash(out, p, mixed(WHITE, c, 0.4), 0.1, 5, 0.35);
      energy(out, p, c, 4, 0.14, 0.03, 2.4, 0, 0.45);
      bloomShape(out, p, Shape.RING, c, 0.08, 0.22, 3, 0.05, 0.4);
      sparkles(out, p, mixed(c, WHITE, 0.25), 70, 0.2, 0.006, 3, 0.3);
      light(out, p, c, 2.4, 1.8);
      return;
    case 'orbit':
      /* Xiaoyu: orbs circling out from the point into a ring of golden sparkles. */
      flash(out, p, mixed(c, WHITE, 0.4), 0.07, 4, 0.25);
      orbs(out, p, view, c, 5, 0.15, 3.2, 0, 0.45);
      sparkles(out, p, mixed(c, GOLD, 0.4), 60, 0.15, 0.007, 3, 0.35, view);
      light(out, p, c, 2.4, 1.5);
      return;
    case 'sparkles':
      /* Eddy, Ogre: a cloud of magenta sparkles, white at first, deepening to purple. */
      flash(out, p, mixed(WHITE, c, 0.3), 0.08, 5, 0.35);
      energy(out, p, c, 4, 0.1, 0.05, 1.6, 0, 0.7);
      sparkles(out, p, mixed(mixed(WHITE, c, 0.4), [0.5, 0, 1], t), 80, 0.21, 0.006, 3.2);
      light(out, p, c, 2.4, 1.65);
      return;
    case 'lightning':
      /* The Mishimas: the original's sheet of serpentine bolts, frame by frame at its own size, and its blue light on what is near. */
      lightning(out, p, view);
      light(out, p, ELECTRIC, 3.2 * (p.sheet?.shade ?? 1), 1.95, 0.8);
      return;
    case 'fireworks':
      /* Julia: a burst of embers on long trails, falling and twinkling out. */
      flash(out, p, mixed(c, WHITE, 0.4), 0.09, 5, 0.3);
      bloomShape(out, p, Shape.GLOW, c, 0.08, 0.16, 1.6, 0, 0.4);
      shards(out, p, c, 44, 6, 3.5, 3, 0.008, 0.3);
      shards(out, p, mixed(c, EMBER, 0.6), 20, 3, 6, 2.4, 0.006, 0.3);
      light(out, p, c, 2.4, 1.65);
      return;
    case 'star':
      /* Kuma: a twinkling star, its long arms across the view, orange rays behind it. */
      bloomShape(out, p, Shape.STAR_FOUR, mixed(c, WHITE, 0.3), 0.12, 0.2, 4 * twinkle(p, 1, 2), 0, 0.9);
      bloomShape(out, p, Shape.STAR_FOUR, mixed(c, WHITE, 0.3), 0.08, 0.13, 3, 0, 0.9, Math.PI / 4);
      rays(out, p, EMBER, 10, 0.24, 0.007, 3, 0, 0.8);
      flash(out, p, WHITE, 0.07, 5, 0.4);
      light(out, p, c, 2.4, 1.5);
      return;
    case 'toxic':
      /* Bryan: a green toxic burst dissolving into specks of green and white. */
      flash(out, p, mixed(c, WHITE, 0.4), 0.07, 4, 0.25);
      energy(out, p, c, 6, 0.11, 0.06, 2, 0, 0.6);
      sparkles(out, p, mixed(c, WHITE, 0.3), 60, 0.2, 0.006, 2.8, 0.35);
      light(out, p, c, 2.4, 1.5);
      return;
    case 'orbs': {
      /* Gun Jack: orbs closing in, a white-gold explosion, orange cinders. */
      orbs(out, p, view, mixed(c, GOLD, 0.3), 4, 0.13, 3, 0, 0.4, true);
      if (t > 0.35) {
        const late: EffectPiece = { ...p, age: within(t, 0.35, 1) };
        flash(out, late, mixed(WHITE, c, 0.3), 0.12, 6, 0.4);
        bloomShape(out, late, Shape.RING, GOLD, 0.06, 0.22, 3, 0, 0.5);
        energy(out, late, mixed(c, GOLD, 0.5), 5, 0.12, 0.05, 2, 0, 0.8);
        sparkles(out, late, EMBER, 40, 0.2, 0.007, 2.6, 0.3);
      }
      light(out, p, c, 2.4, 1.65);
      return;
    }
  }
}

/* ---- The pool's bursts. ---- */

/** A burst spark cooling over its life, as the original's ramp runs: white, yellow, orange, red; a charged one white, cyan, deep blue. */
const BURST_RAMP: readonly Vec3[] = [
  [1, 0.95, 0.6],
  [1, 0.85, 0.15],
  [1, 0.55, 0.03],
  [1, 0.2, 0.01],
  [0.9, 0.02, 0],
  [0.5, 0, 0],
];
const CHARGED_RAMP: readonly Vec3[] = [
  [0.7, 0.95, 1],
  [0.3, 0.85, 1],
  [0, 0.7, 1],
  [0, 0.5, 0.9],
  [0.02, 0.3, 0.7],
  [0.02, 0.12, 0.4],
];

function rampAt(ramp: readonly Vec3[], t: number): Vec3 {
  const x = Math.min(0.999, Math.max(0, t)) * (ramp.length - 1);
  const i = Math.floor(x);
  return mixed(ramp[i]!, ramp[i + 1]!, x - i);
}

/* ---- The charged glow. ---- */

/** The glow's hard core and its halo, blue-white as the charged palette. */
const GLOW_CORE: Vec3 = [0.75, 0.92, 1];
const GLOW_HALO: Vec3 = [0.15, 0.5, 1];

/**
 * A hand or foot alight: a hard core shimmering as the original's palette steps every other frame,
 * a soft halo around it, and a little light on what is near.
 */
function glow(out: EffectBuffers, p: EffectPiece): void {
  const step = Math.floor(frameOf(p) / 2);
  const shimmer = 0.7 + 0.3 * unit(p.seed, step);
  put(out.glows, p.position, [0, 0, 0], 0.028 * SCALE * shimmer, scaled(GLOW_CORE, 2.8 * shimmer), 1, p.age, p.seed);
  put(out.glows, p.position, [0, 0, 0], 0.07 * SCALE * (0.9 + 0.1 * shimmer), scaled(GLOW_HALO, 0.8 * shimmer), 1, p.age, p.seed + 1);
  const lights = out.lights;
  if (lights.count >= lights.capacity) return;
  const i = lights.count;
  lights.positions.set(p.position, i * 3);
  lights.colors.set(scaled(GLOW_HALO, 1.2 * shimmer), i * 3);
  lights.radii[i] = 0.8;
  lights.count += 1;
}

/* ---- The fire. ---- */

/** Fire cooling through its life: yellow-white, orange, red, a deep ember red. */
const FIRE_RAMP: readonly Vec3[] = [
  [1, 0.9, 0.55],
  [1, 0.68, 0.18],
  [1, 0.4, 0.05],
  [0.92, 0.16, 0.01],
  [0.55, 0.04, 0],
];
const FLAME_CORE: Vec3 = [1, 0.88, 0.5];
const SMOKE: Vec3 = [0.13, 0.11, 0.1];
const UP = Math.PI / 2;

/** Tongues of flame licking up about a point, flickering every other frame, `size` their half-height. */
function tongues(out: EffectBuffers, p: EffectPiece, view: ViewBasis, colour: Vec3, count: number, spread: number, size: number, heat: number): void {
  for (let i = 0; i < count; i += 1) {
    const at = acrossView(view, p.position, unit(p.seed, 900 + i) * Math.PI * 2, spread * SCALE * unit(p.seed, 920 + i));
    const lean = (unit(p.seed, 940 + i) - 0.5) * 0.9;
    shape(out, Shape.FLAME, along(at, [0, 1, 0], size * SCALE * 0.4), size * SCALE * (0.7 + 0.5 * unit(p.seed, 960 + i)), scaled(mixed(colour, FLAME_CORE, 0.35 * unit(p.seed, 980 + i)), heat * twinkle(p, i, 2)), UP + lean, p.age, p.seed + 900 + i);
  }
}

/** Smoke rising off a fire as it dies, from `from` of its life on. */
function smoke(out: EffectBuffers, p: EffectPiece, size: number, from: number): void {
  const t = within(p.age, from, 1);
  if (p.age < from) return;
  const i = put(out.puffs, along(p.position, [0, 1, 0], size * (0.4 + 0.8 * t)), [0, 0, 0], size * (0.6 + 0.6 * t), SMOKE, 0.45 * Math.sin(Math.PI * t), t, p.seed + 7);
  if (i < 0) return;
  out.puffs.spins[i] = unit(p.seed, 7) * Math.PI * 2 + t;
  out.puffs.frames[i] = Shape.BLOB;
}

/**
 * A breath's fireball: a hot white-yellow heart flying out, swelling into a ball of flame tongues
 * licking up, reddening as it burns down, smoke as it dies; it lights what is near. Gon's is the
 * same, smaller.
 */
function fireball(out: EffectBuffers, p: EffectPiece, view: ViewBasis, size: number): void {
  const t = p.age;
  const colour = rampAt(FIRE_RAMP, t);
  const heat = 2.4 * (1 - t) ** 0.7 + 0.3;
  const swell = 0.55 + 0.45 * easeOut(within(t, 0, 0.35));
  put(out.glows, p.position, [0, 0, 0], size * 0.5 * SCALE * swell, scaled(colour, heat * 0.55), 1, t, p.seed);
  if (t < 0.55) put(out.glows, p.position, [0, 0, 0], size * 0.2 * SCALE, scaled(FLAME_CORE, 3 * (1 - t / 0.55)), 1, t, p.seed + 1);
  tongues(out, p, view, colour, 7, size * 0.35 * swell, size * 0.45 * swell, heat);
  smoke(out, p, size * 0.8, 0.6);
  light(out, p, colour, 1.8, 1.6);
}

/** A flame standing on its point (on the floor, on a burning fighter), flickering, rising away at the end of its life (`rising` on). */
function flame(out: EffectBuffers, p: EffectPiece, view: ViewBasis, size: number, rising: number, glow: number): void {
  const t = p.age;
  const fade = t < rising ? 1 : 1 - within(t, rising, 1);
  const colour = rampAt(FIRE_RAMP, 0.15 + 0.5 * within(t, rising, 1));
  const heat = 2.2 * fade;
  put(out.glows, p.position, [0, 0, 0], size * 0.45 * SCALE, scaled(colour, heat * 0.4 * twinkle(p, 50, 2)), 1, t, p.seed);
  tongues(out, p, view, colour, 4, size * 0.2, size * 0.5, heat);
  if (glow > 0) light(out, { ...p, age: 0 }, colour, glow * fade, 1.2);
}

/** Dust's grey. */
const DUST: Vec3 = [0.6, 0.58, 0.55];

/** A soft puff, two lumpy blobs turned apart, rising a little, swelling from `from` to `to` and thinning out. */
function puff(out: EffectBuffers, p: EffectPiece, colour: Vec3, from: number, to: number, opacity: number): void {
  const t = p.age;
  for (let k = 0; k < 2; k += 1) {
    const i = put(out.puffs, along(p.position, [0, 1, 0], (0.04 + 0.08 * t) * (1 + k * 0.4)), [0, 0, 0], (from + (to - from) * easeOut(t)) * (1 - k * 0.25), colour, opacity * (1 - t) ** 1.2, t, p.seed + k);
    if (i < 0) return;
    out.puffs.spins[i] = unit(p.seed, 30 + k) * Math.PI * 2 + t * (k === 0 ? 0.6 : -0.8);
    out.puffs.frames[i] = Shape.BLOB;
  }
}

/** The generic sprays' colours: a hit's red, the guards' pink and blue-grey. */
const HIT: Vec3 = [1, 0.06, 0.04];
const GUARD: Vec3 = [1, 0.3, 0.95];
const GUARD_TWO: Vec3 = [0.45, 0.62, 0.95];

/** Every piece's particles, shapes and lights into `out`, emptied first; `view` the camera's right and up. */
export function fillEffects(pieces: readonly EffectPiece[], view: ViewBasis, out: EffectBuffers): void {
  for (const set of [out.streaks, out.glows, out.shapes, out.puffs]) set.count = 0;
  out.bolts.count = 0;
  out.lights.count = 0;
  for (const p of pieces) {
    const t = p.age;
    switch (p.look) {
      case 'heavy':
        heavy(out, p, view);
        break;
      case 'hit':
        spray(out, p, view, HIT, 1.6);
        light(out, p, HIT, 1.5, 1.2, 0.5);
        break;
      case 'guard':
      case 'guard2': {
        const colour = p.look === 'guard' ? GUARD : GUARD_TWO;
        spray(out, p, view, colour, 1.5);
        light(out, p, colour, 1.5, 1.2, 0.5);
        break;
      }
      case 'dust':
        puff(out, p, DUST, 0.12, 0.3, 0.55);
        break;
      case 'burst':
      case 'charged': {
        /* A round glowing spark, as the original's burst dot, with a short trail behind it. */
        const ramp = p.look === 'burst' ? BURST_RAMP : CHARGED_RAMP;
        const colour = rampAt(ramp, t);
        put(out.glows, p.position, [0, 0, 0], 0.016 * SCALE * (1 - t * 0.4), scaled(colour, 2.4 * (1 - t) ** 0.7 + 0.3), 1, t, p.seed);
        streak(out, along(p.position, p.velocity, -STRETCH * 0.6), p.position, 0.008 * SCALE, scaled(colour, 1.2 * (1 - t) ** 0.8), t, p.seed);
        break;
      }
      case 'breath':
        puff(out, p, p.colour, 0.06, 0.2, 0.6);
        break;
      case 'glow':
        glow(out, p);
        break;
      case 'fireball':
        fireball(out, p, view, 0.42);
        break;
      case 'gon fireball':
        fireball(out, p, view, 0.3);
        break;
      case 'ember': {
        /* A spark of fire thrown off, glowing as it falls, cooling to red. */
        const colour = rampAt(FIRE_RAMP, 0.2 + 0.8 * t);
        put(out.glows, p.position, [0, 0, 0], 0.012 * SCALE * (1 - t * 0.5), scaled(colour, 2.2 * (1 - t) ** 0.8 + 0.2), 1, t, p.seed);
        streak(out, along(p.position, p.velocity, -STRETCH * 0.6), p.position, 0.006 * SCALE, scaled(colour, 1.2 * (1 - t)), t, p.seed);
        break;
      }
      case 'floor flame':
        flame(out, p, view, 0.24, 0.8, 0.6);
        break;
      case 'burning':
        flame(out, p, view, 0.26, 0.8, 0.8);
        break;
      case 'flame column':
        /* A column of Gon's flames: tall tongues roaring up, cooling as they rise. */
        flame(out, p, view, 0.3, 0.6, 1);
        break;
      case 'trail': {
        /* A mote left behind, rising and cooling through the charged ramp, a short tail under it. */
        const colour = rampAt(CHARGED_RAMP, t);
        put(out.glows, p.position, [0, 0, 0], 0.026 * SCALE * (1 - t * 0.5), scaled(colour, 1.8 * (1 - t) ** 0.8 + 0.2), 1, t, p.seed);
        streak(out, along(p.position, p.velocity, -STRETCH * 0.8), p.position, 0.01 * SCALE, scaled(colour, (1 - t) ** 0.8), t, p.seed);
        break;
      }
      case 'sparkle': {
        /* A four-pointed star twinkling as it rises and cools, a point of light at its heart. */
        const colour = rampAt(CHARGED_RAMP, t);
        const bright = twinkle(p, 0, 2);
        shape(out, Shape.STAR_FOUR, p.position, (0.01 + 0.014 * bright) * SCALE * (1 - t * 0.4), scaled(colour, 1.8 * bright * (1 - t) ** 0.9), unit(p.seed, 1) * Math.PI * 0.5, t, p.seed);
        put(out.glows, p.position, [0, 0, 0], 0.006 * SCALE, scaled(GLOW_CORE, 1.5 * (1 - t)), 1, t, p.seed + 1);
        break;
      }
    }
  }
}
