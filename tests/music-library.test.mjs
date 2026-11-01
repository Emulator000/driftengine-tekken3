/**
 * The library of the player's own songs (`npm run music`): each song's name from its tags or its
 * file's name, its id from its bytes, and what a folder's import adds, keeps and drops.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { libraryId, plan, songName } from '../scripts/lib/music-library.mjs';
import { parseMusicLibrary, shownName } from '../src/assets/music.ts';

test("a song's name: its tags' title and artist, or its file's name split at the dash, or the file's name", () => {
  assert.deepEqual(songName({ title: 'Divine Funk', artist: 'D4R.IO' }, 'whatever.mp3'), { title: 'Divine Funk', artist: 'D4R.IO' });
  assert.deepEqual(songName({}, 'D4R.IO, TO4ST - MONTAGEM EXÉRCITO (Super Slowed).mp3'), { title: 'MONTAGEM EXÉRCITO (Super Slowed)', artist: 'D4R.IO, TO4ST' });
  assert.deepEqual(songName({ title: '  ' }, 'sekrxz - FLERTAR FUNK.wav'), { title: 'FLERTAR FUNK', artist: 'sekrxz' });
  assert.deepEqual(songName({}, 'Just a title.flac'), { title: 'Just a title', artist: '' });
  assert.deepEqual(songName({ TITLE: 'Upper', ARTIST: 'Case' }, 'x.ogg'), { title: 'Upper', artist: 'Case' }, "tags' names in any case");
});

test("a name as the game's menus show it: upper case, its accents kept, an at sign spelt out", () => {
  assert.equal(shownName('Montagem Exército (Super Slowed)'), 'MONTAGEM EXÉRCITO (SUPER SLOWED)');
  assert.equal(shownName('me @ home'), 'ME AT HOME');
  assert.equal(shownName('  two   spaces '), 'TWO SPACES');
});

test("a song's id is its bytes': the same bytes, the same id, whatever the file is called", () => {
  const a = libraryId(new Uint8Array([1, 2, 3]));
  assert.match(a, /^[0-9a-f]{12}$/);
  assert.equal(libraryId(new Uint8Array([1, 2, 3])), a);
  assert.notEqual(libraryId(new Uint8Array([1, 2, 4])), a);
});

test("a folder's import adds its new songs, keeps those already in the library and drops those no longer in it; the same song twice once", () => {
  const library = [{ id: 'aaa', title: 'Kept' }, { id: 'bbb', title: 'Gone' }];
  const found = [
    { id: 'aaa', path: '/m/kept.mp3' },
    { id: 'ccc', path: '/m/new.mp3' },
    { id: 'ccc', path: '/m/new copy.mp3' },
  ];
  const { add, keep, drop } = plan(library, found);
  assert.deepEqual(add.map((f) => f.path), ['/m/new.mp3']);
  assert.deepEqual(keep.map((s) => s.id), ['aaa']);
  assert.deepEqual(drop.map((s) => s.id), ['bbb']);
});

test("the library's list read and checked: a song without its id or title is no song; no list, an empty library", () => {
  const library = parseMusicLibrary({ format: 1, folder: '/m', songs: [{ id: 'abc123abc123', title: 'One', artist: 'A', seconds: 90 }, { title: 'No id' }, { id: 'def456def456', title: 'Two', artist: '' }] });
  assert.deepEqual(library.map((s) => s.id), ['abc123abc123', 'def456def456']);
  assert.deepEqual(parseMusicLibrary(null), []);
  assert.deepEqual(parseMusicLibrary({ format: 2, songs: [{ id: 'abc123abc123', title: 'X' }] }), [], 'a format this game does not read');
});
