/**
 * The fight's effects this frame as pieces to draw, read from the simulation's records: each of
 * the three spark slots playing, each dust cloud's puffs, and each drawn object of the effect pool
 * (a burst's spark, a breath's puff). A piece is where the effect is (metres, in the engine's axes:
 * the game's y and z turned over), how it moves (metres a second), how far through its life it is
 * (0 to 1), how many frames that life is, its colour (0 to 1), and a seed stable over its life, so
 * a frame held or played again draws the same.
 */
import { sparkRow } from '../../../sim/effects/sparks.ts';
import type { LightningStroke } from '../../../sim/data/effects.ts';
import type { EffectObject, FightData, FightState, Spark } from '../../../sim/fight/state.ts';

export type EffectLook =
  /** A heavy blow's spark, in its fighter's design and colour. */
  | 'heavy'
  /** The generic sheets: a hit's spray, a guard's (two colours), a puff of dust. */
  | 'hit'
  | 'guard'
  | 'guard2'
  | 'dust'
  /** The effect pool: a burst's spark, a charged one, a breath's puff; the charged glow on a hand or foot, its trail, its sparkle. */
  | 'burst'
  | 'charged'
  | 'breath'
  | 'glow'
  | 'trail'
  | 'sparkle'
  /** The fire: a breath's fireball (Ogre's, Gon's), an ember, a flame on the floor, a flame on a burning fighter, a column of Gon's flames. */
  | 'fireball'
  | 'gon fireball'
  | 'ember'
  | 'floor flame'
  | 'burning'
  | 'flame column';

/**
 * Each fighter's heavy spark, as its own sheet draws it: Paul's ring of fire, Law's swirling
 * crescents, Lei's violet bloom, King's golden sphere of filaments, Yoshimitsu's needles and green
 * burst, Nina's and Anna's electric web, Hwoarang's cyan sphere and its dust, Xiaoyu's orbiting
 * orbs, the magenta sparkles (Eddy, Ogre, True Ogre), the Mishimas' lightning (Jin, Heihachi, and
 * the sheet Gon, Doctor B. and the soldiers share), Julia's fireworks, Kuma's star, Bryan's toxic
 * burst, Gun Jack's orbs.
 */
export type HeavyDesign = 'fire ring' | 'swirl' | 'bloom' | 'gold sphere' | 'needles' | 'web' | 'cyan sphere' | 'orbit' | 'sparkles' | 'lightning' | 'fireworks' | 'star' | 'toxic' | 'orbs';

/** By roster row (an added character's stand-in's). */
const DESIGNS: readonly HeavyDesign[] = [
  'fire ring',
  'swirl',
  'bloom',
  'gold sphere',
  'needles',
  'web',
  'cyan sphere',
  'orbit',
  'sparkles',
  'lightning',
  'fireworks',
  'star',
  'toxic',
  'lightning',
  'sparkles',
  'sparkles',
  'orbs',
  'lightning',
  'web',
  'lightning',
  'sparkles',
  'lightning',
];

/** A sheet's frame drawn as the original lays it: its strokes, mirrored or not, over a square this many metres across facing the view, at this strength (its shade). */
export interface SheetFrame {
  readonly strokes: readonly LightningStroke[];
  readonly mirrored: boolean;
  readonly size: number;
  readonly shade: number;
}

export interface EffectPiece {
  readonly look: EffectLook;
  /** A heavy spark's design. */
  readonly design: HeavyDesign;
  /** The Mishimas' lightning: the frame of the sheet the game shows. */
  readonly sheet?: SheetFrame;
  readonly position: readonly [number, number, number];
  readonly velocity: readonly [number, number, number];
  readonly age: number;
  readonly frames: number;
  readonly colour: readonly [number, number, number];
  readonly seed: number;
}

/**
 * The game sizes a spark's sprite by its depth alone: 32 texels make 32 × 0x2e0b screen units over
 * the depth, so against the world the sprite measures that over the projection's distance (in
 * metres here), the same up as across once the screen's tall pixels are undone.
 */
const SPRITE_SPAN = (32 * 0x2e0b) / 1000;
/** The sheet's last ten frames darken by 0x9999 in 4096ths of its shade (0x80) each. */
const FADING_FRAMES = 10;

/**
 * The lightning sheet's frame a slot shows, with where and how strongly it is drawn. The game draws
 * a slot's frame and then steps it on, both within the field, so the frame on screen is one before
 * the slot's own as the field leaves it.
 */
function sheetFrame(state: FightState, data: FightData, slot: Spark): SheetFrame {
  const frames = data.effects.lightning;
  const shown = slot.frame - 2;
  const late = shown + 1 - slot.last + FADING_FRAMES;
  const shade = 0 < late ? 0x80 - ((late * 0x9999) >> 12) : 0x80;
  return {
    strokes: frames[Math.min(frames.length - 1, Math.max(0, shown))]!,
    mirrored: slot.mirrored !== 0,
    size: SPRITE_SPAN / (state.screen.distance || 500),
    shade: shade / 0x80,
  };
}

/** A spark's or puff's point is 128ths of a millimetre; the pool's objects whole millimetres. */
const SPARK_UNIT = 128 * 1000;
const POOL_UNIT = 1000;
/** A pool velocity's 16.16 millimetres a frame, as metres a second. */
const POOL_SPEED = 60 / 65536 / 1000;
/** A spark's drift, 128ths of a millimetre a frame, as metres a second. */
const DRIFT_SPEED = 60 / SPARK_UNIT;
const GENERIC_ROW = 2;
const DUST_CODE = 3;
const BURSTS = new Set([1, 2]);
const CHARGED_BURSTS = new Set([0xc, 0xd]);
const BREATH = 10;
const GLOW = 3;
const TRAIL = 4;
const SPARKLE = 5;
/** The fire's kinds: a breath's puff, an ember, Gon's puff, a floor flame, a burning flame, a column. */
const FIREBALL = 6;
const EMBER = 7;
const GON_FIREBALL = 8;
const FLOOR_FLAME = 9;
const BURNING = 0xb;
const COLUMN = 0x14;
/** The fire's words: its stage's count and length, its cell's count. */
const FIRE_STAGE = 0;
const FIRE_LENGTH = 1;
const FIRE_CELL = 2;
/** The glow's palette steps every other frame through eight colours; the trail lives sixteen frames, the sparkle 32. */
const GLOW_CYCLE = 16;
const TRAIL_FRAMES = 0x10;
const SPARKLE_FRAMES = 0x20;
/** The pool's flag for an object that is drawn, and its words' age and life (a burst's), frame (a breath's), count (the glow's and trail's second, the sparkle's first). */
const DRAWN = 0x40;
const AGE = 0;
const LIFE = 1;
const BREATH_FRAME = 2;
const BREATH_KIND = 3;
const BREATH_FRAMES = 0x15;
/** Yoshimitsu's breath (magenta), and Doctor B.'s (a sickly yellow). */
const BREATH_COLOURS: readonly (readonly [number, number, number])[] = [
  [0.7, 0.04, 0.66],
  [0.7, 0.7, 0.26],
];
const WHITE = [1, 1, 1] as const;

/** A whole number from a few, mixed, for seeding. */
export function mix(...values: readonly number[]): number {
  let h = 0x811c9dc5;
  for (const v of values) {
    h = Math.imul(h ^ (v | 0), 0x01000193);
    h ^= h >>> 15;
  }
  return h >>> 0;
}

const toEngine = (p: readonly number[], unit: number): [number, number, number] => [p[0]! / unit, -p[1]! / unit, -p[2]! / unit];

/** A spark's seed: its slot, its sheet, and the way it drifts (constant over its life, as the drift only slows). */
function sparkSeed(slot: Spark, index: number): number {
  const [x, y, z] = slot.drift as [number, number, number];
  const angle = (a: number, b: number): number => (a === 0 && b === 0 ? 0 : Math.round((Math.atan2(a, b) / Math.PI) * 64));
  return mix(index, slot.sheet?.row ?? 0, slot.sheet?.code ?? 0, slot.last, angle(x, z), angle(y, Math.hypot(x, z)));
}

function sparkPiece(state: FightState, data: FightData, slot: Spark, index: number): EffectPiece | null {
  if (slot.frame <= 0 || slot.sheet === null) return null;
  const { row, code } = slot.sheet;
  let look: EffectLook;
  let design: HeavyDesign = 'fire ring';
  let colour: readonly [number, number, number] = WHITE;
  if (row < GENERIC_ROW) {
    const rosterRow = sparkRow(state, data, row);
    const spark = data.effects.characterSparks[rosterRow];
    if (spark === undefined) return null;
    look = 'heavy';
    design = DESIGNS[rosterRow] ?? 'fire ring';
    colour = [spark.colour[0]! / 255, spark.colour[1]! / 255, spark.colour[2]! / 255];
  } else look = code === 0 ? 'hit' : code === DUST_CODE ? 'dust' : code === 1 ? 'guard' : 'guard2';
  return {
    look,
    design,
    ...(look === 'heavy' && design === 'lightning' ? { sheet: sheetFrame(state, data, slot) } : {}),
    position: toEngine(slot.position, SPARK_UNIT),
    velocity: [slot.drift[0]! * DRIFT_SPEED, -slot.drift[1]! * DRIFT_SPEED, -slot.drift[2]! * DRIFT_SPEED],
    age: (slot.frame - 1) / Math.max(1, slot.last),
    frames: slot.last,
    colour,
    seed: sparkSeed(slot, index),
  };
}

const FIRE_KINDS = new Set([FIREBALL, EMBER, GON_FIREBALL, FLOOR_FLAME, BURNING, COLUMN]);
const share = (n: number, of: number): number => Math.min(1, Math.max(0, n / of));

/**
 * A fire object's look and how far through its life it is, from its stage and its counters: a
 * fireball flies (seven frames), burns (its stage's length) and dies out (eight frames, Gon's nine);
 * an ember glows then fades (twelve frames); a floor flame flickers up to 91 frames then rises away
 * (sixteen); a burning flame burns up to 75 frames, rises (seven) and goes out (five); a column
 * rises for 54 frames.
 */
function firePiece(object: EffectObject): { look: EffectLook; age: number; frames: number } {
  const w = object.words;
  switch (object.kind) {
    case FIREBALL:
    case GON_FIREBALL: {
      const look = object.kind === FIREBALL ? 'fireball' : 'gon fireball';
      const age =
        object.state <= 1 ? 0.25 * share(w[FIRE_CELL]! + 1, 7) : object.state === 2 ? 0.25 + 0.45 * share(w[FIRE_STAGE]!, w[FIRE_LENGTH]!) : 0.7 + 0.3 * share(w[FIRE_CELL]! + 1, object.kind === FIREBALL ? 8 : 9);
      return { look, age, frames: 24 };
    }
    case EMBER:
      return { look: 'ember', age: object.state <= 1 ? 0.5 * share(w[FIRE_STAGE]!, w[FIRE_LENGTH]!) : 0.5 + 0.5 * share(w[FIRE_STAGE]!, 12), frames: 30 };
    case FLOOR_FLAME:
      return { look: 'floor flame', age: object.state <= 1 ? 0.8 * (1 - share(w[FIRE_LENGTH]! + 1, 92)) : 0.8 + 0.2 * share(w[FIRE_STAGE]!, 16), frames: 92 };
    case BURNING:
      return { look: 'burning', age: object.state <= 1 ? 0.8 * (1 - share(w[FIRE_STAGE]!, 76)) : object.state === 2 ? 0.8 + 0.1 * share(w[FIRE_STAGE]! + 1, 7) : 0.9 + 0.1 * share(w[FIRE_STAGE]!, 5), frames: 90 };
    default:
      return { look: 'flame column', age: share(w[FIRE_CELL]!, 0x36), frames: 0x36 };
  }
}

/** The effects to draw this frame. */
export function effectPieces(state: FightState, data: FightData): EffectPiece[] {
  const pieces: EffectPiece[] = [];
  state.sparks.slots.forEach((slot, i) => {
    const piece = sparkPiece(state, data, slot, i);
    if (piece) pieces.push(piece);
  });
  state.dust.clouds.forEach((cloud, c) => {
    if (cloud.age <= 0) return;
    cloud.puffs.forEach((puff, p) => {
      const piece = sparkPiece(state, data, puff, 3 + c * 6 + p);
      if (piece) pieces.push({ ...piece, look: 'dust', seed: mix(c, p, cloud.origin[0]!, cloud.origin[2]!) });
    });
  });
  for (const i of state.effects.active) {
    const object = state.effects.objects[i]!;
    if ((object.flags & DRAWN) === 0) continue;
    const position = toEngine(object.position, POOL_UNIT);
    const velocity: [number, number, number] = [object.velocity[0]! * POOL_SPEED, -object.velocity[1]! * POOL_SPEED, -object.velocity[2]! * POOL_SPEED];
    if (BURSTS.has(object.kind) || CHARGED_BURSTS.has(object.kind)) {
      const life = Math.max(1, object.words[LIFE]!);
      pieces.push({ look: CHARGED_BURSTS.has(object.kind) ? 'charged' : 'burst', design: 'fire ring', position, velocity, age: Math.min(1, object.words[AGE]! / life), frames: life, colour: WHITE, seed: mix(i, life) });
    } else if (object.kind === GLOW) {
      const frame = Math.max(0, object.words[LIFE]!);
      pieces.push({ look: 'glow', design: 'fire ring', position, velocity: [0, 0, 0], age: (frame % GLOW_CYCLE) / GLOW_CYCLE, frames: GLOW_CYCLE, colour: WHITE, seed: mix(i, object.words[AGE]!) });
    } else if (object.kind === TRAIL || object.kind === SPARKLE) {
      const trail = object.kind === TRAIL;
      const frames = trail ? TRAIL_FRAMES : SPARKLE_FRAMES;
      const frame = Math.max(0, object.words[trail ? LIFE : AGE]!);
      /* They only rise: the rise is kept as a speed the height loses each frame. */
      pieces.push({ look: trail ? 'trail' : 'sparkle', design: 'fire ring', position, velocity: [0, object.velocity[1]! * POOL_SPEED, 0], age: frame / frames, frames, colour: WHITE, seed: mix(i, object.kind, object.position[0]!, object.position[2]!) });
    } else if (FIRE_KINDS.has(object.kind)) {
      const piece = firePiece(object);
      pieces.push({ ...piece, design: 'fire ring', position, velocity, colour: WHITE, seed: mix(i, object.kind) });
    } else if (object.kind === BREATH) {
      const frame = Math.max(0, object.words[BREATH_FRAME]!);
      pieces.push({ look: 'breath', design: 'fire ring', position, velocity, age: frame / BREATH_FRAMES, frames: BREATH_FRAMES, colour: BREATH_COLOURS[object.words[BREATH_KIND] === 0 ? 0 : 1]!, seed: mix(i, object.climb, object.heading) });
    }
  }
  return pieces;
}
