/**
 * Mokujin on the imported data: each round he plays the moveset of a character drawn at random
 * from those earned he may copy (the first fourteen and Gun Jack), both sides' moves bound again
 * for the round, and he fights with them.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadFightTables, loadMoveset } from '../src/assets/load.ts';
import { Fight } from '../src/sim/fight/fight.ts';
import { drawnMovesets, fightDataFor, matchMovesets, MOKUJIN, MOKUJIN_DRAWS } from '../src/sim/fight/match.ts';
import { startRoundOfMatch } from '../src/sim/fight/start.ts';

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
const imported = existsSync(path.join(assets, 'manifest.json'));
const skip = !imported && 'no imported data; run npm run extract and npm run import';
const json = async (name) => JSON.parse(readFileSync(path.join(assets, name), 'utf8'));
const two = (n) => String(n).padStart(2, '0');

test('Mokujin draws a moveset each round from those he may copy, and fights with it', { skip }, async () => {
  const { tables } = await loadFightTables(json);
  const setup = { stage: 2, entrants: [{ roster: MOKUJIN, costume: 0, computer: true }, { roster: 0, costume: 0, computer: true }], draws: MOKUJIN_DRAWS };
  const ids = new Set([...matchMovesets(tables, setup).filter((id) => 0 <= id), ...drawnMovesets(tables, MOKUJIN_DRAWS)]);
  const loaded = new Map();
  for (const id of ids) loaded.set(id, await loadMoveset(json, two(id)));
  const data = fightDataFor(tables, setup, (id) => loaded.get(id), await loadMoveset(json, 'common'));
  const fight = Fight.quick(data, setup);
  const [mokujin, paul] = fight.state.fighters;
  const allowed = new Set(drawnMovesets(tables, MOKUJIN_DRAWS));
  const drawn = new Set();
  for (let round = 0; round < 12; round += 1) {
    fight.state.round.number = round + 1;
    startRoundOfMatch(fight.state, data);
    assert.ok(allowed.has(mokujin.character), `round ${round} drew moveset ${mokujin.character}`);
    assert.equal(data.sets[0], loaded.get(mokujin.character), 'his moves bound to the drawn moveset');
    drawn.add(mokujin.character);
  }
  assert.ok(3 < drawn.size, `the draws vary: ${[...drawn].join(' ')}`);
  for (let field = 0; field < 600; field += 1) fight.field([0, 0]);
  assert.ok(0 < fight.state.fighters[0].health, 'the fight runs');
});

/** A Versus game set up as an online match's start leaves it, Mokujin against Xiaoyu, on its own match data (as another machine's), its snapshotter told that data as it is made. */
async function mokujinVersus() {
  const { Game } = await import('../src/sim/game/game.ts');
  const { MenuMode, startMode } = await import('../src/sim/game/menu.ts');
  const { FightStep } = await import('../src/sim/game/fight-scene.ts');
  const { Scene } = await import('../src/sim/game/state.ts');
  const { StateSnapshotter } = await import('../src/net/snapshot.ts');
  const { tables, scenes } = await loadFightTables(json);
  const manifest = await json('manifest.json');
  const movesets = new Map();
  for (const id of manifest.movesets) movesets.set(id, await loadMoveset(json, two(id)));
  const common = await loadMoveset(json, 'common');
  const made = new Map();
  let snapshotter = null;
  const fightData = (setup) => {
    const key = `${matchMovesets(tables, setup).join(' ')} ${setup.draws ?? 0}`;
    if (!made.has(key)) {
      made.set(key, fightDataFor(tables, setup, (id) => movesets.get(id), common));
      snapshotter?.share(made.get(key));
    }
    return made.get(key);
  };
  const game = new Game({ tables, scenes, fightData, introData: () => assert.fail('no intro plays') });
  snapshotter = new StateSnapshotter(game.state, ['remake', 'online']);
  snapshotter.share(tables);
  snapshotter.share(scenes);
  const state = game.state;
  startMode(state, MenuMode.VERSUS, 1);
  [[MOKUJIN, 0], [7, 1]].forEach(([roster, costume], n) => {
    state.entrants.roster[n] = roster;
    state.entrants.costume[n] = costume;
    state.entrants.chosen[n] = 1;
    state.entrants.computer[n] = 0;
  });
  state.run.online = 1;
  state.world.options.rounds = 2;
  state.world.match.online = 1;
  Object.assign(state, { scene: Scene.FIGHT, step: FightStep.MODE_SETUP });
  return { game, state, snapshotter };
}

/** Both pads: stepping in, punching and kicking, each its own way. */
const pads = (field) => [[0x2000, 0x40, 0, 0x8000, 0x80, 0x10, 0, 0x20][Math.floor(field / 7) % 8], [0, 0x10, 0x4000, 0, 0x80, 0x40, 0x2000][Math.floor(field / 9) % 7]];

test('a Mokujin match rolled back again and again, past his draws, plays on the same as one played straight', { skip, timeout: 300_000 }, async () => {
  const straight = await mokujinVersus();
  const rolled = await mokujinVersus();
  const BACK = 7;
  const slots = new Map();
  const characters = new Set();
  let crossed = 0;
  for (let field = 0; field < 2400; field += 1) {
    straight.game.field(pads(field));
    slots.set(field, rolled.snapshotter.create());
    rolled.snapshotter.save(slots.get(field));
    rolled.game.field(pads(field));
    if (field >= BACK && field % 5 === 0) {
      /* Back to the state before an earlier field, and every field since played again with the same presses. */
      const before = rolled.state.world.fighters[0].character;
      rolled.snapshotter.restore(slots.get(field - BACK));
      if (rolled.state.world.fighters[0].character !== before) crossed += 1;
      for (let again = field - BACK; again <= field; again += 1) {
        rolled.snapshotter.save(slots.get(again));
        rolled.game.field(pads(again));
      }
    }
    slots.delete(field - 2 * BACK);
    characters.add(straight.state.world.fighters[0].character);
    assert.equal(rolled.snapshotter.digestNow(), straight.snapshotter.digestNow(), `the same game after field ${field} (scene ${straight.state.scene}/${straight.state.step})`);
  }
  assert.ok(characters.size >= 2, `Mokujin drew: ${[...characters].join(' ')}`);
  assert.ok(crossed > 0, 'a rollback went back past a draw');
});
