/**
 * The input tables: for each side of the opponent a fighter stands on, the pad's direction bits that
 * make each numpad direction from 1 to 9 (5, neutral, is none of them), so a direction reads
 * relative to the opponent; and the input sequences cancel commands name, each its window, its
 * steps (a direction in the low nibble, a button spec in the high byte) and the 0 that ends it.
 */
export interface InputTables {
  readonly directions: readonly [Uint16Array, Uint16Array];
  /** By command 0xc00e on, and 0xc7ff on. */
  readonly sequencesA: readonly (readonly number[])[];
  readonly sequencesB: readonly (readonly number[])[];
  readonly dashForward: readonly number[];
  readonly dashBack: readonly number[];
}
