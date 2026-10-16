/**
 * An arcade stage's floor, on the data `npm run extract` and `npm run import` build: its patch is laid
 * round where the scenery stands, as far as the board's floor reaches (ten 2.5 m tiles across, two
 * rings of the fight's 1.8 m tiles past its ten), where the disc's is ten tiles round the fighters.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadFightTables, loadMoveset } from '../src/assets/load.ts';
import { Fight } from '../src/sim/fight/fight.ts';
import { fightDataFor, matchMovesets } from '../src/sim/fight/match.ts';
import { layGround, newGround } from '../src/present/3d/layout.ts';

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
const manifest = existsSync(path.join(assets, 'manifest.json')) ? JSON.parse(readFileSync(path.join(assets, 'manifest.json'), 'utf8')) : {};
const skip = !Array.isArray(manifest.movesets) && 'no imported data; run npm run extract and npm run import';
const json = async (name) => JSON.parse(readFileSync(path.join(assets, name), 'utf8'));
const two = (n) => String(n).padStart(2, '0');

/** The patch's middle and its reach each way from it (mm), from its quads' corners. */
function extent(out) {
  let [x0, x1, z0, z1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (let v = 0; v < out.count * 4; v += 1) {
    x0 = Math.min(x0, out.x[v]);
    x1 = Math.max(x1, out.x[v]);
    z0 = Math.min(z0, out.z[v]);
    z1 = Math.max(z1, out.z[v]);
  }
  return { x: (x0 + x1) / 2, z: (z0 + z1) / 2, half: (x1 - x0) / 2 };
}

test('an arcade stage lays its floor round its scenery, as far as the board\'s; the disc\'s round the fighters', { skip }, async () => {
  const { tables, arena } = await loadFightTables(json);
  const setup = { stage: 4, entrants: [{ roster: 2, costume: 0, computer: true }, { roster: 6, costume: 0, computer: true }] };
  const [first, second] = matchMovesets(tables, setup);
  const movesets = new Map([[first, await loadMoveset(json, two(first))], [second, await loadMoveset(json, two(second))]]);
  const data = fightDataFor(tables, setup, (id) => movesets.get(id), await loadMoveset(json, 'common'));
  const fight = Fight.quick(data, setup);
  for (let field = 0; field < 400; field += 1) fight.field([0, 0]);
  const state = fight.state;
  const stage = arena.stages[setup.stage];
  const around = { x: 2500, z: -1800 };
  const arcade = newGround();
  layGround(state, data, arena, stage, { widening: 1 }, arcade, true, around);
  assert.equal(arcade.count, 14 * 14, 'ten tiles and two rings each way');
  const laid = extent(arcade);
  assert.ok(Math.abs(laid.x - around.x) <= 900 && Math.abs(laid.z - around.z) <= 900, `round the scenery: ${laid.x}, ${laid.z}`);
  assert.equal(laid.half, 7 * 1800, 'as far as the board\'s floor');
  const disc = newGround();
  layGround(state, data, arena, stage, { widening: 1 }, disc);
  assert.equal(disc.count, 100, 'the game\'s ten by ten');
  const [a, b] = state.fighters;
  const mid = { x: (a.skeleton.base.translation[0] + b.skeleton.base.translation[0]) / 2, z: (a.skeleton.base.translation[2] + b.skeleton.base.translation[2]) / 2 };
  const own = extent(disc);
  assert.ok(Math.hypot(own.x - mid.x, own.z - mid.z) <= 1800 * 1.5, 'round the fighters');
});
