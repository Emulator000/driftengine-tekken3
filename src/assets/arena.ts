/**
 * What the presentation lays the arena by (`tables/arena.json`), validated: the ground's template
 * (121 vertices as x and z, 100 quads of four vertex numbers), the shade a ground corner takes by
 * its depth past the fighters, each stage's height, the scenery grid's cell order, and per stage
 * its ground's kind and shade strength and its scenery's cell size (null for a stage not extracted).
 */
import { AssetError, expectArray, expectInts, expectObject } from './validate.ts';

export interface StageLayout {
  /** How its floor is shaded: 0 by depth (by the shade strength), 1 lit at each fighter's feet, 2 lit over their midpoint. */
  readonly groundKind: number;
  readonly shadeStrength: number;
  readonly cellSize: number;
}

export interface ArenaTables {
  readonly ground: { readonly vertices: readonly (readonly [number, number])[]; readonly quads: readonly (readonly number[])[] };
  readonly shades: Uint8Array;
  readonly stageHeights: readonly number[];
  readonly gridCells: readonly number[];
  readonly stages: readonly (StageLayout | null)[];
}

export function parseArenaTables(json: unknown, where = 'tables/arena.json'): ArenaTables {
  const o = expectObject(json, where);
  const ground = expectObject(o.ground, `${where} ground`);
  return {
    ground: {
      vertices: expectArray(ground.vertices, `${where} ground.vertices`, 121).map((v, i) => {
        const [x, z] = expectInts(v, `${where} ground.vertices[${i}]`, 2, (n) => new Int16Array(n), -0x8000, 0x7fff);
        return [x!, z!] as const;
      }),
      quads: expectArray(ground.quads, `${where} ground.quads`, 100).map((q, i) => [...expectInts(q, `${where} ground.quads[${i}]`, 4, (n) => new Uint8Array(n), 0, 120)]),
    },
    shades: expectInts(o.shades, `${where} shades`, 0x400, (n) => new Uint8Array(n), 0, 0xff),
    stageHeights: [...expectInts(o.stageHeights, `${where} stageHeights`, 15, (n) => new Int16Array(n), -0x8000, 0x7fff)],
    gridCells: [...expectInts(o.gridCells, `${where} gridCells`, 36, (n) => new Int16Array(n), 0, 35)],
    stages: expectArray(o.stages, `${where} stages`, 15).map((s, i) => {
      if (s === null) return null;
      const stage = expectObject(s, `${where} stages[${i}]`);
      const [groundKind, shadeStrength] = expectInts([stage.groundKind, stage.shadeStrength], `${where} stages[${i}]`, 2, (n) => new Int16Array(n), -0x8000, 0x7fff);
      const [cellSize] = expectInts([stage.cellSize], `${where} stages[${i}].cellSize`, 1, (n) => new Int32Array(n), 1, 0x7fffffff);
      if (!(groundKind! >= 0 && groundKind! <= 2)) throw new AssetError(`${where} stages[${i}].groundKind`, `is ${groundKind}, not a floor shaded by depth (0) or lit (1, 2)`);
      return { groundKind: groundKind!, shadeStrength: shadeStrength!, cellSize: cellSize! };
    }),
  };
}
