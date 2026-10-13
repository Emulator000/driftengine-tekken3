/**
 * The Theater mode's menu on the imported data: from the mode menu through the overlay loader;
 * the movies' grid open as the endings seen open it (the opening and the arcade's always, Panda's
 * and Gun Jack's second endings their own movies), a movie chosen played and the menu back, EXIT
 * and select leaving for the mode menu; once every movie is open, the music page, its songs played
 * once from the set BGM SELECT turns to.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadFightTables } from '../src/assets/load.ts';
import { Game } from '../src/sim/game/game.ts';
import { MenuMode } from '../src/sim/game/menu.ts';
import { Scene } from '../src/sim/game/state.ts';
import { allSeen, entryState } from '../src/sim/game/theater-menu.ts';

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
const imported = existsSync(path.join(assets, 'manifest.json'));
const skip = !imported && 'no imported data; run npm run extract and npm run import';
const json = async (name) => JSON.parse(readFileSync(path.join(assets, name), 'utf8'));

const RIGHT = 0x2000;
const DOWN = 0x4000;
const LEFT = 0x8000;
const UP = 0x1000;
const SELECT = 0x100;
const CROSS = 0x40;
/** Every ending, Panda's, Gun Jack's second and Tiger's. */
const ALL_ENDINGS = [0x1fffff, 0x10900];

/** A game in the Theater's menu, with these endings seen. */
async function theater(endings = [0, 0]) {
  const { tables, scenes } = await loadFightTables(json);
  const game = new Game({ tables, scenes, fightData: () => null, introData: () => assert.fail('no intro plays') });
  const state = game.state;
  state.records.endings.splice(0, 2, ...endings);
  Object.assign(state, { scene: Scene.MOVIE, step: 0 });
  state.world.humans = 0;
  /** A frame with these buttons held (fields that run no frame, as after a movie, held through). */
  const hold = (bits = 0) => {
    do game.field([bits, 0]);
    while (state.codeRan === 0);
  };
  const press = (bits) => {
    hold(bits);
    hold();
  };
  hold();
  hold();
  return { game, state, scenes, hold, press };
}

const texts = (state) => state.printed.map((run) => run.text);

test('the mode menu\'s THEATER goes through the overlay loader to the menu, its movies\' page first', { skip }, async () => {
  const { tables, scenes } = await loadFightTables(json);
  const game = new Game({ tables, scenes, fightData: () => null, introData: () => assert.fail('no intro plays') });
  const state = game.state;
  Object.assign(state, { scene: Scene.MENU, step: 0 });
  state.earned.theater = 3;
  game.field([0, 0]);
  state.menu.picked = state.menu.items.findIndex((item) => item.mode === MenuMode.THEATER);
  game.field([CROSS, 0]);
  game.field([0, 0]);
  assert.equal(state.scene, Scene.OVERLAY_LOADER);
  assert.equal(state.next, Scene.MOVIE);
  for (let i = 0; i < 4 && state.scene !== Scene.MOVIE; i += 1) game.field([0, 0]);
  game.field([0, 0]);
  assert.equal(state.scene, Scene.MOVIE);
  assert.equal(state.theater.mode, 1);
  assert.equal(state.step, 1);
});

test('the movies\' grid opens as the endings seen open it', { skip }, async () => {
  const { state, scenes } = await theater([0x200, 0x800]);
  const movies = scenes.theater.movies;
  assert.equal(entryState(state, movies[0]), 0, 'the opening, always');
  assert.equal(entryState(state, movies[2]), 12, "Jin's, his ending seen");
  assert.equal(entryState(state, movies[3]), -1, "Paul's, not yet");
  assert.equal(entryState(state, movies[12]), 23, "Panda's ending its own movie");
  assert.equal(entryState(state, movies[18]), -2, 'an empty cell');
  assert.ok(!allSeen(state, scenes.theater));
  assert.ok(texts(state).includes('TEKKEN 3 MOVIE THEATER'));
  assert.ok(texts(state).includes('OPENING'));
  assert.ok(texts(state).includes('EXIT'));
  assert.ok(!texts(state).includes('MUSIC'), 'the music page waits for every movie');
  assert.equal(state.drawn.filter((d) => d.kind === 'film').length, 22, 'every cell but the empty ones');
});

test('a movie chosen plays, and the menu comes back after it; select leaves for the mode menu', { skip }, async () => {
  const { state, hold, press } = await theater();
  press(RIGHT);
  assert.equal(state.theater.cursor, 1);
  press(RIGHT);
  assert.equal(state.theater.cursor, 2, 'a closed cell can be picked');
  hold();
  assert.ok(texts(state).includes('???'), 'a closed cell has no name');
  hold(CROSS);
  hold();
  assert.equal(state.step, 1, 'and does not play');
  press(LEFT);
  press(LEFT);
  hold(CROSS);
  assert.equal(state.theater.movie, 0);
  hold();
  assert.equal(state.step, 2);
  assert.equal(state.theater.playing, 1, 'the opening plays');
  for (let field = 0; field < 600 && state.step === 2; field += 1) hold(0x800);
  hold();
  assert.equal(state.step, 1, 'start stopped it, the menu back');
  for (let i = 0; i < 4; i += 1) press(DOWN);
  assert.equal(state.theater.focus, 1, 'past the last row, EXIT');
  press(UP);
  assert.equal(state.theater.focus, 0);
  hold(SELECT);
  assert.equal(state.step, 10);
  hold();
  assert.equal(state.scene, Scene.LOGO);
  assert.equal(state.next, Scene.MENU);
});

test('with every movie open, the music page: songs played once from the set BGM SELECT turns to', { skip }, async () => {
  const { state, scenes, hold, press } = await theater(ALL_ENDINGS);
  assert.equal(state.theater.allSeen, 1);
  for (let i = 0; i < 4; i += 1) press(DOWN);
  assert.equal(state.theater.focus, 2, 'MUSIC');
  press(CROSS);
  assert.equal(state.theater.mode, 2, 'the remixed music');
  assert.ok(texts(state).includes('TEKKEN 3 REMIXED MUSIC'));
  press(DOWN);
  hold(CROSS);
  const song = state.world.sound.commands.find((c) => c.key === 'theater song');
  assert.deepEqual(song, { key: 'theater song', song: scenes.theater.songs[1].code >> 1, set: 0 });
  hold();
  press(RIGHT);
  press(DOWN);
  assert.equal(state.theater.focus, 4, 'BGM SELECT');
  press(CROSS);
  assert.equal(state.theater.mode, 3, 'the arcade music');
  press(LEFT);
  hold(CROSS);
  assert.equal(state.world.sound.commands.find((c) => c.key === 'theater song').set, 1);
  hold();
  press(RIGHT);
  press(UP);
  press(CROSS);
  assert.equal(state.theater.mode, 1, 'THEATER: back to the movies');
});
