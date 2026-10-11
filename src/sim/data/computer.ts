/**
 * The computer player's data. Its tuning (by difficulty and arcade stage, and per character) sets
 * the odds and lengths of what it chooses; its input scripts and the input sequences are runs of
 * steps it plays one a frame (a direction in the low four bits, the attack buttons in bits 8 to
 * 11), a script ending where a 0 follows; the pad tables turn steps and cancel commands into pad
 * bits; the rest lists the choices it draws from.
 */

/** What a character's own answer routine, or the routine answering it, does. */
export type CharacterAnswer = 'none' | 'against 0' | 'against 4' | 'against 14' | 'against 19' | 'own 3' | 'own 6';

/** A moveset's scripted answers: whether it has any, the script answering an attack and a low one (-1 none), and its openers. */
export interface Responses {
  readonly flag: number;
  readonly answer: number;
  readonly lowAnswer: number;
  /** Scripted openers by cumulative odds out of 0x1000: the move id the fighter must be able to cancel into, and the script. */
  readonly openers: readonly { readonly odds: number; readonly moveId: number; readonly script: number }[];
}

export interface ComputerTables {
  /** By difficulty and arcade stage, 55 halfwords (`Tune` in the computer names those read). */
  readonly tuning: readonly (readonly (readonly number[])[])[];
  /** By roster row, six halfwords: four distance bands, a halfword never read, and how far it reaches. */
  readonly characters: readonly (readonly number[])[];
  /** The scripts' steps as they lie, and where each script starts among them. */
  readonly steps: Int16Array;
  readonly sidesteps: readonly number[];
  readonly backAway: number;
  readonly approach: number;
  /** By moveset. */
  readonly responses: readonly Responses[];
  /** King's own scripts: two against a low attack, two against a guard, three when his move 0x15 is open. */
  readonly kingScripts: readonly number[];
  /** The input sequences' halfwords as they lie, and where each starts (-1 none): the dashes, and by command from 0xc00e and from 0xc7ff. */
  readonly sequenceSteps: Int16Array;
  readonly sequences: { readonly dashForward: number; readonly dashBack: number; readonly a: readonly number[]; readonly b: readonly number[] };
  /** A script step's direction as pad bits. */
  readonly stepPads: readonly number[];
  /** A command's directions 1 to 9 as masks of its bits, and as pad bits; its four buttons as pad bits. */
  readonly commandMasks: readonly number[];
  readonly commandPads: readonly number[];
  readonly buttonPads: readonly number[];
  /** The pads an answer picks from to dodge close up. */
  readonly dodgePads: readonly number[];
  /** A downed fighter's six choices as mask bits: rise, roll, back, approach, low, other. */
  readonly downedActions: readonly number[];
  readonly retreatPlans: readonly number[];
  /** By distance band, the guard kinds a follow-up may be, and those that stop a walk. */
  readonly followUpKinds: readonly number[];
  readonly walkStopKinds: readonly number[];
  /** Per moveset, its own answer and the answer to it (the first entry for a moveset counts). */
  readonly answers: readonly { readonly moveset: number; readonly against: CharacterAnswer; readonly own: CharacterAnswer }[];
}
