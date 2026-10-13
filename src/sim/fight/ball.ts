/**
 * Tekken Ball's ball, a frame at a time. The court is split down the middle: the first fighter
 * owns x below 0, the second above. A round opens with the ball fading in over the server's half,
 * then hovering until touched (or dropping after 600 frames). A fighter's attack meeting the ball
 * touches it: by the move's damage and level a plain return, a low touch, an air touch, a smash, a
 * homing shot, a set-up and the spike off it, or Yoshimitsu's blade bursting it; a damaging touch
 * charges the toucher's side by the ball's share of its damage and makes that the ball's power.
 * The charged ball meeting the other fighter strikes it with that power (the hit code takes it from
 * the third fighter, the toucher's copy); a harmless one bounces off toward the other. The ball
 * landing on a side's half outside the middle strip is a point against it: thirty health, its
 * charge, and a blast off its feet; the ball then reappears high over the centre. Its looks, its
 * replay ring, its glows, its rising popups and the two charge gauges are kept here too.
 */
import { angle4096, cosine, sine } from '../math/angles.ts';
import { cpuDiv, div, s16 } from '../math/integers.ts';
import { rotateLong } from '../math/matrix.ts';
import { projectPoint } from '../math/projection.ts';
import { nextRandom } from '../math/random.ts';
import { isqrt } from '../math/roots.ts';
import { flashPullFrom } from './pose.ts';
import { burnFighter, objectAt, spawnBallGlow, takeObject } from '../effects/pool.ts';
import { recordEvent } from '../effects/sparks.ts';
import { startShake } from './camera.ts';
import { hitOf, moveAt } from './moves.ts';
import { segmentMeetsSphere } from './hits.ts';
import { resetFighter } from './start.ts';
import { ReplayState } from './replay.ts';
import { shakeVibration, sparkVibration } from './vibration.ts';
import { voiceLine } from './voices.ts';
import type { BallState, FightData, FightState, Fighter } from './state.ts';

/** The ball's states. */
export const BallStep = { OPENING: 0, CENTRE: 1, PLAY: 2, SET_UP: 3, SPIKE: 4, REBOUND: 5, RESET: 6, POINT: 7, SERVE_WAIT: 8, HOVER: 9 } as const;
/** The ball's looks the glows and the replay read. */
const Look = { POINT: 2, LEFT_CHARGED: 6, RIGHT_CHARGED: 7, BURNING: 9 } as const;

const Sound = { OPENED: 0x4ce8, CENTRED: 0x4ce9, BOUNCE: 0x4e6e, HARMLESS: 0x704e, SET_UP: 0x7082, SPIKE: 0x4daf, WEAK: 0x4e6d, GUARDED: 0x7043 } as const;
/** The court: the floor's contact height, the far ends, the ceiling, the stall's frames, a fighter's start, the serve's place. */
const FLOOR = -0x180;
const FAR = 0x2800;
const CEILING = -0x2000;
const SPIKE_TOP = -0x1400;
const STALL = 600;
const START_X = 0x1400;
const SERVE = { x: 0xd00, y: -0x500 } as const;
const CENTRE_Y = -0xe40;
/** A touch's sphere; the ball's hover; a point's health. */
const SPHERE = { radius: 0x260, square: 0x5a400 } as const;
const POINT_DAMAGE = 0x1e0000;
/** Levels a touch reads (a move's hit level). */
const Level = { HIGH: 0x412, MID_A: 0x31f, MID_B: 0x217, LOW_A: 0x10f, LOW_B: 0x51f, UNBLOCKABLE_A: 0x607, UNBLOCKABLE_B: 0x706 } as const;
/** Yoshimitsu's moveset and the one move of his blade that does not burst the ball. */
const YOSHIMITSU = 4;
const UNBURSTING = 0x181;
/** The burn's replays, an iron ball's; the replay event a burn records. */
const IRON = 2;
const BURN_REPLAYS = 6;
const BURN_EVENT = 0x82;
/** A charged strike's strong power, and the power that burns. */
const STRONG = 0x32;
const BURNS = 0x64;
/** The gauges: their length, and the charge they show full. */
const GAUGE = { length: 0x4c, full: 0x64 } as const;
/** A popup's frames, and how far its text is pulled back by font. */
const POPUP_LIFE = 0x1e;
const POPUP_SHIFT: readonly (readonly [number, number])[] = [
  [5, 8],
  [7, 0xc],
  [0xc, 0x14],
];

/** Each side's shove from its move cleared. */
export function clearShoves(state: FightState): void {
  for (const shove of state.ball.shoves) Object.assign(shove, { angle: 0, speed: 0, first: 0, last: 0, cancelFrame: 0 });
}

/** The ball's tracks a step on: each from where it last went to, to the ball's place plus its offset. */
function stepSegments(ball: BallState, data: FightData): void {
  ball.segments.forEach((segment, k) => {
    const offset = data.ball.tracks[k]!;
    for (let i = 0; i < 3; i += 1) {
      segment.from[i] = segment.to[i]!;
      segment.to[i] = (ball.position[i]! + offset[i]!) | 0;
    }
  });
}

/** The ball reset for a round: over the server's half, the server its last toucher, nothing charged. */
function resetBall(state: FightState, data: FightData): void {
  const ball = state.ball;
  const server = state.match.ball.server;
  ball.state = BallStep.OPENING;
  ball.timer = state.round.number === 1 ? 0x64 : 0x28;
  ball.position.splice(0, 3, server !== 0 ? SERVE.x : -SERVE.x, SERVE.y, 0);
  ball.lastHitter = server;
  ball.target = 1 - server;
  ball.spinRate.splice(0, 3, 0x20, 0x10, 4);
  ball.spin.fill(0);
  ball.speed = 0;
  ball.charge.fill(0);
  ball.power = 0;
  ball.velocity.fill(0);
  ball.accel.fill(0);
  ball.accel[1] = ball.gravity;
  ball.heading = 0;
  ball.homing = 0;
  ball.stretchAngles.fill(0);
  ball.stretch = 0;
  ball.cooldown = 0;
  ball.combo = 0;
  ball.sphere.radius = SPHERE.radius;
  ball.sphere.square = SPHERE.square;
  ball.sphere.centre.splice(0, 3, ...ball.position);
  stepSegments(ball, data);
  stepSegments(ball, data);
}

/** A round's start: the ball's kind read, the ball reset, the fighters placed at the court's ends, the popups and gauges cleared, two replays to show. */
export function startBallRound(state: FightState, data: FightData): void {
  const ball = state.ball;
  const kind = data.ball.kinds[state.match.ball.kind]!;
  ball.unit = kind.unit;
  ball.lift = kind.lift;
  ball.gravity = kind.gravity;
  ball.percent = kind.percent;
  ball.strip = kind.strip;
  resetBall(state, data);
  for (let i = 0; i < 2; i += 1) {
    const f = state.fighters[i]!;
    f.position[0] = i === 0 ? -START_X : START_X;
    f.position[2] = 0;
    f.facing = i === 0 ? 0x4000 : 0xc000;
    resetFighter(state, data, f, state.fighters[1 - i]!, false);
  }
  for (const popup of ball.popups) popup.inUse = 0;
  ball.popupNext = 0;
  ball.popupList.length = 0;
  for (const gauge of ball.gauges) Object.assign(gauge, { last: 0, target: 0, shown: 0, trail: 0 });
  state.match.ball.replaysShown = 0;
  state.match.ball.replaysWanted = 2;
  ball.glows = 0;
  ball.touchSoundWait = 0;
}

/** A fighter's shove from its move (its side's): a short dash back and its cancel. */
export function ballShoves(state: FightState, f: Fighter): void {
  const shove = state.ball.shoves[f.movesetSlot]!;
  Object.assign(shove, { angle: 0, speed: 0, first: 0, last: 0, cancelFrame: 0 });
  const id = f.moveId;
  if (id === 0x18 || id === 0x1a) Object.assign(shove, { angle: 0x8000, speed: 0x1e, first: 3, last: 9 });
  else if (id === 0x1e || id === 0x20) Object.assign(shove, { angle: 0x8000, speed: 0x96, first: 5, last: 0xc, cancelFrame: 0x12 });
  else if (id === 0x1f || id === 0x21) shove.cancelFrame = 0x12;
}

/** A rising popup over a point of the court: its text, colour and font, for its frames. */
function popup(state: FightState, text: string, at: readonly number[], colour: number, font: number): void {
  const ball = state.ball;
  ball.popupNext = (ball.popupNext + 1) % ball.popups.length;
  const record = ball.popups[ball.popupNext]!;
  if (record.inUse !== 0) return;
  const point = projected(state, at);
  const [dx, dy] = POPUP_SHIFT[font] ?? [0, 0];
  Object.assign(record, { text, x: s16(point.x - text.length * dx), y: s16(point.y - dy), colour, font, life: POPUP_LIFE, inUse: 1 });
  ball.popupList.unshift(ball.popupNext);
}

/** Where a point of the court lands on the screen. */
function projected(state: FightState, at: readonly number[]): { x: number; y: number } {
  const moved = [0, 0, 0];
  rotateLong(state.view.rotation, at[0]!, at[1]!, at[2]!, moved);
  return projectPoint(state.screen, (moved[0]! + state.view.translation[0]!) | 0, (moved[1]! + state.view.translation[1]!) | 0, (moved[2]! + state.view.translation[2]!) | 0);
}

/** The popups printed, newest first, each rising a line a frame until its frames run out (held while paused). */
function showPopups(state: FightState, held: boolean): void {
  const ball = state.ball;
  for (const index of [...ball.popupList]) {
    const record = ball.popups[index]!;
    if (!held && record.life === 0) {
      record.inUse = 0;
      ball.popupList.splice(ball.popupList.indexOf(index), 1);
      continue;
    }
    state.hud.prints.push({ font: record.font, colour: record.colour, x: record.x, y: record.y, text: record.text });
    if (!held) {
      record.y = s16(record.y - 1);
      record.life -= 1;
    }
  }
}

/** The charge gauges a frame on: each toward its side's charge, three a frame, its trail falling behind. */
function stepGauges(state: FightState): void {
  const ball = state.ball;
  ball.gauges.forEach((gauge, i) => {
    const value = ball.charge[i]!;
    if (value !== gauge.last) {
      gauge.last = value;
      gauge.target = div(value * GAUGE.length, GAUGE.full);
    }
    gauge.target = Math.min(gauge.target, GAUGE.length);
    const trail = gauge.shown < gauge.trail ? gauge.trail - ((gauge.trail - gauge.shown + 0xf) >> 4) : gauge.shown;
    const shown = gauge.target <= gauge.shown ? gauge.target : Math.min(gauge.shown + 3, gauge.target);
    gauge.shown = shown;
    gauge.trail = trail < shown ? shown : trail;
  });
  ball.gaugeLit = ball.power !== 0 ? 1 << state.fighters[ball.lastHitter]!.slot : 0;
}

/** The replay's ring: the ball's frame kept while recording, played back while a replay plays (its glows with it). */
function replayRing(state: FightState): void {
  const ball = state.ball;
  const replay = state.replay;
  if (replay.state === ReplayState.RECORDING) {
    const frame = replay.ball[replay.recordFrame % replay.ball.length]!;
    frame.position.splice(0, 4, ...ball.position, ball.w);
    frame.spin.splice(0, 2, ball.spin[0]!, ball.spin[1]!);
    frame.look = ball.look;
    frame.timer = ball.timer;
    frame.stretchAngles.splice(0, 4, ...ball.stretchAngles, ball.stretchPad);
    frame.stretch = ball.stretch;
    return;
  }
  if (replay.state !== ReplayState.PLAYING && replay.state !== ReplayState.STARTING) return;
  const frame = replay.ball[(replay.playFrame >> 1) % replay.ball.length]!;
  ball.position.splice(0, 3, frame.position[0]!, frame.position[1]!, frame.position[2]!);
  ball.w = frame.position[3]!;
  ball.spin[0] = frame.spin[0]!;
  ball.spin[1] = frame.spin[1]!;
  ball.look = frame.look;
  ball.timer = frame.timer;
  ball.stretchAngles.splice(0, 3, frame.stretchAngles[0]!, frame.stretchAngles[1]!, frame.stretchAngles[2]!);
  ball.stretchPad = frame.stretchAngles[3]!;
  ball.stretch = frame.stretch;
  if (ball.look === Look.RIGHT_CHARGED) spawnBallGlow(state, 1);
  else if (ball.look === Look.LEFT_CHARGED) spawnBallGlow(state, 0);
  else if (ball.look === Look.BURNING) spawnBallGlow(state, 2);
}

/** Which of the two fighters' attacks meet the ball's sphere (bit 2 the first, bit 1 the second, 8 an effect's), and the meeting segment's direction. */
function touches(state: FightState, data: FightData, dir: number[]): number {
  const ball = state.ball;
  let hits = 0;
  const sphere = { position: ball.sphere.centre, radius: ball.sphere.radius, radiusSquared: ball.sphere.square };
  for (const [i, bit] of [
    [0, 2],
    [1, 1],
  ] as const) {
    const f = state.fighters[i]!;
    let segments: readonly { readonly from: readonly number[]; readonly to: readonly number[] }[];
    let count: number;
    if (f.move === null) continue;
    if ((hitOf(data, f.move)?.codes[0] ?? 0) < 0x18) {
      segments = f.segments;
      count = Math.min(f.attackSegments, 4);
    } else {
      hits |= 8;
      if (2 < f.slot) continue;
      segments = state.effectSegments[f.slot === 0 ? 0 : 1]!;
      count = state.effectSegmentCounts[f.slot === 0 ? 0 : 1]!;
    }
    for (let k = 0; k < count; k += 1) {
      const segment = segments[k]!;
      if (!segmentMeetsSphere(segment.from, segment.to, sphere)) continue;
      hits |= bit;
      for (let n = 0; n < 3; n += 1) dir[n] = (segment.to[n]! - segment.from[n]!) | 0;
      break;
    }
  }
  return hits;
}

/** Which fighters the ball's tracks meet (bit 2 the first, 1 the second), the struck one's hit record written. */
function meetsFighters(state: FightState): number {
  const ball = state.ball;
  let hits = 0;
  for (const [i, bit] of [
    [0, 2],
    [1, 1],
  ] as const) {
    const f = state.fighters[i]!;
    found: for (let s = 0; s < f.hitSpheres.length; s += 1) {
      const sphere = f.hitSpheres[s]!;
      if (sphere.radius === 0) continue;
      for (const segment of ball.segments) {
        if (!segmentMeetsSphere(segment.from, segment.to, sphere)) continue;
        hits |= bit;
        const record = f.hitRecords[0]!;
        record.part = s;
        for (let n = 0; n < 3; n += 1) {
          record.point[n] = segment.to[n]!;
          record.direction[n] = s16(segment.to[n]! - segment.from[n]!);
        }
        break found;
      }
    }
  }
  return hits;
}

/** The fields, by their path in the record, that hold a reference to the loaded data: shared, never written into. */
const REFERENCES = new Set(['rootMove', 'move', 'steps', 'reaction', 'next.move', 'blend.from', 'blend.to', 'blend.lastMove']);

/** Every field of one record copied onto another, into the copy's own arrays and objects; `path` the fields' place in the record. */
function copyInto(to: Record<string, unknown>, from: Record<string, unknown>, path = ''): void {
  if (Array.isArray(from) && Array.isArray(to)) to.length = from.length;
  for (const key of Object.keys(from)) {
    const value = from[key];
    const into = to[key];
    const at = path === '' ? key : `${path}.${key}`;
    if (REFERENCES.has(at) || value === null || typeof value !== 'object' || into === null || typeof into !== 'object') to[key] = value;
    else if (ArrayBuffer.isView(value)) (into as Uint8Array).set(value as Uint8Array);
    else copyInto(into as Record<string, unknown>, value as Record<string, unknown>, at);
  }
}

/** A damaging touch's charge: the ball's share of the move's damage added to the toucher's side and carried, its popup, and the ball sped up. */
function charge(state: FightState, h: Fighter, d: number, base: number, lo: number, hi: number): void {
  const ball = state.ball;
  if (ball.power !== 0) {
    ball.chained = 1;
    ball.combo = (ball.combo + 1) & 0xff;
  }
  const add = div(d * ball.percent, 0x64);
  ball.charge[h.movesetSlot] = s16((ball.charge[h.movesetSlot]! + add) & 0xffff);
  ball.power = ball.charge[h.movesetSlot]!;
  popup(state, String(add), ball.position, state.fighters[ball.lastHitter]!.slot === 0 ? 2 : 5, 1);
  ball.homing = 1;
  const n = Math.min(Math.max(s16(base), lo), hi);
  ball.speed = (n + ball.combo) * ball.unit + (ball.chained !== 0 ? ball.speed >> 4 : 0);
}

/** A fighter's attack touched the ball: the toucher copied into the third fighter, and the ball sent by the move. */
function touch(state: FightState, data: FightData, hits: number, dir: number[]): void {
  const ball = state.ball;
  const h = state.fighters[(hits & 2) !== 0 ? 0 : 1]!;
  const o = state.fighters[(hits & 2) !== 0 ? 1 : 0]!;
  if (h.hitSlots[2] !== 0) return;
  sparkVibration(state, h.movesetSlot, 5);
  ball.lastHitter = h.slot;
  ball.target = o.slot;
  ball.homing = 0;
  const copy = state.fighters[2]!;
  copyInto(copy as unknown as Record<string, unknown>, h as unknown as Record<string, unknown>);
  copy.slot = 2;
  copy.recovery = 1;
  copy.level = 0xffff;
  copy.counterWindow = 1;
  h.hitSlots[2] = 1;
  h.hitLanded = 1;
  h.struck = 1;
  h.struckSlot = 2;
  ball.cooldown = 5;
  ball.heading = s16(angle4096((o.skeleton.base.translation[0]! - ball.position[0]!) | 0, (o.skeleton.base.translation[2]! - ball.position[2]!) | 0, data.math));
  anglesOf(data, ball.stretchAngles, dir);
  ball.stretchHeld = 1;
  ball.stretch = s16(h.attackDamage * 8 + 0x140);
  const d = s16(h.attackDamage);
  const level = h.level & 0xffff;
  const g = ball.gravity;
  const unblockable = level === Level.UNBLOCKABLE_A || level === Level.UNBLOCKABLE_B;
  if ((hits & 3) === 3) {
    ball.power = 0;
    ball.speed = 0;
    ball.state = BallStep.PLAY;
    ball.velocity[1] = -0x25 * g;
    ball.accel[1] = g;
  } else if (h.character === YOSHIMITSU && unblockable && (hits & 8) === 0 && h.moveId !== UNBURSTING) {
    h.health = Math.max(h.health - (ball.charge[o.slot]! << 16), 0);
    ball.charge.fill(0);
    ball.state = BallStep.POINT;
    ball.timer = 5;
    ball.pointAgainst = h.slot + 1;
  } else if (d === 0 && 0 < ball.power) {
    ball.state = BallStep.SET_UP;
    ball.velocity[1] = -0x25 * g;
    ball.accel[1] = g;
    ball.spikeSpeed = s16((ball.speed & 0xffff) + ball.unit * 5);
    ball.speed = Math.max((d + 8) * ball.lift + Math.abs(ball.position[0]!) - (ball.speed >> 2), 0);
    ball.power = 0;
    ball.cooldown = (ball.cooldown + 2) & 0xff;
    popup(state, '!', ball.position, 1, 1);
    voiceLine(state, data, 0, Sound.SET_UP, 0);
  } else if (d === 0 || (level === Level.HIGH && ball.state !== BallStep.SET_UP)) {
    ball.velocity[1] = -0x25 * g;
    ball.accel[1] = g;
    ball.speed = Math.max((d + 10) * ball.lift + Math.abs(ball.position[0]!) - (ball.speed >> 2), 0);
    ball.power = 0;
    ball.state = BallStep.PLAY;
  } else if (unblockable) {
    ball.homing = 1;
    ball.speed = ball.unit * 0x3c;
    ball.accel[1] = s16(g) >> 2;
    ball.power = ball.charge[h.movesetSlot]!;
    ball.state = BallStep.PLAY;
    ball.velocity[1] = (o.skeleton.base.translation[2]! - 2 * ball.position[1]! - state.distance) | 0;
    popup(state, '!', ball.position, 2, 1);
  } else if (h.inAir !== 0) {
    charge(state, h, d, d + 0xf, 0x14, 0x28);
    ball.accel[1] = s16(g) >> 1;
    ball.state = BallStep.PLAY;
    ball.velocity[1] = (o.skeleton.base.translation[2]! - ball.position[1]! - state.distance) | 0;
  } else if (level === Level.MID_A || level === Level.MID_B) {
    charge(state, h, d, d + 0x12, 0x14, 0x2e);
    ball.accel[1] = s16(g) >> 2;
    ball.state = BallStep.PLAY;
    ball.velocity[1] = (o.skeleton.base.translation[2]! - 2 * ball.position[1]! - state.distance) | 0;
  } else if (level === Level.LOW_A || level === Level.LOW_B) {
    ball.velocity[1] = -0x32 * g;
    ball.accel[1] = g;
    ball.speed = (s16(d) >> 2) * ball.lift + Math.abs(ball.position[0]!);
    ball.power = 0;
    ball.state = BallStep.PLAY;
  } else if (level === Level.HIGH && ball.state === BallStep.SET_UP) {
    ball.state = BallStep.SPIKE;
    ball.spikeTarget = o.slot;
    ball.velocity[1] = -0x48 * g;
    ball.accel[1] = g;
    ball.speed = ball.lift * 10;
    voiceLine(state, data, 0, Sound.SPIKE, 0);
    if (ball.power !== 0) {
      ball.chained = 1;
      ball.combo = (ball.combo + 1) & 0xff;
    }
    const add = div(d * ball.percent, 0x64);
    ball.charge[h.movesetSlot] = s16((ball.charge[h.movesetSlot]! + add) & 0xffff);
    ball.power = ball.charge[h.movesetSlot]!;
    popup(state, String(add), ball.position, state.fighters[ball.lastHitter]!.slot === 0 ? 2 : 5, 1);
    ball.homing = 1;
  }
}

/** A vector's angles as the stretch takes them: none about x, its yaw, its pitch (signed by its x). */
function anglesOf(data: FightData, out: number[], v: readonly number[]): void {
  out[0] = 0;
  out[1] = s16(angle4096(v[0]!, v[2]!, data.math));
  const pitch = angle4096(v[0]!, v[1]!, data.math);
  out[2] = s16(0 < v[0]! ? pitch : -pitch);
}

/** The ball met a fighter with no touch this frame: a harmless bounce toward the other, or the charged ball's strike. */
function meet(state: FightState, data: FightData, hits: number): void {
  const ball = state.ball;
  const v = state.fighters[(hits & 2) !== 0 ? 0 : 1]!;
  const o = state.fighters[(hits & 2) !== 0 ? 1 : 0]!;
  if (v.slot === ball.lastHitter && ball.power !== 0) return;
  ball.homing = 0;
  if (ball.state !== BallStep.SET_UP) ball.state = BallStep.PLAY;
  ball.heading = s16(angle4096((o.skeleton.base.translation[0]! - ball.position[0]!) | 0, (o.skeleton.base.translation[2]! - ball.position[2]!) | 0, data.math));
  const distance = state.distance;
  const k = (distance >>> 7) + 0xc;
  const g = ball.gravity;
  ball.accel[1] = g;
  ball.velocity[1] = ((-g * k) >> 1) - (ball.position[1]! + 0x1000);
  ball.speed = div((distance > 0x800 ? distance - 0x800 : 0x400) << 8, k);
  if (ball.power === 0 || ball.lastHitter === v.slot) {
    if (ball.touchSoundWait === 0) {
      voiceLine(state, data, 0, Sound.HARMLESS, 0);
      ball.touchSoundWait = 10;
    }
    ball.lastHitter = v.slot;
    ball.target = o.slot;
    return;
  }
  const copy = state.fighters[2]!;
  ball.lastHitter = v.slot;
  ball.target = o.slot;
  ball.state = BallStep.PLAY;
  ball.struck = 1;
  copy.attackDamage = ball.power;
  ball.power = 0;
  copy.hitSlots[o.slot] = 1;
  copy.hitLanded = 1;
  copy.struck = 1;
  copy.struckSlot = o.slot;
  v.beingHit = 1;
  v.hitReacting = 1;
  v.freezeOnHit = copy.move === null ? 0 : moveAt(data, copy.move).hitStun & 0xff;
  v.hitRecords[0]!.used = 1;
  v.hitRecords[0]!.attacker = 2;
  if (copy.attackDamage !== 0 || v.inAir !== 0) v.untouchable = 4;
  const burns = BURNS <= copy.attackDamage || ball.look === Look.BURNING;
  if ((v.guard & copy.level) === 0) {
    if (burns) {
      burnFighter(state, data, v.slot);
      recordEvent(state, v.slot, BURN_EVENT, { point: ball.position, direction: [0, 0, 0] }, 0);
      if (state.match.ball.kind === IRON) state.match.ball.replaysWanted = BURN_REPLAYS;
    }
    ball.speed = 0;
    ball.combo = 0;
    ball.charge.fill(0);
    ball.state = BallStep.REBOUND;
    ball.lastHitter = v.slot;
    ball.target = v.slot;
    ball.cooldown = 5;
    ball.velocity[1] = -0x25 * g;
    ball.accel[1] = s16(g) >> 1;
    voiceLine(state, data, 0, copy.attackDamage < STRONG ? Sound.WEAK : Sound.SPIKE, 0);
    return;
  }
  voiceLine(state, data, 0, Sound.GUARDED, 0);
  if (burns && v.health <= copy.attackDamage << 13) {
    burnFighter(state, data, v.slot);
    recordEvent(state, v.slot, BURN_EVENT, { point: ball.position, direction: [0, 0, 0] }, 0);
  }
}

/** Where every path in play ends: the ball moved, its tracks stepped, its spin, kept near the fighters' line, and a homing ball steered. */
function tail(state: FightState, data: FightData, hits: number): void {
  const ball = state.ball;
  const [a, b] = state.fighters;
  ball.velocity[0] = (Math.imul(cosine(data.math, ball.heading), ball.speed) >> 12) | 0;
  ball.velocity[2] = (Math.imul(sine(data.math, ball.heading), ball.speed) >> 12) | 0;
  if (ball.state === BallStep.HOVER) {
    ball.position[1] = (s16(sine(data.math, (ball.timer & 0x7f) * 0x20)) >> 4) - 0x500;
    ball.timer = (ball.timer + 1) & 0xff;
    if (STALL <= state.round.frames) {
      ball.state = BallStep.PLAY;
      ball.velocity[1] = 0;
    }
  } else for (let k = 0; k < 3; k += 1) ball.position[k] = (ball.position[k]! + (ball.velocity[k]! >> 8)) | 0;
  stepSegments(ball, data);
  ball.velocity[1] = (ball.velocity[1]! + ball.accel[1]!) | 0;
  if (hits !== 0 && ball.state !== BallStep.SET_UP) {
    ball.spinRate[2] = s16(Math.imul(cosine(data.math, ball.heading), ball.speed) >> (ball.homing !== 0 ? 17 : 19));
    ball.spinRate[0] = s16(ball.spinRate[2]!) >> 2;
    ball.spinRate[1] = s16(Math.imul(sine(data.math, ball.heading), ball.speed) >> 19);
  }
  for (let k = 0; k < 3; k += 1) ball.spin[k] = (ball.spin[k]! + ball.spinRate[k]!) & 0xffff;
  const mid = (a!.skeleton.base.translation[2]! + b!.skeleton.base.translation[2]!) >> 1;
  const z0 = ball.position[2]!;
  if (z0 - mid > 0x80) ball.position[2] = mid + 0x80;
  if (ball.position[2]! - mid < -0x80) ball.position[2] = mid - 0x80;
  ball.spin[0] = (ball.spin[0]! + (ball.position[2]! - z0)) & 0xffff;
  const t = state.fighters[ball.target]!;
  const [tx, tz] = [t.skeleton.base.translation[0]!, t.skeleton.base.translation[2]!];
  let heading = s16(ball.heading);
  if (heading < -0x800) heading += 0x1000;
  if (0x800 < heading) heading -= 0x1000;
  ball.heading = heading;
  if (ball.homing === 0) return;
  ball.heading = s16(angle4096((tx - ball.position[0]!) | 0, (tz - ball.position[2]!) | 0, data.math));
  if (!(0x1000 < ball.speed)) return;
  const dx = (ball.position[0]! - tx) | 0;
  const dz = (ball.position[2]! - tz) | 0;
  const d = isqrt((Math.imul(dx, dx) + Math.imul(dz, dz)) | 0);
  const n = cpuDiv(d, ball.speed >> 8);
  const vy = ball.velocity[1]!;
  const aim = cpuDiv((vy - (((ball.position[1]! + ((vy + Math.imul(n, ball.accel[1]!)) >> 8)) - t.skeleton.joints[1]!.world.translation[1]!) << 8)) | 0, n);
  ball.velocity[1] = (((Math.imul(vy, 0xd) + Math.imul(aim, 3)) << 8) >> 12) | 0;
}

/** The ball's step. */
function stepBall(state: FightState, data: FightData): void {
  const ball = state.ball;
  const [a, b] = state.fighters as unknown as [Fighter, Fighter];
  const type = state.match.ball.kind;
  if (ball.cooldown === 0) ball.chained = 0;
  ball.struck = 0;
  ball.pointAgainst = 0;
  const g = ball.gravity;
  switch (ball.state) {
    case BallStep.OPENING:
      ball.timer = (ball.timer - 1) & 0xff;
      if (ball.timer === 0) {
        ball.state = BallStep.SERVE_WAIT;
        ball.timer = 0x20;
        voiceLine(state, data, 0, Sound.OPENED, 0);
      }
      return;
    case BallStep.CENTRE:
    case BallStep.SERVE_WAIT: {
      ball.timer = (ball.timer - 1) & 0xff;
      if (ball.timer !== 0) return;
      ball.state = ball.state === BallStep.SERVE_WAIT ? BallStep.HOVER : BallStep.PLAY;
      ball.speed = 0;
      ball.cooldown = 0;
      ball.heading = 0;
      ball.homing = 0;
      const ax = Math.min(a.skeleton.base.translation[0]!, 0);
      const bx = Math.max(b.skeleton.base.translation[0]!, 0);
      const dz = (b.skeleton.base.translation[2]! - a.skeleton.base.translation[2]!) | 0;
      const w = (bx - ax) | 0;
      if (w !== 0) ball.position[2] = (a.skeleton.base.translation[2]! + cpuDiv(Math.imul((ball.position[0]! - ax) | 0, dz), w)) | 0;
      else ball.position[0] = (ax + cpuDiv(0, dz)) | 0;
      return;
    }
    case BallStep.RESET:
      ball.power = 0;
      ball.combo = 0;
      ball.timer = (ball.timer - 1) & 0xff;
      if (ball.timer !== 0) return;
      ball.state = BallStep.CENTRE;
      ball.timer = 0x20;
      ball.position.splice(0, 3, 0, CENTRE_Y, (a.skeleton.base.translation[2]! + b.skeleton.base.translation[2]!) >> 1);
      ball.velocity.fill(0);
      ball.accel[0] = 0;
      ball.accel[2] = 0;
      ball.accel[1] = s16(g) >> 1;
      ball.spinRate.fill(0);
      stepSegments(ball, data);
      stepSegments(ball, data);
      if (state.freezeHealth === 0) voiceLine(state, data, 0, Sound.CENTRED, 0);
      return;
    case BallStep.POINT:
      ball.power = 0;
      ball.combo = 0;
      ball.timer = (ball.timer - 1) & 0xff;
      if (ball.timer === 0) {
        ball.state = BallStep.RESET;
        ball.timer = 0x10;
      }
      return;
  }
  /* In play. */
  let hits = ENTRY_HITS;
  if (ball.state === BallStep.SPIKE) {
    if (ball.position[1]! < SPIKE_TOP) {
      ball.position[1] = SPIKE_TOP;
      ball.state = BallStep.PLAY;
      ball.accel[1] = g;
      ball.target = ball.spikeTarget;
      ball.speed = s16(ball.spikeSpeed);
      ball.velocity[1] = div(2 * ball.spikeSpeed, 3) + 0x1000;
      return tail(state, data, hits);
    }
  } else if (ball.position[1]! < CEILING) {
    ball.position[1] = CEILING;
    ball.velocity[1] = 0;
    ball.accel[1] = g;
    return tail(state, data, hits);
  }
  if (!(ball.position[1]! < FLOOR && Math.abs(ball.position[0]!) <= FAR)) {
    ball.position[1] = FLOOR;
    ball.accel[1] = g;
    if (0xd00 < ball.velocity[1]!) voiceLine(state, data, 0, Sound.BOUNCE, 0);
    if (type === IRON) {
      if (0x3000 < ball.velocity[1]!) {
        startShake(state, 1);
        shakeVibration(state, 1);
      } else if (0x1800 < ball.velocity[1]!) {
        startShake(state, 0);
        shakeVibration(state, 0);
      }
    }
    if (Math.abs(ball.position[0]!) <= ball.strip) {
      ball.state = BallStep.PLAY;
      ball.velocity[1] = -ball.velocity[1]! >> 1;
      for (let k = 0; k < 3; k += 1) ball.spinRate[k] = s16(ball.spinRate[k]!) >> 1;
    } else {
      ball.velocity[1] = 0;
      ball.speed = 0;
      if (state.freezeHealth !== 0 || ball.state === BallStep.REBOUND) {
        ball.state = BallStep.RESET;
        ball.timer = 0x10;
        return tail(state, data, hits);
      }
      const left = ball.position[0]! < 0;
      const v = left ? a : b;
      ball.charge[left ? 0 : 1] = 0;
      v.health = Math.max(v.health - POINT_DAMAGE, 0);
      v.struckBySlot = (v.slot + 1) & 1;
      ball.state = BallStep.POINT;
      ball.timer = 5;
      ball.pointAgainst = state.throwsUnderway === 0 ? v.slot + 1 : 0;
      const c = state.fighters[2]!;
      c.skeleton.base.translation[0] = ball.position[0]!;
      c.skeleton.base.translation[2] = ball.position[2]!;
      return tail(state, data, hits);
    }
  }
  /* In the air over the court. */
  if (ball.position[1]! < -0x189) ball.stall = 0;
  else {
    ball.stall += 1;
    if (STALL <= ball.stall) {
      ball.state = BallStep.RESET;
      ball.timer = 0x10;
      return tail(state, data, hits);
    }
  }
  if (ball.homing === 0) ball.speed = Math.max(ball.speed - 0x20, 0);
  if (ball.cooldown !== 0) {
    ball.cooldown -= 1;
    return tail(state, data, hits);
  }
  ball.sphere.centre.splice(0, 3, ...ball.position);
  const dir = [0, 0, 0];
  hits = touches(state, data, dir);
  if ((hits & 7) !== 0) {
    touch(state, data, hits, dir);
    return tail(state, data, hits);
  }
  hits = 0;
  if (a.throwing === 0 && b.throwing === 0) hits = meetsFighters(state);
  if (6 <= state.round.flow) {
    if (b.present === 0) hits &= 2;
    else if (a.present === 0) hits &= 1;
  }
  if (hits !== 0) meet(state, data, hits);
  tail(state, data, hits);
}

/**
 * The touch bits the paths that skip every touch test reach the tail with: the console's start-up
 * leaves them in a register no game code writes, taken as none.
 */
const ENTRY_HITS = 0;

/** After the step: the ball's stretch and its look (and a charged ball's glow). */
function afterBall(state: FightState, data: FightData): void {
  const ball = state.ball;
  if (ball.homing !== 0 && s16(ball.stretch) < 0x80) {
    ball.stretchHeld = 0;
    anglesOf(data, ball.stretchAngles, ball.velocity);
    ball.stretchAngles[2] = s16(ball.stretchAngles[2]! + 0x400);
    ball.stretch = s16(div(2 * s16(ball.stretch), 3) + div(ball.speed >> 6, 3));
  } else if (ball.homing === 0 || ball.stretchHeld !== 0) ball.stretch = s16(ball.stretch - ((s16(ball.stretch) + 0x10) >> 4));
  if (ball.state === BallStep.RESET) ball.look = 1;
  else if (ball.state === BallStep.CENTRE || ball.state === BallStep.SERVE_WAIT) ball.look = 0;
  else if (ball.state === BallStep.POINT) ball.look = Look.POINT;
  else if (ball.power === 0) ball.look = ball.cooldown !== 0 ? 5 : ball.state === BallStep.SET_UP ? 4 : 3;
  else {
    ball.timer = state.fighters[ball.lastHitter]!.slot & 0xff;
    if (BURNS <= ball.power) {
      if (ball.cooldown === 5) spawnBallGlow(state, ball.timer + 2);
      ball.look = Look.BURNING;
    } else {
      if (ball.cooldown === 5) spawnBallGlow(state, ball.timer);
      ball.look = ball.timer === 0 ? Look.LEFT_CHARGED : Look.RIGHT_CHARGED;
    }
    if (ball.cooldown !== 0) ball.look = ball.chained !== 0 ? 8 : 5;
  }
}

/** What drawing the ball does to the fight (as the original's drawer does): its flash's pull, and while it is a point's look, its sparkles and its glare's four beams. */
function drawBall(state: FightState, data: FightData): void {
  const ball = state.ball;
  if (state.nothingDrawn !== 0) return;
  flashPullFrom(state, data, ball.position);
  if (ball.look !== Look.POINT || state.pause.frozen !== 0) return;
  if (ball.timer === 5) sparkles(state);
  const centre = projected(state, ball.position);
  for (const beam of ball.beams) {
    beam.x1 = (centre.x + (nextRandom(state.random) >> 4) - 0x400) & 0xffff;
    beam.x2 = (beam.x1 + ball.timer * 8) & 0xffff;
  }
}

/** A point's sparkles: up to sixteen of the pool's sparks about the ball, flying off as it moves (or up off the floor). */
function sparkles(state: FightState): void {
  const ball = state.ball;
  const onFloor = !(ball.position[1]! < FLOOR);
  for (let n = 0; n < 0x10; n += 1) {
    const high = nextRandom(state.random);
    const r = ((high << 16) + nextRandom(state.random)) | 0;
    const i = takeObject(state);
    if (i === -1) return;
    const object = objectAt(state, i);
    object.kind = 1;
    object.position[0] = (ball.position[0]! - 0xff + (r >>> 23)) | 0;
    object.position[1] = (ball.position[1]! - 0xff + ((r >> 14) & 0x1ff)) | 0;
    object.position[2] = (ball.position[2]! - 0xff + ((r >> 5) & 0x1ff)) | 0;
    if (!onFloor) {
      object.climb = s16(ball.velocity[0]! & 0xffff);
      object.heading = s16(ball.velocity[1]! & 0xffff);
    } else {
      object.climb = 0x400;
      object.heading = (nextRandom(state.random) - 0x800) & 0x100;
    }
  }
}

/** The ball's frame in the fight: its step and look (live), its replay ring, its drawer's doings, the gauges and the popups. */
export function ballFrame(state: FightState, data: FightData): void {
  const ball = state.ball;
  if (state.round.flow === 1) state.match.ball.replaysWanted = 2;
  if (0 < ball.touchSoundWait) ball.touchSoundWait -= 1;
  const held = state.pause.paused !== 0 || state.pause.frozen !== 0;
  if (!held) {
    replayRing(state);
    if (state.replaying === 0) {
      stepBall(state, data);
      afterBall(state, data);
    } else if (ball.timer === 5 && ball.look === Look.POINT) voiceLine(state, data, 0, Sound.BOUNCE, 0);
  }
  if (ball.state !== 0) drawBall(state, data);
  if (state.pauseMenu.choice !== 2 || state.match.humanCount === 1) {
    stepGauges(state);
    showPopups(state, held);
  }
}

/** The beach backdrop's scroll, where the scenery would be stepped: started again from the camera's turn as each replay starts. */
export function stepBackdrop(state: FightState): void {
  const phase = state.match.ball.replaysShown;
  const backdrop = state.ball.backdrop;
  if (phase === 1) return;
  if (phase !== backdrop.lastPhase) backdrop.refYaw = state.camera.drawn.yaw;
  backdrop.lastPhase = phase;
}
