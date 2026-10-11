/** The touch pad's stick: eight ways around where the thumb landed, none within the dead zone. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DOWN, LEFT, RIGHT, UP } from '../src/app/input.ts';
import { stickWord } from '../src/app/touch.ts';

const RADIUS = 64;

test('the stick holds nothing within its dead zone', () => {
  assert.equal(stickWord(0, 0, RADIUS), 0);
  assert.equal(stickWord(20, 0, RADIUS), 0);
  assert.equal(stickWord(-15, 15, RADIUS), 0);
});

test('the stick holds one of eight ways, screen down being the pad down', () => {
  const ways = [
    [RIGHT, 50, 0],
    [UP | RIGHT, 40, -40],
    [UP, 0, -50],
    [UP | LEFT, -40, -40],
    [LEFT, -50, 0],
    [DOWN | LEFT, -40, 40],
    [DOWN, 0, 50],
    [DOWN | RIGHT, 40, 40],
  ];
  for (const [word, dx, dy] of ways) assert.equal(stickWord(dx, dy, RADIUS), word, `${dx}, ${dy}`);
});

test('each way spans 45 degrees around its direction', () => {
  const at = (degrees) => stickWord(50 * Math.cos((degrees * Math.PI) / 180), -50 * Math.sin((degrees * Math.PI) / 180), RADIUS);
  assert.equal(at(22), RIGHT);
  assert.equal(at(23), UP | RIGHT);
  assert.equal(at(-22), RIGHT);
  assert.equal(at(-23), DOWN | RIGHT);
  assert.equal(at(179), LEFT);
  assert.equal(at(-179), LEFT);
  assert.equal(at(-112), DOWN);
  assert.equal(at(-113), DOWN | LEFT);
});
