/**
 * Every extracted arcade stage, from the user's own board's data: no two of its triangles that
 * overlap in one plane are drawn in one layer, where a depth buffer would leave which shows to each
 * pixel's rounding. Skipped without the extracted data.
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/data/arcade/stages');
const skip = !existsSync(dir) && "no arcade stages extracted; run npm run extract with the board's data";
/** How near two planes are to be one (model units, and their normals' cosine); how far two triangles must overlap to lie over each other. */
const PLANE = { distance: 1.5, cosine: 0.999 };
const OVERLAP = 0.5;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** A stage mesh's triangles: their corners and the layer they are drawn in. */
function triangles(file) {
  const bytes = readFileSync(file);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(8, true);
  const indexCount = view.getUint32(12, true);
  const grid = view.getUint32(24, true);
  let at = 28 + grid * grid * 8;
  const vertices = [];
  for (let i = 0; i < count; i += 1) {
    vertices.push({ p: [0, 1, 2].map((k) => view.getInt16(at + k * 2, true)), layer: (view.getUint8(at + 9) >> 2) & 3 });
    at += 20;
  }
  const out = [];
  for (let t = 0; t < indexCount; t += 3) {
    const corners = [0, 1, 2].map((k) => vertices[view.getUint32(at + (t + k) * 4, true)]);
    const n = cross(sub(corners[1].p, corners[0].p), sub(corners[2].p, corners[0].p));
    const length = Math.hypot(...n);
    if (length === 0) continue;
    const normal = n.map((x) => x / length);
    const points = corners.map((c) => c.p);
    out.push({ points, normal, distance: dot(normal, points[0]), layer: corners[0].layer, bounds: [0, 1, 2].map((k) => [Math.min(...points.map((p) => p[k])), Math.max(...points.map((p) => p[k]))]) });
  }
  return out;
}

/** Whether two triangles in one plane overlap by more than `OVERLAP` along each of their edges' normals. */
function overlap(a, b) {
  const across = Math.abs(a.normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = cross(a.normal, across).map((x, _, all) => x / Math.hypot(...all));
  const v = cross(a.normal, u);
  const [fa, fb] = [a, b].map((t) => t.points.map((p) => [dot(p, u), dot(p, v)]));
  for (const shape of [fa, fb]) {
    for (let i = 0; i < 3; i += 1) {
      const [x0, y0] = shape[i];
      const [x1, y1] = shape[(i + 1) % 3];
      const axis = [y1 - y0, x0 - x1];
      const length = Math.hypot(...axis);
      const along = (points) => points.map(([x, y]) => (x * axis[0] + y * axis[1]) / length);
      const [pa, pb] = [along(fa), along(fb)];
      if (Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb)) <= OVERLAP) return false;
    }
  }
  return true;
}

test('on every arcade stage, no two triangles overlapping in one plane are drawn in one layer', { skip }, () => {
  const stages = readdirSync(dir).filter((n) => /^\d\d\.stg$/.test(n));
  assert.ok(stages.length >= 10, `the arcade stages (${stages.length})`);
  const alike = [];
  for (const name of stages) {
    const all = triangles(path.join(dir, name));
    let pairs = 0;
    all.forEach((a, i) => {
      for (let j = 0; j < i; j += 1) {
        const b = all[j];
        if (a.layer !== b.layer) continue;
        if (a.bounds.some(([lo, hi], k) => hi < b.bounds[k][0] - PLANE.distance || b.bounds[k][1] + PLANE.distance < lo)) continue;
        if (Math.abs(dot(a.normal, b.normal)) < PLANE.cosine || b.points.some((q) => Math.abs(dot(a.normal, q) - a.distance) > PLANE.distance)) continue;
        if (overlap(a, b)) pairs += 1;
      }
    });
    if (pairs > 0) alike.push(`${name}: ${pairs}`);
  }
  assert.deepEqual(alike, [], 'overlapping triangles in one layer');
});
