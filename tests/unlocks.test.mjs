/**
 * The characters Arcade earns, on the imported data: each clear with a character not cleared with
 * before earns the next in the game's own order, and clearing again with the same one earns nothing.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadFightTables } from '../src/assets/load.ts';
import { Game } from '../src/sim/game/game.ts';
import { MenuMode, startMode } from '../src/sim/game/menu.ts';
import { recordEnding } from '../src/sim/game/records.ts';

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
const imported = existsSync(path.join(assets, 'manifest.json'));
const skip = !imported && 'no imported data; run npm run extract and npm run import';
const json = async (name) => JSON.parse(readFileSync(path.join(assets, name), 'utf8'));

/** Kuma, Julia, Gun Jack, Mokujin, Anna, Bryan, Heihachi, Ogre, True Ogre, by roster id. */
const ORDER = [11, 10, 16, 15, 18, 12, 13, 14, 20];

test('each Arcade clear with a new character earns the next one, in the game\'s order', { skip }, async () => {
  const { tables, scenes } = await loadFightTables(json);
  const game = new Game({ tables, scenes, fightData: () => null, introData: () => assert.fail('no intro plays') });
  const state = game.state;
  startMode(state, MenuMode.ARCADE, 1);
  const earned = [];
  for (let roster = 0; roster < ORDER.length; roster += 1) {
    const before = state.records.earnedRoster;
    recordEnding(state, scenes, roster, 0);
    const added = (state.records.earnedRoster & ~before) >>> 0;
    earned.push(Math.log2(added));
    const again = state.records.earnedRoster;
    recordEnding(state, scenes, roster, 0);
    assert.equal(state.records.earnedRoster, again, `a second clear with roster ${roster} earns nothing`);
  }
  assert.deepEqual(earned, ORDER);
});
