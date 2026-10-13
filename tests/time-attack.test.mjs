/**
 * Time Attack's run on the imported data: each win keeps its stage's time and goes on to the next,
 * a loss offers the continue; past the tenth the run's total is checked against the character's
 * best and its results count up each stage in turn, show the total, and fade out to the records.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadFightTables } from '../src/assets/load.ts';
import { FightStep, timeAttackResult } from '../src/sim/game/fight-scene.ts';
import { Game } from '../src/sim/game/game.ts';
import { MenuMode } from '../src/sim/game/menu.ts';
import { rowTime } from '../src/sim/game/results.ts';
import { Scene } from '../src/sim/game/state.ts';

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
const imported = existsSync(path.join(assets, 'manifest.json'));
const skip = !imported && 'no imported data; run npm run extract and npm run import';
const json = async (name) => JSON.parse(readFileSync(path.join(assets, name), 'utf8'));

const START = 0x800;
const ROSTER = 9;
/** Each stage won in 30 seconds and a bit more each time. */
const stageFrames = (stage) => 1800 + stage * 7;

/** A game in Time Attack's last match, its human on the first side, every stage before it won. */
async function lastMatch() {
  const { tables, scenes } = await loadFightTables(json);
  const game = new Game({ tables, scenes, fightData: () => null, introData: () => assert.fail('no intro plays') });
  const state = game.state;
  state.world.mode = MenuMode.TIME_ATTACK;
  Object.assign(state.entrants, { roster: [ROSTER, 3], costume: [1, 0], chosen: [1, 1], computer: [0, 1] });
  state.world.joined[0] = 1;
  Object.assign(state.world.match, { humanSide: 0, humanCount: 1, winnerSide: 0, loserSide: 1, winner: 1 });
  for (let stage = 0; stage < 9; stage += 1) Object.assign(state.run.stageTimes[stage], { side: 0, roster: ROSTER, costume: 1, frames: stageFrames(stage) });
  state.world.match.stage = 9;
  state.world.match.fightFrames = stageFrames(9);
  return { game, state, scenes };
}

test('a win keeps the stage\'s time and goes on; a loss offers the continue', { skip }, async () => {
  const { state, scenes } = await lastMatch();
  state.world.match.stage = 3;
  timeAttackResult(state, scenes);
  assert.equal(state.step, FightStep.MATCH);
  assert.equal(state.world.match.stage, 4);
  assert.equal(state.run.stageTimes[3].frames, stageFrames(9));
  Object.assign(state.world.match, { winnerSide: 1, loserSide: 0 });
  timeAttackResult(state, scenes);
  assert.equal(state.step, FightStep.CONTINUE);
  assert.equal(state.world.joined[0], 0);
});

test('past the tenth stage the results count each stage up, show the total and go on to the records', { skip }, async () => {
  const { game, state, scenes } = await lastMatch();
  const best = state.records.times[ROSTER].frames;
  timeAttackResult(state, scenes);
  const total = Array.from({ length: 10 }, (_, k) => stageFrames(k)).reduce((a, b) => a + b, 0);
  assert.ok(total < best, 'the run beats the best time the game starts with');
  assert.equal(state.records.times[ROSTER].frames, total, 'a new best');
  for (let field = 0; field < 10 && state.scene !== Scene.TIME_RESULTS; field += 1) game.field([0, 0]);
  assert.equal(state.scene, Scene.TIME_RESULTS);
  const seen = new Set();
  let shownTotal = false;
  let fields = 0;
  for (; fields < 6000 && state.scene === Scene.TIME_RESULTS; fields += 1) {
    game.field([0, 0]);
    if (state.results.counting !== 0) assert.ok(rowTime(state, state.results.shown) <= stageFrames(state.results.shown), 'a stage counts up to its time');
    seen.add(state.results.shown);
    if (state.results.showTotal !== 0) shownTotal = true;
    if (state.results.showTotal !== 0 && fields === 400) assert.ok(state.printed.some((run) => run.text === 'NEW RECORD'), 'a new record shown');
  }
  assert.ok(seen.has(10), 'every stage counted');
  assert.ok(shownTotal, 'the total shown');
  assert.equal(state.results.total, total);
  assert.equal(state.scene, Scene.RECORDS_LOADER, 'on to the records');
});

test('start skips the results to their end', { skip }, async () => {
  const { game, state, scenes } = await lastMatch();
  timeAttackResult(state, scenes);
  for (let field = 0; field < 40 && !(state.scene === Scene.TIME_RESULTS && state.step === 2); field += 1) game.field([0, 0]);
  game.field([START, 0]);
  let fields = 0;
  for (; fields < 200 && state.scene === Scene.TIME_RESULTS; fields += 1) game.field([0, 0]);
  assert.equal(state.scene, Scene.RECORDS_LOADER);
  assert.ok(fields < 80, `faded out ${fields} fields after start`);
});
