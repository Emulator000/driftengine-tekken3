/**
 * The progress kept between plays: what the game keeps is written to a store and read back whole,
 * a saved progress that is not the game's is not read (the game starts afresh), one saved before
 * the Options' own options were is read with auto save on, one saved before Tekken Force's
 * records were reads them as none, and the game saves on its own only with auto save on and its
 * records changed, keeping what it saved: where the console saves, and as soon as it moves on after
 * they change.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MemoryStore } from '@driftengine/core';
import { parseProgress, readProgress, SaveAsItGoes, writeProgress } from '../src/app/save.ts';
import { saveRecords } from '../src/sim/game/records.ts';
import { progressOf, restoreProgress } from '../src/sim/game/save.ts';
import { blankGameState } from '../src/sim/game/state.ts';

/** A game with progress of our own: characters and costumes earned, plays, endings, records, options. */
function played() {
  const game = blankGameState();
  const { records, options } = game;
  Object.assign(records, { earnedRoster: 0x1fffff, extraCostumes: 0x50382, extraDrawn: 1, newest: 20, demoTurn: 3, playsSince: 42, scheduleStep: 9, scheduleStarted: 1, forceBest: 1234560, forceKeys: 2 });
  records.plays[0] = [12, 3, 4, 0];
  records.plays[22] = [1, 0, 0, 2];
  records.endings[0] = 0x3ff;
  records.endings[1] = 0x200;
  records.times[13] = { frames: 0x4321, initials: 'ABC' };
  records.survivors[0] = { roster: 9, wins: 31, initials: 'JIN' };
  Object.assign(options, { difficulty: 2, rounds: 2, roundTime: 3, keepChoices: 1, musicSet: 2, stereo: 1, otherTitle: 1, autoSave: 1 });
  Object.assign(options.display, { x: -5, y: 7 });
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
  assert.equal(fresh.records.forceBest, 1234560);
  assert.equal(fresh.records.forceKeys, 2);
});

test("a progress saved before Tekken Force's records were reads no best score and no keys", () => {
  const before = JSON.parse(JSON.stringify({ format: 2, ...progressOf(played()) }));
  delete before.records.forceBest;
  delete before.records.forceKeys;
  const read = parseProgress(before);
  const game = blankGameState();
  Object.assign(game.records, { forceBest: 99, forceKeys: 3 });
  restoreProgress(game, read);
  assert.equal(game.records.forceBest, 0);
  assert.equal(game.records.forceKeys, 0);
  assert.throws(() => parseProgress({ ...before, records: { ...before.records, forceKeys: 0x100 } }), /forceKeys/);
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
  assert.throws(() => parseProgress(broken((p) => (p.format = 3))), /format/);
  assert.throws(() => parseProgress(broken((p) => p.records.times.pop())), /times/);
  assert.throws(() => parseProgress(broken((p) => (p.records.survivors[0].initials = 'TOOLONG'))), /initials/);
  assert.throws(() => parseProgress(broken((p) => (p.options.keys[0][0] = 0x100))), /keys/);
  assert.throws(() => parseProgress(broken((p) => (p.records.earnedRoster = -1))), /earnedRoster/);
});

test('a progress saved before the Options\' options were is read with auto save and vibration on, the rest as the game has them', () => {
  const first = JSON.parse(JSON.stringify({ format: 1, ...progressOf(played()) }));
  for (const key of ['musicSet', 'stereo', 'otherTitle', 'autoSave', 'display']) delete first.options[key];
  const store = new MemoryStore();
  store.write('tekken3.progress', JSON.stringify(first));
  const read = readProgress(store);
  assert.ok(read !== null);
  const game = blankGameState();
  Object.assign(game.options, { stereo: 1, musicSet: 0 });
  restoreProgress(game, read);
  assert.equal(game.options.autoSave, 1);
  assert.deepEqual(game.options.vibration, [1, 1], 'vibration on');
  assert.equal(game.options.stereo, 1);
  assert.equal(game.options.difficulty, 2);
  assert.deepEqual(game.options.display, { x: 0, y: 0 });
});

test('the game saves on its own only with auto save on and its records changed since it last saved, keeping what it saved', () => {
  const game = blankGameState();
  saveRecords(game);
  assert.equal(game.saving, 0, 'nothing changed');
  game.records.changed = 1;
  saveRecords(game);
  assert.equal(game.saving, 0, 'auto save off');
  assert.equal(game.records.changed, 0, 'its change let go');
  game.options.autoSave = 1;
  game.records.changed = 1;
  game.records.earnedRoster = 0x1ff;
  saveRecords(game);
  assert.equal(game.saving, 1);
  assert.equal(game.records.changed, 0, 'saved, so unchanged since');
  assert.equal(game.kept.records.earnedRoster, 0x1ff);
  game.records.earnedRoster = 0x3ff;
  assert.equal(game.kept.records.earnedRoster, 0x1ff, 'kept as it was saved');
});

test('with auto save on, records that change are saved as soon as the game moves on (a scene, or a step of one), not before', () => {
  const game = blankGameState();
  game.options.autoSave = 1;
  const asItGoes = new SaveAsItGoes();
  Object.assign(game, { scene: 7, step: 2 });
  asItGoes.field(game);
  assert.equal(game.saving, 0, 'nothing changed');
  game.records.changed = 1;
  game.records.plays[9][0] = 1;
  asItGoes.field(game);
  assert.equal(game.saving, 0, 'still on the same step');
  game.step = 3;
  asItGoes.field(game);
  assert.equal(game.saving, 1, 'the step after the change');
  assert.equal(game.records.changed, 0);
  assert.deepEqual(game.kept.records.plays[9], [1, 0, 0, 0]);
  game.saving = 0;
  game.scene = 8;
  asItGoes.field(game);
  assert.equal(game.saving, 0, 'nothing changed since');
  game.options.autoSave = 0;
  game.records.changed = 1;
  game.step = 4;
  asItGoes.field(game);
  assert.equal(game.saving, 0, 'auto save off');
});
