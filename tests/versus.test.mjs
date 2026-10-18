/**
 * Versus mode on the imported data: both players choose at once on the versus select (a row's
 * ends wrap), each then sets a handicap on its gauge, and the match is set up as they chose, its
 * versus screen naming the match; a match's end counts its wins or its draw and sends both
 * players to choose again. Arcade chooses there too when start and both shoulders are held.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadFightTables } from '../src/assets/load.ts';
import { FightStep, versusResult } from '../src/sim/game/fight-scene.ts';
import { Game } from '../src/sim/game/game.ts';
import { MenuMode, startMode } from '../src/sim/game/menu.ts';
import { blankGameState, Scene } from '../src/sim/game/state.ts';
import { NO_CHOICE, VsSideState } from '../src/sim/game/vs-select.ts';

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
const imported = existsSync(path.join(assets, 'manifest.json'));
const skip = !imported && 'no imported data; run npm run extract and npm run import';
const json = async (name) => JSON.parse(readFileSync(path.join(assets, name), 'utf8'));

const PAD = { up: 0x1000, right: 0x2000, down: 0x4000, left: 0x8000, square: 0x80, cross: 0x40 };
const COLUMNS = 7;

/** A game in versus mode, every character earned, no last choices, played on to the versus select's first field of choosing. */
async function toVersusSelect() {
  const { tables, scenes } = await loadFightTables(json);
  const game = new Game({ tables, scenes, fightData: () => null, introData: () => assert.fail('no intro plays') });
  const state = game.state;
  state.records.earnedRoster = 0x1fffff;
  startMode(state, MenuMode.VERSUS, 1);
  state.options.lastChoices.fill(0xfc);
  for (let field = 0; field < 200 && !(state.scene === Scene.VS_SELECT && state.step === 2); field += 1) game.field([0, 0]);
  assert.equal(state.scene, Scene.VS_SELECT, 'versus chooses on the versus select');
  return { game, state, scenes };
}

/** Each pad's buttons pressed for a field, then let go for one. */
function press(game, first, second) {
  game.field([first, second]);
  game.field([0, 0]);
}

test('versus: both choose at once, set their handicaps, and the match is set up as chosen', { skip }, async () => {
  const { game, state, scenes } = await toVersusSelect();
  const t = scenes.vsSelect;
  const startCell = (n) => t.grid.findIndex((cell) => cell.code === t.sides[n].firstCode);
  const sides = state.vsSelect.sides;
  assert.deepEqual(sides.map((s) => s.column + s.row * COLUMNS), [startCell(0), startCell(1)], 'each cursor starts on its side\'s cell');
  assert.deepEqual(sides.map((s) => s.state), [VsSideState.CHOOSING, VsSideState.CHOOSING]);
  /* The first a row's end on: left from its first column comes round to its last. */
  const first = startCell(0);
  for (let k = 0; k <= first % COLUMNS; k += 1) press(game, PAD.left, 0);
  assert.equal(sides[0].column, COLUMNS - 1, 'a row wraps');
  press(game, 0, PAD.down);
  const cells = [sides[0].column + sides[0].row * COLUMNS, sides[1].column + sides[1].row * COLUMNS];
  assert.equal(cells[1], startCell(1) + COLUMNS, 'down a row');
  press(game, PAD.square, PAD.cross);
  assert.deepEqual(sides.map((s) => s.state), [VsSideState.HANDICAP, VsSideState.HANDICAP]);
  /* Each gauge grows outward: the first's to the left, the second's to the right. */
  press(game, PAD.left, PAD.left);
  assert.deepEqual(sides.map((s) => s.handicap), [4, 2]);
  press(game, PAD.square, PAD.square);
  const codes = [t.grid[cells[0]].code, t.grid[cells[1]].code + 1];
  for (let field = 0; field < 200 && state.scene !== Scene.VERSUS; field += 1) game.field([0, 0]);
  assert.equal(state.scene, Scene.VERSUS, 'on to the versus screen');
  assert.deepEqual([0, 1].map((n) => (state.entrants.roster[n] << 2) | state.entrants.costume[n]), codes, 'the characters chosen, the kick the second costume');
  assert.deepEqual(state.world.options.handicaps, [4, 2]);
  assert.deepEqual(state.options.lastChoices, codes, 'kept as the last choices');
  for (let field = 0; field < 4; field += 1) game.field([0, 0]);
  assert.ok(state.versus.records.some((r) => r.kind === 'text' && r.text === 'FIGHT 1'), 'the versus screen names the first match');
});

test('select takes a choice back while the handicap is set', { skip }, async () => {
  const { game, state } = await toVersusSelect();
  const side = state.vsSelect.sides[0];
  press(game, PAD.square, 0);
  assert.equal(side.state, VsSideState.HANDICAP);
  assert.equal(side.count, 1);
  press(game, 0x100, 0);
  assert.equal(side.state, VsSideState.CHOOSING);
  assert.equal(side.count, 0);
  assert.equal(side.chosen[0], NO_CHOICE, 'no choice');
});

test('a versus match\'s end counts its wins or its draw, and both choose again', { skip }, async () => {
  const { scenes } = await loadFightTables(json);
  const state = blankGameState();
  const { match } = state.world;
  Object.assign(state.entrants, { roster: [3, 9], costume: [0, 1], chosen: [1, 1] });
  Object.assign(match, { winner: 1, winnerSide: 0, loserSide: 1, streakSide: 1, streak: 4 });
  versusResult(state, scenes);
  assert.deepEqual(state.run.versusRecord.wins, [1, 0]);
  assert.equal(state.run.versusMatches, 1);
  assert.deepEqual([match.streakSide, match.streak], [0, 1], 'a new winner\'s streak');
  assert.deepEqual(state.records.plays[3], [1, 1, 0, 0], 'the winner\'s play and win');
  assert.deepEqual(state.records.plays[9], [0, 0, 1, 0], 'the loser\'s loss');
  assert.deepEqual(state.entrants.chosen, [0, 0]);
  assert.equal(state.step, FightStep.FROM_MENUS);
  Object.assign(match, { winner: 3 });
  versusResult(state, scenes);
  assert.equal(state.run.versusRecord.draws, 1);
  assert.equal(state.run.versusMatches, 2);
  assert.equal(match.streak, 0, 'a draw starts the streak afresh');
  assert.deepEqual([state.records.plays[3][3], state.records.plays[9][3]], [1, 1], 'both drew');
});

test('Arcade chosen with start and both shoulders held chooses on the versus select, the computer on the other side', { skip }, async () => {
  const { tables, scenes } = await loadFightTables(json);
  const game = new Game({ tables, scenes, fightData: () => null, introData: () => assert.fail('no intro plays') });
  const state = game.state;
  startMode(state, MenuMode.ARCADE, 1);
  state.run.shoulders = 1;
  state.options.lastChoices.fill(0xfc);
  for (let field = 0; field < 200 && !(state.scene === Scene.VS_SELECT && state.step === 2); field += 1) game.field([0, 0]);
  assert.equal(state.scene, Scene.VS_SELECT);
  const sides = state.vsSelect.sides;
  assert.deepEqual(sides.map((s) => s.state), [VsSideState.CHOOSING, VsSideState.COMPUTER]);
  press(game, PAD.square, 0);
  assert.equal(sides[0].state, VsSideState.CHOSEN, 'no handicap to set');
  for (let field = 0; field < 200 && state.scene !== Scene.VERSUS; field += 1) game.field([0, 0]);
  assert.equal(state.scene, Scene.VERSUS, 'on to the first match');
  assert.equal(state.entrants.roster[0] * 4, scenes.vsSelect.sides[0].firstCode, 'the character chosen');
  assert.equal(state.entrants.computer[1], 1, 'the computer on the other side');
});

test("online, the versus screen's FIGHT counts the pairing's matches, the game's own state left as it is", async () => {
  const { versusRuns } = await import('../src/present/scenes/versus.ts');
  const state = blankGameState();
  const run = (text, x, y) => ({ font: 1, colour: 6, x, y, layer: 7, text });
  state.versus.records.push({ kind: 'text', text: 'VS', colour: 6, font: 3, x: 0, y: 0 }, { kind: 'text', text: 'FIGHT 1', colour: 6, font: 1, x: 0x1c, y: 0x2a });
  state.printed.push(run('VS', 0, 0), run('FIGHT 1', 0x1c, 0x2a), run('JIN', 0, 0x80));
  assert.equal(versusRuns(state), state.printed, 'offline, the game\'s own');
  state.run.online = 1;
  state.online.fight = 1;
  assert.equal(versusRuns(state), state.printed, 'the first match, the game\'s own');
  state.online.fight = 3;
  assert.deepEqual(versusRuns(state).map((r) => r.text), ['VS', 'FIGHT 3', 'JIN'], 'the third match on the pairing');
  assert.deepEqual(versusRuns(state)[1], { ...run('FIGHT 3', 0x1c, 0x2a) }, 'where the game prints it');
  assert.equal(state.printed[1].text, 'FIGHT 1', "the game's printed runs, which the two games compare, untouched");
});
