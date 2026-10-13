/**
 * The effect pool: eighty objects, free or running, a new one joining the end of the running ones.
 * Each is a kind with a state its kind steps once a played frame. A released object becomes kind 0,
 * which waits two frames and goes back to the free ones.
 *
 * Kinds: 1 a spray of six sparks easing out along a blow, and 2 twenty scattered around its point,
 * both fading and gone on reaching the floor; 0xc and 0xd the same for a charged fighter; 10 a puff
 * of breath (Yoshimitsu's poison, Doctor B.'s) from the mouth, an attack while it lasts; and three
 * that make no picture but sound: 0x10 a line once voice 1 is done, 0x11 a line's echo, 0x12 a
 * replay's; and the charged glow: 3, one on each hand and foot (set up each round), lit on a joint
 * the fighter's charged move names and following it, leaving a trail (4) and now and then a sparkle
 * (5), both rising as they fade, and lighting the fighter through the hit flash on about half its
 * frames; and the fire: 6 a puff of a fire breath (Ogre's and Gon's) and 8 Gon's other, each flying
 * from the mouth, rolling along the floor, burning and dying out, an attack while fresh; 7 the
 * embers they throw off; 9 a flame flickering on the floor; 0xb the flames a fire's hit leaves on
 * the fighter struck, one on each of ten joints (one when Gon struck), leaving it unlit while they
 * burn; 0x13 Gon's flames, rising in a row of columns (0x14); and 0xf Tekken Ball's, a glow in a
 * side's colour on the charged ball or a fire on the burning one, following it until its look
 * changes.
 *
 * An elemental move is one whose hit data starts with 0x18 to 0x1c: each frame of its active window
 * it spawns an object of its kind.
 */
import { angle4096, cosine, sine } from '../math/angles.ts';
import { div } from '../math/integers.ts';
import { newProduct, rotate } from '../math/matrix.ts';
import { flashAt } from './sparks.ts';
import { nextRandom } from '../math/random.ts';
import { hitOf, moveAt } from '../fight/moves.ts';
import { voiceSounding } from '../fight/voice-timing.ts';
import { sparkVibration } from '../fight/vibration.ts';
import { mokujinSound, voiceLine } from '../fight/voices.ts';
import type { EffectLook, EffectObject, FightData, Fighter, FightState } from '../fight/state.ts';

export const OBJECTS = 80;
/** Object flags. */
const TAKEN = 0x80;
const DRAWN = 0x40;
const NEARER = 0x20;
const FIRST_FIGHTER = 0x10;
const SECOND_FIGHTER = 8;
const ATTACK = 2;
/** The four words, as the bursts read them; as the sound kinds; as the breath. */
const AGE = 0;
const LIFE = 1;
const SPEED_FROM = 2;
const SPEED_TO = 3;
const SIDE = 0;
const CODE = 1;
const WAIT = 2;
const BREATH_FRAME = 2;
const BREATH_KIND = 3;
/** The breath's frames; the line after a winner's own. */
const BREATH_FRAMES = 0x15;
const AFTER_LINE = 0x86da;
/** The joints whose glow is set up each round, bit 15 the second fighter's. */
const GLOW_JOINTS = [6, 10, 0xe, 0x11, 0x8006, 0x800a, 0x800e, 0x8011];

/** The pool's object at an index. */
export const objectAt = (state: FightState, i: number): EffectObject => state.effects.objects[i]!;

/** Every object free, in order, none running. */
export function clearPool(state: FightState): void {
  const effects = state.effects;
  effects.free.length = 0;
  for (let i = 0; i < OBJECTS; i += 1) effects.free.push(i);
  effects.active.length = 0;
}

/** The first free object, taken onto the end of the running ones; -1 when none is free. */
export function takeObject(state: FightState): number {
  const effects = state.effects;
  if (effects.free.length === 0) return -1;
  const i = effects.free.shift()!;
  effects.active.push(i);
  const object = objectAt(state, i);
  object.flags = TAKEN;
  object.state = 0;
  return i;
}

/** An object released: kind 0 from its next frame. */
function release(object: EffectObject): void {
  object.kind = 0;
  object.state = 0;
  object.flags = TAKEN;
}

/** An object back on the end of the free ones. */
function returnObject(state: FightState, i: number): void {
  const object = objectAt(state, i);
  if ((object.flags & TAKEN) === 0) return;
  const effects = state.effects;
  effects.active.splice(effects.active.indexOf(i), 1);
  effects.free.push(i);
  object.flags = 0;
}

/** A hand's or foot's glow (`joint`, bit 15 the second fighter's), kind 3. */
function glowAt(state: FightState, joint: number): void {
  const i = takeObject(state);
  if (i === -1) return;
  const object = objectAt(state, i);
  object.kind = 3;
  object.words[AGE] = joint;
}

/** At a round's start: the pool cleared and the glow on each hand and foot set up again. */
export function resetPool(state: FightState): void {
  clearPool(state);
  const effects = state.effects;
  effects.clearedForReplay = 0;
  effects.clearedForKnockout = 0;
  state.effectSegmentCounts[0] = 0;
  state.effectSegmentCounts[1] = 0;
  for (const f of state.fighters) f.unlit = 0;
  effects.glow[0] = 0;
  effects.glow[1] = 0;
  for (const joint of GLOW_JOINTS) glowAt(state, joint);
}

/* ---- The bursts. ---- */

/** C's division by three as the compiler multiplies for it. */
const third = (v: number): number => Number((BigInt(v) * 0x55555556n) >> 32n) - (v >> 31);

/** The velocity from the climb, the heading and the speed: the climb's sine the height, its cosine split between x and z by the heading. */
function aim(data: FightData, object: EffectObject): void {
  const s = (angle: number): number => sine(data.math, -angle);
  const c = (angle: number): number => cosine(data.math, -angle);
  const speed = object.speed;
  object.velocity[1] = Math.imul(speed, s(object.climb));
  const flat = Math.imul(speed, c(object.climb)) >> 12;
  object.velocity[0] = Math.imul(flat, s(object.heading));
  object.velocity[2] = Math.imul(flat, c(object.heading));
}

/** A burst spark aged, moved by its velocity's whole millimetres (eased in speed while `moving`); released past its life or on the floor. */
function fade(data: FightData, object: EffectObject, moving: boolean): void {
  const age = (object.words[AGE]! + 1) | 0;
  object.words[AGE] = age;
  if (age < object.words[LIFE]!) {
    if (moving) {
      const ease = cosine(data.math, div(age * 0x3ff, object.words[LIFE]!) & 0x3ff) * 4 + 0x2000;
      object.speed = (object.words[SPEED_FROM]! + (Math.imul(object.words[SPEED_TO]! - object.words[SPEED_FROM]!, ease) >> 15)) << 16 >> 16;
      aim(data, object);
    }
    for (let i = 0; i < 3; i += 1) object.position[i] = (object.position[i]! + (object.velocity[i]! >> 16)) | 0;
    if (object.position[1]! < 0) return;
  }
  release(object);
}

/** Two of the game's random numbers as one word, the first in its low half. */
function randomWord(state: FightState): { low: number; word: number } {
  const low = nextRandom(state.random);
  const high = nextRandom(state.random);
  return { low, word: (low | (high << 16)) | 0 };
}

/** A spray spark: its life, its speed easing from slow to fast, the blow's direction spread. */
function startSpray(state: FightState, object: EffectObject, look: EffectLook): void {
  object.state += 1;
  object.flags |= DRAWN;
  object.look = look;
  const { low, word: r } = randomWord(state);
  const spreadClimb = ((low & 0x7ff) - 0x3ff) * 2;
  object.words[LIFE] = ((r >> 4) & 0x1f) + 10;
  const spreadHeading = (((r >> 2) & 0x7ff) - 0x3ff) * 2;
  object.words[SPEED_FROM] = (r >> 6) & 0x1ff;
  object.words[AGE] = 0;
  object.words[SPEED_TO] = ((r >> 8) & 0x1ff) + 0x680;
  object.climb = ((object.climb + third(spreadClimb)) << 16) >> 16;
  object.heading = ((object.heading + third(spreadHeading)) << 16) >> 16;
}

/** A scattered spark: anywhere within 127 mm, a little off the blow's line, at its own speed. */
function startScatter(state: FightState, data: FightData, object: EffectObject, look: EffectLook): void {
  object.state += 1;
  object.flags |= DRAWN;
  object.look = look;
  const { low, word: r } = randomWord(state);
  object.words[LIFE] = ((r >> 10) & 0x1f) + 0x14;
  object.words[AGE] = 0;
  object.position[0] = (object.position[0]! - 0x7f + (low & 0xff)) | 0;
  object.position[1] = (object.position[1]! - 0x7f + ((r >> 2) & 0xff)) | 0;
  object.position[2] = (object.position[2]! - 0x7f + ((r >> 4) & 0xff)) | 0;
  object.climb = (((object.climb & 0xffff) - 0x3f + ((r >> 6) & 0x7f)) << 16) >> 16;
  object.heading = (((object.heading & 0xffff) - 0x3f + ((r >>> 8) & 0x7f)) << 16) >> 16;
  object.speed = ((((r >> 12) & 0x7ff) * 5) >> 2) << 16 >> 16;
  aim(data, object);
  for (let i = 0; i < 3; i += 1) object.position[i] = (object.position[i]! + (object.velocity[i]! >> 13)) | 0;
}

/** A burst's step: started on its first frame, faded every frame after. */
function burst(state: FightState, data: FightData, object: EffectObject, look: EffectLook, spray: boolean): void {
  if (object.state === 0) {
    if (spray) startSpray(state, object, look);
    else startScatter(state, data, object, look);
  } else if (object.state !== 1) return;
  fade(data, object, spray);
}

/** A released object waits two frames, then goes back to the free ones. */
function expire(state: FightState, i: number): void {
  const object = objectAt(state, i);
  if (object.state === 0) {
    object.words[AGE] = 2;
    object.state = 1;
  } else if (object.state !== 1) return;
  const left = (object.words[AGE]! - 1) | 0;
  object.words[AGE] = left;
  if (left < 1) returnObject(state, i);
}

/* ---- The voices' echoes and a line after another. ---- */

/** Line `AFTER_LINE` once the line playing on voice 1 is done (kind 0x10). */
export function lineAfterVoice(state: FightState): void {
  const i = takeObject(state);
  if (i !== -1) objectAt(state, i).kind = 0x10;
}

/** From its second frame, once voice 1 is no longer keyed on and sounding, the line plays and the object goes. */
function lineAfter(state: FightState, data: FightData, object: EffectObject): void {
  if (object.state === 0) object.state = 1;
  else if (object.state === 1 && !voiceSounding(state, data, 1)) {
    voiceLine(state, data, 0, AFTER_LINE, 0);
    release(object);
  }
}

/** A line of `side`'s echoed (kind 0x11), unless the fighter is mid-throw. */
export function echoLine(state: FightState, side: number, code: number): void {
  if (state.fighters[side]!.throwing !== 0) return;
  const i = takeObject(state);
  if (i === -1) return;
  const object = objectAt(state, i);
  object.kind = 0x11;
  object.words[SIDE] = side;
  object.words[CODE] = code & 0xffff;
}

/** A sound object's wait run down, twice as fast in a replay. */
function waitDown(state: FightState, object: EffectObject): void {
  object.words[WAIT] = (object.words[WAIT]! - (state.replaying !== 0 ? 2 : 1)) | 0;
}

/** The echo: 16 frames on, the line again on voice 12 at half volume; 16 more, on voice 14 at a quarter (the side added to each, and again as voices past 5 are). */
function echo(state: FightState, data: FightData, object: EffectObject): void {
  waitDown(state, object);
  if (object.state === 0) {
    object.words[WAIT] = 0xf;
    object.state = 1;
  } else if ((object.state === 1 || object.state === 2) && object.words[WAIT]! < 0) {
    const side = object.words[SIDE]!;
    const code = ((object.words[CODE]! & 0xffffc3ff) | (side * 0x400 + (object.state === 1 ? 0x3000 : 0x3800))) >>> 0;
    object.words[CODE] = code | 0;
    voiceLine(state, data, side, code, object.state);
    if (object.state === 2) return release(object);
    object.words[WAIT] = 0xf;
    object.state = 2;
  }
}

/** A line in a replay echoed (kind 0x12). */
export function replayEcho(state: FightState, side: number, code: number): void {
  const i = takeObject(state);
  if (i === -1) return;
  const object = objectAt(state, i);
  object.kind = 0x12;
  object.words[SIDE] = side;
  object.words[CODE] = code & 0xffff;
}

/** A replay's echo: the line (Mokujin's for anyone, when his table has one) unless it has no voice; 16 frames on, again at half volume, then 16 more at a quarter, each on the next of the last eight voices. */
function replayEchoes(state: FightState, data: FightData, object: EffectObject): void {
  if (object.state === 0) {
    const code = mokujinSound(data, object.words[CODE]! >>> 0);
    object.words[CODE] = code;
    if ((code & 0x3c00) === 0) return release(object);
    object.words[WAIT] = 0xf;
    object.state = 1;
  } else if (object.state === 1 || object.state === 2) {
    waitDown(state, object);
    if (0 <= object.words[WAIT]!) return;
    state.effects.echoVoice = (state.effects.echoVoice + 1) & 7;
    voiceLine(state, data, object.words[SIDE]!, ((object.words[CODE]! & 0xffffc3ff) | (state.effects.echoVoice << 10)) >>> 0, object.state | 0x80);
    object.words[WAIT] = 0xf;
    object.state += 1;
  } else if (object.state === 3) release(object);
}

/* ---- The breath. ---- */

/** A puff of breath: an attack until its breather's move is no longer breathing; dressed on its first frame, its frames stepped, drifting by its velocity. */
function breath(state: FightState, data: FightData, object: EffectObject): void {
  if ((object.flags & ATTACK) !== 0) {
    const f = state.fighters[(object.flags & FIRST_FIGHTER) !== 0 ? 0 : 1]!;
    const move = moveAt(data, f.move!);
    const own = object.words[BREATH_KIND] === 0 ? 0x19 : 0x1c;
    const code = hitOf(data, f.move!)?.codes[0] ?? 0;
    const out = code === own ? f.frame < move.activeWindow.first : true;
    if (out) object.flags &= ~ATTACK;
  }
  const first = object.state;
  if (first === 0) startBreath(state, data, object);
  if (first === 0 || first === 1) animateBreath(data, object);
  for (let i = 0; i < 3; i += 1) object.last[i] = object.position[i]!;
  for (let i = 0; i < 3; i += 1) object.position[i] = (object.position[i]! + (object.velocity[i]! >> 16)) | 0;
}

/** A puff dressed, an attack, and on its way out of the mouth a little off the breath's line, at 0x300. */
function startBreath(state: FightState, data: FightData, object: EffectObject): void {
  object.state += 1;
  object.flags |= DRAWN | ATTACK;
  object.look = 'breath';
  const { low, word } = randomWord(state);
  object.words[BREATH_FRAME] = -1;
  object.speed = 0x300;
  object.climb = (((object.climb & 0xffff) - 0x7f + (low & 0xff)) << 16) >> 16;
  object.heading = (((object.heading & 0xffff) - 0x7f + ((word >> 2) & 0xff)) << 16) >> 16;
  aim(data, object);
}

/** A puff's next frame, no longer an attack where the breath's table says; released after its last. */
function animateBreath(data: FightData, object: EffectObject): void {
  const frame = (object.words[BREATH_FRAME]! + 1) | 0;
  object.words[BREATH_FRAME] = frame;
  if (frame >= BREATH_FRAMES) {
    release(object);
    return;
  }
  if ((object.flags & ATTACK) !== 0 && data.effects.breathHurts[frame] === 0) object.flags &= ~ATTACK;
}

/** A direction (x, y, z) as the two angles a burst takes: the heading in the floor's plane, and the climb over the plane's length. */
export function directionAngles(data: FightData, x: number, y: number, z: number): { climb: number; heading: number } {
  const heading = (angle4096(x, z, data.math) - 0x400) & 0xfff;
  return { heading, climb: (angle4096(y, planeLength(data, x, z, heading), data.math) - 0x400) & 0xfff };
}

/** The length of (x, z) by the heading: the larger part over its sine or cosine. */
function planeLength(data: FightData, x: number, z: number, heading: number): number {
  let over: number;
  let part: number;
  if (Math.abs(z) < Math.abs(x)) {
    over = ((sine(data.math, heading) & 0xffff) << 3) & 0xffff;
    part = x;
  } else {
    over = ((cosine(data.math, heading) & 0xffff) << 3) & 0xffff;
    part = z;
  }
  if (over === 0) over = 1;
  const length = div(part << 16, (over << 16) >> 16) >> 1;
  return length < 0 ? -length : length;
}

/** A puff of breath of `kind` (0 Yoshimitsu's, 1 Doctor B.'s) from the fighter's mouth, toward a point along the breath. */
function breathe(state: FightState, data: FightData, f: Fighter, kind: number): void {
  const head = f.skeleton.joints[2]!.world;
  const product = newProduct();
  const points = data.effects.mouth.map((at) => {
    rotate(head.rotation, at[0]!, at[1]!, at[2]!, product);
    return [0, 1, 2].map((k) => (product.held[k]! + head.translation[k]!) | 0);
  });
  const i = takeObject(state);
  if (i === -1) return;
  const object = objectAt(state, i);
  object.kind = 10;
  object.flags |= f.movesetSlot === 0 ? FIRST_FIGHTER : SECOND_FIGHTER;
  const [from, to] = points as [number[], number[]];
  for (let k = 0; k < 3; k += 1) object.position[k] = from[k]!;
  const { climb, heading } = directionAngles(data, to[0]! - from[0]!, to[1]! - from[1]!, to[2]! - from[2]!);
  object.climb = climb;
  object.heading = heading;
  object.words[BREATH_KIND] = kind;
}

/**
 * On a played frame, unless the knockout cleared the pool, a fighter in the active window of an
 * elemental move spawns its effect: 0x19 and 0x1c the breath (Yoshimitsu's and Doctor B.'s); Ogre's
 * fire (0x18) and Gon's (0x1a, 0x1b) wait for stage 3.
 */
export function elementalMove(state: FightState, data: FightData, f: Fighter, play: number): void {
  const code = hitOf(data, f.move!)?.codes[0] ?? 0;
  if (play === 0 || state.effects.clearedForKnockout !== 0 || ((code - 0x18) >>> 0) >= 5) return;
  const move = moveAt(data, f.move!);
  if (f.frame < move.activeWindow.first || move.activeWindow.last < f.frame) return;
  if (code === BREATH_FIRE) breatheFire(state, data, f, data.effects.fire.mouths[f.movesetSlot]!, 6, 3);
  else if (code === 0x19) breathe(state, data, f, 0);
  else if (code === GON_FIRE) breatheFire(state, data, f, data.effects.fire.gonMouth, 8, 4);
  else if (code === GON_FLAMES) startFlames(state, data, f);
  else if (code === 0x1c) breathe(state, data, f, 1);
}

/* ---- Spawning bursts. ---- */

/** Where a burst starts: a point and the blow's direction. */
export interface BurstAt {
  readonly point: readonly number[];
  readonly climb: number;
  readonly heading: number;
}

function spawn(state: FightState, kind: number, count: number, at: BurstAt): void {
  for (let n = 0; n < count; n += 1) {
    const i = takeObject(state);
    if (i === -1) return;
    const object = objectAt(state, i);
    object.kind = kind;
    for (let k = 0; k < 3; k += 1) object.position[k] = at.point[k]!;
    object.climb = (at.climb << 16) >> 16;
    object.heading = (at.heading << 16) >> 16;
  }
}

/** The bursts by their codes: 0 the spray, 1 the scatter, 2 a fire's hit's flames on the fighter of `kind`, 3 and 4 the charged ones. */
export function spawnBurst(state: FightState, data: FightData, code: number, at: BurstAt, kind: number): void {
  if (code === 0) spawn(state, 1, 6, at);
  else if (code === 1) spawn(state, 2, 0x14, at);
  else if (code === 2) burnFighter(state, data, kind);
  else if (code === 3) spawn(state, 0xc, 6, at);
  else if (code === 4) spawn(state, 0xd, 0x14, at);
  else if (code === 0xf) spawnBallGlow(state, kind);
}

/* ---- Tekken Ball's ball's glow (kind 0xf). ---- */

/** The glow's two kinds (its fourth word): a side's glow, the fire; its side (first word) and its frame (third). */
const BALL_KIND = 3;
const BALL_SIDE = 0;
const BALL_FRAME = 2;
/** The ball's looks the glow reads: held without flashing; each side's charge; burning. */
const BallLook = { HELD: 5, CHAINED: 8, LEFT: 6, RIGHT: 7, BURNING: 9 } as const;
/** The flashes' colours: the glow's, the fire's. */
const BALL_FLASHES: readonly (readonly number[])[] = [
  [0xc0, 0xc0, 0xff],
  [0xff, 0x80, 0],
];

/** A glow on Tekken Ball's ball, once a time for each `index` (a side, plus 2 for the fire). */
export function spawnBallGlow(state: FightState, index: number): void {
  const ball = state.ball;
  const bit = 1 << (index & 0xff);
  if ((ball.glows & bit) !== 0) return;
  const i = takeObject(state);
  if (i === -1) return;
  const object = objectAt(state, i);
  object.kind = 0xf;
  object.words[BALL_SIDE] = index & 1;
  object.words[BALL_KIND] = (index & 0xff) >> 1;
  ball.glows |= bit;
}

/** The glow dressed: drawn, its frame before the first; the fire an attack of the second fighter's; a random turn, still. */
function startBallGlow(state: FightState, data: FightData, object: EffectObject): void {
  object.state += 1;
  object.flags |= DRAWN;
  object.speed = 0;
  object.words[BALL_FRAME] = -1;
  if (object.words[BALL_KIND] === 0) object.look = 'ball glow';
  else {
    object.look = 'ball fire';
    object.flags |= ATTACK;
  }
  const r = (nextRandom(state.random) | (nextRandom(state.random) << 16)) | 0;
  object.climb = (object.climb - 0x3f + ((r >> 4) & 0x7f)) | 0;
  object.heading = (object.heading - 0x1f + ((r >> 6) & 0x3f)) | 0;
  aim(data, object);
}

/**
 * The ball's glow a frame on: its frames turning (the glow's twelve round, the fire's seven then
 * eight round from a random one), at the ball's next place, flashing now and then; let go once the
 * ball no longer looks so (all glows then free to start again).
 */
function ballGlow(state: FightState, data: FightData, object: EffectObject): void {
  const ball = state.ball;
  const r = nextRandom(state.random);
  nextRandom(state.random);
  const kind = object.words[BALL_KIND]!;
  if (kind === 0 && object.state < 2) {
    if (object.state === 0) startBallGlow(state, data, object);
    object.words[BALL_FRAME] = object.words[BALL_FRAME]! + 1 > 0xb ? 0 : object.words[BALL_FRAME]! + 1;
  } else if (kind === 1) {
    if (object.state === 0) startBallGlow(state, data, object);
    if (object.state === 1) {
      object.words[BALL_FRAME] = object.words[BALL_FRAME]! + 1;
      if (6 < object.words[BALL_FRAME]!) {
        object.state += 1;
        object.words[BALL_FRAME] = nextRandom(state.random);
      }
    } else if (object.state === 2) object.words[BALL_FRAME] = object.words[BALL_FRAME]! + 1;
  }
  for (let k = 0; k < 3; k += 1) {
    object.last[k] = object.position[k]!;
    object.position[k] = (ball.position[k]! + (ball.velocity[k]! >> 8)) | 0;
  }
  const look = ball.look;
  if (look === BallLook.HELD || look === BallLook.CHAINED) return;
  if (kind === 0) {
    if ((r & 0xf) === 0) flashAt(state, object.position, BALL_FLASHES[0]!);
    if (look === (object.words[BALL_SIDE] === 0 ? BallLook.LEFT : BallLook.RIGHT)) return;
  } else if (kind === 1) {
    if ((r & 0xf) === 0) flashAt(state, object.position, BALL_FLASHES[1]!);
    if (look === BallLook.BURNING) return;
  } else return;
  ball.glows = 0;
  release(object);
}

/* ---- The charged glow (kinds 3 to 5). ---- */

/** The glow's and the trail's frames (their second word), the sparkle's (its first). */
const COUNT = 1;
const SPARKLE_COUNT = 0;
/** True Ogre's roster id, and the joint his right hand's glow sits on. */
const TRUE_OGRE = 0x14;
const OGRE_HAND = 19;
const glowRotation = newProduct();

/** A hand's or foot's glow (kind 3), dressed on its first frame. */
function glow(state: FightState, data: FightData, object: EffectObject): void {
  if (object.state === 0) {
    object.state += 1;
    object.flags |= DRAWN | NEARER;
    object.look = 'glow';
    object.words[COUNT] = -1;
  } else if (object.state !== 1) return;
  shine(state, data, object);
}

/**
 * While its fighter's mask lights its joint, the glow drawn at the joint (a hand at its roster's
 * offset from the joint's frame, True Ogre's right hand from joint 19's); a trail left where the
 * mask asks for one, a sparkle the fewer objects ran last frame the likelier, and the fighter lit
 * through the hit flash on half its frames.
 */
function shine(state: FightState, data: FightData, object: EffectObject): void {
  const joint = object.words[AGE]!;
  const side = (joint & 0x8000) !== 0 ? 1 : 0;
  const mask = state.effects.glow[side]! | 0;
  if (((mask >> (joint & 0x1f)) & 1) === 0) {
    object.flags &= ~DRAWN;
    return;
  }
  object.flags |= DRAWN;
  const limb = joint & 0x7fff;
  const f = state.fighters[side]!;
  if (limb === 6 || limb === 10) {
    const frame = f.skeleton.joints[limb === 6 && f.roster === TRUE_OGRE ? OGRE_HAND : limb]!.world;
    const offset = data.effects.glowOffsets[data.roster.rowOf(f.roster)]![limb === 10 ? 1 : 0]!;
    rotate(frame.rotation, offset[0]!, offset[1]!, offset[2]!, glowRotation);
    for (let i = 0; i < 3; i += 1) object.position[i] = (glowRotation.held[i]! + frame.translation[i]!) | 0;
  } else for (let i = 0; i < 3; i += 1) object.position[i] = f.skeleton.joints[limb]!.world.translation[i]!;
  object.words[COUNT] = (object.words[COUNT]! + 1) | 0;
  if (mask < 0) leave(state, 4, object);
  const threshold = div(((0x50 - state.effects.running) * 0x32) << 14, 80000) * 4;
  const r = nextRandom(state.random);
  if (r < threshold) leave(state, 5, object);
  if ((r & 0x80) !== 0) flashAt(state, object.position, data.effects.glowColour);
}

/** An object of `kind` taken at `from`'s point. */
function leave(state: FightState, kind: number, from: EffectObject): void {
  const i = takeObject(state);
  if (i === -1) return;
  const object = objectAt(state, i);
  object.kind = kind;
  for (let k = 0; k < 3; k += 1) object.position[k] = from.position[k]!;
}

/** A trail (kind 4): within 63 mm of where the glow was, rising and fading over sixteen frames. */
function trail(state: FightState, object: EffectObject): void {
  if (object.state === 0) {
    object.state += 1;
    object.flags |= DRAWN | NEARER;
    object.look = 'trail';
    object.words[COUNT] = -1;
    const { low, word: r } = randomWord(state);
    object.velocity[1] = 0;
    object.position[0] = (object.position[0]! - 0x3f + (low & 0x7f)) | 0;
    object.position[1] = (object.position[1]! - 0x3f + ((r >> 2) & 0x7f)) | 0;
    object.position[2] = (object.position[2]! - 0x3f + ((r >> 4) & 0x7f)) | 0;
  } else if (object.state !== 1) return;
  const count = (object.words[COUNT]! + 1) | 0;
  object.words[COUNT] = count;
  if (0x10 <= count) release(object);
  else rise(object);
}

/** A sparkle (kind 5): within 127 mm across of where the glow was, rising and fading over 32 frames. */
function sparkle(state: FightState, object: EffectObject): void {
  if (object.state === 0) {
    object.state += 1;
    object.flags |= DRAWN;
    object.look = 'sparkle';
    object.words[SPARKLE_COUNT] = -1;
    object.velocity[1] = 0;
    const { low, word: r } = randomWord(state);
    object.position[0] = (object.position[0]! - 0x7f + (low & 0xff)) | 0;
    object.position[2] = (object.position[2]! - 0x7f + ((r >> 4) & 0xff)) | 0;
  } else if (object.state !== 1) return;
  const count = (object.words[SPARKLE_COUNT]! + 1) | 0;
  object.words[SPARKLE_COUNT] = count;
  if (0x20 <= count) release(object);
  else rise(object);
}

/** A trail or sparkle rising faster each frame (its velocity's height, 16.16 mm a frame). */
function rise(object: EffectObject): void {
  const speed = (object.velocity[1]! + 0x12000) | 0;
  object.velocity[1] = speed;
  object.position[1] = (object.position[1]! - (speed >> 16)) | 0;
}

/* ---- The fire (kinds 6 to 9, 0xb, 0x13 and 0x14). ---- */

/**
 * A fire object's words: its stage's count (a burning flame's frames left), its stage's length (a
 * burning flame's flicker; Gon's flames' place in their schedule, three to a column), its cell's
 * count (a burning flame's number), whether the breath still feeds it (a burning flame's joint).
 */
const STAGE = 0;
const LENGTH = 1;
const CELL = 2;
const GOING = 3;
/** The height the fire rolls along: 216 mm over the floor. */
const FIRE_FLOOR = -0xd8;
const GON = 0x11;
const THIRD_FIGHTER = 4;
/** The fire's hit codes: a breath (Ogre's, Gon's), Gon's other, Gon's flames. */
const BREATH_FIRE = 0x18;
const GON_FIRE = 0x1a;
const GON_FLAMES = 0x1b;
/** Gon's flames leave from his joint 11. */
const FLAMES_JOINT = 11;
const fireRotation = newProduct();

/** Whether `f` still plays its move of hit code `code`, at or past its first active frame. */
function stillBreathing(data: FightData, f: Fighter, code: number): boolean {
  return (hitOf(data, f.move!)?.codes[0] ?? 0) === code && moveAt(data, f.move!).activeWindow.first <= f.frame;
}

const ownerOf = (state: FightState, object: EffectObject): Fighter => state.fighters[(object.flags & FIRST_FIGHTER) !== 0 ? 0 : 1]!;

/** The object moved by its velocity's whole millimetres. */
function travel(object: EffectObject): void {
  for (let i = 0; i < 3; i += 1) object.position[i] = (object.position[i]! + (object.velocity[i]! >> 16)) | 0;
}

/** The velocity across the floor from the heading and the speed, the height's left alone. */
function aimFlat(data: FightData, object: EffectObject): void {
  object.velocity[0] = Math.imul(object.speed, sine(data.math, -object.heading));
  object.velocity[2] = Math.imul(object.speed, cosine(data.math, -object.heading));
}

/** Down on the fire's floor: held at its height, its climb and its fall stopped, rolling on across it. */
function roll(data: FightData, object: EffectObject): void {
  if (FIRE_FLOOR < object.position[1]!) {
    object.position[1] = FIRE_FLOOR;
    object.climb = 0;
    object.velocity[1] = 0;
    aimFlat(data, object);
  }
}

/** The draw under which an ember or a flame comes this frame: the more of the pool free last frame, the likelier (`share` scales it). */
const chance = (state: FightState, share: number): number => div((0x50 - state.effects.running) * share, 80000) * 4;

/** An ember (kind 7) taken at `from`'s point, flying at `climb` and `heading`. */
function leaveEmber(state: FightState, from: EffectObject, climb: number, heading: number): void {
  const i = takeObject(state);
  if (i === -1) return;
  const object = objectAt(state, i);
  object.kind = 7;
  for (let k = 0; k < 3; k += 1) object.position[k] = from.position[k]!;
  object.climb = climb;
  object.heading = heading;
}

/** Two points turned with a joint's frame and set at it. */
function firePoints(frame: { readonly rotation: readonly number[]; readonly translation: readonly number[] }, table: readonly (readonly number[])[]): number[][] {
  return table.map((at) => {
    rotate(frame.rotation, at[0]!, at[1]!, at[2]!, fireRotation);
    return [0, 1, 2].map((k) => (fireRotation.held[k]! + frame.translation[k]!) | 0);
  });
}

/** A fire object of `kind` for `f` at the first point, flying toward the second. */
function placeFire(state: FightState, data: FightData, kind: number, f: Fighter, points: number[][]): void {
  const i = takeObject(state);
  if (i === -1) return;
  const object = objectAt(state, i);
  object.kind = kind;
  object.flags |= f.movesetSlot === 0 ? FIRST_FIGHTER : SECOND_FIGHTER;
  const [from, to] = points as [number[], number[]];
  for (let k = 0; k < 3; k += 1) object.position[k] = from[k]!;
  const { climb, heading } = directionAngles(data, to[0]! - from[0]!, to[1]! - from[1]!, to[2]! - from[2]!);
  object.climb = climb;
  object.heading = heading;
}

/**
 * A fire breath's puff (`kind`) a frame through the move's active window, from two points turned
 * with the head (joint 2) and at it, flying from the first toward the second; the pad buzzes
 * (`buzz`) on the first frame, and the fire lights its fighter through the hit flash each frame.
 */
function breatheFire(state: FightState, data: FightData, f: Fighter, table: readonly (readonly number[])[], kind: number, buzz: number): void {
  if ((f.frame & 0xffff) === moveAt(data, f.move!).activeWindow.first) sparkVibration(state, f.movesetSlot, buzz);
  const points = firePoints(f.skeleton.joints[2]!.world, table);
  placeFire(state, data, kind, f, points);
  flashAt(state, points[0]!, data.effects.fire.colour);
}

/** Gon's flames (kind 0x13), on the move's first active frame, from his joint 11 forward. */
function startFlames(state: FightState, data: FightData, f: Fighter): void {
  if ((f.frame & 0xffff) !== moveAt(data, f.move!).activeWindow.first) return;
  placeFire(state, data, 0x13, f, firePoints(f.skeleton.joints[FLAMES_JOINT]!.world, data.effects.fire.gonFlames));
}

/**
 * A fire's hit leaves flames on the fighter struck (`side`), one on each of ten joints, or one when
 * Gon struck (and a replay's start then puts it out); the pad buzzes.
 */
export function burnFighter(state: FightState, data: FightData, side: number): void {
  sparkVibration(state, side, 0);
  const victim = state.fighters[side & 0xff]!;
  const gon = (): boolean => state.fighters[victim.struckBySlot & 0xff]!.roster === GON;
  let count = 10;
  if (gon()) {
    count = 1;
    state.effects.replayReset = (state.effects.replayReset | (0x10 >> (side & 0x1f))) & 0xff;
  }
  for (let n = 0; n < count; n += 1) {
    const i = takeObject(state);
    if (i === -1) return;
    const object = objectAt(state, i);
    if (gon()) object.flags |= NEARER;
    object.kind = 0xb;
    object.words[CELL] = n;
    object.words[GOING] = data.effects.fire.burningJoints[n]!;
    object.flags |= (0x10 >> (side & 0x1f)) & 0xff;
  }
}

/**
 * A fire breath's puff (kind 6). While the breath feeds it, its last point is kept on its fighter's
 * frames (every other) and it attacks on the others; it flies out, rolls along the floor and burns
 * down through its stages, throwing embers off, and where it rolls while fed, flames on the floor;
 * it lights its fighter through the hit flash now and then while it burns.
 */
function fireBreath(state: FightState, data: FightData, object: EffectObject): void {
  const first = (object.flags & FIRST_FIGHTER) !== 0;
  if (object.words[GOING] !== 0) {
    if (!stillBreathing(data, ownerOf(state, object), BREATH_FIRE)) object.words[GOING] = 0;
    if (first === (state.drawBuffer !== 0)) for (let i = 0; i < 3; i += 1) object.last[i] = object.position[i]!;
  }
  const stage = object.state;
  if (stage === 0 || stage === 1) {
    if (stage === 0) startFireBreath(state, data, object);
    const n = object.words[CELL]! + 1;
    object.words[CELL] = n;
    if (6 < n) {
      object.state += 1;
      object.words[CELL] = nextRandom(state.random);
      object.speed = 0x1000;
      aim(data, object);
    }
  } else if (stage === 2) {
    object.words[CELL] = (object.words[CELL]! + 1) | 0;
    const burnt = object.words[STAGE]! + 1;
    object.words[STAGE] = burnt;
    if (object.words[LENGTH]! <= burnt) {
      object.words[CELL] = -1;
      object.state += 1;
      object.look = (nextRandom(state.random) & 1) === 0 ? 'fire mirrored' : 'fire';
    }
  } else if (stage === 3) {
    const n = object.words[CELL]! + 1;
    object.words[CELL] = n;
    if (8 <= n) release(object);
    else {
      object.look = (n & 1) === 0 ? 'fire mirrored' : 'fire';
      if (object.words[GOING] !== 0 && data.effects.fire.going[n] === 0) object.words[GOING] = 0;
    }
  }
  travel(object);
  roll(data, object);
  const flags = object.flags;
  object.flags = flags & ~ATTACK;
  if (object.words[GOING] !== 0 && ((flags & FIRST_FIGHTER) === 0) === (state.drawBuffer !== 0)) object.flags |= ATTACK;
  let r = nextRandom(state.random);
  if (r < chance(state, 0x3c000)) leaveEmber(state, object, object.climb, object.heading);
  else if (object.position[1] === FIRE_FLOOR && object.words[GOING] !== 0) {
    r = nextRandom(state.random);
    if (r < chance(state, 0x24000)) {
      const i = takeObject(state);
      if (i !== -1) {
        const flame = objectAt(state, i);
        flame.kind = 9;
        flame.position[0] = object.position[0]!;
        flame.position[2] = object.position[2]!;
      }
    }
  }
  if (((object.state - 1) >>> 0) < 2 && ((r >> 8) & 0xf) === 0) flashAt(state, object.position, data.effects.fire.colour);
}

/** A breath's puff dressed, fed, spread off the breath's line, at speed 0xa00. */
function startFireBreath(state: FightState, data: FightData, object: EffectObject): void {
  object.state += 1;
  object.flags |= DRAWN;
  for (let i = 0; i < 3; i += 1) object.last[i] = object.position[i]!;
  const r = nextRandom(state.random);
  object.look = (r & 1) === 0 ? 'fire mirrored' : 'fire';
  object.words[LENGTH] = ((r >> 2) & 3) + 5;
  object.words[CELL] = -1;
  object.words[GOING] = 1;
  object.speed = 0xa00;
  object.words[STAGE] = 0;
  object.climb = ((object.climb - 0x3f + ((r >> 4) & 0x7f)) << 16) >> 16;
  object.heading = ((object.heading - 0x1f + ((r >> 6) & 0x3f)) << 16) >> 16;
  aim(data, object);
}

/** An ember (kind 7), thrown off a fire, falling faster each frame, gone at the floor. */
function ember(state: FightState, data: FightData, object: EffectObject): void {
  const stage = object.state;
  if (stage === 0 || stage === 1) {
    if (stage === 0) startEmber(state, data, object);
    const n = object.words[STAGE]! + 1;
    object.words[STAGE] = n;
    if (object.words[LENGTH]! <= n) {
      object.words[STAGE] = -1;
      object.state += 1;
    }
  } else if (stage === 2) {
    const n = object.words[STAGE]! + 1;
    object.words[STAGE] = n;
    if (0xc <= n) release(object);
  }
  object.velocity[1] = (object.velocity[1]! - 0x30000) | 0;
  travel(object);
  if (-1 < object.position[1]!) release(object);
}

/** An ember within 127 mm of its fire, a little off its line, at its own speed, glowing for up to 31 frames. */
function startEmber(state: FightState, data: FightData, object: EffectObject): void {
  object.state += 1;
  object.flags |= DRAWN;
  object.look = 'ember';
  const { low, word: r } = randomWord(state);
  object.words[LENGTH] = (r >> 10) & 0x1f;
  object.words[STAGE] = 0;
  object.position[0] = (object.position[0]! - 0x7f + (low & 0xff)) | 0;
  object.position[1] = (object.position[1]! - 0x7f + ((r >> 2) & 0xff)) | 0;
  object.position[2] = (object.position[2]! - 0x7f + ((r >> 4) & 0xff)) | 0;
  object.climb = ((object.climb - 0x3f + ((r >> 6) & 0x7f)) << 16) >> 16;
  object.heading = ((object.heading - 0x3f + ((r >> 8) & 0x7f)) << 16) >> 16;
  object.speed = ((((r >> 12) & 0x3ff) * 5) >> 2) + 0x200;
  aim(data, object);
}

/**
 * Gon's fire's puff (kind 8): an attack while fresh, ended when he leaves the move (in a replay,
 * when its start put his fire out); struck or guarded, it goes out (on a guard, after dying down).
 * It flies, burns, dies down, rolls along the floor, throws embers off and lights him through the
 * hit flash now and then.
 */
function gonFire(state: FightState, data: FightData, object: EffectObject): void {
  if ((object.flags & ATTACK) !== 0) {
    const first = (object.flags & FIRST_FIGHTER) !== 0;
    if (state.replaying !== 0) {
      if ((state.effects.replayReset & (first ? SECOND_FIGHTER : FIRST_FIGHTER)) !== 0) {
        release(object);
        return;
      }
    } else if (!stillBreathing(data, ownerOf(state, object), GON_FIRE)) object.flags &= ~ATTACK;
    if ((object.flags & ATTACK) !== 0 && ((object.state - 1) >>> 0) < 2) {
      const target = state.fighters[first ? 1 : 0]!;
      if (target.hitClean !== 0) {
        release(object);
        return;
      }
      if (target.guarded !== 0) object.state = 3;
    }
  }
  const stage = object.state;
  if (stage === 0 || stage === 1) {
    if (stage === 0) startGonFire(state, data, object);
    const n = object.words[CELL]! + 1;
    object.words[CELL] = n;
    if (6 < n) {
      object.state += 1;
      object.words[CELL] = nextRandom(state.random);
    }
  } else if (stage === 2) {
    object.words[CELL] = (object.words[CELL]! + 1) | 0;
    const burnt = object.words[STAGE]! + 1;
    object.words[STAGE] = burnt;
    if (object.words[LENGTH]! <= burnt) {
      object.state = 4;
      object.words[CELL] = -1;
    }
  } else if (stage === 3 || stage === 4) {
    if (stage === 3) {
      /* Guarded: stopped where it is, dying down. */
      object.state = 4;
      object.velocity.fill(0);
      object.words[CELL] = -1;
    }
    const n = object.words[CELL]! + 1;
    object.words[CELL] = n;
    if (n < 9) {
      if ((object.flags & ATTACK) !== 0 && data.effects.fire.gonHurts[n] === 0) object.flags &= ~ATTACK;
    } else release(object);
  }
  for (let i = 0; i < 3; i += 1) object.last[i] = object.position[i]!;
  travel(object);
  roll(data, object);
  const r = nextRandom(state.random);
  if (r < chance(state, 0x3c000)) leaveEmber(state, object, object.climb, object.heading);
  if (((r >> 8) & 0xf) === 0) flashAt(state, object.position, data.effects.fire.colour);
}

/** Gon's puff dressed, an attack, at speed 0x800 along its line. */
function startGonFire(state: FightState, data: FightData, object: EffectObject): void {
  object.state += 1;
  object.flags |= DRAWN | ATTACK;
  const r = nextRandom(state.random);
  object.look = (r & 1) === 0 ? 'gon fire mirrored' : 'gon fire';
  object.words[LENGTH] = ((r >> 2) & 3) + 5;
  object.words[CELL] = -1;
  object.words[STAGE] = 0;
  object.speed = 0x800;
  aim(data, object);
}

/** A flame on the floor (kind 9), flickering a second or so, then rising away; embers rise off it. */
function floorFlame(state: FightState, object: EffectObject): void {
  const stage = object.state;
  if (stage === 0 || stage === 1) {
    if (stage === 0) {
      object.state = 1;
      object.flags |= DRAWN;
      object.look = 'floor flame';
      const { low, word: r } = randomWord(state);
      object.position[1] = -0x100;
      object.velocity[1] = 0;
      object.words[STAGE] = r >> 2;
      object.words[LENGTH] = (low & 0x1f) + 0x3c;
    }
    object.words[STAGE] = (object.words[STAGE]! + 1) | 0;
    const left = object.words[LENGTH]! - 1;
    object.words[LENGTH] = left;
    if (left < 0) {
      object.words[STAGE] = -1;
      object.state += 1;
    }
  } else if (stage === 2) {
    const n = object.words[STAGE]! + 1;
    object.words[STAGE] = n;
    if (n < 0x10) {
      object.velocity[1] = (object.velocity[1]! - 0x24000) | 0;
      object.position[1] = (object.position[1]! + (object.velocity[1]! >> 16)) | 0;
    } else release(object);
  }
  if (nextRandom(state.random) < chance(state, 0x28000)) leaveEmber(state, object, 0x400, 0);
}

/**
 * A flame on a fighter struck by fire (kind 0xb), on its joint for a second or so, leaving its
 * fighter unlit, embers rising off it; then rising away and out. (The game also tests the object's
 * own place in memory for a flash, a test the pool's layout never lets pass.)
 */
function burning(state: FightState, object: EffectObject): void {
  const stage = object.state;
  if (stage === 0 || stage === 1) {
    if (stage === 0) {
      object.state = 1;
      object.flags |= DRAWN;
      object.look = (object.flags & NEARER) === 0 ? 'burning' : 'gon burning';
      const r = nextRandom(state.random);
      object.words[STAGE] = (r & 0xf) + 0x3c;
      object.words[LENGTH] = r >> 4;
    }
    burn(state, object);
  } else if (stage === 2) {
    object.velocity[1] = (object.velocity[1]! - 0x18000) | 0;
    const n = object.words[STAGE]! + 1;
    object.words[STAGE] = n;
    object.position[1] = (object.position[1]! + (object.velocity[1]! >> 16)) | 0;
    if (6 < n) {
      object.words[STAGE] = -1;
      object.state += 1;
    }
  } else if (stage === 3) {
    const n = object.words[STAGE]! + 1;
    object.words[STAGE] = n;
    if (n < 5) {
      object.velocity[1] = (object.velocity[1]! - 0x18000) | 0;
      object.position[1] = (object.position[1]! + (object.velocity[1]! >> 16)) | 0;
    } else release(object);
  }
}

/** A burning flame on its joint, flickering, throwing embers up, its fighter unlit; its time up, it rises away. */
function burn(state: FightState, object: EffectObject): void {
  object.words[LENGTH] = (object.words[LENGTH]! + 1) | 0;
  const flags = object.flags;
  const f = state.fighters[(flags & FIRST_FIGHTER) !== 0 ? 0 : (flags & SECOND_FIGHTER) !== 0 ? 1 : 2]!;
  const joint = f.skeleton.joints[object.words[GOING]!]!.world.translation;
  for (let i = 0; i < 3; i += 1) object.position[i] = joint[i]!;
  if (nextRandom(state.random) < chance(state, 0x3c000)) leaveEmber(state, object, 0x400, 0);
  const left = object.words[STAGE]! - 1;
  object.words[STAGE] = left;
  if (left < 0) {
    object.words[STAGE] = 0;
    object.velocity[1] = 0;
    object.state += 1;
  }
  if ((flags & (FIRST_FIGHTER | SECOND_FIGHTER | THIRD_FIGHTER)) !== 0) f.unlit = 1;
}

/** Gon's flames (kind 0x13), while he plays the move: a column (kind 0x14) rising on each frame its schedule names, then gone. */
function flameRow(state: FightState, data: FightData, object: EffectObject): void {
  if (!stillBreathing(data, ownerOf(state, object), GON_FLAMES)) {
    release(object);
    return;
  }
  if (object.state === 0) {
    object.words[STAGE] = -1;
    object.words[LENGTH] = 0;
    object.state = 1;
  } else if (object.state !== 1) return;
  const n = object.words[STAGE]! + 1;
  object.words[STAGE] = n;
  const at = object.words[LENGTH]!;
  const schedule = data.effects.fire.schedule;
  const entry = schedule[at / 3]!;
  if (n < entry.frame) return;
  const i = takeObject(state);
  if (i !== -1) {
    const column = objectAt(state, i);
    column.kind = 0x14;
    column.flags |= object.flags & (FIRST_FIGHTER | SECOND_FIGHTER);
    column.position[0] = object.position[0]!;
    column.position[1] = -entry.height;
    column.position[2] = object.position[2]!;
    column.climb = 0;
    column.speed = ((entry.speed << 4) << 16) >> 16;
    column.heading = object.heading;
  }
  object.words[LENGTH] = at + 3;
  if (at / 3 + 1 === schedule.length) release(object);
}

/** A column of Gon's flames (kind 0x14): set off along his line, rising faster and faster, hurting while its table says (and he plays the move). */
function flameColumn(state: FightState, data: FightData, object: EffectObject): void {
  if ((object.flags & ATTACK) !== 0 && !stillBreathing(data, ownerOf(state, object), GON_FLAMES)) object.flags &= ~ATTACK;
  for (let i = 0; i < 3; i += 1) object.last[i] = object.position[i]!;
  if (object.state === 0) {
    object.state = 1;
    object.flags |= DRAWN | ATTACK;
    object.look = (nextRandom(state.random) & 1) === 0 ? 'column mirrored' : 'column';
    object.words[CELL] = -1;
    aim(data, object);
    travel(object);
    object.velocity[1] = 0;
  } else if (object.state !== 1) return;
  const n = (object.words[CELL]! + 1) | 0;
  object.words[CELL] = n;
  if (0x36 <= n) {
    release(object);
    return;
  }
  object.velocity[1] = (object.velocity[1]! - 0x3999) | 0;
  object.position[1] = (object.position[1]! + (object.velocity[1]! >> 16)) | 0;
  if ((object.flags & ATTACK) !== 0 && data.effects.fire.columnHurts[n >> 1] === 0) object.flags &= ~ATTACK;
}

/* ---- A frame of the pool. ---- */

function step(state: FightState, data: FightData, i: number): void {
  const object = objectAt(state, i);
  switch (object.kind) {
    case 0:
      return expire(state, i);
    case 1:
      return burst(state, data, object, 'plain', true);
    case 2:
      return burst(state, data, object, 'plain', false);
    case 3:
      return glow(state, data, object);
    case 4:
      return trail(state, object);
    case 5:
      return sparkle(state, object);
    case 6:
      return fireBreath(state, data, object);
    case 7:
      return ember(state, data, object);
    case 8:
      return gonFire(state, data, object);
    case 9:
      return floorFlame(state, object);
    case 10:
      return breath(state, data, object);
    case 0xc:
      return burst(state, data, object, 'charged', true);
    case 0xd:
      return burst(state, data, object, 'charged', false);
    case 0xb:
      return burning(state, object);
    case 0x13:
      return flameRow(state, data, object);
    case 0x14:
      return flameColumn(state, data, object);
    case 0x10:
      return lineAfter(state, data, object);
    case 0x11:
      return echo(state, data, object);
    case 0x12:
      return replayEchoes(state, data, object);
    case 0xf:
      return ballGlow(state, data, object);
    default:
      return release(object);
  }
}

/** An attacking object's segment this frame, from where it was to where it is, among its fighter's effect segments. */
function addSegment(state: FightState, object: EffectObject): void {
  const which = (object.flags & FIRST_FIGHTER) !== 0 ? 0 : 1;
  const count = state.effectSegmentCounts[which]!;
  state.effectSegmentCounts[which] = count + 1;
  const segment = state.effectSegments[which]![count];
  if (segment === undefined) throw new Error(`fighter ${which} has more effect segments than the remake keeps`);
  for (let k = 0; k < 3; k += 1) {
    segment.from[k] = object.last[k]!;
    segment.to[k] = object.position[k]!;
  }
}

/**
 * A frame of the pool. On a played frame (`play`) every running object steps, attacking ones lay
 * their segments, and the glow is worked out; the pool is cleared once for the replay (the glow set
 * up again) and once for the knockout.
 */
export function stepPool(state: FightState, data: FightData, play: number): void {
  const effects = state.effects;
  state.effectSegmentCounts[1] = 0;
  state.effectSegmentCounts[0] = 0;
  let running = 0;
  if (play !== 0) {
    for (const f of state.fighters) f.unlit = 0;
    effects.glowTicks = (effects.glowTicks + 1) >>> 0;
    glowingLimbs(state, data);
  }
  if (effects.clearedForReplay === 0 && state.replaying !== 0) {
    clearPool(state);
    for (const joint of GLOW_JOINTS) glowAt(state, joint);
    effects.replayReset = 0;
    effects.clearedForReplay += 1;
  }
  if (effects.clearedForKnockout === 0 && (state.status - 3) >>> 0 < 5) {
    clearPool(state);
    effects.clearedForKnockout += 1;
  }
  for (let at = 0; at < effects.active.length; ) {
    const i = effects.active[at]!;
    const next = effects.active[at + 1];
    if (play !== 0) {
      step(state, data, i);
      running += 1;
      const object = objectAt(state, i);
      if ((object.flags & ATTACK) !== 0) addSegment(state, object);
    }
    if (next === undefined) break;
    at = effects.active.indexOf(next);
  }
  effects.running = running & 0xffff;
}

/**
 * Which of each fighter's hands and feet glow this frame (a bit a joint, the top bit to trail),
 * from its move's hit codes while it is charged (as the replay keeps the charge); a charged fighter
 * whose move names none glows on a hand and a foot.
 */
function glowingLimbs(state: FightState, data: FightData): void {
  const effects = state.effects;
  effects.glow[0] = 0;
  effects.glow[1] = 0;
  for (let i = 0; i < 2; i += 1) {
    const f = state.fighters[i]!;
    if (chargeThroughReplay(state, f, i) === 0) continue;
    const hit = hitOf(data, f.move!);
    const codes = hit === null ? [0, 0, 0, 0] : hit.codes;
    if (f.roster !== 0x11 && codes[0]! + codes[1]! + codes[2]! + codes[3]! !== 0) {
      if (f.frame <= moveAt(data, f.move!).activeWindow.last) {
        for (let k = 0; k < 4; k += 1) {
          const bit = data.effects.glowJoints[codes[k]!]!;
          if (bit !== 0) effects.glow[i] = (effects.glow[i]! | (1 << (bit & 0x1f)) | 0x80000000) >>> 0;
        }
      }
      continue;
    }
    effects.glow[i] = (effects.glow[i]! | 0x440) >>> 0;
  }
}

/** A fighter's charge as recorded live and played back in a replay. */
function chargeThroughReplay(state: FightState, f: Fighter, side: number): number {
  const replay = state.replay;
  if (replay.index !== 0) throw new Error('only the first replay is remade');
  let value = f.recovery;
  if (replay.state === 3) replay.held[side]!.charge = value & 0xff;
  if (replay.state === 3 || replay.state === 1 || replay.state === 6) value = replay.fighters[side]!.frames[replay.playFrame >> 1]!.charge;
  else if (replay.state === 4) value = replay.held[side]!.charge;
  else if (replay.state === 7) replay.fighters[side]!.frames[replay.recordFrame]!.charge = value & 0xff;
  return value;
}
