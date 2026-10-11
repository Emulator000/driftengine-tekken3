/**
 * A character's moveset: its moves, and the motion each plays. A move's first word is its motion's
 * offset from the moveset's motion base, or, at `0x40000000` and above, from the common moveset's
 * every character shares.
 */
import { readMotion, type Motion } from './motion.ts';

const MOVE_BYTES = 0x38;
const SHARED = 0x40000000;

export interface Moveset {
  readonly view: DataView;
  readonly moveCount: number;
  readonly movesAt: number;
  readonly motionBase: number;
}

export function readMoveset(buffer: ArrayBuffer): Moveset {
  const view = new DataView(buffer);
  return {
    view,
    moveCount: view.getInt16(2, true),
    movesAt: view.getUint32(8, true),
    motionBase: view.getUint32(0x1c, true),
  };
}

/** The motion move `index` plays, from its own moveset or the common one. */
export function motionOfMove(moveset: Moveset, common: Moveset, index: number): { motion: Motion; shared: boolean } {
  const word = moveset.view.getUint32(moveset.movesAt + index * MOVE_BYTES, true);
  if (word >= SHARED) return { motion: readMotion(common.view, common.motionBase + (word - SHARED)), shared: true };
  return { motion: readMotion(moveset.view, moveset.motionBase + word), shared: false };
}
