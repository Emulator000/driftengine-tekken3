/**
 * An arcade stage's moving pieces placed for a frame: each stands at its place in the scenery,
 * turned by its angles (pitch, yaw, roll), its yaw turning as it spins, its height and angles swaying
 * back and forth; each of its parts stands at its place in the piece, turned by its own angles and
 * spinning about one axis. All in the game's model units (8 mm) and axes, turned into the engine's.
 */

import type { PieceMotion } from '../../../assets/manifest.ts';

const UNIT_M = 0.008;

/** How far a sway has moved by field `n`, in its steps. */
function swayed(n: number, period: number, start: number): number {
  /* Fields summed from the start of a run whose first turn comes `period` fields in. */
  const sum = (p: number): number => (Math.floor(p / period) % 2 === 0 ? p % period : period - (p % period));
  return sum(n + period - start) - sum(period - start);
}

type Mat = Float64Array;

const identity = (): Mat => new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** a × b, column-major. */
function multiply(a: Mat, b: Mat): Mat {
  const out = new Float64Array(16);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      let v = 0;
      for (let k = 0; k < 4; k += 1) v += a[k * 4 + row]! * b[col * 4 + k]!;
      out[col * 4 + row] = v;
    }
  }
  return out;
}

/** A turn about one of the game's axes (0 x, 1 y, 2 z) by `turn` 4096ths, as the game turns: y's carries x toward z's minus. */
function rotation(axis: number, turn: number): Mat {
  const a = (turn * 2 * Math.PI) / 4096;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const m = identity();
  if (axis === 0) m.set([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
  else if (axis === 1) m.set([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
  else m.set([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  return m;
}

const translation = (x: number, y: number, z: number): Mat => {
  const m = identity();
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
};

/** Pitch, then roll, then yaw outermost. */
const turned = (pitch: number, yaw: number, roll: number): Mat => multiply(rotation(1, yaw), multiply(rotation(0, pitch), rotation(2, roll)));

/** The game's model units and axes to the engine's: x as is, y and z the other way, 8 mm a unit. */
const TO_ENGINE = new Float64Array([UNIT_M, 0, 0, 0, 0, -UNIT_M, 0, 0, 0, 0, -UNIT_M, 0, 0, 0, 0, 1]);
const FROM_ENGINE = new Float64Array([1 / UNIT_M, 0, 0, 0, 0, -1 / UNIT_M, 0, 0, 0, 0, -1 / UNIT_M, 0, 0, 0, 0, 1]);

/**
 * Each part's model matrix at field `n`: `scenery` the scenery's (its vertices in the engine's
 * metres), then the piece's place and turn, then the part's.
 */
export function placeParts(motion: PieceMotion, n: number, scenery: Float32Array, out: Float32Array[]): void {
  let height = 0;
  let [pitch, yaw, roll] = motion.angles;
  yaw += motion.spin * (motion.wrap > 0 ? n % motion.wrap : n);
  for (const sway of motion.sway) {
    const moved = sway.step * swayed(n, sway.period, sway.start);
    if (sway.channel === 'height') height += moved;
    else if (sway.channel === 'pitch') pitch += moved;
    else if (sway.channel === 'yaw') yaw += moved;
    else roll += moved;
  }
  const piece = multiply(translation(motion.at[0], motion.at[1] + height, motion.at[2]), turned(pitch, yaw, roll));
  const base = multiply(Float64Array.from(scenery), TO_ENGINE);
  motion.parts.forEach((part, i) => {
    const own = multiply(translation(...part.at), multiply(turned(...part.angles), rotation(part.spin.axis, part.spin.rate * n)));
    const m = multiply(base, multiply(piece, multiply(own, FROM_ENGINE)));
    (out[i] ??= new Float32Array(16)).set(m);
  });
}
