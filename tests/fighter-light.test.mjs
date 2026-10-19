/**
 * The fighters lit as the console lights them, each stage by its own record: what a face turned
 * full to the light, one turned from it and one turned to the floor come to, in the picture's
 * light, against the console's colour (its back colour, light colour and the half as strong light
 * from below, times the stage's colour, at most twice the texture's own); and where the light comes
 * from.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { backLight, fighterLight, lightOn, lightRecord } from '../src/present/3d/fighter/fighter-light.ts';

/** A record: its back colour (0 to 255 a channel), its colour (0x80 the texture's own), the light's colour and its elevation and azimuth (4096ths). */
const RECORD = { back: 0x89, base: [0x7e, 0x80, 0x80], light: [192, 248, 164], angles: [0x200, 0xa00] };
const linear = (display) => Math.min(display, 255 / 128) ** 2.2;
const close = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-6, `${what}: ${a} against ${b}`);

test("a face turned from every light shows the stage's back colour times its colour; one full to the light, that and the light's", () => {
  const lit = fighterLight(RECORD, 2);
  for (let c = 0; c < 3; c += 1) {
    const tint = RECORD.base[c] / 128;
    close(lit.emission[c], linear((tint * RECORD.back) / 256), `shaded, channel ${c}`);
    close(lit.emission[c] + lit.sun[c], linear((tint * (RECORD.back + RECORD.light[c])) / 256), `full to the light, channel ${c}`);
  }
});

test('a face turned to the floor takes the light from below, half the light, but on stage 17', () => {
  const lit = fighterLight(RECORD, 2);
  for (let c = 0; c < 3; c += 1) close(lit.emission[c] + lit.ground[c], linear(((RECORD.base[c] / 128) * (RECORD.back + (RECORD.light[c] >> 1))) / 256), `from below, channel ${c}`);
  assert.deepEqual(Array.from(fighterLight(RECORD, 17).ground), [0, 0, 0], 'none on stage 17');
});

test("Practice's colour lights a fighter as its back colour, under the stage's colour", () => {
  const lit = backLight(RECORD, [255, 0, 64]);
  close(lit[0], linear(((RECORD.base[0] / 128) * 255) / 256), 'red');
  close(lit[1], 0, 'no green');
  close(lit[2], linear(((RECORD.base[2] / 128) * 64) / 256), 'blue');
});

test('a channel the console carries past twice the texture stops there', () => {
  const lit = fighterLight({ ...RECORD, base: [0xff, 0x80, 0x80], back: 0xc0, light: [0xff, 0, 0] }, 2);
  close(lit.emission[0] + lit.sun[0], linear(255 / 128), 'held at twice');
});

test('the light comes from above at its elevation, round at its azimuth, in the picture axes (y up, z toward the viewer)', () => {
  const up = fighterLight({ ...RECORD, angles: [0x400, 0] }, 2).toward;
  close(up[1], 1, 'straight above');
  const [x, y, z] = fighterLight(RECORD, 2).toward;
  close(Math.hypot(x, y, z), 1, 'a unit');
  /* Elevation 45 degrees, azimuth 225 less a half turn, 45: the console's light runs down along +x and +z, so it comes from -x, above, and +z in the picture's axes. */
  close(y, Math.SQRT1_2, 'up');
  assert.ok(x < 0 && z > 0, `from ${x}, ${z}`);
  close(x, -0.5, 'across');
  close(z, 0.5, 'toward the viewer');
});

test("a face's light, as the console's sum for its turn: its back colour turned from every light, with the light full to it, with the light from below turned down", () => {
  const lit = fighterLight(RECORD, 2);
  const out = new Float32Array(3);
  const back = [RECORD.back / 256, RECORD.back / 256, RECORD.back / 256];
  const at = (x, y, z) => {
    lightOn(lit, back, x, y, z, out, 0);
    return Array.from(out);
  };
  const [tx, ty, tz] = lit.toward;
  at(tx, ty, tz).forEach((v, c) => close(v, lit.emission[c] + lit.sun[c], `full to the light, channel ${c}`));
  at(0, -1, 0).forEach((v, c) => close(v, lit.emission[c] + lit.ground[c], `to the floor, channel ${c}`));
  at(-tx, 0, -tz).forEach((v, c) => close(v, lit.emission[c], `turned from both, channel ${c}`));
});

test("each stage's record is its own, Tekken Force's last stage the twelfth's", () => {
  assert.equal(lightRecord({ stage: 4, mode: 0, force: { finalStage: 0 } }), 4);
  assert.equal(lightRecord({ stage: 16, mode: 8, force: { finalStage: 0 } }), 16);
  assert.equal(lightRecord({ stage: 18, mode: 8, force: { finalStage: 1 } }), 12);
});
