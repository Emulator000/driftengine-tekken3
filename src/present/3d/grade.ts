/**
 * The remaster's colour grade, a lookup table over display values: a gentle S-curve for contrast,
 * more colour where there is little (vivid colours kept from clipping), and its shadows drawn a
 * little toward teal and its lights toward magenta, as a night city's neon tints them; all of it
 * `amount` times as much (1 the remaster's normal look).
 */
import type { ColourGradeLut } from '@driftengine/core';

/** Lattice points a side; at the normal look, how much of the S-curve, of the added colour, and of each tint is laid on. */
const SIZE = 33;
const CONTRAST = 0.22;
const VIBRANCE = 0.2;
const SHADOW_TINT = [-0.02, 0.012, 0.03] as const;
const LIGHT_TINT = [0.025, -0.008, 0.02] as const;

export function remasterGrade(amount: number): ColourGradeLut {
  const data = new Uint8Array(SIZE ** 3 * 4);
  const smooth = (x: number): number => x * x * (3 - 2 * x);
  for (let b = 0; b < SIZE; b += 1) {
    for (let g = 0; g < SIZE; g += 1) {
      for (let r = 0; r < SIZE; r += 1) {
        let c = [r, g, b].map((v) => v / (SIZE - 1));
        c = c.map((v) => v + (smooth(v) - v) * CONTRAST * amount);
        const luma = 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
        const spread = Math.max(...c) - Math.min(...c);
        const more = 1 + VIBRANCE * amount * (1 - spread);
        c = c.map((v) => luma + (v - luma) * more);
        const dark = (1 - luma) ** 2;
        const light = luma ** 2;
        c = c.map((v, k) => v + (SHADOW_TINT[k]! * dark + LIGHT_TINT[k]! * light) * amount);
        const at = ((b * SIZE + g) * SIZE + r) * 4;
        data.set([...c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)), 255], at);
      }
    }
  }
  return { size: SIZE, data };
}
