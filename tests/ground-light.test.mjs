/**
 * The floor's light: a stage lit at each fighter's feet or over their midpoint, its corners'
 * shades by the square of their distance from the light (at most 254 with the fighters' two, no
 * brighter than its brightest over the midpoint), and True Ogre's light on a floor shaded by depth.
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
