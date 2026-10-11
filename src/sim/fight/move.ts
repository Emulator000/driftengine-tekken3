/**
 * Moves: starting the one chosen for this frame, or advancing the one playing, and what that leans
 * on: which way each fighter faces the other, how a launch's arc is planned, and the moves the round
 * itself forces.
 *
 * The transition type says how a move starts: from frame 1 or carrying the frame on, how the pose
 * turns while it blends in (`turnMode`), which way the fighter faces, and whether the motion's travel
 * so far (the root's place) becomes the fighter's position.
 */
import { Reaction, reactionField, StepStream } from '../data/reactions.ts';
import { headingOf, quadrant } from '../math/angles.ts';
import { div, divu, s16, s8 } from '../math/integers.ts';
import { isqrt } from '../math/roots.ts';
import { nextRandom } from '../math/random.ts';
import { advanceBuffer, closeBuffer, openBuffer } from './input.ts';
import { hitOf, moveAt, moveById } from './moves.ts';
import { Mode, type FightData, type FightState, type Fighter, type MoveRef } from './state.ts';

const flagsOf = (data: FightData, ref: MoveRef): number => moveAt(data, ref).hitFlags >>> 8;
const lengthOf = (data: FightData, ref: MoveRef): number => moveAt(data, ref).length;

/** The motion's travel so far becomes the fighter's position. */
function commitTravel(f: Fighter): void {
  f.position[0] = f.skeleton.base.translation[0]!;
  f.position[2] = f.skeleton.base.translation[2]!;
}

function fromFirstFrame(f: Fighter): void {
  f.frame = 1;
  f.rootFrame = 1;
}

/** Whether the next move starts inside its own blend window. */
function blendsMidway(data: FightData, f: Fighter): boolean {
  const move = moveAt(data, f.next.move!);
  if (move.activeWindow.first === 0) return false;
  if (!(f.next.startFrame + 1 < move.activeWindow.last)) return false;
  return move.activeWindow.last <= move.length;
}

/** A cancel's transition type, adjusted for what the target move allows. */
export function transitionType(data: FightData, f: Fighter, type: number): number {
  switch (s16(type - 2)) {
    case 0:
      return blendsMidway(data, f) ? 0x14 : type;
    case 10:
    case 11:
    case 12:
    case 13:
      return moveAt(data, f.next.move!).activeWindow.first !== 0 ? type : 0xb;
    case 14:
      return 0x10;
    case 18:
    case 19:
      return blendsMidway(data, f) ? type : 0xb;
    case 23:
      return blendsMidway(data, f) ? 0x16 : type;
    default:
      return type;
  }
}

/** Whether the next move carries the frame count on from the one playing. */
function carriesFrame(data: FightData, f: Fighter): boolean {
  const move = moveAt(data, f.next.move!);
  if (s8(f.transition) === 3) return false;
  if (move.activeWindow.first === 0) return true;
  if (move.activeWindow.first > move.length) return false;
  return f.frame <= move.activeWindow.last;
}

/** The frame carried on or restarted, held within the new move's length. */
function carryFrame(data: FightData, f: Fighter): void {
  if (!carriesFrame(data, f)) fromFirstFrame(f);
  else {
    f.frame = s16(f.frame + 1);
    f.rootFrame = s16(f.rootFrame + 1);
  }
  const length = lengthOf(data, f.next.move!);
  if (length < f.frame) {
    f.frame = length;
    f.rootFrame = length;
  }
}

/** A hit's lingering stun: half what was left plus the opponent's pressure, at most 0x42. */
function stun(data: FightData, f: Fighter): void {
  let value = 0;
  if ((flagsOf(data, f.move!) & 0x10) === 0) {
    const left = f.mash;
    value = s16(f.pressure + ((left - (left >> 31)) >> 1));
  }
  if (value > 0x41) value = 0x42;
  f.mash = value;
  f.stunFrames = lengthOf(data, f.next.move!);
}

/** Knockback from the stream, starting at its halfword `index`: a pair to start, then a step a frame for eight frames. */
function knockback(data: FightData, f: Fighter, index: number): void {
  f.pushFrames = s16(stepValue(data, StepStream.KNOCKBACK, index));
  f.pushSpeed = s16(stepValue(data, StepStream.KNOCKBACK, index + 1));
  f.steps = { stream: StepStream.KNOCKBACK, index: index + 2 };
  f.stepFrames = 8;
}

function stepValue(data: FightData, stream: number, index: number): number {
  if (stream === StepStream.ARC) return data.reactions.arcSteps[index]!;
  const value = data.reactions.knockback.get(index);
  if (value === undefined) throw new Error(`knockback step ${index} was not imported`);
  return value;
}

/** A turn spread over the new move's opening frames. */
function turnOver(f: Fighter, target: number, frames: number): void {
  f.turnFrames = s16(frames);
  f.turnStep = s16(div(s16(target - f.heading), f.turnFrames));
}

/** The fighter's sound script ended. */
export function endSoundScript(f: Fighter): void {
  f.soundScript = -1;
  f.soundScriptStarted = 0;
  f.soundScriptWord = 0;
  f.soundScriptFrame = 0;
}

/**
 * The angles between two fighters: toward the opponent and back from it, how far this fighter's
 * heading is off the line and that as a quadrant (0 facing the opponent, 2 back turned), the same for
 * the opponent's heading, and from far enough apart, the heading each would settle on.
 */
export function face(data: FightData, f: Fighter, opponent: Fighter): void {
  if (f.sideHeld === 0) {
    const root = f.skeleton.base.translation;
    const theirs = opponent.skeleton.base.translation;
    const toward = headingOf((theirs[2]! - root[2]!) | 0, (theirs[0]! - root[0]!) | 0, data.math);
    f.towardTarget = s16(toward);
    f.awayFromTarget = s16(toward - 0x8000);
    f.theirHeading = opponent.heading;
  } else {
    const fixed = f.heldSide === 0 ? 0x4000 : -0x4000;
    f.awayFromTarget = s16(fixed - 0x8000);
    f.theirHeading = s16(fixed - 0x8000);
    f.towardTarget = s16(fixed);
  }
  const off = s16(f.heading - f.towardTarget);
  f.facingOff = off;
  f.facingQuadrant = quadrant(off);
  const theirs = s16(f.theirHeading - f.awayFromTarget);
  f.theirOff = theirs;
  f.theirQuadrant = quadrant(theirs);
  const a = f.facingOff & 0xffff;
  f.facingOffSize = (a & 0x8000) === 0 ? a : ~a & 0xffff;
  const b = f.theirOff & 0xffff;
  f.theirOffSize = (b & 0x8000) === 0 ? b : ~b & 0xffff;
  if (f.targetDistance >>> 0 > 0x200) {
    f.faceTarget = s16(f.facingOffSize < 0x4000 ? f.towardTarget : f.towardTarget - 0x8000);
    f.theirFaceTarget = s16(f.theirOffSize < 0x4000 ? f.awayFromTarget : f.awayFromTarget - 0x8000);
  }
}

/** Counts a run of the same hit reaction, for juggle and wall decay. */
function countRepeatedHits(data: FightData, f: Fighter): void {
  const type = f.next.type & 0xffff;
  if (type - 0x27 >= 2 && type !== 0x2b) return;
  if (f.repeatWindow === 0) f.repeats = 0;
  else if (f.lastReactionType === type) f.repeats = s16(f.repeats + 1);
  f.lastReactionType = f.next.type & 0xffff;
  f.repeatWindow = s16(lengthOf(data, f.next.move!) + 10);
}

/**
 * A launch's arc: from the hit's height and the fighter's state, the frame of the airborne move to
 * start on and the upward speed that lands it when that move ends.
 */
function planLaunch(state: FightState, data: FightData, f: Fighter): void {
  f.next.startFrame = 1;
  let end = moveAt(data, f.next.move!).endFrame;
  if (end === 0) end = lengthOf(data, f.move!);
  const rootY = f.skeleton.base.translation[1]!;
  const height = f.launchHeight;
  let weight = f.pressure + (f.stunned + 1) * 7 + 10;
  if (f.launchKind === 5) weight += 10;
  f.launchWeight = weight > 100 ? 100 : weight < 0 ? 0 : weight;
  const lift = f.pressure * 4 - ((f.travel[1]! + f.hitTravel[1]!) >> 3) - (f.stunned * 7 - 0x28);
  let speed = lift > 100 ? 100 : lift;
  let square = speed * speed;
  if (lift < -100) {
    speed = -100;
    square = 10000;
  }
  f.arc[1] = s16(-speed);
  square += (height + rootY) * 0xc;
  if (square < 0) square = -square;
  let flight = divu(speed + isqrt(square), 6);
  let back = -flight;
  if (flight === 0) {
    flight = 1;
    back = -1;
  }
  let landing = end + back + 1;
  if (landing < 1) landing = 1;
  let start: number;
  if ((f.stance & 4) === 0 && landing !== 1) {
    flight = flight - 1 + landing;
    start = 1;
  } else if (f.stunned === 0) {
    flight += 10;
    start = end - flight + 1;
    if (start < 1) start = 1;
  } else {
    start = landing;
    if (sameMotionWord(data, f.move!, f.next.move!)) {
      let apart = f.frame - landing;
      if (apart < 0) apart = landing - f.frame;
      if (apart < 10) {
        start = f.frame - 10;
        let shift = -start;
        if (start < 1) {
          start = 1;
          shift = -1;
        }
        flight = flight + landing + shift;
      }
    }
  }
  const frames = (flight + 1) | 0;
  const fall = (frames * frames * 6) >> 1;
  if (speed * frames - fall - rootY < height) f.arc[1] = s16(-div(height + rootY + fall, frames));
  f.steps = { stream: StepStream.ARC, index: 0 };
  f.stepFrames = 8;
  f.next.startFrame = s16(start);
  f.pushAngle = s16(f.towardTarget - 0x8000);
  if (f.launchKind === 1) {
    f.arc[1] = 400;
    f.next.startFrame = 6;
    const rest = lengthOf(data, f.next.move!) - 6;
    f.pushFrames = rest < 0 ? 0 : rest;
    f.pushSpeed = 0x28;
    f.pushAngle = s16(f.towardTarget - 0x8000);
  }
  state.arcFrames[f.slot] = frames;
}

/** Whether two moves play the same motion, as the original compares their first words (where their motion lies). */
function sameMotionWord(data: FightData, a: MoveRef, b: MoveRef): boolean {
  const ma = moveAt(data, a).motion;
  const mb = moveAt(data, b).motion;
  return ma.common === mb.common && ma.index === mb.index && (ma.common || a.set === b.set);
}

/**
 * One frame of a fighter's move. With no move chosen it advances the one playing (holding on a
 * frame, looping a stretch, or running backwards as the move says); with one chosen it starts it.
 */
export function stepMove(state: FightState, data: FightData, f: Fighter, opponent: Fighter): void {
  if (f.present === 0) return;
  const hold = f.hold - 1;
  f.hold = hold < 0 ? 0 : hold;
  let starting = true;
  if (f.next.move === null) starting = false;
  else if (f.rootLag < 1) {
    if (f.rootLag < 0) starting = f.frame <= f.next.startFrame || f.frame < 1;
  } else starting = f.frame < f.next.startFrame ? lengthOf(data, f.move!) <= f.frame : true;
  if (!starting) {
    advance(data, f);
    return;
  }
  begin(state, data, f, opponent);
}

/** The move playing, one frame on. */
function advance(data: FightData, f: Fighter): void {
  const frozen = f.frozen;
  f.framesShown = s16(f.framesShown + 1);
  f.moveStarted = 0;
  if (frozen > 0) {
    f.frozen = s16(frozen - 1);
    if (frozen !== 1) return;
    f.frozen = 0;
    stepOn(f, f.frame);
    return;
  }
  const loops = f.loops;
  const end = moveAt(data, f.move!).endFrame;
  if (loops < 0) {
    if (f.inArc === 0) {
      const frame = s16(f.frame + f.rootLag);
      f.frame = frame < 1 ? 1 : frame;
      f.rootFrame = f.frame;
      return;
    }
    if ((f.frame & 0xffff) === end) return;
    f.frame = s16(f.frame + 1);
    f.rootFrame = f.frame;
    return;
  }
  let shown: number;
  if ((f.frame & 0xffff) === end) {
    if (loops < 1) {
      if (loops !== 0) return;
      stepOn(f, f.frame);
      return;
    }
    shown = f.rootFrame;
    f.loops = s16(f.loops - 1);
  } else {
    shown = f.rootFrame;
    f.frame = s16(f.frame + 1);
  }
  f.rootFrame = s16(shown + 1);
}

function stepOn(f: Fighter, frame: number): void {
  f.frame = s16(frame + 1);
  f.rootFrame = s16(frame + 1);
  f.rootMove = f.move;
}

/** The chosen move, started. */
function begin(state: FightState, data: FightData, f: Fighter, opponent: Fighter): void {
  const next = moveAt(data, f.next.move!);
  if (s8(f.transition) === 3) f.next.startFrame = 1;
  f.prevFrame = f.frame & 0xffff;
  f.prevId = f.moveId;
  f.nextOfNext = next.next & 0xffff;
  f.beingThrown = 0;
  f.airborne = 0;
  f.dash.state = 0;
  f.turnMode = 0;
  f.loops = -1;
  f.opponentAtStart[0] = opponent.skeleton.base.translation[0]!;
  f.rootLag = 1;
  f.spin = 0;
  f.guardMode = 0;
  f.watchingPunchPairs = 0;
  f.handShaped = 0;
  f.hitFreeze = 0;
  f.frozen = 0;
  f.hitSlots.fill(0);
  f.untouchable = 0;
  f.opponentAtStart[1] = opponent.skeleton.base.translation[2]!;
  if (f.reversalDamage === 0) {
    const damage = next.damage | (next.damageFlags << 14);
    f.damageKind = damage >> 14;
    f.attackDamage = s8(f.damageKind) === 1 ? 0 : damage & 0x3fff;
  } else f.attackDamage = s16(f.reversalDamage);
  f.stance = next.flags >>> 0;
  f.level = next.hitLevel & 0xffff;
  f.guard = f.stance & 0x18;
  f.kind = (f.stance >>> 0xb) & 0x1f;
  f.levelHigh = f.level >> 8;
  if (state.mode !== Mode.PRACTICE) f.human = s8(f.computer) === 0 ? 1 : 0;
  if ((f.stance & 0x100) !== 0 && s8(f.human) === 0) {
    f.stance = (f.stance & 0xffffffe7) >>> 0;
    f.guard &= 0xffe7;
  }
  if ((next.hitFlags >>> 8 & 0x20) === 0) {
    f.bufferOpen = 0;
    closeBuffer(f);
  } else {
    f.bufferOpen = 1;
    openBuffer(f);
  }
  advanceBuffer(f);
  f.holds[0] = s8(f.guarded) === 0 ? 0 : 1;
  if (s8(f.hitReacting) === 0) {
    f.beingHit = 0;
    f.inArc = 0;
    f.stunned = 0;
  }
  if (s8(f.struck) === 0) f.hitLanded = 0;

  /* Consecutive moves in a throw or a held state. */
  const playingFlags = flagsOf(data, f.move!);
  const nextFlags = next.hitFlags >>> 8;
  const held = s8(f.hitClean) !== 0 || ((playingFlags & 0x400) !== 0 && (nextFlags & 0x400) !== 0) || (f.throwHold < 0 && (nextFlags & 0x400) !== 0);
  if (held) f.heldMoves = s16(f.heldMoves + 1);
  else if (s8(f.holds[1]!) === 0 && f.throwHold >= 0) f.heldMoves = 0;
  else if ((f.next.type & 0xffff) - 0x1a > 1) {
    if ((f.next.type & 0xffff) === 0x22 || f.next.id === 0xcc6) f.heldMoves = s16(f.heldMoves + 1);
    else if (f.next.id !== 0x9a6) f.heldMoves = 0;
  }
  f.holds[1] = f.hitClean;
  if (s8(f.hitReacting) !== 0 && f.health !== 0) f.frozen = s16(f.freezeOnHit);
  if (s8(f.transition) === 3 || s8(f.transition) === 1 || !sameMotionWord(data, f.next.move!, f.move!)) f.moveStarted = 1;
  const travels = ((moveAt(data, f.move!).hitFlags >>> 0x1c) & 1) !== 0;
  if ((playingFlags & 0x100) !== 0) f.recovery = 0x78;
  if ((nextFlags & 8) !== 0) f.lockFrames = 9;
  if (f.next.turnAround !== 0) {
    f.next.turnAround = 0;
    f.heading = s16(f.heading - 0x8000);
    f.facing = s16(f.facing - 0x8000);
  }
  if (s8(f.turnByMove) !== 0 && f.next.type !== 0x22) {
    const turned = s16(f.heading + moveAt(data, f.move!).facingOffset);
    f.heading = turned;
    f.facing = turned;
  }
  face(data, f, opponent);
  if (transition(state, data, f, opponent, travels) && travels) commitTravel(f);
  finish(data, f);
}

/**
 * The transition type's own setup. Returns whether the shared ending applies, which commits the
 * motion's travel when the move playing asks (`travels`); a type that has already placed the
 * fighter returns false.
 */
function transition(state: FightState, data: FightData, f: Fighter, opponent: Fighter, travels: boolean): boolean {
  const type = f.next.type & 0xffff;
  const next = (): MoveRef => f.next.move!;
  switch (type) {
    case 0:
      fromFirstFrame(f);
      f.throwHold = 0;
      f.rootMove = next();
      f.heading = f.towardTarget;
      f.facing = f.towardTarget;
      commitTravel(f);
      return false;
    case 1:
    case 2:
    case 3:
      if (type === 1) f.facing = f.heading;
      carryFrame(data, f);
      f.turnMode = 0xb;
      f.throwHold = 0;
      settle(f);
      return false;
    case 4:
    case 5: {
      const shown = f.rootFrame + 1;
      f.frame = 1;
      f.rootFrame = s16(shown);
      if (lengthOf(data, f.rootMove!) < s16(shown)) f.rootFrame = lengthOf(data, f.rootMove!);
      if (type === 4) f.turnMode = 0xb;
      f.loops = s16(f.loopCount);
      f.facing = f.heading;
      if (type === 4) {
        if (f.facingOffSize < 0x4fa5) {
          const frames = moveAt(data, next()).activeWindow.first - 1;
          turnOver(f, f.towardTarget, frames < 1 ? 1 : frames);
        }
      } else {
        f.turnMode = f.facingOffSize < 0x4fa4 ? 4 : 6;
        f.turnFrames = 0;
        f.turnStep = 0;
      }
      f.throwHold = 0;
      return false;
    }
    case 6:
    case 7:
      if (type === 6) fromFirstFrame(f);
      f.rootMove = next();
      f.facing = f.heading;
      if (type === 7) {
        f.frame = lengthOf(data, next());
        f.rootFrame = lengthOf(data, next());
      }
      if (travels) commitTravel(f);
      if (type === 7) f.rootLag = -1;
      f.throwHold = 0;
      return false;
    case 8: {
      const frame = f.frame - 1;
      f.frame = s16(frame) < 1 ? 1 : s16(frame);
      f.rootLag = -1;
      f.rootCorrection = 1;
      f.throwHold = 0;
      f.rootFrame = f.frame;
      f.rootMove = next();
      f.facing = f.heading;
      commitTravel(f);
      return false;
    }
    case 9:
      fromFirstFrame(f);
      f.turnMode = 5;
      f.throwHold = 0;
      f.turnFrames = 0;
      f.turnStep = 0;
      f.rootMove = next();
      f.facing = f.faceTarget;
      return true;
    case 10:
    case 11: {
      f.facing = type === 10 ? f.heading : f.faceTarget;
      const move = moveAt(data, next());
      fromFirstFrame(f);
      f.rootMove = next();
      let frames: number;
      if (move.activeWindow.first === 0) frames = lengthOf(data, f.move!) < 0x10 ? lengthOf(data, f.move!) : 0x10;
      else frames = move.activeWindow.first - 1;
      f.turnFrames = s16(frames);
      if (f.turnFrames < 1) f.turnFrames = 1;
      f.faceTarget = s16(f.facingOffSize < 0x4000 ? f.towardTarget : f.towardTarget - 0x8000);
      f.turnStep = s16(div(s16(f.faceTarget - f.heading), f.turnFrames));
      if (travels) commitTravel(f);
      f.turnMode = 0xb;
      f.throwHold = 0;
      return false;
    }
    case 0xc:
    case 0xd:
    case 0xe: {
      fromFirstFrame(f);
      f.rootMove = next();
      if (type !== 0xc) f.facing = f.faceTarget;
      const near = f.facingOffSize < 0x4fa4;
      f.turnMode = near ? { 0xc: 4, 0xd: 3, 0xe: 2 }[type]! : 6;
      f.facing = near ? f.towardTarget : f.faceTarget;
      f.throwHold = 0;
      f.turnFrames = 0;
      f.turnStep = 0;
      return true;
    }
    case 0xf:
      fromFirstFrame(f);
      f.turnMode = 1;
      f.throwHold = 0;
      f.turnFrames = 0;
      f.turnStep = 0;
      f.rootMove = next();
      f.facing = f.faceTarget;
      return true;
    case 0x10:
    case 0x12:
    case 0x13: {
      if (type === 0x10) fromFirstFrame(f);
      else carryFrame(data, f);
      f.turnMode = 0xb;
      f.rootMove = next();
      f.facing = f.towardTarget;
      if (type === 0x13) f.heading = s16(f.heading - 0x8000);
      const frames = moveAt(data, next()).activeWindow.first - 1;
      f.throwHold = 0;
      f.dash.state = 1;
      f.dash.x = 0;
      f.dash.z = 0;
      turnOver(f, f.towardTarget, frames < 1 ? 1 : frames);
      return true;
    }
    case 0x11:
      return false;
    case 0x14:
    case 0x15: {
      carryFrame(data, f);
      f.rootMove = next();
      const near = type === 0x14 ? f.facingOffSize < 0x4fa4 : !(f.facingOffSize > 0x4fa3);
      f.turnMode = near ? (type === 0x14 ? 4 : 2) : 6;
      f.throwHold = 0;
      f.turnFrames = 0;
      f.turnStep = 0;
      f.rootCorrection = 1;
      commitTravel(f);
      return false;
    }
    case 0x16:
    case 0x19:
      if (type === 0x19) f.throwHold = 0;
      carryFrame(data, f);
      f.turnMode = 8;
      if (type === 0x16) {
        f.throwHold = 0;
        f.turnFrames = 0;
        f.turnStep = 0;
      }
      settle(f);
      return false;
    case 0x17:
      fromFirstFrame(f);
      f.rootMove = next();
      f.facing = f.heading;
      if (travels) commitTravel(f);
      f.turnMode = 9;
      f.throwHold = 0;
      return false;
    case 0x18:
      fromFirstFrame(f);
      f.throwHold = 0;
      f.turnMode = 8;
      f.rootMove = next();
      f.facing = f.faceTarget;
      return true;
    case 0x1a:
    case 0x1b:
      f.frame = s16(f.frame + 1);
      f.rootFrame = s16(f.rootFrame + 1);
      if (lengthOf(data, next()) < f.frame) {
        f.frame = lengthOf(data, next());
        f.rootFrame = lengthOf(data, next());
      }
      f.rootMove = next();
      f.facing = f.heading;
      f.guardMode = type === 0x1a ? 1 : 2;
      return false;
    case 0x1c:
      fromFirstFrame(f);
      f.turnMode = 10;
      f.throwHold = 0;
      f.turnFrames = 0;
      f.turnStep = 0;
      f.facing = f.heading;
      f.rootMove = next();
      if (travels) commitTravel(f);
      f.hold = 0x18;
      return false;
    case 0x1d:
      carryFrame(data, f);
      f.turnMode = 10;
      f.throwHold = 0;
      f.turnFrames = 0;
      f.turnStep = 0;
      f.facing = f.heading;
      f.rootMove = next();
      return true;
    case 0x1e:
    case 0x24: {
      if (type === 0x1e) {
        f.launchKind = 5;
        f.launched = 1;
        f.position[1] = f.skeleton.base.translation[1]!;
        const launch = data.reactions.launches[f.launchKind]!;
        f.next.id = launch.move;
        f.launchHeight = launch.height;
      } else {
        f.position[1] = f.skeleton.base.translation[1]!;
        if (f.stunned === 0) f.arc.fill(0);
      }
      planLaunch(state, data, f);
      f.airborne = 1;
      f.inArc = 1;
      f.throwHold = 0;
      f.frame = f.next.startFrame;
      f.rootFrame = f.next.startFrame;
      f.rootMove = next();
      f.stunned = s16(f.stunned + 1);
      stun(data, f);
      f.turnMode = 0xb;
      if ((flagsOf(data, f.move!) & 0x10) === 0) f.facing = f.faceTarget;
      else f.facing = s16(f.faceTarget + reactionField(data.reactions, f.reaction!, Reaction.AWAY));
      f.turnFrames = 0;
      f.turnStep = 0;
      return true;
    }
    case 0x21:
      throwConnects(data, f, opponent);
      return false;
    case 0x22:
      thrownBy(data, f, opponent);
      return false;
    case 0x23:
    case 0x25:
    case 0x26: {
      if (type !== 0x23) stun(data, f);
      knockback(data, f, reactionField(data.reactions, f.reaction!, type === 0x23 ? Reaction.GUARD_KNOCKBACK : type === 0x25 ? Reaction.CROUCHING_KNOCKBACK : Reaction.COUNTER_KNOCKBACK));
      const away = reactionField(data.reactions, f.reaction!, type === 0x25 ? Reaction.CROUCHING_AWAY : Reaction.AWAY);
      fromFirstFrame(f);
      if (type === 0x25) f.mash = 0;
      f.throwHold = 0;
      f.rootMove = next();
      f.pushAngle = s16(f.towardTarget + away - 0x8000);
      f.turnFrames = 0;
      f.turnStep = 0;
      if (type === 0x25) {
        f.turnMode = 0xb;
        f.facing = f.heading;
      } else {
        f.turnMode = 7;
        f.facing = f.faceTarget;
      }
      return true;
    }
    case 0x27:
    case 0x28:
    case 0x29:
    case 0x2a:
    case 0x2b: {
      stun(data, f);
      knockback(data, f, reactionField(data.reactions, f.reaction!, Reaction.KNOCKBACK));
      const from = type === 0x2a ? f.faceTarget : f.towardTarget;
      f.pushAngle = s16(from + reactionField(data.reactions, f.reaction!, Reaction.AWAY) - 0x8000);
      countRepeatedHits(data, f);
      fromFirstFrame(f);
      f.throwHold = 0;
      f.rootMove = next();
      f.turnMode = 0xb;
      f.turnFrames = 0;
      f.turnStep = 0;
      f.facing = f.heading;
      return true;
    }
    default:
      fromFirstFrame(f);
      f.rootMove = next();
      f.facing = f.towardTarget;
      f.heading = f.towardTarget;
      return true;
  }
}

/** The pose takes the next move, and the motion's travel becomes the position. */
function settle(f: Fighter): void {
  f.rootCorrection = 1;
  f.rootMove = f.next.move;
  commitTravel(f);
}

/**
 * A throw connecting: the thrower takes the victim's place, facing by the victim's quadrant (front,
 * side or back throw), since a throw's two motions share one origin.
 */
function throwConnects(data: FightData, f: Fighter, opponent: Fighter): void {
  fromFirstFrame(f);
  f.rootMove = f.next.move;
  const step = f.throwHold;
  if (step === 0) {
    const toward = f.towardTarget;
    let heading = toward - 0x8000;
    const side = f.theirQuadrant;
    if (side === 1) heading = toward - 0x4000;
    else if (side === 2) heading = toward;
    else if (side === 3) heading = toward + 0x4000;
    f.heading = s16(heading);
    f.turnFrames = 0x10;
    f.facing = f.heading;
    f.turnStep = s16(div(s16(opponent.heading - f.heading), 0x10));
    f.position[0] = opponent.skeleton.base.translation[0]!;
    f.position[2] = opponent.skeleton.base.translation[2]!;
  } else if (step < 0 || (flagsOf(data, f.next.move!) & 0x800) !== 0) {
    f.heading = opponent.facing;
    f.facing = opponent.facing;
    f.position[0] = opponent.skeleton.base.translation[0]!;
    f.position[2] = opponent.skeleton.base.translation[2]!;
  }
  f.pushFrames = 0;
  f.pushSpeed = 0;
  f.stepFrames = 0;
  f.throwHold = step < 0 ? 1 : s16(step + 1);
}

/** A throw's victim, turned to the thrower and held for the throw's length. */
function thrownBy(data: FightData, f: Fighter, opponent: Fighter): void {
  const playing = moveAt(data, f.move!);
  if (f.throwHold >= 0) {
    const plain = (s16(playing.damage | (playing.damageFlags << 14)) === 0 || playing.activeWindow.first <= f.frame) && opponent.recovery === 0;
    f.throwPlain = plain ? 0 : 1;
  }
  fromFirstFrame(f);
  f.beingThrown = 1;
  f.rootMove = f.next.move;
  if (f.throwHold < 0) {
    if ((flagsOf(data, f.next.move!) & 0x800) !== 0) {
      f.facing = f.heading;
      commitTravel(f);
    }
  } else {
    const turned = s16(f.heading - 0x8000);
    f.heading = turned;
    f.facing = turned;
    commitTravel(f);
    endSoundScript(f);
  }
  f.throwHold = f.throwHold < 1 ? s16(f.throwHold - 1) : -1;
  const theirs = moveAt(data, opponent.next.move!);
  const mine = lengthOf(data, f.next.move!);
  if (s8(theirs.endFrame) === 0) {
    const longer = theirs.length - mine;
    let hold = longer < 1 ? theirs.length : mine + longer;
    f.stunFrames = s16(hold);
    hold = f.stunFrames;
    if (hold < 0) {
      f.stunFrames = 0;
      hold = 0;
    }
    if (hold > 300) f.stunFrames = 300;
  } else f.stunFrames = s16(theirs.endFrame + mine);
  const pressure = div(s16(theirs.damage | (theirs.damageFlags << 14)) * 0x20, 0x2d) + 0x22;
  f.mash = s16(pressure) > 0x41 ? 0x42 : s16(pressure);
  if (f.mash < 0x23) f.mash = 0x22;
  f.pushFrames = 0;
  f.pushSpeed = 0;
  f.stepFrames = 0;
}

/** The shared ending: the chosen move becomes the move playing. */
function finish(data: FightData, f: Fighter): void {
  const ref = f.next.move!;
  const move = moveAt(data, ref);
  const id = f.next.id & 0xffff;
  f.next.move = null;
  f.move = ref;
  f.next.id = -1;
  f.moveId = id;
  let segments = 0;
  if (s8(move.activeWindow.first) !== 0) {
    const hit = hitOf(data, ref)!;
    if (s8(hit.codes[2]!) !== 0) segments = 2;
    else if (s8(hit.codes[0]!) !== 0) segments = 1;
  }
  f.segmentCount = segments;
  f.framesShown = s8(f.moveStarted) === 0 ? f.frame & 0xffff : 1;
  const type = f.next.type & 0xffff;
  f.next.type = 0;
  f.next.turnAround = 0;
  f.next.noBlend = 0;
  f.turnByMove = 0;
  f.lastType = type;
  f.throwing = f.throwHold !== 0 ? 1 : 0;
  if (f.character === 0x13 && f.frame === 1 && s8(move.stepWindow.first) !== 1) f.position[1] = 0;
}

/* ---- Moves the round forces, and the throw's victim. ---- */

function force(data: FightData, f: Fighter, id: number, type: number, setPlaying: boolean): void {
  f.next.id = s16(id);
  const move = moveById(data, f, f.next.id);
  if (setPlaying) {
    f.move = move;
    f.rootMove = move;
  }
  f.next.move = move;
  f.frame = 1;
  f.next.startFrame = 1;
  f.next.type = transitionType(data, f, type);
  f.next.turnAround = 0;
  f.next.noBlend = 0;
}

/**
 * The stance a round starts in. The first round of a match picks an entrance by the raw pad (square
 * or triangle skips it, cross or circle or chance plays the long one).
 */
export function startRound(state: FightState, data: FightData, f: Fighter, opponent: Fighter): void {
  const pad = state.input.rawPads[f.slot === 0 ? 0 : 1]!;
  const firstRound = state.round.number === 1;
  let id = 1;
  if (firstRound && state.mode !== 7) {
    if ((pad & 0x90) !== 0) id = 0;
    else {
      id = 2;
      if ((pad & 0x44) === 0 && (nextRandom(state.random) & 1) !== 0) id = 0;
    }
  }
  force(data, f, id, 0, true);
  let frame = 1;
  /* A moveset that lacks the stance and whose missing ids are not shared (the attract intro's) leaves the side still until its script moves it. */
  if (f.move !== null) {
    if (firstRound && lengthOf(data, f.move) > 0x96) frame = lengthOf(data, f.move) - 0x95;
    stepMove(state, data, f, opponent);
  }
  f.rootFrame = frame;
  f.frame = frame;
}

/** A winner's pose, by the button held (left punch, right punch, left kick, right kick). */
export function winPose(state: FightState, data: FightData, f: Fighter, opponent: Fighter, choice: number): void {
  const pad = state.input.rawPads[f.slot === 0 ? 0 : 1]!;
  let pick = choice;
  if ((pad & 0x20) !== 0) pick = 3;
  if ((pad & 0x40) !== 0) pick = 2;
  if ((pad & 0x10) !== 0) pick = 1;
  pick = s16(pick);
  if ((pad & 0x80) !== 0) pick = 0;
  const ids = [0xd67, 0xd68, 0xd69, 0xd6a];
  if (pick >= 0 && pick <= 3) f.next.id = ids[pick]!;
  if (f.costume === 0x26 && f.next.id === 0xd67) {
    const r = (state.vsyncSeen >>> 0) % 3;
    f.next.id = r === 1 ? 0xd69 : r === 0 ? 0xd68 : 0xd6a;
  }
  force(data, f, f.next.id, 6, true);
  f.position[1] = 0;
  stepMove(state, data, f, opponent);
}

/** The poses a round's end forces. */
export function endPose(state: FightState, data: FightData, f: Fighter, opponent: Fighter, id: 0xd6c | 0xd65): void {
  force(data, f, id, 6, true);
  stepMove(state, data, f, opponent);
}

/** Knocked out, into the fall. */
export function knockOut(state: FightState, data: FightData, f: Fighter, opponent: Fighter): void {
  force(data, f, 0xd66, 6, false);
  f.guarded = 0;
  f.hitClean = 1;
  f.guard = 0;
  stepMove(state, data, f, opponent);
}

/** A throw's victim takes the reaction the thrower's move names: a row, or a place in the list. */
function takeThrow(data: FightData, f: Fighter, thrower: Fighter): void {
  const reaction = moveAt(data, thrower.next.move!).throwReaction;
  const ref = (reaction & 0xf000) === 0 ? { source: 0, index: reaction } : { source: 1, index: reaction & 0xfff };
  const id = reactionField(data.reactions, ref, Reaction.FRONT);
  f.next.id = id;
  f.next.move = moveById(data, f, id);
  f.frame = 1;
  f.next.startFrame = 1;
  f.next.type = transitionType(data, f, 0x22);
  f.next.turnAround = thrower.next.turnAround;
  thrower.next.turnAround = 0;
  f.next.noBlend = 0;
}

/**
 * Each fighter's move started or advanced. A throw that has connected (type 0x21 at its start frame)
 * goes first, and its victim takes the reaction before either steps.
 */
export function stepMoves(state: FightState, data: FightData): void {
  const fighters = state.fighters;
  const count = state.mode === Mode.TEKKEN_FORCE ? 3 : 2;
  const throws: Fighter[] = [];
  for (let i = 0; i < count; i += 1) {
    const f = fighters[i]!;
    if (f.next.move !== null && f.next.startFrame <= f.frame && f.next.type === 0x21) throws.push(f);
  }
  let first: number;
  let second: number;
  let third = 0;
  if (throws.length === 0) {
    first = 0;
    second = 1;
    third = 2;
  } else {
    const thrower = throws[(state.frameCount >>> 0) % throws.length]!;
    first = thrower.partnerSlot;
    second = thrower.slot;
    third = 3 - (first + second);
  }
  const a = fighters[first]!;
  const b = fighters[second]!;
  if (throws.length === 0) stepMove(state, data, a, fighters[a.opponent]!);
  else {
    takeThrow(data, a, fighters[a.partnerSlot]!);
    stepMove(state, data, a, fighters[a.partnerSlot]!);
  }
  stepMove(state, data, b, fighters[throws.length === 0 ? b.opponent : b.partnerSlot]!);
  if (state.mode === Mode.TEKKEN_FORCE) {
    const c = fighters[third]!;
    stepMove(state, data, c, fighters[c.opponent]!);
  }
}

