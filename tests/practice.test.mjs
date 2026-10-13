/**
 * Practice on the imported data: it opens on MODE SELECT by itself and ignores the pad a while;
 * 1P FREESTYLE puts the training dummy against the human (crouching when set so), HIT ANALYSIS
 * colours the fighters, OK closes the menu; COMBO TRAINING's select plays the combo on the
 * human; PLAYER SELECT goes back to the character select and RESET to the mode menu.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadFightTables, loadMoveset } from '../src/assets/load.ts';
import { fightDataFor } from '../src/sim/fight/match.ts';
import { InputSource } from '../src/sim/fight/state.ts';
import { FightStep } from '../src/sim/game/fight-scene.ts';
import { Game } from '../src/sim/game/game.ts';
import { MenuMode, startMode } from '../src/sim/game/menu.ts';
import { Scene } from '../src/sim/game/state.ts';

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
const manifest = existsSync(path.join(assets, 'manifest.json')) ? JSON.parse(readFileSync(path.join(assets, 'manifest.json'), 'utf8')) : {};
const imported = Array.isArray(manifest.movesets) && manifest.movesets.length > 0;
const skip = !imported && 'no imported data; run npm run extract and npm run import';
const json = async (name) => JSON.parse(readFileSync(path.join(assets, name), 'utf8'));
const two = (n) => String(n).padStart(2, '0');

const DOWN = 0x4000;
const RIGHT = 0x2000;
const UP = 0x1000;
const CROSS = 0x40;
const SELECT = 0x100;

/** A game in practice's round, Paul on the first pad against Law, at its first frame paused on MODE SELECT. */
async function practice() {
  const { tables, scenes } = await loadFightTables(json);
  const movesets = new Map();
  for (const id of manifest.movesets) movesets.set(id, await loadMoveset(json, two(id)));
  const common = await loadMoveset(json, 'common');
  const game = new Game({ tables, scenes, fightData: (setup) => fightDataFor(tables, setup, (id) => movesets.get(id), common), introData: () => assert.fail('no intro plays') });
  const state = game.state;
  startMode(state, MenuMode.PRACTICE, 1);
  Object.assign(state.entrants, { roster: [0, 1], costume: [0, 0], chosen: [1, 1], computer: [0, 0] });
  state.modeOverlay = state.run.overlay;
  Object.assign(state, { scene: Scene.FIGHT, step: FightStep.MODE_SETUP });
  /** A frame with these buttons held on the first pad. */
  const hold = (bits = 0) => {
    do game.field([bits, 0]);
    while (state.codeRan === 0);
  };
  const press = (bits) => {
    hold(bits);
    hold();
  };
  for (let field = 0; field < 2000 && state.world.pause.requested === 0; field += 1) hold();
  return { game, state, scenes, hold, press };
}

const texts = (state) => state.printed.map((run) => run.text);

test('practice opens on MODE SELECT by itself, ignoring the pad a while', { skip }, async () => {
  const { state, hold, press } = await practice();
  assert.equal(state.step, FightStep.FIGHTING);
  assert.equal(state.world.pause.requested, 1, 'paused by itself for the human on the first pad');
  assert.equal(state.practice.modeSelect, 1);
  press(DOWN);
  assert.equal(state.practice.mode, 0, 'the pad ignored as it starts');
  for (let i = 0; i < 32; i += 1) hold();
  assert.equal(state.world.practice.starting, 0);
  assert.ok(texts(state).includes('MODE SELECT'));
  for (const line of ['1P FREESTYLE', 'VS CPU', 'COMBO TRAINING', 'PLAYER SELECT', 'RESET']) assert.ok(texts(state).includes(line), line);
  assert.ok(state.drawn.some((d) => d.kind === 'tile' && d.colour === 0x301000), 'the menu\'s box');
});

test('1P FREESTYLE: the dummy crouches when set so, HIT ANALYSIS colours the fighters, OK closes the menu', { skip }, async () => {
  const { state, hold, press } = await practice();
  for (let i = 0; i < 32; i += 1) hold();
  press(CROSS);
  assert.equal(state.practice.modeSelect, 0);
  for (let i = 0; i < 4; i += 1) hold();
  assert.ok(texts(state).includes('1P FREESTYLE'));
  assert.ok(texts(state).includes('TRAINING DUMMY'));
  press(DOWN);
  press(DOWN);
  press(RIGHT);
  assert.equal(state.practice.dummy, 1, 'CROUCH');
  press(DOWN);
  press(DOWN);
  press(DOWN);
  press(RIGHT);
  assert.equal(state.practice.hitAnalysis, 1);
  for (let i = 0; i < 5; i += 1) press(UP);
  assert.equal(state.practice.cursor[0], 0);
  press(CROSS);
  for (let i = 0; i < 3; i += 1) hold();
  assert.equal(state.world.pause.requested, 0, 'the menu closed');
  const partner = state.world.fighters[1];
  assert.equal(state.world.input.sources[partner.slot], InputSource.REPLAY, 'the dummy plays the partner');
  assert.equal(partner.input.replayHeld & DOWN, DOWN, 'crouching');
  assert.ok(state.world.practice.colours.every((c) => c[0] === 1), 'both fighters coloured');
  assert.ok(state.world.practice.colours.some((c) => c[3] === 0xfa), 'blue where a cancel is open');
});

test('COMBO TRAINING: select plays the combo on the human\'s fighter', { skip }, async () => {
  const { state, hold, press } = await practice();
  for (let i = 0; i < 32; i += 1) hold();
  press(DOWN);
  press(DOWN);
  press(CROSS);
  assert.equal(state.practice.mode, 2);
  for (let i = 0; i < 4; i += 1) hold();
  assert.ok(texts(state).includes('COMBO TRAINING'));
  press(CROSS);
  for (let i = 0; i < 3; i += 1) hold();
  assert.equal(state.world.pause.requested, 0);
  assert.equal(state.practice.session, 1);
  for (let i = 0; i < 5; i += 1) hold();
  press(SELECT);
  let played = false;
  for (let i = 0; i < 200 && !played; i += 1) {
    hold();
    played = state.world.input.sources[state.world.fighters[0].slot] === InputSource.REPLAY && state.practice.step === 5;
  }
  assert.ok(played, 'the combo plays on the human');
  assert.ok(state.drawn.some((d) => d.kind === 'input'), 'its inputs shown');
});

test('PLAYER SELECT goes back to the character select, RESET to the mode menu', { skip }, async () => {
  const { state, hold, press } = await practice();
  for (let i = 0; i < 32; i += 1) hold();
  press(DOWN);
  press(DOWN);
  press(DOWN);
  hold(CROSS);
  assert.equal(state.step, FightStep.FROM_MENUS);
  assert.equal(state.entrants.chosen[0], 0);
  const again = await practice();
  for (let i = 0; i < 32; i += 1) again.hold();
  again.press(UP);
  again.hold(CROSS);
  again.hold();
  assert.equal(again.state.scene, Scene.LOGO);
  assert.equal(again.state.next, Scene.MENU);
});
