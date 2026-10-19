/**
 * A posed fighter's lowest points, its whole body's and its feet's, for lifting it onto the floor:
 * the same as a vertex-by-vertex reading of its weighted points, joint sets taken as flags.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { jointFlags, lowestPoint } from '../src/present/3d/fighter/lowest.ts';

const INFLUENCES = 4;

/** The reading the fight first made, a vertex at a time, its joint sets as sets. */
function reference(joints, weights, points, f, slots, hangs, feet, leftOut) {
  const out = { body: Infinity, feet: Infinity };
  vertices: for (let at = 0; at < weights.length; at += INFLUENCES) {
    let y = 0;
    let sum = 0;
    let heaviest = 0;
    let on = -1;
    for (let k = at; k < at + INFLUENCES; k += 1) {
      const w = weights[k];
      if (w === 0) continue;
      const joint = joints[k];
      const hung = joint < slots ? joint : hangs[joint - slots];
      if (leftOut.has(hung)) continue vertices;
      if (w > heaviest) [heaviest, on] = [w, hung];
      const o = joint * 16;
      y += w * (f[o + 1] * points[k * 3] + f[o + 5] * points[k * 3 + 1] + f[o + 9] * points[k * 3 + 2] + f[o + 13]);
      sum += w;
    }
    if (sum === 0) continue;
    if (y < out.body) out.body = y;
    if (feet.has(on) && y < out.feet) out.feet = y;
  }
  return out;
}

/** Numbers from a seed, the same every run. */
function numbers(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

test("a fighter's lowest points are those a vertex-by-vertex reading finds, whatever its skin", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const r = numbers(seed);
    const [vertices, slots, worn] = [400, 27, 6];
    const joints = new Float32Array(vertices * INFLUENCES);
    const weights = new Float32Array(vertices * INFLUENCES);
    const points = new Float32Array(vertices * INFLUENCES * 3);
    for (let k = 0; k < joints.length; k += 1) {
      joints[k] = Math.floor(r() * (slots + worn));
      weights[k] = r() < 0.4 ? 0 : r();
      for (let c = 0; c < 3; c += 1) points[k * 3 + c] = Math.round((r() - 0.5) * 2000);
    }
    const hangs = Uint8Array.from({ length: worn }, () => Math.floor(r() * slots));
    const matrices = Float32Array.from({ length: (slots + worn) * 16 }, () => (r() - 0.5) * 2);
    const feet = new Set([14, 17]);
    const leftOut = new Set([21, 22, 23]);
    const out = { body: 0, feet: 0 };
    lowestPoint(joints, weights, points, matrices, slots, hangs, jointFlags(feet), jointFlags(leftOut), out);
    assert.deepEqual(out, reference(joints, weights, points, matrices, slots, hangs, feet, leftOut), `seed ${seed}`);
  }
});

test('a joint set as flags, one a joint', () => {
  const flags = jointFlags(new Set([0, 14, 255]));
  assert.equal(flags.length, 256);
  assert.deepEqual([flags[0], flags[1], flags[14], flags[255]], [1, 0, 1, 1]);
});
