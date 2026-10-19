/**
 * Yoshimitsu's sword glow, as the console draws it over his blade every frame he is drawn: a haze
 * of light added along the blade, brightest on the blade's line and fading out to either side; its
 * colour by the costume (green, his second costume's red, Mokujin's own while he fights as
 * Yoshimitsu), two shades taken in turn, one a field. Drawn here as soft motes of light close along
 * the blade, so it follows the blade without a seam: from a little past the hilt, fading out over
 * the blade's last stretch to just past the tip, so the haze stays on the blade.
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
/** The line's points: one past the hilt, the blade's four, one past the tip. */
export const BLADE_LINE_POINTS = BLADE.length + 2;
/** How far the haze runs past the hilt and past the tip (metres). */
const PAST_HILT = 0.128;
const PAST_TIP = 0.02;
/** The line's point the haze is full to, the blade's third: past it, it fades out to the line's end. */
const FULL_TO = 3;
/** The haze's motes: their radius (metres), a step between them a third of it, and their strength. */
const HAZE = { size: 0.05, step: 0.016, gain: 0.16 } as const;
/** The most motes drawn: both sides' haze along their blades. */
const MOST_MOTES = 256;
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
/** What the console's white texel adds at a shade's full strength (248 of 255, times the shade over 128). */
const ADDED = 248 / 128 / 255;

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
    const at = (i + 1) * 3;
    for (let k = 0; k < 3; k += 1) {
      const game = (r[k * 3]! * p[0] + r[k * 3 + 1]! * p[1] + r[k * 3 + 2]! * p[2]) / 4096 + t[k]!;
      out[at + k] = (k === 0 ? game : -game) / 1000;
    }
  });
  /* On past the hilt along the blade's first stretch, past the tip along its last. */
  const past = (to: number, from: number, onto: number, by: number): void => {
    const d = [0, 1, 2].map((k) => out[onto * 3 + k]! - out[from * 3 + k]!);
    const length = Math.hypot(d[0]!, d[1]!, d[2]!) || 1;
    for (let k = 0; k < 3; k += 1) out[to * 3 + k] = out[onto * 3 + k]! + (d[k]! / length) * by;
  };
  past(0, 2, 1, PAST_HILT);
  past(BLADE_LINE_POINTS - 1, BLADE_LINE_POINTS - 3, BLADE_LINE_POINTS - 2, PAST_TIP);
}

/** A mote along the glow's line: where it is, and its strength (0 to 1). */
export interface BladeMote {
  readonly at: readonly [number, number, number];
  readonly strength: number;
}

/**
 * The motes along a glow's line (`bladeLine`'s points), `step` apart at most and evenly from one
 * end to the other: fading in from the end past the hilt to the hilt, full along the blade, and
 * fading out from the blade's third point to the line's end past the tip.
 */
export function bladeMotes(line: Float32Array, step: number): BladeMote[] {
  const reach = [0];
  for (let n = 1; n < BLADE_LINE_POINTS; n += 1) reach.push(reach[n - 1]! + Math.hypot(line[n * 3]! - line[n * 3 - 3]!, line[n * 3 + 1]! - line[n * 3 - 2]!, line[n * 3 + 2]! - line[n * 3 - 1]!));
  const total = reach[BLADE_LINE_POINTS - 1]!;
  const [hilt, full] = [reach[1]!, reach[FULL_TO]!];
  const count = Math.max(1, Math.ceil(total / step - 1e-9));
  const motes: BladeMote[] = [];
  let n = 0;
  for (let j = 0; j <= count; j += 1) {
    const u = (total * j) / count;
    while (n < BLADE_LINE_POINTS - 2 && reach[n + 1]! < u) n += 1;
    const span = reach[n + 1]! - reach[n]! || 1;
    const t = (u - reach[n]!) / span;
    const at = [0, 1, 2].map((k) => line[n * 3 + k]! + (line[(n + 1) * 3 + k]! - line[n * 3 + k]!) * t) as [number, number, number];
    const strength = u < hilt ? u / hilt : u > full ? (total - u) / (total - full) : 1;
    motes.push({ at, strength: Math.max(0, Math.min(1, strength)) });
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
    for (const mote of bladeMotes(this.line, HAZE.step)) {
      if (set.count >= set.capacity || mote.strength <= 0) continue;
      const i = set.count;
      set.positions.set(mote.at, i * 3);
      set.velocities.fill(0, i * 3, i * 3 + 3);
      set.sizes[i] = HAZE.size;
      set.spins[i] = 0;
      set.frames[i] = 0;
      set.heights[i] = 0;
      for (let c = 0; c < 3; c += 1) set.colors[i * 3 + c] = shade[c]! * ADDED * HAZE.gain * mote.strength;
      set.alphas[i] = 1;
      set.ages[i] = 0;
      set.seeds[i] = 0;
      set.count += 1;
    }
  }

  /** The glows laid this frame. */
  draw(camera: Camera, env: Environment, seconds: number): void {
    if (this.set.count > 0) this.renderer.drawParticles(this.motes, this.set, camera, env, seconds);
  }
}
