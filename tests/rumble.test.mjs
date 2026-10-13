/**
 * The pads' vibration as the driver plays it, on patterns of our own: a pattern asked for is taken
 * at the next field on its channel, its steps lasting their fields; a motor with no steps keeps
 * what its channel played; the last asked on a channel in a frame wins, and both pads take one
 * asked for both; the highest channel playing decides each motor; the small motor turns by its
 * duty; a pad feels nothing unless its side has joined and its vibration is on; switching the
 * vibration off keeps the patterns going unfelt, a stop ends them. And on the imported table, a
 * light clean hit's answer as the console plays it.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { motorsOff, rumbleField, stopMotors } from '../src/sim/game/rumble.ts';
import { blankGameState } from '../src/sim/game/state.ts';

/** Patterns: 1 small at level 15 for 2 fields then 8 for 1 (channel 0); 2 large at level 3 for 3 fields (channel 1); 3 a small step only (channel 1); 4 on channel 2, large level 1 for 2; 5 a channel past the four. */
const TABLES = {
  channels: [0, 0, 1, 1, 2, 9],
  small: [[0], [0x1f02, 0x2801], [0], [0x2f01], [0x2003], [0x2f01]],
  large: [[0], [0], [0x2303], [0], [0x2102], [0x2f01]],
  duty: [0, 0, 0, 0, 0, 0, 0, 0, 0x0f, 0, 0, 0, 0, 0, 0, 0xff],
};

function game() {
  const g = blankGameState();
  g.world.joined[0] = 1;
  g.world.joined[1] = 1;
  g.motors[0] = 1;
  g.motors[1] = 1;
  return g;
}
const field = (g) => {
  rumbleField(g, TABLES);
  return g.rumble.out.map((pad) => [...pad]);
};

test('a pattern is taken at the next field, each step its fields, the last ending it', () => {
  const g = game();
  g.world.vibrations.push({ pad: 0, pattern: 1 }, { pad: 1, pattern: 2 });
  assert.deepEqual(field(g), [
    [1, 0],
    [0, 0x3f],
  ]);
  assert.deepEqual(field(g)[0], [1, 0]);
  /* Level 8's duty turns on the first four fields of eight: the clock is at 2. */
  assert.deepEqual(field(g)[0], [1, 0]);
  assert.deepEqual(field(g), [
    [0, 0],
    [0, 0],
  ]);
});

test('a motor with no steps keeps its channel\'s; the last asked on a channel wins; both pads take one asked for both', () => {
  const g = game();
  g.world.vibrations.push({ pad: 0, pattern: 2 });
  field(g);
  g.world.vibrations.push({ pad: 0, pattern: 3 });
  assert.deepEqual(field(g)[0], [1, 0x3f], 'pattern 3 starts the small motor and leaves the large playing');
  g.world.vibrations.push({ pad: 2, pattern: 2 }, { pad: 2, pattern: 3 });
  const both = field(g);
  assert.deepEqual(both[0], [1, 0x3f]);
  assert.deepEqual(both[1], [1, 0], 'the second pad took only the last');
  g.world.vibrations.push({ pad: 0, pattern: 5 });
  field(g);
  assert.ok(g.rumble.tracks.every((t) => t.pattern !== 5), 'a channel past the four never starts');
});

test('the highest channel playing decides each motor, its 0 too', () => {
  const g = game();
  g.world.vibrations.push({ pad: 0, pattern: 3 }, { pad: 0, pattern: 4 });
  assert.deepEqual(field(g)[0], [0, 0x1f], "channel 2's small motor at level 0 hides channel 1's");
});

test('a pad feels nothing unless joined with its vibration on; switched off the patterns play on, a stop ends them', () => {
  const g = game();
  g.world.joined[1] = 0;
  g.world.vibrations.push({ pad: 2, pattern: 2 });
  assert.deepEqual(field(g), [
    [0, 0x3f],
    [0, 0],
  ]);
  motorsOff(g);
  assert.deepEqual(field(g)[0], [0, 0]);
  g.motors[0] = 1;
  assert.deepEqual(field(g)[0], [0, 0x3f], 'still playing');
  g.world.vibrations.push({ pad: 0, pattern: 1 });
  stopMotors(g);
  g.world.vibrations.push({ pad: 0, pattern: 4 });
  g.motors[0] = 1;
  assert.deepEqual(field(g)[0], [0, 0x1f], 'what was asked before the stop dropped, the rest ended; what came after it plays');
});

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
const skip = !existsSync(path.join(assets, 'tables/input.json')) && 'no imported data; run npm run extract and npm run import';

test("on the imported table: a light clean hit's answer, field by field", { skip }, () => {
  const tables = JSON.parse(readFileSync(path.join(assets, 'tables/input.json'), 'utf8')).vibration;
  assert.equal(tables.channels.length, 28);
  const g = game();
  g.world.vibrations.push({ pad: 0, pattern: 5 });
  const small = [];
  const large = [];
  for (let i = 0; i < 14; i += 1) {
    rumbleField(g, tables);
    small.push(g.rumble.out[0][0]);
    large.push(g.rumble.out[0][1]);
  }
  assert.equal(small.join(''), '11111100111110');
  assert.deepEqual(large, [207, 207, 207, 207, 207, 159, 159, 159, 111, 111, 111, 63, 63, 63]);
  g.world.vibrations.push({ pad: 0, pattern: 1 });
  rumbleField(g, tables);
  assert.deepEqual(g.rumble.out[0], [0, 0], 'the light shake does nothing');
});
