/** The remake's way to the attract intros for showing them, on the imported data: select during the title's movie. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadFightTables } from '../src/assets/load.ts';
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
