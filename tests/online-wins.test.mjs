/** The waiting room's corner: the server's counts at the foot of the screen, this player's streak of wins over them, what is waited for over both, each set to the right; and in a match, each player's streak where the game prints a Versus streak. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { layOutHud } from '../src/present/hud/hud-layout.ts';
import { blankFightState } from '../src/sim/fight/blank.ts';
import { OnlineStatus, warmUpFrame } from '../src/sim/game/online-page.ts';
import { blankGameState } from '../src/sim/game/state.ts';

const CENTRE = 320;
const ADVANCE = 9;

/** The waiting room's fight with the quick match searching, its corner as `online` has it: the lines printed there, by text, with where each starts and stands. */
function corner(online) {
  const game = blankGameState();
  Object.assign(game.online, { warming: 2, status: OnlineStatus.QUEUED, lines: ['SEARCHING', ''] }, online);
  assert.equal(warmUpFrame(game, {}, CENTRE, 'fight'), null, 'the practice plays on');
  return Object.fromEntries(game.printed.map((run) => [run.text.trim(), { x: run.x, y: run.y }]));
}

const right = (text) => CENTRE * 2 - 12 - text.length * ADVANCE;

test("the waiting room's corner shows this player's streak of wins over the server's counts, what is waited for over both", () => {
  const lines = corner({ players: '3 PLAYERS ONLINE', wins: 'WINS 3' });
  assert.deepEqual(lines['3 PLAYERS ONLINE'], { x: right('3 PLAYERS ONLINE'), y: 434 });
  assert.deepEqual(lines['WINS 3'], { x: right('WINS 3'), y: 416 });
  assert.equal(lines['SEARCHING'].y, 398);
});

test("without a streak (none yet, or a server that counts none) the corner is as it was", () => {
  const lines = corner({ players: '3 PLAYERS ONLINE', wins: '' });
  assert.equal(lines['WINS 3'], undefined);
  assert.deepEqual(lines['3 PLAYERS ONLINE'], { x: right('3 PLAYERS ONLINE'), y: 434 });
  assert.equal(lines['SEARCHING'].y, 416);
  assert.equal(corner({ players: '', wins: '' })['SEARCHING'].y, 434, 'nothing heard from the server: the line at the foot');
});

test("in an online match each player's streak shows as the game shows a Versus streak: WIN:1 or WINS:n at the foot under its side, mirrored with the fight, the names under the fighters' alone", () => {
  const state = blankFightState();
  state.hud.back = 1;
  state.hud.shown = 1;
  const laid = (swapped, streaks) => layOutHud(state, ['A', 'B'], undefined, swapped, ['ALPHA', 'BRAVO'], streaks);
  const calls = (swapped, streaks) => laid(swapped, streaks).front.filter((p) => p.piece.kind === 'call').map((p) => ({ text: p.piece.text, x: p.x, y: p.y, font: p.piece.font, colour: p.piece.colour }));
  assert.deepEqual(calls(false, [3, 0]), [{ text: 'WINS:3', x: 12, y: 0x1b0, font: 1, colour: 8 }], 'the first side, at the foot on the left');
  assert.deepEqual(calls(false, [0, 1]), [{ text: 'WIN:1', x: 291, y: 0x1b0, font: 1, colour: 8 }], 'the second, on the right, one win');
  assert.deepEqual(calls(false, [12, 4]).map(({ text, x }) => [text, x]).sort(), [['WINS:12', 12], ['WINS:4', 278]], 'both, each set by its digits');
  assert.deepEqual(calls(true, [3, 0]).map(({ text, x }) => [text, x]), [['WINS:3', 384 - 12 - (5 * 13 + 14)]], 'mirrored, the first side on the right');
  assert.deepEqual(calls(false, null), [], 'none outside a match');
  state.hud.shown = 0;
  assert.deepEqual(calls(false, [3, 1]), [], 'none while the HUD is not shown, as the game shows its own');
  state.hud.shown = 1;
  const tags = laid(false, [3, 1]).back.filter((p) => p.piece.kind === 'player').map((p) => p.piece.text);
  assert.deepEqual(tags.sort(), ['ALPHA', 'BRAVO'], 'the names as given');
});
