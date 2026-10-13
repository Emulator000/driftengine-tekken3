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
  readonly vibration: VibrationTables;
}

/**
 * The pads' vibration patterns: each one's channel (of four; past them it never starts), its
 * small motor's and its large motor's steps (each its level in bits 8 to 11, its fields in the low
 * byte, a 1 in the top nibble where another follows; a first step with nothing there leaves that
 * motor as it was), and the small motor's turning by level (a bit for each field of eight).
 */
export interface VibrationTables {
  readonly channels: readonly number[];
  readonly small: readonly (readonly number[])[];
  readonly large: readonly (readonly number[])[];
  readonly duty: readonly number[];
}
