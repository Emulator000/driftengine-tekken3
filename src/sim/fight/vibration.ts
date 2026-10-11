/**
 * The pads' vibration the fight asks for: a pattern on a pad, or on both. A camera shake shakes
 * both pads; a move's own spark shakes the mover's pad and answers on the other; and each frame,
 * each fighter's pad feels what happened to it while the side that caused it feels an answer.
 * Nothing is asked for while a replay plays. The presentation plays the patterns on the gamepads.
 */
import { moveAt } from './moves.ts';
import { Mode, type FightData, type FightState } from './state.ts';

/** A vibration pattern started on a pad (0 or 1), or on both (2). */
export interface VibrationCommand {
  readonly pad: number;
  readonly pattern: number;
}

const BOTH = 2;

function quiet(state: FightState): boolean {
  if (state.mode === Mode.TEKKEN_BALL) throw new Error("Tekken Ball's rally is not remade");
  return state.replaying !== 0;
}

/** The pad a slot plays on: its fighter's side. */
function padOf(state: FightState, slot: number): number {
  if (state.mode === Mode.TEKKEN_FORCE) throw new Error("Tekken Force's pads are not remade");
  return state.fighters[slot]!.movesetSlot;
}

const vibrate = (state: FightState, pad: number, pattern: number): void => void state.vibrations.push({ pad, pattern });

/** A camera shake (0 light, 1 heavy, 2 the heaviest) on both pads. */
export function shakeVibration(state: FightState, kind: number): void {
  if (quiet(state)) return;
  vibrate(state, BOTH, kind + 1);
}

/** A spark's patterns by its kind, on the slot's pad; kinds 0 and 1 answer on the other pad. */
const SPARK_PATTERNS: readonly (readonly [number, number | null])[] = [
  [23, 10],
  [15, 27],
  [25, null],
  [12, null],
  [13, null],
  [5, null],
];

/** A move's own spark (kind 1 from a move's event). */
export function sparkVibration(state: FightState, slot: number, kind: number): void {
  if (quiet(state)) return;
  const pad = padOf(state, slot & 0xff);
  const patterns = SPARK_PATTERNS[kind & 0xff];
  if (patterns === undefined) return;
  vibrate(state, pad, patterns[0]);
  if (patterns[1] !== null) vibrate(state, (pad + 1) & 1, patterns[1]);
}

/** What a fighter's frame did to the side that caused it, as bits, and the patterns they play there, in order. */
const Felt = { BLOCKED: 0x01, LIGHT: 0x02, HEAVY: 0x04, FROM_BEHIND: 0x08, COUNTER: 0x10, OWN_DAMAGE: 0x20, CHARGE: 0x40, KNOCKOUT: 0x80 } as const;
const ANSWERS: readonly (readonly [number, number])[] = [
  [Felt.CHARGE, 26],
  [Felt.BLOCKED, 4],
  [Felt.LIGHT, 5],
  [Felt.HEAVY, 6],
  [Felt.FROM_BEHIND, 8],
  [Felt.COUNTER, 9],
  [Felt.OWN_DAMAGE, 7],
  [Felt.KNOCKOUT, 11],
];
/** A clean hit's pressure below this is a light one. */
const HEAVY_PRESSURE = 21;
/** A move whose hit flags carry this charges: its start shakes the other side. */
const CHARGING = 0x10000;

/**
 * Each fighter's pad feels its frame: a block, a clean hit (light or heavy, from behind, a
 * counter), its own damage, a heavy landing, a knockout, a charging move started. The side that
 * caused each feels its answer after. A knockout with no clean hit or own damage this frame marks
 * no side (the original's list one word short).
 */
export function hitVibration(state: FightState, data: FightData): void {
  if (quiet(state)) return;
  const count = state.mode === Mode.TEKKEN_FORCE ? 3 : 2;
  const felt = [0, 0, 0];
  const mark = (side: number, bit: number): void => {
    if (side >= 3) throw new Error(`a fight vibration marked side ${side}, past the list`);
    if (side >= 0) felt[side]! |= bit;
  };
  for (let slot = 0; slot < count; slot += 1) {
    const f = state.fighters[slot]!;
    const pad = padOf(state, slot);
    const by = f.struckBySlot;
    let cause = -1;
    if (f.guarded !== 0) {
      vibrate(state, pad, 16);
      mark(by, Felt.BLOCKED);
    }
    if (f.hitClean !== 0) {
      cause = by;
      if (f.pressure < HEAVY_PRESSURE) {
        vibrate(state, pad, 17);
        mark(cause, Felt.LIGHT);
      } else {
        vibrate(state, pad, 18);
        mark(cause, Felt.HEAVY);
      }
      if (f.fromBehind !== 0) {
        vibrate(state, pad, 20);
        mark(by, Felt.FROM_BEHIND);
      }
      if (f.counterHit !== 0) {
        vibrate(state, pad, 21);
        mark(by, Felt.COUNTER);
      }
    }
    if (f.ownDamage > 0) {
      vibrate(state, pad, 19);
      cause = f.partnerSlot;
      mark(cause, Felt.OWN_DAMAGE);
    }
    if (f.landedHeavily !== 0) vibrate(state, pad, 24);
    if (f.knockedOut !== 0) {
      vibrate(state, pad, 22);
      mark(cause, Felt.KNOCKOUT);
    }
    if ((moveAt(data, f.move!).hitFlags & CHARGING) !== 0 && f.moveStarted !== 0) {
      vibrate(state, pad, 14);
      mark((f.movesetSlot + 1) & 1, Felt.CHARGE);
    }
  }
  for (let side = 0; side < 2; side += 1) {
    const pad = padOf(state, side);
    for (const [bit, pattern] of ANSWERS) if ((felt[side]! & bit) !== 0) vibrate(state, pad, pattern);
  }
}
