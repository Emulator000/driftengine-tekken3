import type { Spring } from './skeleton.ts';

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
  /** Its own accessories (an arcade board's model's), on joints 18 to 23, in place of the game's tables'; absent for the game's. */
  readonly accessories?: readonly (OwnAccessory | null)[];
}

/**
 * An accessory a model brings with it: whether it is drawn, the joint it hangs on, its offset from
 * it (z as the game reads a record's), the angles it rests at and the spring it swings on (null, at
 * rest).
 */
export interface OwnAccessory {
  readonly shown: boolean;
  readonly parent: number;
  readonly offset: readonly number[];
  readonly rest: readonly number[];
  readonly spring: Spring | null;
}

export type FighterModels = readonly (ModelFacts | null)[];
