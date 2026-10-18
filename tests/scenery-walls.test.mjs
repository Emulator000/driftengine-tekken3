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
import { cameraInWalls, insideWalls, layScenery, newScenery } from '../src/present/3d/layout.ts';
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

test('the scenery laid fixed stands at the middle unturned wherever the fighters are, all drawn while the camera is inside the walls, and past them hides only what is between', { skip }, async () => {
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
  /* The camera as the fight draws it: kept inside the walls, never within 2.5 m of the fighters. */
  const mid = [(a.skeleton.base.translation[0] + b.skeleton.base.translation[0]) / 2, (a.skeleton.base.translation[2] + b.skeleton.base.translation[2]) / 2];
  const eye = cameraInWalls(state.camera.drawn.eye, mid, WALL_REACH - 300, 2500);
  layScenery(state, data, arena, GRID, { widening: 1, fixed: { scale, eye } }, out);
  assert.deepEqual([out.x, out.z, out.yaw], [0, 0, 0], 'at the middle, unturned');
  /* A cell of a point of the world, in the scenery's own units (unturned, scaled). */
  const cellOf = (x, z) => Math.floor(x / scale / CELL + 8) + 16 * Math.floor(z / scale / CELL + 8);
  assert.ok(insideWalls(eye[0], eye[2], WALL_REACH), 'the camera inside the walls');
  assert.ok(out.cells.slice(0, 256).every((v) => v > 0), 'with the camera inside the walls, nothing stands between it and the fighters but the scenery is all drawn');
  /* A camera past the wall behind it (as the free camera may be): the cells its lines to the fighters cross left out, not those by the fighters. */
  const outside = [eye[0], eye[1], eye[2] - 6000];
  layScenery(state, data, arena, GRID, { widening: 1, fixed: { scale, eye: outside } }, out);
  const crossed = new Set();
  for (const f of [a, b]) {
    for (let k = 0; k <= 64; k += 1) crossed.add(cellOf(outside[0] + ((f.skeleton.base.translation[0] - outside[0]) * k) / 64, outside[2] + ((f.skeleton.base.translation[2] - outside[2]) * k) / 64));
  }
  let hidden = 0;
  out.cells.forEach((v, cell) => {
    if (cell >= 256 || v > 0) return;
    hidden += 1;
    assert.ok(crossed.has(cell), `cell ${cell} hidden off the lines`);
  });
  assert.ok(hidden > 0, 'the wall between hidden');
  for (const f of [a, b]) assert.ok(out.cells[cellOf(f.skeleton.base.translation[0], f.skeleton.base.translation[2])] > 0, "each fighter's own cell drawn");
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
  layScenery(state, data, arena, DISC, { widening: 1, fixed: { scale: 1, eye: [WALL_REACH + 2100, -1200, mid[1]] } }, out);
  assert.ok(out.cells[cellOf(roots[1])] <= 0, `the panel by the fighter at the wall left out (cell ${cellOf(roots[1])})`);
  assert.ok(out.cells[cellOf([-roots[1][0], roots[1][1]])] > 0, 'the far wall drawn');
  /* High over the fighters (the knockout's shot from above): the four cells about them left out, as the game leaves out its middle four. */
  layScenery(state, data, arena, DISC, { widening: 1, fixed: { scale: 1, eye: [mid[0], -7853, mid[1]] } }, out);
  const about = [Math.min(5, Math.max(1, Math.round(mid[0] / DISC_CELL + 3))), Math.min(5, Math.max(1, Math.round(mid[1] / DISC_CELL + 3)))];
  const four = [[-1, -1], [-1, 0], [0, -1], [0, 0]].map(([dr, dc]) => (about[1] + dr) * 6 + about[0] + dc);
  assert.ok(four.includes(cellOf(roots[1])), 'the four about the fighters are where they stand');
  for (const cell of four) assert.ok(out.cells[cell] <= 0, `cell ${cell} over the fighters left out`);
  /* Low again, inside the walls: all of it drawn. */
  layScenery(state, data, arena, DISC, { widening: 1, fixed: { scale: 1, eye: [mid[0] - 3000, -1200, mid[1] - 2000] } }, out);
  assert.ok(out.cells.slice(0, 36).every((v) => v > 0), 'low and inside, every cell drawn');
});

test('a camera past a wall is moved along its line to the fighters until it is inside them, never nearer them than its least; one inside is left', () => {
  const limit = 9300;
  /* Past a corner's side as well as an axis's. */
  const cornered = cameraInWalls([9000, -1200, 9000], [0, 0], limit);
  assert.ok(Math.abs(cornered[0]) + Math.abs(cornered[2]) <= limit * Math.SQRT2 + 1, `inside the corner's side (${cornered})`);
  /* Never nearer the fighters than its least, past the wall or not. */
  const near = cameraInWalls([14672, -1200, 0], [9200, 0], limit, 2500);
  assert.ok(Math.abs(near[0] - 9200) >= 2500 - 1, `kept 2.5 m off the fighters (${near})`);
  assert.deepEqual(cameraInWalls([4000, -1200, -5000], [5000, 0], limit), [4000, -1200, -5000], 'inside: as it is');
  const moved = cameraInWalls([9000, -1200, -14000], [6000, -6000], limit);
  assert.ok(Math.abs(moved[2]) <= limit && Math.abs(moved[0]) <= limit, `inside (${moved})`);
  assert.equal(moved[1], -1200, 'its height kept');
  /* On the line from where it was to the fighters. */
  const along = (moved[0] - 9000) * (-6000 - -14000) - (moved[2] - -14000) * (6000 - 9000);
  assert.ok(Math.abs(along) < 1e-6 * 1e8, 'on its line to them');
  assert.ok(Math.abs(Math.abs(moved[2]) - limit) < 2 || Math.abs(Math.abs(moved[0]) + Math.abs(moved[2]) - limit * Math.SQRT2) < 2, 'as far out as the walls let it');
  const corner = cameraInWalls([12000, -1200, 12000], [0, 0], limit);
  assert.ok(Math.abs(corner[0]) <= limit && Math.abs(corner[2]) <= limit, 'past a corner too');
});
