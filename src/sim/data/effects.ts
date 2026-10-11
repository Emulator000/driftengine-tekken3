/** The fight's effect tables: breath, glow, dust, sparks and camera shakes. */

/** A spark: how many frames it plays, and the colour its flash lights the fighters with. */
export interface SparkLook {
  readonly frames: number;
  readonly colour: readonly number[];
}

export interface EffectTables {
  /** The two points of the head a breath leaves from and heads to. */
  readonly mouth: readonly (readonly number[])[];
  /** Per frame of a breath puff, whether it still hurts. */
  readonly breathHurts: readonly number[];
  /** Per hit code, the word naming the joint its glow lights (its low five bits; 0 none). Codes past 0x19 read whatever lies there. */
  readonly glowJoints: readonly number[];
  /** Per roster row, where the glow sits on each hand: its offset from joint 6's frame, then from joint 10's. */
  readonly glowOffsets: readonly (readonly (readonly number[])[])[];
  /** The colour the glow's flash lights its fighter with. */
  readonly glowColour: readonly number[];
  /** A dust cloud's six puffs around the landing. */
  readonly puffs: readonly (readonly number[])[];
  /** Per roster row, the character's own spark; the generic four (a hit, two guards, dust). */
  readonly characterSparks: readonly SparkLook[];
  /** The rows of those the attract intro's two sides throw, whoever plays. */
  readonly introSparks: readonly number[];
  readonly genericSparks: readonly SparkLook[];
  /** The three camera shakes: steps added to the pitch a frame, ending at -128. */
  readonly shakes: readonly (readonly number[])[];
  readonly fire: FireTables;
  /** The Mishimas' lightning sheet's 22 frames traced into strokes, for drawing: each a polyline in the sheet's 32 by 32 texels (from the top left) with the brightness at each point. */
  readonly lightning: readonly (readonly LightningStroke[])[];
}

export interface LightningStroke {
  readonly points: readonly number[];
  readonly brightness: readonly number[];
}

/** The fire's tables. */
export interface FireTables {
  /** The colour its flash lights its fighter with. */
  readonly colour: readonly number[];
  /** The two points a fire leaves the head from and heads to: Ogre's breath by side, Gon's; and those his flames leave his joint 11 by. */
  readonly mouths: readonly (readonly (readonly number[])[])[];
  readonly gonMouth: readonly (readonly number[])[];
  readonly gonFlames: readonly (readonly number[])[];
  /** The joints a burning fighter's ten flames sit on. */
  readonly burningJoints: readonly number[];
  /** By its last stage's frame, whether the breath still feeds a puff; by its last stage's frame, whether Gon's puff still hurts. */
  readonly going: readonly number[];
  readonly gonHurts: readonly number[];
  /** Gon's flames: per column the frame it rises on, its speed (sixteenths) and its height. */
  readonly schedule: readonly { readonly frame: number; readonly speed: number; readonly height: number }[];
  /** By its two frames, whether a column hurts. */
  readonly columnHurts: readonly number[];
}
