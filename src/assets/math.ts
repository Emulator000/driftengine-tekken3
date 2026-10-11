/** The math tables (`tables/math.json`), validated. */
import type { MathTables } from '../sim/data/tables.ts';
import { expectInts, expectObject } from './validate.ts';

export function parseMathTables(json: unknown, where = 'tables/math.json'): MathTables {
  const o = expectObject(json, where);
  const halves = (key: string, length: number): Int16Array => expectInts(o[key], `${where} ${key}`, length, (n) => new Int16Array(n), -0x8000, 0x7fff);
  return {
    sine: halves('sine', 5120),
    atan: expectInts(o.atan, `${where} atan`, 1025, (n) => new Uint8Array(n), 0, 0xff),
    roots: halves('roots', 192),
    negativeRoots: halves('negativeRoots', 192),
    libraryNegativeRoots: halves('libraryNegativeRoots', 192),
  };
}
