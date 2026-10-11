/**
 * The fighters' hands and eyes. Each hand has a shape: 0 open, 512 a fist and the weights between,
 * 513 on the other hand models. A shape is set with a target and a rate and eased toward each
 * posed frame; a move's events, the body's step (opening on a clean hit, clenching as an attack
 * comes) and the round's start set them.
 *
 * Each posed frame a hand is drawn at a model step: one of four from open to a fist, or one of the
 * other shapes, a replay drawing the steps it recorded. The second hand is drawn on part 12; the
 * first on part 16, or on part 17 for Kuma and Gon.
 *
 * The eyes blink: open for an odd 1 to 255 frames drawn from the game's generator, then shut for
 * four. A move that holds them shut keeps them so; Gon lying under the overhead finishing shot
 * shows his hurt face once and shuts his hand. The presentation draws the hand models and the
 * face's pictures from this state.
 */
import { div, s16 } from '../math/integers.ts';
import { nextRandom } from '../math/random.ts';
import { moveAt } from './moves.ts';
import { replayHandStep } from './replay.ts';
import type { FightData, FightState, Fighter } from './state.ts';

/** Both hands, as a mask (1 the first, 2 the second). */
const BOTH_HANDS = 3;
const FIST = 0x200;
/** Shapes 10 and 11 open and shut the eyes instead. */
const EYES = 10;
const KUMA = 0xb;
const GON = 0x11;
const TRUE_OGRE = 0x14;
/** The parts the hands are drawn on: the second's, and the first's (Kuma's and Gon's their own). */
const SECOND_HAND_PART = 12;
const FIRST_HAND_PART = 16;
const FIRST_PAW_PART = 17;
/** The frames the eyes stay shut in a blink, and while a move holds them. */
const BLINK = 4;
const HELD_SHUT = 2;
const HURT = 4;
/** A move's state bit and its hit flags' bits that hold the eyes shut, and the one that lets them open. */
const SHUT_STATE = 4;
const SHUT_HIT = 0x40000;
const OPEN_HIT = 0x40000000;

/** A model pack's entry in a per-pack table; past the table's 55, 0. */
const byPack = (table: Uint8Array, f: Fighter): number => (f.costume >>> 0 < table.length ? table[f.costume]! : 0);

/**
 * A shape for the hands in the mask, reached over `speed` frames (512 over speed + 1 a frame; 0
 * keeps the rate). A shape off the open-to-fist range, or a hand already off it, is taken at once.
 * Shapes 10 and 11 open and shut the eyes, `speed` then being the frames to the next blink.
 */
export function handShape(f: Fighter, hands: number, shape: number, speed: number): void {
  if (shape >= EYES) {
    const shut = shape - EYES;
    if (shut >= 2) return;
    f.blinkWait = s16(speed);
    f.eyesShut = shut;
    return;
  }
  if (shape >= 8) return;
  if (f.roster === TRUE_OGRE) throw new Error("True Ogre's hands are not remade");
  for (let hand = 0; hand < 2; hand += 1) {
    if (((hand + 1) & hands) === 0) continue;
    const target = shape === 0 ? 0 : shape === 1 ? FIST : shape + FIST - 1;
    if (f.hands.shape[hand]! > FIST || target > FIST) {
      f.hands.shape[hand] = target;
      f.hands.rate[hand] = 0;
    } else if (speed !== 0) {
      f.hands.rate[hand] = div(FIST, speed >= 0 ? speed + 1 : -speed + 1);
    }
    f.hands.target[hand] = target;
  }
}

/** Both hands to the costume's fist. */
export function clench(data: FightData, f: Fighter, speed: number): void {
  handShape(f, BOTH_HANDS, byPack(data.skeleton.hands.fists, f), speed);
}

/** Both hands to the costume's open hand. */
export function release(data: FightData, f: Fighter, speed: number): void {
  handShape(f, BOTH_HANDS, byPack(data.skeleton.hands.open, f), speed);
}

/** The hands at the costume's fist, still; True Ogre's wings and arm at rest. */
export function restHands(state: FightState, data: Pick<FightData, 'skeleton'>, f: Fighter): void {
  const shape = byPack(data.skeleton.hands.fists, f);
  for (let hand = 0; hand < 2; hand += 1) {
    f.hands.target[hand] = shape;
    f.hands.shape[hand] = shape;
    f.hands.rate[hand] = 0;
  }
  f.wingsOut = 0;
  f.trueOgre.wingFrame = 0;
  f.trueOgre.wingState = 0;
  f.trueOgre.arm = 0;
  f.trueOgre.armTarget = 0;
  f.trueOgre.armRate = 0;
  state.lastHandSteps[f.movesetSlot] = 0;
}

/** The model step a hand's shape draws: one of four between open and fist, or the other models from 4. */
function modelStep(shape: number): number {
  if (shape > FIST) return shape - (FIST - 3);
  const step = shape >> 7;
  return step !== 0 ? step - 1 : 0;
}

/** The part a fighter's hand (0 the first, 1 the second) is drawn on. */
export function handPart(roster: number, hand: number): number {
  if (hand !== 0) return SECOND_HAND_PART;
  return roster === KUMA || roster === GON ? FIRST_PAW_PART : FIRST_HAND_PART;
}

/**
 * Unless the fight is frozen or paused, each hand eased toward its target and drawn at its model
 * step (or the replay's); the second hand's own step kept for its side.
 */
export function stepHands(state: FightState, f: Fighter): void {
  if (state.pause.frozen !== 0 || state.pause.paused !== 0) return;
  if (f.roster === TRUE_OGRE) throw new Error("True Ogre's hands and wings are not remade");
  const { shape, target, rate, drawn } = f.hands;
  for (let hand = 0; hand < 2; hand += 1) {
    const to = target[hand]!;
    const from = shape[hand]!;
    if (from < to) {
      shape[hand] = s16(from + rate[hand]!);
      if (!(shape[hand]! < to)) {
        rate[hand] = 0;
        shape[hand] = to;
      }
    } else if (to < from) {
      shape[hand] = s16(from - rate[hand]!);
      if (!(to < shape[hand]!)) {
        rate[hand] = 0;
        shape[hand] = to;
      }
    }
    drawn[hand] = replayHandStep(state, f, hand, modelStep(shape[hand]!));
  }
  state.lastHandSteps[f.movesetSlot] = modelStep(shape[1]!);
}

/** The eyes held shut by the move, or a blink's next step. */
export function blink(state: FightState, data: FightData, f: Fighter): void {
  const gon = f.roster === GON;
  const move = moveAt(data, f.move!);
  let held = false;
  if ((move.hitFlags & SHUT_HIT) !== 0) {
    held = true;
    if (state.overhead !== 0 && gon) {
      handShape(f, 1, 3, 1);
      f.hurtFace = HURT;
    }
  } else if ((move.flags & SHUT_STATE) !== 0 && (move.hitFlags & OPEN_HIT) === 0) {
    held = true;
  }
  if (held) {
    f.blinkWait = HELD_SHUT;
    f.eyesShut = 1;
  }
  if (f.blinkWait === 0) {
    const handFree = gon && state.lastHandSteps[f.movesetSlot] === 0 && f.hands.shape[1] === 0;
    if (f.eyesShut !== 0) {
      if (handFree) {
        handShape(f, 1, 0, 1);
        state.lastHandSteps[f.movesetSlot] = 0;
      }
      f.blinkWait = (nextRandom(state.random) & 0xfe) + 1;
      f.eyesShut = 0;
    } else {
      if (handFree) {
        handShape(f, 1, 3, 1);
        state.lastHandSteps[f.movesetSlot] = 0;
      }
      f.blinkWait = BLINK;
      f.eyesShut = 1;
    }
  }
  f.blinkWait = s16(f.blinkWait - 1);
}
