/**
 * The stage fixed in place for the remake's walls: how far a stage's own walls stand from its middle
 * (`wallReach`, the nearest standing geometry along its four axes; synthetic rooms), and the scenery
 * laid fixed (at the middle, unturned, its cells hidden between the camera and the fighters wherever
 * they stand), on a fight from the imported data.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadFightTables, loadMoveset } from '../src/assets/load.ts';
import { insideWalls, layScenery, newScenery } from '../src/present/3d/layout.ts';
import { wallReach } from '../src/present/3d/stage/stage.ts';
import { Fight } from '../src/sim/fight/fight.ts';
import { fightDataFor, matchMovesets } from '../src/sim/fight/match.ts';
import { BODY, WALL_REACH } from '../src/sim/fight/walls.ts';

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
const manifest = existsSync(path.join(assets, 'manifest.json')) ? JSON.parse(readFileSync(path.join(assets, 'manifest.json'), 'utf8')) : {};
const skip = !Array.isArray(manifest.movesets) && 'no imported data; run npm run extract and npm run import';
const json = async (name) => JSON.parse(readFileSync(path.join(assets, name), 'utf8'));
const two = (n) => String(n).padStart(2, '0');

/** A mesh of quads (each four corners, metres, y up) as positions and indices. */
function mesh(quads) {
  const positions = new Float32Array(quads.length * 12);
  const indices = new Uint32Array(quads.length * 6);
  quads.forEach((quad, q) => {
    quad.forEach((p, k) => positions.set(p, q * 12 + k * 3));
    indices.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4 + 1, q * 4 + 3, q * 4 + 2], q * 6);
  });
  return { positions, indices };
}

/** A room: a floor `floor` metres each way, walls a metre high at ±`x` across and ±`z` deep. */
function room(x, z, floor = 12) {
  const quads = [
    [
      [-floor, 0, -floor],
      [floor, 0, -floor],
      [-floor, 0, floor],
      [floor, 0, floor],
    ],
  ];
  for (const s of [-1, 1]) {
    quads.push([
      [s * x, 0, -z],
      [s * x, 0, z],
      [s * x, 1, -z],
      [s * x, 1, z],
    ]);
    quads.push([
      [-x, 0, s * z],
      [x, 0, s * z],
      [-x, 1, s * z],
      [x, 1, s * z],
    ]);
  }
  return mesh(quads);
}

test("a stage's walls stand as far from its middle as the nearest standing geometry along its axes and its diagonals", () => {
  const square = room(8, 8);
  assert.ok(Math.abs(wallReach(square.positions, square.indices) - 8) < 0.05, 'four walls at 8 m');
  const narrow = room(8, 6.5);
  assert.ok(Math.abs(wallReach(narrow.positions, narrow.indices) - 6.5) < 0.05, 'the nearer pair');
  const open = mesh([
    [
      [-12, 0, -12],
      [12, 0, -12],
      [-12, 0, 12],
      [12, 0, 12],
    ],
  ]);
  assert.equal(wallReach(open.positions, open.indices), null, 'a floor alone has none');
  /* The square room turned an eighth: its walls 8 m away along the diagonals, 11.3 along the axes. */
  const turned = room(8, 8);
  const c = Math.SQRT1_2;
  for (let i = 0; i < turned.positions.length; i += 3) {
    const [x, z] = [turned.positions[i], turned.positions[i + 2]];
    turned.positions[i] = x * c - z * c;
    turned.positions[i + 2] = x * c + z * c;
  }
  assert.ok(Math.abs(wallReach(turned.positions, turned.indices) - 8) < 0.05, 'turned: its walls along the diagonals');
});

/** An arcade grid: 16 cells a side, 3608 mm each (stage 4's). */
const GRID = { cellSize: 451, grid: 16 };
const CELL = GRID.cellSize * 8;
const RIGHT = 0x2000;

test('the scenery laid fixed stands at the middle unturned wherever the fighters are, all drawn while the camera is inside the walls, and past them hides only what is between it and them', { skip }, async () => {
  const { tables, arena } = await loadFightTables(json);
  const setup = { stage: 4, walls: 1, entrants: [{ roster: 0, costume: 0, computer: false }, { roster: 9, costume: 0, computer: false }] };
  const [first, second] = matchMovesets(tables, setup);
  const movesets = new Map([[first, await loadMoveset(json, two(first))], [second, await loadMoveset(json, two(second))]]);
  const data = fightDataFor(tables, setup, (id) => movesets.get(id), await loadMoveset(json, 'common'));
  const fight = Fight.quick(data, setup);
  const state = fight.state;
  const [a, b] = state.fighters;
  for (let field = 0; field < 400; field += 1) fight.field([0, 0]);
  for (let field = 0; field < 1500 && Math.abs(b.skeleton.base.translation[0]) < WALL_REACH - BODY - 50; field += 1) fight.field([RIGHT, RIGHT]);
  const scale = 1.2;
  const out = newScenery();
  /* A camera inside the walls, at the game's camera's height. */
  const mid = [(a.skeleton.base.translation[0] + b.skeleton.base.translation[0]) / 2, (a.skeleton.base.translation[2] + b.skeleton.base.translation[2]) / 2];
  const eye = [mid[0] - 2500, state.camera.drawn.eye[1], mid[1] - 3000];
  layScenery(state, data, arena, GRID, { widening: 1, fixed: { scale }, camera: { ...state.camera.drawn, eye } }, out);
  assert.deepEqual([out.x, out.z, out.yaw], [0, 0, 0], 'at the middle, unturned');
  /* A cell of a point of the world, in the scenery's own units (unturned, scaled). */
  const cellOf = (x, z) => Math.floor(x / scale / CELL + 8) + 16 * Math.floor(z / scale / CELL + 8);
  assert.ok(insideWalls(eye[0], eye[2], WALL_REACH), 'the camera inside the walls');
  assert.ok(out.cells.slice(0, 256).every((v) => v > 0), 'with the camera inside the walls, nothing stands between it and the fighters but the scenery is all drawn');
  /* A camera past a wall (where the game's camera stands for fighters along it, as drawn): the cells its lines to the fighters cross left out, not those by the fighters. */
  const outside = [mid[0], eye[1], mid[1] - 13000];
  layScenery(state, data, arena, GRID, { widening: 1, fixed: { scale }, camera: { ...state.camera.drawn, eye: outside } }, out);
  const crossed = new Set();
  for (const f of [a, b]) {
    for (let k = 0; k <= 64; k += 1) crossed.add(cellOf(outside[0] + ((f.skeleton.base.translation[0] - outside[0]) * k) / 64, outside[2] + ((f.skeleton.base.translation[2] - outside[2]) * k) / 64));
  }
  /* Along the view to the fighters' midpoint, how far a point lies from the camera; a cell's middle in the world. */
  const length = Math.hypot(mid[0] - outside[0], mid[1] - outside[2]);
  const depth = (x, z) => ((x - outside[0]) * (mid[0] - outside[0]) + (z - outside[2]) * (mid[1] - outside[2])) / length;
  const nearer = Math.min(...[a, b].map((f) => depth(f.skeleton.base.translation[0], f.skeleton.base.translation[2])));
  let hidden = 0;
  out.cells.forEach((v, cell) => {
    if (cell >= 256 || v > 0) return;
    hidden += 1;
    const [x, z] = [((cell % 16) - 8 + 0.5) * CELL * scale, (Math.floor(cell / 16) - 8 + 0.5) * CELL * scale];
    assert.ok(crossed.has(cell) || depth(x, z) < nearer, `cell ${cell} hidden off the lines and past the fighters`);
  });
  assert.ok(hidden > 0, 'the wall between hidden');
  for (const f of [a, b]) assert.ok(out.cells[cellOf(f.skeleton.base.translation[0], f.skeleton.base.translation[2])] > 0, "each fighter's own cell drawn");
});

test('an arcade stage fixed in place, the camera past a wall: every cell nearer it than the fighters left out, beside its lines to them too, and those past the walls on its side of them, and what stands beyond them drawn', { skip }, async () => {
  const { tables, arena } = await loadFightTables(json);
  const setup = { stage: 4, walls: 1, entrants: [{ roster: 0, costume: 0, computer: false }, { roster: 9, costume: 0, computer: false }] };
  const [first, second] = matchMovesets(tables, setup);
  const movesets = new Map([[first, await loadMoveset(json, two(first))], [second, await loadMoveset(json, two(second))]]);
  const data = fightDataFor(tables, setup, (id) => movesets.get(id), await loadMoveset(json, 'common'));
  const fight = Fight.quick(data, setup);
  const state = fight.state;
  for (let field = 0; field < 400; field += 1) fight.field([0, 0]);
  /* Both by the wall behind them as the camera sees them, the camera at the game's distance past it. */
  const [a, b] = state.fighters;
  [a, b].forEach((f, i) => {
    f.skeleton.base.translation[0] = i === 0 ? -900 : 900;
    f.skeleton.base.translation[2] = -8800;
  });
  const eye = [0, -1112, -14200];
  const out = newScenery();
  layScenery(state, data, arena, GRID, { widening: 1, fixed: { scale: 1 }, camera: { ...state.camera.drawn, eye } }, out);
  const cellAt = (column, row) => out.cells[row * 16 + column];
  /* The grid's columns and rows by the world's x and z (unturned, unscaled). */
  const column = (x) => Math.floor(x / CELL + 8);
  const row = (z) => Math.floor(z / CELL + 8);
  /* Off to the side of the lines, a cell between the camera and the fighters, nearer the camera than they are by more than 1.5 m. */
  assert.ok(cellAt(column(-4000), row(-12500)) <= 0, 'beside the lines, nearer the camera than the fighters: left out');
  assert.ok(cellAt(column(4000), row(-12500)) <= 0, 'and on the other side');
  /* Level with the fighters off to the side but past the wall, on the camera's side of it: left out. */
  assert.ok(cellAt(column(-9000), row(-10000)) <= 0, 'past the wall, level with the fighters: left out');
  /* Past the fighters, toward the stage's middle and its far wall: drawn. */
  assert.ok(cellAt(column(0), row(-3000)) > 0, 'the stage past the fighters drawn');
  assert.ok(cellAt(column(-5000), row(6000)) > 0, 'its far side drawn');
  /* Drawn larger, the fighters' own cells reach past the wall, their middles beyond it: left out too, the fight's floor under them. */
  const scale = 1.2;
  layScenery(state, data, arena, GRID, { widening: 1, fixed: { scale }, camera: { ...state.camera.drawn, eye } }, out);
  for (const f of [a, b]) {
    const [x, z] = [f.skeleton.base.translation[0] / scale, f.skeleton.base.translation[2] / scale];
    assert.ok(!insideWalls((Math.floor(z / CELL + 8) - 8 + 0.5) * CELL, 0, WALL_REACH / scale), "the fighter's cell's middle past the wall");
    assert.ok(cellAt(column(x), row(z)) <= 0, "the fighter's own cell, past the wall, left out");
  }
});

/** The disc's grid: 6 cells a side, 3200 mm each, its walls the panels of its border cells (its floor its own ground). */
const DISC = { cellSize: 400, grid: 6 };
const DISC_CELL = DISC.cellSize * 8;

test("a disc stage fixed in place: a camera past its walls has every cell its lines to the fighters cross left out, the fighters' own too, and one high over them the four about them", { skip }, async () => {
  const { tables, arena } = await loadFightTables(json);
  const setup = { stage: 0, walls: 1, entrants: [{ roster: 0, costume: 0, computer: false }, { roster: 9, costume: 0, computer: false }] };
  const [first, second] = matchMovesets(tables, setup);
  const movesets = new Map([[first, await loadMoveset(json, two(first))], [second, await loadMoveset(json, two(second))]]);
  const data = fightDataFor(tables, setup, (id) => movesets.get(id), await loadMoveset(json, 'common'));
  const fight = Fight.quick(data, setup);
  const state = fight.state;
  const [a, b] = state.fighters;
  for (let field = 0; field < 400; field += 1) fight.field([0, 0]);
  for (let field = 0; field < 1500 && Math.abs(b.skeleton.base.translation[0]) < WALL_REACH - BODY - 50; field += 1) fight.field([RIGHT, RIGHT]);
  const roots = [a, b].map((f) => [f.skeleton.base.translation[0], f.skeleton.base.translation[2]]);
  const cellOf = ([x, z]) => Math.floor(x / DISC_CELL + 3) + 6 * Math.floor(z / DISC_CELL + 3);
  const mid = [(roots[0][0] + roots[1][0]) / 2, (roots[0][1] + roots[1][1]) / 2];
  const out = newScenery();
  /* Past the wall the fighters stand by, level with them: the panel between left out, that is in the cell one of them stands in. */
  layScenery(state, data, arena, DISC, { widening: 1, fixed: { scale: 1 }, camera: { ...state.camera.drawn, eye: [WALL_REACH + 2100, -1200, mid[1]] } }, out);
  assert.ok(out.cells[cellOf(roots[1])] <= 0, `the panel by the fighter at the wall left out (cell ${cellOf(roots[1])})`);
  assert.ok(out.cells[cellOf([-roots[1][0], roots[1][1]])] > 0, 'the far wall drawn');
  /* High over the fighters (the knockout's shot from above): the four cells about them left out, as the game leaves out its middle four. */
  layScenery(state, data, arena, DISC, { widening: 1, fixed: { scale: 1 }, camera: { ...state.camera.drawn, eye: [mid[0], -7853, mid[1]] } }, out);
  const about = [Math.min(5, Math.max(1, Math.round(mid[0] / DISC_CELL + 3))), Math.min(5, Math.max(1, Math.round(mid[1] / DISC_CELL + 3)))];
  const four = [[-1, -1], [-1, 0], [0, -1], [0, 0]].map(([dr, dc]) => (about[1] + dr) * 6 + about[0] + dc);
  assert.ok(four.includes(cellOf(roots[1])), 'the four about the fighters are where they stand');
  for (const cell of four) assert.ok(out.cells[cell] <= 0, `cell ${cell} over the fighters left out`);
  /* Low again, inside the walls: all of it drawn. */
  layScenery(state, data, arena, DISC, { widening: 1, fixed: { scale: 1 }, camera: { ...state.camera.drawn, eye: [mid[0] - 3000, -1200, mid[1] - 2000] } }, out);
  assert.ok(out.cells.slice(0, 36).every((v) => v > 0), 'low and inside, every cell drawn');
});
