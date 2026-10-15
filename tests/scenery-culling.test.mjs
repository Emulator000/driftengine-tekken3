/**
 * The scenery's culling over a fight, on the data `npm run extract` and `npm run import` build: an
 * arcade stage's 16 × 16 cells are all drawn but those the board hides near the camera, never the
 * camera's own; and a cell the culling shows or hides fades in or out a tenth a field, except on a
 * cut.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadFightTables, loadMoveset } from '../src/assets/load.ts';
import { Fight } from '../src/sim/fight/fight.ts';
import { fightDataFor, matchMovesets } from '../src/sim/fight/match.ts';
import { fadeScenery, layScenery, newHeldScenery, newScenery, newSceneryFade } from '../src/present/3d/layout.ts';

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
const manifest = existsSync(path.join(assets, 'manifest.json')) ? JSON.parse(readFileSync(path.join(assets, 'manifest.json'), 'utf8')) : {};
const skip = !Array.isArray(manifest.movesets) && 'no imported data; run npm run extract and npm run import';
const json = async (name) => JSON.parse(readFileSync(path.join(assets, name), 'utf8'));
const two = (n) => String(n).padStart(2, '0');

/** An arcade grid: 16 cells a side, 3992 mm each. */
const GRID = { cellSize: 499, grid: 16 };
const CELL = GRID.cellSize * 8;
const turnOf = (a) => ((a + 0x800) & 0xfff) - 0x800;

test('an arcade stage draws all its cells but those near the camera, never its camera\'s cell, and its cells fade a tenth a field but on a cut', { skip }, async () => {
  const { tables, arena } = await loadFightTables(json);
  const setup = { stage: 0, entrants: [{ roster: 2, costume: 0, computer: true }, { roster: 6, costume: 0, computer: true }] };
  const [first, second] = matchMovesets(tables, setup);
  const movesets = new Map([[first, await loadMoveset(json, two(first))], [second, await loadMoveset(json, two(second))]]);
  const data = fightDataFor(tables, setup, (id) => movesets.get(id), await loadMoveset(json, 'common'));
  const fight = Fight.quick(data, setup);
  const state = fight.state;
  const held = newHeldScenery(3000, 0x155);
  const out = newScenery();
  const fade = newSceneryFade();
  let least = 256;
  let most = 0;
  let eased = 0;
  let before = fade.shown.slice();
  let last = null;
  for (let field = 0; field < 3000; field += 1) {
    fight.field([0, 0]);
    layScenery(state, data, arena, GRID, { widening: 16 / 9 / (4 / 3) }, out, held);
    fadeScenery(state, out, fade);
    const drawn = out.cells.filter((v) => 0 < v).length;
    least = Math.min(least, drawn);
    most = Math.max(most, drawn);
    /* The camera's cell, from the scenery's middle in its own turn. */
    const eye = state.camera.drawn.eye;
    const turn = (out.yaw * 2 * Math.PI) / 4096;
    const dx = eye[0] - out.x;
    const dz = eye[2] - out.z;
    const cx = Math.cos(turn) * dx + Math.sin(turn) * dz;
    const cz = -Math.sin(turn) * dx + Math.cos(turn) * dz;
    const column = Math.floor(cx / CELL) + 8;
    const row = Math.floor(cz / CELL) + 8;
    const inside = (v) => 1 <= v && v <= 14;
    if (inside(column) && inside(row) && Math.abs(cx - (column - 8 + 0.5) * CELL) < CELL / 2 - 50 && Math.abs(cz - (row - 8 + 0.5) * CELL) < CELL / 2 - 50) {
      assert.ok(!(0 < out.cells[row * 16 + column]), `field ${field}: the camera's cell ${row * 16 + column} is drawn`);
    }
    const now = [eye[0], eye[1], eye[2], state.camera.drawn.yaw, out.x, out.z, out.yaw];
    const cut =
      last === null ||
      Math.hypot(now[0] - last[0], now[1] - last[1], now[2] - last[2]) > 1500 ||
      Math.abs(turnOf(now[3] - last[3])) > 0x200 ||
      Math.hypot(now[4] - last[4], now[5] - last[5]) > 1500 ||
      Math.abs(turnOf(now[6] - last[6])) > 0x200;
    if (!cut) {
      fade.shown.forEach((v, i) => {
        assert.ok(Math.abs(v - before[i]) <= 0.1 + 1e-6, `field ${field}: cell ${i} went from ${before[i]} to ${v}`);
        if (0 < v && v < 1) eased += 1;
      });
    }
    before = fade.shown.slice();
    last = now;
  }
  assert.ok(least >= 256 - 32, `at least ${least} of the 256 cells are drawn`);
  assert.ok(most < 256, `at most ${most} of the 256 cells are drawn`);
  assert.ok(eased > 0, 'cells fade in and out');
});
