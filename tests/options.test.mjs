/**
 * The Options on the imported data: the first page's list and its way out to the mode menu (which
 * opens on the Options again); GAME OPTION changing the options at once and showing the modes the
 * picked one applies to; the music's options told to its driver (silent in the matches' scenes);
 * the key configuration's boxes opening while a button is held, their values changed and the pad
 * mapped by them on leaving, and vibration switched; SAVE DATA (the memory card's page) saving,
 * loading and turning auto save on; the display's place; REMAKE OPTION's settings; and the
 * records' lists.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadFightTables } from '../src/assets/load.ts';
import { Game } from '../src/sim/game/game.ts';
import { REMAKE_PAGE, REMASTER_LINE, RESTART_LINE, restartWanted } from '../src/sim/game/remake-options.ts';
import { Scene } from '../src/sim/game/state.ts';
import { musicCommand, newMusic } from '../src/sim/sound/music.ts';

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
const imported = existsSync(path.join(assets, 'manifest.json'));
const skip = !imported && 'no imported data; run npm run extract and npm run import';
const json = async (name) => JSON.parse(readFileSync(path.join(assets, name), 'utf8'));

const UP = 0x1000;
const RIGHT = 0x2000;
const DOWN = 0x4000;
const LEFT = 0x8000;
const START = 0x800;
const SELECT = 0x100;
const CROSS = 0x40;
const L2 = 0x1;
const R2 = 0x2;

/** A game in the Options' first frame. */
async function options() {
  const { tables, scenes } = await loadFightTables(json);
  const game = new Game({ tables, scenes, fightData: () => null, introData: () => assert.fail('no intro plays') });
  const state = game.state;
  Object.assign(state, { scene: Scene.OPTIONS, step: 0 });
  /** One field with these buttons held on the first pad (and the second's). */
  const hold = (first = 0, second = 0) => game.field([first, second]);
  /** A button pressed and let go. */
  const press = (bits, pad = 0) => {
    hold(pad === 0 ? bits : 0, pad === 1 ? bits : 0);
    hold();
  };
  hold();
  return { game, state, tables, scenes, hold, press };
}

const texts = (state) => state.printed.map((run) => run.text);
const printed = (state, text) => state.printed.find((run) => run.text === text);

test('the first page lists the others; select leaves for the mode menu, which opens on the Options', { skip }, async () => {
  const { state, hold, press } = await options();
  assert.equal(state.menu.toOptions, 1);
  assert.equal(state.optionsScreen.page, 0);
  for (const label of ['OPTION MODE', 'GAME OPTION', 'KEY CONFIGURATION', 'RECORDS', 'DISPLAY ADJUST', 'SAVE DATA', 'REMAKE OPTION', 'EXIT']) assert.ok(texts(state).includes(label), label);
  assert.equal(printed(state, 'EXIT').y, 0x64 + 6 * 0x28, 'REMAKE OPTION listed before EXIT');
  const bar = state.drawn.find((d) => d.kind === 'tile' && d.layer === 4);
  assert.deepEqual([bar.x, bar.y, bar.w, bar.h], [0x14 - 3, 0x64 - 3, 'GAME OPTION'.length * 9 + 6, 0x16], 'the bar under the picked row');
  press(UP);
  assert.equal(state.optionsScreen.pages[0].cursor, 6, 'up from the first wraps to EXIT');
  press(SELECT);
  assert.equal(state.step, 2, 'the page past the last leaves');
  hold();
  assert.equal(state.scene, Scene.LOGO);
  assert.equal(state.next, Scene.MENU);
});

test('GAME OPTION changes the options at once, the default in its own colour, the modes it applies to in the box', { skip }, async () => {
  const { state, press } = await options();
  press(CROSS);
  assert.equal(state.optionsScreen.page, 1);
  assert.equal(state.options.difficulty, 1);
  assert.equal(printed(state, 'MEDIUM').colour, 1, 'the default value');
  const labels = state.drawn.filter((d) => d.kind === 'label');
  assert.deepEqual(labels.map((d) => d.grey), [false, true, false, true, true, true, false, true].filter((_, i) => i !== 5), 'DIFFICULTY applies to Arcade, Team Battle and Tekken Force (Tekken Ball not yet earned)');
  press(RIGHT);
  assert.equal(state.options.difficulty, 2);
  assert.equal(printed(state, 'HARD').colour, 6);
  press(RIGHT);
  assert.equal(state.options.difficulty, 0, 'past the last value wraps');
  press(DOWN);
  press(DOWN);
  press(LEFT);
  assert.equal(state.options.roundTime, 1);
  for (let i = 0; i < 3; i += 1) press(LEFT);
  assert.equal(state.options.roundTime, 4);
  press(RIGHT);
  assert.ok(texts(state).includes('abc'), 'no time limit: the infinity sign');
  press(SELECT);
  assert.equal(state.optionsScreen.page, 0);
});

test('the music\'s options reach its driver: the set songs pick from (silent in the matches\' scenes) and stereo', { skip }, async () => {
  const { state, hold } = await options();
  state.options.musicSet = 1;
  hold();
  assert.deepEqual(state.world.sound.music.options, { set: 1, stereo: state.options.stereo });
  state.options.musicSet = 2;
  hold();
  assert.equal(state.world.sound.music.options.set, 0, 'silent plays the arrangement outside the matches');
  const m = newMusic();
  const tables = (await loadFightTables(json)).tables.music;
  musicCommand(m, tables, { key: 'music options', set: -1, stereo: 1 });
  musicCommand(m, tables, { key: 'song', song: 3, next: false });
  assert.equal(m.song, -1, 'no song in a silent match');
  musicCommand(m, tables, { key: 'music options', set: 1, stereo: 0 });
  musicCommand(m, tables, { key: 'song', song: 3, next: false });
  assert.equal(m.song, 3);
  assert.equal(m.xa, tables.picks[3][1].xa, "the arcade's pick");
});

test('the key configuration: a held button opens its box, up and down change its value, the pads are mapped on leaving', { skip }, async () => {
  const { state, scenes, hold, press } = await options();
  press(DOWN);
  press(CROSS);
  assert.equal(state.optionsScreen.page, 4);
  const side = state.optionsScreen.sides[0];
  const cross = scenes.options.keys.findIndex((k) => k.bit === CROSS);
  const key = scenes.options.keys[cross].key;
  const before = state.options.keys[0][key];
  for (let i = 0; i < 9; i += 1) hold(CROSS);
  assert.equal(side.boxes[cross].state, 2, 'open after eight frames held');
  assert.equal(side.boxes[cross].grow, 8);
  hold(CROSS | DOWN);
  assert.equal(state.options.keys[0][key], (before + 1) % 13);
  for (let i = 0; i < 9; i += 1) hold();
  assert.equal(side.boxes[cross].state, 0, 'closed once let go');
  press(DOWN);
  assert.equal(side.cursor, 1);
  hold(RIGHT);
  assert.equal(state.options.vibration[0], 1);
  assert.equal(state.motors[0], 1);
  assert.deepEqual(state.world.vibrations, [{ pad: 0, pattern: 0xd }], 'the pad buzzed');
  hold();
  press(SELECT);
  assert.equal(state.optionsScreen.page, 0);
  assert.equal(state.pads.maps[0][6], scenes.keyBits[state.options.keys[0][key]], "the cross mapped as its key says");
});

test('L2, R2 and select on KEY CONFIGURATION turn the hidden switch, and leave', { skip }, async () => {
  const { state, hold } = await options();
  hold(DOWN);
  hold();
  hold(L2 | R2);
  hold(L2 | R2 | SELECT);
  assert.equal(state.options.otherTitle, 1);
  assert.equal(state.optionsScreen.page, 6);
});

test('SAVE DATA (the memory card\'s page) saves and loads the progress, and auto save asks to save one when none is', { skip }, async () => {
  const { state, press, hold } = await options();
  for (let i = 0; i < 4; i += 1) press(DOWN);
  press(CROSS);
  assert.equal(state.optionsScreen.page, 3);
  for (const label of ['SAVE DATA', 'SAVE', 'LOAD', 'AUTO SAVE', 'EXIT']) assert.ok(texts(state).includes(label), label);
  press(CROSS);
  assert.equal(state.optionsScreen.pages[3].sub, 1);
  hold(START);
  assert.equal(state.saving, 1);
  assert.ok(state.kept !== null);
  hold();
  assert.ok(texts(state).includes('SAVE OK!'));
  press(CROSS);
  assert.equal(state.optionsScreen.pages[3].sub, 0);
  state.options.difficulty = 2;
  press(DOWN);
  press(CROSS);
  press(START);
  assert.equal(state.options.difficulty, 1, 'loaded as saved');
  assert.ok(texts(state).includes('LOAD OK!'));
  press(CROSS);
  state.kept = null;
  press(CROSS);
  press(START);
  assert.ok(texts(state).includes('NO SAVE DATA!'));
  press(CROSS);
  press(DOWN);
  state.options.autoSave = 0;
  press(RIGHT);
  assert.equal(state.optionsScreen.pages[3].sub, 3);
  assert.equal(state.options.autoSave, 0, 'shown off while it asks');
  hold(START);
  assert.equal(state.saving, 1);
  assert.equal(state.kept.options.autoSave, 1, 'saved with auto save on');
  hold();
  assert.equal(state.options.autoSave, 1);
  assert.equal(state.optionsScreen.pages[3].sub, 0);
  press(LEFT);
  assert.equal(state.options.autoSave, 0, 'off needs no card');
});

test('DISPLAY ADJUST moves the display\'s place within its limits, start puts it back', { skip }, async () => {
  const { state, press } = await options();
  for (let i = 0; i < 3; i += 1) press(DOWN);
  press(CROSS);
  assert.equal(state.optionsScreen.page, 5);
  assert.deepEqual(state.options.display, { x: -2, y: 0 });
  for (let i = 0; i < 20; i += 1) press(RIGHT);
  for (let i = 0; i < 12; i += 1) press(DOWN);
  assert.deepEqual(state.options.display, { x: 14, y: 8 });
  const title = printed(state, 'DISPLAY ADJUST');
  assert.deepEqual([title.x, title.y], [0x5b - ((14 * 0x5b + 0x3f) >> 6), 0x28 - 16], 'its texts kept in their place on the screen');
  press(START);
  assert.deepEqual(state.options.display, { x: -2, y: 0 });
  press(CROSS);
  assert.equal(state.optionsScreen.page, 0);
});

test('REMAKE OPTION changes the remake\'s settings, says a restart applies one, and goes back to the first page', { skip }, async () => {
  const { state, press } = await options();
  for (let i = 0; i < 5; i += 1) press(DOWN);
  press(CROSS);
  assert.equal(state.optionsScreen.page, REMAKE_PAGE);
  for (const label of ['REMAKE OPTION', 'TEXTURES', 'MODELS', 'STAGES', 'FIGHTERS', 'CLOTH', 'PICTURE', 'FRAME RATE', 'TOUCH PAD', 'REMASTER', 'EXIT']) assert.ok(texts(state).includes(label), label);
  assert.equal(printed(state, 'SMOOTH').colour, 1, 'the default value');
  assert.ok(!texts(state).includes(RESTART_LINE));
  press(RIGHT);
  assert.equal(state.remake.settings.textures, 1);
  assert.ok(texts(state).includes('ORIGINAL'));
  assert.ok(texts(state).includes(RESTART_LINE), 'a change a restart applies');
  press(LEFT);
  assert.ok(!texts(state).includes(RESTART_LINE), 'back as it started');
  for (let i = 0; i < 4; i += 1) press(DOWN);
  press(RIGHT);
  assert.equal(state.remake.settings.cloth, 1);
  assert.ok(texts(state).includes(RESTART_LINE), 'the cloth is kept clear as a fight loads');
  press(LEFT);
  for (let i = 0; i < 2; i += 1) press(DOWN);
  press(RIGHT);
  assert.equal(state.remake.settings.frameRate, 1);
  assert.ok(!texts(state).includes(RESTART_LINE), 'the frame rate is shown at once');
  press(DOWN);
  press(LEFT);
  assert.equal(state.remake.settings.touchPad, 2, 'left from the first wraps to the last');
  press(DOWN);
  press(RIGHT);
  assert.equal(state.remake.settings.remaster, 1);
  assert.ok(texts(state).includes(REMASTER_LINE), 'the remaster asked for, its assets not made');
  const remasterOnly = { remake: { ...state.remake, settings: { ...state.remake.started, remaster: 1 } } };
  assert.ok(!restartWanted(remasterOnly), 'not made: the remaster alone restarts nothing');
  state.remake.remasterMade = true;
  press(LEFT);
  press(RIGHT);
  assert.ok(!texts(state).includes(REMASTER_LINE) && texts(state).includes(RESTART_LINE), 'made: a restart draws it');
  assert.ok(restartWanted({ remake: { ...state.remake, settings: { ...state.remake.started, remaster: 1 } } }), 'made: the remaster alone restarts');
  assert.ok(texts(state).includes('LOOK') && texts(state).includes('NORMAL'), 'the remaster on: its look listed, normal');
  press(DOWN);
  press(RIGHT);
  assert.equal(state.remake.settings.look, 2);
  assert.ok(!restartWanted({ remake: { ...state.remake, settings: { ...state.remake.started, look: 2 } } }), 'the look changes at once');
  assert.ok(texts(state).includes('BRIGHTNESS') && texts(state).includes('FLOOR FADE'), 'the remaster on: its brightness and floors listed');
  assert.ok(printed(state, 'EXIT').y + 16 <= printed(state, RESTART_LINE).y && printed(state, RESTART_LINE).y + 16 <= 448, `the list ends at ${printed(state, 'EXIT').y}, the line under it at ${printed(state, RESTART_LINE).y}`);
  press(DOWN);
  press(RIGHT);
  assert.equal(state.remake.settings.brightness, 2);
  press(DOWN);
  press(RIGHT);
  assert.equal(state.remake.settings.floorFade, 1);
  assert.ok(!restartWanted({ remake: { ...state.remake, settings: { ...state.remake.started, brightness: 2, floorFade: 1 } } }), 'the brightness and the floors change at once');
  press(DOWN);
  assert.equal(state.remake.settings.crt, 0, 'the CRT filter off unless asked for');
  press(RIGHT);
  assert.equal(state.remake.settings.crt, 1);
  assert.ok(!restartWanted({ remake: { ...state.remake, settings: { ...state.remake.started, crt: 1 } } }), 'the CRT filter laid at once');
  press(UP);
  for (let i = 0; i < 3; i += 1) press(UP);
  press(LEFT);
  assert.ok(!texts(state).includes('LOOK') && !texts(state).includes('BRIGHTNESS') && !texts(state).includes('FLOOR FADE'), 'the remaster off: its lines not listed');
  press(SELECT);
  assert.equal(state.optionsScreen.page, 0);
  assert.equal(state.remake.settings.touchPad, 2, 'kept on leaving');
});

test('RECORDS shows the four lists, the best times quickest first', { skip }, async () => {
  const { state, press } = await options();
  state.records.times[3].frames = 100;
  state.records.times[0].frames = 200;
  press(DOWN);
  press(DOWN);
  press(CROSS);
  assert.equal(state.optionsScreen.page, 2);
  const lists = state.optionsScreen.records.lists;
  assert.deepEqual(lists[0].order.slice(0, 2), [3, 0]);
  assert.ok(texts(state).includes('CHARACTER TIME ATTACK DATA'));
  press(RIGHT);
  assert.equal(state.optionsScreen.records.list, 1);
  press(LEFT);
  press(LEFT);
  assert.equal(state.optionsScreen.records.list, 3, 'left from the first wraps');
  press(CROSS);
  assert.equal(state.optionsScreen.page, 0);
});
