/** Square roots as the game takes them. */
import type { MathTables } from '../data/tables.ts';
import { divu } from './integers.ts';

/** By Newton's method from a power of two, over an unsigned 32-bit value. */
export function isqrt(value: number): number {
  const x = value >>> 0;
  if (x === 0) return 0;
  let guess = 1;
  let rest = x;
  if (x > 1) {
    do {
      guess = (guess << 1) >>> 0;
      rest >>>= 1;
    } while (guess < rest);
  }
  let root: number;
  do {
    root = guess;
    guess = (divu(x, root) + root) >>> 1;
  } while (guess < root);
  return root;
}

/**
 * By table, as the distances take it: the value shifted by an even count until its top byte is 64
 * to 255, that byte's root from the table, shifted back by half the count. A negative value reads
 * the halfwords before the table, as the original does.
 */
export function tableRoot(value: number, tables: MathTables): number {
  const v = value | 0;
  if (v === 0) return 0;
  const even = Math.clz32(v < 0 ? ~v : v) & ~1;
  const top = even <= 24 ? v >> (24 - even) : v << (even - 24);
  const root = v > 0 ? tables.roots[top - 64]! : tables.negativeRoots[top + 256]!;
  return (root << ((31 - even) >> 1)) >>> 12;
}

/**
 * The geometry library's square root: as `tableRoot`, with 0 for 0 and for -1, and a negative
 * value reading the library's own memory before its copy of the table.
 */
export function libraryRoot(value: number, tables: MathTables): number {
  const v = value | 0;
  const plain = v < 0 ? ~v : v;
  const count = plain === 0 ? 32 : Math.clz32(plain);
  if (count === 32) return 0;
  const even = count & ~1;
  const top = even >= 24 ? v << (even - 24) : v >> (24 - even);
  const root = v > 0 ? tables.roots[top - 64]! : tables.libraryNegativeRoots[top + 256]!;
  return (root << ((31 - even) >> 1)) >>> 12;
}
