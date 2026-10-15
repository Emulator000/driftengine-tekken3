/**
 * The faces a fighter is drawn from: the mesh format that lists the triangles drawn from both faces,
 * the player drawing each face from its front (a face drawn from both twice), its rounding, the
 * normals turned the way the faces face, the board's stand-in left out, and, when `npm run extract`
 * has run, every fighter's mesh wound and lit from its front.
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { standIn } from '../scripts/lib/arcade/fighter.mjs';
import { facingNormals } from '../scripts/lib/facing.mjs';
import { hasRig, readFtr, writeFtr5 } from '../scripts/lib/ftr.mjs';
import { roundMesh } from '../scripts/lib/round.mjs';
import { bindNormal, bindPose, bindPosition } from '../scripts/lib/round/bind.mjs';
import { surfaceOf } from '../scripts/lib/round/surface.mjs';
import { cross, dot, sub } from '../scripts/lib/round/vec.mjs';
import { Fighter, readFighterMesh } from '../src/present/3d/fighter/fighter.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = [{ joint: 0, parent: -1, offset: [0, 0, 0] }];
const bufferOf = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const on = (point, normal = [0, 0, 4096], uv = [0, 0]) => ({ influences: [{ joint: 0, weight: 1, point }], normalJoint: 0, normal, uv });

/** Two triangles facing +z (counter-clockwise seen from +z), the second drawn from both faces; a hand moving its last vertex. */
function sheet() {
  const vertices = [on([0, 0, 0]), on([100, 0, 0]), on([0, 100, 0]), on([200, 0, 0], [0, 0, 4096], [8, 8]), on([200, 100, 0], [0, 0, 4096], [8, 16])];
  const shapes = [{ part: 12, steps: [0, 1], vertices: [4], shapes: [[{ points: [[200, 100, 0]], normal: [0, 0, 4096] }], [{ points: [[200, 120, 0]], normal: [0, 4096, 0] }]] }];
  return { width: 32, height: 32, vertices, indices: [0, 1, 2, 1, 3, 4], shapes, pictures: [], twoFaced: [1] };
}

test('a version 6 mesh lists the triangles drawn from both faces; one without the list is version 5', () => {
  const back = readFtr(writeFtr5(sheet()));
  assert.equal(back.version, 6);
  assert.deepEqual(back.twoFaced, [1]);
  assert.deepEqual(back.indices, sheet().indices);
  const old = readFtr(writeFtr5({ ...sheet(), twoFaced: null }));
  assert.equal(old.version, 5);
  assert.equal(old.twoFaced, null);
  assert.throws(() => writeFtr5({ ...sheet(), twoFaced: [2] }), /not one of the 2/);
});

test('the player draws a version 6 face from its front alone, one drawn from both twice: its back wound the other way, on vertices of its own, its normals turned round', () => {
  const mesh = readFighterMesh(bufferOf(writeFtr5(sheet())));
  assert.equal(mesh.oneSided, true);
  assert.equal(mesh.vertexCount, 8, 'the second triangle\'s three vertices copied');
  assert.deepEqual(Array.from(mesh.indices), [0, 1, 2, 1, 3, 4, 5, 7, 6]);
  assert.deepEqual(Array.from(mesh.normal.subarray(15, 24)), [0, 0, -4096, 0, 0, -4096, 0, 0, -4096]);
  assert.deepEqual(Array.from(mesh.points.subarray(6 * 12, 6 * 12 + 3)), [200, 0, 0], 'a back copies its front\'s points');
  assert.deepEqual(Array.from(mesh.uv.subarray(12, 14)), Array.from(mesh.uv.subarray(6, 8)));
  /* The hand moves the back's copy of its vertex too, its normal turned round. */
  const [group] = mesh.shapes;
  assert.deepEqual(Array.from(group.vertices), [4, 7]);
  assert.deepEqual(Array.from(group.points[1].subarray(12, 15)), [200, 120, 0]);
  assert.deepEqual(Array.from(group.normals[1]), [0, 4096, 0, 0, -4096, 0]);

  const renderer = { createMesh: () => 'mesh', createPointSkin: () => 'skin' };
  assert.equal(new Fighter(renderer, mesh, 'texture').material.doubleSided, false);
  const older = readFighterMesh(bufferOf(writeFtr5({ ...sheet(), twoFaced: null })));
  assert.equal(older.oneSided, false);
  assert.equal(older.vertexCount, 5);
  assert.equal(new Fighter(renderer, older, 'texture').material.doubleSided, true, 'an older mesh drawn from both faces');
});

test('a face drawn from both faces is rounded into triangles drawn from both, each wound as the face is', () => {
  const out = roundMesh({ ...sheet(), shapes: [] }, ROOT, 3);
  assert.equal(out.indices.length / 3, 18);
  assert.deepEqual(out.twoFaced, [9, 10, 11, 12, 13, 14, 15, 16, 17]);
  const at = out.vertices.map((v) => v.influences[0].point);
  for (let t = 0; t < 18; t += 1) {
    const [a, b, c] = out.indices.slice(t * 3, t * 3 + 3).map((i) => at[i]);
    assert.ok(cross(sub(b, a), sub(c, a))[2] > 0, `triangle ${t} faces +z`);
  }
  assert.equal(roundMesh({ ...sheet(), shapes: [], twoFaced: null }, ROOT, 3).twoFaced, null);
});

test('a face lying right under one drawn from both faces stays flat, and so does that one; one further under rounds', () => {
  /* A shell facing +z at z = 0, and under it a face at z = -5 (and, further, one at z = -60), each facing +z. */
  const shell = [on([-100, -100, 0]), on([200, -100, 0]), on([-100, 200, 0])];
  const near = [on([0, 0, -5]), on([50, 0, -5]), on([0, 50, -5])];
  const far = [on([0, 0, -60]), on([50, 0, -60]), on([0, 50, -60])];
  const vertices = [...shell, ...near, ...far];
  const indices = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const frames = bindPose(vertices, ROOT, indices);
  assert.deepEqual(surfaceOf(vertices, indices, frames).faces.map((f) => f.round), [true, true, true]);
  assert.deepEqual(surfaceOf(vertices, indices, frames, new Set([0])).faces.map((f) => f.round), [false, false, true]);
  /* Above the shell, or beside it, a face rounds. */
  const above = [...shell, on([0, 0, 5]), on([50, 0, 5]), on([0, 50, 5]), on([400, 0, -5]), on([450, 0, -5]), on([400, 50, -5])];
  assert.deepEqual(surfaceOf(above, indices, bindPose(above, ROOT, indices), new Set([0])).faces.map((f) => f.round), [true, true, true]);
});

test('a normal pointing against the faces its vertex is on is turned round, in its hand\'s shapes too', () => {
  const mesh = sheet();
  mesh.vertices[1] = on([100, 0, 0], [0, 0, -4096]);
  mesh.vertices[4] = on([200, 100, 0], [0, 0, -4096], [8, 16]);
  mesh.shapes[0].shapes[0][0].normal = [0, 0, -4096];
  const { mesh: facing, turned } = facingNormals(mesh, ROOT);
  assert.equal(turned, 2);
  assert.deepEqual(facing.vertices[1].normal, [0, 0, 4096]);
  assert.deepEqual(facing.vertices[0].normal, [0, 0, 4096], 'one facing its faces kept');
  assert.deepEqual(facing.shapes[0].shapes[0][0].normal, [0, 0, 4096]);
  assert.deepEqual(facing.shapes[0].shapes[1][0].normal, [0, -4096, 0]);
  assert.deepEqual(mesh.vertices[1].normal, [0, 0, -4096], 'the mesh given is left as it was');
});

/** A 4-bit TIM with its palette, `w` by `h` halfwords at (`x`, 0). */
function tim(x, w, h) {
  const bytes = new Uint8Array(8 + 44 + 12 + w * h * 2);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x10, true);
  view.setUint32(4, 8, true);
  view.setUint32(8, 44, true);
  view.setUint16(16, 16, true);
  view.setUint16(18, 1, true);
  view.setUint32(52, 12 + w * h * 2, true);
  view.setUint16(56, x, true);
  view.setUint16(60, w, true);
  view.setUint16(62, h, true);
  return bytes;
}
const chain = (...tims) => {
  const bytes = new Uint8Array(tims.reduce((n, t) => n + t.length, 0));
  let at = 0;
  for (const t of tims) {
    bytes.set(t, at);
    at += t.length;
  }
  return bytes;
};

test('the board\'s stand-in for a costume it has no model of, a texture chain of one image, is told from a fighter', () => {
  assert.equal(standIn({ textures: chain(tim(0, 8, 32)) }), true);
  assert.equal(standIn({ textures: chain(tim(0, 8, 32), tim(8, 16, 64)) }), false);
});

const data = path.join(root, 'public/data');
const extracted = existsSync(path.join(data, 'manifest.json')) && JSON.parse(readFileSync(path.join(data, 'manifest.json'), 'utf8')).format >= 19;

test('every fighter and intro model is wound counter-clockwise seen from its front, its normals facing its faces', { skip: !extracted && 'no extracted data; run npm run extract' }, () => {
  for (const kind of ['fighters', 'intro', 'arcade/fighters']) {
    const dir = path.join(data, kind);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.ftr'))) {
      const bytes = new Uint8Array(readFileSync(path.join(dir, name)));
      /* Kazuya's, on Tekken 4's rig, is checked on its own below. */
      if (hasRig(bytes)) continue;
      const mesh = readFtr(bytes);
      assert.equal(mesh.version, 6, `${kind}/${name}`);
      const { skeleton } = JSON.parse(readFileSync(path.join(dir, name.replace(/\.ftr$/, '.json')), 'utf8'));
      const frames = bindPose(mesh.vertices, skeleton, mesh.indices);
      const at = mesh.vertices.map((v) => bindPosition(v, frames));
      const normal = mesh.vertices.map((v) => bindNormal(v, frames));
      let along = 0;
      let all = 0;
      for (let t = 0; t + 2 < mesh.indices.length; t += 3) {
        const [a, b, c] = mesh.indices.slice(t, t + 3);
        const front = cross(sub(at[b], at[a]), sub(at[c], at[a]));
        const area = Math.hypot(...front);
        all += area;
        if (dot(front, normal[a]) + dot(front, normal[b]) + dot(front, normal[c]) > 0) along += area;
      }
      assert.ok(along > 0.95 * all, `${kind}/${name}: ${((100 * along) / all).toFixed(1)}% of its area lit from its front`);
    }
  }
});

const kazuyaMesh = path.join(data, 'fighters/52.ftr');

test("Kazuya's mesh, on Tekken 4's rig, is drawn from the front of each face, and from its back as a face of its own", { skip: !existsSync(kazuyaMesh) && "no Kazuya; run npm run t4 and npm run extract" }, () => {
  const bytes = new Uint8Array(readFileSync(kazuyaMesh));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(4, true), 6);
  assert.ok(hasRig(bytes));
  const triangles = view.getUint32(12, true) / 3;
  const mesh = readFighterMesh(bufferOf(bytes));
  assert.ok(mesh.oneSided);
  assert.notEqual(mesh.rig, null);
  assert.equal(mesh.indices.length, triangles * 6, 'every triangle drawn again from its back');
});
