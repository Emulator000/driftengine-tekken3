/**
 * The remake's way to the attract intros for showing them, on the imported data: select during the
 * title's movie, and select again while an intro plays for the next of the three, earned or not;
 * and an intro set up whatever camera the attract demo before it left.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadFightTables, loadIntroModels, loadMoveset } from '../src/assets/load.ts';
import { bindMoveIds } from '../src/sim/fight/match.ts';
import { Mode } from '../src/sim/fight/state.ts';
import { Game } from '../src/sim/game/game.ts';
import { Scene } from '../src/sim/game/state.ts';
import { TitleShows } from '../src/sim/game/title.ts';

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
const skip = !existsSync(path.join(assets, 'manifest.json')) && 'no imported data; run npm run extract and npm run import';
const json = async (name) => JSON.parse(readFileSync(path.join(assets, name), 'utf8'));
const SELECT = 0x100;

test("select during the title's movie goes straight to the attract overlay's intro", { skip }, async () => {
  const { tables, scenes } = await loadFightTables(json);
  const game = new Game({ tables, scenes, fightData: () => null, introData: () => assert.fail('no intro plays yet') });
  const state = game.state;
  Object.assign(state, { scene: Scene.TITLE, step: 0 });
  state.attract.step = 0;
  game.field([0, 0]);
  game.field([0, 0]);
  assert.equal(state.title.shows, TitleShows.MOVIE, 'the opening movie plays');
  /* Held two fields: the movie's code runs every other one. */
  game.field([SELECT, 0]);
  game.field([SELECT, 0]);
  assert.equal(state.scene, Scene.LOGO);
  assert.equal(state.next, Scene.ATTRACT, 'on to the intro');
  assert.equal(state.attract.step, 1, 'the attract cycle on the step that shows it');
});

test('an intro sets up whatever camera the attract demo before it left: its sides, on no move yet, call for no shot', { skip }, async () => {
  const { tables, scenes } = await loadFightTables(json);
  const [common, introSet, introModels] = await Promise.all([loadMoveset(json, 'common'), loadMoveset(json, 'intro'), loadIntroModels(json)]);
  const sets = [introSet, introSet, common];
  const introData = (intro) => ({ ...tables, models: introModels[intro], sets, moveIds: bindMoveIds(sets) });
  const game = new Game({ tables, scenes, fightData: () => null, introData });
  const state = game.state;
  Object.assign(state, { scene: Scene.TITLE, step: 0 });
  state.attract.step = 0;
  for (const pads of [[0, 0], [0, 0], [SELECT, 0], [SELECT, 0]]) game.field(pads);
  for (let field = 0; field < 2000 && !(state.scene === Scene.ATTRACT && state.step === 2); field += 1) game.field([0, 0]);
  assert.equal(state.attractScreen.step, 0, 'the intro about to set up');
  /* The demo's last camera: the demo's own, started, on its follow shot (the attract camera's step 11), swinging, the fighters apart. */
  state.world.mode = Mode.DEMO;
  state.world.camera.attractStarted = 1;
  state.world.camera.attract.step = 11;
  state.world.camera.follow[0].swinging = 1;
  state.world.distance = 1000;
  game.field([0, 0]);
  assert.equal(state.attractScreen.step, 1, 'set up, waiting for its song');
});

test('select while an intro plays shows the next of the three in turn, earned or not, from its start', { skip }, async () => {
  const { tables, scenes } = await loadFightTables(json);
  const [common, introSet, introModels] = await Promise.all([loadMoveset(json, 'common'), loadMoveset(json, 'intro'), loadIntroModels(json)]);
  const sets = [introSet, introSet, common];
  const introData = (intro) => ({ ...tables, models: introModels[intro], sets, moveIds: bindMoveIds(sets) });
  const game = new Game({ tables, scenes, fightData: () => null, introData });
  const state = game.state;
  Object.assign(state, { scene: Scene.TITLE, step: 0 });
  state.attract.step = 0;
  state.attract.intros = 0;
  for (const pads of [[0, 0], [0, 0], [SELECT, 0], [SELECT, 0]]) game.field(pads);
  const playing = () => {
    for (let field = 0; field < 2000 && !(state.scene === Scene.ATTRACT && state.step === 2 && state.attractScreen.step === 2); field += 1) game.field([0, 0]);
    assert.equal(state.attractScreen.step, 2, 'the intro playing');
  };
  playing();
  const first = state.attract.intro;
  const seen = [first];
  for (let press = 0; press < 3; press += 1) {
    for (let field = 0; field < 60; field += 1) game.field([0, 0]);
    game.field([SELECT, 0]);
    game.field([SELECT, 0]);
    assert.equal(state.scene, Scene.ATTRACT, 'still the attract overlay');
    playing();
    seen.push(state.attract.intro);
  }
  assert.deepEqual(seen, [first, (first + 1) % 3, (first + 2) % 3, first], 'each of the three, then the first again');
});
