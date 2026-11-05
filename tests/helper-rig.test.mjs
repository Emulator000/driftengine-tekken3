/**
 * Tekken 4's helper bones posed from Tekken 3's joints (`src/mod/kazuya/tekken4.ts`), on a made-up
 * skeleton: the game's joint rotations come slightly scaled (each kept to a 4096th), and the helpers
 * are those of the rotations themselves, not of the scale, so a still hand holds its twist.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HelperRig, rigJoint, RIG_NODES } from '../src/mod/kazuya/tekken4.ts';

/** A made-up skeleton of Tekken 4's shape: the main nodes chained limb by limb, every helper on the chest, each node 100 mm along its parent. */
const PARENT = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 2, 6: 5, 7: 6, 8: 7, 9: 2, 10: 9, 11: 10, 12: 11, 13: 0, 14: 13, 15: 14, 16: 15, 17: 0, 18: 13, 19: 18, 20: 19 };
const nodes = Array.from({ length: 55 }, (_, i) => ({ parent: i === 0 ? -1 : (PARENT[i] ?? 2), offset: [100, 10 * (i % 3), 0], rotation: [0.1 * (i % 4), 0, 0.05 * (i % 5)] }));

/** A rotation from three angles (radians), column vectors. */
function rotation(a, b, c) {
  const [ca, sa, cb, sb, cc, sc] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(c), Math.sin(c)];
  const x = [1, 0, 0, 0, ca, -sa, 0, sa, ca];
  const y = [cb, 0, sb, 0, 1, 0, -sb, 0, cb];
  const z = [cc, -sc, 0, sc, cc, 0, 0, 0, 1];
  const mul = (p, q) => Array.from({ length: 9 }, (_, k) => p[Math.floor(k / 3) * 3] * q[k % 3] + p[Math.floor(k / 3) * 3 + 1] * q[3 + (k % 3)] + p[Math.floor(k / 3) * 3 + 2] * q[6 + (k % 3)]);
  return mul(mul(z, y), x);
}

/** Tekken 3's joints posed: each turned its own way, placed 100 mm apart. */
const joints = Array.from({ length: 22 }, (_, j) => ({ r: Float64Array.from(rotation(0.3 * Math.sin(j), 0.5 * Math.cos(j * 1.7), 0.4 * Math.sin(j * 2.3))), t: Float64Array.from([j * 100, j * 30, -j * 20]) }));
/** The same pose as the game gives it: each rotation's columns scaled a little. */
const scaled = joints.map(({ r, t }) => ({ r: Float64Array.from(r, (v, k) => v * [0.994, 0.996, 1.001][k % 3]), t }));

/** The turn between two frames' rotations, in degrees, each made a rotation first. */
function between(a, b) {
  const unit = (m) => {
    const out = Array.from(m);
    for (let c = 0; c < 3; c += 1) {
      const length = Math.hypot(out[c], out[3 + c], out[6 + c]);
      for (let r = 0; r < 3; r += 1) out[r * 3 + c] /= length;
    }
    return out;
  };
  const [p, q] = [unit(a), unit(b)];
  let trace = 0;
  for (let k = 0; k < 9; k += 1) trace += p[k] * q[k];
  return (Math.acos(Math.max(-1, Math.min(1, (trace - 1) / 2))) * 180) / Math.PI;
}

test('the helper bones of a pose whose joint rotations come slightly scaled are those of the rotations themselves', () => {
  const rig = new HelperRig(nodes);
  const pure = rig.extend(joints);
  const given = rig.extend(scaled);
  const worst = Math.max(...RIG_NODES.map((node) => between(pure[rigJoint(node)].r, given[rigJoint(node)].r)));
  assert.ok(worst < 0.01, `every helper as the pure rotations pose it (the furthest ${worst.toFixed(3)} degrees off)`);
});
