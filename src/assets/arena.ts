/**
 * What the presentation lays the arena by (`tables/arena.json`), validated: the ground's template
 * (121 vertices as x and z, 100 quads of four vertex numbers) and Tekken Force's (44 and 30), the shade a ground corner takes by
 * its depth past the fighters, each stage's height, the scenery grid's cell order, and per stage
 * its ground's kind and shade strength and its scenery's cell size (0 for a stage with no scenery,
 * Tekken Ball's beach; null for a stage not extracted), for the twenty stage numbers; and per stage
 * how its fighters are lit.
 */
import { AssetError, expectArray, expectInts, expectObject } from './validate.ts';

/** The stage numbers the tables cover (Tekken Ball's beach is the last). */
const STAGES = 20;

export interface StageLayout {
  /** How its floor is shaded: 0 by depth (by the shade strength), 1 lit at each fighter's feet, 2 lit over their midpoint, 3 lit at the player's feet (Tekken Force's). */
  readonly groundKind: number;
  readonly shadeStrength: number;
  readonly cellSize: number;
}

/**
 * How a stage's fighters are lit: the back colour every face takes (0 to 255, the light's scale),
 * the colour the light comes to is multiplied by (red, green, blue; 0x80 the texture's own), the
 * light's colour (red, green, blue, 0 to 255), and its elevation and azimuth (4096ths of a turn).
 */
export interface FighterLightRecord {
  readonly back: number;
  readonly base: readonly [number, number, number];
  readonly light: readonly [number, number, number];
  readonly angles: readonly [number, number];
}

export interface GroundTemplate {
  readonly vertices: readonly (readonly [number, number])[];
  readonly quads: readonly (readonly number[])[];
}

export interface ArenaTables {
  readonly ground: GroundTemplate;
  /** Tekken Force's ground: a 10 × 3 patch of wider tiles. */
  readonly forceGround: GroundTemplate;
  readonly shades: Uint8Array;
  readonly stageHeights: readonly number[];
  readonly gridCells: readonly number[];
  readonly stages: readonly (StageLayout | null)[];
  readonly fighterLights: readonly FighterLightRecord[];
}

function groundTemplate(value: unknown, where: string, vertexCount: number, quadCount: number): GroundTemplate {
  const ground = expectObject(value, where);
  return {
    vertices: expectArray(ground.vertices, `${where}.vertices`, vertexCount).map((v, i) => {
      const [x, z] = expectInts(v, `${where}.vertices[${i}]`, 2, (n) => new Int16Array(n), -0x8000, 0x7fff);
      return [x!, z!] as const;
    }),
    quads: expectArray(ground.quads, `${where}.quads`, quadCount).map((q, i) => [...expectInts(q, `${where}.quads[${i}]`, 4, (n) => new Uint8Array(n), 0, vertexCount - 1)]),
  };
}

export function parseArenaTables(json: unknown, where = 'tables/arena.json'): ArenaTables {
  const o = expectObject(json, where);
  return {
    ground: groundTemplate(o.ground, `${where} ground`, 121, 100),
    forceGround: groundTemplate(o.forceGround, `${where} forceGround`, 44, 30),
    shades: expectInts(o.shades, `${where} shades`, 0x400, (n) => new Uint8Array(n), 0, 0xff),
    stageHeights: [...expectInts(o.stageHeights, `${where} stageHeights`, STAGES, (n) => new Int16Array(n), -0x8000, 0x7fff)],
    gridCells: [...expectInts(o.gridCells, `${where} gridCells`, 36, (n) => new Int16Array(n), 0, 35)],
    stages: expectArray(o.stages, `${where} stages`, STAGES).map((s, i) => {
      if (s === null) return null;
      const stage = expectObject(s, `${where} stages[${i}]`);
      const [groundKind, shadeStrength] = expectInts([stage.groundKind, stage.shadeStrength], `${where} stages[${i}]`, 2, (n) => new Int16Array(n), -0x8000, 0x7fff);
      const [cellSize] = expectInts([stage.cellSize], `${where} stages[${i}].cellSize`, 1, (n) => new Int32Array(n), 0, 0x7fffffff);
      if (!(groundKind! >= 0 && groundKind! <= 3)) throw new AssetError(`${where} stages[${i}].groundKind`, `is ${groundKind}, not a floor shaded by depth (0) or lit (1 to 3)`);
      return { groundKind: groundKind!, shadeStrength: shadeStrength!, cellSize: cellSize! };
    }),
    fighterLights: expectArray(o.fighterLights, `${where} fighterLights`, STAGES).map((l, i) => {
      const light = expectObject(l, `${where} fighterLights[${i}]`);
      const [back] = expectInts([light.back], `${where} fighterLights[${i}].back`, 1, (n) => new Uint8Array(n), 0, 0xff);
      const base = expectInts(light.base, `${where} fighterLights[${i}].base`, 3, (n) => new Uint8Array(n), 0, 0xff);
      const colour = expectInts(light.light, `${where} fighterLights[${i}].light`, 3, (n) => new Uint8Array(n), 0, 0xff);
      const angles = expectInts(light.angles, `${where} fighterLights[${i}].angles`, 2, (n) => new Uint16Array(n), 0, 0xfff);
      return { back: back!, base: [base[0]!, base[1]!, base[2]!], light: [colour[0]!, colour[1]!, colour[2]!], angles: [angles[0]!, angles[1]!] };
    }),
  };
}
