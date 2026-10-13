/**
 * Tekken Force drawn: its backdrop's tiles scroll a twentieth of the camera's travel across the
 * view, wrap round their map and stand on the floor's line 2.5 m ahead (MISHIMA FORTRESS's climbing
 * a step every third column over black, the final stage only black); its gauges are as long as
 * their enemy's kind with their right ends lined up, an enemy's row and gauge shown only while it
 * is in play; the keys held show bottom left; a run of digits is laid a glyph a cell; the progress
 * bar lights the stages cleared, the current one to the progress, and the final stage's box; and
 * an item is sized by its depth, its shadow under it. Synthetic states and tables; the floor's
 * patch (10 × 3 tiles of 2.5 m at a fixed depth, or round the player's feet on the dark stage) on
 * the imported tables.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

import { parseArenaTables } from '../src/assets/arena.ts';
import { parseMathTables } from '../src/assets/math.ts';
import { layGround, newGround } from '../src/present/3d/layout.ts';

import { blankFightState } from '../src/sim/fight/blank.ts';
import { backdropPlace, floorLine } from '../src/present/3d/stage/force-backdrop.ts';
import { itemRects } from '../src/present/3d/effects/force-items.ts';
import { layOutHud, progressBar } from '../src/present/hud/hud-layout.ts';

/** A sine table a turn and a quarter long, in 4.12. */
const SINE = Int16Array.from({ length: 5120 }, (_, i) => Math.round(4096 * Math.sin((i * 2 * Math.PI) / 4096)));
const KINDS = [31, 62, 93, 124, 156].map((gauge, k) => ({ gauge, seconds: [2, 4, 6, 8, 0][k] }));
const DATA = {
  math: { sine: SINE },
  force: {
    kinds: KINDS,
    barColours: [
      [0, 64, 128],
      [0, 128, 32],
      [128, 128, 0],
      [128, 16, 0],
    ],
    stages: [16, 15, 13, 3].map((columns) => ({ backdrop: { columns, rows: 5 } })),
  },
  roster: { codes: Array.from({ length: 0x5c }, (_, code) => ({ name: `CODE ${code}` })) },
};

/** Tekken Force's camera looking straight ahead from x, 3.5 m up and 7 m back, on a stage. */
function force(stage, x, finalStage = 0) {
  const state = blankFightState();
  state.mode = 8;
  state.stage = stage;
  state.force.finalStage = finalStage;
  state.camera.drawn.eye.splice(0, 3, x, -3500, -7000);
  state.view.rotation.splice(0, 9, 4096, 0, 0, 0, 4096, 0, 0, 0, 4096);
  state.view.translation.splice(0, 3, -x, 3500, 7000);
  Object.assign(state.screen, { distance: 500, offsetX: 192 << 16, offsetY: 240 << 16 });
  return state;
}

test("the backdrop stands on the floor's line, its seven columns across the picture, a scroll a twentieth of the camera's travel", () => {
  const state = force(0xf, 0);
  const line = floorLine(state);
  assert.equal(line, 240 + Math.floor((500 * 3500) / 9500), 'the floor 2.5 m ahead of the camera');
  const { tiles, rects } = backdropPlace(state, DATA, 0, 384);
  assert.deepEqual(rects, []);
  assert.equal(tiles.length, 7 * 5);
  assert.deepEqual(tiles[0], { x: 0, y: line - 5 * 64, column: 0, row: 0 });
  assert.deepEqual(tiles.at(-1), { x: 6 * 64, y: line - 64, column: 6, row: 4 });
  const moved = backdropPlace(force(0xf, 70 * 20), DATA, 0, 384).tiles;
  assert.deepEqual(moved[0], { x: -6, y: line - 5 * 64, column: 1, row: 0 }, '70 units on: the second column, 6 units off the left');
});

test('the backdrop wraps round its map either way, and a wider picture takes more columns', () => {
  const back = backdropPlace(force(0xf, -20), DATA, 0, 384).tiles;
  assert.deepEqual(
    back.slice(0, 2).map((t) => [t.x, t.column]),
    [
      [-63, 15],
      [1, 0],
    ],
  );
  const wide = backdropPlace(force(0xf, 0), DATA, -100, 484).tiles.filter((t) => t.row === 0);
  assert.deepEqual(
    wide.map((t) => t.column),
    [14, 15, 0, 1, 2, 3, 4, 5, 6, 7],
  );
});

test("MISHIMA FORTRESS's strip climbs a step every third column, over a black band and its seams; the final stage is only black", () => {
  const { tiles, rects } = backdropPlace(force(0x12, 0), DATA, 0, 384);
  const row = tiles.filter((t) => t.row === 0);
  assert.equal(row[0].y, row[2].y, 'one step for three columns');
  assert.ok(row[3].y < row[2].y - 60 && row[2].y - 70 < row[3].y, `${row[2].y} to ${row[3].y}: a step of about 66 lines up`);
  assert.deepEqual(rects[0], { x: 0, y: 20, w: 272, h: 100 });
  assert.deepEqual(
    rects.slice(1).map((r) => [r.x, r.w, r.h]),
    [
      [0, 64, 32],
      [192, 64, 32],
      [384, 64, 32],
    ],
    'a seam under each column the map starts again at',
  );
  const final = backdropPlace(force(0xf, 0, 1), DATA, 0, 384);
  assert.deepEqual(final.tiles, []);
  assert.deepEqual(final.rects, [{ x: 0, y: 20, w: 368, h: floorLine(force(0xf, 0, 1)) - 16 }]);
});

/** A fight with the HUD's back showing, fighting, the first enemy in play as `kind`, the second out. */
function hud(kind) {
  const state = force(0xf, 0);
  state.hud.back = 1;
  state.round.flow = 1;
  state.force.slots[0].kind = kind;
  state.fighters[1].pushImmune = 0;
  state.fighters[2].pushImmune = 1;
  state.hud.forceNames.splice(0, 3, 0x04, 0x54, 0x55);
  state.hud.forceBars[0].shown = 152;
  state.hud.forceBars[0].trail = 152;
  state.hud.forceBars[1].shown = 20;
  state.hud.forceBars[1].trail = 40;
  return state;
}

test("the gauges: the player's full, an enemy's as long as its kind's with its right end under the first's, health at the right end; an enemy out of play shows none", () => {
  const { back } = layOutHud(hud(1), ['', ''], DATA);
  const caps = back.filter((p) => p.piece.kind === 'cap').map((p) => [p.x, p.y]);
  assert.deepEqual(caps.sort((a, b) => a[0] - b[0] || a[1] - b[1]), [
    [10, 40],
    [10 + 0x9c - 6, 40],
    [202 + 0x9c - 62, 40],
    [202 + 0x9c - 6, 40],
  ]);
  const enemy = back.filter((p) => p.piece.kind === 'bar' && p.x > 200).map((p) => [p.piece.part, p.x, p.w]);
  const right = 202 + 0x9c - 2;
  assert.deepEqual(
    enemy.sort((a, b) => b[1] - a[1]),
    [
      ['health', right - 20, 20],
      ['damage', right - 40, 20],
      ['lost', right - 58, 18],
    ],
  );
  const names = back.filter((p) => p.piece.kind === 'name').map((p) => [p.piece.text, p.piece.side, p.x, p.y, p.piece.costume]).sort((a, b) => a[2] - b[2]);
  assert.deepEqual(names, [
    ['CODE 4', 0, 14, 66, 0],
    ['CODE 84', 1, 354, 66, 0],
  ]);
  const opening = hud(1);
  opening.round.flow = 0;
  assert.equal(layOutHud(opening, ['', ''], DATA).back.filter((p) => p.piece.kind === 'name').length, 1, 'before the round starts only the player');
});

test('the keys held show bottom left, and a run of digits is laid a glyph a cell', () => {
  const state = hud(0);
  state.force.keysShown = 2;
  state.hud.prints.push({ font: 0, colour: 6, x: 73, y: 0x18, text: '     120' }, { font: 0, colour: 5, x: 19, y: 0x18, text: 'SCORE ' });
  const { front } = layOutHud(state, ['', ''], DATA);
  assert.deepEqual(
    front.filter((p) => p.piece.kind === 'key').map((p) => [p.piece.index, p.x, p.y, p.w, p.h]),
    [
      [0, 0, 420, 20, 36],
      [1, 20, 420, 20, 36],
    ],
  );
  const calls = front.filter((p) => p.piece.kind === 'call').map((p) => [p.piece.text, p.x]);
  assert.deepEqual(
    calls.sort((a, b) => a[1] - b[1]),
    [
      ['SCORE ', 19],
      ['1', 73 + 5 * 9],
      ['2', 73 + 6 * 9],
      ['0', 73 + 7 * 9],
    ],
  );
});

test('the progress bar: stages cleared half lit, the current one lit to the progress with the rest dark, those to come dark; the final stage pulses its box', () => {
  const state = force(0x10, 0);
  state.force.stage = 1;
  state.force.barPos = 64 + 60 + 25;
  state.force.barPhase = 0;
  const bar = progressBar(state, DATA);
  const at = (x) => bar.filter((q) => !q.triangle && q.x === x && q.w !== 1);
  assert.deepEqual(at(64).map((q) => [q.blend, q.w, q.alpha, q.top]), [['over', 60, 0.5, [0, 64 / 255, 128 / 255]]], 'the first stage cleared: half its colour');
  assert.deepEqual(at(124).map((q) => [q.blend, q.w, q.top]), [['add', 25, [0, (128 * 0xc0) / 0x80 / 255, (32 * 0xc0) / 0x80 / 255]]], 'the current one added to the progress at the pulse');
  assert.deepEqual(at(149).map((q) => [q.blend, q.w, q.top]), [['over', 35, [0, 0, 0]]]);
  assert.deepEqual(at(184).map((q) => q.top), [[0, 0, 0]], 'a stage to come: dark');
  assert.ok(bar.some((q) => q.x === 149 && q.w === 1), 'the cursor at the progress');
  assert.equal(bar.filter((q) => q.w === 1 && q.bottom[0] < 1).length, 5, 'five lines between');
  const final = force(0xf, 0, 1);
  final.force.stage = 4;
  final.force.barPos = 0x13c;
  const box = progressBar(final, DATA).filter((q) => q.blend === 'add');
  assert.deepEqual(
    box.map((q) => [q.x, q.w]),
    [[304, 12]],
  );
});

test("an item is 0x15e00 units across at a quarter of its depth, standing between one and two of its heights over its point, its shadow its width high under it", () => {
  const { item, shadow } = itemRects(2000);
  assert.deepEqual(item, { left: -89, right: 90, top: -716, bottom: -358 });
  assert.deepEqual(shadow, { left: -89, right: 90, top: -358 - 179, bottom: -358 });
  assert.deepEqual(itemRects(0).item.right - itemRects(0).item.left, 0x15e00, 'no depth: as at a depth of one');
});

const imported = existsSync('public/assets/tables/arena.json');
const table = (name) => JSON.parse(readFileSync(`public/assets/tables/${name}.json`, 'utf8'));

test("the floor: 10 × 3 tiles of 2.5 m from the first rows of the map, at a fixed depth under the camera's view, or round the player's feet on the dark stage", { skip: !imported && 'no imported data' }, () => {
  const arena = parseArenaTables(table('arena'));
  const data = { math: parseMathTables(table('math')) };
  const state = force(0xf, 6000);
  state.camera.drawn.pitch = 0xaa;
  state.groundShown = 1;
  state.groundFade = 10000;
  const ground = newGround();
  layGround(state, data, arena, arena.stages[0xf], { widening: 16 / 9 / (4 / 3) }, ground);
  assert.ok(ground.drawn);
  assert.equal(ground.count, 30);
  const zs = new Set(Array.from(ground.z.subarray(0, 120)));
  assert.deepEqual([...zs].sort((a, b) => a - b), [-5000, -2500, 0, 2500]);
  const xs = Array.from(ground.x.subarray(0, 120));
  assert.equal(Math.max(...xs) - Math.min(...xs), 25000);
  assert.ok(Array.from(ground.cell.subarray(0, 30)).every((cell) => 0 <= cell && cell < 30), "the map's first three rows");
  const dark = force(0x11, 0);
  dark.camera.drawn.pitch = 0xaa;
  dark.fighters[0].skeleton.base.translation.splice(0, 3, 4000, 0, 2600);
  layGround(dark, data, arena, arena.stages[0x11], { widening: 1 }, ground);
  const darkZ = Array.from(ground.z.subarray(0, 120));
  assert.equal(Math.min(...darkZ), 5000 - 5000, 'the patch snapped round the player half a tile on');
  assert.equal(Math.max(...ground.shade.subarray(0, 120)), 254, 'brightest at the player');
});
