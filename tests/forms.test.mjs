/**
 * A costume the disc has no model of that a board's form gives (Ogre's third, the disc's TRUE OGRE
 * entry, drawn with the board's model kept in his second costume's place): chosen with start where
 * this machine has the form; fought on its character's second costume's model facts, with its own
 * name, voice and song; and played as the second costume in a match against an older version.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadFightTables } from '../src/assets/load.ts';
import { playedFighter } from '../src/net/online.ts';
import { placeOnRoster } from '../src/sim/fight/match.ts';
import { thirdCostume } from '../src/sim/game/records.ts';
import { blankGameState } from '../src/sim/game/state.ts';

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
const imported = existsSync(path.join(assets, 'manifest.json'));
const skip = !imported && 'no imported data; run npm run extract and npm run import';
const json = async (name) => JSON.parse(readFileSync(path.join(assets, name), 'utf8'));
const OGRE = 14;
const JIN = 9;

test("a character's third costume is chosen where it is earned, or where a board's form gives it here", () => {
  const game = blankGameState();
  assert.equal(thirdCostume(game, OGRE), false);
  game.remake.forms = 1 << OGRE;
  assert.equal(thirdCostume(game, OGRE), true, "a board's form");
  assert.equal(thirdCostume(game, JIN), false);
  game.records.extraCostumes = 1 << JIN;
  assert.equal(thirdCostume(game, JIN), true, 'earned');
});

test("a costume the disc has no model of is fought on its character's second costume's model, with its own name, voice and song", { skip }, async () => {
  const { tables } = await loadFightTables(json);
  const f = {};
  placeOnRoster(tables, f, { roster: OGRE, costume: 2 });
  const second = {};
  placeOnRoster(tables, second, { roster: OGRE, costume: 1 });
  assert.equal(f.costume, second.costume, "his second costume's pack");
  assert.equal(f.rosterCode, OGRE * 4 + 2);
  assert.equal(tables.roster.codes[f.rosterCode].name, 'TRUE OGRE');
  assert.equal(f.character, second.character, 'his moves');
  assert.equal(f.sound, tables.roster.codes[20 * 4].sound, "True Ogre's voice");
});

test("Ogre's third costume is played as his second in a match played as a version before it, as itself from it on", () => {
  assert.deepEqual(playedFighter({ roster: OGRE, costume: 2 }, '0.7.8'), { roster: OGRE, costume: 1 });
  assert.deepEqual(playedFighter({ roster: OGRE, costume: 2 }, '0.6.5'), { roster: OGRE, costume: 1 });
  assert.deepEqual(playedFighter({ roster: OGRE, costume: 2 }, '0.7.12'), { roster: OGRE, costume: 2 });
  assert.deepEqual(playedFighter({ roster: JIN, costume: 2 }, '0.7.8'), { roster: JIN, costume: 2 }, "another's third costume as it is");
  assert.deepEqual(playedFighter({ roster: OGRE, costume: 1 }, '0.7.8'), { roster: OGRE, costume: 1 });
});
