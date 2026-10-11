/** The cancel tables (`tables/cancels.json`), validated. */
import type { CancelTables } from '../sim/data/cancels.ts';
import { parseCancel } from './moveset.ts';
import { expectArray, expectInts, expectObject } from './validate.ts';

export function parseCancelTables(json: unknown, where = 'tables/cancels.json'): CancelTables {
  const o = expectObject(json, where);
  return {
    shared: expectArray(o.shared, `${where} shared`).map((v, i) => parseCancel(v, `${where} shared[${i}]`)),
    motionKinds: expectArray(o.motionKinds, `${where} motionKinds`).map((v, i) => [...expectInts(v, `${where} motionKinds[${i}]`, undefined, (n) => new Int16Array(n), 1, 0x7fff)]),
  };
}
