/** Tekken Force's tables (`tables/force.json`), validated. */
import type { ForcePlace, ForceRecord, ForceTables } from '../sim/data/force.ts';
import { expectArray, expectInt, expectObject, expectString } from './validate.ts';

const ints = (value: unknown, where: string, length: number, lo: number, hi: number): number[] => expectArray(value, where, length).map((v, i) => expectInt(v, `${where}[${i}]`, lo, hi));
const S16 = [-0x8000, 0x7fff] as const;
const S32 = [-0x80000000, 0x7fffffff] as const;
/** The waves' entries, the roster codes, the stages and the script's records. */
const WAVES = 0x31;
const CODES = 0x5c;
const STAGES = 4;
const RECORDS = 128;

function place(value: unknown, where: string): ForcePlace {
  const o = expectObject(value, where);
  const n = (key: string): number => expectInt(o[key], `${where}.${key}`, ...S16);
  return { x: n('x'), y: n('y'), slideX: n('slideX'), slideY: n('slideY') };
}

export function parseForceTables(json: unknown, where = 'tables/force.json'): ForceTables {
  const o = expectObject(json, where);
  const versus = expectObject(o.versus, `${where}.versus`);
  return {
    waves: expectArray(o.waves, `${where}.waves`, WAVES).map((w, i) => {
      const [type, kind] = ints(w, `${where}.waves[${i}]`, 2, ...S16);
      return [type!, kind!] as const;
    }),
    kinds: expectArray(o.kinds, `${where}.kinds`, 5).map((k, i) => {
      const kind = expectObject(k, `${where}.kinds[${i}]`);
      return { gauge: expectInt(kind.gauge, `${where}.kinds[${i}].gauge`, 0, 0x9c), seconds: expectInt(kind.seconds, `${where}.kinds[${i}].seconds`, 0, 0xffff) };
    }),
    health: expectArray(o.health, `${where}.health`, 5).map((row, i) => ints(row, `${where}.health[${i}]`, 5, 0, S32[1])),
    costumes: expectArray(o.costumes, `${where}.costumes`, 6).map((row, i) => {
      const [a, b] = ints(row, `${where}.costumes[${i}]`, 2, 0, 3);
      return [a!, b!] as const;
    }),
    par: ints(o.par, `${where}.par`, 5, ...S32),
    stageBonus: ints(o.stageBonus, `${where}.stageBonus`, 5, 0, S32[1]),
    bosses: expectArray(o.bosses, `${where}.bosses`, CODES).map((row, code) =>
      expectArray(row, `${where}.bosses[${code}]`, 4).map((pair, s) => {
        const [roster, costume] = ints(pair, `${where}.bosses[${code}][${s}]`, 2, -1, 0x15);
        return [roster!, costume!] as const;
      }),
    ),
    barColours: expectArray(o.barColours, `${where}.barColours`, 4).map((c, i) => ints(c, `${where}.barColours[${i}]`, 3, 0, 0xff)),
    versus: {
      portrait: place(versus.portrait, `${where}.versus.portrait`),
      name: place(versus.name, `${where}.versus.name`),
      stageName: place(versus.stageName, `${where}.versus.stageName`),
      names: expectArray(versus.names, `${where}.versus.names`, 5).map((pair, s) => {
        const [a, b] = expectArray(pair, `${where}.versus.names[${s}]`, 2).map((v, i) => expectString(v, `${where}.versus.names[${s}][${i}]`));
        return [a!, b!] as const;
      }),
      colours: ints(versus.colours, `${where}.versus.colours`, 5, 0, 0xff),
      title: expectString(versus.title, `${where}.versus.title`),
      stage: expectString(versus.stage, `${where}.versus.stage`),
      finalStage: expectString(versus.finalStage, `${where}.versus.finalStage`),
    },
    stages: expectArray(o.stages, `${where}.stages`, STAGES).map((value, s) => {
      const stage = expectObject(value, `${where}.stages[${s}]`);
      const backdrop = expectObject(stage.backdrop, `${where}.stages[${s}].backdrop`);
      const columns = expectInt(backdrop.columns, `${where}.stages[${s}].backdrop.columns`, 1, 0x40);
      const rows = expectInt(backdrop.rows, `${where}.stages[${s}].backdrop.rows`, 1, 0x10);
      return {
        script: expectArray(stage.script, `${where}.stages[${s}].script`, RECORDS).map((r, i) => {
          const [dist, op, x, z, arg, kind] = expectArray(r, `${where}.stages[${s}].script[${i}]`, 6).map((v, k) => expectInt(v, `${where}.stages[${s}].script[${i}][${k}]`, k === 0 ? S32[0] : S16[0], k === 0 ? S32[1] : S16[1]));
          return [dist!, op!, x!, z!, arg!, kind!] as ForceRecord;
        }),
        backdrop: {
          columns,
          rows,
          codes: ints(backdrop.codes, `${where}.stages[${s}].backdrop.codes`, columns * rows, 0, 0xffff),
          cluts: ints(backdrop.cluts, `${where}.stages[${s}].backdrop.cluts`, columns * rows, 0, 0xffff),
        },
      };
    }),
  };
}
