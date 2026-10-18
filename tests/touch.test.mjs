/** The touch pad's stick: eight ways around where the thumb landed, none within the dead zone; and where the pad shows, by TOUCH PAD, the device and the gamepads. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DOWN, LEFT, RIGHT, UP } from '../src/app/input.ts';
import { stickWord, touchShown } from '../src/app/touch.ts';

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

/** TOUCH PAD's choices, as the address and REMAKE OPTION give them. */
const AUTO = null;
const ON = '1';
const OFF = '0';
const PHONE = { phone: true, touchScreen: true };
const TOUCH_COMPUTER = { phone: false, touchScreen: true };
const COMPUTER = { phone: false, touchScreen: false };

test('on a phone with no gamepad the touch pad shows whatever TOUCH PAD says, so the game can always be played', () => {
  for (const choice of [AUTO, ON, OFF]) assert.equal(touchShown(choice, PHONE, false), true, String(choice));
});

test('on a phone with a gamepad connected, AUTO and OFF hide the touch pad and ON keeps it', () => {
  assert.equal(touchShown(AUTO, PHONE, true), false);
  assert.equal(touchShown(OFF, PHONE, true), false);
  assert.equal(touchShown(ON, PHONE, true), true);
});

test('on a computer with a touch screen, AUTO shows the touch pad while no gamepad is connected and OFF never does', () => {
  assert.equal(touchShown(AUTO, TOUCH_COMPUTER, false), true);
  assert.equal(touchShown(AUTO, TOUCH_COMPUTER, true), false);
  assert.equal(touchShown(OFF, TOUCH_COMPUTER, false), false);
  assert.equal(touchShown(ON, TOUCH_COMPUTER, true), true);
});

test('on a computer without a touch screen the touch pad shows only where TOUCH PAD is ON', () => {
  for (const gamepad of [false, true]) {
    assert.equal(touchShown(AUTO, COMPUTER, gamepad), false);
    assert.equal(touchShown(OFF, COMPUTER, gamepad), false);
    assert.equal(touchShown(ON, COMPUTER, gamepad), true);
  }
});
