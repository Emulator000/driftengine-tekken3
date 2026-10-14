/** The model packs' facts (`tables/fighters.json`), validated; and the arcade board's fighters' own accessories (`tables/arcade-fighters.json`). */
import type { FighterModels, OwnAccessory } from '../sim/data/models.ts';
import { parseSpring } from './skeleton.ts';
import { expectArray, expectBoolean, expectInt, expectInts, expectObject } from './validate.ts';

/** The accessories a model may bring, on joints 18 to 23. */
const OWN_ACCESSORIES = 6;
const FIRST_ACCESSORY = 0x12;

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

/** The arcade board's fighters' own accessories, by pack: each on its joint (18 on), or null where the model has none. */
export function parseArcadeFighters(json: unknown, where = 'tables/arcade-fighters.json'): Map<number, readonly (OwnAccessory | null)[]> {
  const o = expectObject(json, where);
  return new Map(
    Object.entries(o).map(([key, list]) => {
      const pack = expectInt(Number(key), `${where} pack ${key}`, 0, 0x34);
      const accessories = expectArray(list, `${where}[${key}]`, OWN_ACCESSORIES).map((value, k): OwnAccessory | null => {
        if (value === null) return null;
        const at = `${where}[${key}][${k}]`;
        const a = expectObject(value, at);
        return {
          shown: expectBoolean(a.shown, `${at}.shown`),
          parent: expectInt(a.parent, `${at}.parent`, 0, FIRST_ACCESSORY + k - 1),
          offset: [...expectInts(a.offset, `${at}.offset`, 3, (n) => new Int32Array(n), -0x8000, 0x7fff)],
          rest: [...expectInts(a.rest, `${at}.rest`, 3, (n) => new Int16Array(n), -0x8000, 0x7fff)],
          spring: a.spring === null ? null : parseSpring(a.spring, `${at}.spring`),
        };
      });
      return [pack, accessories];
    }),
  );
}

/** The models with the arcade board's fighters' own accessories, for the packs drawn with them. */
export function withOwnAccessories(models: FighterModels, own: ReadonlyMap<number, readonly (OwnAccessory | null)[]>): FighterModels {
  return models.map((model, pack) => {
    const accessories = own.get(pack);
    return model === null || accessories === undefined ? model : { ...model, accessories };
  });
}
