/** The waiting room's corner: the server's counts at the foot of the screen, this player's streak of wins over them, what is waited for over both, each set to the right. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

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
