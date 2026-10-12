/**
 * Posing the fighters each frame: the skeletons' camera, the flash's fade and each fighter's hit
 * flash, then per fighter its size, the move's channels at its frame, the root's correction after a
 * move that slid, the blend between moves, the replay's records, the root's place, the hands eased
 * and the eyes' blink (`hands.ts`), the skeleton, and where the hips land on screen (which the side
 * each fighter stands on and the camera read).
 *
 * Each accessory swings on its spring as its joint is placed (`accessories.ts`).
 *
 * True Ogre's joints 5, 6, 18 and 19 are each placed by another's local (18's, 5's, 19's and 6's),
 * turned to a beat a quarter turn apart from the next: a beat that moves on each frame, sways as
 * much as joint 6 stands high (to 512 mm), and leans as his elbow bends; his arm's stretch
 * (`hands.ts`) quiets the beat and lengthens them, and shortens the last.
 *
 * The rest of the original's pose is drawing only: the light matrix, the back colour, the stage's
 * light; the presentation makes those. Not remade, as in the current port: the head turning to the
 * opponent.
 */
import { angle4096, sine } from '../math/angles.ts';
import { div, s16, s8 } from '../math/integers.ts';
import { copyMatrix, multiply, type Matrix } from '../math/matrix.ts';
import { projectPoint } from '../math/projection.ts';
import { tableRoot } from '../math/roots.ts';
import { FIRST_ACCESSORY, swingAccessory } from './accessories.ts';
import { blink, stepHands, trueOgreArm } from './hands.ts';
import { sampleMotion } from './motion.ts';
import { motionOf, moveAt, moveById, sameMove } from './moves.ts';
import { recordMove, replayAngles, replayMove, replayRoot } from './replay.ts';
import { blendLocals, cosineOf, eulerRotation, localRotations, placeJoint, rootRotation, sineOf } from './skeleton.ts';
import { Mode, type FightData, type FightState, type Fighter } from './state.ts';

/** The joint the hips are; the screen's x of its origin is where the fighter stands on screen. */
const HIPS = 11;
/** True Ogre's roster id: his skeleton beats. */
const TRUE_OGRE = 0x14;
/** His joints that beat: the local each is placed by, and its phase in quarter turns. */
const BEATING: ReadonlyMap<number, readonly [number, number]> = new Map([
  [5, [0x12, 0]],
  [6, [5, 1]],
  [0x12, [0x13, 2]],
  [0x13, [6, 3]],
]);
/** The first of them, where the beat moves on; the one his arm's stretch shortens; the one whose height sways it. */
const FIRST_BEATING = 5;
const SHORTENED = 0x13;
const SWAYING = 6;
/** The most the beat sways; his arm stretched; a quarter turn in 4096ths. */
const FULL_SWAY = 0x100;
const STRETCHED = 0x100;
const QUARTER = 0x400;
/** Blend kinds: none, out of the last move, toward the next, toward the move that follows. */
export const Blend = { NONE: 0, OUT: 1, NEXT: 2, FOLLOWER: 3 } as const;

/** The skeletons' camera: the view, or looking straight down, the view levelled and lifted. */
export function skeletonCamera(state: FightState): void {
  const camera = state.skeletonCamera;
  if (state.overhead === 0) {
    copyMatrix(state.view, camera);
    return;
  }
  const level = [0x1000, 0, 0, 0, 0x1000, 0, 0, 0, 0x1000];
  camera.translation[0] = state.view.translation[0]!;
  camera.translation[1] = state.view.translation[1]!;
  camera.translation[2] = (state.view.translation[2]! - 0xa3a) | 0;
  multiply(state.view.rotation, level, camera.rotation);
}

/** A flash fades; its pull ends with it. */
export function fadeFlash(state: FightState): void {
  const flash = state.flash;
  if (flash.left > 0) {
    flash.left -= 1;
    if (flash.left < 1) flash.pull.fill(0);
  }
}

/** A flash's pull on a fighter: toward the flash, weaker with distance. */
function flashPull(state: FightState, data: FightData, f: Fighter): void {
  const flash = state.flash;
  if (!(flash.left > 0)) return;
  const at = f.skeleton.base.translation;
  let x = (at[0]! - flash.at[0]!) | 0;
  let y = (at[1]! - flash.at[1]!) | 0;
  let z = (at[2]! - flash.at[2]!) | 0;
  const d = tableRoot((Math.imul(x, x) + Math.imul(y, y) + Math.imul(z, z)) | 0, data.math);
  if (d !== 0) {
    const k = (Math.imul((0x4000000 / d) | 0, flash.left) / 0x30) | 0;
    const scale = (v: number): number => {
      const m = Math.imul(v, k);
      return (m < 0 ? m + 0x3fff : m) >> 14;
    };
    x = scale(x);
    y = scale(y);
    z = scale(z);
  }
  flash.pull[0] = s16(-x);
  flash.pull[1] = s16(-y);
  flash.pull[2] = s16(-z);
}

/** A hit's flash on a fighter's colour counts up to 32 (outside practice's own colours). */
function hitFlash(state: FightState, f: Fighter): void {
  if (state.mode === Mode.PRACTICE) throw new Error("practice mode's colours are not remade");
  const slot = f.movesetSlot;
  const flash = state.hitFlash[slot]!;
  if (flash === 0) return;
  state.hitFlash[slot] = ((flash + 1) & 0xff) > 0x20 ? 0 : (flash + 1) & 0xff;
}

/** The fighter's size: its own, or while held in a throw, its thrower's. */
function chooseSize(state: FightState, f: Fighter): void {
  f.currentSize = f.throwHold < 0 ? state.fighters[f.partnerSlot]!.size : f.size;
}

/** The root's sampled position scaled by the fighter's size. */
function scaleBySize(f: Fighter, v: number[]): void {
  for (let i = 0; i < 3; i += 1) v[i] = s16((v[i]! * f.currentSize) >> 12);
}

/**
 * After a move that ends where its motion left the root, the position becomes the root's place
 * less the root's offset at the pose's frame, so the next move starts there.
 */
function correctRoot(data: FightData, f: Fighter): void {
  if (s8(f.rootCorrection) === 0) return;
  let frame = f.rootFrame - f.rootLag - 1;
  f.rootCorrection = 0;
  if (frame < 0) frame = 0;
  const root = new Int16Array(3);
  sampleMotion(motionOf(data, f.rootMove!), frame, data.curves, root, 3);
  const scaled = [root[0]!, root[1]!, root[2]!];
  scaleBySize(f, scaled);
  const turn = (0x8000 - f.facing) & 0xffff;
  const s = sineOf(data.math, turn);
  const c = cosineOf(data.math, turn);
  const q = (v: number): number => (v < 0 ? v + 0xfff : v) >> 12;
  const [x, , z] = scaled;
  f.position[0] = (f.skeleton.base.translation[0]! - q(x! * c - z! * s)) | 0;
  f.position[2] = (f.skeleton.base.translation[2]! - q(x! * s + z! * c)) | 0;
}

/* ---- The blend between moves. ---- */

/** No blend into this move: its own flag, a hit's freeze, a throw's hold. */
const noBlendIn = (data: FightData, f: Fighter): boolean => ((moveAt(data, f.move!).hitFlags >>> 8) & 1) !== 0 || f.hitFreeze !== 0 || (f.holds[0]! | f.holds[1]!) !== 0;

/** No blend out of this move. */
const noBlendOut = (data: FightData, f: Fighter): boolean =>
  ((moveAt(data, f.move!).hitFlags >>> 8) & 2) !== 0 || f.blendOutBlocked !== 0 || f.next.noBlend !== 0 || f.stunned !== 0 || (f.inAir !== 0 && f.beingHit !== 0);

/** The length of a blend from the last move into a new one: up to its active window, or 4 (16 held in a throw). */
function blendInLength(data: FightData, f: Fighter): number {
  if (sameMove(f.blend.lastMove, f.move) && f.transition !== 3) return 0;
  if (f.moveStarted === 0) return 0;
  const move = moveAt(data, f.move!);
  const frame = f.frame;
  let left = move.length - frame;
  if (left < 0) left = 0;
  let length = 0;
  if (left !== 0) {
    const window = move.activeWindow.first;
    if (window !== 0 && frame < window) {
      length = window - frame;
      if (length > 0x10) length = 0x10;
    } else length = f.throwHold < 0 ? 0x10 : 4;
  }
  if (left < length) length = left;
  return length < 2 ? 0 : length;
}

/** A blend toward the next move, until the frame it starts on. */
function blendToNext(f: Fighter): number {
  if (f.next.move === null) return 0;
  if (!(f.frame < f.next.startFrame) || f.transition === 3) return 0;
  const length = f.next.startFrame - f.frame + 1;
  return length < 0 ? 0 : length;
}

/** A blend toward the move that follows, over a move's last 16 frames. */
function blendToFollower(data: FightData, f: Fighter): number {
  if (f.next.move !== null) return 0;
  const left = moveAt(data, f.move!).length - f.frame;
  if (!(left < 0x10)) return 0;
  let length = left + 1;
  if (f.rootLag < 1) length = f.frame;
  return length < 2 ? 0 : length;
}

/** The frame a transition starts its target on, for the types that keep it. */
function startFrame(type: number, frame: number): number {
  return [2, 0x12, 0x13, 0x14, 0x15, 0x16, 0x19, 0x1a, 0x1d, 0x2c].includes(s16(type)) ? s16(frame) : 0;
}

/** A move's root at a frame, scaled by the fighter's size. */
function rootAt(data: FightData, f: Fighter, ref: Fighter['move'], frame: number): number[] {
  const root = new Int16Array(3);
  sampleMotion(motionOf(data, ref!), frame, data.curves, root, 3);
  const v = [root[0]!, root[1]!, root[2]!];
  scaleBySize(f, v);
  return v;
}

/** A move's local rotations at a frame, into one of the blend's working poses. */
function localsAt(data: FightData, ref: Fighter['move'], frame: number, locals: readonly Matrix[]): void {
  const channels = new Int16Array(49);
  sampleMotion(motionOf(data, ref!), frame, data.curves, channels);
  localRotations(data.math, data.skeleton, channels, locals);
}

/** The blend's start: which two poses, and their differences per joint. */
function prepareBlend(state: FightState, data: FightData, f: Fighter, length: number): void {
  const blend = f.blend;
  const live = state.replaying === 0;
  if (blend.kind === Blend.NEXT) {
    if (live) {
      blend.from = f.move;
      blend.fromFrame = f.next.startFrame & 0xff;
      blend.to = moveById(data, f, f.next.id);
      blend.toFrame = startFrame(f.next.type, f.next.startFrame) & 0xff;
      blend.length = length;
    }
    blend.position = 0;
  } else if (blend.kind === Blend.FOLLOWER) {
    if (live) {
      const move = moveAt(data, f.move!);
      blend.from = f.move;
      blend.fromFrame = f.rootLag < 1 ? 0 : move.length & 0xff;
      blend.to = moveById(data, f, move.next);
      blend.toFrame = 0;
      blend.length = length;
    }
    blend.position = 0;
  } else if (blend.kind === Blend.OUT) {
    if (live) {
      blend.position = length - 1;
      blend.length = length;
      blend.from = blend.lastMove;
      blend.fromFrame = (f.lastFrame - 1) & 0xff;
      blend.to = f.move;
      blend.toFrame = (f.frame - 1) & 0xff;
    } else blend.position = blend.length - 1;
  }
  const kind = blend.kind;
  if (kind === Blend.OUT) {
    const to = rootAt(data, f, blend.to, blend.toFrame);
    for (let i = 0; i < 3; i += 1) blend.rootDelta[i] = s16(blend.root[i]! - to[i]!);
    const target = state.blendWork.to;
    localsAt(data, blend.to, blend.toFrame, target);
    for (let j = 1; j < 0x12; j += 1) {
      for (let k = 0; k < 9; k += 1) f.skeleton.deltas[j - 1]![k] = s16(f.skeleton.blended[j - 1]!.rotation[k]! - target[j]!.rotation[k]!);
    }
  } else if (kind > 0 && kind < 4) {
    const from = rootAt(data, f, blend.from, blend.fromFrame);
    const to = rootAt(data, f, blend.to, blend.toFrame);
    for (let i = 0; i < 3; i += 1) blend.rootDelta[i] = s16(to[i]! - from[i]!);
    const fromLocals = state.blendWork.from;
    const toLocals = state.blendWork.to;
    localsAt(data, blend.from, blend.fromFrame, fromLocals);
    localsAt(data, blend.to, blend.toFrame, toLocals);
    for (let j = 1; j < 0x12; j += 1) {
      for (let k = 0; k < 9; k += 1) f.skeleton.deltas[j - 1]![k] = s16(toLocals[j]!.rotation[k]! - fromLocals[j]!.rotation[k]!);
    }
  }
}

/** The blend's step: out of the last move it counts down; toward a move it counts up to its length. */
function stepBlend(f: Fighter): void {
  const blend = f.blend;
  if (blend.kind === Blend.OUT) {
    if (blend.position > 0) blend.position -= 1;
    else if (blend.position < 0) blend.position = 0;
  } else if (blend.kind === Blend.NONE) {
    blend.position = 0;
    blend.length = 0;
  } else if (blend.kind === Blend.NEXT || blend.kind === Blend.FOLLOWER) {
    if (blend.position < blend.length) blend.position += 1;
    else if (blend.length < blend.position) blend.position = blend.length;
  }
}

/** Decides and prepares the blend between moves, or steps the one running. */
function blendPose(state: FightState, data: FightData, f: Fighter): void {
  const blend = f.blend;
  if (state.pause.paused === 0 && state.pause.frozen === 0) {
    let started = false;
    if (state.noBlendFrames === 0) {
      let length = 0;
      if (state.replaying === 0) {
        blend.started = 0;
        let decideOut = true;
        if (!noBlendIn(data, f)) {
          if (blend.kind === Blend.OUT && blend.position === 0) blend.kind = Blend.NONE;
          length = blendInLength(data, f);
          if (length !== 0) {
            blend.started = 1;
            blend.kind = Blend.OUT;
          }
          if (blend.kind === Blend.OUT) decideOut = false;
        } else if (blend.kind === Blend.OUT) blend.kind = Blend.NONE;
        if (decideOut) {
          if (!noBlendOut(data, f)) {
            if (blend.kind === Blend.NEXT && blend.position === blend.length) blend.kind = Blend.NONE;
            if (blend.kind === Blend.FOLLOWER && (blend.position === blend.length || f.moveStarted !== 0)) blend.kind = Blend.NONE;
            if (blend.kind === Blend.NONE) {
              length = blendToNext(f);
              let kind: number = Blend.NEXT;
              if (length === 0) {
                length = blendToFollower(data, f);
                kind = Blend.FOLLOWER;
              }
              if (length !== 0) {
                blend.kind = kind;
                blend.started = 1;
              }
            }
          } else if (blend.kind === Blend.NEXT || blend.kind === Blend.FOLLOWER) blend.kind = Blend.NONE;
        }
      }
      if (blend.started !== 0) {
        prepareBlend(state, data, f, length);
        started = true;
      }
    } else {
      state.noBlendFrames -= 1;
      blend.kind = Blend.NONE;
      started = blend.started !== 0;
    }
    if (!started) stepBlend(f);
  }
  blend.lastMove = f.move;
  blend.lastFrame = f.frame;
  blend.root[1] = state.channels.root[1]!;
}

/* ---- The root and the skeleton. ---- */

/**
 * The root's base matrix: its rotation the fighter's lean and heading; its translation the position
 * plus the motion's root offset turned by the facing (only its height while airborne, none while
 * thrown about), which is where the motion's travel has put the root. While moves blend, the root's
 * height eases from the last move's.
 */
function placeRoot(state: FightState, data: FightData, f: Fighter, startReplayCamera: (state: FightState) => void): void {
  const angles = [s16(-f.tilt.x), s16(f.heading - 0x8000), s16(-f.tilt.z)];
  replayAngles(state, f, angles);
  if (state.replaying !== 0) f.heading = s16(angles[1]! - 0x8000);
  const base = f.skeleton.base;
  rootRotation(data.math, angles[0]!, angles[1]!, angles[2]!, base.rotation);
  let rise = f.rootOffset[1]!;
  const x = f.rootOffset[0]!;
  const z = f.rootOffset[2]!;
  const blend = f.blend;
  if (blend.kind === Blend.NONE || blend.length === 0) blend.weight = 0x1000;
  else {
    blend.weight = s16(((blend.position << 12) / blend.length) | 0);
    let lift = blend.rootDelta[1]! * blend.weight * 2;
    if (lift < 0) lift += 0x1fff;
    rise = s16((lift >> 13) + rise);
  }
  blend.root[1] = rise;
  base.translation[0] = f.position[0]!;
  base.translation[1] = f.position[1]!;
  base.translation[2] = f.position[2]!;
  if (s8(f.airborne) === 0) {
    const turn = (0x8000 - f.facing) & 0xffff;
    let dx = x * cosineOf(data.math, turn) - z * sineOf(data.math, turn);
    if (dx < 0) dx += 0xfff;
    base.translation[0] = (base.translation[0]! + (dx >> 12)) | 0;
    base.translation[1] = (base.translation[1]! + rise) | 0;
    let dz = x * sineOf(data.math, turn) + z * cosineOf(data.math, turn);
    if (dz < 0) dz += 0xfff;
    base.translation[2] = (base.translation[2]! + (dz >> 12)) | 0;
  } else if (s8(f.airborne) === 2) base.translation[1] = (base.translation[1]! + rise) | 0;
  replayRoot(state, f, startReplayCamera);
}

/** True Ogre's beat as its first joint sets it each frame: where in the sine its turns about y and z are, and how far it sways. */
interface Beat {
  y: number;
  z: number;
  sway: number;
}

/**
 * The local a joint of True Ogre's is placed by: its own, or for a beating joint another's, which
 * (unless the game is paused) is turned to the beat (its phase on, quieter as his arm stretches,
 * leaning by `lean`) and lengthened as his arm stretches: along its bone by a quarter of the
 * stretch, across it by an eighth; the shortened one shorter along it by the quarter.
 */
function trueOgreLocal(state: FightState, data: FightData, f: Fighter, j: number, lean: number, beat: Beat | null): { local: Matrix; beat: Beat | null } {
  const sk = f.skeleton;
  const beating = BEATING.get(j);
  if (beating === undefined) return { local: sk.locals[j]!, beat };
  const [from, phase] = beating;
  const running = state.pause.requested === 0 && state.pause.paused === 0;
  if (j === FIRST_BEATING) {
    if (running) f.trueOgre.beat = s16(f.trueOgre.beat + 1);
    const sway = div(-sk.joints[SWAYING]!.world.translation[1]!, 2);
    beat = { y: (f.trueOgre.beat & 0x7f) << 5, z: (f.trueOgre.beat & 0x3f) << 6, sway: Math.max(0, Math.min(FULL_SWAY, sway)) };
  }
  const local = sk.locals[from]!;
  if (!running) return { local, beat };
  if (beat === null) throw new Error(`True Ogre's joint ${j} beats before joint ${FIRST_BEATING} set the beat`);
  const arm = trueOgreArm(state, f);
  const swing = div(beat.sway * (STRETCHED - arm), 0x100);
  const y = s16(div(sine(data.math, beat.y + phase * QUARTER) * swing, 0x200));
  const z = s16(div(sine(data.math, beat.z + phase * QUARTER) * swing, 0x100) + lean);
  const m = local.rotation;
  eulerRotation(data.math, 0, y, z, m);
  const across = div(arm, 8) + 0x100;
  let along = div(arm, 4) + 0x100;
  if (j === SHORTENED) along = 0x200 - along;
  for (const row of [0, 3, 6]) {
    m[row] = s16(div(m[row]! * along, 0x100));
    m[row + 1] = s16(div(m[row + 1]! * across, 0x100));
    m[row + 2] = s16(div(m[row + 2]! * across, 0x100));
  }
  return { local, beat };
}

/** Every joint's world and camera-space matrix; while the game runs, the locals from this frame's channels, blended while a blend runs. */
function buildSkeleton(state: FightState, data: FightData, f: Fighter): void {
  const sk = f.skeleton;
  copyMatrix(sk.base, sk.root);
  if (state.pause.requested === 0 && state.pause.paused === 0) {
    localRotations(data.math, data.skeleton, state.channels.all, sk.locals);
    if (f.blend.kind !== Blend.NONE) blendLocals(data.skeleton, sk.locals, sk.deltas, f.blend.weight);
    for (let j = 1; j < 0x12; j += 1) copyMatrix(sk.locals[j]!, sk.blended[j - 1]!);
  }
  const trueOgre = f.roster === TRUE_OGRE;
  /* His beat leans as his forearm turns: the angle of its local's first row. */
  const elbow = sk.locals[FIRST_BEATING]!.rotation;
  const lean = trueOgre ? s16(angle4096(elbow[0]!, elbow[1]!, data.math) * -4) : 0;
  let beat: Beat | null = null;
  f.trailCount = 0;
  for (let j = 0; j < 0x16; j += 1) {
    if (f.parts[j]!.hung === 0) continue;
    const joint = sk.joints[j]!;
    if (joint.parent === null) throw new Error(`joint ${j} hangs on no parent`);
    const parent = joint.parent < 0 ? sk.root : sk.joints[joint.parent]!.world;
    if (j >= FIRST_ACCESSORY) swingAccessory(state, data, f, j, parent);
    let local = sk.locals[j]!;
    if (trueOgre) ({ local, beat } = trueOgreLocal(state, data, f, j, lean, beat));
    placeJoint(parent, local, state.skeletonCamera, joint.world, joint.view);
  }
}

/** Where the hips' origin lands on screen, and how deep. */
function projectHips(state: FightState, data: FightData, f: Fighter): void {
  for (let part = 0; part < 0x16; part += 1) {
    if (data.skeleton.partJoints[part] !== HIPS || f.parts[part]!.drawn === 0) continue;
    const view = f.skeleton.joints[HIPS]!.view;
    const point = projectPoint(state.screen, view.translation[0]!, view.translation[1]!, view.translation[2]!);
    f.screenX = s16(point.x);
    f.screenDepth = point.depth;
  }
}

/** A fighter's pose this frame. */
function poseMove(state: FightState, data: FightData, f: Fighter, startReplayCamera: (state: FightState) => void): void {
  replayMove(state, f);
  chooseSize(state, f);
  const root = new Int16Array(3);
  sampleMotion(motionOf(data, f.rootMove!), f.rootFrame - 1, data.curves, root, 3);
  for (let i = 0; i < 3; i += 1) state.channels.root[i] = root[i]!;
  for (let i = 0; i < 3; i += 1) f.rootOffset[i] = root[i]!;
  scaleBySize(f, f.rootOffset);
  const channels = new Int16Array(49);
  sampleMotion(motionOf(data, f.move!), f.frame - 1, data.curves, channels);
  for (let i = 0; i < 49; i += 1) state.channels.all[i] = channels[i]!;
  correctRoot(data, f);
  if (state.liveFrame !== 0 && state.skipBlend === 0) blendPose(state, data, f);
  state.skipBlend = 0;
  recordMove(state, f);
  placeRoot(state, data, f, startReplayCamera);
  stepHands(state, data, f);
  if (state.attractIntro === 0) blink(state, data, f);
  buildSkeleton(state, data, f);
  if (state.nothingDrawn === 0) projectHips(state, data, f);
}

/**
 * One fighter's light and pose (the round's closing poses the fighters itself). The game also
 * marks Mokujin here when he plays moveset 4; no instruction reads the mark.
 */
export function poseFighter(state: FightState, data: FightData, f: Fighter, startReplayCamera: (state: FightState) => void): void {
  if (state.nothingDrawn === 0) state.posed |= 1 << f.slot;
  flashPull(state, data, f);
  if (f.unlit === 0) hitFlash(state, f);
  poseMove(state, data, f, startReplayCamera);
}

/** The frame's skeleton camera and flash, then each fighter in the fight posed. */
export function poseFighters(state: FightState, data: FightData, startReplayCamera: (state: FightState) => void): void {
  fadeFlash(state);
  skeletonCamera(state);
  if (state.nothingDrawn === 0) state.framesDrawn = (state.framesDrawn + 1) & 0xff;
  const [a, b, c] = state.fighters;
  if (a.present !== 0) poseFighter(state, data, a, startReplayCamera);
  if (b.present !== 0) poseFighter(state, data, b, startReplayCamera);
  if (state.mode === Mode.TEKKEN_FORCE && c.present !== 0) poseFighter(state, data, c, startReplayCamera);
}
