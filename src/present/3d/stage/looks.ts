/**
 * How each stage is lit and how its floor and air behave when remastered: its sun (toward it,
 * and its colour), its sky's ambient light, its wind, and how wet its floor is. The importer's sky
 * for the stage is made with the same sun.
 */
import type { Wind } from './grass.ts';

export interface StageLook {
  readonly sun: readonly [number, number, number];
  readonly sunColour: readonly [number, number, number];
  readonly ambient: readonly [number, number, number];
  readonly ambientGround: readonly [number, number, number];
  readonly wind: Wind;
  /**
   * The floor: its roughness (0 a mirror, 1 matte), how deep its stones' relief is in its maps, how
   * much of its colour it keeps (wet stone is darker) and its tint, how much of the world it
   * reflects, how far its joints sink (metres), how much of its normal map shows (water lies flat
   * over its grain), and how much of it is steel (a grating).
   */
  readonly floor: { readonly roughness: number; readonly relief: number; readonly albedo: number; readonly tint?: readonly [number, number, number]; readonly reflectivity: number; readonly depth: number; readonly grain?: number; readonly metal?: number };
  /** What the far mountains are clad in, and whether they are built and clad as such rather than painted from the arcade's panorama. */
  readonly mountains: 'green' | 'snow';
  readonly ownMountains?: boolean;
  /** How far the scenery's surfaces rise and sink with their texture's heights (metres between lowest and highest), and whether it is rock, whose free edges rise and sink too. */
  readonly relief: number;
  readonly ragged?: boolean;
  /** Puddles lying on its floor, how many to a hundred square metres (`puddles.ts`). */
  readonly puddles?: number;
}

const DAY: StageLook = {
  sun: [-0.4, 0.8, 0.45],
  sunColour: [1.2, 1.15, 1.08],
  ambient: [0.13, 0.145, 0.17],
  ambientGround: [0.1, 0.1, 0.09],
  wind: { x: 0, z: 0, gust: 0 },
  floor: { roughness: 0.85, relief: 0.4, albedo: 1, reflectivity: 0, depth: 0.035 },
  mountains: 'green',
  relief: 0.14,
};

const LOOKS = new Map<number, StageLook>([
  [10, { ...DAY, wind: { x: 1.1, z: 0.45, gust: 0.55 }, relief: 0.45, ragged: true }],
  /* The forest's trunks and wall, and the temple's carved stone, raised as rock is. */
  [2, { ...DAY, relief: 0.25, ragged: true }],
  [12, { ...DAY, relief: 0.2, ragged: true }],
  /* The alley after the rain: puddles on its asphalt, the signs over it in them. */
  [5, { ...DAY, puddles: 1.5 }],
  /* The funfair's surfaces painted (its steps stripes on one slope), none of them raised. */
  [3, { ...DAY, relief: 0 }],
  /* The rooftop's floor a steel grating, the sky under it showing through. */
  [11, { ...DAY, floor: { ...DAY.floor, roughness: 0.4, reflectivity: 0.4, metal: 0.6 } }],
  /* Hwoarang's temple at sunset: a low, warm sun facing the temple and the fighters, a blue sky's light, the stones wet and dark. */
  [4, { ...DAY, sun: [0.42, 0.11, 0.9], sunColour: [2.2, 1.15, 0.5], ambient: [0.24, 0.2, 0.22], ambientGround: [0.14, 0.1, 0.07], wind: { x: 0.3, z: 0.1, gust: 0.2 }, floor: { roughness: 0.12, relief: 0.45, albedo: 0.2, reflectivity: 1, depth: 0.03, tint: [1, 0.96, 0.92], grain: 0.25 }, mountains: 'snow', ownMountains: true }],
]);

/** How far each stage's floor sinks between its stones' tops and its joints (metres), by what it is: planks and plate barely, cobbles and rock most. */
const FLOOR_DEPTHS: readonly number[] = [0.02, 0.02, 0.008, 0.008, 0.03, 0.025, 0.04, 0.015, 0.006, 0.004, 0.008, 0, 0.04, 0.03, 0.01, 0.03, 0.006, 0.004, 0.006, 0.03];

/** A stage's look, its floor sinking as far as `FLOOR_DEPTHS` has it. */
export const lookOfStage = (stage: number): StageLook => {
  const look = LOOKS.get(stage) ?? DAY;
  return { ...look, floor: { ...look.floor, depth: FLOOR_DEPTHS[stage] ?? look.floor.depth } };
};

/**
 * A floor's normal and ORM maps from its own texture, where nothing better was imported:
 * its relief from its brightness (dark joints and cracks lie lower), occlusion in what lies low, and
 * its roughness, lower in the joints, where water stands.
 */
export function reliefMaps(picture: ImageBitmap, floor: StageLook['floor']): { normal: ImageData; orm: ImageData } {
  const { width: w, height: h } = picture;
  const canvas = new OffscreenCanvas(w, h);
  const context = canvas.getContext('2d')!;
  context.drawImage(picture, 0, 0);
  const rgba = context.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i += 1) lum[i] = (0.2126 * rgba[i * 4]! + 0.7152 * rgba[i * 4 + 1]! + 0.0722 * rgba[i * 4 + 2]!) / 255;
  /* A box blur each way, `r` texels: the stones' broad shape, against which the joints lie low. */
  const blur = (src: Float32Array, r: number): Float32Array => {
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
    return out;
  };
  const height = blur(lum, 1);
  const broad = blur(lum, Math.max(2, Math.round(w / 512)));
  const normal = new ImageData(w, h);
  const orm = new ImageData(w, h);
  const s = floor.relief * (w / 256);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      const dx = height[y * w + Math.min(w - 1, x + 1)]! - height[y * w + Math.max(0, x - 1)]!;
      const dy = height[Math.min(h - 1, y + 1) * w + x]! - height[Math.max(0, y - 1) * w + x]!;
      const nx = -dx * s;
      const ny = dy * s;
      const l = Math.hypot(nx, ny, 1);
      normal.data.set([Math.round((0.5 + (0.5 * nx) / l) * 255), Math.round((0.5 + (0.5 * ny) / l) * 255), Math.round((0.5 + 0.5 / l) * 255), 255], i * 4);
      const low = Math.max(0, broad[i]! - height[i]!);
      const occlusion = Math.max(0, 1 - 3 * low);
      const roughness = Math.min(1, Math.max(0.04, floor.roughness * (1 - 4 * low) + 0.12 * (height[i]! - broad[i]!)));
      orm.data.set([Math.round(occlusion * 255), Math.round(roughness * 255), 0, 255], i * 4);
    }
  }
  if (floor.reflectivity > 0) wetMaps(normal, orm, Math.max(16, w / 16), floor);
  return { normal, orm };
}

/**
 * A floor's height map as heights from 0 (a joint) to 1 (a stone's top): what is broader than
 * its stones (`broad` texels, rises and dips the picture has but the floor does not) taken away,
 * smoothed over `radius` texels (what is finer, its normal map shows), and spread over its own 1st to
 * 99th percentiles.
 */
export function heightsOf(picture: ImageBitmap, cell: number, radius: number, broad: number): { heights: Float32Array; width: number; height: number } {
  const { data, width, height } = pixelsOf(picture);
  const raw: Float32Array = new Float32Array(width * height);
  for (let i = 0; i < raw.length; i += 1) raw[i] = data[i * 4]!;
  withoutSeams(raw, width, height, cell);
  const blurred = (r: number): Float32Array => (r > 0 ? boxBlur(boxBlur(raw, width, height, r), width, height, r) : raw);
  const under = blurred(broad);
  const out = blurred(radius).map((h, i) => h - under[i]!);
  const sample = Array.from({ length: 65536 }, (_, k) => out[Math.floor((k * out.length) / 65536)]!).sort((x, y) => x - y);
  const low = sample[655]!;
  const span = Math.max(1e-6, sample[64880]! - low);
  for (let i = 0; i < out.length; i += 1) out[i] = Math.min(1, Math.max(0, (out[i]! - low) / span));
  return { heights: out, width, height };
}

/** An image's pixels. */
export function pixelsOf(picture: ImageBitmap): ImageData {
  const canvas = new OffscreenCanvas(picture.width, picture.height);
  const context = canvas.getContext('2d')!;
  context.drawImage(picture, 0, 0);
  return context.getImageData(0, 0, picture.width, picture.height);
}

/**
 * A wet floor's maps, in place: puddles where seeded noise and the stones' low places (their
 * occlusion) gather water, mirror-smooth and flat as water lies; elsewhere damp, the stone's own
 * roughness brought down and its relief kept. `cell` is a floor region's side in texels, which the
 * puddles are sized to.
 */
export function wetMaps(normal: ImageData, orm: ImageData, cell: number, floor: StageLook['floor'], seed = 7): void {
  const { width: w, height: h } = orm;
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const table = Float32Array.from({ length: 256 * 256 }, next);
  const value = (x: number, y: number): number => {
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    const at = (p: number, q: number): number => table[(p & 255) * 256 + (q & 255)]!;
    return at(i, j) * (1 - u) * (1 - v) + at(i + 1, j) * u * (1 - v) + at(i, j + 1) * (1 - u) * v + at(i + 1, j + 1) * u * v;
  };
  const scale = 3.2 / cell;
  const damp = floor.roughness;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const n = 0.55 * value(x * scale, y * scale) + 0.3 * value(x * scale * 2.3 + 11, y * scale * 2.3) + 0.15 * value(x * scale * 5.1 + 23, y * scale * 5.1);
      const puddle = Math.min(1, Math.max(0, (n - 0.74) / 0.05));
      const cavity = Math.min(1, Math.max(0, (1 - orm.data[i]! / 255) * 2.5));
      const water = Math.max(puddle, 0.3 * cavity);
      const own = orm.data[i + 1]! / 255;
      /* Some stretches have dried more than others: rougher there, so the stone's own relief and grain read through the sheen. */
      const dried = Math.min(1, Math.max(0, (value(x * scale * 1.7 + 41, y * scale * 1.7 + 7) - 0.4) / 0.25));
      const surface = damp + (0.45 - damp) * dried * 0.6;
      const rough = (own * 0.35 + surface * 0.65) * (1 - water) + 0.04 * water;
      orm.data[i + 1] = Math.round(Math.min(1, rough) * 255);
      /* Water lies flat over the stone: filling some of its grain everywhere, standing flat in a puddle. */
      const flat = 0.3 + 0.6 * puddle;
      for (let k = 0; k < 2; k += 1) normal.data[i + k] = Math.round(normal.data[i + k]! * (1 - flat) + 128 * flat);
      normal.data[i + 2] = Math.round(normal.data[i + 2]! * (1 - flat) + 255 * flat);
    }
  }
}

/**
 * A see-through floor (a grating) from the game's own, enlarged (`picture`, its alpha the
 * holes): its edges made sharp; its bars raised and rounded over `bevel` texels toward the holes,
 * which its normal map shows; metal where it is grey (`metal`, its roughness `roughness`), its
 * coloured parts (beams) left matte.
 */
export function gratingMaps(picture: ImageData, bevel: number, metal: number, roughness: number): { albedo: ImageData; normal: ImageData; orm: ImageData } {
  const { width: w, height: h } = picture;
  const albedo = new ImageData(new Uint8ClampedArray(picture.data), w, h);
  const solid: Float32Array = new Float32Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    const a = picture.data[i * 4 + 3]! / 255;
    const t = Math.min(1, Math.max(0, (a - 0.35) / 0.3));
    solid[i] = t * t * (3 - 2 * t);
    albedo.data[i * 4 + 3] = Math.round(solid[i]! * 255);
  }
  const height = boxBlur(boxBlur(solid, w, h, bevel), w, h, bevel);
  const normal = new ImageData(w, h);
  const orm = new ImageData(w, h);
  const strength = bevel * 1.5;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      const dx = (height[y * w + Math.min(w - 1, x + 1)]! - height[y * w + Math.max(0, x - 1)]!) * strength;
      const dy = (height[Math.min(h - 1, y + 1) * w + x]! - height[Math.max(0, y - 1) * w + x]!) * strength;
      const l = Math.hypot(dx, dy, 1);
      normal.data.set([Math.round((-dx / l) * 127.5 + 127.5), Math.round((dy / l) * 127.5 + 127.5), Math.round((1 / l) * 127.5 + 127.5), 255], i * 4);
      const [r, g, b] = [picture.data[i * 4]!, picture.data[i * 4 + 1]!, picture.data[i * 4 + 2]!];
      const grey = 1 - Math.min(1, ((Math.max(r, g, b) - Math.min(r, g, b)) / Math.max(1, Math.max(r, g, b))) * 4);
      /* Less light in the bevel's foot, where a bar meets a hole. */
      const occlusion = 0.55 + 0.45 * height[i]!;
      orm.data.set([Math.round(occlusion * 255), Math.round(255 * (roughness * grey + 0.75 * (1 - grey))), Math.round(255 * metal * grey), 255], i * 4);
    }
  }
  return { albedo, normal, orm };
}

/** How wide a straight seam may be (texels) to be taken out of a height map. */
const SEAM = 4;

/**
 * A height map's seams taken out, in each `cell`-texel square: a row or column lower than
 * those round it right across the square, no more than `SEAM` texels wide (what is left of the
 * picture it was drawn from, not a stone's joint, which wanders and is wider), each texel there
 * taken between the texels on either side.
 */
function withoutSeams(h: Float32Array, width: number, height: number, cell: number): void {
  for (let top = 0; top + cell <= height; top += cell) {
    for (let left = 0; left + cell <= width; left += cell) {
      for (const across of [false, true]) {
        /* Each line's mean (rows, or columns `across`), against the median of those near it. */
        const means = new Float32Array(cell);
        for (let a = 0; a < cell; a += 1) {
          let sum = 0;
          for (let b = 0; b < cell; b += 1) sum += across ? h[(top + b) * width + left + a]! : h[(top + a) * width + left + b]!;
          means[a] = sum / cell;
        }
        const below = Array.from(means, (m, a) => {
          const near = Array.from({ length: 33 }, (_, k) => means[Math.min(cell - 1, Math.max(0, a + k - 16))]!).sort((x, y) => x - y);
          return near[16]! - m;
        });
        const spread = [...below].map(Math.abs).sort((x, y) => x - y)[cell >> 1]! || 1;
        const low = below.map((d) => d > 4 * spread);
        for (let a = 0; a < cell; a += 1) {
          if (!low[a]) continue;
          let end = a;
          while (end + 1 < cell && low[end + 1]) end += 1;
          if (end - a + 1 <= SEAM && a > 0 && end + 1 < cell) {
            for (let b = 0; b < cell; b += 1) {
              const at = (line: number): number => (across ? (top + b) * width + left + line : (top + line) * width + left + b);
              const before = h[at(a - 1)]!;
              const after = h[at(end + 1)]!;
              for (let k = a; k <= end; k += 1) h[at(k)] = before + ((after - before) * (k - a + 1)) / (end - a + 2);
            }
          }
          a = end;
        }
      }
    }
  }
}

/** A box blur each way, `r` texels, of a `w` × `h` field. */
function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
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
  return out;
}

/**
 * The stones' large relief from a floor's own colours, over the fine grain of its normal
 * map: each slab raised where it is lighter than its surroundings and its joints sunk where they
 * are darker, bevelled at `cell / 64` texels a slope, and its joints occluded. In place.
 */
export function macroRelief(albedo: ImageData, normal: ImageData, orm: ImageData, cell: number, strength: number): void {
  const { width: w, height: h } = albedo;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i += 1) lum[i] = (0.2126 * albedo.data[i * 4]! + 0.7152 * albedo.data[i * 4 + 1]! + 0.0722 * albedo.data[i * 4 + 2]!) / 255;
  const texel = Math.max(1, Math.round(cell / 64));
  const fine = boxBlur(lum, w, h, texel);
  const broad = boxBlur(lum, w, h, texel * 6);
  /* The slab's height: how much lighter than round it, held so a bright fleck is not a peak. */
  const height = new Float32Array(w * h);
  for (let i = 0; i < w * h; i += 1) height[i] = Math.tanh((fine[i]! - broad[i]!) * 6);
  const bevel = boxBlur(height, w, h, Math.max(1, Math.round(texel / 2)));
  const s = strength * 1.6;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      const dx = (bevel[y * w + Math.min(w - 1, x + texel)]! - bevel[y * w + Math.max(0, x - texel)]!) * s;
      const dy = (bevel[Math.min(h - 1, y + texel) * w + x]! - bevel[Math.max(0, y - texel) * w + x]!) * s;
      const o = i * 4;
      /* The fine grain's slopes, then the slab's on top of them. */
      const fx = (normal.data[o]! / 255 - 0.5) * 2;
      const fy = (normal.data[o + 1]! / 255 - 0.5) * 2;
      const fz = Math.max(0.2, (normal.data[o + 2]! / 255 - 0.5) * 2);
      const nx = fx / fz - dx;
      const ny = fy / fz + dy;
      const l = Math.hypot(nx, ny, 1);
      normal.data[o] = Math.round((0.5 + (0.5 * nx) / l) * 255);
      normal.data[o + 1] = Math.round((0.5 + (0.5 * ny) / l) * 255);
      normal.data[o + 2] = Math.round((0.5 + 0.5 / l) * 255);
      const occlusion = Math.min(1, Math.max(0.25, 1 + 1.5 * Math.min(0, height[i]!)));
      orm.data[o] = Math.round(Math.min(orm.data[o]! / 255, occlusion) * 255);
    }
  }
}

/**
 * A floor region's original texels laid out as the imported floor lays them, `cell` texels a
 * region, read smoothly from the stage's atlas picture (`scale` of its pixels a texel): the stones
 * and joints the floor's relief is taken from.
 */
export function originalFloor(picture: ImageBitmap, scale: number, regions: readonly (readonly [number, number])[], size: number, cell: number, columns: number): ImageData {
  const source = pixelsOf(picture);
  const rows = Math.ceil(regions.length / columns);
  const out = new ImageData(columns * cell, rows * cell);
  const at = (x: number, y: number, c: number): number => source.data[(Math.min(source.height - 1, Math.max(0, y)) * source.width + Math.min(source.width - 1, Math.max(0, x))) * 4 + c]!;
  regions.forEach(([x0, y0], k) => {
    const ox = (k % columns) * cell;
    const oy = Math.floor(k / columns) * cell;
    for (let py = 0; py < cell; py += 1) {
      for (let px = 0; px < cell; px += 1) {
        const u = (x0 + (px * size) / cell) * scale - 0.5;
        const v = (y0 + (py * size) / cell) * scale - 0.5;
        const i = Math.floor(u);
        const j = Math.floor(v);
        const fu = u - i;
        const fv = v - j;
        const o = ((oy + py) * out.width + ox + px) * 4;
        for (let c = 0; c < 4; c += 1) out.data[o + c] = at(i, j, c) * (1 - fu) * (1 - fv) + at(i + 1, j, c) * fu * (1 - fv) + at(i, j + 1, c) * (1 - fu) * fv + at(i + 1, j + 1, c) * fu * fv;
      }
    }
  });
  return out;
}
