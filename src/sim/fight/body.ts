/**
 * The fighters' bodies between moves: the distances and angles between them, the arena's bounds and
 * the pull that keeps two fighters from drifting apart, a held throw carrying its partner, each
 * frame's travel, the push spheres' radii as the move allows, and the push that keeps two bodies
 * from overlapping.
 */
import { div, s16 } from '../math/integers.ts';
import { angle4096, headingOf } from '../math/angles.ts';
import { isqrt, tableRoot } from '../math/roots.ts';
import { moveAt } from './moves.ts';
import { Mode, type FightData, type FightState, type Fighter } from './state.ts';

/** How far the arena reaches each way, and how far apart two fighters may drift before the pull. */
const ARENA = 300000;
/**
 * Tekken Force's street: its far and near edges (MISHIMA FORTRESS's near edge a line slanting
 * across the view, its slope per thousand and where it crosses the middle), the picture's two sides
 * for the player (each a slope per thousand in depth and an offset; the fortress's own), how far an
 * enemy may stand from the view's middle; the fortress's stage.
 */
const STREET = {
  far: 0x8fc,
  near: 0x898,
  slant: -0x103,
  slantAt: -0x8ed,
  sides: [
    [-323, -2553],
    [329, 1971],
  ],
  fortressSides: [
    [-375, -2445],
    [333, 2175],
  ],
  enemies: 0x1068,
  fortress: 0x12,
} as const;
/** An enemy slot free (no enemy in it). */
const FORCE_FREE = 1;
/** A throw's victim flung this far from its thrower this many frames into the throw. */
const FLING = { frames: 0x12, distance: 0x578 } as const;
const DRIFT = 0x1e00;
/** Tekken Ball's court: how far in depth a fighter may stray off the court's line, how far out the ends are, how far past the middle a fighter is knocked back (into this stance), and the ceiling. */
const COURT = { depth: 0x100, end: 0x1400, over: 0x3e8, stance: 0x5000, ceiling: 0x1200 } as const;
const PULL_MAX = 2000;
/** Kuma and Panda, and True Ogre: large bodies stand 40 mm nearer. */
const KUMA = 0xb;
const TRUE_OGRE = 0x14;

/** The fighter a fighter acts against: its throw's partner, the one hitting it, the one it hit, or its target. */
export function targetOf(state: FightState, f: Fighter): Fighter {
  let index: number;
  if (f.throwing !== 0) index = f.partnerSlot;
  else if (f.beingHit !== 0) index = f.struckBySlot;
  else if (f.struck !== 0) index = f.struckSlot;
  else index = f.target;
  return state.fighters[index]!;
}

const slotOf = (state: FightState, f: Fighter): number => state.fighters.indexOf(f);

/** A pair of slots' record: by the slots as bits (0 and 1 the first pair, 0 and 2 the second, 1 and 2 the third). */
export function pairOf(state: FightState, a: number, b: number): FightState['pairs'][number] {
  const bit = (s: number): number => (s > 1 ? 1 << (s - 1) : s);
  return state.pairs[bit(a) + bit(b)]!;
}

/** A distance less 40 mm for each large body in the pair. */
function nearDistance(f: Fighter, other: Fighter, distance: number): number {
  let large = f.roster === KUMA || f.roster === TRUE_OGRE ? 1 : 0;
  if (other.roster === KUMA || other.roster === TRUE_OGRE) large += 1;
  return distance - large * 0x28;
}

/**
 * Every pair's distance, offsets and angle from the roots, then each fighter's distance to its
 * target, its offsets, and the angle toward it; a fighter whose side is held, or whose target is off
 * the screen's edge, faces its side instead and measures by how far from the screen's middle it is.
 */
export function measurePairs(state: FightState, data: FightData, count: number): void {
  const offScreen = state.fighters.map((f, i) => (i < count && (!((f.screenX & 0xffff) < 0x191) || (state.mode === Mode.TEKKEN_FORCE && f.computer !== 0 && idleEnemy(state, (f.slot - 1) & 1))) ? 1 : 0));
  for (let i = count - 1; i > 0; i -= 1) {
    for (let j = i - 1; j >= 0; j -= 1) {
      const a = state.fighters[i]!.skeleton.base.translation;
      const b = state.fighters[j]!.skeleton.base.translation;
      const dx = (a[0]! - b[0]!) | 0;
      const dz = (a[2]! - b[2]!) | 0;
      const pair = pairOf(state, i, j);
      pair.distance = isqrt((Math.imul(dx, dx) + Math.imul(dz, dz)) >>> 0);
      pair.dx = dx;
      pair.dz = dz;
      pair.angle = headingOf(dz, dx, data.math);
    }
  }
  for (let i = 0; i < count; i += 1) {
    const f = state.fighters[i]!;
    const root = f.skeleton.base.translation;
    f.measuredRoot[0] = root[0]!;
    f.measuredRoot[1] = root[2]!;
    const target = targetOf(state, f);
    const other = slotOf(state, target);
    const pair = pairOf(state, f.slot, other);
    f.targetDistance = pair.distance;
    f.nearDistance = nearDistance(f, target, pair.distance | 0) | 0;
    f.targetDx = pair.dx;
    f.targetDz = pair.dz;
    const angle = other < f.slot ? pair.angle : (pair.angle - 0x8000) & 0xffff;
    if (f.sideHeld === 0 && offScreen[other] === 0) {
      f.towardTarget = s16(angle);
    } else {
      let lean = 0xb4 - f.screenX;
      if (lean < 0) lean = -lean;
      lean = 0xb4 - lean;
      if (lean < 0) lean = -lean;
      f.towardTarget = f.heldSide === 0 ? 0x4000 : -0x4000;
      f.targetDistance = (lean * 10) >>> 0;
      f.targetDx = lean * 10;
      f.targetDz = 0;
    }
  }
  state.distance = state.fighters[0].targetDistance | 0;
}

/** Where each slot's root stands, for next frame's push. */
export function rememberRoot(state: FightState, f: Fighter): void {
  const last = state.lastRoots[f.slot]!;
  for (let i = 0; i < 3; i += 1) last[i] = f.skeleton.base.translation[i]!;
}

/** The sine and cosine of a 16-bit turn, held to ±0xfff and scaled to ±0x7ff8. */
const sinWide = (data: FightData, turn: number): number => s16(Math.max(-0xfff, Math.min(0xfff, data.math.sine[(turn >> 4) & 0xfff]!)) << 3);
const cosWide = (data: FightData, turn: number): number => s16(Math.max(-0xfff, Math.min(0xfff, data.math.sine[((turn >> 4) & 0xfff) + 0x400]!)) << 3);
export { sinWide, cosWide };

/** How far past `limit` either way `v` is, as the pull back: 0 within it. */
const pullBack = (v: number, limit: number): number => (Math.abs(v) - limit > 0 ? (v > 0 ? -(Math.abs(v) - limit) : Math.abs(v) - limit) : 0);

/**
 * Tekken Ball's court: each fighter kept on its own half (well over the middle it is knocked back
 * into a stance and drops its hits), near the line across the middle, inside the ends and under the
 * ceiling; one held in a throw stays put.
 */
function courtPulls(state: FightState, f: Fighter): [number, number, number] {
  const root = f.skeleton.base.translation;
  const x = root[0]!;
  const pullZ = pullBack(root[2]!, COURT.depth);
  let pullX = pullBack(x, COURT.end);
  let pullY = 0;
  if ((f.slot === 0 && x >= 0) || (f.slot === 1 && x <= 0)) {
    pullX = -x;
    if (Math.abs(x) > COURT.over) {
      f.stance = COURT.stance;
      f.hitSlots[0] = 0;
      f.hitSlots[1] = 0;
      f.unpushable = 1;
    }
  }
  if (-COURT.ceiling - root[1]! > 0) pullY = -COURT.ceiling - root[1]!;
  if (f.throwHold < 0) {
    state.pulls[f.slot] = 0;
    state.pullSpeeds[f.slot] = 0;
  }
  return [pullX, pullY, pullZ];
}

/** Whether a Tekken Force enemy slot is free while no boss is on: its fighter counts as off the picture. */
function idleEnemy(state: FightState, slot: number): boolean {
  return state.force.slots[slot & 1]!.state === FORCE_FREE && state.force.bossPhase === 0;
}

/**
 * Tekken Force's street: the near and far edges (MISHIMA FORTRESS's near edge slanting across),
 * the player within the picture's sides (each a line in depth), an enemy within 4200 mm of the
 * view's middle.
 */
function streetPulls(state: FightState, f: Fighter): [number, number] {
  const root = f.skeleton.base.translation;
  const x = root[0]!;
  const z = root[2]!;
  const scroll = state.force.scroll;
  const fortress = state.stage === STREET.fortress;
  let pullX = 0;
  let pullZ = 0;
  if (z - STREET.far > 0) pullZ = -(z - STREET.far);
  let d = fortress ? z - (div(STREET.slant * (x - scroll), 1000) + STREET.slantAt) : z + STREET.near;
  if (d < 0) pullZ = -d;
  if (f.computer === 0) {
    const [left, right] = fortress ? STREET.fortressSides : STREET.sides;
    const rel = x - scroll;
    const e0 = div(left[0] * z, 1000) + left[1];
    const e1 = div(right[0] * z, 1000) + right[1];
    if (rel - e0 < 0) pullX = -(rel - e0);
    d = rel - e1;
  } else {
    if (x + STREET.enemies - scroll < 0) pullX = -(x + STREET.enemies - scroll);
    d = x - STREET.enemies - scroll;
  }
  if (d > 0) pullX = -d;
  return [pullX, pullZ];
}

/**
 * The arena's bounds, and the pull back when two fighters drift apart, eased in by each slot's own
 * speed; a held throw carries its partner the same way. Tekken Ball keeps to its court instead,
 * Tekken Force (once the round is on) to its street.
 */
export function keepInBounds(state: FightState, data: FightData, f: Fighter, partner: Fighter): void {
  let pullX = 0;
  let pullZ = 0;
  let pullY = 0;
  const root = f.skeleton.base.translation;
  const x = root[0]!;
  const z = root[2]!;
  const street = state.mode === Mode.TEKKEN_FORCE && state.round.flow !== 0;
  if (state.mode === Mode.TEKKEN_BALL) [pullX, pullY, pullZ] = courtPulls(state, f);
  else if (street) [pullX, pullZ] = streetPulls(state, f);
  else {
    pullX = pullBack(x, ARENA);
    pullZ = pullBack(z, ARENA);
  }
  if (state.mode !== Mode.TEKKEN_BALL && !street && f.targetDistance >>> 0 > 0x1cff) {
    const dx = partner.measuredRoot[0]! - x;
    const dz = partner.measuredRoot[1]! - z;
    const apart = tableRoot(dx * dx + dz * dz, data.math);
    if (apart < DRIFT + 1) {
      if (f.targetDistance >>> 0 <= apart) {
        pullX = f.measuredRoot[0]! - x;
        pullZ = f.measuredRoot[1]! - z;
      }
    } else {
      pullX = div((apart - DRIFT) * sinWide(data, f.towardTarget), 0x7fff);
      pullZ = div((apart - DRIFT) * cosWide(data, f.towardTarget), 0x7fff);
    }
  }
  const cap = state.pulls[f.slot]!;
  const capped = (v: number): number => (cap < Math.abs(v) ? (v < 1 ? -cap : cap) : v);
  const dx = capped(pullX);
  const dy = capped(pullY);
  const dz = capped(pullZ);
  const move = (who: Fighter): void => {
    who.position[0] = (who.position[0]! + dx) | 0;
    who.position[2] = (who.position[2]! + dz) | 0;
    who.position[1] = (who.position[1]! + dy) | 0;
    const r = who.skeleton.base.translation;
    r[0] = (r[0]! + dx) | 0;
    r[2] = (r[2]! + dz) | 0;
    r[1] = (r[1]! + dy) | 0;
  };
  move(f);
  if (f.throwing !== 0 && partner.throwing !== 0 && state.throwCarry !== 0) move(partner);
}

/** Whether a held throw carries its partner this frame: from the frame a second fighter joins the throw. */
export function updateThrowCarry(state: FightState): void {
  if (state.throwsUnderway < 2) state.throwCarry = 0;
  else if (state.throwCarryLast !== state.throwsUnderway) state.throwCarry = 1;
  state.throwCarryLast = state.throwsUnderway;
}

/**
 * In the modes with a third body, one held in a carried throw stands where its thrower does. In
 * Tekken Force one flung far from its thrower a while into the throw stops every throw's carry.
 */
export function followThrower(state: FightState): void {
  const force = state.mode === Mode.TEKKEN_FORCE;
  if (state.mode !== Mode.TEKKEN_BALL && !force) return;
  for (const f of force ? state.fighters : [state.fighters[0]!, state.fighters[1]!]) {
    const t = targetOf(state, f);
    if (f.throwing === 0 || t.throwing === 0 || !(f.throwHold < 0)) continue;
    if (force && FLING.frames < f.framesShown && FLING.distance < pairOf(state, f.slot, t.slot).distance) state.throwCarry = 0;
    if (state.throwCarry === 0) continue;
    f.position[0] = t.position[0]!;
    f.position[2] = t.position[2]!;
  }
}

/** Each slot's pull eases up toward 2000 mm a frame. */
export function easePulls(state: FightState): void {
  for (let i = 0; i < 3; i += 1) {
    if (state.pulls[i]! < PULL_MAX) {
      state.pulls[i] = (state.pulls[i]! + state.pullSpeeds[i]!) | 0;
      state.pullSpeeds[i] = (state.pullSpeeds[i]! + 2) | 0;
    }
    if (state.pulls[i]! > PULL_MAX) {
      state.pulls[i] = PULL_MAX;
      state.pullSpeeds[i] = 2;
    }
  }
}

/** The root's travel this frame. */
export function measureTravel(f: Fighter): void {
  const root = f.skeleton.base.translation;
  for (let i = 0; i < 3; i += 1) {
    f.travel[i] = (root[i]! - f.lastRoot[i]!) | 0;
    f.lastRoot[i] = root[i]!;
  }
}

/** The first attack segment's travel this frame: its end less its start. */
export function measureHandTravel(f: Fighter): void {
  const segment = f.segments[0]!;
  for (let i = 0; i < 3; i += 1) f.handTravel[i] = (segment.to[i]! - segment.from[i]!) | 0;
}

/** Who is pushed this frame: no one yet; a fighter in a throw and its partner are not pushed apart. */
export function markTargets(state: FightState, count: number): void {
  for (let i = 0; i < count; i += 1) {
    const f = state.fighters[i]!;
    f.pushed = 0;
    f.unpushable = 0;
    f.pushedBy.fill(0);
  }
  for (let i = 0; i < count; i += 1) {
    const f = state.fighters[i]!;
    if (f.throwHold !== 0) {
      f.unpushable = 1;
      state.fighters[f.partnerSlot]!.unpushable = 1;
    }
  }
}

/** The push spheres' radii from the character's row, as the move's shape allows. */
export function setPushRadii(data: FightData, f: Fighter): void {
  const move = moveAt(data, f.move!);
  const kind = move.pushShape;
  const row = data.roster.pushRadii[data.roster.rowOf(f.roster)]!;
  const radius = (i: number, value: number): void => {
    f.pushSpheres[i]!.radius = s16(value);
  };
  switch (kind & 0xf) {
    case 0: {
      let withdraw = false;
      if (((kind >> 12) & 1) === 0 || move.activeWindow.first === 0) withdraw = true;
      else if (move.activeWindow.first - 8 < f.frame) withdraw = f.frame < move.activeWindow.last;
      for (let i = 0; i < 8; i += 1) radius(i, withdraw && ((s16(kind) >> (i + 4)) & 1) !== 0 ? 0 : row[i]!);
      break;
    }
    case 1:
    case 5: {
      const halve = (kind & 0xf) === 5 ? 1 : 0;
      for (let i = 0; i < 8; i += 1) radius(i, i === 0 ? row[0]! >> halve : i === 3 ? row[3]! >> halve : 1);
      break;
    }
    case 2:
      for (let i = 0; i < 8; i += 1) radius(i, 1);
      break;
    case 3:
      for (let i = 0; i < 8; i += 1) radius(i, row[i]! >> 1);
      break;
    case 4:
      for (let i = 0; i < 8; i += 1) radius(i, 0);
      break;
    case 6:
      for (let i = 0; i < 8; i += 1) radius(i, i === 0 ? row[0]! + 0x3c : i >= 4 ? 1 : row[i]!);
      break;
    case 7:
      for (let i = 0; i < 8; i += 1) radius(i, row[i]! + 100);
      break;
    default:
      for (let i = 0; i < 8; i += 1) radius(i, row[i]!);
  }
  for (let i = 0; i < 8; i += 1) {
    const legs = i === 6 || i === 7;
    if (move.activeWindow.first === 0) {
      if (f.inAir === 0 || f.beingHit === 0) {
        if (((move.hitFlags >>> 8) & 0x200) !== 0 && (legs || i === 4 || i === 5)) radius(i, 0);
      } else if (legs) radius(i, 0);
    } else if (i === 1 || i === 2) radius(i, 0);
  }
}

/* ---- The push apart. ---- */

/** A 16-bit difference, as the push compares coordinates. */
const diff16 = (a: number, b: number): number => s16((a & 0xffff) - (b & 0xffff));
const round12 = (v: number): number => (v < 0 ? v + 0xfff : v) >> 12;

/**
 * The deepest overlap between the two bodies' push spheres, raised to 400 mm when both attack face
 * to face within half a metre, shared between them by how far each moved this frame, and set as each
 * one's push, halved unless they were closing head on.
 */
function overlap(state: FightState, data: FightData, a: Fighter, b: Fighter): void {
  a.push.fill(0);
  b.push.fill(0);
  const cos12 = (angle: number): number => data.math.sine[(angle & 0xfff) + 0x400]!;
  const sin12 = (angle: number): number => data.math.sine[angle & 0xfff]!;
  let deepest = 0;
  let headOn = false;
  for (const own of a.pushSpheres) {
    if ((own.radius & 0xffff) === 0) continue;
    for (const theirs of b.pushSpheres) {
      if ((theirs.radius & 0xffff) === 0) continue;
      const reach = ((own.radius & 0xffff) + (theirs.radius & 0xffff)) & 0xffff;
      const dx = diff16(theirs.position[0]!, own.position[0]!);
      if (!(Math.abs(dx) < reach)) continue;
      const dy = diff16(theirs.position[1]!, own.position[1]!);
      if (!(Math.abs(dy) < reach)) continue;
      const dz = diff16(theirs.position[2]!, own.position[2]!);
      if (!(Math.abs(dz) < reach)) continue;
      const apart = tableRoot(dx * dx + dy * dy + dz * dz, data.math);
      if (s16(deepest) < s16(reach - apart)) deepest = s16(reach - apart);
    }
  }
  const ra = a.skeleton.base.translation;
  const rb = b.skeleton.base.translation;
  let skipped = false;
  if (moveAt(data, a.move!).activeWindow.first !== 0 && moveAt(data, b.move!).activeWindow.first !== 0) {
    if (s16(deepest) < 1) {
      const gap = ra[1]! - rb[1]!;
      if (gap < 0 ? rb[1]! - ra[1]! > 299 : gap > 299) skipped = true;
    }
    if (!skipped) {
      const ahead = (f: Fighter): [number, number] => {
        let facing = f.facing;
        if (facing < 0) facing += 0xf;
        const q = (0x400 - (facing >> 4)) & 0xfff;
        const r = f.skeleton.base.translation;
        return [r[0]! + round12(cos12(q) * 200), r[2]! + round12(sin12(q) * 200)];
      };
      const [ax, az] = ahead(a);
      const [bx, bz] = ahead(b);
      const gx = bx - ax;
      const gz = bz - az;
      if (Math.abs(gx) < 500 && Math.abs(gz) < 500 && (b.position[0]! - a.position[0]!) * gx + (b.position[2]! - a.position[2]!) * gz < 0) {
        headOn = true;
        if (s16(deepest) < 400) deepest = 400;
      }
    }
  }
  if (skipped || !(s16(deepest) > 0)) return;
  const lastA = state.lastRoots[a.slot]!;
  const lastB = state.lastRoots[b.slot]!;
  const [xa, ya, za] = [ra[0]!, ra[1]!, ra[2]!];
  const [xb, yb, zb] = [rb[0]!, rb[1]!, rb[2]!];
  const moved = (v: number[]): number => tableRoot(v[0]! * v[0]! + v[1]! * v[1]! + v[2]! * v[2]!, data.math);
  let stepA = moved([diff16(xa, lastA[0]!), diff16(ya, lastA[1]!), diff16(za, lastA[2]!)]);
  let stepB = moved([diff16(xb, lastB[0]!), diff16(yb, lastB[1]!), diff16(zb, lastB[2]!)]);
  const away = (f: Fighter, bearing: number): number => {
    let facing = f.facing;
    if (facing < 0) facing += 0xf;
    let dir = -(facing >> 4) + 0x400;
    let off = (dir - s16(bearing)) & 0xfff;
    if (off > 0x7ff) off = 0x1000 - off;
    if (off > 0x400) dir = -(facing >> 4) + 0xc00;
    return dir;
  };
  const bearing = angle4096(xb - xa, zb - za, data.math);
  const dirA = away(a, bearing);
  const dirB = away(b, bearing + 0x800);
  const backB = [round12(cos12(dirB) * stepB), round12(sin12(dirB) * stepB)];
  const backA = [round12(cos12(dirA) * stepA), round12(sin12(dirA) * stepA)];
  if (stepA === 0 && stepB === 0) {
    stepA = 1;
    stepB = 1;
  }
  let total = stepA + stepB;
  if (total === 0) total = 1;
  const shareA = div(s16(deepest) * stepA, total);
  const shareB = div(s16(deepest) * stepB, total);
  /* Each body is carried along the other's motion, less its own share of the overlap. */
  const nxA = xa + backB[0]! - round12(cos12(dirA) * shareA);
  const nzA = za + backB[1]! - round12(sin12(dirA) * shareA);
  const nxB = xb + backA[0]! - round12(cos12(dirB) * shareB);
  const nzB = zb + backA[1]! - round12(sin12(dirB) * shareB);
  const half = headOn ? 0 : 1;
  a.push[0] = (nxA - xa) >> half;
  a.push[1] = (ya - ra[1]!) >> half;
  a.push[2] = (nzA - za) >> half;
  b.push[0] = (nxB - xb) >> half;
  b.push[1] = (yb - rb[1]!) >> half;
  b.push[2] = (nzB - zb) >> half;
}

/** When two fighters stand close, both in play and not both held, their bodies are pushed apart, each by its push. */
export function pushApart(state: FightState, data: FightData, a: Fighter, b: Fighter): void {
  const pair = pairOf(state, a.slot, b.slot);
  if (!(pair.distance >>> 0 < 0xbb9)) return;
  if (!(a.unpushable === 0 || b.unpushable === 0)) return;
  if (a.pushImmune === 1 || b.pushImmune === 1 || a.present === 0 || b.present === 0) return;
  overlap(state, data, a, b);
  for (const [f, other] of [
    [a, b],
    [b, a],
  ] as const) {
    if (f.push[0] === 0 && f.push[1] === 0 && f.push[2] === 0) continue;
    f.pushed = 1;
    f.pushedBy[other.slot] = 1;
    /* Tekken Force: while a throw is under way, a body pushed is pushed twice as far, one held in the throw not at all. */
    if (state.mode === Mode.TEKKEN_FORCE && 1 < state.throwsUnderway) {
      for (let i = 0; i < 3; i += 1) f.push[i] = f.unpushable === 0 ? f.push[i]! << 1 : 0;
    }
    const r = f.skeleton.base.translation;
    for (let i = 0; i < 3; i += 1) {
      f.position[i] = (f.position[i]! + f.push[i]!) | 0;
      r[i] = (r[i]! + f.push[i]!) | 0;
    }
  }
}
