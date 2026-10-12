/**
 * An Arcade ending as the remake plays it, on the imported data: its movie plays on within the
 * Theater's frame across the fields its waits spend, start held stopping it; a song the last win
 * has not yet faded out is stopped first, so the movie keeps its volume; and the credits roll the
 * remake's line before the game's own staff.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadFightTables } from '../src/assets/load.ts';
import { playSong } from '../src/sim/fight/voices.ts';
import { Game } from '../src/sim/game/game.ts';
import { Scene } from '../src/sim/game/state.ts';
import { MusicMode, syncMusic } from '../src/sim/sound/music.ts';

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
const imported = existsSync(path.join(assets, 'manifest.json'));
const skip = !imported && 'no imported data; run npm run extract and npm run import';
const json = async (name) => JSON.parse(readFileSync(path.join(assets, name), 'utf8'));

const START = 0x800;
/** The Theater's states: its movie, then the credits. */
const MOVIE = 2;
const CREDITS = 3;
/** A stage's song, playing as the last match is won. */
const STAGE_SONG = 27;

/** A game on its way to Paul's ending (as `?ending=0` starts it), a stage's song playing when `song`. */
async function toEnding(song) {
  const { tables, scenes } = await loadFightTables(json);
  const game = new Game({ tables, scenes, fightData: () => null, introData: () => assert.fail('no intro plays') });
  const state = game.state;
  Object.assign(state, { scene: Scene.OVERLAY_LOADER, step: 0, next: Scene.MOVIE });
  state.world.humans = 1;
  state.world.fighters[0].rosterCode = 0;
  if (song) {
    playSong(state.world, STAGE_SONG, false);
    syncMusic(state.world.sound, tables.music);
  }
  return { game, state, music: tables.music };
}

/** The game played on until the Theater's credits start, `pad(field)` the first pad; the fields its movie took and the volumes it played at. */
function playMovie(game, state, pad = () => 0) {
  let fields = 0;
  const volumes = new Set();
  for (let field = 0; field < 4000 && !(state.scene === Scene.MOVIE && state.step === CREDITS); field += 1) {
    game.field([pad(fields), 0]);
    if (state.scene === Scene.MOVIE && state.step === MOVIE) {
      fields += 1;
      if (state.world.sound.music.mode === MusicMode.MOVIE) volumes.add(state.world.sound.music.volume);
    }
  }
  return { fields, volumes };
}

test('the ending\'s movie plays on within its frame, and start held stops it', { skip }, async () => {
  const whole = await toEnding(false);
  const played = playMovie(whole.game, whole.state);
  assert.equal(whole.state.movie.result, 1, 'played through');
  assert.ok(1000 < played.fields, `the movie took ${played.fields} fields`);
  assert.ok([...played.volumes].every((v) => 0 < v), 'heard');
  const cut = await toEnding(false);
  const stopped = playMovie(cut.game, cut.state, (field) => (field >= 200 ? START : 0));
  assert.equal(cut.state.movie.result, -2, 'stopped by start');
  assert.ok(stopped.fields < 220, `stopped ${stopped.fields - 200} fields after start`);
});

test('a song the last win has not faded out yet does not silence the ending\'s movie', { skip }, async () => {
  const { game, state } = await toEnding(true);
  assert.equal(state.world.sound.music.song, STAGE_SONG);
  const { volumes } = playMovie(game, state);
  assert.ok(volumes.size > 0 && [...volumes].every((v) => 0 < v), `the movie played at ${[...volumes].join(', ')}`);
});

test('the credits roll the remake\'s line before the game\'s own staff', { skip }, async () => {
  const { game, state } = await toEnding(false);
  playMovie(game, state, (field) => (field === 30 ? START : 0));
  const lines = [];
  for (let field = 0; field < 3000 && lines.length < 2; field += 1) {
    game.field([0, 0]);
    for (const drawn of state.credits.drawn) if (drawn.kind === 'text' && !lines.includes(drawn.text) && drawn.text !== 'THE KING OF IRON FIST TOURNAMENT 3' && drawn.text !== 'TEKKEN 3') lines.push(drawn.text);
  }
  assert.deepEqual(lines, ['REMAKE IN DRIFTENGINE', 'NAMCO PRODUCTION STAFF']);
});
