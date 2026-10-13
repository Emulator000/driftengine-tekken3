/**
 * Mokujin on the imported data: each round he plays the moveset of a character drawn at random
 * from those earned he may copy (the first fourteen and Gun Jack), both sides' moves bound again
 * for the round, and he fights with them.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadFightTables, loadMoveset } from '../src/assets/load.ts';
import { Fight } from '../src/sim/fight/fight.ts';
import { drawnMovesets, fightDataFor, matchMovesets, MOKUJIN, MOKUJIN_DRAWS } from '../src/sim/fight/match.ts';
import { startRoundOfMatch } from '../src/sim/fight/start.ts';

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
const imported = existsSync(path.join(assets, 'manifest.json'));
const skip = !imported && 'no imported data; run npm run extract and npm run import';
const json = async (name) => JSON.parse(readFileSync(path.join(assets, name), 'utf8'));
const two = (n) => String(n).padStart(2, '0');

test('Mokujin draws a moveset each round from those he may copy, and fights with it', { skip }, async () => {
  const { tables } = await loadFightTables(json);
  const setup = { stage: 2, entrants: [{ roster: MOKUJIN, costume: 0, computer: true }, { roster: 0, costume: 0, computer: true }], draws: MOKUJIN_DRAWS };
  const ids = new Set([...matchMovesets(tables, setup).filter((id) => 0 <= id), ...drawnMovesets(tables, MOKUJIN_DRAWS)]);
  const loaded = new Map();
  for (const id of ids) loaded.set(id, await loadMoveset(json, two(id)));
  const data = fightDataFor(tables, setup, (id) => loaded.get(id), await loadMoveset(json, 'common'));
  const fight = Fight.quick(data, setup);
  const [mokujin, paul] = fight.state.fighters;
  const allowed = new Set(drawnMovesets(tables, MOKUJIN_DRAWS));
  const drawn = new Set();
  for (let round = 0; round < 12; round += 1) {
    fight.state.round.number = round + 1;
    startRoundOfMatch(fight.state, data);
    assert.ok(allowed.has(mokujin.character), `round ${round} drew moveset ${mokujin.character}`);
    assert.equal(data.sets[0], loaded.get(mokujin.character), 'his moves bound to the drawn moveset');
    drawn.add(mokujin.character);
  }
  assert.ok(3 < drawn.size, `the draws vary: ${[...drawn].join(' ')}`);
  for (let field = 0; field < 600; field += 1) fight.field([0, 0]);
  assert.ok(0 < fight.state.fighters[0].health, 'the fight runs');
});
