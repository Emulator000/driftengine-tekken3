/**
 * A stage's background built rather than painted: the sky's dome round the camera (its
 * atmosphere and clouds made by the importer), the sea below the arena out to the horizon, and
 * mountains kilometres off whose ridge follows the stage's own panorama, lit by the sun and hazed
 * by the air between.
 */
import { createMover, type Camera, type MeshHandle, type RendererApi, type SurfaceMaterial, type SurfaceTextureHandle } from '@driftengine/core';
import type { Wind } from './grass.ts';
import type { ArcadePanorama } from '../../../assets/manifest.ts';
import type { StageLook } from './looks.ts';

/** The elevations the sky picture spans (degrees), its bottom row's and its top row's; and the dome it is drawn on (metres). */
const E0 = -12;
const E1 = 90;
const DOME = 8000;
/** How far off the clouds drift past (metres), and how many times faster than the grass's wind they go. */
const CLOUDS = 5000;
const ALOFT = 6;
/** The sea's height under the arena's floor, and how far it reaches (metres). */
const SEA = -40;
const SEA_REACH = 7600;
/** The mountains' ring (metres), and where their ridge stands. */
const RING = [1800, 5600] as const;
const RIDGE = 3400;
/** The panorama's turn a picture's width covers, which it repeats round the whole turn. */
const SECTOR = 72;
/** The eye's height the ridge is seen from (metres). */
const EYE = 1.5;

/** The stage's ridge in its panorama: per column of the picture, the row its land's top reaches, and the row at the horizon. */
export interface Ridge {
  readonly tops: readonly number[];
  readonly horizon: number;
}

/** The stage's panorama, which its mountains are painted from: its picture and how the board lays it. */
export interface Painted {
  readonly picture: ImageBitmap;
  readonly layout: ArcadePanorama;
}

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

/** Smooth value noise on a seeded lattice, 0 to 1. */
function lattice(seed: number): (x: number, y: number) => number {
  const next = random(seed);
  const table = Float32Array.from({ length: 256 * 256 }, () => next());
  const at = (i: number, j: number): number => table[(i & 255) * 256 + (j & 255)]!;
  return (x, y) => {
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    return at(i, j) * (1 - u) * (1 - v) + at(i + 1, j) * u * (1 - v) + at(i, j + 1) * (1 - u) * v + at(i + 1, j + 1) * u * v;
  };
}

type MeshData = Parameters<RendererApi['createMesh']>[0];

/** The dome: a sphere round the eye, each point's coordinates its turn and elevation in the sky's picture. */
function dome(radius = DOME): MeshData {
  /* Fine enough that the picture, laid straight across each flat triangle, keeps a round shape round. */
  const columns = 256;
  const rows = 128;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let r = 0; r <= rows; r += 1) {
    const e = Math.PI / 2 - (r / rows) * Math.PI;
    const v = Math.min(1, Math.max(0, (E1 - (e * 180) / Math.PI) / (E1 - E0)));
    for (let c = 0; c <= columns; c += 1) {
      const phi = (c / columns) * 2 * Math.PI;
      positions.push(Math.cos(e) * Math.sin(phi) * radius, Math.sin(e) * radius, Math.cos(e) * Math.cos(phi) * radius);
      uvs.push(c / columns, v);
    }
  }
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < columns; c += 1) {
      const a = r * (columns + 1) + c;
      indices.push(a, a + columns + 1, a + 1, a + 1, a + columns + 1, a + columns + 2);
    }
  }
  const n = positions.length / 3;
  return { positions: new Float32Array(positions), normals: new Float32Array(n * 3).fill(0), colors: new Float32Array(n * 3).fill(1), emissive: new Float32Array(n), uvs: new Float32Array(uvs), indices: new Uint32Array(indices) };
}

/** A ring of the ground round the eye: `height(x, z, r, phi)` and `colour(...)` at each of its points. */
function ring(
  inner: number,
  outer: number,
  rings: number,
  segments: number,
  height: (x: number, z: number, r: number, phi: number) => number,
  colour: (h: number, slope: number, r: number, x: number, z: number, normal: readonly [number, number, number]) => [number, number, number],
  specular: number,
  roughness: number,
  uv: ((x: number, y: number, z: number) => [number, number]) | null = null,
): MeshData {
  const positions = new Float32Array((rings + 1) * (segments + 1) * 3);
  const radius = (k: number): number => inner * Math.pow(outer / inner, k / rings);
  for (let k = 0; k <= rings; k += 1) {
    const r = radius(k);
    for (let s = 0; s <= segments; s += 1) {
      const phi = (s / segments) * 2 * Math.PI;
      const x = Math.sin(phi) * r;
      const z = Math.cos(phi) * r;
      positions.set([x, height(x, z, r, phi), z], (k * (segments + 1) + s) * 3);
    }
  }
  const n = positions.length / 3;
  const normals = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const at = (k: number, s: number): number => (Math.min(rings, Math.max(0, k)) * (segments + 1) + ((s + segments) % segments)) * 3;
  for (let k = 0; k <= rings; k += 1) {
    for (let s = 0; s <= segments; s += 1) {
      const i = at(k, s);
      const a = at(k + 1, s);
      const b = at(k - 1, s);
      const c = at(k, s + 1);
      const d = at(k, s - 1);
      const u = [positions[a]! - positions[b]!, positions[a + 1]! - positions[b + 1]!, positions[a + 2]! - positions[b + 2]!];
      const v = [positions[c]! - positions[d]!, positions[c + 1]! - positions[d + 1]!, positions[c + 2]! - positions[d + 2]!];
      let nx = u[1]! * v[2]! - u[2]! * v[1]!;
      let ny = u[2]! * v[0]! - u[0]! * v[2]!;
      let nz = u[0]! * v[1]! - u[1]! * v[0]!;
      if (ny < 0) [nx, ny, nz] = [-nx, -ny, -nz];
      const l = Math.hypot(nx, ny, nz) || 1;
      const o = (k * (segments + 1) + s) * 3;
      normals.set([nx / l, ny / l, nz / l], o);
      colors.set(colour(positions[i + 1]!, 1 - ny / l, radius(k), positions[i]!, positions[i + 2]!, [nx / l, ny / l, nz / l]), o);
    }
  }
  const indices: number[] = [];
  for (let k = 0; k < rings; k += 1) {
    for (let s = 0; s < segments; s += 1) {
      const a = k * (segments + 1) + s;
      indices.push(a, a + 1, a + segments + 1, a + 1, a + segments + 2, a + segments + 1);
    }
  }
  return {
    positions,
    normals,
    colors,
    emissive: new Float32Array(n),
    specular: new Float32Array(n).fill(specular),
    roughness: new Float32Array(n).fill(roughness),
    uvs: uv === null ? new Float32Array(n * 2) : Float32Array.from({ length: n * 2 }, (_, j) => uv(positions[(j >> 1) * 3]!, positions[(j >> 1) * 3 + 1]!, positions[(j >> 1) * 3 + 2]!)[j & 1]!),
    indices: new Uint32Array(indices),
  };
}

/**
 * The sun, a glow with no rim: a small core as bright as `core` times its light at its middle,
 * falling as a bell (`width` radians to fall by e), over a faint glow `glow` times it falling by e
 * every `fade` radians, in `rings` rings from its middle out to where nothing is left. The picture's
 * bloom spreads the core into its halo; a brighter glow of its own would pass white round it with
 * the sky and show as a disc.
 */
const SUN = { core: 16, width: 0.007, glow: 2.5, fade: 0.012, reach: 0.08, rings: 40 } as const;
/** How wide each ring of the sun is (radians), and how bright against its light. */
const SUN_RINGS: readonly (readonly [number, number])[] = Array.from({ length: SUN.rings + 1 }, (_, k): [number, number] => {
  const angle = SUN.reach * (k / SUN.rings) ** 1.6;
  const bright = SUN.core * Math.exp(-((angle / SUN.width) ** 2)) + SUN.glow * Math.exp(-angle / SUN.fade);
  return [angle, k === SUN.rings ? 0 : bright];
});

/** The sun toward `toward`, a disc and its glow in rings round it, just inside the sky's dome, coloured by its light. */
function sunDisc(toward: readonly number[], colour: readonly number[]): MeshData {
  const l = Math.hypot(toward[0]!, toward[1]!, toward[2]!) || 1;
  const d = [toward[0]! / l, toward[1]! / l, toward[2]! / l];
  const side = Math.abs(d[1]!) < 0.95 ? [0, 1, 0] : [1, 0, 0];
  const cross = (a: readonly number[], b: readonly number[]): number[] => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
  const norm = (a: number[]): number[] => a.map((v) => v / (Math.hypot(...a) || 1));
  const u = norm(cross(d, side));
  const v = cross(d, u);
  const peak = Math.max(...colour);
  const tint = colour.map((c) => c / peak);
  /* So many points round each ring that the disc stays round however close the view (a free camera's). */
  const around = 256;
  /* In front of the clouds' dome (0.97), drawn after it. */
  const reach = DOME * 0.96;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  SUN_RINGS.forEach(([angle, bright], ring) => {
    const count = ring === 0 ? 1 : around;
    for (let k = 0; k < count; k += 1) {
      const a = (k / around) * 2 * Math.PI;
      const [c, s] = [Math.cos(a) * Math.tan(angle), Math.sin(a) * Math.tan(angle)];
      positions.push(...[0, 1, 2].map((i) => (d[i]! + u[i]! * c + v[i]! * s) * reach));
      colors.push(...tint.map((t) => t * bright));
    }
  });
  for (let k = 0; k < around; k += 1) indices.push(0, 1 + k, 1 + ((k + 1) % around));
  for (let ring = 1; ring + 1 < SUN_RINGS.length; ring += 1) {
    const a = 1 + (ring - 1) * around;
    const b = a + around;
    for (let k = 0; k < around; k += 1) {
      const k1 = (k + 1) % around;
      indices.push(a + k, b + k, b + k1, a + k, b + k1, a + k1);
    }
  }
  const n = positions.length / 3;
  return { positions: new Float32Array(positions), normals: new Float32Array(n * 3), colors: new Float32Array(colors), emissive: new Float32Array(n), uvs: new Float32Array(n * 2), indices: new Uint32Array(indices) };
}

export class Backdrop {
  private readonly dome: MeshHandle;
  private readonly cloudDome: MeshHandle | null;
  private readonly cloudMaterial: SurfaceMaterial<SurfaceTextureHandle> | null;
  private readonly turned = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  /** The sea and the mountains follow the eye: which objects they are, frame to frame. */
  private readonly seaMover = createMover();
  private readonly mountainMover = createMover();
  private readonly sea: MeshHandle;
  private readonly mountains: MeshHandle | null;
  private readonly domeMaterial: SurfaceMaterial<SurfaceTextureHandle>;
  private readonly plain: SurfaceMaterial<SurfaceTextureHandle>;
  private readonly mountainMaterial: SurfaceMaterial<SurfaceTextureHandle>;
  private readonly model = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  private readonly still = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  /** The haze's colour where the sky meets the land (linear), from the sky's picture. */
  readonly haze: [number, number, number];
  /** The sun's disc and its glow, far brighter than white, drawn over the sky and under its clouds. */
  private readonly sun: MeshHandle;

  constructor(
    private readonly renderer: RendererApi,
    sky: ImageBitmap,
    clouds: ImageBitmap | null,
    ridge: Ridge | null,
    painted: Painted | null,
    white: SurfaceTextureHandle,
    seed: number,
    look: StageLook,
  ) {
    const clad = look.mountains;
    const texture = renderer.createSurfaceTexture(sky, { colorSpace: 'srgb', filter: 'linear', mipmap: true, wrap: 'clamp' });
    this.domeMaterial = { albedo: texture, doubleSided: true };
    this.plain = { albedo: white, doubleSided: true };
    this.dome = renderer.createMesh(dome());
    this.cloudDome = clouds === null ? null : renderer.createMesh(dome(DOME * 0.97));
    this.cloudMaterial = clouds === null ? null : { albedo: renderer.createSurfaceTexture(clouds, { colorSpace: 'srgb', filter: 'linear', mipmap: true, wrap: 'clamp' }), doubleSided: true };
    this.haze = hazeOf(sky);
    this.sun = renderer.createMesh(sunDisc(look.sun, look.sunColour));
    const noise = lattice(seed);
    const detail = lattice(seed + 1);
    const deep: [number, number, number] = [0.012, 0.045, 0.07];
    this.sea = renderer.createMesh(ring(60, SEA_REACH, 40, 256, () => SEA, () => deep, 1, 0.12));
    this.mountainMaterial = this.plain;
    if (ridge === null) {
      this.mountains = null;
      return;
    }
    if (painted !== null) {
      this.mountains = this.paint(ridge, painted, look, detail);
      this.mountainMaterial = { albedo: renderer.createSurfaceTexture(painted.picture, { colorSpace: 'srgb', filter: 'linear', mipmap: true, wrap: 'repeat', anisotropy: 8 }), doubleSided: true };
      return;
    }
    /* The ridge's angle at a turn, as the panorama has it, each of its repeats a little taller or lower and wandering. */
    const heights = ridge.tops.map((t) => ridge.horizon - t);
    const angleAt = (phi: number): number => {
      const deg = ((phi * 180) / Math.PI + 360) % 360;
      const sector = Math.floor(deg / SECTOR);
      const within = ((deg - sector * SECTOR) / SECTOR) * heights.length;
      const i = Math.floor(within);
      const f = within - i;
      const h = heights[i % heights.length]! * (1 - f) + heights[(i + 1) % heights.length]! * f;
      const vary = 0.7 + 0.6 * noise(sector * 7.3, 0.5) + 0.35 * (noise(deg / 9, 3.1) - 0.5);
      /* A range of its own, where the stage asks: broad massifs and their peaks, none of the panorama's. */
      if (look.ownMountains === true) return ((1.6 + 4.2 * noise(deg / 40, 1.3) ** 1.5 + 1.6 * noise(deg / 11, 4.1)) * Math.PI) / 180;
      return ((h * 0.075 * vary) * Math.PI) / 180;
    };
    const ridged = (x: number, z: number): number => {
      let sum = 0;
      let amp = 0.5;
      let f = 1 / 700;
      for (let o = 0; o < 5; o += 1) {
        sum += amp * (1 - Math.abs(2 * detail(x * f + o * 17.1, z * f) - 1));
        amp *= 0.5;
        f *= 2.1;
      }
      return sum;
    };
    const height = (x: number, z: number, r: number, phi: number): number => {
      const centre = RIDGE + 600 * (noise(phi * 6, 9.7) - 0.5);
      const width = 700 + 500 * noise(phi * 4, 2.3);
      const bump = Math.exp(-(((r - centre) / width) ** 2));
      const peak = EYE - SEA + RIDGE * Math.tan(angleAt(phi));
      const h = peak * bump * (0.55 + 0.75 * ridged(x, z));
      return SEA - 6 + h;
    };
    const colour = (h: number, slope: number, _r: number, x: number, z: number): [number, number, number] => {
      const above = h - SEA;
      if (clad === 'snow') {
        /* Bare rock and scree below, snow above the line wherever the slope holds it. */
        const line = 260 + 120 * detail(x / 900, z / 900);
        const snow = Math.min(1, Math.max(0, (above - line) / 80)) * Math.min(1, Math.max(0, (0.75 - slope) * 3));
        const v = 0.8 + 0.4 * detail(x / 120, z / 120);
        const rock: [number, number, number] = [0.07 * v, 0.06 * v, 0.05 * v];
        const white: [number, number, number] = [0.75, 0.77, 0.8];
        return [rock[0] + (white[0] - rock[0]) * snow, rock[1] + (white[1] - rock[1]) * snow, rock[2] + (white[2] - rock[2]) * snow];
      }
      if (above < 8) return [0.32, 0.29, 0.2];
      const v = 0.75 + 0.5 * detail(x / 160, z / 160);
      const green: [number, number, number] = [0.028 * v, 0.07 * v, 0.024 * v];
      const rock: [number, number, number] = [0.09, 0.085, 0.075];
      const t = Math.min(1, Math.max(0, (slope - 0.35) * 2.2));
      return [green[0] + (rock[0] - green[0]) * t, green[1] + (rock[1] - green[1]) * t, green[2] + (rock[2] - green[2]) * t];
    };
    this.mountains = renderer.createMesh(ring(RING[0], RING[1], 56, 1440, height, colour, 0.1, 0.9));
  }

  /**
   * The mountains the panorama paints, built: round the arena at its ridge's angles, each point
   * taking the panorama's texel the board shows in its direction (its turn the column, its elevation
   * the row), and shaded a little by the sun as the stage's scenery is.
   */
  private paint(ridge: Ridge, painted: Painted, look: StageLook, detail: (x: number, y: number) => number): MeshHandle {
    const { layout } = painted;
    const unit = Math.trunc((layout.degrees * 4096) / 360);
    const width = layout.columns * 64;
    const height = layout.rows * 64 + 8;
    const lines = (layout.pitch / 256) * (4096 / 360);
    /* The picture's column in a direction (x, z), as the board scrolls it: 512 of its pixels to a screen's turn. */
    const column = (x: number, z: number): number => (-Math.atan2(-x, -z) * (4096 / (2 * Math.PI)) * 512) / unit + 256;
    const topAt = (col: number): number => {
      const c = ((col % width) + width) % width;
      const i = Math.floor(c);
      const f = c - i;
      return ridge.tops[i % width]! * (1 - f) + ridge.tops[(i + 1) % width]! * f;
    };
    const ridged = (x: number, z: number): number => {
      let sum = 0;
      let amp = 0.5;
      let f = 1 / 500;
      for (let o = 0; o < 4; o += 1) {
        sum += amp * (1 - Math.abs(2 * detail(x * f + o * 17.1, z * f) - 1));
        amp *= 0.5;
        f *= 2.1;
      }
      return sum;
    };
    const heightAt = (x: number, z: number, r: number): number => {
      const angle = (((ridge.horizon - topAt(column(x, z))) / lines) * Math.PI) / 180;
      const bump = Math.exp(-(((r - RIDGE) / 900) ** 2));
      /* A little under the painted ridge, so no sky the picture has above it shows on the land. */
      const peak = (EYE - SEA + RIDGE * Math.tan(angle)) * 0.94;
      return SEA - 6 + peak * bump * (0.86 + 0.14 * ridged(x, z));
    };
    const [lx, ly, lz] = look.sun;
    const l = Math.hypot(lx, ly, lz);
    const lum = (c: readonly number[]): number => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    const colour = (_h: number, _slope: number, _r: number, _x: number, _z: number, n: readonly [number, number, number]): [number, number, number] => {
      const ndl = Math.max(0, (n[0] * lx + n[1] * ly + n[2] * lz) / l);
      const ambient = (lum(look.ambient) * (1 + n[1])) / 2 + (lum(look.ambientGround) * (1 - n[1])) / 2;
      const k = (0.8 + 0.45 * ndl) / (ambient + lum(look.sunColour) * ndl);
      return [k, k, k];
    };
    /* Never a row above the ridge's own, a few texels in: the land's colour, not the sky's or a cloud's over it. */
    const uv = (x: number, y: number, z: number): [number, number] => {
      const e = (Math.atan2(y - EYE, Math.hypot(x, z)) * 180) / Math.PI;
      const col = column(x, z);
      return [col / width, Math.min(height - 1, Math.max(topAt(col) + 4, ridge.horizon - e * lines)) / height];
    };
    return this.renderer.createMesh(ring(RING[0], RING[1], 56, 1440, (x, z, r) => heightAt(x, z, r), colour, 0.05, 0.95, uv));
  }

  /**
   * The dome round the eye, and the sea and mountains where they stand round it, turned as the
   * scenery is; with `sight`, for a camera that sees no farther (metres), the dome, the clouds and
   * the mountains drawn within it toward where they lie, and no sea.
   */
  draw(camera: Camera, time: number, wind: Wind, sceneryYaw = 0, sight?: number): void {
    const r = this.renderer;
    const [x, y, z] = camera.position as unknown as [number, number, number];
    const k = sight === undefined ? 1 : sight / DOME;
    this.model.set([k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0, x, y, z, 1]);
    r.setMaterial(this.domeMaterial);
    /* The sky, its clouds and sun go into a reconstructed frame, which moves them with the camera as they move, so the scenery's edges against them are resolved. */
    r.drawTranslucentMesh(this.dome, this.model, 1, { lit: false, fog: false, reconstructed: true });
    if (this.cloudDome !== null && this.cloudMaterial !== null) {
      /* The clouds turn round the eye as the wind aloft carries them past, the way it blows. */
      const speed = Math.hypot(wind.x, wind.z) * ALOFT;
      const angle = (Math.sign(wind.x || 1) * speed * time) / CLOUDS;
      const c = Math.cos(angle) * k;
      const s = Math.sin(angle) * k;
      this.turned.set([c, 0, -s, 0, 0, k, 0, 0, s, 0, c, 0, x, y, z, 1]);
      r.setMaterial(this.cloudMaterial);
      r.drawTranslucentMesh(this.cloudDome, this.turned, 1, { lit: false, fog: false, reconstructed: true });
    }
    /* The sun after the clouds, its light added to theirs: it shines through them, none of them cut away round it. */
    r.setMaterial(this.plain);
    r.drawTranslucentMesh(this.sun, this.model, 1, { lit: false, fog: false, additive: true, reconstructed: true });
    const angle = (-sceneryYaw * 2 * Math.PI) / 4096;
    const c = Math.cos(angle) * k;
    const s = Math.sin(angle) * k;
    this.still.set([c, 0, s, 0, 0, k, 0, 0, -s, 0, c, 0, x, y * (1 - k), z, 1]);
    if (sight === undefined) r.drawMesh(this.sea, this.still, undefined, null, this.seaMover);
    if (this.mountains !== null) {
      r.setMaterial(this.mountainMaterial);
      r.drawMesh(this.mountains, this.still, undefined, null, sight === undefined ? this.mountainMover : undefined);
    }
    r.setMaterial(null);
  }
}

/** The sky's colour a degree above the horizon, averaged round the turn (linear). */
function hazeOf(sky: ImageBitmap): [number, number, number] {
  const canvas = new OffscreenCanvas(sky.width, sky.height);
  const context = canvas.getContext('2d')!;
  context.drawImage(sky, 0, 0);
  const row = Math.round(((E1 - 1) / (E1 - E0)) * sky.height);
  const data = context.getImageData(0, row, sky.width, 1).data;
  const sum = [0, 0, 0];
  for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c += 1) sum[c]! += data[i + c]!;
  const linear = (v: number): number => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return sum.map((v) => linear(v / (data.length / 4))) as [number, number, number];
}
