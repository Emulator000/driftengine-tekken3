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
 * True Ogre has one hand, drawn on part 19, its shape 0 or 256 (half a fist); a shape of 2 or 3
 * stretches his arm (`pose.ts`) and any other lets it back, at the same pace as the hand. His
 * wings open while he is off the ground and not held, then beat, and fold once he is down again;
 * each frame of theirs is a step of the wings' model.
 *
 * The eyes blink: open for an odd 1 to 255 frames drawn from the game's generator, then shut for
 * four. A move that holds them shut keeps them so; Gon lying under the overhead finishing shot
 * shows his hurt face once and shuts his hand. The presentation draws the hand models and the
 * face's pictures from this state.
 */
import { div, s16 } from '../math/integers.ts';
import { nextRandom } from '../math/random.ts';
import { moveAt } from './moves.ts';
import { replayArm, replayHandStep, replayWingStep } from './replay.ts';
import type { FightData, FightState, Fighter } from './state.ts';

/** Both hands, as a mask (1 the first, 2 the second). */
const BOTH_HANDS = 3;
const FIST = 0x200;
/** Shapes 10 and 11 open and shut the eyes instead. */
const EYES = 10;
const KUMA = 0xb;
const GON = 0x11;
const TRUE_OGRE = 0x14;
/** The parts the hands are drawn on: the second's, and the first's (Kuma's and Gon's their own, True Ogre's his only one). */
const SECOND_HAND_PART = 12;
const FIRST_HAND_PART = 16;
const FIRST_PAW_PART = 17;
const TRUE_OGRE_HAND_PART = 19;
const WINGS_PART = 1;
/** True Ogre's arm stretched, and his hand at half a fist (shape 2's): both 256. */
const STRETCHED = 0x100;
/** A wing frame past its table's end. */
const WINGS_END = -1;
/** The beat's end, when the wings fold again: the opening's frame they fold from. */
const FOLDING = 0x10;
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
  if (f.roster === TRUE_OGRE) {
    trueOgreShape(f, shape, speed);
    return;
  }
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

/**
 * True Ogre's hand and arm, whatever the hands asked: shape 2 the hand at half a fist and the arm
 * stretched, 3 the hand open and the arm stretched, any other both let back; over `speed` frames
 * (256 over speed + 1 a frame, at least one frame), the arm moving only if it has the way to go.
 */
function trueOgreShape(f: Fighter, shape: number, speed: number): void {
  const pace = speed === 0 ? 1 : speed;
  const rate = s16(div(STRETCHED, pace < 0 ? 1 - pace : pace + 1));
  const ogre = f.trueOgre;
  ogre.armRate = 0;
  const stretch = shape === 2 || shape === 3;
  ogre.armTarget = stretch ? STRETCHED : 0;
  if (stretch ? ogre.arm < STRETCHED : 0 < ogre.arm) ogre.armRate = rate;
  f.hands.target[0] = shape === 2 ? STRETCHED : 0;
  f.hands.rate[0] = rate;
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

/** The part a fighter's hand (0 the first, 1 the second) is drawn on; True Ogre's second, none (-1). */
export function handPart(roster: number, hand: number): number {
  if (roster === TRUE_OGRE) return hand === 0 ? TRUE_OGRE_HAND_PART : -1;
  if (hand !== 0) return SECOND_HAND_PART;
  return roster === KUMA || roster === GON ? FIRST_PAW_PART : FIRST_HAND_PART;
}

/** The part a fighter's wings are drawn on (True Ogre's chest), or none (-1). */
export const wingsPart = (roster: number): number => (roster === TRUE_OGRE ? WINGS_PART : -1);

/** A shape eased toward its target by its rate, the rate stopped on arrival; the shape it reaches. */
function ease(shape: number, target: number, rate: number): { shape: number; rate: number } {
  if (shape < target) {
    const next = s16(shape + rate);
    return next < target ? { shape: next, rate } : { shape: target, rate: 0 };
  }
  if (target < shape) {
    const next = s16(shape - rate);
    return target < next ? { shape: next, rate } : { shape: target, rate: 0 };
  }
  return { shape, rate };
}

/**
 * True Ogre's wings a frame on: while out they open (two frames a field) and then beat, one frame
 * a field (the beat's first step two); once in they finish the beat and fold back a frame a field.
 * Then his hand and his arm eased; the wings' step and the hand's drawn (or the replay's).
 */
function stepTrueOgre(state: FightState, data: Pick<FightData, 'skeleton'>, f: Fighter): void {
  const ogre = f.trueOgre;
  const { opening, beating } = data.skeleton.wings;
  if (ogre.wingState === 0) {
    if (f.wingsOut === 0) {
      if (ogre.wingFrame !== 0) ogre.wingFrame -= 1;
    } else {
      ogre.wingFrame = (ogre.wingFrame + 2) & 0xff;
      if (opening[ogre.wingFrame] === WINGS_END) {
        ogre.wingState = 1;
        ogre.wingFrame = 0;
        ogre.wingStart = 1;
      }
    }
  } else if (ogre.wingState === 1) {
    const step = ogre.wingStart !== 0 ? 2 : 1;
    ogre.wingStart = 0;
    ogre.wingFrame = (ogre.wingFrame + step) & 0xff;
    if (beating[ogre.wingFrame] === WINGS_END) {
      ogre.wingFrame = f.wingsOut === 0 ? FOLDING : 0;
      if (f.wingsOut === 0) ogre.wingState = 0;
    }
  }
  const wings = ogre.wingState === 0 ? opening : beating;
  ogre.wingDrawn = replayWingStep(state, f, wings[ogre.wingFrame]! & 0xff);
  const hand = ease(f.hands.shape[0]!, f.hands.target[0]!, f.hands.rate[0]!);
  f.hands.shape[0] = hand.shape;
  f.hands.rate[0] = hand.rate;
  const arm = ease(ogre.arm, ogre.armTarget, ogre.armRate);
  ogre.arm = arm.shape;
  ogre.armRate = arm.rate;
  const step = s16(f.hands.shape[0]!) >> 7;
  f.hands.drawn[0] = replayHandStep(state, f, 0, step !== 0 ? step - 1 : 0);
}

/** True Ogre's arm's shape as the skeleton stretches it (the replay's while one plays). */
export const trueOgreArm = (state: FightState, f: Fighter): number => replayArm(state, f, f.trueOgre.arm);

/**
 * Unless the fight is frozen or paused, each hand eased toward its target and drawn at its model
 * step (or the replay's); the second hand's own step kept for its side.
 */
export function stepHands(state: FightState, data: Pick<FightData, 'skeleton'>, f: Fighter): void {
  if (state.pause.frozen !== 0 || state.pause.paused !== 0) return;
  if (f.roster === TRUE_OGRE) {
    stepTrueOgre(state, data, f);
    return;
  }
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
  } else if ((move.flags & SHUT_STATE) !== 0 && ((move.hitFlags & OPEN_HIT) === 0 || state.posingChange !== 0)) {
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
