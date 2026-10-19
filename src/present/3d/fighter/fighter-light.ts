/**
 * The fighters lit as the console lights them: each stage's record (`ArenaTables.fighterLights`)
 * gives a back colour every face takes, a light from one direction in its own colour, and one from
 * below half as strong (none on stage 17), the sum times the stage's colour (0x80 the texture's
 * own) and held at twice the texture. The picture's light is linear and added, so the console's
 * colours are taken into it: the back colour as the fighter's emission, the light as the scene's
 * sun and the light from below as its ground's ambient, each what it adds to the back colour.
 */
import type { FighterLightRecord } from '../../../assets/arena.ts';

/** The record Tekken Force's last stage, which has two fighters and no third, is lit by. */
const FORCE_FINAL = 12;
const TEKKEN_FORCE = 8;
/** The stage whose fighters have no light from below. */
const NOTHING_BELOW = 17;
/** The most a channel comes to: twice the texture, as the console holds it. */
const MOST = 255 / 128;

/**
 * What lights a fighter, in the picture's light: each channel's emission, the sun's and the
 * ground's colours, and the way toward the light (y up, z toward the viewer); and, as the console
 * takes them, each channel's colour (a share of the texture's own), the light's and the light from
 * below's (shares of the light's scale).
 */
export interface FighterLight {
  readonly emission: readonly [number, number, number];
  readonly sun: readonly [number, number, number];
  readonly ground: readonly [number, number, number];
  readonly toward: readonly [number, number, number];
  readonly tint: readonly [number, number, number];
  readonly light: readonly [number, number, number];
  readonly below: readonly [number, number, number];
}

/** The record the fight's fighters are lit by: its stage's, Tekken Force's last stage the twelfth's. */
export const lightRecord = (state: { readonly stage: number; readonly mode: number; readonly force: { readonly finalStage: number } }): number =>
  state.mode === TEKKEN_FORCE && state.force.finalStage !== 0 ? FORCE_FINAL : state.stage;

/** The console's colour for a channel (a share of the texture's own) in the picture's light. */
const linear = (display: number): number => Math.min(display, MOST) ** 2.2;

/** The emission a back colour (0 to 255 a channel, the light's scale) gives under record `record`'s colour: Practice's HIT ANALYSIS lights a fighter by its own. */
export const backLight = (record: FighterLightRecord, back: readonly [number, number, number]): [number, number, number] =>
  [0, 1, 2].map((c) => linear(((record.base[c]! / 128) * back[c]!) / 256)) as [number, number, number];

/** Record `index`'s light for the fighters. */
export function fighterLight(record: FighterLightRecord, index: number): FighterLight {
  const channel = (c: number, more: number): number => linear(((record.base[c]! / 128) * (record.back + more)) / 256);
  const emission = backLight(record, [record.back, record.back, record.back]);
  const sun = [0, 1, 2].map((c) => channel(c, record.light[c]!) - emission[c]!) as [number, number, number];
  const ground = [0, 1, 2].map((c) => (index === NOTHING_BELOW ? 0 : channel(c, record.light[c]! >> 1) - emission[c]!)) as [number, number, number];
  /* The way the console's light runs, in its axes (y down): up at its elevation, round from its azimuth less a half turn. */
  const turn = (a: number): number => (a / 4096) * 2 * Math.PI;
  const [elevation, azimuth] = [turn(record.angles[0]), turn(record.angles[1] - 0x800)];
  const runs = [Math.cos(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.sin(azimuth) * Math.cos(elevation)];
  /* Toward it, a half turn about x into the picture's axes. */
  const toward = [-runs[0]!, runs[1]!, runs[2]!] as [number, number, number];
  const share = (f: (c: number) => number): [number, number, number] => [f(0), f(1), f(2)];
  return {
    emission,
    sun,
    ground,
    toward,
    tint: share((c) => record.base[c]! / 128),
    light: share((c) => record.light[c]! / 256),
    below: share((c) => (index === NOTHING_BELOW ? 0 : (record.light[c]! >> 1) / 256)),
  };
}

/**
 * The console's light on a face turned to (x, y, z) (the picture's axes, a unit), in the picture's
 * light, into `out` from `at`: `back` its back colour (shares of the light's scale), the light by
 * how full the face is turned to it, the light from below by how far it is turned to the floor.
 */
export function lightOn(lit: FighterLight, back: readonly [number, number, number], x: number, y: number, z: number, out: Float32Array, at: number): void {
  const to = Math.max(0, x * lit.toward[0] + y * lit.toward[1] + z * lit.toward[2]);
  const down = Math.max(0, -y);
  for (let c = 0; c < 3; c += 1) out[at + c] = linear(lit.tint[c]! * (back[c]! + lit.light[c]! * to + lit.below[c]! * down));
}
