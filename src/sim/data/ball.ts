/**
 * Tekken Ball's tables: its three balls (each its speed's unit, its lift, its gravity, whether
 * its light is squared, its back colour, the damage it does in percent, the half-width of the
 * court's middle strip, its eight gores' colours); the ball's mesh (its vertices and their
 * normals, y down, its triangles and quads); the four points its tracks run from about it; the
 * select's names (each ball's level and name), its damage line, the versus screen's line; and its
 * glow's cells (the spark's twelve, the fire's growth and its burning).
 */
export interface BallKind {
  readonly unit: number;
  readonly lift: number;
  readonly gravity: number;
  readonly squared: number;
  readonly back: readonly number[];
  readonly percent: number;
  readonly strip: number;
  readonly colours: readonly (readonly number[])[];
}

export interface BallTables {
  readonly kinds: readonly BallKind[];
  readonly vertices: readonly (readonly number[])[];
  readonly normals: readonly (readonly number[])[];
  readonly triangles: readonly (readonly number[])[];
  readonly quads: readonly (readonly number[])[];
  readonly tracks: readonly (readonly number[])[];
  readonly names: readonly (readonly string[])[];
  readonly damage: string;
  readonly title: string;
  readonly glow: { readonly spark: readonly (readonly number[])[]; readonly grow: readonly (readonly number[])[]; readonly burn: readonly (readonly number[])[] };
  /** The pause menu's rules page: its title and its words. */
  readonly rules: { readonly title: string; readonly text: string };
}
