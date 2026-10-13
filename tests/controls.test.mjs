/**
 * The buttons as each controller names them: an Xbox pad's and a Nintendo pad's letters for the
 * face buttons in their places (the bottom one is the cross), the touch pad's numbers, a
 * keyboard's keys; and the lines that name START (or the select button alone) as a keyboard
 * player reads them, by the player the line names or the one who last pressed anything.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Bit, buttonName, controlWords, originalGlyph, PLAYSTATION } from '../src/present/2d/controls.ts';

const keyboard = { kind: 'keyboard', keys: { [Bit.SQUARE]: 'U', [Bit.CROSS]: 'J', [Bit.START]: 'ENTER', [Bit.SELECT]: 'BACKSPACE' } };
const xbox = { kind: 'xbox', keys: {} };

test('each controller names the pad\'s buttons as it has them', () => {
  assert.equal(buttonName(xbox, Bit.CROSS), 'A');
  assert.equal(buttonName(xbox, Bit.TRIANGLE), 'Y');
  assert.equal(buttonName(xbox, Bit.L2), 'LT');
  assert.equal(buttonName({ kind: 'nintendo', keys: {} }, Bit.CROSS), 'B');
  assert.equal(buttonName({ kind: 'nintendo', keys: {} }, Bit.CIRCLE), 'A');
  assert.equal(buttonName({ kind: 'touch', keys: {} }, Bit.SQUARE), '1');
  assert.equal(buttonName({ kind: 'touch', keys: {} }, Bit.R1), '', 'the touch pad has no shoulders');
  assert.equal(buttonName(keyboard, Bit.SQUARE), 'U');
  assert.ok(originalGlyph(PLAYSTATION, Bit.CIRCLE), "a PlayStation pad's face buttons as the game draws them");
  assert.ok(!originalGlyph(xbox, Bit.CIRCLE));
});

test('a keyboard player reads START as its key, other players as the game prints it', () => {
  const players = { players: [keyboard, xbox], last: 0 };
  assert.equal(controlWords('PUSH P1 START BUTTON', players), 'PUSH P1 ENTER KEY');
  assert.equal(controlWords('PUSH P2 START', players), 'PUSH P2 START', "the second player's pad");
  assert.equal(controlWords(': PUSH START', players), ': PUSH ENTER', 'the last to press anything');
  assert.equal(controlWords(': PUSH START', { ...players, last: 1 }), ': PUSH START');
  assert.equal(controlWords('SELECT', players), 'BACKSPACE', 'the select button alone');
  assert.equal(controlWords('PLAYER SELECT', players), 'PLAYER SELECT', "a screen's name");
  assert.equal(controlWords('BGM SELECT', players), 'BGM SELECT');
});
