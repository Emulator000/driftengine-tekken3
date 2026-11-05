/**
 * Every extracted fighter, intro model and stage, from the user's own disc (and board): a triangle
 * whose corners lie within one texel of each other along an axis is drawn from that texel's centre,
 * the texel the console reads at every pixel of it, so a GPU reads the same one, sharp or filtered,
 * rather than the edge it shares with the texel before. Skipped without the extracted data.
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { hasRig, readFtr } from '../scripts/lib/ftr.mjs';

const data = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/data');
const skip = !existsSync(path.join(data, 'fighters')) && 'no extracted data; run npm run extract';

/** Each triangle's three texture coordinates, in texels. */
function fighterTriangles(file) {
  const bytes = new Uint8Array(readFileSync(file));
  if (hasRig(bytes)) return [];
  const mesh = readFtr(bytes);
  const out = [];
  for (let t = 0; t < mesh.indices.length; t += 3) out.push([0, 1, 2].map((k) => mesh.vertices[mesh.indices[t + k]].uv.map((x) => x / 8)));
  return out;
}

/** A stage mesh's triangles' texture coordinates, in texels: eighths of one from version 4. */
function stageTriangles(file) {
  const bytes = readFileSync(file);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const scale = view.getUint32(4, true) >= 4 ? 8 : 1;
  const count = view.getUint32(8, true);
  const indexCount = view.getUint32(12, true);
  const grid = view.getUint32(24, true);
  let at = 28 + grid * grid * 8;
  const uvs = [];
  for (let i = 0; i < count; i += 1) {
    uvs.push([view.getUint16(at + 10, true) / scale, view.getUint16(at + 12, true) / scale]);
    at += 20;
  }
  const out = [];
  for (let t = 0; t < indexCount; t += 3) out.push([0, 1, 2].map((k) => uvs[view.getUint32(at + (t + k) * 4, true)]));
  return out;
}

const files = (dir, ext) => (existsSync(path.join(data, dir)) ? readdirSync(path.join(data, dir)).filter((n) => n.endsWith(ext)).map((n) => path.join(data, dir, n)) : []);

test("no triangle drawn from one texel along an axis is drawn from that texel's edge", { skip }, () => {
  const meshes = [
    ...['fighters', 'intro', 'arcade/fighters'].flatMap((dir) => files(dir, '.ftr').map((file) => [file, fighterTriangles(file)])),
    ...['stages', 'arcade/stages'].flatMap((dir) => files(dir, '.stg').map((file) => [file, stageTriangles(file)])),
  ];
  assert.ok(meshes.length > 50, `the extracted meshes (${meshes.length})`);
  const onEdges = [];
  for (const [file, triangles] of meshes) {
    let edges = 0;
    for (const corners of triangles) {
      for (const axis of [0, 1]) {
        const along = corners.map((c) => c[axis]);
        if (Math.max(...along) - Math.min(...along) <= 1 && !along.every((x) => x === Math.floor(along[0]) + 0.5)) edges += 1;
      }
    }
    if (edges > 0) onEdges.push(`${path.relative(data, file)}: ${edges}`);
  }
  assert.deepEqual(onEdges, [], 'triangles drawn from a texel edge');
});
