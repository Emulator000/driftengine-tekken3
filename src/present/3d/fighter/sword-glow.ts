/**
 * Yoshimitsu's sword glow, as the console draws it over his blade every frame he is drawn: a band
 * of light added along the blade from its hilt to its tip, brightest on the blade's line and falling
 * off evenly to nothing 124 mm to either side; its colour by the costume (green, his second
 * costume's red, Mokujin's own while he fights as Yoshimitsu), two shades taken in turn, one a
 * field. The console adds it to the picture as shown, where the scene adds light: it is added here
 * as the light it shows as where nothing lies under it (`hazeLight`). Drawn as soft motes of light
 * along the blade, of two sizes, so it follows the blade without a seam and falls off as the
 * console's band does.
 */
import type { Camera, Environment, ParticleHandle, RendererApi } from '@driftengine/core';
import { particleSet } from '../effects/effect-looks.ts';

/** The joint the sword hand hangs on. */
const SWORD_JOINT = 10;
/** The blade's points on that joint (the game's millimetres), hilt to tip. */
const BLADE = [
  [60, -150, 0],
  [50, -550, 0],
  [30, -720, 0],
  [-60, -950, 0],
] as const;
/** The line's points: the blade's four. */
export const BLADE_LINE_POINTS = BLADE.length;
/**
 * The band's motes: a step apart along the blade (metres), in two sizes (their radii), each mote's
 * colour its share of the band's light on the blade's line; together they fall off as the console's
 * band does, to nothing 124 mm off the line.
 */
export const HAZE = {
  step: 0.016,
  layers: [
    { size: 0.04, share: 0.1244 },
    { size: 0.115, share: 0.0581 },
  ],
} as const;
/** The most motes drawn: both sides' band along their blades. */
const MOST_MOTES = 512;
/** How far the motes are drawn toward the eye (metres), as the effects' are, so the blade does not cut them. */
const TOWARD_EYE = 0.4;

const YOSHIMITSU = 4;
const MOKUJIN = 15;
type Shade = readonly [number, number, number];
/** The two shades by costume (the console's vertex colours, 128 a texel's own): Yoshimitsu's, his second costume's, Mokujin's. */
const SHADES: Readonly<Record<number, readonly [Shade, Shade]>> = {
  8: [
    [24, 48, 24],
    [12, 30, 12],
  ],
  9: [
    [72, 30, 30],
    [48, 24, 24],
  ],
};
const MOKUJIN_SHADES: readonly [Shade, Shade] = [
  [60, 30, 12],
  [30, 18, 12],
];
/** What the console's white texel adds at a shade's full strength (248 of 255, times the shade over 128), as shown. */
const ADDED = 248 / 128 / 255;
/** The picture as shown and the scene's light: shown values to the 2.2. */
const GAMMA = 2.2;

/** The light the band adds on the blade's line, by channel: its shade as shown, taken back to light. */
export function hazeLight(shade: Shade): [number, number, number] {
  return shade.map((c) => (c * ADDED) ** GAMMA) as [number, number, number];
}

interface Glowing {
  readonly roster: number;
  readonly character: number;
  readonly costume: number;
}

/** A fighter's sword glow's two shades, or null for a fighter without one: Yoshimitsu, and Mokujin while he fights as Yoshimitsu. */
export function swordShades(f: Glowing): readonly [Shade, Shade] | null {
  if (f.roster === YOSHIMITSU) return SHADES[f.costume] ?? MOKUJIN_SHADES;
  if (f.roster === MOKUJIN && f.character === YOSHIMITSU) return MOKUJIN_SHADES;
  return null;
}

/** The shade a fighter's glow shows on `field`, the two taken in turn; null without one. */
export function swordShade(f: Glowing, field: number): Shade | null {
  const shades = swordShades(f);
  return shades === null ? null : shades[field & 1]!;
}

interface Posed {
  readonly skeleton: { readonly joints: readonly { readonly world: { readonly rotation: ArrayLike<number>; readonly translation: ArrayLike<number> } }[] };
}

/** The glow's line into `out` (`BLADE_LINE_POINTS` points, three floats each), in the picture's metres: y up, z toward the viewer. */
export function bladeLine(f: Posed, out: Float32Array): void {
  const { rotation: r, translation: t } = f.skeleton.joints[SWORD_JOINT]!.world;
  BLADE.forEach((p, i) => {
    for (let k = 0; k < 3; k += 1) {
      const game = (r[k * 3]! * p[0] + r[k * 3 + 1]! * p[1] + r[k * 3 + 2]! * p[2]) / 4096 + t[k]!;
      out[i * 3 + k] = (k === 0 ? game : -game) / 1000;
    }
  });
}

/** The motes along a glow's line (`bladeLine`'s points): `step` apart at most and evenly, from the hilt to the tip. */
export function bladeMotes(line: Float32Array, step: number): [number, number, number][] {
  const reach = [0];
  for (let n = 1; n < BLADE_LINE_POINTS; n += 1) reach.push(reach[n - 1]! + Math.hypot(line[n * 3]! - line[n * 3 - 3]!, line[n * 3 + 1]! - line[n * 3 - 2]!, line[n * 3 + 2]! - line[n * 3 - 1]!));
  const total = reach[BLADE_LINE_POINTS - 1]!;
  const count = Math.max(1, Math.ceil(total / step - 1e-9));
  const motes: [number, number, number][] = [];
  let n = 0;
  for (let j = 0; j <= count; j += 1) {
    const u = (total * j) / count;
    while (n < BLADE_LINE_POINTS - 2 && reach[n + 1]! < u) n += 1;
    const span = reach[n + 1]! - reach[n]! || 1;
    const t = (u - reach[n]!) / span;
    motes.push([0, 1, 2].map((k) => line[n * 3 + k]! + (line[(n + 1) * 3 + k]! - line[n * 3 + k]!) * t) as [number, number, number]);
  }
  return motes;
}

/** The glow of each side's sword, drawn after the opaque scene. */
export class SwordGlows {
  private readonly renderer: RendererApi;
  private readonly motes: ParticleHandle;
  private readonly set = particleSet(MOST_MOTES);
  private readonly line = new Float32Array(BLADE_LINE_POINTS * 3);

  constructor(renderer: RendererApi) {
    this.renderer = renderer;
    this.motes = renderer.createParticles(MOST_MOTES, { material: 'mote', blend: 'additive', cameraOffset: TOWARD_EYE });
  }

  /** A new frame: no glow laid yet. */
  begin(): void {
    this.set.count = 0;
  }

  /** A fighter's glow on `field`, where it has one, placed as the fighter is drawn (`model`, column-major). */
  add(f: Glowing & Posed, field: number, model: Float32Array): void {
    const shade = swordShade(f, field);
    if (shade === null) return;
    bladeLine(f, this.line);
    /* Through the fighter's own placing: drawn a little toward the eye and lifted onto the floor. */
    for (let n = 0; n < BLADE_LINE_POINTS; n += 1) {
      const [x, y, z] = [this.line[n * 3]!, this.line[n * 3 + 1]!, this.line[n * 3 + 2]!];
      for (let k = 0; k < 3; k += 1) this.line[n * 3 + k] = model[k]! * x + model[4 + k]! * y + model[8 + k]! * z + model[12 + k]!;
    }
    const set = this.set;
    const light = hazeLight(shade);
    const motes = bladeMotes(this.line, HAZE.step);
    for (const { size, share } of HAZE.layers) {
      for (const at of motes) {
        if (set.count >= set.capacity) break;
        const i = set.count;
        set.positions.set(at, i * 3);
        set.velocities.fill(0, i * 3, i * 3 + 3);
        set.sizes[i] = size;
        set.spins[i] = 0;
        set.frames[i] = 0;
        set.heights[i] = 0;
        for (let c = 0; c < 3; c += 1) set.colors[i * 3 + c] = light[c]! * share;
        set.alphas[i] = 1;
        set.ages[i] = 0;
        set.seeds[i] = 0;
        set.count += 1;
      }
    }
  }

  /** The glows laid this frame. */
  draw(camera: Camera, env: Environment, seconds: number): void {
    if (this.set.count > 0) this.renderer.drawParticles(this.motes, this.set, camera, env, seconds);
  }
}
