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

test("an Arcade clear with a character the remake adds (Kazuya, 22) earns the next one as the game's own do, once, and is kept with the progress", { skip }, async () => {
  const { tables, scenes } = await loadFightTables(json);
  const game = new Game({ tables, scenes, fightData: () => null, introData: () => assert.fail('no intro plays') });
  const state = game.state;
  startMode(state, MenuMode.ARCADE, 1);
  const KAZUYA = 22;
  const before = state.records.earnedRoster;
  recordEnding(state, scenes, KAZUYA, 0);
  assert.equal(Math.log2((state.records.earnedRoster & ~before) >>> 0), ORDER[0], "his first clear earns the game's first");
  const once = state.records.earnedRoster;
  recordEnding(state, scenes, KAZUYA, 0);
  assert.equal(state.records.earnedRoster, once, 'a second clear with him earns nothing');
  recordEnding(state, scenes, 0, 0);
  assert.equal(Math.log2((state.records.earnedRoster & ~once) >>> 0), ORDER[1], "and a clear with one of the game's own the next");
  const { progressOf, restoreProgress } = await import('../src/sim/game/save.ts');
  const kept = progressOf(state);
  const fresh = new Game({ tables, scenes, fightData: () => null, introData: () => assert.fail('no intro plays') });
  restoreProgress(fresh.state, kept);
  startMode(fresh.state, MenuMode.ARCADE, 1);
  const earned = fresh.state.records.earnedRoster;
  recordEnding(fresh.state, scenes, KAZUYA, 0);
  assert.equal(fresh.state.records.earnedRoster, earned, 'his ending kept with the progress: not counted again');
});
