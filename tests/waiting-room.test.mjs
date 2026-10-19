/**
 * ONLINE MODE's waiting room: left another way than its pause menu's, back to ONLINE MODE's page,
 * what was waited for cancelled, so no other mode is played still searching; and a player in it
 * offered an opponent only once their fight has been on the screen a moment, never while the
 * versus screen before it, or the dissolve from it, still shows.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Available, SHOWN_FRAMES } from '../src/app/available.ts';
import { FightStep } from '../src/sim/game/fight-scene.ts';
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

test('the waiting room says why the last match ended before its fight did, over what is waited for', () => {
  const game = blankGameState();
  Object.assign(game.online, { warming: 2, status: OnlineStatus.QUEUED, lines: ['SEARCHING FOR AN OPPONENT', ''], why: 'THE CONNECTION WAS LOST' });
  game.scene = Scene.FIGHT;
  warmUpFrame(game, {}, 320, 'fight');
  const why = game.printed.find((run) => run.text === 'THE CONNECTION WAS LOST');
  const searching = game.printed.find((run) => run.text.startsWith('SEARCHING FOR AN OPPONENT'));
  assert.ok(why !== undefined && searching !== undefined, 'both shown');
  assert.ok(why.y < searching.y, 'the reason over the search');
});

test("an opponent found sounds the game's challenger as the offer's card first shows, once", () => {
  const game = blankGameState();
  Object.assign(game.online, { warming: 2, status: OnlineStatus.QUEUED, lines: ['SEARCHING FOR AN OPPONENT', ''] });
  game.scene = Scene.FIGHT;
  const data = { sound: { volumes: new Array(16).fill(0x7f) } };
  /* The challenger's sound (0x49a1) as the sound driver is told it: on its voice, bank, program and tone. */
  const challenger = () => game.world.sound.commands.filter((c) => c.key === 'on' && c.voice === 2 && c.bank === 0 && c.program === 2 && c.tone === 1).length;
  warmUpFrame(game, data, 320, 'fight');
  assert.equal(challenger(), 0, 'nothing while searching');
  Object.assign(game.online, { status: OnlineStatus.OFFERED, lines: ['OPPONENT FOUND', 'GUEST'] });
  for (let frame = 0; frame < 30; frame += 1) warmUpFrame(game, data, 320, 'fight');
  assert.equal(challenger(), 1, 'as the card shows, once');
  Object.assign(game.online, { status: OnlineStatus.GREETING });
  warmUpFrame(game, data, 320, 'fight');
  assert.equal(challenger(), 1, 'not again as the match starts');
});

test("a player in the waiting room's fight is available once that fight has been drawn on the screen a second running, not before: the versus screen, its dissolve, Practice's menu, a page out of sight", () => {
  const game = blankGameState();
  Object.assign(game.online, { warming: 2, status: OnlineStatus.QUEUED });
  Object.assign(game, { scene: Scene.FIGHT, step: FightStep.FIGHTING });
  const available = new Available();
  /* Frames drawn `every` milliseconds apart (a fiftieth of a second), `fight` whether each showed the fight. */
  let clock = 0;
  const draw = (frames, fight = true, every = 20) => {
    for (let frame = 0; frame < frames; frame += 1) {
      available.drawn(fight, clock);
      clock += every;
    }
  };
  assert.equal(available.now(game, true), false, 'playing, but its fight not yet on the screen (the versus screen still shown)');
  draw(50);
  assert.equal(available.now(game, true), false, 'a frame short of a second');
  draw(1);
  assert.equal(available.now(game, true), true, 'shown a second running');
  assert.equal(available.now(game, false), false, 'the page out of sight');
  game.practice.paused = 1;
  assert.equal(available.now(game, true), false, "in Practice's menu");
  game.practice.paused = 0;
  game.step = FightStep.HOLD;
  assert.equal(available.now(game, true), false, 'loading it');
  game.step = FightStep.FIGHTING;
  draw(1, false);
  assert.equal(available.now(game, true), false, 'a frame not showing the fight (a dissolve, a held picture) starts the count again');
  /* A slow device: a second of the fight in a few frames counts; one long frame does not. */
  draw(SHOWN_FRAMES, true, 1000 / (SHOWN_FRAMES - 2));
  assert.equal(available.now(game, true), true, `a second in ${SHOWN_FRAMES} frames`);
  draw(1, false);
  draw(2, true, 2000);
  assert.equal(available.now(game, true), false, 'two frames, however long');
  Object.assign(game.online, { warming: 0 });
  draw(120);
  assert.equal(available.now(game, true), false, 'not in the waiting room');
});
