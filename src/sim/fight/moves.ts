/** Moves as a fighter holds them: by the slot their moveset lies in, with their motion and their place in the bound id table. */
import type { Motion } from '../data/motion.ts';
import type { HitData, Move } from '../data/moveset.ts';
import type { FightData, Fighter, MoveRef } from './state.ts';

/** The common moveset's slot. */
export const COMMON = 2;

export function moveAt(data: FightData, ref: MoveRef): Move {
  const set = data.sets[ref.set];
  if (set == null) throw new Error(`no moveset in slot ${ref.set}`);
  return set.moveset.moves[ref.index]!;
}

/** A move's hit data, or none. */
export function hitOf(data: FightData, ref: MoveRef): HitData | null {
  const hit = moveAt(data, ref).hit;
  if (hit === null) return null;
  if ('shared' in hit) return data.sharedHits[hit.shared]!;
  return data.sets[ref.set]!.moveset.hitTables[hit.table]!;
}

/** A move's motion: its own moveset's, or the common one's. */
export function motionOf(data: FightData, ref: MoveRef): Motion {
  const move = moveAt(data, ref);
  const set = move.motion.common ? data.sets[COMMON] : data.sets[ref.set];
  return set!.motions[move.motion.index]!;
}

/** The move a fighter plays for a move id, through the ids as bound for its moveset slot (a missing id takes the opponent's move). */
export function moveById(data: FightData, f: Fighter, id: number): MoveRef | null {
  if (id < 0 || id >= 4023) throw new Error(`move id ${id} is outside the id table`);
  return data.moveIds[f.movesetSlot]![id] ?? null;
}

export const sameMove = (a: MoveRef | null, b: MoveRef | null): boolean => (a === null ? b === null : b !== null && a.set === b.set && a.index === b.index);
