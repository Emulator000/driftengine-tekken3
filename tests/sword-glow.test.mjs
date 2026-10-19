/**
 * Yoshimitsu's sword glow, as the console draws it over his blade every frame: its colour by the
 * costume (Mokujin's own while he fights as Yoshimitsu), two shades taken in turn field by field,
 * and its line along the blade from the sword hand, run on past the hilt and the tip.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BLADE_LINE_POINTS, bladeLine, bladeMotes, swordShade, swordShades } from '../src/present/3d/fighter/sword-glow.ts';

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

test("the blade's line: its four points on the sword hand's joint, in the picture's metres, run on past the hilt and past the tip along the blade's ends", () => {
  /* The sword hand turned as the world is, at (1000, -1000, 500) millimetres. */
  const joints = Array.from({ length: 22 }, () => ({ world: { rotation: [4096, 0, 0, 0, 4096, 0, 0, 0, 4096], translation: [0, 0, 0] } }));
  joints[10] = { world: { rotation: [4096, 0, 0, 0, 4096, 0, 0, 0, 4096], translation: [1000, -1000, 500] } };
  const out = new Float32Array(BLADE_LINE_POINTS * 3);
  bladeLine({ skeleton: { joints } }, out);
  const point = (i) => [...out.subarray(i * 3, i * 3 + 3)];
  const near = (a, b, what) => a.forEach((v, k) => assert.ok(Math.abs(v - b[k]) < 1e-5, `${what}: ${a} against ${b}`));
  /* The game's x, minus its y and minus its z, in metres. */
  near(point(1), [1.06, 1.15, -0.5], 'the hilt');
  near(point(2), [1.05, 1.55, -0.5], 'the blade');
  near(point(3), [1.03, 1.72, -0.5], 'the blade');
  near(point(4), [0.94, 1.95, -0.5], 'the tip');
  const along = (from, to, by) => {
    const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    const l = Math.hypot(...d);
    return from.map((v, k) => v + (d[k] / l) * by);
  };
  near(point(0), along(point(1), point(2), -0.128), 'past the hilt');
  near(point(5), along(point(3), point(4), 0.02 + Math.hypot(0.94 - 1.03, 1.95 - 1.72)), 'past the tip');
});

test("the glow's motes along the line: an even step apart, at full strength from the hilt along the blade, fading out over its last stretch to the line's end just past the tip", () => {
  /* Straight up the picture's y: past the hilt 0.1, the blade's points at 0.1, 0.4, 0.7 and 1.1, the end at 1.3. */
  const line = new Float32Array([0, 0, 0, 0, 0.1, 0, 0, 0.4, 0, 0, 0.7, 0, 0, 1.1, 0, 0, 1.3, 0]);
  const motes = bladeMotes(line, 0.05);
  const ys = motes.map((m) => m.at[1]);
  assert.ok(Math.abs(ys[0]) < 1e-6 && Math.abs(ys.at(-1) - 1.3) < 1e-6, 'from one end to the other');
  ys.slice(1).forEach((y, i) => assert.ok(y - ys[i] <= 0.05 + 1e-6 && y > ys[i], 'an even step apart'));
  const strength = (y) => motes.find((m) => Math.abs(m.at[1] - y) < 1e-6)?.strength;
  assert.equal(strength(0), 0, 'nothing at the end past the hilt');
  assert.ok(Math.abs(strength(0.05) - 0.5) < 1e-6, 'half way up to the hilt, half');
  for (const y of [0.1, 0.4, 0.7]) assert.ok(Math.abs(strength(y) - 1) < 1e-6, `full along the blade (${y})`);
  assert.ok(Math.abs(strength(1.0) - 0.5) < 1e-6, 'half way along the last stretch to the end, half');
  assert.equal(strength(1.3), 0, 'nothing at the end past the tip');
});
