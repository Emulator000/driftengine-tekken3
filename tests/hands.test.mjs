/**
 * The hands' shapes and the face's pictures: the mesh format that carries them, the player drawing
 * them, their rounding, the simulation's step each hand is drawn at (and a replay's), and, when
 * `npm run extract` and `npm run import` have run, every fighter's.
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { KEEP_SHAPE, readFtr, writeFtr5 } from '../scripts/lib/ftr.mjs';
import { roundMesh } from '../scripts/lib/round.mjs';
import { Fighter, readFighterMesh } from '../src/present/3d/fighter/fighter.ts';
import { blankFightState } from '../src/sim/fight/blank.ts';
import { handPart, stepHands } from '../src/sim/fight/hands.ts';
import { ReplayState } from '../src/sim/fight/replay.ts';

const bufferOf = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const on = (point, uv = [0, 0], normal = [0, 0, 4096]) => ({ influences: [{ joint: 0, weight: 1, point }], normalJoint: 0, normal, uv });

/**
 * A small mesh: a seam vertex and a hand vertex in one triangle; a face triangle, as loaded, and its
 * twin with the closed eyes, each on vertices of its own.
 */
function sample() {
  const vertices = [
    { influences: [{ joint: 2, weight: 0.5, point: [10, 20, 30] }, { joint: 5, weight: 0.5, point: [-7, 8, 9] }], normalJoint: 2, normal: [4096, 0, 0], uv: [8, 16] },
    on([100, 0, 0], [24, 0]),
    on([0, 100, 0], [0, 24]),
    on([0, 0, 50], [40, 40]),
    on([10, 0, 50], [48, 40]),
    on([0, 10, 50], [40, 48]),
    on([0, 0, 50], [140, 40]),
    on([10, 0, 50], [148, 40]),
    on([0, 10, 50], [140, 48]),
  ];
  const shapes = [{ part: 12, steps: [0, 1, KEEP_SHAPE], vertices: [1], shapes: [[{ points: [[100, 0, 0]], normal: [0, 0, 4096] }], [{ points: [[60, 30, -20]], normal: [0, 4096, 0] }]] }];
  return { width: 32, height: 32, vertices, indices: [0, 1, 2, 3, 4, 5, 6, 7, 8], shapes, pictures: [[1], [2]] };
}

test('a version 5 mesh keeps a seam\'s halves exact, its hands\' shapes and its face\'s pictures', () => {
  const mesh = sample();
  const bytes = writeFtr5(mesh);
  const back = readFtr(bytes);
  assert.equal(back.version, 5);
  assert.deepEqual(back.vertices, mesh.vertices);
  assert.deepEqual(back.indices, mesh.indices);
  assert.deepEqual(back.shapes, mesh.shapes);
  assert.deepEqual(back.pictures, mesh.pictures);

  const player = readFighterMesh(bufferOf(bytes));
  assert.deepEqual(Array.from(player.weights.subarray(0, 2)), [0.5, 0.5], 'a seam\'s halves exact');
  assert.equal(player.weights[4], 1);
  assert.equal(player.shapes.length, 1);
  const [group] = player.shapes;
  assert.equal(group.part, 12);
  assert.deepEqual(Array.from(group.steps), [0, 1, KEEP_SHAPE]);
  assert.deepEqual(Array.from(group.vertices), [1]);
  assert.deepEqual(Array.from(group.points[1].subarray(0, 3)), [60, 30, -20]);
  assert.deepEqual(Array.from(group.normals[1]), [0, 4096, 0]);
  assert.equal(player.pictures, 2);
  assert.deepEqual(Array.from(player.pictureOf), [0, 0, 0, 1, 1, 1, 2, 2, 2]);
});

test('a picture on vertices another triangle shares, or of another length than the first, is refused', () => {
  const shared = sample();
  shared.indices = [0, 1, 3, 3, 4, 5, 6, 7, 8];
  assert.throws(() => writeFtr5(shared), /shares a vertex/);
  const short = sample();
  short.pictures = [[1, 0], [2]];
  assert.throws(() => writeFtr5(short), /triangles/);
});

/**
 * A renderer that poses a point skin as the engine does on the device (each weighted point moved by
 * its joint, a weight of 0 skipped) and keeps the positions of the last pose, and how many skins it made.
 */
function recorder() {
  const seen = { positions: null, skins: 0 };
  return {
    seen,
    renderer: {
      createMesh: () => 'mesh',
      createPointSkin: (_, data) => {
        seen.skins += 1;
        return { joints: Float32Array.from(data.joints), weights: Float32Array.from(data.weights), points: Float32Array.from(data.points) };
      },
      posePointSkin: (skin, m) => {
        const vertices = skin.weights.length / 4;
        seen.positions = [];
        for (let v = 0; v < vertices; v += 1) {
          const p = [0, 0, 0];
          for (let k = 0; k < 4; k += 1) {
            const w = skin.weights[v * 4 + k];
            if (w === 0) continue;
            const o = skin.joints[v * 4 + k] * 16;
            const [x, y, z] = skin.points.slice((v * 4 + k) * 3, (v * 4 + k) * 3 + 3);
            for (let c = 0; c < 3; c += 1) p[c] += w * (m[o + c] * x + m[o + 4 + c] * y + m[o + 8 + c] * z + m[o + 12 + c]);
          }
          seen.positions.push(...p);
        }
      },
      disposePointSkin() {},
      disposeMesh() {},
      disposeSurfaceTexture() {},
    },
  };
}

test('the player draws a hand in the shape its step gives, and only the picture on the face', () => {
  const { renderer, seen } = recorder();
  const fighter = new Fighter(renderer, readFighterMesh(bufferOf(writeFtr5(sample()))), 'texture');
  const at = (v) => seen.positions.slice(v * 3, v * 3 + 3).map((x) => Math.round(x * 1000) + 0);
  /* Game axes to the player's: millimetres to metres, y and z turned. */
  fighter.pose([]);
  assert.deepEqual(at(1), [100, 0, 0]);
  fighter.shape(16, 1);
  fighter.pose([]);
  assert.deepEqual(at(1), [100, 0, 0], 'another part\'s step moves nothing');
  fighter.shape(12, 1);
  fighter.pose([]);
  assert.deepEqual(at(1), [60, -30, 20]);
  fighter.shape(12, 2);
  fighter.shape(12, 40);
  fighter.pose([]);
  assert.deepEqual(at(1), [60, -30, 20], 'a step that keeps the shape, or past the table, keeps it');
  fighter.shape(12, 0);
  fighter.pose([]);
  assert.deepEqual(at(1), [100, 0, 0]);

  assert.deepEqual(at(3), [0, 0, -50]);
  assert.deepEqual([6, 7, 8].map(at), [[0, 0, 0], [0, 0, 0], [0, 0, 0]], 'the closed eyes collapsed while the face is as loaded');
  fighter.face(1);
  fighter.pose([]);
  assert.deepEqual([3, 4, 5].map(at), [[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
  assert.deepEqual(at(7), [10, 0, -50]);
  fighter.face(5);
  fighter.pose([]);
  assert.deepEqual(at(4), [10, 0, -50], 'a picture the face does not have shows it as loaded');
  const skins = seen.skins;
  fighter.face(0);
  fighter.shape(12, 0);
  fighter.pose([]);
  fighter.pose([]);
  assert.equal(seen.skins, skins, 'a hand and a face drawn as they are make no skin again');
});

/* An icosahedron of radius 100 on one joint, its normals pointing out. */
const ROOT = [{ joint: 0, parent: -1, offset: [0, 0, 0] }];
const POINTS = [[-53, 85, 0], [53, 85, 0], [-53, -85, 0], [53, -85, 0], [0, -53, 85], [0, 53, 85], [0, -53, -85], [0, 53, -85], [85, 0, -53], [85, 0, 53], [-85, 0, -53], [-85, 0, 53]];
const FACES = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
const outward = (p) => p.map((x) => Math.round((x / Math.hypot(...p)) * 4096));
const icosahedron = (moved = (p) => p) => ({ width: 64, height: 64, vertices: POINTS.map((p, i) => on(moved(p, i), [i * 8, i * 8], outward(moved(p, i)))), indices: FACES.flat() });

test('a hand\'s shape is rounded as the mesh in that shape is, on the same vertices and triangles', () => {
  const lift = (p, i) => (i === 0 ? p.map((x) => Math.round(x * 1.06)) : p);
  const mesh = icosahedron();
  const lifted = icosahedron(lift);
  mesh.shapes = [{ part: 16, steps: [0, 1], vertices: [0], shapes: [[{ points: [POINTS[0]], normal: mesh.vertices[0].normal }], [{ points: [lift(POINTS[0], 0)], normal: lifted.vertices[0].normal }]] }];
  const out = roundMesh(mesh, ROOT);
  const plain = roundMesh(icosahedron(), ROOT);
  const shaped = roundMesh(lifted, ROOT);
  assert.deepEqual(out.vertices, plain.vertices, 'as loaded, the mesh rounds as it did');
  assert.deepEqual(out.indices, plain.indices);
  const [group] = out.shapes;
  assert.equal(group.part, 16);
  assert.deepEqual(group.steps, [0, 1]);
  assert.ok(group.vertices.length > 0 && group.vertices.length < out.vertices.length);
  out.vertices.forEach((v, i) => {
    const k = group.vertices.indexOf(i);
    const form = k < 0 ? { points: v.influences.map((f) => f.point), normal: v.normal } : group.shapes[1][k];
    assert.deepEqual(form.points, shaped.vertices[i].influences.map((f) => f.point), `vertex ${i}'s points in the shape`);
    assert.deepEqual(form.normal, shaped.vertices[i].normal, `vertex ${i}'s normal in the shape`);
    if (k >= 0) assert.deepEqual(group.shapes[0][k], { points: v.influences.map((f) => f.point), normal: v.normal });
  });
  assert.doesNotThrow(() => writeFtr5(out));
});

test('a picture\'s face is rounded once and drawn twice, each on vertices of its own, the twin in its region', () => {
  /* Face 0 as loaded on copies of its corners, and its twin sampling ten texels to the right. */
  const mesh = icosahedron();
  const first = FACES[0].map((v) => mesh.vertices.push({ ...mesh.vertices[v] }) - 1);
  const twin = FACES[0].map((v) => mesh.vertices.push({ ...mesh.vertices[v], uv: [mesh.vertices[v].uv[0] + 80, mesh.vertices[v].uv[1]] }) - 1);
  mesh.indices.splice(0, 3, ...first);
  mesh.indices.push(...twin);
  mesh.pictures = [[0], [20]];
  const out = roundMesh(mesh, ROOT);
  const plain = roundMesh(icosahedron(), ROOT);
  assert.equal(out.indices.length, plain.indices.length + 27);
  assert.equal(out.pictures[0].length, 9);
  assert.equal(out.pictures[1].length, 9);
  assert.doesNotThrow(() => writeFtr5(out), 'each picture on vertices of its own');
  const corners = (t) => out.indices.slice(t * 3, t * 3 + 3).map((v) => out.vertices[v]);
  out.pictures[0].forEach((t, k) => {
    const [open, shut] = [corners(t), corners(out.pictures[1][k])];
    open.forEach((v, c) => {
      assert.deepEqual(shut[c].influences, v.influences);
      assert.deepEqual(shut[c].normal, v.normal);
      assert.deepEqual(shut[c].uv, [v.uv[0] + 80, v.uv[1]]);
    });
  });
  /* As loaded, the face rounds as it does without pictures. */
  const key = (v) => JSON.stringify(v);
  const rounded = new Set(plain.vertices.map(key));
  for (const v of out.vertices) if (!out.pictures[1].some((t) => out.indices.slice(t * 3, t * 3 + 3).some((i) => out.vertices[i] === v))) assert.ok(rounded.has(key(v)));
});

test('a hand is drawn at its model step, and a replay draws the steps it recorded', () => {
  const state = blankFightState();
  const f = state.fighters[0];
  const set = (shapes) => shapes.forEach((s, hand) => {
    f.hands.shape[hand] = s;
    f.hands.target[hand] = s;
  });
  set([0, 512]);
  stepHands(state, f);
  assert.deepEqual(f.hands.drawn, [0, 3]);
  set([300, 514]);
  state.replay.state = ReplayState.RECORDING;
  state.replay.recordFrame = 7;
  stepHands(state, f);
  assert.deepEqual(f.hands.drawn, [1, 5]);
  assert.deepEqual(state.replay.fighters[0].frames[7].hands, [1, 5]);
  set([512, 0]);
  state.replay.state = ReplayState.PLAYING;
  state.replay.playFrame = 15;
  stepHands(state, f);
  assert.deepEqual(f.hands.drawn, [1, 5], 'the recorded steps, not the live ones');
  assert.deepEqual(state.lastHandSteps.slice(0, 1), [0], 'the second hand\'s own step kept for its side');
  state.pause.paused = 1;
  set([0, 0]);
  state.replay.state = ReplayState.OFF;
  stepHands(state, f);
  assert.deepEqual(f.hands.drawn, [1, 5], 'paused, the hands stay as drawn');
});

test('the second hand is drawn on part 12, the first on 16, Kuma\'s and Gon\'s on 17', () => {
  assert.equal(handPart(0, 1), 12);
  assert.equal(handPart(0, 0), 16);
  assert.equal(handPart(0xb, 0), 17);
  assert.equal(handPart(0x11, 0), 17);
  assert.equal(handPart(0x11, 1), 12);
});

const data = 'public/data/fighters';
const assets = 'public/assets/models/fighters';
const versionOf = (file) => new DataView(readFileSync(file).buffer).getUint32(4, true);
const extracted = existsSync(path.join(data, '00.ftr')) && versionOf(path.join(data, '00.ftr')) === 5;

test('every fighter\'s hands carry their shapes, open to a fist, and a costume with closed eyes its pictures, rounded alike', { skip: !extracted && 'no extracted data; run npm run extract and npm run import' }, () => {
  let shaped = 0;
  let pictured = 0;
  for (const name of readdirSync(data).filter((n) => n.endsWith('.ftr'))) {
    if (versionOf(path.join(data, name)) !== 5) continue;
    const source = readFtr(new Uint8Array(readFileSync(path.join(data, name))));
    for (const group of source.shapes) {
      assert.ok([12, 16, 17, 19].includes(group.part), `${name}: a shape on part ${group.part}`);
      assert.deepEqual(group.steps.slice(0, 4), [0, 1, 2, 3], `${name}: open to a fist`);
      assert.ok(group.shapes.length >= 4 && group.vertices.length > 0);
      const fist = group.shapes[3];
      assert.ok(fist.some((form, k) => form.points.join() !== group.shapes[0][k].points.join()), `${name}: the fist moves the hand`);
      shaped += 1;
    }
    if (source.pictures.length > 0) {
      assert.equal(source.pictures.length, 2);
      assert.ok(source.pictures[0].length > 0 && source.pictures[0].length === source.pictures[1].length);
      pictured += 1;
    }
    if (!existsSync(path.join(assets, name))) continue;
    const rounded = readFtr(new Uint8Array(readFileSync(path.join(assets, name))));
    assert.deepEqual(rounded.shapes.map((g) => [g.part, g.steps, g.shapes.length]), source.shapes.map((g) => [g.part, g.steps, g.shapes.length]), name);
    assert.deepEqual(rounded.pictures.map((p) => p.length), source.pictures.map((p) => p.length * 9), name);
  }
  assert.ok(shaped >= 80, `${shaped} hands with shapes`);
  assert.ok(pictured > 20, `${pictured} faces with closed eyes`);
});
