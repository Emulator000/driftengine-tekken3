/**
 * Yoshimitsu's sword glow, as the console draws it over his blade every frame: its colour by the
 * costume (Mokujin's own while he fights as Yoshimitsu), two shades taken in turn field by field,
 * added as the console adds them; its line along the blade from the sword hand, hilt to tip; and its
 * band, as wide as the console's and falling off as it does.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BLADE_LINE_POINTS, bladeLine, bladeMotes, HAZE, hazeLight, swordShade, swordShades } from '../src/present/3d/fighter/sword-glow.ts';

const fighter = (roster, character, costume) => ({ roster, character, costume });

test("the glow's shades: Yoshimitsu's green, his second costume's red, Mokujin's own while he fights as Yoshimitsu; nobody else's", () => {
  assert.deepEqual(swordShades(fighter(4, 4, 8)), [[24, 48, 24], [12, 30, 12]], 'Yoshimitsu');
  assert.deepEqual(swordShades(fighter(4, 4, 9)), [[72, 30, 30], [48, 24, 24]], 'his second costume');
  assert.deepEqual(swordShades(fighter(15, 4, 30)), [[60, 30, 12], [30, 18, 12]], 'Mokujin as Yoshimitsu');
  assert.equal(swordShades(fighter(15, 9, 30)), null, 'Mokujin as another');
  assert.equal(swordShades(fighter(0, 0, 0)), null, 'Paul');
  assert.equal(swordShades(fighter(8, 4, 16)), null, "another fighter with Yoshimitsu's moves is no Mokujin");
});

test('the two shades are taken in turn, one a field', () => {
  const f = fighter(4, 4, 8);
  assert.deepEqual([0, 1, 2, 3].map((field) => swordShade(f, field)), [[24, 48, 24], [12, 30, 12], [24, 48, 24], [12, 30, 12]]);
  assert.equal(swordShade(fighter(0, 0, 0), 0), null);
});

test("the blade's line: its four points on the sword hand's joint, hilt to tip, in the picture's metres", () => {
  /* The sword hand turned as the world is, at (1000, -1000, 500) millimetres. */
  const joints = Array.from({ length: 22 }, () => ({ world: { rotation: [4096, 0, 0, 0, 4096, 0, 0, 0, 4096], translation: [0, 0, 0] } }));
  joints[10] = { world: { rotation: [4096, 0, 0, 0, 4096, 0, 0, 0, 4096], translation: [1000, -1000, 500] } };
  const out = new Float32Array(BLADE_LINE_POINTS * 3);
  bladeLine({ skeleton: { joints } }, out);
  assert.equal(BLADE_LINE_POINTS, 4);
  const point = (i) => [...out.subarray(i * 3, i * 3 + 3)];
  const near = (a, b, what) => a.forEach((v, k) => assert.ok(Math.abs(v - b[k]) < 1e-5, `${what}: ${a} against ${b}`));
  /* The game's x, minus its y and minus its z, in metres. */
  near(point(0), [1.06, 1.15, -0.5], 'the hilt');
  near(point(1), [1.05, 1.55, -0.5], 'the blade');
  near(point(2), [1.03, 1.72, -0.5], 'the blade');
  near(point(3), [0.94, 1.95, -0.5], 'the tip');
});

test("the glow's motes along the line: an even step apart, from the hilt to the tip", () => {
  /* Straight up the picture's y: the blade's points at 0.1, 0.4, 0.7 and 1.1. */
  const line = new Float32Array([0, 0.1, 0, 0, 0.4, 0, 0, 0.7, 0, 0, 1.1, 0]);
  const ys = bladeMotes(line, 0.05).map((at) => at[1]);
  assert.ok(Math.abs(ys[0] - 0.1) < 1e-6 && Math.abs(ys.at(-1) - 1.1) < 1e-6, 'from one end to the other');
  ys.slice(1).forEach((y, i) => assert.ok(y - ys[i] <= 0.05 + 1e-6 && y > ys[i], 'an even step apart'));
});

test("the glow adds the light the console's add shows as where nothing lies under it: its shade as shown, in the scene's light", () => {
  /* A white texel times the shade over 128, 248 of 255, as shown, taken back to light. */
  const added = (shade) => ((shade * 248) / 128 / 255) ** 2.2;
  hazeLight([24, 48, 24]).forEach((v, k) => assert.ok(Math.abs(v - added([24, 48, 24][k])) < 1e-9));
  assert.ok(Math.abs(hazeLight([24, 48, 24])[1] - 0.109) < 0.001);
});

test("the glow's band is as wide as the console's: brightest on the blade's line, falling off to nothing 124 mm to either side", () => {
  /* The engine's mote: a soft round point, the square of one less a smoothstep from 0.4 to 1 of its radius. */
  const smooth = (x) => {
    const t = Math.min(1, Math.max(0, (x - 0.4) / 0.6));
    return t * t * (3 - 2 * t);
  };
  const mote = (r) => (r < 1 ? (1 - smooth(r)) ** 2 : 0);
  const band = (off) => HAZE.layers.reduce((sum, { size, share }) => {
    let total = 0;
    for (let j = -200; j <= 200; j += 1) total += mote(Math.hypot(j * HAZE.step, off) / size);
    return sum + share * total;
  }, 0);
  /* The console's band, as light: its shade as shown falling off evenly to its edge. */
  const console = (off) => Math.max(0, 1 - off / 0.124) ** 2.2;
  for (const off of [0, 0.02, 0.04, 0.06, 0.08, 0.1, 0.124, 0.16]) assert.ok(Math.abs(band(off) - console(off)) < 0.1, `${off * 1000} mm off the line: ${band(off).toFixed(3)} against ${console(off).toFixed(3)}`);
});
