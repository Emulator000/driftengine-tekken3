/**
 * The arcade board's fighters' own accessories in the fight, on the data `npm run extract` and
 * `npm run import` build from a board's dump: each on its own joint (up to 23), hung on its parent
 * and swinging on the board's spring as the fighter moves; the game's packs keep their four.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadFightTables, loadMoveset } from '../src/assets/load.ts';
import { parseArcadeFighters, withOwnAccessories } from '../src/assets/models.ts';
import { Fight } from '../src/sim/fight/fight.ts';
import { fightDataFor, matchMovesets } from '../src/sim/fight/match.ts';

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
const manifest = existsSync(path.join(assets, 'manifest.json')) ? JSON.parse(readFileSync(path.join(assets, 'manifest.json'), 'utf8')) : {};
const skip = !(manifest.arcadeFighters?.includes(12)) && 'no arcade fighters imported; run npm run arcade, npm run extract and npm run import';
const json = async (name) => JSON.parse(readFileSync(path.join(assets, name), 'utf8'));
const two = (n) => String(n).padStart(2, '0');
const HWOARANG = 6;
const LEI = 2;
/** Hwoarang's jacket's two tails on the board's model. */
const TAILS = [22, 23];

async function fight(arcade) {
  const loaded = await loadFightTables(json);
  const tables = arcade ? { ...loaded.tables, models: withOwnAccessories(loaded.tables.models, parseArcadeFighters(await json('tables/arcade-fighters.json'))) } : loaded.tables;
  const setup = { stage: 4, entrants: [{ roster: HWOARANG, costume: 0, computer: true }, { roster: LEI, costume: 0, computer: true }] };
  const [first, second] = matchMovesets(tables, setup);
  const movesets = new Map([[first, await loadMoveset(json, two(first))], [second, await loadMoveset(json, two(second))]]);
  return Fight.quick(fightDataFor(tables, setup, (id) => movesets.get(id), await loadMoveset(json, 'common')), setup);
}

test('the board\'s accessories hang on their own joints and swing on its springs as the fighter moves', { skip }, async () => {
  const quick = await fight(true);
  const hwoarang = quick.state.fighters[0];
  for (const joint of TAILS) assert.equal(hwoarang.parts[joint].hung, 1, `joint ${joint} hung`);
  const turns = new Map(TAILS.map((joint) => [joint, new Set()]));
  for (let field = 0; field < 900; field += 1) {
    quick.field([0, 0]);
    for (const joint of TAILS) {
      const world = hwoarang.skeleton.joints[joint].world;
      assert.ok(world.translation.every(Number.isFinite) && world.rotation.every(Number.isFinite), `joint ${joint} at field ${field}`);
      const parent = hwoarang.skeleton.joints[hwoarang.skeleton.joints[joint].parent].world.translation;
      assert.ok(Math.hypot(...world.translation.map((v, i) => v - parent[i])) < 400, `joint ${joint} stays by its parent`);
      turns.get(joint).add(hwoarang.skeleton.locals[joint].rotation.join());
    }
  }
  for (const joint of TAILS) assert.ok(turns.get(joint).size > 20, `joint ${joint} swung (${turns.get(joint).size} rotations)`);
});

test('the game\'s own model keeps its accessories to the four joints its tables give', { skip }, async () => {
  const quick = await fight(false);
  quick.field([0, 0]);
  for (const joint of TAILS) assert.equal(quick.state.fighters[0].parts[joint].hung, 0);
});
