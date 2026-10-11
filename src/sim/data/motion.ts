/**
 * A motion: its frame count and 49 channels, the root's position first (three) then the joints'
 * angles. A channel is nothing, a constant, a start with a slope, a value per frame, or keys: a
 * start value then steps, each reached `span` frames after the one before, the frames between
 * eased by the game's cubic. Every other channel is kept with its frames reversed.
 */
export const CHANNELS = 49;

export type Channel =
  | { readonly kind: 'zero'; readonly reversed: boolean }
  | { readonly kind: 'constant'; readonly reversed: boolean; readonly value: number }
  | { readonly kind: 'linear'; readonly reversed: boolean; readonly start: number; readonly slope: number }
  | { readonly kind: 'samples'; readonly reversed: boolean; readonly values: Int16Array }
  | { readonly kind: 'keys'; readonly reversed: boolean; readonly start: number; readonly steps: Int32Array; readonly spans: Uint8Array };

export interface Motion {
  /** Its id, which the motion kinds list. */
  readonly id: number;
  readonly frames: number;
  readonly channels: readonly Channel[];
}

/**
 * The cubic's tables. `segment[length][f]` picks the weights for frame `f` of a segment `length`
 * frames long (1 to 32); `back`, `after`, `next` and `first` are the weights, as fractions of
 * 0x10000, of the key before the segment, the key after it, the segment's end and its start.
 */
export interface CurveTables {
  readonly segment: readonly Uint8Array[];
  readonly back: Uint16Array;
  readonly after: Uint16Array;
  readonly next: Uint16Array;
  readonly first: Uint16Array;
}
