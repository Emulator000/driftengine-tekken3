/** The input tables (`tables/input.json`), validated. */
import type { InputTables } from '../sim/data/input.ts';
import { expectArray, expectInts, expectObject } from './validate.ts';

export function parseInputTables(json: unknown, where = 'tables/input.json'): InputTables {
  const o = expectObject(json, where);
  const sides = expectArray(o.directions, `${where} directions`, 2).map((side, i) => expectInts(side, `${where} directions[${i}]`, 9, (n) => new Uint16Array(n), 0, 0xffff));
  const sequence = (value: unknown, at: string): number[] => [...expectInts(value, at, undefined, (n) => new Uint16Array(n), 0, 0xffff)];
  const sequences = (key: string, count: number): number[][] => expectArray(o[key], `${where} ${key}`, count).map((v, i) => sequence(v, `${where} ${key}[${i}]`));
  return {
    directions: [sides[0]!, sides[1]!],
    sequencesA: sequences('sequencesA', 0x3f),
    sequencesB: sequences('sequencesB', 0x29),
    dashForward: sequence(o.dashForward, `${where} dashForward`),
    dashBack: sequence(o.dashBack, `${where} dashBack`),
  };
}
