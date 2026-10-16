/**
 * The fight drawn mirrored left to right (`mirror.on`), as an online match draws it for the player
 * whose side is the other one's: the page turns the whole canvas over, so the world is mirrored as
 * it stands, and what is drawn over it (the HUD, a menu, a line) is turned back whole, drawn as it
 * always is: its pass's transform mirrored across (`upright`), and its pictures' rows swapped
 * (`uprightUv`), as the engine's sprites keep a picture's top up by their transform's turn and a
 * mirrored transform would stand them on their heads.
 */
import type { UvRect } from '@driftengine/ui2d';

export const mirror = { on: false };

const WHOLE: UvRect = { u0: 0, v0: 0, u1: 1, v1: 1 };

/** A 2D pass's transform (its units to the screen's, `[a, b, c, d, e, f]`, across `a x + c y + e`) with its across turned back while the fight is mirrored. */
export function upright(affine: Float32Array): Float32Array {
  if (mirror.on) {
    affine[0] = -affine[0]!;
    affine[2] = -affine[2]!;
    affine[4] = -affine[4]!;
  }
  return affine;
}

/** A sprite's picture under an `upright` transform: its rows swapped while the fight is mirrored. */
export function uprightUv(uv: UvRect | null): UvRect | null {
  if (!mirror.on) return uv;
  const from = uv ?? WHOLE;
  return { u0: from.u0, v0: from.v1, u1: from.u1, v1: from.v0 };
}
