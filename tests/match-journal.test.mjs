/**
 * An online match's fields as played, kept until final: each field's sound given out once it is
 * final, in order and once, the sound of a field a rollback played again as played again; and the
 * picture held while a knockout's first field is not final, let go once it is or once a rollback
 * takes the knockout back.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MatchJournal } from '../src/app/match-journal.ts';

/** A field's sound: a key-on of `program` (none for -1). */
const sound = (field, program = -1) => ({ sound: { commands: program < 0 ? [] : [{ key: 'on', voice: 0, bank: 0, program, tone: 0, note: 60, volume: 100 }], vabs: [], theater: 0 }, frameRan: 1, vblank: field + 1 });
const programs = (sounds) => sounds.flatMap((s) => s.sound.commands.map((c) => c.program));

test("a field's sound is given out once it is final, in order and once; a field played again is heard as played again", () => {
  const journal = new MatchJournal();
  for (let field = 0; field < 6; field += 1) journal.note(field, sound(field, field === 4 ? 40 : -1), false);
  assert.deepEqual(journal.finalSounds(1).map((s) => s.vblank), [1, 2], 'the fields up to the final one');
  assert.deepEqual(journal.finalSounds(1), [], 'and not again');
  /* A late word: fields 3 to 5 played again, the guessed hit at 4 a miss, a hit at 5 instead. */
  journal.note(3, sound(3), false);
  journal.note(4, sound(4), false);
  journal.note(5, sound(5, 50), false);
  const heard = journal.finalSounds(5);
  assert.deepEqual(heard.map((s) => s.vblank), [3, 4, 5, 6]);
  assert.deepEqual(programs(heard), [50], "the hit the rollback put right heard, the guessed one never");
  assert.deepEqual(journal.finalSounds(9), [], 'nothing past the newest field played');
});

test('the picture holds over a knockout not yet final, and goes on once it is, or once a rollback takes it back', () => {
  const journal = new MatchJournal();
  for (let field = 0; field < 10; field += 1) journal.note(field, sound(field), field >= 7);
  assert.equal(journal.holding(5), true, 'knocked out from field 7, final only to 5');
  assert.equal(journal.holding(6), true);
  assert.equal(journal.holding(7), false, 'the knockout final: drawn on');
  const taken = new MatchJournal();
  for (let field = 0; field < 10; field += 1) taken.note(field, sound(field), field >= 7);
  assert.equal(taken.holding(5), true);
  /* The other side's word comes: a block, not a knockout, from field 6 on. */
  for (let field = 6; field < 11; field += 1) taken.note(field, sound(field), false);
  assert.equal(taken.holding(5), false, 'taken back before it was seen');
  const none = new MatchJournal();
  for (let field = 0; field < 10; field += 1) none.note(field, sound(field), false);
  assert.equal(none.holding(0), false, 'no knockout, nothing held however far the guess runs');
});
