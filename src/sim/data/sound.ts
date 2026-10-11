/**
 * The fight's sound tables. A sound code is a halfword: its top two bits the bank (1 and 2 the
 * effects' two, 3 the fighter's own), the voice in bits 10 to 13, the volume in bits 6 to 9 (an
 * index into `volumes`), the program in bits 4 and 5 and the tone in bits 0 to 3, which plays at
 * its own note.
 */

/** A sound character's voice: its lines (counts for kinds 2 to 5, then the codes kind after kind), grunts, cries (light blows', then heavy ones'), the frames between grunts, and the line a script's event plays. */
export interface SoundCharacter {
  readonly lines: { readonly counts: readonly number[]; readonly codes: readonly number[] };
  readonly grunts: readonly number[];
  readonly cries: { readonly light: number; readonly heavy: number; readonly codes: readonly number[] };
  readonly gruntWait: number;
  readonly eventLine: number;
}

/** A sound script's word: on its frame, a sound of its kind (0 an effect, 1 the fighter's, 2 the opponent's, 3 an event). */
export interface ScriptWord {
  readonly frame: number;
  readonly kind: number;
  readonly code: number;
}

export interface SoundTables {
  /** Codes by effect number. */
  readonly effects: readonly number[];
  readonly volumes: readonly number[];
  /** Mokujin's own codes for some effects. */
  readonly mokujin: readonly { readonly effect: number; readonly code: number }[];
  /** By sound character. */
  readonly characters: readonly SoundCharacter[];
  /** A light blow's hit sounds, for rosters 5, 7, 10 and 0x12 and for the rest: two to pick from for the lightest band, then one per band at 4, 6 and 8. */
  readonly hitSounds: readonly number[];
  readonly otherHitSounds: readonly number[];
  readonly mokujinHits: readonly number[];
  readonly eventSounds: readonly number[];
  readonly scripts: readonly (readonly ScriptWord[])[];
  /** The announcer's round calls, by round. */
  readonly roundCalls: readonly number[];
  /** Each sound character's bank of voices (0xff none). */
  readonly banks: readonly number[];
}
