/** The reaction tables (`tables/reactions.json`), validated. */
import type { ReactionTables } from '../sim/data/reactions.ts';
import { expectArray, expectInt, expectInts, expectObject } from './validate.ts';

export function parseReactionTables(json: unknown, where = 'tables/reactions.json'): ReactionTables {
  const o = expectObject(json, where);
  const halves = (value: unknown, at: string, length?: number): Int16Array => expectInts(value, at, length, (n) => new Int16Array(n), -0x8000, 0x7fff);
  return {
    rows: new Map(
      expectArray(o.rows, `${where} rows`).map((value, i) => {
        const row = expectObject(value, `${where} rows[${i}]`);
        return [expectInt(row.index, `${where} rows[${i}].index`, 0, 0xffff), [...halves(row.values, `${where} rows[${i}].values`, 21)]];
      }),
    ),
    list: halves(o.list, `${where} list`),
    ball: [...halves(o.ball, `${where} ball`, 21)],
    backKinds: expectArray(o.backKinds, `${where} backKinds`).map((v, i) => expectInt(v, `${where} backKinds[${i}]`, 0, 0xffff)),
    backReach: expectArray(o.backReach, `${where} backReach`).map((v, i) => expectInt(v, `${where} backReach[${i}]`, -0x8000, 0x7fff)),
    knockback: new Map(
      expectArray(o.knockback, `${where} knockback`).map((pair, i) => {
        const [index, value] = expectArray(pair, `${where} knockback[${i}]`, 2);
        return [expectInt(index, `${where} knockback[${i}][0]`, 0, 0xffff), expectInt(value, `${where} knockback[${i}][1]`, -0x8000, 0x7fff)];
      }),
    ),
    arcSteps: halves(o.arcSteps, `${where} arcSteps`),
    launches: expectArray(o.launches, `${where} launches`, 6).map((v, i) => {
      const l = expectObject(v, `${where} launches[${i}]`);
      return { height: expectInt(l.height, `${where} launches[${i}].height`, -0x8000, 0x7fff), move: expectInt(l.move, `${where} launches[${i}].move`, -0x8000, 0x7fff) };
    }),
  };
}
