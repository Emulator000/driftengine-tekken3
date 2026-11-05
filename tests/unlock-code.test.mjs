/**
 * The title's code for everything the game unlocks: five presses of 0 (or five taps) within three
 * seconds, any other key starting the count over; what it earns, and the sound it makes.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { isUnlockKey, UnlockCode, unlockByCode } from '../src/app/unlock-code.ts';
import { loadFightTables } from '../src/assets/load.ts';
import { Game } from '../src/sim/game/game.ts';

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
const imported = existsSync(path.join(assets, 'manifest.json'));
const skip = !imported && 'no imported data; run npm run extract and npm run import';
const json = async (name) => JSON.parse(readFileSync(path.join(assets, name), 'utf8'));

test('five presses within three seconds give the code, on the fifth, and the count starts over', () => {
  const code = new UnlockCode();
  assert.deepEqual([0, 500, 1000, 1500].map((at) => code.press(at)), [false, false, false, false]);
  assert.equal(code.press(2999), true);
  assert.equal(code.press(3100), false, 'a press after the code starts a new count');
});

test('presses spread over more than three seconds give nothing, until the last five fit', () => {
  const code = new UnlockCode();
  assert.deepEqual([0, 1000, 2000, 2500, 3001].map((at) => code.press(at)), [false, false, false, false, false]);
  assert.equal(code.press(3200), true, 'the five from 1000 to 3200 fit');
});

test('another key between the presses starts the count over', () => {
  const code = new UnlockCode();
  for (const at of [0, 100, 200, 300]) code.press(at);
  code.reset();
  assert.equal(code.press(400), false);
});

test('the code is the 0 key, on the row or the keypad, held alone and not repeating', () => {
  const key = (code, more = {}) => ({ code, repeat: false, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...more });
  assert.equal(isUnlockKey(key('Digit0')), true);
  assert.equal(isUnlockKey(key('Numpad0')), true);
  assert.equal(isUnlockKey(key('Digit1')), false);
  assert.equal(isUnlockKey(key('Digit0', { repeat: true })), false);
  assert.equal(isUnlockKey(key('Digit0', { ctrlKey: true })), false);
});

test("the code earns everything the game's last unlock does, and sounds a challenger's arrival", { skip }, async () => {
  const { tables, scenes } = await loadFightTables(json);
  const game = new Game({ tables, scenes, fightData: () => null, introData: () => assert.fail('no intro plays') });
  const state = game.state;
  unlockByCode(state, game.data);
  assert.equal(state.records.earnedRoster & 0x1fffff, 0x1fffff, 'every character');
  assert.equal(state.records.extraCostumes, 0x50382, 'the costumes');
  assert.deepEqual([state.earned.ball, state.earned.theater], [1, 1], 'Tekken Ball and the Theater');
  assert.ok(state.world.sound.commands.some((command) => command.key === 'on'), 'a sound');
});
