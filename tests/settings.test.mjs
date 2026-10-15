/**
 * The remake's own settings as the device keeps them: read back as written, each missing or out of
 * its range at its default, the frame rate's switch kept before them read; and the address's own
 * word for a setting winning over the kept one's.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MemoryStore } from '@driftengine/core';
import { asked, readSettings, writeSettings } from '../src/app/settings.ts';
import { REMAKE_DEFAULTS } from '../src/sim/game/remake-options.ts';

test('the settings are read back as written, each missing or out of its range at its default', () => {
  const store = new MemoryStore();
  assert.deepEqual(readSettings(store), REMAKE_DEFAULTS);
  const set = { textures: 1, models: 2, stages: 1, fighters: 1, cloth: 1, picture: 3, frameRate: 1, touchPad: 2, remaster: 1, look: 2, brightness: 0, floorFade: 1 };
  writeSettings(set, store);
  assert.deepEqual(readSettings(store), set);
  store.write('tekken3.settings', JSON.stringify({ textures: 2, models: -1, stages: 'psx', picture: 1.5, touchPad: 1 }));
  assert.deepEqual(readSettings(store), { ...REMAKE_DEFAULTS, touchPad: 1 });
  store.write('tekken3.settings', 'not JSON');
  assert.deepEqual(readSettings(store), REMAKE_DEFAULTS);
});

test('the frame rate\'s switch kept before the settings is read with them', () => {
  const store = new MemoryStore();
  store.write('tekken3.fps', '1');
  assert.equal(readSettings(store).frameRate, 1);
  writeSettings({ ...REMAKE_DEFAULTS }, store);
  assert.equal(readSettings(store).frameRate, 0, 'the settings once kept');
});

test('the address\'s word for a setting wins over the kept one', () => {
  const words = [null, 'psx'];
  assert.equal(asked(new URLSearchParams(''), 'textures', 1, words), 'psx');
  assert.equal(asked(new URLSearchParams(''), 'textures', 0, words), null);
  assert.equal(asked(new URLSearchParams('textures=smooth'), 'textures', 1, words), 'smooth');
});
