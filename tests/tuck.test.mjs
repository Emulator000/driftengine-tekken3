/**
 * The joins between the hips and a leg kept behind the hips' skin over them: each place on the hips
 * of a triangle joining them that the hips' skin (alone or blended with a leg, as a hem is) covers at
 * rest, facing its way, moved in toward the hips' axis, every point there; a join with nothing over
 * it, or only skin facing another way, left.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TUCK, tuckUnderSkirt } from '../scripts/lib/tuck.mjs';

/** The root, the hips on it, and a thigh 150 mm down and 100 mm across. */
const SKELETON = [
  { joint: 0, parent: -1, offset: [0, 0, 0] },
  { joint: 11, parent: 0, offset: [0, 0, 0] },
  { joint: 12, parent: 11, offset: [150, 0, 100] },
];
const THIGH = [150, 0, 100];
const on = (joint, point) => ({ influences: [{ joint, weight: 1, point }], normalJoint: joint, normal: [4096, 0, 0], uv: [0, 0] });
/** A point at `p` (the hips' frame at rest) weighing half on the hips and half on the thigh, as a skirt's hem does. */
const hem = (p) => ({ influences: [{ joint: 11, weight: 0.5, point: p }, { joint: 12, weight: 0.5, point: p.map((x, i) => x - THIGH[i]) }], normalJoint: 11, normal: [4096, 0, 0], uv: [0, 0] });
/** A point on the thigh at `p` (the hips' frame at rest). */
const thigh = (p) => on(12, p.map((x, i) => x - THIGH[i]));

function mesh() {
  const vertices = [
    /* A skirt's front, its hem blended with the thigh: a square facing -y at y = -150, 100 to 350 mm down. */
    on(11, [100, -150, -100]), hem([350, -150, -100]), hem([350, -150, 100]), on(11, [100, -150, 100]),
    /* A join under it, from the hips to the thigh, facing -y as the skirt does, and another point at its place on the hips. */
    on(11, [150, -100, -30]), thigh([250, -100, -30]), thigh([200, -100, 30]), on(11, [150, -100, -30]),
    /* A join with nothing over it, behind the hips, facing +y. */
    on(11, [150, 100, -30]), thigh([200, 100, 30]), thigh([250, 100, -30]),
  ];
  return { vertices, indices: [0, 1, 2, 0, 2, 3, 4, 5, 6, 7, 3, 0, 8, 9, 10], garment: 0 };
}

test("a join between the hips and a leg under a skirt of the hips' skin is moved in toward the hips' axis, every point at its place; one with nothing over it is left", () => {
  const m = mesh();
  const moved = tuckUnderSkirt(m, SKELETON);
  const point = (i) => m.vertices[i].influences[0].point;
  assert.equal(moved, 2, 'both points at the place');
  const out = Math.hypot(100, 30);
  assert.deepEqual(point(4), [150, Math.round((-100 * (out - TUCK)) / out), Math.round((-30 * (out - TUCK)) / out)]);
  assert.deepEqual(point(7), point(4));
  assert.deepEqual(point(8), [150, 100, -30], 'nothing over it: left');
  assert.deepEqual(point(0), [100, -150, -100], 'the skirt left');
  assert.deepEqual(point(5), [100, -100, -130], "the thigh's left");
});

test("a join whose only skin of the hips over it faces another way (the hips' far side) is left", () => {
  const m = mesh();
  /* The skirt turned to face +y, toward the join's back. */
  m.indices = [0, 2, 1, 0, 3, 2, 4, 5, 6, 7, 3, 0, 8, 9, 10];
  assert.equal(tuckUnderSkirt(m, SKELETON), 0);
});

test('a mesh whose joins have nothing over them is left as it is', () => {
  const m = mesh();
  const behind = { vertices: m.vertices.slice(8, 11), indices: [0, 1, 2], garment: 0 };
  assert.equal(tuckUnderSkirt(behind, SKELETON), 0);
  assert.deepEqual(behind.vertices[0].influences[0].point, [150, 100, -30]);
});
