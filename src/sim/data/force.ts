/**
 * Tekken Force's tables: the wave entries (a soldier's type and kind each, type 99 ending a list);
 * per enemy kind its gauge's length and the seconds its fall adds; per stage the health of each
 * kind (16.16; the fifth kind the boss), the soldiers' costumes by type, the boss fight's par
 * frames and the stage bonus; the boss each roster code meets on each stage (a costume of -1 by
 * the player's own); the progress bar's four colours; the versus screen's places, the stages'
 * names and colours and its lines; and per stage its script and its backdrop's map.
 */
/** A script record: the progress it is due at, its op, the x (from the camera's) and z it places at, its argument and its kind. */
export type ForceRecord = readonly [dist: number, op: number, x: number, z: number, arg: number, kind: number];

export interface ForcePlace {
  readonly x: number;
  readonly y: number;
  readonly slideX: number;
  readonly slideY: number;
}

export interface ForceStage {
  readonly script: readonly ForceRecord[];
  /** The backdrop's cells, row by row: each one's texture word and palette word. */
  readonly backdrop: { readonly columns: number; readonly rows: number; readonly codes: readonly number[]; readonly cluts: readonly number[] };
}

export interface ForceTables {
  readonly waves: readonly (readonly [type: number, kind: number])[];
  readonly kinds: readonly { readonly gauge: number; readonly seconds: number }[];
  readonly health: readonly (readonly number[])[];
  readonly costumes: readonly (readonly [number, number])[];
  readonly par: readonly number[];
  readonly stageBonus: readonly number[];
  readonly bosses: readonly (readonly (readonly [roster: number, costume: number])[])[];
  readonly barColours: readonly (readonly number[])[];
  readonly versus: {
    readonly portrait: ForcePlace;
    readonly name: ForcePlace;
    readonly stageName: ForcePlace;
    readonly names: readonly (readonly [string, string])[];
    readonly colours: readonly number[];
    readonly title: string;
    readonly stage: string;
    readonly finalStage: string;
  };
  readonly stages: readonly ForceStage[];
}
