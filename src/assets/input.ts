/** The input tables (`tables/input.json`), validated. */
import type { InputTables } from '../sim/data/input.ts';
import { expectArray, expectInts, expectObject } from './validate.ts';

/** The vibration patterns the game has. */
const PATTERNS = 28;

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
    vibration: (() => {
      const v = expectObject(o.vibration, `${where} vibration`);
      const bytes = (key: string, length: number): number[] => [...expectInts(v[key], `${where} vibration.${key}`, length, (n) => new Uint8Array(n), 0, 0xff)];
      const tracks = (key: string): number[][] => expectArray(v[key], `${where} vibration.${key}`, PATTERNS).map((t, i) => [...expectInts(t, `${where} vibration.${key}[${i}]`, undefined, (n) => new Uint16Array(n), 0, 0xffff)]);
      return { channels: bytes('channels', PATTERNS), small: tracks('small'), large: tracks('large'), duty: bytes('duty', 16) };
    })(),
  };
}
