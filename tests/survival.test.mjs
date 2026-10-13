/**
 * Survival on the imported data: each match meets one of the characters beaten least, never one of
 * the last four; a win counts the opponent beaten and the next comes, the human's health carried
 * over with some back; a loss checks the run against the records and its results count up each
 * character beaten, the total, and the run's place, then go on to the records.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadFightTables } from '../src/assets/load.ts';
import { survivalRound, survivorRank } from '../src/sim/game/arcade.ts';
import { FightStep, survivalResult } from '../src/sim/game/fight-scene.ts';
import { Game } from '../src/sim/game/game.ts';
import { MenuMode, startMode } from '../src/sim/game/menu.ts';
import { beatenShown } from '../src/sim/game/results.ts';
import { Scene } from '../src/sim/game/state.ts';

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
const imported = existsSync(path.join(assets, 'manifest.json'));
const skip = !imported && 'no imported data; run npm run extract and npm run import';
const json = async (name) => JSON.parse(readFileSync(path.join(assets, name), 'utf8'));

const ROSTER = 5;

/** A game in Survival, its human on the first side playing `ROSTER`. */
async function survival() {
  const { tables, scenes } = await loadFightTables(json);
  const game = new Game({ tables, scenes, fightData: () => null, introData: () => assert.fail('no intro plays') });
  const state = game.state;
  startMode(state, MenuMode.SURVIVAL, 1);
  Object.assign(state.entrants, { roster: [ROSTER, 0x16], costume: [0, 0], chosen: [1, 0], computer: [0, 0] });
  Object.assign(state.world.match, { humanSide: 0, humanCount: 1, computerSide: 1 });
  return { game, state, scenes };
}

/** One match won against whoever came. */
function win(state, scenes) {
  Object.assign(state.world.match, { winnerSide: 0, loserSide: 1, winner: 1 });
  survivalResult(state, scenes);
}

test('each opponent is one of those beaten least, never one of the last four', { skip }, async () => {
  const { state, scenes } = await survival();
  const met = [];
  for (let match = 0; match < 40; match += 1) {
    survivalRound(state);
    const roster = state.entrants.roster[1];
    assert.ok(!met.slice(-4).includes(roster), `match ${match} met ${roster} again within four`);
    assert.equal(state.entrants.computer[1], 1);
    if (match < 7) assert.ok(roster < 10, 'the first ten to begin with');
    met.push(roster);
    win(state, scenes);
    assert.equal(state.step, FightStep.MATCH);
  }
  const beaten = state.run.survival.beaten;
  assert.equal(state.world.match.survivalWins, 40);
  assert.equal(beaten.reduce((a, b) => a + b, 0), 40);
  const counts = beaten.filter((_, roster) => (0x3ff & (1 << roster)) !== 0);
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 4, `the first ten beaten evenly: ${counts.join(' ')}`);
  assert.equal(state.world.match.streak, 40);
});

test('a loss ends the run: its wins checked against the records, its results counted up, then the records', { skip }, async () => {
  const { game, state, scenes } = await survival();
  for (let match = 0; match < 12; match += 1) {
    survivalRound(state);
    win(state, scenes);
  }
  survivalRound(state);
  assert.equal(state.world.match.survivalRank, survivorRank(state, 12));
  Object.assign(state.world.match, { winnerSide: 1, loserSide: 0, winner: 2 });
  survivalResult(state, scenes);
  assert.equal(state.run.ending.code, ROSTER << 2);
  for (let field = 0; field < 10 && state.scene !== Scene.SURVIVAL_RESULTS; field += 1) game.field([0, 0]);
  assert.equal(state.scene, Scene.SURVIVAL_RESULTS);
  let fields = 0;
  let totalShown = false;
  for (; fields < 6000 && state.scene === Scene.SURVIVAL_RESULTS; fields += 1) {
    game.field([0, 0]);
    if (state.results.shown > 0) assert.ok(beatenShown(state, 0) >= 1);
    if (state.printed.some((run) => run.text === 'TOTAL')) totalShown = true;
  }
  assert.ok(totalShown, 'the total shown');
  assert.equal(state.results.total, 12, 'every win counted up');
  assert.equal(state.scene, Scene.RECORDS_LOADER);
});
