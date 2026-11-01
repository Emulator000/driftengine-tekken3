/**
 * A move's dust on the imported data: the frame a move raises dust (a landing, a fall) raises it
 * and asks the pads for nothing, as the original does; the dust's own buzz comes from the dust
 * effect, at its move's first active frame. A match played as a release before 0.7.15 buzzes there
 * too, as those did, so both games ask the pads alike.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { releaseCode } from './lib/release.mjs';

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
const skip = !existsSync(path.join(assets, 'manifest.json')) && 'no imported data; run npm run extract and npm run import';
const json = async (name) => JSON.parse(readFileSync(path.join(assets, name), 'utf8'));
const DUST = 4;

/**
 * A fight on the code `load` gives (its modules by their paths) run a while, then its first fighter
 * put on the first of its moves with a dust event, at that frame, and the frame's events played
 * (`older`, as a match played as a release before 0.7.15 plays them): how much the dust's record
 * grew, and what the pads were asked.
 */
async function dustAt(load, older = false) {
  const { loadFightTables, loadMoveset } = await load('src/assets/load.ts');
  const { Fight } = await load('src/sim/fight/fight.ts');
  const { fightDataFor, matchMovesets } = await load('src/sim/fight/match.ts');
  const { moveEvents } = await load('src/sim/fight/move-events.ts');
  const { tables } = await loadFightTables(json);
  const setup = { stage: 2, entrants: [{ roster: 0, costume: 0, computer: false }, { roster: 1, costume: 0, computer: false }] };
  const movesets = new Map();
  for (const id of matchMovesets(tables, setup)) if (id >= 0) movesets.set(id, await loadMoveset(json, String(id).padStart(2, '0')));
  const data = fightDataFor(tables, setup, (id) => movesets.get(id), await loadMoveset(json, 'common'));
  const fight = Fight.quick(data, setup);
  for (let field = 0; field < 400; field += 1) fight.field([0, 0]);
  const moveset = data.sets[0].moveset;
  let found = null;
  moveset.moves.forEach((move, index) => {
    for (let k = move.events; found === null && 0 <= move.events && moveset.events[k].frame !== 0; k += 1) if (moveset.events[k].code === DUST) found = { index, frame: moveset.events[k].frame };
  });
  assert.ok(found !== null, 'a move that raises dust');
  const state = fight.state;
  const f = state.fighters[0];
  f.move = data.refs?.[0][found.index] ?? { set: 0, index: found.index };
  f.frame = found.frame;
  f.lastFrame = found.frame - 1;
  if (older) state.match.dustBuzz = 1;
  state.vibrations.length = 0;
  const recorded = state.replayEffects.frameEvents;
  moveEvents(state, data, f);
  return { raised: state.replayEffects.frameEvents - recorded, asked: [...state.vibrations] };
}

test("a move's dust is raised with nothing asked of the pads", { skip }, async () => {
  const { raised, asked } = await dustAt((file) => import(`../${file}`));
  assert.equal(raised, 1, 'the dust raised');
  assert.deepEqual(asked, [], 'nothing asked of the pads');
});

test("played as a release before 0.7.15, a move's dust asks the pads as that release does", { skip }, async (t) => {
  const older = releaseCode('0.7.14');
  if (older === null) return t.skip('no git, or no tag v0.7.14, to compare with');
  try {
    const then = await dustAt(older.load);
    const now = await dustAt((file) => import(`../${file}`), true);
    assert.ok(then.asked.length > 0, '0.7.14 buzzed the pad there');
    assert.deepEqual(now, then, 'the dust and the buzz alike');
  } finally {
    older.remove();
  }
});
