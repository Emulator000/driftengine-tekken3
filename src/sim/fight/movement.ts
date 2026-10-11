/**
 * A fighter's body through one frame: a dash's travel toward the opponent, a stepping move's slide,
 * a launch's arc and its landing, a turn spread over frames, a slide back to where a move pulled it
 * from, knockback and arc steps, the turn the move blends in, and the state flags the rest of the
 * frame reads: in the air, landed (lightly or heavily), the counter-hit window, the attack's
 * segments, the guard. The hands open on a clean hit and clench as an attack comes; a heavy
 * landing raises dust and shakes the camera.
 */
import { div, s16, s8, u16 } from '../math/integers.ts';
import { headingOf } from '../math/angles.ts';
import { isqrt } from '../math/roots.ts';
import { stepAt } from '../data/reactions.ts';
import { landingDust } from '../effects/sparks.ts';
import { cosWide, sinWide } from './body.ts';
import { startShake } from './camera.ts';
import { clench, release } from './hands.ts';
import { face } from './move.ts';
import { hitOf, moveAt } from './moves.ts';
import { Mode, type FightData, type FightState, type Fighter } from './state.ts';
import { shakeVibration } from './vibration.ts';

const GON = 0x11;
/** Ogre's moveset: a fighter frozen by it keeps stepping. */
const OGRE = 0xe;
/** A dash's states. */
const Dash = { NONE: 0, WAITING: 1, MOVING: 2 } as const;
/** The root offset's modes the body sets: rising takes only its height. */
const RISING = 2;
/** The launch kinds that land on the feet, and that shake the camera. */
const LANDS_ON_FEET = 5;
const SHAKES = 1;
/** The camera shakes: a light one for a heavy landing, a heavy one for a launch's. */
const LIGHT_SHAKE = 0;
const HEAVY_SHAKE = 1;
/** Frames a slide back takes. */
const SLIDE_FRAMES = 0x10;
/** The stance a held back and a held down-back give, and the guard bits within a stance. */
const STANDING_GUARD = 0x1052;
const CROUCHING_GUARD = 0x2829;
const GUARD_BITS = 0x18;
/** Pad directions as the history keeps them (numpad, 4 back, 1 down-back). */
const BACK = 4;
const DOWN_BACK = 1;
/** The hands' speed when the body opens or clenches them. */
const HAND_SPEED = 10;

/** A turn held within ±`bound`, as a 16-bit value. */
function limit(value: number, bound: number): number {
  const v = s16(value);
  if (v < 0) return v < -bound ? s16(-bound) : v;
  return bound < v ? s16(bound) : v;
}

/** The part of a turn step that would carry the turn so far past `max`, or 0. */
function overshoot(step: number, sofar: number, max: number): number {
  const done = Math.abs(s16(sofar));
  const s = s16(step);
  if (!(max < done + Math.abs(s))) return 0;
  const room = s16(max - done);
  return s < 0 ? -room : room;
}

/** The turn toward a target this frame: the rest of the gap over the frames to the attack, held within the cap. */
function turnToward(data: FightData, f: Fighter, target: number, cap: number): number {
  let frames = s16(moveAt(data, f.move!).activeWindow.first + 1 - u16(f.frame));
  if (frames < 1) frames = 1;
  return limit(div(s16(target - u16(f.heading)), frames), cap);
}

/** A turn step taken (or the overshoot's room, which ends the turning), and the turning done once the attack starts. */
function finishTurn(data: FightData, f: Fighter, step: number, over: number): void {
  let s = step;
  if (over !== 0) {
    f.turnMode = 6;
    s = over;
  }
  const spin = f.spin;
  f.heading = s16(f.heading + s);
  f.spin = s16(spin + s);
  if (moveAt(data, f.move!).activeWindow.first <= f.frame) f.turnMode = 6;
}

/** A turn that runs out over the rest of the move's lead-in instead. */
function settleTurn(data: FightData, f: Fighter): void {
  const left = moveAt(data, f.move!).activeWindow.first - u16(f.frame);
  f.turnFrames = s16(left);
  if (s16(left) < 1) f.turnFrames = 1;
  const step = div(s16(u16(f.towardTarget) - u16(f.heading)), f.turnFrames);
  f.turnStep = limit(step, 0x9f4);
  f.turnMode = 0xc;
}

/** A turn's cap a frame for a number of degrees, as the 16-bit turn the original works it out to. */
const degreesCap = (degrees: number): number => s16(Math.trunc(((degrees * 0xffff) >>> 0) / 0x168));

/** The turn a move's blend mode applies this frame. */
function blendTurn(state: FightState, data: FightData, f: Fighter, opponent: Fighter): void {
  const move = moveAt(data, f.move!);
  const frame = f.frame;
  const held = opponent.lockFrames !== 0 && s8(f.segmentCount) !== 0;
  switch (f.turnMode) {
    case 0:
      f.heading = s16(f.facing);
      return;
    case 1: {
      let step = turnToward(data, f, u16(f.faceTarget), 0x1555);
      const over = overshoot(step, f.spin, 0x7fff);
      if (over !== 0) {
        f.turnMode = 6;
        step = over;
      }
      const spin = f.spin;
      const turned = s16(f.heading + step);
      f.heading = turned;
      f.facing = turned;
      f.spin = s16(spin + step);
      if (move.activeWindow.first <= frame) f.turnMode = 6;
      return;
    }
    case 2:
    case 3: {
      if (held && f.framesShown < 9) {
        settleTurn(data, f);
        return;
      }
      const degrees = s8(f.inAir) === 0 ? (f.framesShown > 7 ? 0xe : 3) : 1;
      let cap = div(degrees * 0x10000 - degrees, 0x168);
      if (f.turnMode === 3) cap = (cap << 16) >> 17;
      const step = turnToward(data, f, u16(f.towardTarget), s16(cap));
      finishTurn(data, f, step, overshoot(step, f.spin, 0x5555));
      return;
    }
    case 4: {
      if (f.turnFrames !== 0 || held) return;
      const degrees = s8(f.inAir) === 0 ? (f.framesShown > 7 ? 3 : 2) : 1;
      const step = turnToward(data, f, u16(f.towardTarget), degreesCap(degrees));
      finishTurn(data, f, step, overshoot(step, f.spin, 0xe38));
      return;
    }
    case 5: {
      if (held && !(f.framesShown > 8)) {
        settleTurn(data, f);
        return;
      }
      let degrees = 4;
      if (s8(f.inAir) === 0) degrees = f.framesShown > 7 ? 100 : 3;
      const step = turnToward(data, f, u16(f.towardTarget), degreesCap(degrees));
      finishTurn(data, f, step, overshoot(step, f.spin, 0x9554));
      return;
    }
    case 6: {
      if (f.attackDamage === 0 || s8(move.stepWindow.first) === 0 || s8(f.inAir) !== 0 || frame < move.activeWindow.last) {
        const start = move.activeWindow.first;
        if (start < frame && (frame - start) % 5 === 0 && s16(f.facingOffSize) < 0x5556) {
          f.turnFrames = move.length - frame < 6 ? 5 : s16(move.length - frame);
          if (f.turnFrames < 0) f.turnFrames = 0;
          else f.turnStep = limit(div(s16(u16(f.faceTarget) - u16(f.heading)), f.turnFrames), 0x222);
        }
      } else {
        f.turnFrames = 0;
        f.turnStep = 0;
      }
      return;
    }
    case 7: {
      let end = move.stepWindow.last;
      if (end === 0) end = move.length;
      if (frame <= end) {
        if (end === 0) end = 1;
        const turn = limit(div(s16(u16(f.faceTarget) - u16(f.heading)) * frame, end), 0x38e);
        f.heading = s16(f.heading + turn);
      }
      return;
    }
    case 8: {
      const shown = Math.min(f.framesShown, 8);
      if (shown < 9) {
        const turn = limit(div(s16(u16(f.faceTarget) - u16(f.heading)) * shown, 8), 0x71c);
        f.heading = s16(f.heading + turn);
      }
      return;
    }
    case 9: {
      if (!(state.distance > 0x4af)) return;
      const root = f.skeleton.base.translation;
      let toward = headingOf(f.opponentAtStart[1]! - root[2]!, f.opponentAtStart[0]! - root[0]!, data.math);
      let off = (u16(f.facing) - toward) >>> 0;
      if ((off & 0x8000) !== 0) off = ~off;
      if ((off & 0xffff) > 0x3fff) toward -= 0x8000;
      const turn = limit(div(s16(toward - u16(f.facing)) * frame, move.length), 0x5b0);
      const facing = s16(f.facing + turn);
      f.facing = facing;
      f.rootCorrection = 1;
      f.heading = facing;
      return;
    }
    case 10: {
      if (!(frame <= move.length)) return;
      let sway: number;
      if (f.roster === 7 && f.facingQuadrant === 2) sway = s16(f.rootOffset[0]!) < 0 ? 0x71c : -0x71c;
      else sway = s16(f.rootOffset[0]!) < 0 ? -0x11c7 : 0x11c7;
      f.rootCorrection = 1;
      const facing = s16(f.faceTarget + div(sway * frame, move.length));
      f.facing = facing;
      f.heading = facing;
      return;
    }
    default:
      return;
  }
}

/** The guard a move's input takes: holding back stands guard, down-back crouches; a move that blocks takes its own stance. */
function guardStance(data: FightData, f: Fighter): void {
  const move = moveAt(data, f.move!);
  const direction = f.input.history[f.input.cursor]! & 0xf;
  if (((move.hitFlags >>> 8) & 0x40) === 0) {
    if (s8(f.guardMode) === 0) return;
    if (direction === BACK) {
      f.stance = STANDING_GUARD;
    } else if (direction === DOWN_BACK) {
      f.stance = CROUCHING_GUARD;
    } else {
      f.stance = s16(move.flags) >>> 0;
      f.guard = f.stance & GUARD_BITS;
      if ((f.stance & 0x100) !== 0 && s8(f.human) === 0) {
        f.stance = (f.stance & 0xffffffe7) >>> 0;
        f.guard &= 0xffe7;
      }
    }
    return;
  }
  if (s8(f.human) === 0) {
    if (direction === BACK) f.stance = STANDING_GUARD;
    else if (direction === DOWN_BACK) {
      f.stance = CROUCHING_GUARD;
      f.guard = f.stance & GUARD_BITS;
    }
    return;
  }
  if (direction === BACK || direction === BACK + 1) f.stance = STANDING_GUARD;
  else if (direction === DOWN_BACK || direction === DOWN_BACK + 1) {
    f.stance = CROUCHING_GUARD;
    f.guard = f.stance & GUARD_BITS;
  }
}

/** A move of kind 9 counts as airborne from its step window's start. */
function markAirborne(data: FightData, f: Fighter): void {
  if (f.kind !== 9) return;
  const first = moveAt(data, f.move!).stepWindow.first;
  if (s8(first) !== 0 && first <= f.frame) f.stance = (f.stance | 4) >>> 0;
}

/** The dash toward the opponent: waiting for its root move's step window, then crossing it. */
function dash(state: FightState, data: FightData, f: Fighter): void {
  const root = moveAt(data, f.rootMove!);
  if (f.dash.state === Dash.WAITING) {
    if (root.stepWindow.first <= f.frame) {
      let left = root.stepWindow.last - f.frame;
      if (left === 0) left = 1;
      f.dash.state = Dash.MOVING;
      let reach = state.distance - 500;
      if (state.distance > 0xc00) reach = 0xa0c;
      const step = s16(div(reach, left));
      f.dash.x = div(step * sinWide(data, f.towardTarget), 0x7fff);
      f.airborne = RISING;
      f.dash.z = div(step * cosWide(data, f.towardTarget), 0x7fff);
    }
  } else if (f.dash.state === Dash.MOVING) {
    f.position[2] = (f.position[2]! + f.dash.z) | 0;
    f.position[0] = (f.position[0]! + f.dash.x) | 0;
    if (root.stepWindow.last <= f.frame) {
      f.dash.state = Dash.NONE;
      f.dash.x = 0;
      f.dash.z = 0;
      f.position[0] = f.skeleton.base.translation[0]!;
      f.position[2] = f.skeleton.base.translation[2]!;
    }
  }
}

/** A stepping move's slide through its step window, carrying the 256ths it could not move yet. */
function slide(state: FightState, data: FightData, f: Fighter): void {
  const move = moveAt(data, f.move!);
  const { first, last } = move.stepWindow;
  if (first === 0 || !(first - 1 <= f.frame && f.frame <= last)) return;
  const speed = move.stepSpeed;
  if (speed === 0) return;
  const rest = state.stepRemainders;
  const slot = f.slot;
  const x0 = f.position[0]!;
  const z0 = f.position[2]!;
  rest.x[slot] = (rest.x[slot]! + div(speed * sinWide(data, f.facing), 0x7fff)) | 0;
  rest.z[slot] = (rest.z[slot]! + div(speed * cosWide(data, f.facing), 0x7fff)) | 0;
  f.position[0] = (f.position[0]! - (rest.x[slot]! >> 8)) | 0;
  f.position[2] = (f.position[2]! - (rest.z[slot]! >> 8)) | 0;
  rest.x[slot] = (rest.x[slot]! + Math.imul(f.position[0]! - x0, 0x100)) | 0;
  rest.z[slot] = (rest.z[slot]! + Math.imul(f.position[2]! - z0, 0x100)) | 0;
}

/** A launch's arc: rising and falling, drifting back from the target, and the landing that ends it. */
function arc(state: FightState, data: FightData, f: Fighter): void {
  const rise = s16(f.arc[1]! + 6);
  f.arc[1] = rise;
  f.position[1] = (f.position[1]! + rise) | 0;
  f.position[0] = (f.position[0]! + f.arc[0]!) | 0;
  f.position[2] = (f.position[2]! + f.arc[2]!) | 0;
  f.arc[0] = s16(div(f.launchWeight * sinWide(data, f.towardTarget + 0x8000), 0x7fff));
  f.arc[2] = s16(div(f.launchWeight * cosWide(data, f.towardTarget + 0x8000), 0x7fff));
  if (f.arc[1]! > 0 && -f.launchHeight <= f.position[1]!) {
    if (f.launchKind === SHAKES) {
      startShake(state, HEAVY_SHAKE);
      shakeVibration(state, HEAVY_SHAKE);
    }
    const root = f.skeleton.base.translation;
    f.position[2] = root[2]!;
    f.position[1] = 0;
    f.position[0] = root[0]!;
    if (f.launchKind === LANDS_ON_FEET) f.landedLightly = 1;
    else f.landedHeavily = 1;
    f.inArc = 0;
    f.airborne = RISING;
  }
}

/** A slide back to where the move pulled it from: its angle and speed over sixteen frames, starting from the far end. */
function slideBack(data: FightData, f: Fighter): void {
  f.slideTo = 0;
  const root = f.skeleton.base.translation;
  const dz = (root[2]! - f.pullFrom[1]!) | 0;
  const dx = (root[0]! - f.pullFrom[0]!) | 0;
  f.pushAngle = s16(headingOf(dz, dx, data.math));
  f.pushFrames = SLIDE_FRAMES;
  const length = isqrt((Math.imul(dx, dx) + Math.imul(dz, dz)) >>> 0);
  f.pushSpeed = s16(div(length, f.pushFrames));
  f.position[0] = (root[0]! - div(length * sinWide(data, f.pushAngle + 0x8000), 0x7fff)) | 0;
  f.position[2] = (root[2]! - div(length * cosWide(data, f.pushAngle + 0x8000), 0x7fff)) | 0;
}

/** The push this frame: a slide back's speed, a knockback or arc step and the repeats' extra, along the push's angle. */
function push(data: FightData, f: Fighter): void {
  let amount = 0;
  if (f.pushFrames > 0) {
    amount = f.pushSpeed;
    f.pushFrames = s16(f.pushFrames - 1);
  }
  if (f.stepFrames > 0) {
    f.stepFrames = s16(f.stepFrames - 1);
    amount += stepAt(data.reactions, f.steps!);
    f.steps = { stream: f.steps!.stream, index: f.steps!.index + 1 };
    if (f.repeats > 0) amount += f.repeats * 0x28 + 10;
  }
  if (amount !== 0) {
    f.position[0] = (f.position[0]! + div(amount * sinWide(data, f.pushAngle), 0x7fff)) | 0;
    f.position[2] = (f.position[2]! + div(amount * cosWide(data, f.pushAngle), 0x7fff)) | 0;
  }
}

/** The hands: open on a clean hit; otherwise, unless a move set them, a fist as an attack or the round starts. */
function hands(state: FightState, data: FightData, f: Fighter): void {
  if (s8(f.hitClean) !== 0) {
    release(data, f, HAND_SPEED);
    return;
  }
  if (s8(f.handShaped) !== 0) return;
  const flow = state.round.flow;
  if (s8(f.moveStarted) !== 0 && f.attackDamage === 0 && s8(f.holds[1]!) === 0 && flow - 1 >= 0 && flow - 1 < 2) clench(data, f, HAND_SPEED);
  if (f.attackDamage !== 0 && moveAt(data, f.move!).activeWindow.first - f.frame < 8) clench(data, f, HAND_SPEED);
}

/** One frame of a fighter's body. */
export function moveBody(state: FightState, data: FightData, f: Fighter, opponent: Fighter): void {
  f.landedLightly = 0;
  f.landedHeavily = 0;
  f.counterWindow = 0;
  face(data, f, opponent);
  dash(state, data, f);
  if (f.inArc === 0 || (f.frozen !== 0 && opponent.character === OGRE)) slide(state, data, f);
  else arc(state, data, f);
  if (f.roster === GON && s8(f.holds[1]!) !== 0 && f.stunned === 0) {
    if (s8(f.inAir) === 0) f.position[1] = 0;
    else if (f.skeleton.base.translation[1]! + 0x80 < 0) f.position[1] = (f.skeleton.base.translation[1]! + 0x80) >> 1;
  }
  if (state.mode === Mode.TEKKEN_BALL) throw new Error("Tekken Ball's movement is not remade");
  if (s8(f.inAir) === 0) f.launched = 0;
  if (f.turnFrames !== 0) {
    f.turnFrames = s16(f.turnFrames - 1);
    const turned = s16(f.heading + f.turnStep);
    f.heading = turned;
    if (f.throwHold === 1) f.facing = turned;
  }
  if (s8(f.slideTo) === 1) slideBack(data, f);
  push(data, f);
  blendTurn(state, data, f, opponent);
  if (f.lockFrames > 0) f.lockFrames = s16(f.lockFrames - 1);
  if (f.untouchable > 0) f.untouchable = s16(f.untouchable - 1);
  const move = moveAt(data, f.move!);
  if (f.frame < move.activeWindow.first || move.activeWindow.last < f.frame) f.attackSegments = 0;
  else {
    const hit = hitOf(data, f.move!);
    if (hit === null) throw new Error('a move without hit data inside its active window reads its hit code from nowhere');
    f.attackSegments = s8(hit.codes[2]!) === 0 ? 1 : 2;
  }
  f.effectHit = 0;
  if (state.mode === Mode.TEKKEN_FORCE) throw new Error("Tekken Force's body rules are not remade");
  f.inAir = f.stunned === 0 && !(move.stepWindow.first <= f.frame && f.frame <= move.stepWindow.last) ? 0 : 1;
  if (u16(f.frame) === move.stepWindow.last && f.loops === -1 && u16(f.frame) !== 1 && s8(f.airborne) !== RISING) {
    if (s8(f.beingHit) === 0 || f.launchKind === LANDS_ON_FEET || (s8(f.kind) !== 9 && (f.stance & 4) === 0)) f.landedLightly = 1;
    else f.landedHeavily = 1;
  }
  const stunLeft = f.stunFrames - 1;
  if (f.stunFrames !== 0) {
    f.stunFrames = s16(stunLeft) < 0 ? 0 : s16(stunLeft);
    if (s8(f.hitClean) !== 0) f.stunFrames = 0;
  }
  if (f.stunFrames < 0x1f && f.mash !== 0) {
    f.mash = s16(f.mash - 1);
    const input = f.input.history[f.input.cursor]!;
    const mashed = (input & 0x20) !== 0 ? 3 : (input & 0xf0) !== 0 ? 1 : 0;
    const left = s16(u16(f.mash) - mashed);
    f.mash = left < 0 ? 0 : left;
  }
  if (f.attackDamage !== 0) {
    let from = move.activeWindow.first - 3;
    if (from < 0) from = 1;
    if (from <= f.frame && f.frame <= move.activeWindow.first) f.counterWindow = 1;
  }
  if (((move.hitFlags >>> 8) & 4) !== 0) f.counterWindow = 1;
  if (f.roster === GON && opponent.roster !== GON) f.counterWindow = 1;
  guardStance(data, f);
  if (s8(f.inAir) === 0 && s16(f.facingOffSize) < 0x4000) f.guard = f.stance & GUARD_BITS;
  else f.guard = 0;
  markAirborne(data, f);
  hands(state, data, f);
  f.wingsOut = s8(f.holds[1]!) === 0 && s8(f.inAir) !== 0 ? 1 : 0;
  let clearRecovery = false;
  if (s8(f.hitClean) === 0 && s8(opponent.hitClean) === 0) {
    if (f.recovery !== 0) {
      const left = f.recovery - 1;
      f.recovery = s16(left);
      f.guard &= 0xffe7;
      if (s16(left) < 0) clearRecovery = true;
    }
  } else {
    clearRecovery = true;
  }
  if (clearRecovery) f.recovery = 0;
  if (s8(f.inAir) !== 0) f.repeatWindow = 0;
  if (f.repeatWindow < 1) f.repeatWindow = 0;
  else f.repeatWindow = s16(f.repeatWindow - 1);
  if (f.repeatWindow === 0) f.repeats = 0;
  if (s8(f.present) !== 0 && s8(f.landedHeavily) !== 0) {
    landingDust(state, data, f);
    startShake(state, LIGHT_SHAKE);
    shakeVibration(state, LIGHT_SHAKE);
  }
}
