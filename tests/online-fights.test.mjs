/**
 * ONLINE MODE's SPECTATE: the fights under way the server lists, each its players' names and their
 * streaks, seven at a time with a scrollbar beside them when there are more, a button watching one
 * this game can show, select going back.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { OnlineScreen, onlineFrame } from '../src/sim/game/online-page.ts';
import { blankGameState } from '../src/sim/game/state.ts';

const data = { sound: { volumes: new Array(16).fill(0x40) } };
const [DOWN, SELECT, START] = [0x4000, 0x100, 0x800];

/** A field of the page, `buttons` newly pressed: what it printed and drew. */
function field(game, buttons = 0) {
  game.printed.length = 0;
  game.drawn.length = 0;
  game.world.input.fresh[0] = buttons;
  game.pads.repeats[0] = buttons;
  const out = onlineFrame(game, data);
  game.world.input.fresh[0] = 0;
  game.pads.repeats[0] = 0;
  return { out, texts: game.printed.map((run) => run.text.trim()).filter((text) => text !== ''), tiles: game.drawn.filter((d) => d.kind === 'tile') };
}

const fights = Array.from({ length: 10 }, (_, i) => ({ code: `R${i}`, names: [`P${i}A`, `P${i}B`], wins: [i, 0], watchers: i % 3, watchable: i !== 3 }));

test("SPECTATE on ONLINE MODE's list asks for the fights under way, and shows them", () => {
  const game = blankGameState();
  const online = game.online;
  online.cursor = 4;
  const { texts } = field(game);
  assert.ok(texts.includes('SPECTATE'), 'listed');
  field(game, START);
  assert.equal(online.screen, OnlineScreen.FIGHTS);
  assert.equal(online.ask, 'fights', 'the fights asked for');
});

test('the fights: each its players and their streaks, seven at a time with a scrollbar beside them, scrolled as the cursor goes', () => {
  const game = blankGameState();
  const online = game.online;
  Object.assign(online, { screen: OnlineScreen.FIGHTS, fights });
  let shown = field(game);
  for (const text of ['P0A', 'VS', 'P0B', 'P6A', 'WINS 1']) assert.ok(shown.texts.includes(text), `${text} shown`);
  assert.ok(!shown.texts.includes('P7A'), 'seven at a time');
  assert.ok(shown.texts.includes('CANNOT WATCH'), 'one this game cannot show said so');
  const scrollbar = shown.tiles.filter((t) => t.x > 340);
  assert.ok(scrollbar.length >= 2, 'a scrollbar: its track and its thumb');
  for (let k = 0; k < 8; k += 1) shown = field(game, DOWN);
  assert.equal(online.fightCursor, 8);
  assert.ok(shown.texts.includes('P8A') && !shown.texts.includes('P0A'), 'scrolled to the cursor');
  field(game, START);
  assert.deepEqual([online.ask, online.code], ['watch', 'R8'], 'a button watches it');
});

test("a fight this game cannot show is not watched; select goes back to the list, the fights no longer asked for", () => {
  const game = blankGameState();
  const online = game.online;
  Object.assign(online, { screen: OnlineScreen.FIGHTS, fights, fightCursor: 3 });
  field(game, START);
  assert.equal(online.ask, '', 'not watched');
  field(game, SELECT);
  assert.deepEqual([online.screen, online.ask], [OnlineScreen.LIST, 'unfights']);
  const empty = blankGameState();
  Object.assign(empty.online, { screen: OnlineScreen.FIGHTS, status: 2 });
  assert.ok(field(empty).texts.includes('NO FIGHTS ARE ON'), 'none under way said so');
});
