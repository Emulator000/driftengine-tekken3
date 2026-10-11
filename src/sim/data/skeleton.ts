/**
 * The skeleton's tables: which ten joints the motion gives Euler angles for, the matrix three of
 * them are corrected by, the generic skeleton's offsets the limbs are measured with (the chest, the
 * shoulders and hips, and the hands' and feet's reach), the inverse roots vectors are normalised
 * by, which joint each of the 22 drawn parts hangs on, by model pack the hands' fist and open
 * shapes, and by model pack the springs its accessories swing on.
 */

/**
 * The spring an accessory (hair, a ponytail, a braid, a sash) swings on. Its tip lies `reach` along
 * its x. Each frame it aims where its tip was, seen from where it now hangs (`keep` of 256), with
 * gravity's pull (`pull` of 256, slanted by `slant`), and back toward its rest for the rest of 256.
 */
export interface Spring {
  readonly reach: number;
  readonly keep: number;
  readonly pull: number;
  /** Gravity pulls along (slant / 16, (256 - slant) × 16, slant / 16) in the world, y down. */
  readonly slant: number;
  /** The factors its angles are taken with: the yaw's arctangent's z and x, the pitch's y and length across, then the yaw's and the pitch's own. */
  readonly axes: readonly number[];
  /** Held off a point on another joint, or null. */
  readonly aim: SpringAim | null;
  /** Hangs toward a point between the knees, from where it hung last frame, rather than by its tip. */
  readonly knees: boolean;
  /** Its yaw held at zero: it swings only up and down. */
  readonly yawHeld: boolean;
  /** The least its pitch takes, or null. */
  readonly pitchAtLeast: number | null;
  /** The most and the least its yaw and its pitch take, or null. */
  readonly limits: readonly [number, number] | null;
}

/**
 * A spring held off a point on another joint (a coat's tails or a skirt off a thigh): the
 * point's aim is taken in place of the swing's where it is the less by `weights` (the yaw's and the
 * pitch's). A point behind the pivot (below zero along x) is taken with `behind.aimAxes`, and then
 * the swing with `behind.axes`.
 */
export interface SpringAim {
  readonly joint: number;
  readonly point: readonly number[];
  readonly weights: readonly [number, number];
  readonly behind: { readonly aimAxes: readonly number[]; readonly axes: readonly number[] } | null;
}

export interface SkeletonTables {
  readonly eulerJoints: Uint8Array;
  readonly fixup: readonly number[];
  readonly offsets: {
    readonly chest: readonly number[];
    readonly shoulders: readonly [readonly number[], readonly number[]];
    readonly hips: readonly number[];
    readonly hands: readonly [readonly number[], readonly number[]];
    readonly feet: readonly [readonly number[], readonly number[]];
  };
  /** By a square length's top byte, 64 to 255; and what the original reads before the table for the lengths that overflow and for zero. */
  readonly inverseRoots: Int16Array;
  readonly inverseRootsBefore: Int16Array;
  readonly partJoints: Uint8Array;
  /** Each drawn part's record in its model, whether it is drawn, and by model pack which of the four accessories are. */
  readonly partRecords: Uint8Array;
  readonly partDrawn: Uint8Array;
  readonly accessoriesDrawn: readonly Uint8Array[];
  /** By model pack (the game's: an added character's pack lies past them), each of the four accessories' spring, null where it does not swing. */
  readonly springs: readonly (readonly (Spring | null)[])[];
  readonly hands: { readonly fists: Uint8Array; readonly open: Uint8Array };
}
