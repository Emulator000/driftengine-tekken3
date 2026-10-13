/**
 * The game's per-character tables: a row per roster id (0 to 21) of each character's eight push
 * spheres' radii and fourteen hit spheres'; per roster code (roster × 4 + costume, 0x5c; a code
 * past them reads 0x58) its sound character, moveset, model pack (-1 none), home stage and song;
 * and full health by mode, and the health a winner gets back after a fight in Team Battle (by the
 * eighths of its health left) and Survival (by the fight's length), in 256ths of full health.
 */
export interface RosterTables {
  readonly pushRadii: readonly (readonly number[])[];
  readonly hitRadii: readonly (readonly number[])[];
  readonly codes: readonly { readonly name: string; readonly sound: number; readonly moveset: number; readonly pack: number; readonly stage: number; readonly song: number }[];
  readonly health: readonly number[];
  readonly recovery: { readonly team: readonly number[]; readonly survival: readonly number[] };
  /** Added characters and the roster id whose rows each reads. */
  readonly standIns: readonly (readonly [number, number])[];
}

/** The roster tables as a fight reads them: a character added past the game's 22 reads the row of its stand-in. */
export interface RosterRows extends RosterTables {
  rowOf(roster: number): number;
}
