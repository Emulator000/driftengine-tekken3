/** The shared hit records (`tables/hits.json`), validated. */
import type { HitData } from '../sim/data/moveset.ts';
import type { HitTables } from '../sim/data/hits.ts';
import { parseHitData } from './moveset.ts';
import { expectArray, expectInts, expectObject } from './validate.ts';

export function parseSharedHits(json: unknown, where = 'tables/hits.json'): HitData[] {
  const o = expectObject(json, where);
  return expectArray(o.shared, `${where} shared`, 13).map((v, i) => parseHitData(v, `${where} shared[${i}]`));
}

/** The hits' own tables (`tables/hits.json`): damage by part, the spheres' joints, the held points. */
export function parseHitTables(json: unknown, where = 'tables/hits.json'): HitTables {
  const o = expectObject(json, where);
  return {
    damageByPart: [...expectInts(o.damageByPart, `${where} damageByPart`, 14, (n) => new Int16Array(n), -0x8000, 0x7fff)],
    hitSphereJoints: [...expectInts(o.hitSphereJoints, `${where} hitSphereJoints`, 14, (n) => new Uint8Array(n), 0, 23)],
    pushSphereJoints: [...expectInts(o.pushSphereJoints, `${where} pushSphereJoints`, 8, (n) => new Uint8Array(n), 0, 23)],
    heldPoints: expectArray(o.heldPoints, `${where} heldPoints`, 6).map((v, i) => [...expectInts(v, `${where} heldPoints[${i}]`, 3, (n) => new Int16Array(n), -0x8000, 0x7fff)]),
  };
}
