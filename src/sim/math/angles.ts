/**
 * Angles. A heading is a 16-bit turn (0x10000 a turn, 0 along +z, 0x4000 along +x); other angles
 * are in 4096ths of a turn. Sine and cosine come from the game's table in 4.12 fixed point.
 */
import type { MathTables } from '../data/tables.ts';
import { div, divu, s16 } from './integers.ts';

/** The arctangent of a ratio in 4096ths, in 4096ths of a quarter turn. */
function arctangent(ratio: number, tables: MathTables): number {
  let i = (ratio < 0 ? ratio + 3 : ratio) >> 2;
  if (i < 0) i = -i;
  const a = (tables.atan[i]! + (i >> 1)) & 0xffff;
  return ratio < 0 ? -a : a;
}

/** The heading of a direction, from the low 16 bits of its z and x. */
export function headingOf(dz: number, dx: number, tables: MathTables): number {
  const negativeZ = dz << 16 < 0;
  const negativeX = dx << 16 < 0;
  const z = negativeZ ? -(dz & 0xffff) & 0xffff : dz & 0xffff;
  const x = negativeX ? -(dx & 0xffff) & 0xffff : dx & 0xffff;
  let a: number;
  if (z === x) a = 0x200;
  else if (x < z) a = arctangent(divu(x << 12, z), tables);
  else a = s16(0x400 - arctangent(divu(z << 12, x), tables));
  const scaled = (a * 0x10) & 0xffff;
  if (negativeZ) return negativeX ? (scaled + 0x8000) & 0xffff : (a * -0x10 + 0x7fff) & 0xffff;
  return negativeX ? ~scaled & 0xffff : scaled;
}

/** The angle of (x, z) in 4096ths of a turn, by octant. */
export function angle4096(x: number, z: number, tables: MathTables): number {
  const at = (i: number): number => tables.atan[i]! + (i >> 1);
  if (x === 0 && z === 0) return 0;
  let r: number;
  if (x < 0) {
    if (z < 0) r = -x < -z ? 0xc00 - at(div(x << 10, z)) : at(div(z << 10, x)) + 0x800;
    else r = -x < z ? at(div(x * -0x400, z)) + 0x400 : 0x800 - at(div(z << 10, -x));
  } else if (z < 0) r = x < -z ? at(div(x << 10, -z)) + 0xc00 : 0x1000 - at(div(z * -0x400, x));
  else r = x < z ? 0x400 - at(div(x << 10, z)) : at(div(z << 10, x));
  return s16(r);
}

/**
 * The geometry library's angle of (x, y), in 4096ths of a turn from -0x800 to 0x800: the smaller
 * magnitude over the larger in 1024ths (the larger cut by 1024 first when the smaller has bits above
 * 20), its arctangent from the table, mirrored into its octant.
 */
export function libraryAngle(y: number, x: number, tables: MathTables): number {
  const at = (i: number): number => tables.atan[i]! + (i >> 1);
  let negativeX = false;
  let negativeY = false;
  if (x < 0) {
    negativeX = true;
    x = -x | 0;
  }
  if (y < 0) {
    negativeY = true;
    y = -y | 0;
  }
  if (x === 0 && y === 0) return 0;
  let a: number;
  if (y < x) a = at((y & 0x7fe00000) !== 0 ? div(y, x >> 10) : div(y << 10, x));
  else a = 0x400 - at((x & 0x7fe00000) !== 0 ? div(x, y >> 10) : div(x << 10, y));
  if (negativeX) a = 0x800 - a;
  return negativeY ? -a : a;
}

/** A 16-bit angle difference as a quadrant: 0 within an eighth turn of ahead, then 1, 2, 3 around. */
export function quadrant(difference: number): number {
  const q = (difference + 0x2000) & 0xffff;
  if (q < 0x4000) return 0;
  if (q < 0x8000) return 1;
  return q < 0xc000 ? 2 : 3;
}

/** The sine of an angle in 4096ths, in 4.12. */
export const sine = (tables: MathTables, angle: number): number => tables.sine[angle & 0xfff]!;

/** The cosine of an angle in 4096ths, in 4.12: the sine a quarter turn on. */
export const cosine = (tables: MathTables, angle: number): number => tables.sine[(angle & 0xfff) + 0x400]!;
