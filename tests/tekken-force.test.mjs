/**
 * Tekken Force on the imported data: a stage's script brings the soldiers on as the camera moves,
 * the player's kills add time and score, the boss is loaded between two held pictures, his fall
 * clears the stage and the tally adds its bonuses before the next stage's versus screen; the fourth
 * stage's clear wins a key (kept with the records) or, with three held, opens the final stage
 * against Dr. B, whose clear earns him; a run lost is game over, its best score kept. And, on
 * synthetic tables, who the stages bring.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadFightTables, loadMoveset } from '../src/assets/load.ts';
import { bossCode, soldierCode, StageState, stageCodes } from '../src/sim/fight/force-stage.ts';
import { fightDataFor } from '../src/sim/fight/match.ts';
import { FightStep } from '../src/sim/game/fight-scene.ts';
import { Game } from '../src/sim/game/game.ts';
import { MenuMode, startMode } from '../src/sim/game/menu.ts';
import { Scene } from '../src/sim/game/state.ts';

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
const manifest = existsSync(path.join(assets, 'manifest.json')) ? JSON.parse(readFileSync(path.join(assets, 'manifest.json'), 'utf8')) : {};
const imported = Array.isArray(manifest.movesets) && manifest.movesets.length > 0;
const skip = !imported && 'no imported data; run npm run extract and npm run import';
const json = async (name) => JSON.parse(readFileSync(path.join(assets, name), 'utf8'));
const two = (n) => String(n).padStart(2, '0');

const PAD = { right: 0x2000, left: 0x8000, square: 0x80, cross: 0x40 };
const DR_B = 1 << 0x13;
const FLOW = { FIGHTING: 1, STAGE_CLEAR: 8 };

/** A game in Tekken Force with every character but Dr. B earned, at the character select, the keys held as given. */
async function force(keys = 0) {
  const { tables, scenes } = await loadFightTables(json);
  const movesets = new Map();
  for (const id of manifest.movesets) movesets.set(id, await loadMoveset(json, two(id)));
  const common = await loadMoveset(json, 'common');
  const game = new Game({ tables, scenes, fightData: (setup) => fightDataFor(tables, setup, (id) => movesets.get(id), common), introData: () => assert.fail('no intro plays') });
  const state = game.state;
  state.records.earnedRoster = 0x1fffff & ~DR_B;
  state.records.forceKeys = keys;
  startMode(state, MenuMode.TEKKEN_FORCE, 1);
  return { game, state, tables };
}

/**
 * A field of play: in the fight a player who walks at its target and attacks, its health and the
 * timer kept up when `strong`; elsewhere a button now and then.
 */
function play(game, field, strong) {
  const state = game.state;
  const world = state.world;
  let pad = 0;
  if (state.scene === Scene.FIGHT && state.step === FightStep.FIGHTING) {
    const p = world.fighters[0];
    const t = world.fighters[p.target];
    pad = t.present !== 0 && t.skeleton.base.translation[0] < p.skeleton.base.translation[0] - 400 ? PAD.left : PAD.right;
    if (field % 9 === 0) pad |= PAD.square;
    else if (field % 9 === 4) pad |= PAD.cross;
    if (strong) {
      p.health = p.maxHealth;
      if (world.timer < 1200) world.timer = 3000;
    }
  } else if (field % 30 === 0) pad = PAD.square;
  game.field([pad, 0]);
}

test('a stage: the script brings soldiers on, the boss comes between two held pictures, the clear tallies its bonuses', { skip }, async () => {
  const { game, state, tables } = await force();
  const world = state.world;
  const seen = { kills: 0, held: [], boss: null, loading: false, stageClear: false, tally: null };
  for (let field = 0; field < 20000 && !(state.scene === Scene.VERSUS && world.match.stage === 1); field += 1) {
    const before = world.match.force.kills;
    const timer = world.timer;
    play(game, field, true);
    if (world.match.force.kills > before) {
      seen.kills += 1;
      assert.equal(world.timer % 60, 59, 'a kill rounds the timer to its second and adds its seconds');
      assert.ok(world.timer > timer);
    }
    if (state.step === FightStep.FORCE_HOLD || state.step === FightStep.FORCE_SHOW || state.step === FightStep.FORCE_BOSS) seen.held.push(state.step);
    seen.loading ||= world.hud.prints.some((p) => p.text === 'NOW LOADING...');
    if (seen.boss === null && world.force.bossPhase !== 0) seen.boss = world.fighters[1].rosterCode;
    seen.stageClear ||= world.round.flow === FLOW.STAGE_CLEAR;
    if (world.force.state === StageState.TALLY && world.force.count === 60) seen.tally = { score: world.force.score, clear: world.force.clearBonus };
  }
  assert.ok(seen.kills > 0, 'the player beat soldiers');
  assert.ok(seen.loading, 'NOW LOADING... as the boss is asked for');
  assert.deepEqual(seen.held, [FightStep.FORCE_HOLD, FightStep.FORCE_SHOW, FightStep.FORCE_BOSS], 'the boss arrives through the held pictures, a field each');
  const human = state.entrants.roster[0] * 4 + state.entrants.costume[0];
  assert.equal(seen.boss, bossCode(tables, human, 0), "the stage's boss for the player's character");
  assert.equal(world.match.force.bosses[0], seen.boss, 'kept with the run');
  assert.ok(seen.stageClear, 'STAGE CLEAR');
  assert.equal(seen.tally.clear, 130 * 100, 'the clear bonus: the health left, a hundred a point');
  assert.equal(state.scene, Scene.VERSUS, "on to the next stage's versus screen");
  assert.equal(world.stage, 0x10, 'Badlands');
});

test("the fourth stage's clear wins a key; with three held it opens the final stage, whose clear earns Dr. B", { skip }, async () => {
  for (const keys of [0, 3]) {
    const { game, state } = await force(keys);
    const world = state.world;
    let jumped = false;
    for (let field = 0; field < 60000 && state.scene !== Scene.FORCE_RESULTS; field += 1) {
      if (!jumped && state.scene === Scene.FIGHT && state.step === FightStep.MATCH) {
        world.match.stage = 3;
        jumped = true;
      }
      play(game, field, true);
    }
    assert.equal(state.scene, Scene.FORCE_RESULTS, 'the run ends in the results');
    if (keys === 0) {
      assert.equal(state.records.forceKeys, 1, 'a key kept with the records');
      assert.equal(world.match.force.flags & 7, 1, 'the copper key');
      assert.equal((state.records.earnedRoster & DR_B) !== 0, false);
    } else {
      assert.equal(world.match.stage, 5, 'the final stage was fought');
      assert.equal(world.match.force.flags & 8, 8, 'and cleared');
      assert.notEqual(state.records.earnedRoster & DR_B, 0, 'Dr. B earned');
    }
    assert.equal(state.records.forceBest, world.force.best, 'the best score kept');
  }
});

test('a run lost is game over, its best score kept', { skip }, async () => {
  const { game, state } = await force();
  const world = state.world;
  let over = false;
  for (let field = 0; field < 20000 && !over; field += 1) {
    play(game, field, false);
    if (state.scene === Scene.FIGHT && state.step === FightStep.GAME_OVER_SHOWN) over = true;
  }
  assert.ok(over, 'game over');
  assert.equal(state.records.forceBest, world.force.best);
  assert.equal(world.joined[0], 0);
});

/** Synthetic tables: the soldiers' costumes by stage, and a boss row naming a costume and one by the player's. */
const TABLES = {
  force: {
    costumes: [
      [0, 1],
      [0, 2],
      [1, 2],
      [2, 3],
      [2, 3],
      [0, 0],
    ],
    bosses: Array.from({ length: 0x5c }, (_, code) =>
      code >> 2 === 2
        ? [
            [2, -1],
            [5, -1],
            [7, 1],
            [13, -1],
          ]
        : [
            [1, -1],
            [11, 0],
            [9, -1],
            [13, -1],
          ],
    ),
  },
};

test('who a stage brings: its two soldier types, its boss by the player, Dr. B on the final stage', () => {
  assert.equal(soldierCode(TABLES, 0, 0), 0x54);
  assert.equal(soldierCode(TABLES, 3, 1), 0x57);
  assert.equal(soldierCode(TABLES, 4, 1), 0x55, "the final stage reads the first's");
  assert.equal(bossCode(TABLES, 0x01, 0), 1 * 4 + 1, "another character: the second costume when the player wears any but the first");
  assert.equal(bossCode(TABLES, 0x00, 0), 1 * 4 + 0);
  assert.equal(bossCode(TABLES, 0x08, 0), 2 * 4 + 1, 'the same character: the other costume');
  assert.equal(bossCode(TABLES, 0x09, 0), 2 * 4 + 0);
  assert.equal(bossCode(TABLES, 0x09, 2), 7 * 4 + 1, "the table's own costume");
  assert.deepEqual(stageCodes(TABLES, 0x00, 1), [0x54, 0x56, 11 * 4]);
  assert.deepEqual(stageCodes(TABLES, 0x00, 4), [0x13 * 4]);
});
