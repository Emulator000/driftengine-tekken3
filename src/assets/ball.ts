/** Tekken Ball's tables (`tables/ball.json`), validated. */
import type { BallTables } from '../sim/data/ball.ts';
import { expectArray, expectInt, expectObject, expectString } from './validate.ts';

const ints = (value: unknown, where: string, length: number, lo: number, hi: number): number[] => expectArray(value, where, length).map((v, i) => expectInt(v, `${where}[${i}]`, lo, hi));
const rows = (value: unknown, where: string, count: number, length: number, lo: number, hi: number): number[][] => expectArray(value, where, count).map((row, i) => ints(row, `${where}[${i}]`, length, lo, hi));

export function parseBallTables(json: unknown, where = 'tables/ball.json'): BallTables {
  const o = expectObject(json, where);
  const glow = expectObject(o.glow, `${where}.glow`);
  const rules = expectObject(o.rules, `${where}.rules`);
  return {
    kinds: expectArray(o.kinds, `${where}.kinds`, 3).map((value, k) => {
      const kind = expectObject(value, `${where}.kinds[${k}]`);
      const at = `${where}.kinds[${k}]`;
      const n = (key: string): number => expectInt(kind[key], `${at}.${key}`, -0x8000, 0x7fff);
      return {
        unit: n('unit'),
        lift: n('lift'),
        gravity: n('gravity'),
        squared: n('squared'),
        back: ints(kind.back, `${at}.back`, 3, 0, 0xff),
        percent: n('percent'),
        strip: n('strip'),
        colours: rows(kind.colours, `${at}.colours`, 8, 3, 0, 0xff),
      };
    }),
    vertices: rows(o.vertices, `${where}.vertices`, 0x2a, 3, -0x8000, 0x7fff),
    normals: rows(o.normals, `${where}.normals`, 0x2a, 3, -0x8000, 0x7fff),
    triangles: rows(o.triangles, `${where}.triangles`, 0x10, 3, 0, 0x29),
    quads: rows(o.quads, `${where}.quads`, 0x20, 4, 0, 0x29),
    tracks: rows(o.tracks, `${where}.tracks`, 4, 3, -0x8000, 0x7fff),
    names: expectArray(o.names, `${where}.names`, 3).map((pair, k) => expectArray(pair, `${where}.names[${k}]`, 2).map((v, i) => expectString(v, `${where}.names[${k}][${i}]`))),
    damage: expectString(o.damage, `${where}.damage`),
    title: expectString(o.title, `${where}.title`),
    glow: { spark: rows(glow.spark, `${where}.glow.spark`, 12, 2, 0, 0xff), grow: rows(glow.grow, `${where}.glow.grow`, 8, 2, 0, 0xff), burn: rows(glow.burn, `${where}.glow.burn`, 8, 2, 0, 0xff) },
    rules: { title: expectString(rules.title, `${where}.rules.title`), text: expectString(rules.text, `${where}.rules.text`) },
  };
}
