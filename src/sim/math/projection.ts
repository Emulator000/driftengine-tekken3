/**
 * The screen's projection as the original's geometry unit makes it: the screen's distance over a
 * point's depth by the unit's own division (a reciprocal table and two Newton steps, in 16.16,
 * capped where it overflows), then the point's x and y scaled by it and offset to the screen's
 * centre, held to -0x400..0x3ff.
 */
import { saturate } from './matrix.ts';

/** The screen's distance and the offset of its centre (16.16), as the fight sets them. */
export interface Screen {
  distance: number;
  offsetX: number;
  offsetY: number;
}

const RECIPROCALS = Uint8Array.from({ length: 257 }, (_, i) => Math.max(0, Math.floor((Math.floor(0x40000 / (i + 0x100)) + 1) / 2) - 0x101));

/** `numerator / denominator` in 16.16 as the unit divides, or 0x1ffff when it overflows. */
export function divide(numerator: number, denominator: number): number {
  if (!(numerator < denominator * 2)) return 0x1ffff;
  const z = Math.clz32(denominator) - 16;
  const n = numerator << z;
  let d = denominator << z;
  const u = RECIPROCALS[(d - 0x7fc0) >> 7]! + 0x101;
  d = Math.floor((0x2000080 - d * u) / 256);
  d = Math.floor((0x0000080 + d * u) / 256);
  return Math.min(0x1ffff, Math.floor((n * d + 0x8000) / 65536));
}

/** Where a point in the camera's space (its position only) lands on the screen: x, y and its depth (0 to 0xffff). */
export function projectPoint(screen: Screen, x: number, y: number, z: number): { x: number; y: number; depth: number } {
  const depth = z < 0 ? 0 : z > 0xffff ? 0xffff : z;
  const q = divide(screen.distance & 0xffff, depth);
  const clamp = (v: number): number => (v < -0x400 ? -0x400 : v > 0x3ff ? 0x3ff : v);
  return {
    x: clamp(Math.floor((q * saturate(x) + screen.offsetX) / 65536)),
    y: clamp(Math.floor((q * saturate(y) + screen.offsetY) / 65536)),
    depth,
  };
}
