/**
 * A match loads silent, on the imported data: a song still playing as a match's versus screen comes
 * up (a won stage's, its fade not yet over) is faded out and ended before the match has loaded.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadFightTables } from '../src/assets/load.ts';
import { musicAfterWin, playSong } from '../src/sim/fight/voices.ts';
import { FightStep } from '../src/sim/game/fight-scene.ts';
import { Game } from '../src/sim/game/game.ts';
import { MenuMode, startMode } from '../src/sim/game/menu.ts';
import { Scene } from '../src/sim/game/state.ts';
import { musicFrame, MusicMode, musicTick, syncMusic } from '../src/sim/sound/music.ts';

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
const imported = existsSync(path.join(assets, 'manifest.json'));
const skip = !imported && 'no imported data; run npm run extract and npm run import';
const json = async (name) => JSON.parse(readFileSync(path.join(assets, name), 'utf8'));

/** A stage's song. */
const STAGE_SONG = 14;

test('a song still fading from a won stage ends as the next match\'s versus screen comes up', { skip }, async () => {
  const { tables, scenes } = await loadFightTables(json);
  const game = new Game({ tables, scenes, fightData: () => null, introData: () => assert.fail('no intro plays') });
  const state = game.state;
  startMode(state, MenuMode.ARCADE, 1);
  Object.assign(state, { scene: Scene.FIGHT, step: FightStep.MATCH });
  playSong(state.world, STAGE_SONG, false);
  musicAfterWin(state.world, 0);
  syncMusic(state.world.sound, tables.music);
  assert.equal(state.world.sound.music.mode, MusicMode.FADING_OUT);
  game.field([0, 0]);
  assert.equal(state.scene, Scene.VERSUS);
  /* The music's own frames on from there, as the versus screen and the load under it take them. */
  const music = syncMusic(state.world.sound, tables.music);
  for (let frame = 0; frame < 0x18; frame += 1) {
    musicTick(music);
    musicFrame(music, tables.music);
  }
  assert.equal(music.song, -1, 'no song');
  assert.equal(music.mode, MusicMode.STOPPED);
});
