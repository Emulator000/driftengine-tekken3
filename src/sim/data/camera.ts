/**
 * The fight camera's data. A move's camera byte names a list of shots to pick from at random: its
 * shots below 0x2b are the game's own (`CameraTables.moveShots`), from 0x2b the moveset's
 * (`Moveset.shots`), the byte's list starting one entry past its index and running until the odds
 * reach the roll. A shot is a built-in one (a number below 30, played from its table row: its
 * length, how long it takes to hand back, and four pitches and four yaws to pick from), a camera
 * script of the moveset, -1 for none, or another number that names nothing.
 *
 * A camera script gives, frame by frame, the eye and the point it looks at relative to a fighter,
 * and the shot's progress; its side code says which way it is turned about the fighter.
 */

/** A shot: a built-in shot's number (below 30), -1 for none, another number naming nothing, or a script of the moveset by its index. */
export type ShotName = number | { readonly script: number };

/** One of a camera byte's shots: whether it keeps its side when mirrored (1), its cumulative odds out of 0x1000, the shot. */
export interface ShotChoice {
  readonly kind: number;
  readonly odds: number;
  readonly shot: ShotName;
}

/** A built-in shot: its length, how long it takes to hand back, and the pitches and yaws it picks from. */
export interface BuiltInShot {
  readonly length: number;
  readonly exit: number;
  readonly pitches: readonly number[];
  readonly yaws: readonly number[];
}

/**
 * A stretch of a script channel: a value held, a value and its slope per frame (per 32 frames in a
 * script longer than nine), keys eased by the motions' cubic (each step reached `span` frames after
 * the last), or a value per frame.
 */
export type ScriptSegment =
  | { readonly kind: 'constant'; readonly length: number; readonly value: number }
  | { readonly kind: 'linear'; readonly length: number; readonly start: number; readonly slope: number }
  | { readonly kind: 'keys'; readonly start: number; readonly steps: Int32Array; readonly spans: Uint8Array }
  | { readonly kind: 'samples'; readonly values: Int16Array };

/** A camera script: its side code, its length in frames, and its channels (every other one played backwards). */
export interface CameraScript {
  readonly side: number;
  readonly frames: number;
  readonly channels: readonly (readonly ScriptSegment[])[];
}

/**
 * A scene: a shot a counted hit calls for, held `hold` frames less its closing. Kind 0 frames both
 * fighters at one of its pitches and yaws; kind 1 pulls in toward the point it watches, its reach
 * running from the first distance to the second over the hold. Its length is the shot's own.
 */
export interface Scene {
  readonly kind: number;
  readonly hold: number;
  readonly length: number;
  readonly close: number;
  readonly reach: readonly [number, number];
  readonly pitches: readonly number[];
  readonly yaws: readonly number[];
}

/** A scene list's entry: its cumulative odds out of 0x1000, and a scene (by index) for each kind of hit. */
export interface SceneChoice {
  readonly odds: number;
  readonly scenes: readonly number[];
}

/** Which list of scenes a fighter's state calls for, by what the other fighter does: its moveset and move id. */
export interface SceneCall {
  readonly character: number;
  readonly moveId: number;
  readonly list: number;
}

export interface CameraTables {
  /** The game's own shots for camera bytes below 0x2b, by entry (the first, never read, null). */
  readonly moveShots: readonly (ShotChoice | null)[];
  readonly shots: readonly BuiltInShot[];
  /** Per built-in shot number, its row plus one (0 none). */
  readonly shotRows: readonly number[];
  /** How long handing back takes for a shot that is none (or a number naming nothing), and for a script: the halfwords before the rows. */
  readonly noShotExit: number;
  readonly scriptExit: number;
  readonly sceneLists: readonly (readonly SceneChoice[])[];
  readonly sceneCalls: readonly SceneCall[];
  readonly scenes: readonly Scene[];
  /** The round's opening sweeps: where the eye starts, off the follow camera's. */
  readonly openingSweeps: readonly (readonly number[])[];
  /** The second knockout camera's placings: how far ahead, how far out and how high, three of each. */
  readonly knockout: { readonly ahead: readonly number[]; readonly out: readonly number[]; readonly heights: readonly number[] };
  /** The attract mode's four shots, by their step; its orbit's heights (18-bit pitches) and speeds. */
  readonly attractShots: readonly number[];
  readonly orbitPitches: readonly number[];
  readonly orbitSpeeds: readonly number[];
}
