/**
 * A tint or a fill as the 2D layers take it. Their colours are stated as they look on the screen
 * (red, green, blue and alpha, 0 to 1), and every layer is encoded for the screen as it is drawn, so
 * the colour is decoded first: a fill comes out as stated, and a picture's shade multiplies it as the
 * console's fades do. Alpha is coverage and stays as it is.
 */
import { srgbToLinear } from '@driftengine/core';

export type Rgba = readonly [number, number, number, number];

/** `colour` decoded into `out`. */
export function screenTint(out: Float32Array, colour: Rgba): Float32Array {
  out[0] = srgbToLinear(colour[0]);
  out[1] = srgbToLinear(colour[1]);
  out[2] = srgbToLinear(colour[2]);
  out[3] = colour[3];
  return out;
}
