/**
 * An arcade stage's scenery drawn in blocks: its 16 × 16 cells' solid polygons merged by kind over
 * blocks of 8, 4 and 2 cells a side, so the cells shown whole are drawn in a few draws rather than
 * one a cell and a kind; a block with a cell hidden or fading drawn by its smaller blocks and cells.
 * Whatever the cells show, the triangles drawn are those drawn cell by cell.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createStage, wholePieces } from '../src/present/3d/stage/stage.ts';

const GRID = 16;
/** A vertex's flags: seen from its front only; its layer; its texture's clear texels. */
const ONE_SIDED = 2;
const LAYER = (n) => n << 2;
const CUT = 16;

/** A version 3 stage of `grid` × `grid` cells, each cell's triangles given as [x, z, flags] (one triangle a corner at x, z, its flags). */
function stageBuffer(cells, grid = GRID) {
  const vertices = [];
  const indices = [];
  const ranges = [];
  cells.forEach((triangles) => {
    const start = indices.length;
    for (const [x, z, flags] of triangles) {
      for (const [dx, dz] of [[0, 0], [10, 0], [0, 10]]) {
        indices.push(vertices.length);
        vertices.push({ x: x + dx, y: 0, z: z + dz, flags });
      }
    }
    ranges.push([start, indices.length - start]);
  });
  const header = 28 + ranges.length * 8;
  const buffer = new ArrayBuffer(header + vertices.length * 20 + indices.length * 4);
  const view = new DataView(buffer);
  view.setUint32(0, 0x31475453, true);
  view.setUint32(4, 3, true);
  view.setUint32(8, vertices.length, true);
  view.setUint32(12, indices.length, true);
  view.setUint16(16, 256, true);
  view.setUint16(18, 256, true);
  view.setUint32(20, 1000, true);
  view.setUint32(24, grid, true);
  ranges.forEach(([start, count], c) => {
    view.setUint32(28 + c * 8, start, true);
    view.setUint32(32 + c * 8, count, true);
  });
  vertices.forEach((v, i) => {
    const at = header + i * 20;
    view.setInt16(at, v.x, true);
    view.setInt16(at + 2, v.y, true);
    view.setInt16(at + 4, v.z, true);
    for (let k = 0; k < 3; k += 1) view.setUint8(at + 6 + k, 128);
    view.setUint8(at + 9, v.flags);
  });
  indices.forEach((i, k) => view.setUint32(header + vertices.length * 20 + k * 4, i, true));
  return buffer;
}

/** A renderer that keeps each mesh's data, for the triangles a piece holds. */
const renderer = { createMesh: (data) => ({ data }) };

/** A piece's triangles, each by its corners' places, sorted. */
const trianglesOf = (pieces) =>
  pieces
    .flatMap((piece) => {
      const { positions, indices } = piece.mesh.data;
      const out = [];
      for (let t = 0; t < indices.length; t += 3) out.push([0, 1, 2].map((k) => [0, 1, 2].map((c) => Math.round(positions[indices[t + k] * 3 + c] / 0.008)).join(',')).join(' '));
      return out;
    })
    .sort();

/** Every cell some triangles: most of them a solid one in layer 0, some another layer, some seen from the front, some cut out. */
const cells = Array.from({ length: GRID * GRID }, (_, c) => {
  const [x, z] = [(c % GRID) * 100, Math.floor(c / GRID) * 100];
  const triangles = [[x, z, LAYER(0)]];
  if (c % 3 === 0) triangles.push([x + 20, z, LAYER(1)]);
  if (c % 5 === 0) triangles.push([x + 40, z, ONE_SIDED]);
  if (c % 7 === 0) triangles.push([x + 60, z, CUT]);
  return c % 11 === 4 ? [] : triangles;
});

/** The pieces drawn whole cell by cell: a cell's solid pieces where it is shown whole. */
function cellByCell(stage, shown, oneSided) {
  return stage.cells.flatMap((cell, i) => (shown[i] === 1 ? cell.filter((p) => !p.cut && p.oneSided === oneSided) : []));
}

test('an arcade stage is drawn in blocks of 8, 4 and 2 cells a side, each a merged piece for each kind its cells hold, the cut-out pieces left to the cells', () => {
  const stage = createStage(renderer, stageBuffer(cells), {});
  assert.deepEqual(stage.blocks.map((level) => level.size), [8, 4, 2]);
  for (const level of stage.blocks) {
    assert.equal(level.blocks.length, (GRID / level.size) ** 2, `${level.size}: every block of the grid`);
    for (const piece of level.blocks.flat()) assert.equal(piece.cut, false, 'no cut-out piece merged');
  }
  /* The first block of 8: its cells' solid triangles, every one of them, merged by kind. */
  const inBlock = (c, size, bx, by) => Math.floor((c % GRID) / size) === bx && Math.floor(Math.floor(c / GRID) / size) === by;
  const solid = stage.cells.flatMap((cell, c) => (inBlock(c, 8, 0, 0) ? cell.filter((p) => !p.cut) : []));
  assert.deepEqual(trianglesOf(stage.blocks[0].blocks[0]), trianglesOf(solid));
  assert.equal(new Set(stage.blocks[0].blocks[0].map((p) => `${p.layer} ${p.oneSided}`)).size, stage.blocks[0].blocks[0].length, 'one piece a kind');
});

test("whatever the cells show (all whole, some hidden, some fading), the solid pieces drawn whole draw the cells' own triangles, in fewer draws where blocks are whole", () => {
  const stage = createStage(renderer, stageBuffer(cells), {});
  const ways = {
    'all whole': () => 1,
    'a corner hidden': (i) => ((i % GRID) < 3 && Math.floor(i / GRID) < 3 ? 0 : 1),
    'a row fading': (i) => (Math.floor(i / GRID) === 9 ? 0.5 : 1),
    scattered: (i) => [1, 1, 1, 0, 1, 0.25, 1][i % 7],
  };
  for (const [what, show] of Object.entries(ways)) {
    const shown = Float32Array.from({ length: GRID * GRID }, (_, i) => show(i));
    for (const oneSided of [false, true]) {
      const drawn = [];
      wholePieces(stage, shown, oneSided, false, drawn);
      const own = cellByCell(stage, shown, oneSided);
      assert.deepEqual(trianglesOf(drawn), trianglesOf(own), `${what}, ${oneSided ? 'front only' : 'both sides'}: the same triangles`);
      assert.ok(drawn.length <= own.length, `${what}: no more draws (${drawn.length} against ${own.length})`);
      if (what === 'all whole') assert.ok(drawn.length * 4 < own.length, `all whole: a few draws (${drawn.length} against ${own.length})`);
    }
  }
});

test('under the ceiling the overhead pieces of the cells not whole are drawn whole too, as cell by cell', () => {
  const stage = createStage(renderer, stageBuffer(cells), {}, null, false, -1);
  const shown = Float32Array.from({ length: GRID * GRID }, (_, i) => (i % 2 === 0 ? 0 : 1));
  const drawn = [];
  wholePieces(stage, shown, false, true, drawn);
  const own = stage.cells.flatMap((cell, i) => cell.filter((p) => !p.cut && !p.oneSided && (shown[i] === 1 || p.overhead === true)));
  assert.deepEqual(trianglesOf(drawn), trianglesOf(own));
});

test("a disc stage's 6 × 6 cells are drawn cell by cell, without blocks", () => {
  const disc = Array.from({ length: 36 }, (_, c) => [[(c % 6) * 100, Math.floor(c / 6) * 100, LAYER(0)]]);
  assert.deepEqual(createStage(renderer, stageBuffer(disc, 6), {}).blocks, []);
});

test("each cell's bounding sphere holds all its polygons' corners", () => {
  const stage = createStage(renderer, stageBuffer(cells), {});
  cells.forEach((triangles, c) => {
    const [x, y, z, r] = stage.cellBounds.subarray(c * 4, c * 4 + 4);
    if (triangles.length === 0) return assert.equal(r, 0, 'an empty cell none');
    for (const [tx, tz] of triangles) {
      for (const [dx, dz] of [[0, 0], [10, 0], [0, 10]]) {
        const p = [(tx + dx) * 0.008, 0, -(tz + dz) * 0.008];
        assert.ok(Math.hypot(p[0] - x, p[1] - y, p[2] - z) <= r + 1e-6, `cell ${c}: a corner within`);
      }
    }
  });
});

test('only the cells in view are drawn: a block none of whose cells is in view is left out, a whole block in view drawn whole, and a cell out of view left out', () => {
  const stage = createStage(renderer, stageBuffer(cells), {});
  /* Cell 12,12 hidden; in view, the left half of the grid and cell 13,13 beside the hidden one. */
  const shown = Float32Array.from({ length: GRID * GRID }, (_, i) => (i === 12 * GRID + 12 ? 0 : 1));
  const seen = Uint8Array.from({ length: GRID * GRID }, (_, i) => ((i % GRID) < 8 || i === 13 * GRID + 13 ? 1 : 0));
  const drawn = [];
  wholePieces(stage, shown, false, false, drawn, seen);
  const triangles = new Set(trianglesOf(drawn));
  for (let i = 0; i < GRID * GRID; i += 1) {
    const [x, y] = [i % GRID, Math.floor(i / GRID)];
    const own = trianglesOf(stage.cells[i].filter((p) => !p.cut && !p.oneSided));
    const expected = x < 8 || (x === 13 && y === 13);
    for (const t of own) assert.equal(triangles.has(t), expected, `cell ${x},${y}: ${expected ? 'drawn' : 'left out'}`);
  }
  /* The left half whole and in view: its two blocks of 8, a piece a kind each. */
  assert.ok(drawn.length < 12, `few draws (${drawn.length})`);
});
