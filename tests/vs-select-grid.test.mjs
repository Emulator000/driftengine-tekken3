/**
 * The versus select's grid with tables made up here: seven characters a row 36 apart from 57,
 * three rows from 67, roster ids 0 to 20. Without an added character it is the tables' grid as it
 * stands; with one it is eight a row moved half a cell left, the added character at the top row's
 * end and the two other new cells empty, the cursor wrapping over each row's characters and never
 * landing on an empty cell, and the added character chosen like any other.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ICON, iconColumn } from '../src/present/scenes/icons.ts';
import { MenuMode } from '../src/sim/game/menu.ts';
import { blankGameState, Scene } from '../src/sim/game/state.ts';
import { cellOf, codeUnder, gridOf, NO_CHOICE, TAKEN, VsSideState, vsSelectScene } from '../src/sim/game/vs-select.ts';

const PAD = { up: 0x1000, right: 0x2000, down: 0x4000, left: 0x8000, square: 0x80, cross: 0x40, start: 0x800 };
const KAZUYA = 22;
const EVERYONE = 0x1fffff;
/** Side 1 starts on the middle row's first cell, side 2 on its last. */
const FIRST_CELLS = [7, 13];

const GRID = Array.from({ length: 21 }, (_, i) => ({ x: 57 + (i % 7) * 36, y: 67 + Math.floor(i / 7) * 63, code: i * 4 }));
const point = { x: 0, y: 0 };
const side = (n) => ({
  cursor: n + 1,
  firstCode: GRID[FIRST_CELLS[n]].code,
  tags: [0, 0],
  name: { x: 0x56 + n * 0xc4, y: 0x112 },
  slots: [point, point, point],
  gauge: { mirrored: n, raised: 0, x: 0, y: 0, life: point, percent: point },
});
const VS_SELECT = {
  grid: GRID,
  kinds: Array.from({ length: 16 }, () => [1, 2, 3]),
  apart: Array.from({ length: 16 }, () => [1, 1]),
  sides: [side(0), side(1)],
  titles: Array.from({ length: 9 }, () => 'VERSUS'),
  hint: '%cSTART',
  tournament: 'TOURNAMENT',
  winColours: [7, 7, 7, 7],
  drawColours: [7, 7, 7, 7],
  segments: [16, 16, 16, 16, 16, 16, 16, 16],
  life: 'LIFE',
  percents: Array.from({ length: 8 }, () => '100%'),
};
const line = { text: 'PUSH START', half: 45 };
const scenesWith = (added) => ({ vsSelect: VS_SELECT, select: { added, coinLines: [line, line, line], creditLines: [line] } });
const PLAIN = scenesWith([]);
const ADDED = scenesWith([{ roster: KAZUYA, cell: 10, look: 0, firstOpponent: 9 }]);
const TABLES = {
  sound: { volumes: new Array(16).fill(0x3fff) },
  roster: { codes: Array.from({ length: 0x5c }, (_, code) => ({ name: code >> 2 === KAZUYA ? 'KAZUYA' : `FIGHTER ${code >> 2}` })) },
};

/** A game on the versus select in `mode`, every character earned, no last choices, at its first field of choosing. */
function toSelect(scenes, mode = MenuMode.VERSUS) {
  const state = blankGameState();
  state.records.earnedRoster = EVERYONE;
  state.options.lastChoices.fill(NO_CHOICE);
  state.world.mode = mode;
  state.world.joined.fill(1);
  Object.assign(state, { scene: Scene.VS_SELECT, step: 0 });
  const select = { state, scenes, field: (pads = [0, 0]) => field(state, scenes, pads) };
  select.field();
  select.field();
  assert.equal(state.step, 2, 'choosing');
  return select;
}

/** One field with each pad's buttons newly pressed and repeating. */
function field(state, scenes, pads) {
  state.printed.length = 0;
  state.fades.length = 0;
  pads.forEach((pad, n) => {
    state.pads.repeats[n] = pad;
    state.world.input.fresh[n] = pad;
  });
  vsSelectScene(state, TABLES, scenes);
}

/** Side 1's pad pressed for a field, then let go for one. */
function press(select, pad, other = 0) {
  select.field([pad, other]);
  select.field();
}

const at = (select, n = 0) => [select.state.vsSelect.sides[n].column, select.state.vsSelect.sides[n].row];

test('without an added character the grid is the tables\' seven by three where they lay it', () => {
  const grid = gridOf(PLAIN);
  assert.equal(grid.columns, 7);
  assert.equal(grid.cells, GRID, 'the tables\' own cells');
  assert.deepEqual(grid.widths, [7, 7, 7]);
  assert.deepEqual([grid.added, grid.shift], [0, 0]);
});

test('with an added character the grid is eight a row, half a cell left, him at the top row\'s end and the two other new cells empty', () => {
  const grid = gridOf(ADDED);
  assert.equal(grid.columns, 8);
  assert.equal(grid.cells.length, 24);
  for (let row = 0; row < 3; row += 1) {
    const cells = grid.cells.slice(row * 8, row * 8 + 8);
    assert.deepEqual(cells.map((c) => c.x), [39, 75, 111, 147, 183, 219, 255, 291], 'centred where the seven were');
    assert.ok(cells.every((c) => c.y === GRID[row * 7].y));
    assert.deepEqual(cells.slice(0, 7).map((c) => c.code), GRID.slice(row * 7, row * 7 + 7).map((c) => c.code), 'every character keeps its row and column');
  }
  assert.deepEqual([grid.cells[7].code, grid.cells[15].code, grid.cells[23].code], [KAZUYA * 4, NO_CHOICE, NO_CHOICE]);
  assert.deepEqual(grid.widths, [8, 7, 7]);
  assert.equal(grid.added, 1 << KAZUYA);
  assert.equal(grid.shift, 18);
  assert.equal(gridOf(ADDED), grid, 'laid once');
});

test('no choice and taken are past the added character\'s codes, and his small icon is his own column', () => {
  assert.ok(NO_CHOICE > KAZUYA * 4 + 3 && TAKEN > KAZUYA * 4 + 3);
  assert.equal(iconColumn(KAZUYA * 4), KAZUYA);
  assert.equal(iconColumn(KAZUYA * 4 + 1), KAZUYA);
  assert.equal(iconColumn(NO_CHOICE), ICON.none);
  assert.equal(iconColumn(TAKEN), ICON.empty);
});

test('a row\'s ends wrap over its eight, or over the seven before its empty cell', () => {
  const select = toSelect(ADDED);
  assert.deepEqual(at(select), [0, 1], 'side 1 starts on its cell');
  press(select, PAD.left);
  assert.deepEqual(at(select), [6, 1], 'the middle row wraps past its empty cell');
  press(select, PAD.right);
  assert.deepEqual(at(select), [0, 1]);
  press(select, PAD.up);
  press(select, PAD.left);
  assert.deepEqual(at(select), [7, 0], 'the top row wraps onto the added character');
  assert.equal(codeUnder(select.state, ADDED, select.state.vsSelect.sides[0]), KAZUYA * 4);
  press(select, PAD.right);
  assert.deepEqual(at(select), [0, 0], 'and on round');
});

test('up or down from the added character lands on the next row\'s last character; the cursor is never on an empty cell', () => {
  const select = toSelect(ADDED);
  const sides = select.state.vsSelect.sides;
  press(select, PAD.up);
  press(select, PAD.left);
  press(select, PAD.down);
  assert.deepEqual(at(select), [6, 1]);
  press(select, PAD.down);
  assert.deepEqual(at(select), [6, 2]);
  press(select, PAD.right);
  assert.deepEqual(at(select), [0, 2], 'the bottom row wraps past its empty cell');
  /* A long walk every way, both cursors. */
  const ways = [PAD.left, PAD.up, PAD.up, PAD.right, PAD.down, PAD.left, PAD.left, PAD.down, PAD.right, PAD.up, PAD.down, PAD.down];
  for (let k = 0; k < 120; k += 1) {
    press(select, ways[k % ways.length], ways[(k * 5 + 3) % ways.length]);
    for (const s of sides) assert.notEqual(cellOf(ADDED, s).code, NO_CHOICE, `field ${k}: on a character`);
  }
});

test('the added character is chosen like any other: in the pool though never earned, named, kept apart from the other side\'s in his second costume', () => {
  const select = toSelect(ADDED);
  const { state } = select;
  const sides = state.vsSelect.sides;
  assert.equal(state.records.earnedRoster & (1 << KAZUYA), 0, 'never earned');
  press(select, PAD.up, PAD.up);
  press(select, PAD.left, PAD.right);
  assert.deepEqual([at(select, 0), at(select, 1)], [[7, 0], [7, 0]], 'both on him, from either end of the top row');
  assert.equal(state.printed.filter((run) => run.text === 'KAZUYA').length, 2, 'his name under both slots');
  press(select, PAD.square);
  assert.equal(sides[0].chosen[0], KAZUYA * 4);
  assert.equal(sides[0].state, VsSideState.HANDICAP);
  press(select, 0, PAD.square);
  assert.equal(sides[1].chosen[0], KAZUYA * 4 + 1, 'the same costume twice: the later one gives way');
  press(select, PAD.square, PAD.square);
  assert.deepEqual(sides.map((s) => s.state), [VsSideState.SETTLED, VsSideState.SETTLED]);
  select.field();
  select.field();
  assert.deepEqual([state.entrants.roster, state.entrants.costume], [[KAZUYA, KAZUYA], [0, 1]], 'the match set up with him on both sides');
  assert.deepEqual(state.options.lastChoices, [KAZUYA * 4, KAZUYA * 4 + 1]);
});

test('a team chooses the added character (a kick his second costume), then reads his cell as taken until select puts him back', () => {
  const select = toSelect(ADDED, MenuMode.TEAM_BATTLE);
  const side = select.state.vsSelect.sides[0];
  for (let k = 0; k < 3; k += 1) press(select, PAD.right);
  press(select, PAD.square);
  assert.deepEqual([side.state, side.teamSize], [VsSideState.TEAM_CHOOSING, 3]);
  press(select, PAD.up);
  press(select, PAD.left);
  press(select, PAD.cross);
  assert.deepEqual([side.count, side.chosen[0]], [1, KAZUYA * 4 + 1]);
  assert.equal(codeUnder(select.state, ADDED, side), TAKEN);
  assert.ok(select.state.printed.some((run) => run.text === 'SELECTED'));
  press(select, 0x100);
  assert.equal(codeUnder(select.state, ADDED, side), KAZUYA * 4);
});

test('the last choice puts the cursor back on the added character; the game\'s own none is his code only where he is added', () => {
  for (const [scenes, last, cell] of [
    [ADDED, KAZUYA * 4, [7, 0]],
    [PLAIN, KAZUYA * 4, [0, 1]],
    [ADDED, NO_CHOICE, [0, 1]],
  ]) {
    const state = blankGameState();
    state.records.earnedRoster = EVERYONE;
    state.options.lastChoices.fill(last);
    state.world.mode = MenuMode.VERSUS;
    Object.assign(state, { scene: Scene.VS_SELECT, step: 0 });
    field(state, scenes, [0, 0]);
    field(state, scenes, [0, 0]);
    const s = state.vsSelect.sides[0];
    assert.deepEqual([s.column, s.row], cell, `last choice ${last} with ${scenes.select.added.length} added`);
  }
});

test('without an added character the cursor steps the seven as before and the pool is what is earned', () => {
  const select = toSelect(PLAIN);
  const side = select.state.vsSelect.sides[0];
  assert.equal(side.pool, EVERYONE);
  press(select, PAD.left);
  assert.deepEqual(at(select), [6, 1], 'a row wraps');
  press(select, PAD.right);
  press(select, PAD.up);
  press(select, PAD.up);
  assert.deepEqual(at(select), [0, 0], 'the rows do not');
  for (let k = 0; k < 7; k += 1) press(select, PAD.right);
  assert.deepEqual(at(select), [0, 0], 'seven steps round');
  press(select, PAD.square);
  assert.equal(side.chosen[0], 0);
});
