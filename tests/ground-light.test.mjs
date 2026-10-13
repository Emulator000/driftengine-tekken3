/**
 * The floor's light: a stage lit at each fighter's feet or over their midpoint, its corners'
 * shades by the square of their distance from the light (at most 254 with the fighters' two, no
 * brighter than its brightest over the midpoint), and True Ogre's light on a floor shaded by depth;
 * Tekken Force's single lights, at the player's feet and ahead of the camera on its final stage.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GroundLight, groundLighting, litShade } from '../src/present/3d/ground-light.ts';

/** Two fighters a metre either side of the centre, and points along the line through them, in millimetres. */
const A = [-1000, 0, 0];
const B = [1000, 0, 0];
const ALONG = [0, 3600, 5400, 7200, 9000];

test('a floor lit at the fighters\' feet adds their two lights, at most 254, and fades by the square of the distance', () => {
  assert.deepEqual(ALONG.map((x) => litShade(GroundLight.FIGHTERS, 0xc0, A, B, x, 0)), [254, 48, 19, 9, 5]);
  assert.equal(litShade(GroundLight.FIGHTERS, 0xc0, A, B, -1000, 0), 254, 'right under a fighter');
  assert.equal(litShade(GroundLight.FIGHTERS, 0xc0, [0, 0, 0], [0, 0, 1000000], 0, 1414), 126, 'one fighter\'s light, about unchanged at 1.4 m');
});

test('a floor lit over the midpoint is no brighter than its brightest', () => {
  assert.deepEqual(ALONG.map((x) => litShade(GroundLight.MIDPOINT, 0xc0, A, B, x, 0)), [192, 61, 27, 15, 9]);
  assert.equal(litShade(GroundLight.MIDPOINT, 0x80, A, B, 0, 0), 0x80);
  assert.equal(litShade(GroundLight.MIDPOINT, 0xc0, [0, 0, 4000], [0, 0, 8000], 0, 6000), 192, 'the light follows the midpoint');
});

test('with True Ogre in the match a floor shaded by depth takes the midpoint\'s light (on Gon\'s stage no brighter than it is); a lit floor stays as it is', () => {
  const stage = (groundKind) => ({ groundKind, shadeStrength: -51, cellSize: 1 });
  assert.deepEqual(groundLighting(stage(GroundLight.DEPTH), 3, 0), { kind: GroundLight.DEPTH, brightest: 0xc0 });
  assert.deepEqual(groundLighting(stage(GroundLight.DEPTH), 3, 2), { kind: GroundLight.MIDPOINT, brightest: 0xc0 });
  assert.deepEqual(groundLighting(stage(GroundLight.DEPTH), 13, 1), { kind: GroundLight.MIDPOINT, brightest: 0x80 });
  assert.deepEqual(groundLighting(stage(GroundLight.FIGHTERS), 6, 2), { kind: GroundLight.FIGHTERS, brightest: 0xc0 });
  assert.deepEqual(groundLighting(stage(GroundLight.MIDPOINT), 8, 0), { kind: GroundLight.MIDPOINT, brightest: 0xc0 });
});

test("Tekken Force's single lights: at the player's feet, and ahead of the camera on the final stage, at most 254", () => {
  const player = [2000, 0, 500];
  assert.equal(litShade(GroundLight.PLAYER, 0xc0, player, B, 2000, 500), 254, 'right under the player');
  assert.equal(litShade(GroundLight.PLAYER, 0xc0, player, B, 2000 + 2000, 500), Math.trunc(0x1e848000 / 4000000));
  assert.equal(litShade(GroundLight.CAMERA, 0xc0, [0, 0, -2000], B, 0, 1000), Math.trunc(0x18b82000 / 9000000));
  const stage = { groundKind: GroundLight.PLAYER, shadeStrength: -51, cellSize: 0 };
  assert.deepEqual(groundLighting(stage, 0x11, 0), { kind: GroundLight.PLAYER, brightest: 0xc0 });
  assert.deepEqual(groundLighting({ ...stage, groundKind: GroundLight.DEPTH }, 0xf, 0, true), { kind: GroundLight.CAMERA, brightest: 0xc0 }, 'the final stage, whatever its floor');
});
