/**
 * Team Battle on the imported data: on the versus select a side sets its team's size and chooses
 * its members (start ends the choosing); the rest are drawn as the run starts; each bout sends in
 * the two teams' next members, its loser's team moving on, until one has none left; then its
 * results show every bout and go on to the records.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadFightTables } from '../src/assets/load.ts';
import { FightStep, teamResult } from '../src/sim/game/fight-scene.ts';
import { Game } from '../src/sim/game/game.ts';
import { MenuMode, startMode } from '../src/sim/game/menu.ts';
import { Scene } from '../src/sim/game/state.ts';
import { teamRound, teamStart } from '../src/sim/game/team.ts';
import { VsSideState } from '../src/sim/game/vs-select.ts';

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
const imported = existsSync(path.join(assets, 'manifest.json'));
const skip = !imported && 'no imported data; run npm run extract and npm run import';
const json = async (name) => JSON.parse(readFileSync(path.join(assets, name), 'utf8'));

const PAD = { right: 0x2000, left: 0x8000, square: 0x80, cross: 0x40, start: 0x800 };

/** Each pad's buttons pressed for a field, then let go for one. */
function press(game, first, second = 0) {
  game.field([first, second]);
  game.field([0, 0]);
}

async function teamBattle() {
  const { tables, scenes } = await loadFightTables(json);
  const game = new Game({ tables, scenes, fightData: () => null, introData: () => assert.fail('no intro plays') });
  const state = game.state;
  state.records.earnedRoster = 0x1fffff;
  startMode(state, MenuMode.TEAM_BATTLE, 1);
  state.options.lastChoices.fill(0xfc);
  return { game, state, scenes };
}

test('on the versus select a side sets its team\'s size and chooses its members; the computer\'s team takes its size', { skip }, async () => {
  const { game, state } = await teamBattle();
  for (let field = 0; field < 200 && !(state.scene === Scene.VS_SELECT && state.step === 2); field += 1) game.field([0, 0]);
  const [human, computer] = state.vsSelect.sides;
  assert.equal(human.state, VsSideState.TEAM_SIZE);
  assert.equal(computer.state, VsSideState.TEAM_COMPUTER);
  press(game, PAD.right);
  press(game, PAD.right);
  assert.equal(human.teamSize, 6);
  press(game, PAD.square);
  assert.equal(human.state, VsSideState.TEAM_CHOOSING);
  press(game, PAD.square);
  press(game, PAD.right);
  press(game, PAD.square);
  assert.equal(human.count, 2, 'two chosen');
  press(game, PAD.start);
  for (let field = 0; field < 200 && !(state.scene === Scene.VERSUS && 1 < state.step); field += 1) game.field([0, 0]);
  assert.equal(state.scene, Scene.VERSUS);
  const [ours, theirs] = state.world.match.teams;
  assert.equal(ours.size, 6);
  assert.equal(ours.chosen, 2);
  assert.equal(theirs.size, 6, 'the computer\'s team as big');
  const rosters = ours.members.slice(0, 6).map((code) => code >> 2);
  assert.equal(new Set(rosters).size, 6, `six different members: ${rosters.join(' ')}`);
  assert.equal(state.entrants.roster[0], ours.members[0] >> 2, 'the first member sent in');
  assert.equal(state.entrants.computer[1], 1);
  assert.ok(state.versus.records.some((r) => r.kind === 'teamIcon'), 'the teams\' rows');
});

test('each bout moves its loser\'s team on until one has none left, then the results show every bout', { skip }, async () => {
  const { game, state, scenes } = await teamBattle();
  const [ours, theirs] = state.world.match.teams;
  Object.assign(ours, { size: 2, chosen: 0, kick: 0 });
  state.world.joined[1] = 0;
  Object.assign(state.world.match, { humanSide: 0, humanCount: 1, computerSide: 1, humanSides: 1 });
  teamStart(state);
  const winners = [1, 2, 3];
  for (const [bout, winner] of winners.entries()) {
    teamRound(state);
    assert.equal(state.entrants.roster[0], ours.members[ours.next] >> 2);
    Object.assign(state.world.match, { winner, winnerSide: winner === 2 ? 1 : 0, loserSide: winner === 2 ? 0 : 1 });
    teamResult(state, scenes);
    if (bout < winners.length - 1) assert.equal(state.step, FightStep.MATCH);
  }
  assert.equal(theirs.size, 2, 'the computer\'s team as big as the human\'s');
  assert.equal(theirs.kick, 1, 'in the other costume');
  assert.deepEqual([ours.next, theirs.next], [2, 2], 'both teams out of members');
  assert.deepEqual(state.run.team.bouts.slice(0, 3), winners);
  for (let field = 0; field < 10 && state.scene !== Scene.TEAM_RESULTS; field += 1) game.field([0, 0]);
  assert.equal(state.scene, Scene.TEAM_RESULTS);
  for (let field = 0; field < 4000 && state.scene === Scene.TEAM_RESULTS; field += 1) game.field([0, 0]);
  assert.equal(state.results.shown, 3, 'every bout shown');
  assert.deepEqual(state.results.left, [0, 0]);
  assert.equal(state.scene, Scene.RECORDS_LOADER);
});
