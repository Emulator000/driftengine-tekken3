/**
 * What the fight reads from each model pack's model: its size (4.12), and per record the joint's
 * offset from its parent (x, y, z), the parent record (below zero none) and an accessory's three
 * rest angles. A pack with no model is null.
 */
export interface ModelRecord {
  readonly offset: readonly number[];
  readonly parent: number;
  readonly rest: readonly number[];
}

export interface ModelFacts {
  /** How many moves its command list holds. */
  readonly commands: number;
  readonly size: number;
  readonly records: readonly ModelRecord[];
}

export type FighterModels = readonly (ModelFacts | null)[];
