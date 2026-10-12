/**
 * The progress kept between plays: what the game keeps is written to a store and read back whole,
 * a saved progress that is not the game's is not read (the game starts afresh), and the game saves
 * where it saves its progress, only when its records changed.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MemoryStore } from '@driftengine/core';
import { parseProgress, readProgress, writeProgress } from '../src/app/save.ts';
import { saveRecords } from '../src/sim/game/records.ts';
import { progressOf, restoreProgress } from '../src/sim/game/save.ts';
import { blankGameState } from '../src/sim/game/state.ts';

/** A game with progress of our own: characters and costumes earned, plays, endings, records, options. */
function played() {
  const game = blankGameState();
  const { records, options } = game;
  Object.assign(records, { earnedRoster: 0x1fffff, extraCostumes: 0x50382, extraDrawn: 1, newest: 20, demoTurn: 3, playsSince: 42, scheduleStep: 9, scheduleStarted: 1 });
  records.plays[0] = [12, 3, 4, 0];
  records.plays[22] = [1, 0, 0, 2];
  records.endings[0] = 0x3ff;
  records.endings[1] = 0x200;
  records.times[13] = { frames: 0x4321, initials: 'ABC' };
  records.survivors[0] = { roster: 9, wins: 31, initials: 'JIN' };
  Object.assign(options, { difficulty: 2, rounds: 2, roundTime: 3, keepChoices: 1 });
  options.lastChoices[0] = (9 << 2) | 1;
  options.keys[1][3] = 0x20;
  Object.assign(game.earned, { ball: 1, theater: 1 });
  Object.assign(game.attract, { intros: 2, intro: 1 });
  return game;
}

test('the progress is written to the store and read back into a fresh game whole', () => {
  const store = new MemoryStore();
  const game = played();
  writeProgress(progressOf(game), store);
  const read = readProgress(store);
  assert.ok(read !== null);
  const fresh = blankGameState();
  restoreProgress(fresh, read);
  assert.deepEqual(progressOf(fresh), progressOf(game));
  assert.equal(fresh.records.times[13].initials, 'ABC');
  assert.deepEqual(fresh.records.plays[22], [1, 0, 0, 2], 'an added character\'s plays kept too');
});

test('no progress kept, or one that is not the game\'s, starts the game afresh', () => {
  assert.equal(readProgress(new MemoryStore()), null);
  const store = new MemoryStore();
  store.write('tekken3.progress', '{ not json');
  assert.equal(readProgress(store), null);
  const saved = { format: 1, ...progressOf(played()) };
  const broken = (change) => {
    const copy = JSON.parse(JSON.stringify(saved));
    change(copy);
    return copy;
  };
  assert.throws(() => parseProgress(broken((p) => (p.format = 2))), /format/);
  assert.throws(() => parseProgress(broken((p) => p.records.times.pop())), /times/);
  assert.throws(() => parseProgress(broken((p) => (p.records.survivors[0].initials = 'TOOLONG'))), /initials/);
  assert.throws(() => parseProgress(broken((p) => (p.options.keys[0][0] = 0x100))), /keys/);
  assert.throws(() => parseProgress(broken((p) => (p.records.earnedRoster = -1))), /earnedRoster/);
});

test('the game saves only when its records changed since it last saved', () => {
  const game = blankGameState();
  saveRecords(game);
  assert.equal(game.saving, 0, 'nothing changed');
  game.records.changed = 1;
  saveRecords(game);
  assert.equal(game.saving, 1);
  assert.equal(game.records.changed, 0, 'saved, so unchanged since');
});
