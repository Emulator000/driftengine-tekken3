/**
 * Kazuya's face as his mesh is bound, from the user's own Tekken 4 disc (`npm run t4`): his model
 * rests with the jaw a little open, its teeth showing, which Tekken 4 shuts with the face's own
 * animation; the bind pose shuts it. Skipped without his files.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseChrtk4 } from '../scripts/lib/t4/chrtk4.mjs';
import { bindPose } from '../scripts/lib/t4/kazuya.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, '.cache/t4/files/0658.bin');
const skip = !existsSync(file) && "no Tekken 4 files; run npm run t4 with the user's own Tekken 4 disc";
const HEAD = 4;
const JAW = 85;

/** His model: the container's fourth part. */
function model() {
  const container = new Uint8Array(readFileSync(file));
  const view = new DataView(container.buffer);
  const start = view.getUint32(4 + 3 * 8, true);
  return parseChrtk4(container.subarray(start, start + view.getUint32(8 + 3 * 8, true)));
}

test("his jaw is bound shut: the lower face turned up a few millimetres, the rest of his head as Tekken 4 rests it", { skip }, () => {
  const m = model();
  const posed = bindPose(m);
  const moved = { jaw: [], head: [] };
  m.lists.forEach((list, l) =>
    list.meshes.forEach((mesh, k) =>
      mesh.vertices.forEach((vertex, v) => {
        const nodes = vertex.influences.filter((i) => i.weight > 0).map((i) => i.node);
        const only = nodes.length === 1 ? nodes[0] : -1;
        if (only !== JAW && only !== HEAD) return;
        const at = posed[l][k][v].position;
        const distance = Math.hypot(at[0] - vertex.position[0], at[1] - vertex.position[1], at[2] - vertex.position[2]);
        (only === JAW ? moved.jaw : moved.head).push(distance);
      }),
    ),
  );
  assert.ok(moved.jaw.length > 50 && moved.head.length > 50, `the jaw's vertices (${moved.jaw.length}) and the head's (${moved.head.length})`);
  const most = Math.max(...moved.jaw);
  assert.ok(1 < most && most < 15, `the jaw turned up a few millimetres (its furthest vertex ${most.toFixed(1)})`);
  assert.ok(Math.max(...moved.head) < 0.01, `the rest of the head as it rests (${Math.max(...moved.head)} mm off)`);
});
