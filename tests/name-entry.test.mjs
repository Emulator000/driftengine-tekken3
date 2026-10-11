/**
 * The records' name entry on its own, and the best records that send a run to it, with tables made
 * up here: forty letters (A to Z, 0 to 9, back, end, a full stop, a space), a blank start, names
 * refused, a secret name.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { NameResult, NameStep, startNameEntry, stepNameEntry } from '../src/sim/game/name-entry.ts';
import { checkSurvivalRecord, checkTimeRecord, Naming, recordStageTime } from '../src/sim/game/records.ts';
import { blankGameState } from '../src/sim/game/state.ts';

const TABLES = { letters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<=. ', blank: '   ', refused: ['   ', 'AAA', 'XXX'], secret: 'GON', fresh: '   ' };
const SCENES = { records: { naming: TABLES } };
const RIGHT = 0x2000;
const LEFT = 0x8000;
const CROSS = 0x40;
const SQUARE = 0x80;
const CHARACTER = 'KUMA';

/** A fresh entry for pad 1's holder of roster 11. */
function entry() {
  const e = { name: '', place: 0, letter: 0, roster: 0, pad: 0, took: 0, moved: 0 };
  startNameEntry(e, TABLES, 1, 11);
  return e;
}

/** A frame from the pad: `pressed` the buttons newly pressed, `repeats` those repeating. */
const frame = (e, pressed = 0, repeats = 0) => stepNameEntry(e, TABLES, NameStep.PAD, pressed, repeats, CHARACTER);

/** The letter moved `count` times one way (a frame each), then taken. */
function take(e, count, way = RIGHT) {
  for (let k = 0; k < count; k += 1) frame(e, 0, way);
  return frame(e, CROSS);
}

test('the entry starts blank on its first place and the first letter, which shows at the cursor', () => {
  const e = entry();
  assert.deepEqual(e, { name: '   ', place: 0, letter: 0, roster: 11, pad: 1, took: 0, moved: 0 });
  assert.equal(frame(e), NameResult.OPEN);
  assert.equal(e.name, 'A  ');
});

test('left and right move the letter round the forty, past either end, and say they moved', () => {
  const e = entry();
  frame(e, 0, LEFT);
  assert.deepEqual([e.letter, e.name, e.moved], [39, '   ', 1]);
  frame(e, 0, RIGHT);
  assert.deepEqual([e.letter, e.name], [0, 'A  ']);
  frame(e);
  assert.equal(e.moved, 0, 'only on a frame it moves');
  frame(e, 0, LEFT | RIGHT);
  assert.equal(e.letter, 0, 'both ways at once cancel');
});

test('any of the four buttons takes the letter and the cursor moves on; the third ends the name', () => {
  const e = entry();
  assert.equal(take(e, 1), NameResult.OPEN);
  assert.deepEqual([e.name, e.place, e.took], ['B  ', 1, 1]);
  assert.equal(frame(e, SQUARE), NameResult.OPEN);
  assert.deepEqual([e.name, e.place], ['BB ', 2]);
  assert.equal(take(e, 25), NameResult.ENDED);
  assert.deepEqual([e.name, e.place], ['BB0', 3]);
});

test('back clears the cursor\'s place and steps back (not before the first); end fills the rest with spaces', () => {
  const e = entry();
  take(e, 0);
  take(e, 1);
  assert.deepEqual([e.name, e.place], ['AB ', 2]);
  assert.equal(take(e, 5, LEFT), NameResult.OPEN);
  assert.deepEqual([e.name, e.place], ['AB ', 1], 'back on the third place clears it and steps back');
  frame(e);
  assert.equal(e.name, 'A< ', 'the back mark shows where the cursor now is');
  take(e, 0);
  assert.deepEqual([e.name, e.place], ['A  ', 0]);
  take(e, 0);
  assert.deepEqual([e.name, e.place], ['<  ', 0], 'back on the first place does nothing more');
  assert.equal(take(e, 1), NameResult.ENDED);
  assert.deepEqual([e.name, e.place], ['KUM', 3], "ended blank: refused, the character's own");
});

test('a name ended early keeps its letters and blanks the rest', () => {
  const e = entry();
  take(e, 25);
  take(e, 13);
  assert.equal(e.name, 'Z. ');
  assert.equal(take(e, 1, LEFT), NameResult.ENDED);
  assert.deepEqual([e.name, e.place], ['Z. ', 3]);
});

test('a refused name becomes the character\'s first three letters', () => {
  const e = entry();
  take(e, 0);
  take(e, 0);
  assert.equal(take(e, 0), NameResult.ENDED);
  assert.equal(e.name, 'KUM');
});

test('the secret name is told apart as it ends', () => {
  const e = entry();
  take(e, 6);
  take(e, 8);
  assert.equal(take(e, 1, LEFT), NameResult.SECRET);
  assert.equal(e.name, 'GON');
});

test('out of time the name ends as it stands; cut short it is the character\'s', () => {
  const e = entry();
  take(e, 3);
  frame(e, 0, RIGHT);
  assert.equal(stepNameEntry(e, TABLES, NameStep.OUT_OF_TIME, CROSS, RIGHT, CHARACTER), NameResult.ENDED);
  assert.deepEqual([e.name, e.place, e.took, e.moved], ['D  ', 3, 0, 0], 'the letter at the cursor not taken, the pad not read');
  const cut = entry();
  take(cut, 3);
  assert.equal(stepNameEntry(cut, TABLES, NameStep.CUT_SHORT, 0, 0, CHARACTER), NameResult.ENDED);
  assert.deepEqual([cut.name, cut.place], ['KUM', 3]);
});

test("a Time Attack run's total beats the character's best when one side cleared every stage with one character", () => {
  const game = blankGameState();
  game.records.times.forEach((record) => Object.assign(record, { frames: 200000, initials: 'OLD' }));
  for (let stage = 0; stage < 10; stage += 1) recordStageTime(game, stage, 4, 0, 1, 19000);
  checkTimeRecord(game, SCENES);
  assert.equal(game.records.naming, Naming.TIME);
  assert.deepEqual(game.records.times[4], { frames: 190000, initials: '   ' });
  assert.deepEqual([game.records.timeSet, game.records.holder.side, game.records.holder.roster, game.records.list], [4, 1, 4, 0]);

  const slower = blankGameState();
  slower.records.times.forEach((record) => Object.assign(record, { frames: 100000, initials: 'OLD' }));
  for (let stage = 0; stage < 10; stage += 1) recordStageTime(slower, stage, 4, 0, 1, 19000);
  checkTimeRecord(slower, SCENES);
  assert.equal(slower.records.naming, 0, 'no record when slower');

  const mixed = blankGameState();
  mixed.records.times.forEach((record) => Object.assign(record, { frames: 200000, initials: 'OLD' }));
  for (let stage = 0; stage < 10; stage += 1) recordStageTime(mixed, stage, stage === 3 ? 5 : 4, 0, 1, 1000);
  checkTimeRecord(mixed, SCENES);
  assert.equal(mixed.records.naming, 0, 'no record with another character on a stage');
});

test('a survival record goes in after those with as many wins, the last falling off', () => {
  const game = blankGameState();
  [5, 5, 4, 4, 3, 3, 2, 2, 1, 1].forEach((wins, i) => Object.assign(game.records.survivors[i], { roster: i, wins, initials: `R${i}` }));
  assert.equal(checkSurvivalRecord(game, SCENES, 1, 11, 2), 1);
  assert.deepEqual(
    game.records.survivors.map((r) => `${r.roster}:${r.wins}:${r.initials}`),
    ['0:5:R0', '1:5:R1', '2:4:R2', '3:4:R3', '4:3:R4', '5:3:R5', '6:2:R6', '7:2:R7', '11:2:   ', '8:1:R8'],
  );
  assert.deepEqual([game.records.survivorSet, game.records.naming, game.records.holder.side, game.records.holder.roster, game.records.list], [8, Naming.SURVIVAL, 1, 11, 1]);
  const none = blankGameState();
  none.records.survivors.forEach((r) => Object.assign(r, { wins: 3 }));
  assert.equal(checkSurvivalRecord(none, SCENES, 0, 0, 3), 0, 'as many wins as the last is not a record');
  assert.equal(none.records.naming, 0);
});
