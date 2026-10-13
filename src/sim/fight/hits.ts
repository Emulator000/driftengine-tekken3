/**
 * Hits: where the bodies' spheres and the attack's segments are, whether a segment meets a sphere,
 * what each hit is (blocked, clean, counter, juggled, glancing, harmless) and how much it takes,
 * which of a frame's two hits counts, and the health and reaction that follow.
 *
 * A defender keeps two hit records: where the hit landed and the attack's direction there, which
 * sphere it met, the raw and the dealt damage, the attacker's slot, whether the record is in use, and
 * the hit's kind as flags.
 *
 * During a move's active frames its segments are not the limbs but points baked into its hit data,
 * a few each frame, so a fast limb cannot pass through a body between two frames.
 */
import type { HitTable, HitData } from '../data/moveset.ts';
import { s16, s8, div } from '../math/integers.ts';
import { rotate, newProduct } from '../math/matrix.ts';
import { pairOf, targetOf } from './body.ts';
import { face } from './move.ts';
import { hitOf, moveAt } from './moves.ts';
import { Mode, type FightData, type FightState, type Fighter, type HitRecord } from './state.ts';
import { guardSpark, hitSpark, recordAt } from '../effects/sparks.ts';
import { voiceLine } from './voices.ts';

/** The line a hit by an effect plays. */
const EFFECT_HIT = 0x4951;

/** Both hit records, and the fighter's hit flags, cleared. */
export function clearHits(f: Fighter): void {
  f.struck = 0;
  f.whiffed = 0;
  f.hitReacting = 0;
  f.freezeOnHit = 0;
  f.hitByEffect = 0;
  for (const r of f.hitRecords) {
    r.raw = 0;
    r.dealt = 0;
    r.attacker = 0;
    r.used = 0;
    r.blocked = 0;
    r.chip = 0;
    r.clean = 0;
    r.counter = 0;
    r.glancing = 0;
    r.juggled = 0;
    r.harmless = 0;
  }
}

/** The outcome of last frame's hit forgotten. */
export function clearOutcome(f: Fighter): void {
  f.pressure = 0;
  f.fromBehind = 0;
  f.guarded = 0;
  f.hitClean = 0;
  f.counterHit = 0;
  f.knockedOut = 0;
}

/**
 * Whether a segment meets a hit sphere: within the box of the segment's extent padded by the
 * radius, then, the segment clipped to the sphere's height, closest in the floor plane within it.
 */
export function segmentMeetsSphere(from: readonly number[], to: readonly number[], sphere: Fighter['hitSpheres'][number]): boolean {
  const radius = sphere.radius;
  const halfExtent = (a: number, b: number): number => Math.abs(b - a) >> 1;
  const mid = (a: number, b: number): number => div(a + b, 2);
  const [x0, y0, z0] = [from[0]!, from[1]!, from[2]!];
  const [x1, y1, z1] = [to[0]!, to[1]!, to[2]!];
  const [cx, cy, cz] = [sphere.position[0]!, sphere.position[1]!, sphere.position[2]!];
  if (halfExtent(x0, x1) + radius < Math.abs(cx - mid(x1, x0))) return false;
  if (halfExtent(z0, z1) + radius < Math.abs(cz - mid(z1, z0))) return false;
  if (halfExtent(y0, y1) + radius < Math.abs(cy - mid(y1, y0))) return false;
  let ax = x0;
  let az = z0;
  let bx = x1;
  let bz = z1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;
  const round12 = (v: number): number => (v < 0 ? v + 0xfff : v) >> 12;
  const at = (t: number): [number, number] => [x0 + round12(Math.imul(t, dx)), z0 + round12(Math.imul(t, dz))];
  if (y0 !== y1) {
    const bottom = cy - radius;
    const top = cy + radius;
    if (y1 < y0) {
      if (top < y0) [ax, az] = at(div((top - y0) * 0x1000, dy));
      if (y1 < bottom) [bx, bz] = at(div((bottom - y0) * 0x1000, dy));
    } else {
      if (top < y1) [bx, bz] = at(div((top - y0) * 0x1000, dy));
      if (y0 < bottom) [ax, az] = at(div((bottom - y0) * 0x1000, dy));
    }
  }
  const ex = bx - ax;
  const ez = bz - az;
  let sx = ax - cx;
  let sz = az - cz;
  const length = (Math.imul(ex, ex) + Math.imul(ez, ez)) | 0;
  const along = -((Math.imul(ex, sx) + Math.imul(ez, sz)) | 0);
  let distance: number;
  if (length === 0 || along < 0) distance = (Math.imul(sx, sx) + Math.imul(sz, sz)) | 0;
  else if (length < along) {
    const fx = bx - cx;
    const fz = bz - cz;
    distance = (Math.imul(fx, fx) + Math.imul(fz, fz)) | 0;
  } else {
    sx += div(Math.imul(ex, along), length);
    sz += div(Math.imul(ez, along), length);
    distance = (Math.imul(sx, sx) + Math.imul(sz, sz)) | 0;
  }
  return distance <= sphere.radiusSquared;
}

/**
 * Whether any of the attack's segments meets any of the defender's fourteen hit spheres, unless the
 * defender is untouchable; the meeting point, the attack's direction there and which sphere go into
 * the hit record. An effect's attack (a code of 0x18 on) is the effect's own segments.
 */
function attackLands(state: FightState, data: FightData, attacker: Fighter, defender: Fighter, into: HitRecord): boolean {
  let segments: readonly { readonly from: number[]; readonly to: number[] }[];
  let count: number;
  if (hitOf(data, attacker.move!)!.codes[0]! < 0x18) {
    segments = attacker.segments;
    count = Math.min(attacker.attackSegments, 4);
  } else {
    if (attacker.slot > 2) return false;
    const which = attacker.slot === 0 ? 0 : 1;
    segments = state.effectSegments[which]!;
    count = state.effectSegmentCounts[which]!;
  }
  for (let i = 0; i < count; i += 1) {
    if (defender.untouchable !== 0) return false;
    const segment = segments[i]!;
    for (let k = 0; k < 14; k += 1) {
      if (!segmentMeetsSphere(segment.from, segment.to, defender.hitSpheres[k]!)) continue;
      into.part = k;
      into.point[0] = segment.to[0]!;
      into.point[1] = segment.to[1]!;
      into.point[2] = segment.to[2]!;
      into.direction[0] = s16(segment.to[0]! - segment.from[0]!);
      into.direction[1] = s16(segment.to[1]! - segment.from[1]!);
      into.direction[2] = s16(segment.to[2]! - segment.from[2]!);
      return true;
    }
  }
  return false;
}

/**
 * One attacker's attack against one defender this frame, into a free hit record. A move of level
 * 0x10f in its own active window on a defender of kind 12 does not land; a landed attack whose
 * level the defender's state answers marks both fighters for the reaction.
 */
export function detectHit(state: FightState, data: FightData, attacker: Fighter, defender: Fighter): void {
  let free: HitRecord | null = null;
  for (const r of defender.hitRecords) if (s8(r.used) === 0) free = r;
  const slot = defender.slot;
  let blockedOut = false;
  if (free !== null && s8(attacker.pushImmune) === 0 && s8(defender.pushImmune) === 0 && s8(attacker.present) !== 0 && s8(defender.present) !== 0 && s8(attacker.hitSlots[slot]!) === 0) {
    if (s16(attacker.level) === 0x10f && s8(defender.kind) === 0xc) {
      const theirs = moveAt(data, defender.move!);
      const frame = defender.frame;
      if ((theirs.stepWindow.first <= frame && frame <= theirs.stepWindow.last - 5) || s8(defender.inAir) !== 0) blockedOut = true;
    }
    if (!blockedOut && (!(state.mode === Mode.TEKKEN_BALL || state.mode === Mode.TEKKEN_FORCE) || s8(defender.throwing) === 0)) {
      let level = attacker.level & 0xffff;
      if (s8(defender.guardMode) === 2) level |= 1;
      let landed: boolean;
      if (s8(attacker.effectHit) === 0 || s8(defender.computer) === 0 || s8(defender.pushedBy[attacker.slot]!) === 0) {
        landed = attackLands(state, data, attacker, defender, free);
      } else {
        const root = defender.skeleton.base.translation;
        const theirs = attacker.skeleton.base.translation;
        free.point[0] = root[0]!;
        free.point[1] = root[1]!;
        free.point[2] = root[2]!;
        free.direction[0] = s16((theirs[0]! - root[0]!) >> 1);
        free.direction[1] = s16((theirs[1]! - root[1]!) >> 1);
        free.direction[2] = s16((theirs[2]! - root[2]!) >> 1);
        landed = true;
        voiceLine(state, data, 0, EFFECT_HIT, 0);
      }
      if (landed && (level & defender.stance & 7) !== 0) {
        attacker.hitSlots[slot] = 1;
        attacker.hitLanded = 1;
        attacker.struck = 1;
        attacker.struckSlot = slot;
        defender.beingHit = 1;
        defender.hitReacting = 1;
        defender.freezeOnHit = moveAt(data, attacker.move!).hitStun;
        free.used = 1;
        free.attacker = attacker.slot;
        defender.hitByEffect = attacker.effectHit;
        if (s16(attacker.moveId) === 0x898) defender.freezeOnHit = 0x1e;
        if (attacker.attackDamage !== 0 || s8(defender.inAir) !== 0) defender.untouchable = 4;
      }
    }
  }
  if (moveAt(data, attacker.move!).activeWindow.last === (attacker.frame & 0xffff) && s8(attacker.hitLanded) === 0) attacker.whiffed = 1;
}

/**
 * What a landed hit is. A move with no damage is harmless; otherwise a guard the defender's state
 * does not cover, or a defender turned away, takes it clean (a counter if the defender was starting
 * an attack or either is in recovery, juggled if airborne), else it is blocked (with chip damage when
 * the rules ask). A move's reaction kind with a reach glances from beyond it.
 */
function classifyHit(state: FightState, data: FightData, defender: Fighter, attacker: Fighter, into: HitRecord): void {
  if (attacker.attackDamage === 0) {
    into.harmless = 1;
    return;
  }
  const kind = moveAt(data, attacker.move!).reactionKind;
  if (kind !== 0 && state.distance >>> 0 < (data.reactions.backReach[kind]! >>> 0)) into.glancing = 1;
  if ((defender.guard & attacker.level) === 0 || defender.facingOffSize > 0x3fff) {
    into.clean = 1;
    const move = moveAt(data, defender.move!);
    if ((defender.attackDamage !== 0 && defender.frame < move.activeWindow.first) || defender.recovery !== 0 || attacker.recovery !== 0) into.counter = 1;
    if (s8(defender.inAir) !== 0 || (move.flags & 0x400) !== 0) into.juggled = 1;
  } else {
    into.blocked = 1;
    if (state.alwaysChip !== 0 || attacker.recovery !== 0) into.chip = 1;
  }
}

/** Damage in percent by the sphere hit. */
const scaleByPart = (data: FightData, damage: number, part: number): number => s16(div(damage * data.hitTables.damageByPart[part]!, 100));

/**
 * What a hit deals. Clean hits scale by the part hit, or by half again when glancing; a counter adds
 * 30% of the defender's own attack, scaled by how far into it they were; a juggle deals 80%, or half
 * after the first. Blocked hits deal nothing, or a tenth plus 2 as chip.
 */
function dealDamage(data: FightData, defender: Fighter, attacker: Fighter, into: HitRecord): void {
  const raw = attacker.attackDamage & 0xffff;
  into.raw = raw;
  let dealt: number;
  if (s8(into.blocked) === 0) {
    let base: number;
    if (s8(into.glancing) === 0) base = scaleByPart(data, s16(raw), into.part);
    else base = raw + ((s16(raw) - (s16(raw) >> 31)) >> 1);
    if (s8(into.counter) !== 0) {
      let own = defender.attackDamage;
      if (own < 0) own = -own;
      let extra = div(own * 3, 10);
      if (defender.recovery === 0 && attacker.recovery === 0) {
        let span = moveAt(data, defender.move!).activeWindow.first;
        if (span === 0 || span < defender.frame) span = defender.frame & 0xffff;
        extra = div(div(s16(extra) * 3, 10) * defender.frame, s16(span));
      }
      base = extra + div(s16(base) * 0xc, 10);
    }
    dealt = s16(base);
    if (s8(into.juggled) !== 0) {
      if (defender.stunned === 0) dealt = s16(div(dealt * 0x50, 100));
      else dealt = s16(((s16(base) - (s16(base) >> 31)) >>> 0) >>> 1);
    }
  } else if (s8(into.chip) === 0) dealt = 0;
  else dealt = s16(div(s16(raw), 10) + 2);
  into.dealt = s16(into.dealt + dealt);
}

/** Of the two hit records, the one that counts: the weightier kind, then more damage. */
function weightiest(f: Fighter): number {
  const weight = (r: HitRecord): number =>
    (s8(r.harmless) !== 0 ? 1 : 0) + (s8(r.blocked) !== 0 ? 2 : 0) + (s8(r.chip) !== 0 ? 3 : 0) + (s8(r.glancing) !== 0 ? 4 : 0) + (s8(r.clean) !== 0 ? 5 : 0) + (s8(r.counter) !== 0 ? 6 : 0) + (s8(r.juggled) !== 0 ? 7 : 0);
  const [best, candidate] = f.hitRecords;
  if (s8(candidate!.used) === 0) return 0;
  const a = weight(best!) & 0xff;
  const b = weight(candidate!) & 0xff;
  return a < b || (b === a && best!.dealt < candidate!.dealt) ? 1 : 0;
}

/** Health a move's own events give or take this frame: 2 heals, 3 hurts itself, and a thrower's 1 hurts its victim. */
function selfDamage(state: FightState, f: Fighter): number {
  const amount = (q: Fighter): number => (q.eventAmount === 0 ? q.attackDamage : q.eventAmount);
  let total = 0;
  if (s8(f.eventHealth) === 2) total = amount(f);
  if (s8(f.eventHealth) === 3) total -= amount(f);
  if (f.throwHold < 0) {
    const thrower = targetOf(state, f);
    if (s8(thrower.eventHealth) === 1) total += amount(thrower);
  }
  return total;
}

/** The reaction a move's word names: a row, or a place in the list. */
function reactionOf(word: number): { source: number; index: number } {
  return (word & 0xf000) === 0 ? { source: 0, index: word } : { source: 1, index: word & 0xfff };
}

/**
 * A fighter's hits this frame applied: each record classified and its damage dealt, the weightiest
 * one's outcome kept, the reaction its attacker's move names (in Tekken Ball the ball's, the move that
 * charged it), health taken in 16.16 and held within 0 and the maximum, the sparks, and a knockout
 * starting the replay.
 */
export function applyHits(state: FightState, data: FightData, f: Fighter): void {
  let attacker = targetOf(state, f);
  const own = selfDamage(state, f);
  let dealt = 0;
  for (const r of f.hitRecords) {
    if (s8(r.used) === 0) continue;
    f.sideHeld = 0;
    attacker = state.fighters[r.attacker]!;
    face(data, f, attacker);
    classifyHit(state, data, f, attacker, r);
    dealDamage(data, f, attacker, r);
    dealt += r.dealt;
  }
  if (s8(f.hitReacting) !== 0) {
    f.bestHit = weightiest(f);
    const best = f.hitRecords[f.bestHit!]!;
    let magnitude = best.dealt;
    if (magnitude < 0) magnitude = -magnitude;
    f.pressure = s16(magnitude);
    f.fromBehind = best.glancing;
    f.guarded = best.blocked;
    f.hitClean = best.clean;
    f.counterHit = best.counter;
    f.struckBySlot = best.attacker;
    /* Practice's COUNTER ATTACKS: every clean hit on its partner a counter hit. */
    if (state.mode === Mode.PRACTICE && state.practice.counters[f.slot] !== 0 && f.holds[1] === 0 && f.hitClean !== 0) f.counterHit = 1;
    f.hitTravel.splice(0, 3, ...attacker.handTravel);
    if (state.mode === Mode.TEKKEN_BALL && state.ball.struck !== 0) f.reaction = reactionOf(moveAt(data, state.fighters[2]!.move!).throwReaction);
    else if (s8(f.hitByEffect) !== 0) f.reaction = { source: 2, index: 0 };
    else if (s8(f.fromBehind) === 0) f.reaction = reactionOf(moveAt(data, attacker.move!).throwReaction);
    else f.reaction = reactionOf(data.reactions.backKinds[moveAt(data, attacker.move!).reactionKind]! & 0xffff);
  }
  const before = f.health;
  if (state.freezeHealth === 0 && state.freezeHealthToo === 0) f.health = (before + (own + dealt) * -0x10000) | 0;
  /* In Tekken Ball only the ball's strikes (the third fighter's) take health. */
  if (state.mode === Mode.TEKKEN_BALL && attacker.slot !== 2) f.health = before;
  if (f.health < 0) f.health = 0;
  if (f.maxHealth < f.health) f.health = f.maxHealth;
  if (f.health === 0 && before !== 0) f.knockedOut = 1;
  if (s8(f.knockedOut) !== 0 && s8(f.hitRecords[f.bestHit!]!.chip) !== 0) {
    f.guarded = 0;
    f.hitClean = 1;
  }
  if (s8(f.hitReacting) !== 0) hitEffects(state, data, f, f.hitRecords[f.bestHit!]!, s16(dealt));
  if (s8(f.knockedOut) !== 0 && state.knockoutReplay === 0 && state.mode !== Mode.TEKKEN_FORCE) {
    knockoutReplayStart(state, attacker);
    state.knockoutReplay = 1;
  }
  /* Tekken Force scores an enemy's damage: ten a point of the raw damage of the player's hits (and of bodies flung as attacks), twenty a point of a throw's. */
  if (state.mode === Mode.TEKKEN_FORCE && f.computer !== 0) {
    let sum = 0;
    if (s8(f.hitReacting) !== 0) {
      for (const r of f.hitRecords) {
        if (s8(r.used) === 0) continue;
        const a = state.fighters[r.attacker]!;
        if (a.slot === 0 || a.effectHit !== 0) sum += s16(r.raw);
      }
    }
    if (0 < own) sum += own * 2;
    if (sum !== 0) state.force.score += sum * 10;
  }
  f.ownDamage = s16(own);
}

/** The sparks for the weightiest hit: a guard's unless it landed or knocked out, else a hit's sized by the damage. */
function hitEffects(state: FightState, data: FightData, f: Fighter, best: HitRecord, dealt: number): void {
  if (s8(best.clean) === 0 && s8(f.knockedOut) === 0) {
    if (s8(best.blocked) !== 0) guardSpark(state, data, 2, recordAt(best));
    else if (s8(best.harmless) !== 0) guardSpark(state, data, 1, recordAt(best));
    return;
  }
  const damage = Math.max(dealt, s16(best.raw));
  hitSpark(state, data, damage, state.mode === Mode.TEKKEN_BALL ? 1 - f.slot : best.attacker, f, best);
}

/** When a knockout lands, the replay starts thirty frames before the finishing move began, on the ring of 300 recorded frames. */
function knockoutReplayStart(state: FightState, attacker: Fighter): void {
  let start = (state.replay.recordFrame - attacker.frame - 0x1e) * 2;
  if (start < 0) start += 0x4b00;
  state.replay.knockoutStart = start % 600;
}

/* ---- The spheres and the swept attack. ---- */

/** This frame's base and segment ends kept as next frame's starts. */
export function rememberSweep(state: FightState, f: Fighter): void {
  for (let k = 0; k < 3; k += 1) {
    state.sweepBases[f.slot]![k] = f.position[k]!;
    state.sweepFirsts[f.slot]![k] = f.segments[0]!.to[k]!;
    state.sweepSeconds[f.slot]![k] = f.segments[1]!.to[k]!;
    f.segments[0]!.from[k] = f.segments[0]!.to[k]!;
    f.segments[1]!.from[k] = f.segments[1]!.to[k]!;
  }
}

/** A baked point of a track by its place. */
function pointOf(track: NonNullable<HitData['track']>, index: number, out: number[]): void {
  if (index < 0 || index * 3 + 2 >= track.points.length) throw new Error(`swept point ${index} lies past the track`);
  out[0] = track.points[index * 3]!;
  out[1] = track.points[index * 3 + 1]!;
  out[2] = track.points[index * 3 + 2]!;
}

const round12 = (v: number): number => (v < 0 ? v + 0xfff : v) >> 12;

/** A baked point placed: turned by the heading about its base, the base itself turned back by the frame's turn. */
function place(state: FightState, out: number[], v: readonly number[], base: readonly number[]): void {
  const turn = state.sweepTurn;
  let bx = base[0]!;
  let bz = base[2]!;
  if (turn.turn !== 0) {
    const ox = turn.origin[0]!;
    const oz = turn.origin[2]!;
    const rx = round12((ox - bx) * turn.turnCos - (oz - bz) * turn.turnSin);
    const rz = round12((ox - bx) * turn.turnSin + (oz - bz) * turn.turnCos);
    bx = ox - rx;
    bz = oz - rz;
  }
  out[0] = (bx + round12(v[0]! * turn.cos) - round12(v[2]! * turn.sin)) | 0;
  out[1] = (base[1]! + v[1]!) | 0;
  out[2] = (bz + round12(v[0]! * turn.sin) + round12(v[2]! * turn.cos)) | 0;
}

/** Points a frame's layout (the low four bits of the track's word) holds, by layout, as a function of the frame into the active window. */
const LAYOUT_START: Readonly<Record<number, (f: number) => number>> = {
  0: (f) => f * 2,
  1: (f) => f + 1,
  2: (f) => f * 2 + 2,
  3: (f) => f * 3 + 1,
  4: (f) => f * 3 + 1,
  5: (f) => f * 4,
  6: (f) => f * 2 + 1,
  7: (f) => f * 2 + 1,
  9: (f) => f * 2 + 1,
  10: (f) => f * 3,
  12: (f) => f * 3,
  13: (f) => f * 3,
  14: (f) => f * 3,
};

/**
 * The active frame's segments from the move's baked track: its layout says how many points a frame
 * holds and which segments they make, starting from last frame's points where a segment sweeps.
 */
function sweptHitPoints(state: FightState, data: FightData, f: Fighter): void {
  const hit = hitOf(data, f.move!) as HitTable | HitData | null;
  if (s8(f.segmentCount) === 0) return;
  if (hit === null || hit.codes[0]! > 0x17) return;
  const track = hit.track!;
  const turn = f.heading - f.facing;
  const sine = (angle: number): [number, number] => {
    let a = -angle;
    if (a < 0) a += 0xf;
    const i = ((a >> 3) & 0x1ffe) / 2;
    return [data.math.sine[i]!, data.math.sine[i + 0x400]!];
  };
  const turned = state.sweepTurn;
  turned.turn = turn;
  if (turn !== 0) {
    const root = f.skeleton.base.translation;
    turned.origin[0] = root[0]!;
    turned.origin[1] = root[1]!;
    turned.origin[2] = root[2]!;
    [turned.turnSin, turned.turnCos] = sine(turn);
  }
  [turned.sin, turned.cos] = sine(f.heading);
  const word = track.word;
  let skip = 0;
  const which = state.tracks[f.slot]!;
  if (which === 1) skip = (word & 0x7fff) >> 4;
  else if (which === 2) {
    if ((word & 0x8000) !== 0) skip = (word & 0x7ffe) >> 3;
  } else if (which !== 0) return;
  const layout = word & 0xf;
  const frame = f.frame - moveAt(data, f.move!).activeWindow.first;
  const start = LAYOUT_START[layout];
  if (start === undefined) return;
  /* Points are five bytes; the original walks them by bytes, the skip included. */
  let at = start(frame) + skip / 5;
  const now = [f.position[0]!, f.position[1]!, f.position[2]!];
  const before = state.sweepBases[f.slot]!;
  const a = [0, 0, 0];
  const b = [0, 0, 0];
  const [first, second] = [f.segments[0]!, f.segments[1]!];
  if ([0, 3, 5, 8, 9, 10, 11, 12, 13, 14].includes(layout)) {
    pointOf(track, at, a);
    place(state, first.from, a, now);
    at += 1;
    pointOf(track, at, b);
  } else {
    if ((layout === 2 && frame === 0) || ([1, 4, 6, 7].includes(layout) && frame === 0)) {
      pointOf(track, at - (layout === 2 ? 2 : 1), a);
      place(state, first.from, a, before);
    } else first.from.splice(0, 3, ...state.sweepFirsts[f.slot]!);
    pointOf(track, at, b);
  }
  place(state, first.to, b, now);
  at += 1;
  switch (layout) {
    case 2:
    case 3:
      if (frame === 0) {
        pointOf(track, at - (layout === 2 ? 2 : 3), a);
        place(state, second.from, a, before);
      } else second.from.splice(0, 3, ...state.sweepSeconds[f.slot]!);
      pointOf(track, at, b);
      break;
    case 4:
    case 5:
      pointOf(track, at, a);
      place(state, second.from, a, now);
      pointOf(track, at + 1, b);
      break;
    case 6:
    case 10:
      pointOf(track, at, a);
      place(state, second.from, a, now);
      second.to.splice(0, 3, ...first.to);
      return;
    case 7:
    case 11:
      pointOf(track, at, b);
      second.from.splice(0, 3, ...first.to);
      break;
    case 9:
      if (frame === 0) {
        pointOf(track, at - 1, a);
        place(state, second.from, a, before);
      } else second.from.splice(0, 3, ...state.sweepSeconds[f.slot]!);
      second.to.splice(0, 3, ...first.from);
      return;
    case 12:
      pointOf(track, at, a);
      place(state, second.from, a, now);
      second.to.splice(0, 3, ...first.from);
      return;
    case 13:
      pointOf(track, at, b);
      second.from.splice(0, 3, ...first.from);
      break;
    case 14:
      pointOf(track, at, b);
      place(state, second.to, b, now);
      second.from.splice(0, 3, ...second.to);
      return;
    default:
      return;
  }
  place(state, second.to, b, now);
}

const held = newProduct();

/**
 * Where the body's spheres are: the fourteen hit spheres on their joints (two of them lowered), the
 * eight push spheres, the attack's segments between the joints its hit codes name (outside its
 * active frames; inside them the move's swept points), and the points Yoshimitsu, True Ogre and Gon
 * hold out from a joint, into the spare joint slots.
 */
export function placeSpheres(state: FightState, data: FightData, f: Fighter): void {
  const move = moveAt(data, f.move!);
  const frame = f.frame;
  const joints = f.skeleton.joints;
  if (frame < move.activeWindow.first || move.activeWindow.last < frame) {
    const hold = (joint: number, point: number, into: number): void => {
      const world = joints[joint]!.world;
      const p = data.hitTables.heldPoints[point]!;
      rotate(world.rotation, p[0]!, p[1]!, p[2]!, held);
      for (let k = 0; k < 3; k += 1) joints[into]!.world.translation[k] = (held.full[k]! + world.translation[k]!) | 0;
    };
    if (f.character === 4) {
      hold(10, 0, 18);
      hold(10, 1, 19);
    }
    if (f.character === 0xe && f.roster === 0x14) {
      hold(11, 2, 22);
      hold(2, 3, 23);
    }
    if (f.character === 0x13) {
      hold(11, 4, 21);
      hold(2, 5, 23);
    }
    if (s8(f.segmentCount) !== 0) {
      const codes = hitOf(data, f.move!)!.codes;
      for (let i = 0; i < f.segmentCount; i += 1) {
        const segment = f.segments[i]!;
        const end = (code: number, out: number[]): void => {
          let at = code;
          let usable = at < 0x18;
          if (at === 0x13) {
            usable = true;
            if (f.roster === 0xe) at = 6;
          }
          if (!usable) return;
          for (let k = 0; k < 3; k += 1) out[k] = joints[at]!.world.translation[k]!;
        };
        end(codes[i * 2]!, segment.to);
        if (codes[i * 2 + 1] !== 0) end(codes[i * 2 + 1]!, segment.from);
      }
    }
  } else sweptHitPoints(state, data, f);
  for (let i = 0; i < 14; i += 1) {
    const at = joints[data.hitTables.hitSphereJoints[i]!]!.world.translation;
    const sphere = f.hitSpheres[i]!;
    sphere.position[0] = at[0]!;
    sphere.position[1] = (at[1]! - (i === 8 ? 0x78 : i === 0xb ? 0x3c : 0)) | 0;
    sphere.position[2] = at[2]!;
  }
  for (let i = 0; i < 8; i += 1) {
    const at = joints[data.hitTables.pushSphereJoints[i]!]!.world.translation;
    f.pushSpheres[i]!.position.splice(0, 3, at[0]!, at[1]!, at[2]!);
  }
  f.headAt.splice(0, 3, ...f.hitSpheres[0]!.position);
}

export { pairOf };
