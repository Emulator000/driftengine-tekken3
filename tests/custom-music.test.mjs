/**
 * The player's own songs in place of the game's music (REMAKE OPTION's MUSIC page): the mixer
 * taking its CD input in place of a song the player chose another for, or in the menus' silence;
 * and the page's choice of what plays, field by field.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ownMusic } from '../src/present/sound/mixer.ts';

const driver = (over = {}) => ({ song: -1, xa: -1, track: 0, readingMovie: false, ...over });

test("the mixer plays the player's song in place of a song of the game they chose another for, while the driver plays it", () => {
  const custom = { songs: new Set([7, 1]), menu: false };
  assert.equal(ownMusic(custom, driver({ song: 7, xa: 12 })), 'song');
  assert.equal(ownMusic(custom, driver({ song: 8, xa: 13 })), null, 'another song: the game\'s');
  assert.equal(ownMusic(custom, driver({ song: 7, xa: -1 })), null, 'the driver not playing it');
  assert.equal(ownMusic(custom, driver({ song: 7, xa: 12, readingMovie: true })), null, "a movie's sound over it");
});

test("the mixer plays the player's song in the menus' silence only while the page asks it, the game playing nothing", () => {
  assert.equal(ownMusic({ songs: new Set(), menu: true }, driver()), 'menu');
  assert.equal(ownMusic({ songs: new Set(), menu: false }, driver()), null);
  assert.equal(ownMusic({ songs: new Set(), menu: true }, driver({ song: 1, xa: 17 })), null, 'a song of the game playing');
  assert.equal(ownMusic({ songs: new Set(), menu: true }, driver({ readingMovie: true })), null, "a movie's sound");
  assert.equal(ownMusic({ songs: new Set(), menu: true }, driver({ track: 2 })), null, 'an audio track');
});

import { chosenFrom, keptFrom, ownSongsOf, ownWanted, RANDOM_SONG } from '../src/app/own-music.ts';
import { MusicPlays } from '../src/sim/game/music-page.ts';

const ROWS = [
  { key: 'menu', song: -1, label: 'MENU' },
  { key: '1', song: 1, label: 'SELECT' },
  { key: '7', song: 7, label: 'PAUL' },
  { key: '8', song: 8, label: 'LAW' },
];
const LIBRARY = [{ id: 'aaa' }, { id: 'bbb' }, { id: 'ccc' }];

test("the choices kept on the device put on the page's entries by the songs' ids, and back; a song gone from the library, the original", () => {
  const chosen = chosenFrom(ROWS, LIBRARY, { menu: 'bbb', 7: 'random', 8: 'gone' });
  assert.deepEqual(chosen, [MusicPlays.FIRST + 1, MusicPlays.ORIGINAL, MusicPlays.RANDOM, MusicPlays.ORIGINAL]);
  assert.deepEqual(keptFrom(ROWS, LIBRARY, chosen), { menu: 'bbb', 7: 'random' });
});

test("the game's songs the mixer plays the player's in place of: each entry not left original; none online", () => {
  assert.deepEqual(ownSongsOf(ROWS, [MusicPlays.FIRST, MusicPlays.ORIGINAL, MusicPlays.RANDOM, MusicPlays.ORIGINAL], false), [7]);
  assert.deepEqual(ownSongsOf(ROWS, [0, MusicPlays.FIRST, MusicPlays.FIRST, 0], true), [], 'online, the original music');
});

/** The game as the page sees it: a fight playing song 7, its first start, unless said otherwise. */
const view = (over = {}) => ({ scene: 8, page: 0, song: 7, xa: 12, starts: 1, movie: false, track: 0, online: false, ...over });

test("what the page's own song element plays: the song chosen for the game's song playing, from its start each time it starts", () => {
  const chosen = [MusicPlays.ORIGINAL, MusicPlays.ORIGINAL, MusicPlays.FIRST + 2, MusicPlays.RANDOM];
  assert.deepEqual(ownWanted(view(), ROWS, chosen), { choice: 2, occasion: 'song 7 1', menu: false });
  assert.deepEqual(ownWanted(view({ starts: 2 }), ROWS, chosen), { choice: 2, occasion: 'song 7 2', menu: false }, 'started again: a new occasion');
  assert.deepEqual(ownWanted(view({ song: 8 }), ROWS, chosen), { choice: RANDOM_SONG, occasion: 'song 8 1', menu: false });
  assert.equal(ownWanted(view({ song: 1 }), ROWS, chosen), null, 'left original');
  assert.equal(ownWanted(view({ online: true }), ROWS, chosen), null, 'online');
  assert.equal(ownWanted(view({ movie: true }), ROWS, chosen), null, "a movie's sound");
});

test("in the menus' silence the menus' choice plays, and on the MUSIC page the song the entry shown plays", () => {
  const chosen = [MusicPlays.FIRST, MusicPlays.ORIGINAL, MusicPlays.FIRST + 1, MusicPlays.ORIGINAL];
  const silent = { song: -1, xa: -1 };
  assert.deepEqual(ownWanted(view({ ...silent, scene: 4 }), ROWS, chosen), { choice: 0, occasion: 'menu', menu: true }, 'the mode menu');
  assert.deepEqual(ownWanted(view({ ...silent, scene: 5, page: 0x12, row: 2 }), ROWS, chosen), { choice: 1, occasion: 'preview 1', menu: true }, "the MUSIC page: the entry's song");
  assert.deepEqual(ownWanted(view({ ...silent, scene: 5, page: 0x12, row: 1 }), ROWS, chosen), { choice: 0, occasion: 'menu', menu: true }, 'an entry left original: the menus\' song');
  assert.equal(ownWanted(view({ ...silent, scene: 8 }), ROWS, chosen), null, "a fight's silence");
  assert.equal(ownWanted(view({ ...silent, scene: 4 }), ROWS, [MusicPlays.ORIGINAL, 0, 0, 0]), null, 'the menus left silent');
});
