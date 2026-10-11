/** The model packs' facts (`tables/fighters.json`), validated. */
import type { FighterModels } from '../sim/data/models.ts';
import { expectArray, expectInts, expectObject } from './validate.ts';

export function parseFighterModels(json: unknown, where = 'tables/fighters.json'): FighterModels {
  return expectArray(json, where, 0x35).map((pack, p) => {
    if (pack === null) return null;
    const o = expectObject(pack, `${where}[${p}]`);
    const [size, commands] = expectInts([o.size, o.commands], `${where}[${p}]`, 2, (n) => new Uint16Array(n), 0, 0xffff);
    return {
      commands: commands!,
      size: size!,
      records: expectArray(o.records, `${where}[${p}].records`, 0x1b).map((record, k) => {
        const r = expectObject(record, `${where}[${p}].records[${k}]`);
        const at = `${where}[${p}].records[${k}]`;
        return {
          offset: [...expectInts(r.offset, `${at}.offset`, 3, (n) => new Int32Array(n), -0x80000000, 0x7fffffff)],
          parent: expectInts([r.parent], `${at}.parent`, 1, (n) => new Int32Array(n), -0x80000000, 0x7fffffff)[0]!,
          rest: [...expectInts(r.rest, `${at}.rest`, 3, (n) => new Uint16Array(n), 0, 0xffff)],
        };
      }),
    };
  });
}
