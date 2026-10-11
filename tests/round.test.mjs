/**
 * The fighters rounded: the mesh records, the bind pose, the welded surface, the curved patches and
 * the rounded mesh, on synthetic meshes and, when `npm run extract` has run, on every fighter.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readFighterMesh } from '../src/present/3d/fighter/fighter.ts';
import { readFtr, weightBytes, writeFtr3 } from '../scripts/lib/ftr.mjs';

/** A version 1 mesh: each vertex one point (`at` of one) or a seam of two, its normal a unit vector. */
function ftr1(vertices, triangles) {
  const bytes = new Uint8Array(24 + vertices.length * 28 + triangles.length * 6);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x31525446, true);
  view.setUint32(4, 1, true);
  view.setUint32(8, vertices.length, true);
  view.setUint32(12, triangles.length * 3, true);
  view.setUint16(16, 64, true);
  view.setUint16(18, 64, true);
  let at = 24;
  for (const v of vertices) {
    const [a, b = a] = v.at;
    view.setUint8(at, a.joint);
    view.setUint8(at + 1, b.joint);
    view.setUint8(at + 2, v.at.length === 2 ? 128 : 0);
    view.setUint8(at + 3, v.normalJoint ?? a.joint);
    a.point.forEach((x, c) => view.setInt16(at + 4 + c * 2, x, true));
    b.point.forEach((x, c) => view.setInt16(at + 10 + c * 2, x, true));
    v.normal.forEach((x, c) => view.setInt16(at + 16 + c * 2, Math.round(x * 4096), true));
    view.setUint16(at + 22, v.uv?.[0] ?? 0, true);
    view.setUint16(at + 24, v.uv?.[1] ?? 0, true);
    at += 28;
  }
  for (const t of triangles) for (const i of t) {
    view.setUint16(at, i, true);
    at += 2;
  }
  return bytes;
}

const bufferOf = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

test('weights become 255ths that sum to 255, the largest remainders rounded up', () => {
  assert.deepEqual(weightBytes([0.5, 0.5]), [128, 127]);
  assert.deepEqual(weightBytes([1]), [255]);
  assert.deepEqual(weightBytes([0.2, 0.3, 0.5]), [51, 77, 127]);
  for (const ws of [[0.1, 0.2, 0.3, 0.4], [0.33, 0.33, 0.34], [0.999, 0.001]]) assert.equal(weightBytes(ws).reduce((s, b) => s + b, 0), 255);
});

test('a version 1 mesh reads as records, and written as version 3 reads back the same in the player', () => {
  const v1 = ftr1(
    [
      { at: [{ joint: 2, point: [10, -20, 30] }], normal: [0, 0, 1], uv: [3, 4] },
      { at: [{ joint: 2, point: [11, 21, -31] }, { joint: 5, point: [-7, 8, 9] }], normal: [1, 0, 0], uv: [5, 6], normalJoint: 5 },
      { at: [{ joint: 5, point: [0, 0, 0] }], normal: [0, -1, 0], uv: [63, 0] },
    ],
    [[0, 1, 2]],
  );
  const mesh = readFtr(v1);
  assert.equal(mesh.version, 1);
  assert.deepEqual(mesh.vertices[1].influences, [{ joint: 2, weight: 0.5, point: [11, 21, -31] }, { joint: 5, weight: 0.5, point: [-7, 8, 9] }]);
  assert.deepEqual(mesh.vertices[0].uv, [24, 32], 'texture coordinates in eighths of a texel');
  assert.equal(mesh.vertices[1].normalJoint, 5);
  const before = readFighterMesh(bufferOf(v1));
  const after = readFighterMesh(bufferOf(writeFtr3(mesh)));
  assert.deepEqual(Array.from(after.influenceCount), Array.from(before.influenceCount));
  /* The slots each vertex uses (version 1 fills its second slot even where its weight is zero). */
  const used = (m, values, size) => Array.from({ length: m.vertexCount }, (_, i) => Array.from(values.subarray(i * 4 * size, (i * 4 + m.influenceCount[i]) * size)));
  assert.deepEqual(used(after, after.joints, 1), used(before, before.joints, 1));
  assert.deepEqual(used(after, after.points, 3), used(before, before.points, 3));
  assert.deepEqual(Array.from(after.normal), Array.from(before.normal));
  assert.deepEqual(Array.from(after.normalJoint), Array.from(before.normalJoint));
  assert.deepEqual(Array.from(after.uv), Array.from(before.uv));
  assert.deepEqual(Array.from(after.indices), Array.from(before.indices));
  for (let i = 0; i < after.weights.length; i += 1) assert.ok(Math.abs(after.weights[i] - before.weights[i]) <= 1 / 255 + 1e-9, `weight ${i}`);
  assert.deepEqual(readFtr(writeFtr3(mesh)).vertices[1].influences.map((f) => f.joint), [2, 5]);
});

test('a mesh past u16 indices or a point outside i16 is refused', () => {
  const vertex = { influences: [{ joint: 0, weight: 1, point: [0, 0, 0] }], normalJoint: 0, normal: [0, 4096, 0], uv: [0, 0] };
  assert.throws(() => writeFtr3({ width: 1, height: 1, vertices: Array.from({ length: 0x10000 }, () => vertex), indices: [] }), /do not fit u16/);
  assert.throws(() => writeFtr3({ width: 1, height: 1, vertices: [{ ...vertex, influences: [{ joint: 0, weight: 1, point: [40000, 0, 0] }] }], indices: [] }), /i16/);
});

import { bindPose, eulerRotation, fitRotation, seamGaps, symmetricEigen, trustedJoints } from '../scripts/lib/round/bind.mjs';
import { add, apply, applyT, cross, IDENTITY, normalize, place, sub } from '../scripts/lib/round/vec.mjs';

const close = (a, b, e, what) => a.forEach((x, i) => assert.ok(Math.abs(x - b[i]) <= e, `${what}: ${a} against ${b}`));
const HALF_TURN_Z = [-1, 0, 0, 0, -1, 0, 0, 0, 1];

test('a symmetric matrix is diagonalised by Jacobi rotations', () => {
  const m = [[4, 1, -2, 0.5], [1, 3, 0, 1], [-2, 0, 1, 2], [0.5, 1, 2, -1]];
  const { values, vectors } = symmetricEigen(m);
  for (let i = 0; i < 4; i += 1) {
    const v = vectors.map((row) => row[i]);
    const mv = m.map((row) => row.reduce((s, x, k) => s + x * v[k], 0));
    close(mv, v.map((x) => x * values[i]), 1e-9, `eigenpair ${i}`);
  }
});

test('the rotation between two point sets is found, a half turn too, and none for collinear points', () => {
  const a = [[10, 0, 0], [0, 20, 0], [0, 0, 30], [5, 5, -5]];
  close(fitRotation(a, a.map((p) => apply(HALF_TURN_Z, p))), HALF_TURN_Z, 1e-9, 'half turn');
  const r = eulerRotation(4000, -9000, 15000);
  close(fitRotation(a, a.map((p) => apply(r, p))), r, 1e-9, 'any turn');
  assert.equal(fitRotation([[0, 0, 0], [1, 0, 0], [2, 0, 0]], [[0, 0, 0], [0, 1, 0], [0, 2, 0]]), null);
});

/** Joint 1's points as a child turned by `r` and moved by `t` from the root: seams naming the same place in both. */
function twoJointSeams(r, t, places) {
  return places.map((p) => ({ influences: [{ joint: 0, weight: 0.5, point: p }, { joint: 1, weight: 0.5, point: applyT(r, sub(p, t)) }], normalJoint: 0, normal: [0, 4096, 0], uv: [0, 0] }));
}

test('each joint is placed where its seams meet those of the joints placed before it', () => {
  const t = [100, 20, 0];
  const vertices = twoJointSeams(HALF_TURN_Z, t, [[100, 0, 0], [100, 30, 10], [100, -30, 10], [100, 0, -40]]);
  const frames = bindPose(vertices, [{ joint: 0, parent: -1, offset: [0, 0, 0] }, { joint: 1, parent: 0, offset: [50, 0, 0] }]);
  close(frames[1].r, HALF_TURN_Z, 1e-9, 'rotation');
  close(frames[1].t, t, 1e-9, 'translation');
  assert.equal(frames[1].placed, 'seams');
  assert.equal(frames[0].placed, 'hung', 'the root, with no seams to meet');
  for (const gap of seamGaps(vertices, frames)) assert.ok(gap < 1e-6, `seam gap ${gap}`);
});

test('a joint whose seams lie on one line is turned about the place its offset gives it, so they meet', () => {
  /* A foot on a shin: two places joined, the foot a quarter turn about z at the shin's end. */
  const r = eulerRotation(0, 0, -16384);
  const t = [431, 0, 0];
  const vertices = twoJointSeams(r, t, [[523, -30, 67], [522, -23, -43], [523, -30, 67], [522, -23, -43]]);
  const frames = bindPose(vertices, [{ joint: 0, parent: -1, offset: [0, 0, 0] }, { joint: 1, parent: 0, offset: t }]);
  close(frames[1].t, t, 1e-9, 'the offset');
  close(frames[1].r, r, 1e-6, 'the turn');
  assert.equal(frames[1].placed, 'origin');
  for (const gap of seamGaps(vertices, frames)) assert.ok(gap < 1e-6, `seam gap ${gap}`);
});

test('a joint whose seams and origin do not fix a rotation hangs from its parent by its offset and rest rotation', () => {
  const vertices = twoJointSeams(HALF_TURN_Z, [100, 0, 0], [[100, 0, 0], [110, 0, 0], [120, 0, 0]]);
  const frames = bindPose(vertices, [{ joint: 0, parent: -1, offset: [0, 0, 0] }, { joint: 1, parent: 0, offset: [50, 0, 0], rest: [0, 0, 16384] }]);
  close(frames[1].t, [50, 0, 0], 1e-9, 'offset');
  close(frames[1].r, eulerRotation(0, 0, 16384), 1e-9, 'rest rotation');
  assert.equal(frames[1].placed, 'failed', 'it had seams, and they did not place it');
  close(place(frames[1], [10, 0, 0]), [50, 10, 0], 1e-9, 'a quarter turn about z');
});

test('a joint joined at one seam place is spun so the faces joining it lie closest to its neighbour', () => {
  /* The child is a quarter turn about x from its offset pose; one seam on its x axis cannot say so, its faces can. */
  const r = eulerRotation(16384, 0, 0);
  const t = [100, 0, 0];
  const child = (p) => applyT(r, sub(p, t)).map(Math.round);
  const root = (point) => ({ influences: [{ joint: 0, weight: 1, point }], normalJoint: 0, normal: [0, 4096, 0], uv: [0, 0] });
  const onChild = (world) => ({ influences: [{ joint: 1, weight: 1, point: child(world) }], normalJoint: 1, normal: [0, 4096, 0], uv: [0, 0] });
  const vertices = [
    { influences: [{ joint: 0, weight: 0.5, point: [150, 0, 0] }, { joint: 1, weight: 0.5, point: child([150, 0, 0]) }], normalJoint: 0, normal: [0, 4096, 0], uv: [0, 0] },
    root([150, 30, 0]), onChild([152, 30, 0]), root([150, 0, 30]), onChild([152, 0, 30]), root([150, -30, 5]), onChild([152, -30, 5]),
  ];
  const indices = [0, 1, 2, 0, 3, 4, 0, 5, 6];
  const frames = bindPose(vertices, [{ joint: 0, parent: -1, offset: [0, 0, 0] }, { joint: 1, parent: 0, offset: t }], indices);
  assert.equal(frames[1].placed, 'spin');
  close(frames[1].r, r, 1e-4, 'the quarter turn');
  close(frames[1].t, t, 1e-9, 'the offset');
  assert.ok(trustedJoints(frames).has(1));
});

test('a seam no pose closes does not pull its joint off the seams that meet', () => {
  const t = [100, 0, 0];
  const vertices = twoJointSeams(IDENTITY, t, [[100, 40, 0], [100, 0, 40], [100, -40, 0], [100, 0, -40]]);
  /* An armpit: one place on the root, another on the child 60 mm away whatever the pose. */
  vertices.push({ influences: [{ joint: 0, weight: 0.5, point: [100, 80, 0] }, { joint: 1, weight: 0.5, point: [60, 80, 0] }], normalJoint: 0, normal: [0, 4096, 0], uv: [0, 0] });
  const frames = bindPose(vertices, [{ joint: 0, parent: -1, offset: [0, 0, 0] }, { joint: 1, parent: 0, offset: [50, 0, 0] }]);
  const gaps = seamGaps(vertices, frames);
  for (const gap of gaps.slice(0, 4)) assert.ok(gap < 1e-6, `seam gap ${gap}`);
  assert.ok(Math.abs(gaps[4] - 60) < 1e-6, `the armpit's gap ${gaps[4]}`);
});

test('a joint is trusted unless its seams failed to place it, or it was placed against one that is not', () => {
  const vertices = twoJointSeams(HALF_TURN_Z, [100, 0, 0], [[100, 0, 0], [110, 0, 0], [120, 0, 0]]);
  const skeleton = [{ joint: 0, parent: -1, offset: [0, 0, 0] }, { joint: 1, parent: 0, offset: [50, 0, 0] }, { joint: 2, parent: 1, offset: [80, 0, 0] }, { joint: 3, parent: 0, offset: [0, 90, 0] }];
  assert.deepEqual([...trustedJoints(bindPose(vertices, skeleton))].sort(), [0, 3]);
  const good = twoJointSeams(HALF_TURN_Z, [100, 20, 0], [[100, 0, 0], [100, 30, 10], [100, -30, 10], [100, 0, -40]]);
  assert.deepEqual([...trustedJoints(bindPose(good, skeleton))].sort(), [0, 1, 2, 3]);
});

test('a vertex on a joint the skeleton lacks is refused', () => {
  const vertices = [{ influences: [{ joint: 7, weight: 1, point: [0, 0, 0] }], normalJoint: 7, normal: [0, 4096, 0], uv: [0, 0] }];
  assert.throws(() => bindPose(vertices, [{ joint: 0, parent: -1, offset: [0, 0, 0] }]), /joint 7/);
});

import { edgeKey, surfaceOf } from '../scripts/lib/round/surface.mjs';

const ROOT = [{ joint: 0, parent: -1, offset: [0, 0, 0] }];
const one = (point, normal, uv = [0, 0]) => ({ influences: [{ joint: 0, weight: 1, point }], normalJoint: 0, normal: normal.map((x) => Math.round(x * 4096)), uv });
const surfaceFor = (vertices, indices) => surfaceOf(vertices, indices, bindPose(vertices, ROOT));

test('corners with one skin and one facing are one point of the surface, whatever their texture coordinates', () => {
  const s = surfaceFor([one([0, 0, 0], [0, 0, 1], [0, 0]), one([0, 0, 0], [0, 0, 1], [8, 8]), one([0, 0, 0], [0, 0, -1]), one([9, 0, 0], [0, 0, 1])], [0, 3, 2]);
  assert.equal(s.pointOf[0], s.pointOf[1]);
  assert.notEqual(s.pointOf[0], s.pointOf[2], 'facing apart: the two sides of a sheet');
  assert.notEqual(s.pointOf[0], s.pointOf[3]);
});

test('a vertex without a normal joins its skin\'s point', () => {
  const s = surfaceFor([one([0, 0, 0], [0, 0, 1]), one([0, 0, 0], [0, 0, 0]), one([9, 0, 0], [0, 0, 1])], [0, 2, 1]);
  assert.equal(s.pointOf[0], s.pointOf[1]);
});

/**
 * Two triangles sharing the edge from (0,0,0) to (0,100,0), the second folded up from flat by
 * `degrees`: the shared edge's vertices facing between the two faces, the others as their own face.
 */
function hinge(degrees) {
  const a = (degrees * Math.PI) / 180;
  const fold = [Math.round(100 * Math.cos(a)), 0, Math.round(100 * Math.sin(a))];
  const flat = [0, 0, 1];
  const folded = normalize(cross(sub([0, 0, 0], [0, 100, 0]), sub(fold, [0, 100, 0])));
  const between = normalize(add(flat, folded));
  const vertices = [one([0, 0, 0], between), one([0, 100, 0], between), one([-100, 0, 0], flat), one(fold, folded)];
  return surfaceFor(vertices, [0, 1, 2, 1, 0, 3]);
}

test('an edge between faces bent up to 100° is smooth, more a crease, and a border always a crease', () => {
  const gentle = hinge(30);
  const sharp = hinge(120);
  assert.equal(hinge(90).smooth(edgeKey(hinge(90).pointOf[0], hinge(90).pointOf[1])), true, 'a low-poly limb\'s 90° bend');
  const key = (s) => edgeKey(s.pointOf[0], s.pointOf[1]);
  assert.equal(gentle.smooth(key(gentle)), true);
  assert.equal(sharp.smooth(key(sharp)), false);
  assert.equal(gentle.smooth(edgeKey(gentle.pointOf[1], gentle.pointOf[2])), false, 'a border');
});

test('corners joined across smooth edges share a normal; across a crease each face keeps its own', () => {
  const gentle = hinge(30);
  assert.equal(gentle.group(0, 0), gentle.group(1, 1), 'the shared corner at the origin');
  close(gentle.normal(0, 0), gentle.normal(1, 1), 1e-12, 'one normal');
  const sharp = hinge(120);
  assert.notEqual(sharp.group(0, 0), sharp.group(1, 1));
  close(sharp.normal(0, 0), [0, 0, 1], 1e-9, 'the flat face');
  close(sharp.normal(1, 1), [-Math.sin((2 * Math.PI) / 3), 0, Math.cos((2 * Math.PI) / 3)], 1e-2, 'the folded face');
});

/** A root joint and a child at [100, 0, 0], joined by a ring of four seams (`spread` scales the child's side of them). */
function twoParts(spread = 1) {
  const ring = [[100, 40, 0], [100, 0, 40], [100, -40, 0], [100, 0, -40]];
  const seam = (p) => ({ influences: [{ joint: 0, weight: 0.5, point: p }, { joint: 1, weight: 0.5, point: [0, p[1] * spread, p[2] * spread] }], normalJoint: 0, normal: [4096, 0, 0], uv: [0, 0] });
  return { skeleton: [{ joint: 0, parent: -1, offset: [0, 0, 0] }, { joint: 1, parent: 0, offset: [100, 0, 0] }], vertices: ring.map(seam) };
}
const on = (joint, point) => ({ influences: [{ joint, weight: 1, point }], normalJoint: joint, normal: [4096, 0, 0], uv: [0, 0] });

test('a face touching a seam no pose closes stays flat, and so does its edge to its neighbours', () => {
  const { skeleton, vertices } = twoParts();
  vertices.push({ influences: [{ joint: 0, weight: 0.5, point: [100, 80, 0] }, { joint: 1, weight: 0.5, point: [-40, 80, 0] }], normalJoint: 0, normal: [4096, 0, 0], uv: [0, 0] });
  vertices.push(on(0, [60, 30, 30]), on(0, [60, 60, 0]));
  const indices = [0, 1, 5, 0, 5, 6, 0, 6, 4];
  const s = surfaceOf(vertices, indices, bindPose(vertices, skeleton, indices));
  assert.deepEqual(s.faces.map((f) => f.round), [true, true, false]);
  assert.equal(s.smooth(edgeKey(s.pointOf[0], s.pointOf[6])), false, 'the edge between a round face and a flat one');
});

test('a face joining joints whose seams meet only loosely stays flat; one on a single joint rounds whatever its joint', () => {
  const { skeleton, vertices } = twoParts(1.08);
  vertices.push(on(0, [60, 30, 0]), on(1, [40, 30, 0]), on(1, [40, 0, 30]), on(1, [40, -30, 0]));
  const indices = [0, 4, 5, 5, 6, 0, 5, 6, 7];
  const s = surfaceOf(vertices, indices, bindPose(vertices, skeleton, indices));
  assert.deepEqual(s.faces.map((f) => f.round), [false, false, true]);
});

test('a face joining a joint that could not be placed stays flat, while joints placed apart from it still round', () => {
  const vertices = twoJointSeams(HALF_TURN_Z, [100, 0, 0], [[100, 0, 0], [110, 0, 0], [120, 0, 0]]);
  vertices.push(on(0, [0, 10, 0]), on(2, [0, 10, 0]), on(3, [0, 10, 0]), on(0, [0, 0, 10]));
  const skeleton = [{ joint: 0, parent: -1, offset: [0, 0, 0] }, { joint: 1, parent: 0, offset: [50, 0, 0] }, { joint: 2, parent: 1, offset: [80, 0, 0] }, { joint: 3, parent: 0, offset: [0, 90, 0] }];
  const indices = [3, 4, 6, 3, 5, 6];
  const s = surfaceOf(vertices, indices, bindPose(vertices, skeleton, indices));
  assert.deepEqual(s.faces.map((f) => f.round), [false, true]);
});

import { edgePoint, evaluate, patchOf } from '../scripts/lib/round/pn.mjs';

test('an edge bulges along its ends\' normals, and a straight one stays straight', () => {
  close(edgePoint([100, 0, 0], [0, 100, 0], [1, 0, 0], [0, 1, 0], false, 0.5).position, [62.5, 62.5, 0], 1e-9, 'an octahedron edge');
  close(edgePoint([100, 0, 0], [0, 100, 0], [1, 0, 0], [0, 1, 0], true, 0.25).position, [75, 25, 0], 1e-9, 'straight');
  close(edgePoint([0, 0, 0], [90, 0, 0], [0, 0, 1], [0, 0, 1], false, 0.4).position, [36, 0, 0], 1e-9, 'flat');
});

test('a patch along an edge is that edge\'s curve, and a patch of straight edges is its flat triangle', () => {
  const p = [[100, 0, 0], [0, 100, 0], [0, 0, 100]];
  const n = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const curved = patchOf(p, n, [false, true, false]);
  for (const t of [0.25, 0.5, 2 / 3]) {
    close(evaluate(curved, 1 - t, t, 0).position, edgePoint(p[0], p[1], n[0], n[1], false, t).position, 1e-9, `edge 0-1 at ${t}`);
    close(evaluate(curved, 0, 1 - t, t).position, edgePoint(p[1], p[2], n[1], n[2], true, t).position, 1e-9, `edge 1-2 at ${t}`);
    close(evaluate(curved, t, 0, 1 - t).position, edgePoint(p[2], p[0], n[2], n[0], false, t).position, 1e-9, `edge 2-0 at ${t}`);
  }
  const flat = patchOf(p, n, [true, true, true]);
  close(evaluate(flat, 1 / 3, 1 / 3, 1 / 3).position, [100 / 3, 100 / 3, 100 / 3], 1e-9, 'the flat centre');
  const round = patchOf(p, n, [false, false, false]);
  close(evaluate(round, 1 / 3, 1 / 3, 1 / 3).position, [400 / 9, 400 / 9, 400 / 9], 1e-9, 'the curved centre');
});

import { roundFighter, roundMesh } from '../scripts/lib/round.mjs';

/** A rounded mesh's vertices at the bind pose (one joint at rest: its points as they are), and its triangles. */
function rounded(bytes, skeleton = ROOT) {
  const mesh = readFtr(roundFighter(bytes, skeleton));
  const source = readFtr(bytes);
  const frames = bindPose(source.vertices, skeleton, source.indices);
  const at = mesh.vertices.map((v) => v.influences.reduce((s, f) => s.map((x, c) => x + place(frames[f.joint], f.point)[c] * f.weight), [0, 0, 0]));
  return { mesh, at, triangles: Array.from({ length: mesh.indices.length / 3 }, (_, t) => mesh.indices.slice(t * 3, t * 3 + 3)) };
}

/* An icosahedron of radius 100 (its faces meet at 41.8°, under the crease angle), normals pointing out. */
const ICOSAHEDRON_POINTS = [[-53, 85, 0], [53, 85, 0], [-53, -85, 0], [53, -85, 0], [0, -53, 85], [0, 53, 85], [0, -53, -85], [0, 53, -85], [85, 0, -53], [85, 0, 53], [-85, 0, -53], [-85, 0, 53]];
const ICOSAHEDRON = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
const icosahedron = () => ftr1(ICOSAHEDRON_POINTS.map((p, i) => ({ at: [{ joint: 0, point: p }], normal: p.map((x) => x / Math.hypot(...p)), uv: [i, i] })), ICOSAHEDRON);

test('a smooth closed mesh comes out rounder, never past its corners, closed, with nine times its triangles', () => {
  const { mesh, at, triangles } = rounded(icosahedron());
  assert.equal(triangles.length, ICOSAHEDRON.length * 9);
  for (const p of at) {
    const r = Math.hypot(...p);
    assert.ok(r >= 93 && r <= 101, `a point at ${r.toFixed(1)} from the centre (flat, the new points lie between 79.6 and 87.0; rounded, 94.2 to 100.2)`);
  }
  const edgeUses = new Map();
  for (const t of triangles) for (let s = 0; s < 3; s += 1) {
    const key = [at[t[s]], at[t[(s + 1) % 3]]].map((p) => p.map(Math.round).join(',')).sort().join('|');
    edgeUses.set(key, (edgeUses.get(key) ?? 0) + 1);
  }
  for (const [key, uses] of edgeUses) assert.equal(uses, 2, `edge ${key} bounds ${uses} triangles: a crack`);
  const originals = readFtr(icosahedron()).vertices;
  for (const o of originals) {
    const kept = mesh.vertices.find((v) => v.uv[0] === o.uv[0] && v.uv[1] === o.uv[1] && v.influences[0].point.join() === o.influences[0].point.join());
    assert.ok(kept, `corner ${o.influences[0].point} kept`);
    assert.deepEqual(kept.influences.map((f) => [f.joint, f.point]), o.influences.map((f) => [f.joint, f.point]));
  }
});

/** An open tube of `sides` flat sides (radius 100 to its corners, 200 long), its corners shared, facing out from its axis. */
function tube(sides) {
  const corners = Array.from({ length: sides }, (_, k) => (Math.PI / 2) + (2 * Math.PI * k) / sides).map((a) => [Math.cos(a), Math.sin(a)]);
  const vertices = [0, 200].flatMap((z) => corners.map(([x, y]) => ({ at: [{ joint: 0, point: [Math.round(100 * x), Math.round(100 * y), z] }], normal: [x, y, 0] })));
  const triangles = corners.flatMap((_, k) => {
    const [a, b] = [k, (k + 1) % sides];
    return [[a, b, sides + a], [b, sides + b, sides + a]];
  });
  return { corners, bytes: ftr1(vertices, triangles) };
}

test('a prism stays a prism: sides 120° apart are creases, its sides flat, its normals the sides\'', () => {
  const { corners, bytes } = tube(3);
  const sides = corners.map(([x, y], k) => normalize([x + corners[(k + 1) % 3][0], y + corners[(k + 1) % 3][1], 0]));
  const { mesh, at } = rounded(bytes);
  for (const p of at) assert.ok(Math.min(...sides.map((n) => Math.abs(p[0] * n[0] + p[1] * n[1] - 50))) <= 1, `a point at ${p} off the prism's sides`);
  for (const v of mesh.vertices) {
    const n = v.normal.map((x) => x / 4096);
    assert.ok(sides.some((side) => Math.abs(n[0] * side[0] + n[1] * side[1]) > 0.99), `a normal ${n} not a side's`);
  }
});

test('a square tube rounds across its 90° bends without bloating', () => {
  const { at } = rounded(tube(4).bytes);
  /* Its sides lie 70.7 from the axis, its corners 100 out; rounded, nothing goes inside the flat sides or past the corners' circle. */
  let most = 0;
  for (const p of at) {
    const r = Math.hypot(p[0], p[1]);
    const side = Math.max(Math.abs(p[0] + p[1]), Math.abs(p[0] - p[1])) / Math.SQRT2;
    assert.ok(side >= 70.7 - 1 && r <= 100 + 1, `a point at ${p}: ${side.toFixed(1)} from its side's line, ${r.toFixed(1)} from the axis`);
    most = Math.max(most, side);
  }
  assert.ok(most >= 75, `the sides bulge out (furthest ${most.toFixed(1)}, flat 70.7)`);
});

test('a thin block (a sandal) keeps its broad faces flat: its 90° folds onto narrow sides stay creases', () => {
  /* 200 by 100, 20 thick: its corners shared, facing out; every edge a 90° bend. */
  const corners = [];
  for (const x of [-100, 100]) for (const y of [-50, 50]) for (const z of [-10, 10]) corners.push({ at: [{ joint: 0, point: [x, y, z] }], normal: normalize([x, y, z]) });
  const id = (x, y, z) => (x > 0 ? 4 : 0) + (y > 0 ? 2 : 0) + (z > 0 ? 1 : 0);
  const quads = [
    [id(1, -1, -1), id(1, 1, -1), id(1, -1, 1), id(1, 1, 1)], [id(-1, -1, -1), id(-1, -1, 1), id(-1, 1, -1), id(-1, 1, 1)],
    [id(-1, 1, -1), id(-1, 1, 1), id(1, 1, -1), id(1, 1, 1)], [id(-1, -1, -1), id(1, -1, -1), id(-1, -1, 1), id(1, -1, 1)],
    [id(-1, -1, 1), id(1, -1, 1), id(-1, 1, 1), id(1, 1, 1)], [id(-1, -1, -1), id(-1, 1, -1), id(1, -1, -1), id(1, 1, -1)],
  ];
  const { at } = rounded(ftr1(corners, quads.flatMap((q) => [[q[0], q[1], q[2]], [q[1], q[3], q[2]]])));
  const swell = Math.max(...at.map((p) => Math.abs(p[2]) - 10));
  /* Rounded across its long folds, its broad faces swelled 22 mm (8 weighed by area), past half its thickness. */
  assert.ok(swell <= 1, `its broad faces swell ${swell.toFixed(1)} mm out of 20`);
});

test('the two sides of a thin sheet keep their own normals', () => {
  const p = [[0, 0, 0], [100, 0, 0], [0, 100, 0]];
  const sheet = ftr1([...p.map((q) => ({ at: [{ joint: 0, point: q }], normal: [0, 0, 1] })), ...p.map((q) => ({ at: [{ joint: 0, point: q }], normal: [0, 0, -1] }))], [[0, 1, 2], [3, 5, 4]]);
  const { mesh } = rounded(sheet);
  const z = mesh.vertices.map((v) => v.normal[2] / 4096);
  assert.ok(z.every((n) => Math.abs(n) > 0.99), `normals ${z}`);
  assert.ok(z.some((n) => n > 0) && z.some((n) => n < 0));
});

test('a limb across a seam bends on both its joints, its weights summing to one', () => {
  const skeleton = [{ joint: 0, parent: -1, offset: [0, 0, 0] }, { joint: 1, parent: 0, offset: [0, 0, 0] }];
  const ring = (x) => [[x, 40, 0], [x, 0, 40], [x, -40, 0], [x, 0, -40]];
  const child = (p) => applyT(HALF_TURN_Z, sub(p, [100, 0, 0]));
  const vertices = [
    ...ring(0).map((p) => ({ at: [{ joint: 0, point: p }], normal: [0, p[1] / 40, p[2] / 40] })),
    ...ring(100).map((p) => ({ at: [{ joint: 0, point: p }, { joint: 1, point: child(p) }], normal: [0, p[1] / 40, p[2] / 40] })),
    ...ring(200).map((p) => ({ at: [{ joint: 1, point: child(p) }], normal: apply(HALF_TURN_Z, [0, p[1] / 40, p[2] / 40]), normalJoint: 1 })),
  ];
  const triangles = [];
  for (const r of [0, 4]) for (let k = 0; k < 4; k += 1) {
    const [a, b, c, d] = [r + k, r + ((k + 1) % 4), r + 4 + k, r + 4 + ((k + 1) % 4)];
    triangles.push([a, b, c], [b, d, c]);
  }
  const { mesh } = rounded(ftr1(vertices, triangles), skeleton);
  let blended = 0;
  for (const v of mesh.vertices) {
    assert.ok(v.influences.length >= 1 && v.influences.length <= 4);
    assert.ok(Math.abs(v.influences.reduce((s, f) => s + f.weight, 0) - 1) <= 1 / 255 + 1e-9);
    if (v.influences.length === 2 && v.influences.every((f) => f.weight > 0.05 && f.weight < 0.95)) blended += 1;
  }
  assert.ok(blended > 0, 'some new vertex blends the two joints');
});

test('a degenerate triangle rounds to finite points', () => {
  const flat = ftr1([{ at: [{ joint: 0, point: [0, 0, 0] }], normal: [0, 0, 1] }, { at: [{ joint: 0, point: [0, 0, 0] }], normal: [0, 0, 1], uv: [1, 0] }, { at: [{ joint: 0, point: [50, 0, 0] }], normal: [0, 0, 0] }], [[0, 1, 2]]);
  const { at, mesh } = rounded(flat);
  assert.ok(at.flat().every(Number.isFinite));
  assert.ok(mesh.vertices.flatMap((v) => v.normal).every(Number.isFinite));
});

test('a mesh that would pass u16 indices once rounded is refused', () => {
  const vertices = [];
  const triangles = [];
  for (let k = 0; k < 7000; k += 1) {
    const base = vertices.length;
    const x = (k % 100) * 300;
    const y = Math.floor(k / 100) * 300 - 10000;
    for (const p of [[x - 10000, y, 0], [x - 9900, y, 0], [x - 10000, y + 100, 0]]) vertices.push({ at: [{ joint: 0, point: p }], normal: [0, 0, 1] });
    triangles.push([base, base + 1, base + 2]);
  }
  assert.throws(() => roundFighter(ftr1(vertices, triangles), ROOT), /do not fit u16/);
});

/** Where a vertex hangs for joints placed by `frames`. */
const posed = (v, frames) => v.influences.reduce((s, f) => s.map((x, c) => x + place(frames[f.joint], f.point)[c] * f.weight), [0, 0, 0]);

test('a new vertex follows its triangle exactly in any pose, wherever the bind pose put its joints', () => {
  /* One flat triangle across a seam that the bind pose leaves 80 mm open: a corner on each joint, one on both. */
  const skeleton = [{ joint: 0, parent: -1, offset: [0, 0, 0] }, { joint: 1, parent: 0, offset: [100, 0, 0] }];
  const vertices = [
    { at: [{ joint: 0, point: [0, 0, 0] }], normal: [0, 0, 1] },
    { at: [{ joint: 1, point: [100, 0, 0] }], normal: [0, 0, 1] },
    { at: [{ joint: 0, point: [60, 90, 0] }, { joint: 1, point: [-120, 90, 0] }], normal: [0, 0, 1] },
  ];
  const bytes = ftr1(vertices, [[0, 1, 2]]);
  const out = readFtr(roundFighter(bytes, skeleton));
  const pose = [{ r: IDENTITY, t: [0, 0, 0] }, { r: eulerRotation(0, 0, 10923), t: [140, 25, -30] }];
  const corners = readFtr(bytes).vertices.map((v) => posed(v, pose));
  const grid = [];
  for (let a = 0; a <= 3; a += 1) for (let b = 0; a + b <= 3; b += 1) grid.push([0, 1, 2].map((c) => corners[0][c] * (3 - a - b) / 3 + corners[1][c] * a / 3 + corners[2][c] * b / 3));
  assert.equal(out.vertices.length, grid.length);
  for (const v of out.vertices) {
    const p = posed(v, pose);
    const nearest = Math.min(...grid.map((g) => Math.hypot(...sub(p, g))));
    assert.ok(nearest <= 1.5, `a vertex ${nearest.toFixed(2)} mm off its triangle`);
  }
});

test('a face touching a seam no pose closes stays flat and keeps its corners\' normals', () => {
  const { skeleton, vertices } = twoParts();
  vertices.push({ influences: [{ joint: 0, weight: 0.5, point: [100, 80, 0] }, { joint: 1, weight: 0.5, point: [-40, 80, 0] }], normalJoint: 0, normal: [4096, 0, 0], uv: [0, 0] });
  vertices.push(on(0, [60, 60, 0]));
  const out = readFtr(writeFtr3(roundMesh({ width: 64, height: 64, vertices, indices: [0, 5, 4] }, skeleton)));
  assert.equal(out.vertices.length, 10);
  for (const v of out.vertices) assert.deepEqual(v.normal, [4096, 0, 0]);
});

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { median } from './lib/median.mjs';
import { roundModels } from '../scripts/import/models.mjs';

test('the import step rounds version 1 meshes and copies a mesh of another version as it is', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'tekken3-models-'));
  try {
    for (const kind of ['fighters', 'intro']) mkdirSync(path.join(root, 'public/data', kind), { recursive: true });
    writeFileSync(path.join(root, 'public/data/fighters/00.ftr'), icosahedron());
    writeFileSync(path.join(root, 'public/data/fighters/00.json'), JSON.stringify({ skeleton: ROOT }));
    const later = writeFtr3(readFtr(icosahedron()));
    writeFileSync(path.join(root, 'public/data/fighters/52.ftr'), later);
    writeFileSync(path.join(root, 'public/data/intro/0-00.ftr'), icosahedron());
    writeFileSync(path.join(root, 'public/data/intro/0-00.json'), JSON.stringify({ skeleton: ROOT }));
    const written = new Map();
    const count = roundModels(root, { bytes: (relative, data) => written.set(relative, data) });
    assert.equal(count, 2);
    assert.deepEqual([...written.keys()].sort(), ['models/fighters/00.ftr', 'models/fighters/52.ftr', 'models/intro/0-00.ftr']);
    assert.equal(readFtr(written.get('models/fighters/00.ftr')).indices.length, ICOSAHEDRON.length * 27);
    assert.deepEqual(Array.from(written.get('models/fighters/52.ftr')), Array.from(later));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const data = 'public/data';
const extracted = existsSync(path.join(data, 'fighters/00.ftr'));

test('every fighter and intro model rounds, within the limits, its seams meeting at the bind pose', { skip: !extracted && 'no extracted data; run npm run extract' }, () => {
  const means = [];
  for (const kind of ['fighters', 'intro']) {
    for (const name of readdirSync(path.join(data, kind)).filter((n) => n.endsWith('.ftr'))) {
      const bytes = new Uint8Array(readFileSync(path.join(data, kind, name)));
      if (![1, 5].includes(new DataView(bytes.buffer, bytes.byteOffset).getUint32(4, true))) continue;
      const source = readFtr(bytes);
      const { skeleton } = JSON.parse(readFileSync(path.join(data, kind, name.replace(/\.ftr$/, '.json')), 'utf8'));
      const out = readFighterMesh(bufferOf(roundFighter(bytes, skeleton)));
      assert.equal(out.indices.length, source.indices.length * 9, `${kind}/${name}`);
      assert.ok(out.vertexCount <= 0xffff, `${kind}/${name}`);
      const gaps = seamGaps(source.vertices, bindPose(source.vertices, skeleton, source.indices));
      if (gaps.length > 0) means.push(gaps.reduce((s, g) => s + g, 0) / gaps.length);
    }
  }
  assert.ok(means.length > 50, `${means.length} meshes with seams`);
  assert.ok(median(means) < 1, `median seam gap ${median(means)} mm`);
});
