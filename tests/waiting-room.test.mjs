/** The waiting room left another way than its pause menu's: back to ONLINE MODE's page, what was waited for cancelled, so no other mode is played still searching. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { goToLogo } from '../src/sim/game/logo.ts';
import { OnlineStatus, warmUpFrame } from '../src/sim/game/online-page.ts';
import { blankGameState, Scene } from '../src/sim/game/state.ts';

test("the waiting room's practice reset to the mode menu (Practice's RESET) leaves the waiting room: the search cancelled, ONLINE MODE's page shown again", () => {
  const game = blankGameState();
  Object.assign(game.online, { warming: 2, status: OnlineStatus.QUEUED, lines: ['SEARCHING FOR AN OPPONENT', ''] });
  game.scene = Scene.FIGHT;
  assert.equal(warmUpFrame(game, {}, 320, 'fight'), null, 'the practice plays on');
  /* Practice's RESET, as the fight's last step does it. */
  goToLogo(game, Scene.MENU);
  assert.equal(warmUpFrame(game, {}, 320, 'other'), 'leave', 'left on the field it happens, before the mode menu shows');
  assert.deepEqual([game.online.warming, game.online.ask, game.online.opens], [0, 'cancel', 1], 'nothing waited for any more, the search cancelled, the page to open');
});
