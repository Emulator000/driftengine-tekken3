/**
 * The pads' vibration, a field at a time as the console's driver runs it: each pattern asked for
 * (on a pad, or on both) taken at the next field onto its channel of four, restarting that
 * channel's small and large motor (a motor whose pattern has no steps keeps what it played); each
 * motor of each channel stepped a field, its small motor turning on the fields its level's duty
 * gives and its large motor at its level; the highest channel playing each motor deciding it; and
 * a pad's motors felt only while its side has joined and its vibration is on.
 */
import type { VibrationTables } from '../data/input.ts';
import type { GameState, MotorTrack } from './state.ts';

const PADS = 2;
const CHANNELS = 4;
const SMALL = 0;
const LARGE = 1;
/** A step's level, its fields, and whether another follows it. */
const level = (word: number): number => (word >> 8) & 0xf;
const fields = (word: number): number => word & 0xff;
const goesOn = (word: number): boolean => word >> 12 === 1;

/** A pad's motor's channel. */
export function track(game: GameState, pad: number, motor: number, channel: number): MotorTrack {
  return game.rumble.tracks[(pad * 2 + motor) * CHANNELS + channel]!;
}

/** One field: the patterns asked for taken, every motor stepped, each pad told what it feels. */
export function rumbleField(game: GameState, tables: VibrationTables): void {
  const rumble = game.rumble;
  const world = game.world;
  const asked = new Array<number>(PADS * CHANNELS).fill(0);
  for (const { pad, pattern } of world.vibrations) {
    const channel = tables.channels[pattern] ?? CHANNELS;
    if (channel >= CHANNELS) continue;
    for (const p of pad < PADS ? [pad] : [0, 1]) asked[p * CHANNELS + channel] = pattern;
  }
  world.vibrations.length = 0;
  if (rumble.empty !== 0) {
    for (const t of rumble.tracks) Object.assign(t, { pattern: 0, step: -1, count: 0, active: 0, value: 0 });
    rumble.empty = 0;
  }
  for (let pad = 0; pad < PADS; pad += 1) {
    for (let channel = 0; channel < CHANNELS; channel += 1) {
      const pattern = asked[pad * CHANNELS + channel]!;
      if (pattern === 0) continue;
      for (const [motor, steps] of [
        [SMALL, tables.small[pattern]!],
        [LARGE, tables.large[pattern]!],
      ] as const) {
        if (steps[0]! >> 12 !== 0) Object.assign(track(game, pad, motor, channel), { pattern, step: 0, count: 0 });
      }
    }
    const felt = [0, 0];
    for (let channel = 0; channel < CHANNELS; channel += 1) {
      for (const motor of [SMALL, LARGE]) {
        const t = track(game, pad, motor, channel);
        t.active = 0;
        if (t.step < 0) continue;
        const word = (motor === SMALL ? tables.small : tables.large)[t.pattern]![t.step]!;
        t.active = 1;
        t.count += 1;
        t.value = motor === SMALL ? (tables.duty[level(word)]! >> (rumble.clock & 7)) & 1 : (level(word) << 4) + 15;
        if (t.count >= fields(word)) {
          t.count = 0;
          t.step = goesOn(word) ? t.step + 1 : -1;
        }
        felt[motor] = t.value;
      }
    }
    const on = world.joined[pad] !== 0 && game.motors[pad] !== 0;
    rumble.out[pad]!.splice(0, 2, on ? felt[SMALL]! : 0, on ? felt[LARGE]! : 0);
  }
  rumble.clock = (rumble.clock + 1) >>> 0;
}

/** Both pads' motors stopped: their vibration off, what was asked this frame dropped, every pattern ended at the next field. */
export function stopMotors(game: GameState): void {
  motorsOff(game);
  game.world.vibrations.length = 0;
  game.rumble.empty = 1;
}

/** Both pads' vibration switched off, their patterns playing on unfelt. */
export function motorsOff(game: GameState): void {
  game.motors[0] = 0;
  game.motors[1] = 0;
}
