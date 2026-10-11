/**
 * The character select's grid in the remake, from power-on through the mode menu's Arcade entry, as
 * `npm run import` builds the tables: without an added character the original's ten a row, 35 apart
 * from 11; with Kazuya built (`npm run t4`), Nina keeps her cell and he has one of his own beside
 * Jin, the row of eleven laid 32 apart from 10 so it keeps the ten's width, and the cursor steps
 * through every cell, across and between the rows.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadFightTables } from '../src/assets/load.ts';
import { Game } from '../src/sim/game/game.ts';
import { cellStep, NO_CELL } from '../src/sim/game/select.ts';

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
const ready = existsSync(path.join(assets, 'manifest.json'));
const json = async (name) => JSON.parse(readFileSync(path.join(assets, name), 'utf8'));
const loaded = ready ? await loadFightTables(json) : null;
const kazuya = loaded !== null && loaded.scenes.select.added.some((a) => a.roster === 22);

const SELECT = 9;
const START = 0x800;
const PAD = { right: 0x2000, left: 0x8000, up: 0x1000, down: 0x4000 };
/** A fresh game's ten (roster ids 0 to 9), and every character. */
const FRESH = 0x3ff;
const EVERYONE = 0x1fffff;

/** The game from power-on to the select with `earned` characters, start pressed at the title and at the mode menu; `added` the scenes' added characters. */
function toSelect(earned, added) {
  const scenes = { ...loaded.scenes, select: { ...loaded.scenes.select, added } };
  const game = new Game({ tables: loaded.tables, scenes, fightData: () => null, introData: () => assert.fail('no intro plays') });
  game.state.records.earnedRoster = earned;
  for (let field = 0; field < 2000; field += 1) {
    if (game.state.scene === SELECT && game.state.select.frames > 4) return game;
    const pad = (420 <= field && field < 424) || field === 600 ? START : 0;
    game.field([pad, 0]);
  }
  assert.fail('the select never came');
}

/** The shown cells of a row, left to right. */
const row = (game, first) =>
  game.state.select.cells
    .map((cell, index) => ({ ...cell, index }))
    .slice(first, first + 11)
    .filter((cell) => cell.shows !== 0)
    .sort((a, b) => a.x - b.x);

/** The cell side 1's cursor is on after `pads` (each pressed for a field, then a field released). */
function stepCursor(game, pads) {
  for (const pad of pads) {
    game.field([pad, 0]);
    game.field([0, 0]);
  }
  return game.state.select.sides[0].cell;
}

test("without an added character a fresh game's row is the original's", { skip: !ready }, () => {
  const game = toSelect(FRESH, []);
  const cells = row(game, 0);
  assert.deepEqual(
    cells.map((c) => c.roster),
    [7, 4, 5, 1, 6, 8, 0, 3, 2, 9],
  );
  assert.deepEqual(
    cells.map((c) => c.x),
    cells.map((_, k) => 11 + k * 35),
  );
  assert.equal(game.state.select.count, 10);
  assert.equal(cellStep(game.state.select.cells), 35);
});

test("with Kazuya, a fresh game's row has Nina in her cell and him beside Jin, eleven laid in the ten's width", { skip: !kazuya }, () => {
  const game = toSelect(FRESH, loaded.scenes.select.added);
  const cells = row(game, 0);
  assert.deepEqual(
    cells.map((c) => c.roster),
    [7, 4, 5, 1, 6, 8, 0, 3, 2, 9, 22],
  );
  assert.deepEqual(
    cells.map((c) => c.x),
    cells.map((_, k) => 10 + k * 32),
  );
  assert.equal(cellStep(game.state.select.cells), 32);
  assert.equal(game.state.select.count, 11, 'he counts toward the countdown as a character');
  assert.equal(game.state.select.twoRows, 0);
  /* Right from Jin to him, and on round to Xiaoyu; left from Xiaoyu back to him. */
  const at = (roster) => cells.find((c) => c.roster === roster).index;
  game.state.select.sides[0].cell = at(9);
  assert.equal(stepCursor(game, [PAD.right]), at(22));
  assert.equal(stepCursor(game, [PAD.right]), at(7));
  assert.equal(stepCursor(game, [PAD.left]), at(22));
  assert.equal(game.state.select.sides[0].roster, 22, 'the cursor is on him');
});

test('with Kazuya and every character earned, the rows of eleven and ten link down and up between them, and round each row', { skip: !kazuya }, () => {
  const game = toSelect(EVERYONE, loaded.scenes.select.added);
  const cells = game.state.select.cells;
  const first = row(game, 0);
  const second = row(game, 11);
  assert.equal(first.length, 11);
  assert.equal(second.length, 10, "the second row's ten, Gon its eleventh past the arrows");
  assert.equal(game.state.select.twoRows, 1);
  assert.notEqual(game.state.select.arrivals, 0, "Gon's arrows");
  /* The second row centred under the first: half a cell in. */
  assert.equal(second[0].x - first[0].x, 16);
  for (const cell of [...first, ...second]) for (const way of ['left', 'right']) assert.notEqual(cells[cell.index][way], NO_CELL, `cell ${cell.index} leads ${way}`);
  for (const cell of first) assert.ok(second.some((c) => c.index === cell.down), `cell ${cell.index} leads down into the second row`);
  for (const cell of second) assert.ok(first.some((c) => c.index === cell.up), `cell ${cell.index} leads up into the first row`);
  /* Every cell of the first row reached by stepping right, round to where it started. */
  game.state.select.sides[0].cell = first[0].index;
  const seen = [first[0].index];
  for (let k = 0; k < first.length; k += 1) seen.push(stepCursor(game, [PAD.right]));
  assert.deepEqual(seen.slice(0, first.length).sort((a, b) => a - b), first.map((c) => c.index).sort((a, b) => a - b));
  assert.equal(seen[first.length], first[0].index);
});
