import type { CameraScript, ShotChoice } from './camera.ts';

/**
 * A character's moveset: its moves, the cancel lists that chain them, the table from the 4023 move
 * ids to moves, the ids it lacks, the sound and event lists its moves play, and the camera shots
 * and scripts its moves' camera bytes from 0x2b name. Links are indices
 * into these arrays; a move or motion of the common moveset, which every character shares, is
 * marked `common`. An id with no move of the character's own is `null` in the id table, and is
 * always one of its missing ids, which a fight fills from the opponent's moveset. The common
 * moveset has no id table and lacks nothing.
 */

export const MOVE_IDS = 4023;
/** The move a character's missing ids fall back to when the opponent lacks them too. */
export const DEFAULT_MOVE_ID = 0xdc5;
/** Cancel commands with a meaning of their own: a list's end (its target the move that follows when nothing cancels), a jump into a shared list, and the return from one. */
export const CancelCommand = { END: 0xc000, CALL: 0xc00c, RETURN: 0xc00d } as const;

export interface Ref {
  readonly common: boolean;
  readonly index: number;
}

export interface Cancel {
  /** The input that cancels, or one of `CancelCommand`. */
  readonly command: number;
  /** Whose moveset or roster id the entry is for. */
  readonly condition: number;
  /** An extra test (the opponent's attack, distance, facing, health), 0 for none. */
  readonly test: number;
  readonly param: number;
  /** The move id it starts. */
  readonly target: number;
  /** The transition type in the low six bits, two flags above. */
  readonly type: number;
  /** The window of the current move's frames it applies in. */
  readonly from: number;
  readonly to: number;
  /** The frame the target starts on. */
  readonly start: number;
}

export interface MoveEvent {
  /** The frame it happens on; 0 ends a list. */
  readonly frame: number;
  readonly code: number;
  readonly arg: number;
}

/**
 * A move's hit data. `codes` are four bytes: below 0x18 the first byte and the second are the
 * joints the attack's first segment runs between, the third and fourth its second segment's (none
 * when the third is 0); 0x18 and on, the first is an effect's code. The track is the attack's swept
 * points, frame by frame: its word (big-endian) gives the layout of each frame's points in the low
 * four bits and, for the characters with a second track, where that starts; the points are x, y and
 * z in turn.
 */
export interface HitData {
  readonly codes: readonly number[];
  readonly track: { readonly word: number; readonly points: Int16Array } | null;
}

/** A moveset's own hit data, with where it lay in the moveset's hit area. */
export interface HitTable extends HitData {
  readonly offset: number;
}

/** A move's hit data: one of the 13 every moveset shares, one of its moveset's own, or none. */
export type HitRef = { readonly shared: number } | { readonly table: number } | null;

export interface Move {
  readonly motion: Ref;
  readonly flags: number;
  /** The attack's level, which reactions and the computer's choices compare. */
  readonly hitLevel: number;
  /** The first entry of its cancel list. */
  readonly cancels: number;
  /** The move id it goes on to. */
  readonly next: number;
  readonly facingOffset: number;
  /** Damage, its own plus each extra in its event list, in 14 bits, and the two flag bits above. */
  readonly damage: number;
  readonly damageFlags: number;
  /** The speed it travels at through its step window. */
  readonly stepSpeed: number;
  /** Its length in frames, its motion's count as a byte. */
  readonly length: number;
  readonly stepWindow: { readonly first: number; readonly last: number };
  readonly endFrame: number;
  /** The first entry of its sound list and of its event list, -1 for none. */
  readonly sounds: number;
  readonly events: number;
  readonly hitFlags: number;
  readonly hit: HitRef;
  /** How long the opponent is held when hit. */
  readonly hitStun: number;
  readonly activeWindow: { readonly first: number; readonly last: number };
  /** How the push spheres' radii change through it. */
  readonly pushShape: number;
  /** A throw's reaction row. */
  readonly throwReaction: number;
  readonly reactionKind: number;
}

export interface Moveset {
  readonly moves: readonly Move[];
  readonly cancels: readonly Cancel[];
  readonly moveIds: readonly (Ref | null)[];
  readonly missing: readonly number[];
  readonly sounds: readonly number[];
  readonly events: readonly MoveEvent[];
  readonly hitTables: readonly HitTable[];
  readonly shots: readonly ShotChoice[];
  readonly scripts: readonly CameraScript[];
}
