/**
 * The scenery at a round's start, on the data `npm run extract` and `npm run import` build: the
 * game starts every round with it unturned, as a match's first; and the scenery held still on the
 * floor stands where the game puts it before each round starts and as it starts, round after round
 * and match after match, and while the round is fought within its hold of the game's place.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadFightTables, loadMoveset } from '../src/assets/load.ts';
import { Fight } from '../src/sim/fight/fight.ts';
import { fightDataFor, matchMovesets } from '../src/sim/fight/match.ts';
import { layScenery, newHeldScenery, newScenery } from '../src/present/3d/layout.ts';

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
const manifest = existsSync(path.join(assets, 'manifest.json')) ? JSON.parse(readFileSync(path.join(assets, 'manifest.json'), 'utf8')) : {};
const skip = !Array.isArray(manifest.movesets) && 'no imported data; run npm run extract and npm run import';
const json = async (name) => JSON.parse(readFileSync(path.join(assets, name), 'utf8'));
const two = (n) => String(n).padStart(2, '0');

const RADIUS = 3000;
const SLACK = 0x155;
/** An arcade grid: 16 cells a side. */
const GRID = { cellSize: 1187, grid: 16 };

test('before and as each round starts the held scenery stands where the game puts it, round after round and match after match', { skip }, async () => {
  const { tables, arena } = await loadFightTables(json);
  const setup = { stage: 8, entrants: [{ roster: 2, costume: 0, computer: true }, { roster: 6, costume: 0, computer: true }] };
  const [first, second] = matchMovesets(tables, setup);
  const movesets = new Map([[first, await loadMoveset(json, two(first))], [second, await loadMoveset(json, two(second))]]);
  const data = fightDataFor(tables, setup, (id) => movesets.get(id), await loadMoveset(json, 'common'));
  const fight = Fight.quick(data, setup);
  const state = fight.state;
  const held = newHeldScenery(RADIUS, SLACK);
  const out = newScenery();
  const game = newScenery();
  let starts = 0;
  let flow = -1;
  for (let field = 0; field < 14000; field += 1) {
    fight.field([0, 0]);
    layScenery(state, data, arena, GRID, { widening: 1 }, out, held);
    layScenery(state, data, arena, GRID, { widening: 1 }, game);
    const off = Math.hypot(out.x - game.x, out.z - game.z);
    if (state.round.flow === 0) assert.deepEqual([out.x, out.z, out.yaw], [game.x, game.z, game.yaw], `field ${field}, before round ${state.round.number} starts`);
    else if (flow === 0) {
      starts += 1;
      assert.deepEqual([out.x, out.z, out.yaw], [game.x, game.z, game.yaw], `field ${field}, as round ${state.round.number} starts`);
    } else assert.ok(off <= RADIUS + 1, `field ${field}: ${off} mm from the game's place`);
    flow = state.round.flow;
  }
  assert.ok(starts >= 4, `rounds started: ${starts}`);
});

test('every round starts with the scenery unturned, as the match\'s first does', { skip }, async () => {
  const { tables } = await loadFightTables(json);
  const setup = { stage: 4, entrants: [{ roster: 9, costume: 0, computer: true }, { roster: 6, costume: 0, computer: true }] };
  const [first, second] = matchMovesets(tables, setup);
  const movesets = new Map([[first, await loadMoveset(json, two(first))], [second, await loadMoveset(json, two(second))]]);
  const data = fightDataFor(tables, setup, (id) => movesets.get(id), await loadMoveset(json, 'common'));
  const fight = Fight.quick(data, setup);
  const state = fight.state;
  let rounds = 0;
  let turned = 0;
  let round = -1;
  for (let field = 0; field < 9000; field += 1) {
    fight.field([0, 0]);
    if (state.round.flow !== 0) {
      if (state.scenery.yaw !== 0) turned += 1;
      continue;
    }
    if (state.round.number === round) continue;
    round = state.round.number;
    rounds += 1;
    assert.equal(state.scenery.yaw, 0, `round ${round} starts unturned`);
  }
  assert.ok(rounds >= 3, `rounds started: ${rounds}`);
  assert.ok(turned > 0, 'the scenery turned while the rounds were fought');
});
