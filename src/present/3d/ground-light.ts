/**
 * How a stage's floor is shaded: darker with its depth past the fighters (`layout.ts`), or lit,
 * either by a light at each fighter's feet or by one over their midpoint, brightest within a
 * couple of metres and fading by the square of the distance. With True Ogre in the match a floor
 * shaded by depth takes the midpoint's light.
 */
import type { StageLayout } from '../../assets/arena.ts';

/** How a floor is shaded: darker with its depth past the fighters, lit at each fighter's feet, or lit over their midpoint. */
export const GroundLight = { DEPTH: 0, FIGHTERS: 1, MIDPOINT: 2 } as const;
/** The lights' strengths: a corner's shade (128 unchanged) is a strength over its distance squared, in millimetres. */
const FIGHTER_LIGHT = 0x0f200000;
const MIDPOINT_LIGHT = 0x2faf0800;
/** The brightest the midpoint's light makes the floor, and on Gon's stage under True Ogre's, no brighter than it is. */
const BRIGHTEST = 0xc0;
const UNCHANGED = 0x80;
const GON_STAGE = 0xd;

/** How the floor of stage `index` is shaded and the brightest its light makes it: its own way, or with True Ogre in the match the midpoint's light for a floor shaded by depth. */
export function groundLighting(stage: StageLayout, index: number, trueOgres: number): { kind: number; brightest: number } {
  if (stage.groundKind === GroundLight.DEPTH && trueOgres !== 0) return { kind: GroundLight.MIDPOINT, brightest: index === GON_STAGE ? UNCHANGED : BRIGHTEST };
  return { kind: stage.groundKind, brightest: BRIGHTEST };
}

/** A distance across the floor, squared in 32 bits; 1 for none. */
function squared(dx: number, dz: number): number {
  const square = (Math.imul(dx, dx) + Math.imul(dz, dz)) | 0;
  return square === 0 ? 1 : square;
}

/**
 * A lit floor's corner at (x, z): the two fighters' lights added (at most 254), or the midpoint's
 * light, no brighter than `brightest`; `a` and `b` are the fighters' roots.
 */
export function litShade(kind: number, brightest: number, a: readonly number[], b: readonly number[], x: number, z: number): number {
  if (kind === GroundLight.FIGHTERS) {
    const shade = Math.trunc(FIGHTER_LIGHT / squared(a[0]! - x, a[2]! - z)) + Math.trunc(FIGHTER_LIGHT / squared(b[0]! - x, b[2]! - z));
    return shade < 0xff ? shade : 0xfe;
  }
  const cx = ((a[0]! + b[0]!) / 2) | 0;
  const cz = ((a[2]! + b[2]!) / 2) | 0;
  return Math.min(brightest, Math.trunc(MIDPOINT_LIGHT / squared(cx - x, cz - z)));
}
