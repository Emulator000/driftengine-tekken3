/**
 * A move's events: entries of a frame and a code with its argument, each run once as the move's
 * frame passes it. Sparks at a joint (the fighter's own, its opponent's, or a guard's), the hands'
 * shapes, camera shakes, landing dust, and the health a move gives or takes itself.
 */
import { guardSpark, landingDust, sparkAt, type SparkAt } from '../effects/sparks.ts';
import { startShake } from './camera.ts';
import { handShape } from './hands.ts';
import { moveAt } from './moves.ts';
import type { FightData, FightState, Fighter } from './state.ts';
import { shakeVibration, sparkVibration } from './vibration.ts';

/** The codes: a spark at a joint (6 to 10), a hand shape (0x0e to 0x3d), a shake (1 to 3), dust (4), health (0x0b to 0x0d). */
const Code = { OWN_SPARK: 6, THEIR_SPARK: 7, GUARD_SPARKS: 8, SPARKS_END: 0xb, HANDS: 0xe, HANDS_END: 0x3e, OPEN: 0x14, FIST: 0x15, DUST: 4, HEALTH: 0xb, HEALTH_END: 0xe } as const;
/** A guard spark's code by the event: 8 a move's own 0, 9 its 1, 10 its 3. */
const GUARD_CODES = [0, 1, 3];
const NO_DIRECTION = [0, 0, 0];

/** A move event's spark at the joint the argument names. */
const jointAt = (f: Fighter, joint: number): SparkAt => ({ point: [...f.skeleton.joints[joint]!.world.translation], direction: NO_DIRECTION });

/** Every event of the fighter's move whose frame came since the last frame seen; the event health is cleared first. */
export function moveEvents(state: FightState, data: FightData, f: Fighter): void {
  f.eventHealth = 0;
  const first = moveAt(data, f.move!).events;
  if (f.present === 0 || first < 0) return;
  const events = data.sets[f.move!.set]!.moveset.events;
  for (let k = first; events[k]!.frame !== 0; k += 1) {
    const { frame, code, arg } = events[k]!;
    if (f.frame < frame || frame <= f.lastFrame) continue;
    if (code >= Code.OWN_SPARK && code < Code.SPARKS_END) {
      const at = jointAt(f, arg);
      if (code === Code.OWN_SPARK) {
        sparkAt(state, data, f.slot, at, 0);
        sparkVibration(state, f.slot, 1);
      } else if (code === Code.THEIR_SPARK) sparkAt(state, data, f.opponent, at, 0);
      else guardSpark(state, data, GUARD_CODES[code - Code.GUARD_SPARKS]!, at);
      continue;
    }
    if (code >= Code.HANDS && code < Code.HANDS_END) {
      f.handShaped = 1;
      const n = code - Code.HANDS;
      const hands = n >> 4 || 3;
      if (code === Code.OPEN) handShape(f, hands, 0, arg);
      else if (code === Code.FIST) handShape(f, hands, f.costume >>> 0 < data.skeleton.hands.fists.length ? data.skeleton.hands.fists[f.costume]! : 0, arg);
      else handShape(f, hands, n & 7, arg);
      continue;
    }
    if (code >= 1 && code <= 3) {
      startShake(state, code - 1);
      shakeVibration(state, code - 1);
    } else if (code === Code.DUST) {
      landingDust(state, data, f);
      sparkVibration(state, f.movesetSlot, 2);
    }
    else if (code >= Code.HEALTH && code < Code.HEALTH_END) {
      f.eventHealth = code - (Code.HEALTH - 1);
      f.eventAmount = arg;
    }
  }
}
