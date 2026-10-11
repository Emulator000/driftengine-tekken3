/**
 * Hit sparks and dust. A spark plays a sheet of frames, one a frame, at a point in the world
 * drifting along the blow's direction and slowing, turned to face the camera; a heavy blow's flash
 * lights the fighters in the spark's colour. Three slots take sparks in turn. Kinds 0 and 1 are
 * the two fighters' own sheets (a heavy blow's), kind 3 the generic ones: 0 a hit, 1 and 2 guards,
 * 3 dust. A spark whose code has bit 7 is one of the effect pool's bursts instead.
 *
 * Dust rises where a fighter lands: three clouds taken in turn, each starting six puffs around the
 * landing, one every other frame.
 *
 * Both are recorded for the replay: a ring of 300 frames, each its first event and count in a ring
 * of 64 events, which the replay plays again.
 */
import type { SparkLook } from '../data/effects.ts';
import { div, s16 } from '../math/integers.ts';
import { tableRoot } from '../math/roots.ts';
import { hitOf } from '../fight/moves.ts';
import type { FightData, Fighter, FightState, HitRecord, Spark } from '../fight/state.ts';
import { burnFighter, directionAngles, spawnBurst } from './pool.ts';

/** Where a spark starts: a point, and a direction (or, for a burst, its climb, heading and damage). */
export interface SparkAt {
  readonly point: readonly number[];
  readonly direction: readonly number[];
}

const FRAMES = 300;
const EVENTS = 64;
/** The highest a spark's or puff's point may be (in 128ths of a millimetre, y down): a little above the floor. */
const LOWEST = -32000;

/** The row of the characters' sparks a fighter's kind plays: its roster's, or in the attract intro the scene's own. */
export const sparkRow = (state: FightState, data: FightData, kind: number): number =>
  state.attractIntro !== 0 ? data.effects.introSparks[kind]! : data.roster.rowOf(state.fighters[kind]!.roster);

/** A spark kind's and code's look: the fighters' own (kind 2 the third's), or the generic ones (code 2 plays guard 1's). */
function lookOf(state: FightState, data: FightData, kind: number, code: number): SparkLook {
  if (kind < 3) {
    if (kind === 2) throw new Error("a third fighter's spark is Tekken Force's, not remade");
    return data.effects.characterSparks[sparkRow(state, data, kind)]!;
  }
  return data.effects.genericSparks[code === 2 ? 1 : code]!;
}

/** A slot set to play a sheet from its start: its row (the kind's), its frames, added unless it is dust. */
function startSheet(state: FightState, data: FightData, slot: Spark, kind: number, code: number): void {
  slot.sheet = { row: kind < 2 ? kind : kind - 1, code };
  slot.last = lookOf(state, data, kind, code).frames;
  slot.added = kind === 3 && code === 3 ? 0 : 1;
}

/** The flash's light at a point, in a colour of three bytes (a spark's, the charged glow's). */
export function flashAt(state: FightState, point: readonly number[], colour: readonly number[]): void {
  for (let i = 0; i < 3; i += 1) {
    state.flash.at[i] = point[i]!;
    state.flash.colour[i] = colour[i]! << 4;
  }
  state.flash.left = 0x30;
}

/** The flash's light at a spark's point, in its colour. */
const flash = (state: FightState, at: SparkAt, look: SparkLook): void => flashAt(state, at.point, look.colour);

/**
 * A spark of `kind` and `code` at `at`, drifting along its direction unless `still`. A code with
 * bit 7 is a burst of the effect pool.
 */
export function spark(state: FightState, data: FightData, kind: number, code: number, at: SparkAt, still: number): void {
  if ((code & 0x80) !== 0) {
    spawnBurst(state, data, code & 0x7f, { point: at.point, climb: at.direction[0]! & 0xffff, heading: at.direction[1]! & 0xffff }, kind);
    return;
  }
  const sparks = state.sparks;
  const index = sparks.next;
  sparks.next = s16(index + 1);
  if (2 < sparks.next) sparks.next = 0;
  const slot = sparks.slots[index]!;
  startSheet(state, data, slot, kind, code);
  slot.frame = 1;
  if (kind < 3) flash(state, at, lookOf(state, data, kind, code));
  for (let i = 0; i < 3; i += 1) slot.position[i] = (at.point[i]! << 7) | 0;
  const [dx, dy, dz] = [s16(at.direction[0]!), s16(at.direction[1]!), s16(at.direction[2]!)];
  const length = still === 0 ? tableRoot(dx * dx + dy * dy + dz * dz, data.math) : 0;
  if (length !== 0) {
    slot.drift[0] = div(dx * 0x1900, length);
    slot.drift[1] = div(dy * 0x1900, length);
    slot.drift[2] = div(dz * 0x1900, length);
  } else slot.drift.fill(0);
  const [x, , z] = at.point as [number, number, number];
  const cx = state.camera.drawn.eye[0]!;
  const cz = state.camera.drawn.eye[2]!;
  slot.mirrored = (Math.imul(z - dz - cz, x - cx) + Math.imul(cx - (x - dx), z - cz)) >>> 31;
}

/** Slots played on a frame when `play` (drifting, slowing, the next frame), each held above the floor; true when none is alive. */
function stepSlots(slots: readonly Spark[], play: boolean): boolean {
  let none = true;
  for (const slot of slots) {
    if (slot.frame <= 0) continue;
    if (LOWEST <= slot.position[1]!) slot.position[1] = LOWEST;
    if (play) {
      for (let i = 0; i < 3; i += 1) {
        slot.drift[i] = Math.imul(slot.drift[i]!, 0x76) >> 7;
        slot.position[i] = (slot.position[i]! + slot.drift[i]!) | 0;
      }
      slot.frame = s16(slot.frame + 1);
      if (slot.last < slot.frame) slot.frame = 0;
    }
    if (0 < slot.frame) none = false;
  }
  return none;
}

/** The sparks, played on when `play`. */
export function drawSparks(state: FightState, play: number): void {
  stepSlots(state.sparks.slots, play !== 0);
}

/** The live frame's sparks played on, and the frame's events closed for the replay. */
export function stepSparks(state: FightState): void {
  stepSlots(state.sparks.slots, true);
  closeEventFrame(state);
}

/** No spark alive. */
export function clearSparks(state: FightState): void {
  state.sparks.next = 0;
  for (const slot of state.sparks.slots) slot.frame = 0;
}

/* ---- Dust. ---- */

/** Every cloud stopped, its puffs set to dust and still. */
export function clearDust(state: FightState, data: FightData): void {
  state.dust.next = 0;
  for (const cloud of state.dust.clouds) {
    for (const slot of cloud.puffs) {
      startSheet(state, data, slot, 3, 3);
      slot.frame = 0;
      slot.drift.fill(0);
      slot.mirrored = 0;
    }
    cloud.age = 0;
  }
}

/** A cloud of dust where a fighter lands (its root: x and z). */
export function dust(state: FightState, data: FightData, at: readonly number[]): void {
  const clouds = state.dust;
  const index = clouds.next;
  clouds.next = s16(index + 1);
  if (2 < clouds.next) clouds.next = 0;
  const cloud = clouds.clouds[index]!;
  cloud.age = 1;
  cloud.origin[1] = LOWEST;
  cloud.origin[0] = (at[0]! << 7) | 0;
  cloud.origin[2] = (at[2]! << 7) | 0;
  puff(state, data, cloud, 0);
}

/** One of a cloud's six puffs started, at its offset from the landing. */
function puff(state: FightState, data: FightData, cloud: FightState['dust']['clouds'][number], i: number): void {
  const slot = cloud.puffs[i]!;
  startSheet(state, data, slot, 3, 3);
  slot.frame = 1;
  const offset = data.effects.puffs[i]!;
  for (let k = 0; k < 3; k += 1) slot.position[k] = (cloud.origin[k]! + offset[k]! * 0x80) | 0;
}

/** Each cloud played on a played frame (its next puff started every other frame), and stopped once its puffs are all done. */
export function stepDust(state: FightState, data: FightData, play: number): void {
  for (const cloud of state.dust.clouds) {
    if (cloud.age <= 0) continue;
    if (play !== 0) {
      const age = cloud.age;
      if ((age & 1) === 0 && div(age, 2) < 6) puff(state, data, cloud, div(age, 2));
      cloud.age = s16(age + 1);
    }
    if (stepSlots(cloud.puffs, play !== 0)) cloud.age = 0;
  }
}

/* ---- The replay's events. ---- */

/** Recording from the start of the ring. */
export function startEvents(state: FightState): void {
  const effects = state.replayEffects;
  effects.recording = 1;
  effects.writeFrame = 0;
  effects.frameEvents = 0;
  effects.writeEvent = 0;
  effects.frames[0]!.count = 0;
  effects.frames[0]!.first = 0;
}

/** An event recorded: a spark's point, direction, kind and code, or dust's point. */
function recordEvent(state: FightState, kind: number, code: number, at: SparkAt, isDust: number): void {
  const effects = state.replayEffects;
  if (effects.recording === 0) return;
  effects.frameEvents = (effects.frameEvents + 1) | 0;
  if (0x40 < effects.frameEvents) return;
  const frame = effects.frames[effects.writeFrame]!;
  frame.count = (frame.count + 1) | 0;
  const event = effects.events[effects.writeEvent]!;
  event.dust = isDust;
  for (let i = 0; i < 3; i += 1) event.point[i] = at.point[i]!;
  if (isDust === 0) {
    for (let i = 0; i < 3; i += 1) event.direction[i] = s16(at.direction[i]!);
    event.kind = s16(kind);
    event.code = s16(code);
  }
  effects.writeEvent = effects.writeEvent + 1 < EVENTS ? effects.writeEvent + 1 : 0;
}

/** The next frame's record opened at the events' write position. */
function closeEventFrame(state: FightState): void {
  const effects = state.replayEffects;
  if (effects.recording === 0) return;
  let frame = effects.writeFrame + 1;
  if (FRAMES - 1 < frame) {
    frame = 0;
    effects.frameEvents = 0;
  }
  effects.writeFrame = frame;
  effects.frames[frame]!.count = 0;
  effects.frames[frame]!.first = effects.writeEvent;
}

/** Recording stops. */
export function stopEvents(state: FightState): void {
  state.replayEffects.recording = 0;
}

/** The replay's events read from `back` frames before the last recorded. */
export function rewindEvents(state: FightState, back: number): void {
  const effects = state.replayEffects;
  let frame = effects.writeFrame - back;
  if (frame < 0) frame += FRAMES;
  effects.readFrame = frame;
}

/** On a replay's whole frames, that frame's events played again; then the dust and the sparks, played on when `play`. */
export function replayEvents(state: FightState, data: FightData, play: number): void {
  const effects = state.replayEffects;
  if (play !== 0) {
    const frame = effects.frames[effects.readFrame]!;
    let at = frame.first;
    for (let left = s16(frame.count); 0 < left; left -= 1) {
      const event = effects.events[at]!;
      if (event.dust === 0) spark(state, data, event.kind, event.code, event, 0);
      else if (event.dust === 1) dust(state, data, event.point);
      at = at + 1 < EVENTS ? at + 1 : 0;
    }
    effects.readFrame = effects.readFrame + 1 < FRAMES ? effects.readFrame + 1 : 0;
  }
  stepDust(state, data, play);
  drawSparks(state, play);
}

/* ---- What the fight calls on hits, guards and landings. ---- */

/** A record's point and direction as a spark's start. */
export const recordAt = (r: HitRecord): SparkAt => ({ point: r.point, direction: r.direction });

/** A spark at a point, recorded. */
export function sparkAt(state: FightState, data: FightData, kind: number, at: SparkAt, still: number): void {
  spark(state, data, kind, 0, at, still);
  recordEvent(state, kind, 0, at, 0);
}

/** A guard's spark (`code` 1 or 2, or a move's own 0 to 3) at a hit or a joint. */
export function guardSpark(state: FightState, data: FightData, code: number, at: SparkAt): void {
  spark(state, data, 3, code, at, 0);
  recordEvent(state, 3, code, at, 0);
}

/**
 * A hit's spark, and for a blow of 0x15 or more the attacker's own (`side`) and two bursts along
 * the attacking limb's motion, or their charged look while the attacker is charged. An elemental
 * move's hit (hit code 0x18 or 0x1a) records the fire it would leave instead (Ogre's and Gon's,
 * which stage 3 remakes); codes 0x19, 0x1b and 0x1c add nothing. Everything is recorded as sparks,
 * so the replay shows it again.
 */
export function hitSpark(state: FightState, data: FightData, damage: number, side: number, defender: Fighter, record: HitRecord): void {
  const at = recordAt(record);
  spark(state, data, 3, 0, at, 0);
  recordEvent(state, 3, 0, at, 0);
  if (0x15 <= damage) {
    spark(state, data, side, 0, at, 1);
    recordEvent(state, side, 0, at, 0);
  }
  const attacker = state.fighters[side]!;
  const type = hitOf(data, attacker.move!)?.codes[0] ?? 0;
  if (type === 0x19 || type === 0x1b || type === 0x1c) return;
  if (type === 0x18 || type === 0x1a) {
    burnFighter(state, data, defender.slot);
    /* The game records it at a point it never set in this case (its stack's leftovers); the hit's point stands in. */
    recordEvent(state, defender.slot, 0x82, at, 0);
    return;
  }
  if (damage < 0x15) return;
  const segment = attacker.segments[0]!;
  const { climb, heading } = directionAngles(data, segment.to[0]! - segment.from[0]!, segment.to[1]! - segment.from[1]!, segment.to[2]! - segment.from[2]!);
  const blow: SparkAt = { point: record.point, direction: [climb, heading, damage] };
  const charged = attacker.recovery !== 0;
  const burst = { point: blow.point, climb, heading };
  spawnBurst(state, data, charged ? 4 : 1, burst, side);
  recordEvent(state, side, charged ? 0x84 : 0x81, blow, 0);
  spawnBurst(state, data, charged ? 3 : 0, burst, side);
  recordEvent(state, side, charged ? 0x83 : 0x80, blow, 0);
}

/** Dust where a fighter lands (its root), recorded. */
export function landingDust(state: FightState, data: FightData, f: Fighter): void {
  const root = f.skeleton.base.translation;
  dust(state, data, root);
  recordEvent(state, 0, 0, { point: root, direction: [0, 0, 0] }, 1);
}
