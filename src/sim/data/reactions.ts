/**
 * The reaction tables. A reaction is 21 halfwords; `rows` holds the throw and hit reactions the
 * movesets reach, by row; `list` a run of halfwords whose reaction starts anywhere in it, `ball` the
 * ball's own. `backKinds` gives, by a move's reaction kind, the reaction word a hit from behind
 * takes. Knockback steps (by their place in the stream, the ones reached) and a launch's arc steps
 * are halfwords a frame; `launches` the airborne moves a launch takes, with the height each reaches.
 */
export interface ReactionTables {
  readonly rows: ReadonlyMap<number, readonly number[]>;
  readonly list: Int16Array;
  readonly ball: readonly number[];
  readonly backKinds: readonly number[];
  /** By a move's reaction kind, the reach beyond which its hit glances. */
  readonly backReach: readonly number[];
  readonly knockback: ReadonlyMap<number, number>;
  readonly arcSteps: Int16Array;
  readonly launches: readonly { readonly height: number; readonly move: number }[];
}

/** Where a fighter's reaction lies: a row, a place in the list, or the ball's. */
export const ReactionSource = { ROWS: 0, LIST: 1, BALL: 2 } as const;
export interface ReactionRef {
  readonly source: number;
  readonly index: number;
}

/** The halfwords of a reaction, by what they hold. */
export const Reaction = {
  FRONT: 0,
  COUNTER: 2,
  SIDE: 4,
  OTHER_SIDE: 6,
  BACK: 8,
  GUARDED: 10,
  CROUCHING: 12,
  LOW_STATE: 13,
  AWAY: 14,
  KNOCKBACK: 15,
  COUNTER_KNOCKBACK: 17,
  CROUCHING_AWAY: 18,
  CROUCHING_KNOCKBACK: 19,
  GUARD_KNOCKBACK: 20,
} as const;

/** A reaction's halfword `field` (its place among the 21); 0 for a fighter no hit has given one yet. */
export function reactionField(tables: ReactionTables, ref: ReactionRef | null, field: number): number {
  if (ref === null) return 0;
  if (ref.source === ReactionSource.ROWS) {
    const row = tables.rows.get(ref.index);
    if (row === undefined) throw new Error(`reaction row ${ref.index} was not imported`);
    return row[field]!;
  }
  if (ref.source === ReactionSource.LIST) return tables.list[ref.index + field]!;
  return tables.ball[field]!;
}

/** Where a knockback or arc walk is: which stream and how far into it, in halfwords. */
export const StepStream = { KNOCKBACK: 0, ARC: 1 } as const;
export interface StepRef {
  readonly stream: number;
  readonly index: number;
}

/** A halfword of a step stream. */
export function stepAt(tables: ReactionTables, ref: StepRef, ahead = 0): number {
  const index = ref.index + ahead;
  if (ref.stream === StepStream.ARC) return tables.arcSteps[index]!;
  const value = tables.knockback.get(index);
  if (value === undefined) throw new Error(`knockback step ${index} was not imported`);
  return value;
}
