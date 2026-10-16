/**
 * The stage's song held until the fight is on screen: taken out of a field's commands while the
 * picture is not ready, the rest left to play; started first among the commands of the first field
 * it is; dropped if the fight is left before it shows.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { holdSongs } from '../src/app/hold-song.ts';

test('a song is held while the fight is not on screen, and starts the first field it is', () => {
  const held = [];
  const first = [{ key: 'voice', id: 1 }, { key: 'song', song: 7, next: false }, { key: 'effect', id: 2 }];
  holdSongs(first, held, { waiting: true, still: true });
  assert.deepEqual(first, [{ key: 'voice', id: 1 }, { key: 'effect', id: 2 }], 'the rest plays');
  assert.deepEqual(held, [{ key: 'song', song: 7, next: false }]);
  const waiting = [{ key: 'voice', id: 3 }];
  holdSongs(waiting, held, { waiting: true, still: true });
  assert.equal(held.length, 1);
  const shown = [{ key: 'voice', id: 4 }];
  holdSongs(shown, held, { waiting: false, still: true });
  assert.deepEqual(shown, [{ key: 'song', song: 7, next: false }, { key: 'voice', id: 4 }]);
  assert.equal(held.length, 0);
});

test('a song held for a fight that is left before it shows is dropped', () => {
  const held = [{ key: 'song', song: 3, next: false }];
  const commands = [{ key: 'song', song: 9, next: false }];
  holdSongs(commands, held, { waiting: false, still: false });
  assert.deepEqual(commands, [{ key: 'song', song: 9, next: false }], 'the new scene\'s own song plays');
  assert.equal(held.length, 0);
});
