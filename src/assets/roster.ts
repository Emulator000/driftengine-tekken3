/** The roster tables (`tables/roster.json`), validated. */
import type { RosterTables } from '../sim/data/roster.ts';
import { expectArray, expectInts, expectObject } from './validate.ts';

export function parseRosterTables(json: unknown, where = 'tables/roster.json'): RosterTables {
  const o = expectObject(json, where);
  const rows = (key: string, count: number): number[][] => expectArray(o[key], `${where} ${key}`, 22).map((row, i) => [...expectInts(row, `${where} ${key}[${i}]`, count, (n) => new Int16Array(n), -0x8000, 0x7fff)]);
  return {
    pushRadii: rows('pushRadii', 8),
    hitRadii: rows('hitRadii', 14),
    codes: expectArray(o.codes, `${where} codes`, 0x5c).map((entry, i) => {
      const c = expectObject(entry, `${where} codes[${i}]`);
      const [sound, moveset, pack, stage, song] = expectInts([c.sound, c.moveset, c.pack, c.stage, c.song], `${where} codes[${i}]`, 5, (n) => new Int16Array(n), -1, 0xff);
      if (typeof c.name !== 'string') throw new Error(`${where} codes[${i}].name is not a string`);
      return { name: c.name, sound: sound!, moveset: moveset!, pack: pack!, stage: stage!, song: song! };
    }),
    health: [...expectInts(o.health, `${where} health`, 9, (n) => new Int32Array(n), 0, 0x7fffffff)],
    standIns: expectArray(o.standIns, `${where} standIns`).map((pair, i) => {
      const [added, as] = expectInts(pair, `${where} standIns[${i}]`, 2, (n) => new Int16Array(n), 0, 0xff);
      return [added!, as!] as const;
    }),
  };
}
