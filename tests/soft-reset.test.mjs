/**
 * The soft reset (start and select held, then select; or the pause menu's reset) ends what is
 * playing and goes back to the mode menu with the music stopped and its driver reset, as the
 * game's own reset does, so a fight's song does not play on into the menus. On the imported data.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadFightTables, loadMoveset } from '../src/assets/load.ts';
import { fightDataFor } from '../src/sim/fight/match.ts';
import { FightStep } from '../src/sim/game/fight-scene.ts';
import { Game } from '../src/sim/game/game.ts';
import { MenuMode, startMode } from '../src/sim/game/menu.ts';
import { Scene } from '../src/sim/game/state.ts';
import { MusicMode } from '../src/sim/sound/music.ts';

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
const manifest = existsSync(path.join(assets, 'manifest.json')) ? JSON.parse(readFileSync(path.join(assets, 'manifest.json'), 'utf8')) : {};
const imported = Array.isArray(manifest.movesets) && manifest.movesets.length > 0;
const json = async (name) => JSON.parse(readFileSync(path.join(assets, name), 'utf8'));
const two = (n) => String(n).padStart(2, '0');

/** The pause menu's choice that resets. */
const PAUSE_RESET = 3;

test('the pause menu\'s reset stops the fight\'s song on the way back to the mode menu', { skip: !imported && 'no imported data; run npm run extract and npm run import' }, async () => {
  const { tables, scenes } = await loadFightTables(json);
  const movesets = new Map();
  for (const id of manifest.movesets) movesets.set(id, await loadMoveset(json, two(id)));
  const common = await loadMoveset(json, 'common');
  const game = new Game({ tables, scenes, fightData: (setup) => fightDataFor(tables, setup, (id) => movesets.get(id), common), introData: () => assert.fail('no intro plays') });
  const state = game.state;
  startMode(state, MenuMode.ARCADE, 1);
  Object.assign(state.entrants, { roster: [0, state.entrants.roster[1]], costume: [0, 0], chosen: [1, 0], computer: [0, 0] });
  state.modeOverlay = state.run.overlay;
  Object.assign(state, { scene: Scene.FIGHT, step: FightStep.MODE_SETUP });
  for (let field = 0; field < 600 && !(state.step === FightStep.FIGHTING && state.world.round.flow === 1); field += 1) game.field([0, 0]);
  const music = () => state.world.sound.music;
  assert.equal(music().mode, MusicMode.PLAYING, 'the stage\'s song plays');
  assert.ok(0 <= music().song);
  state.world.pauseMenu.choice = PAUSE_RESET;
  game.field([0, 0]);
  assert.equal(state.scene, Scene.LOGO, 'on the way to the mode menu');
  assert.equal(music().song, -1, 'the song stopped');
  assert.equal(music().mode, MusicMode.STOPPED);
});
