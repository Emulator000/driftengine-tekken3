/**
 * The arcade board's reader on synthetic bytes: its chips recognised by their SHA-256 and joined a
 * pair at a time, a stage model's polygons of each kind read (their colours stored or shaded as the
 * fight runs, their corners, a tiled texture's window, a decal's layer over the polygon it lies on),
 * and a background taken from the game's tables (its tiles, mask and colours). And on the board's
 * own data, when `npm run arcade` has read it: every stage, background and moving piece reads.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ACCESSORY_TABLES, archiveAt, BACKGROUND_TABLES, identifyChips, joinData, joinPair, PROGRAM_CODE, PROGRAM_STAGES, sha256, STAGE_ARCHIVES, STAGE_OBJECTS } from '../scripts/lib/arcade/board.mjs';
import { exportArcadeBackground, exportArcadeObject, exportArcadeStage, readArcadeModel } from '../scripts/lib/arcade/stage.mjs';
import { arcadeFighters, boardAccessories, exportArcadeFighter, GARMENT, placeAccessories, readArcadeFighter, resolveArcadeFighter, standIn } from '../scripts/lib/arcade/fighter.mjs';
import { readFtr } from '../scripts/lib/ftr.mjs';
import { decompress } from '../scripts/lib/lz.mjs';
import { decodePng, encodePng } from '../scripts/lib/png.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('chips are found by their SHA-256 whatever they are called, and each pair joins even and odd bytes', () => {
  const a = Uint8Array.from([1, 3, 5]);
  const b = Uint8Array.from([2, 4, 6]);
  const chips = [
    { pair: 0, half: 0, sha256: sha256(a) },
    { pair: 0, half: 1, sha256: sha256(b) },
  ];
  const { found, missing, others } = identifyChips(
    [
      { name: 'anything', bytes: b },
      { name: 'else.bin', bytes: a },
      { name: 'stranger', bytes: Uint8Array.from([9]) },
    ],
    chips,
  );
  assert.deepEqual(missing, []);
  assert.deepEqual(others, ['stranger']);
  assert.deepEqual([...joinPair(a, b)], [1, 2, 3, 4, 5, 6]);
  assert.deepEqual([...joinData(found, 1)], [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(identifyChips([{ name: 'a', bytes: a }], chips).missing, [{ pair: 0, half: 1 }]);
});

/** A model of one cell: its vertices (x, y, z) and its polygons, each a list of 32-bit words. */
function model(vertices, polygons, shades = 0) {
  const words = polygons.flat();
  const bytes = new Uint8Array(12 + 28 + words.length * 4 + vertices.length * 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x41, true);
  view.setUint32(4, 0, true);
  view.setUint32(8, 1, true);
  const polygonsAt = 28;
  const verticesAt = polygonsAt + words.length * 4;
  [verticesAt, vertices.length, 0, shades, polygonsAt, polygons.length, 0].forEach((w, k) => view.setInt32(12 + k * 4, w, true));
  words.forEach((w, k) => view.setUint32(12 + polygonsAt + k * 4, w >>> 0, true));
  vertices.forEach(([x, y, z], k) => {
    view.setInt16(12 + verticesAt + k * 8, x, true);
    view.setInt16(12 + verticesAt + k * 8 + 2, y, true);
    view.setInt16(12 + verticesAt + k * 8 + 4, z, true);
  });
  return bytes;
}

/** A packet's first word: its command, its words less one, and whether its colours are stored. */
const head = (code, words, stored) => ((code << 24) | ((stored ? 1 : 0) << 16) | ((words - 1) << 8) | 9) >>> 0;
const halves = (lo, hi) => (lo | (hi << 16)) >>> 0;
const rgb = (r, g, b) => r | (g << 8) | (b << 16);

test('a stage model reads each kind of polygon: its colours stored or shaded, untextured or tiled, and a decal\'s layer', () => {
  const vertices = [
    [0, 0, 0],
    [100, 0, 0],
    [0, -100, 0],
    [100, -100, 0],
    [20, -20, 0],
    [80, -20, 0],
    [20, -80, 0],
    [80, -80, 0],
  ];
  const uv = (u, v) => u | (v << 8);
  const polygons = [
    /* A textured quad, its colour stored. */
    [head(0x2d, 8, true), halves(uv(0, 0), 0x1000), halves(uv(63, 0), 0x0008), uv(0, 63), uv(63, 63), rgb(10, 20, 30), halves(0, 1), halves(2, 3)],
    /* A textured triangle shaded at each corner, its colours stored. */
    [head(0x35, 9, true), halves(uv(0, 0), 0x1000), halves(uv(8, 0), 0x0008), uv(0, 8), rgb(1, 2, 3), rgb(4, 5, 6), rgb(7, 8, 9), halves(0, 1), halves(2, 0)],
    /* A textured quad the stage shades: its shade, then its corners. */
    [head(0x2c, 8, false), halves(uv(0, 0), 0x1000), halves(uv(8, 0), 0x0008), uv(0, 8), uv(8, 8), halves(0, 0), halves(1, 2), halves(3, 0)],
    /* An untextured triangle the stage shades at each corner, its colour before them. */
    [head(0x30, 5, false), rgb(0x30, 0x10, 0x20), halves(0, 0), halves(1, 1), halves(2, 2)],
    /* A tiled quad (the flag bit), its window in its third and fourth UV words' spare halves, and lying on the first: a decal. */
    [head(0xad, 8, true), halves(uv(0, 0), 0x1000), halves(uv(200, 0), 0x0008), halves(uv(0, 200), 32 | (16 << 8)), halves(uv(200, 200), 64 | (128 << 8)), rgb(128, 128, 128), halves(4, 5), halves(6, 7)],
  ];
  const { cellSize, grid, polygons: read } = readArcadeModel(model(vertices, polygons, 6));
  assert.equal(cellSize, 0);
  assert.equal(grid, 1);
  assert.equal(read.length, 5);
  assert.deepEqual(read[0].corners.map((c) => c.rgb), Array(4).fill([10, 20, 30]));
  assert.deepEqual(read[0].corners.map((c) => c.p), vertices.slice(0, 4));
  assert.equal(read[0].shaded, false);
  assert.deepEqual(read[1].corners.map((c) => c.rgb), [
    [1, 2, 3],
    [4, 5, 6],
    [7, 8, 9],
  ]);
  assert.equal(read[2].shaded, true);
  assert.deepEqual(read[2].corners.map((c) => c.p), vertices.slice(0, 4));
  assert.equal(read[3].target, null);
  assert.deepEqual(read[3].corners[0].rgb, [0x18, 0x08, 0x10]);
  assert.deepEqual(read[4].target.window, { maskU: 224, offsetU: 64, maskV: 240, offsetV: 128 });
  /* All in one plane, each over the ones before it, up to the last layer. */
  assert.deepEqual(read.map((p) => p.layer), [0, 1, 2, 3, 3]);
  assert.ok(read.every((p) => p.oneSided));
});

test('a background takes its tiles, mask and colours from the game\'s tables', () => {
  /* Two 4-bit tiles of 64 texels side by side in one page, each one colour through its own palette: red, then blue. */
  const tim = (x, y, colour, clutX) => {
    const clut = new Uint8Array(12 + 32);
    const cv = new DataView(clut.buffer);
    [clut.length, clutX | (480 << 16), 16 | (1 << 16)].forEach((w, k) => cv.setUint32(k * 4, w, true));
    for (let k = 0; k < 16; k += 1) cv.setUint16(12 + k * 2, colour, true);
    const image = new Uint8Array(12 + (64 * 64) / 2);
    const iv = new DataView(image.buffer);
    [image.length, x | (y << 16), 16 | (64 << 16)].forEach((w, k) => iv.setUint32(k * 4, w, true));
    const header = new Uint8Array(8);
    new DataView(header.buffer).setUint32(0, 0x10, true);
    new DataView(header.buffer).setUint32(4, 8, true);
    return [...header, ...clut, ...image];
  };
  const chain = Uint8Array.from([...tim(128, 0, 31, 0), ...tim(144, 0, 31 << 10, 16)]);
  const archive = new Uint8Array(4 + 16 + 4 + chain.length);
  const av = new DataView(archive.buffer);
  [2, 20, 4, 24, chain.length].forEach((w, k) => av.setUint32(k * 4, w, true));
  archive.set(chain, 24);

  /* Stage 1's tables in the code: two columns, a row, 180 degrees across the screen (16 tiles a turn). */
  const at = (address) => address - PROGRAM_CODE.base;
  const code = new Uint8Array(at(BACKGROUND_TABLES.colours) + BACKGROUND_TABLES.stages * 12);
  const cv = new DataView(code.buffer);
  const [tiles, palettes, mask] = [0x100, 0x110, 0x120].map((k) => PROGRAM_CODE.base + k);
  const layout = at(BACKGROUND_TABLES.layouts) + 20;
  cv.setInt16(layout, 2, true);
  cv.setInt16(layout + 2, 1, true);
  [tiles, palettes, mask].forEach((p, k) => cv.setUint32(layout + 4 + k * 4, p, true));
  cv.setInt16(layout + 16, -16, true);
  cv.setUint16(layout + 18, 180, true);
  cv.setInt16(at(BACKGROUND_TABLES.pitch) + 2, 288, true);
  [0x0200, 0x0201].forEach((w, k) => cv.setUint16(at(tiles) + k * 2, w, true));
  [480 << 6, (480 << 6) | 1].forEach((w, k) => cv.setUint16(at(palettes) + k * 2, w, true));
  code.set([0x31, 0x31, 100, 0x74], at(mask));
  code.set([1, 2, 3, 0, 4, 5, 6, 1, 7, 8, 9, 0], at(BACKGROUND_TABLES.colours) + 12);

  const { atlas, ...background } = exportArcadeBackground(code, 1, archive, encodePng);
  assert.deepEqual(background, {
    columns: 2,
    rows: 1,
    degrees: 180,
    perTurn: 16,
    mask: ['ppbt' + '.'.repeat(12)],
    offset: -16,
    pitch: 288,
    colours: { cell: [1, 2, 3], above: [4, 5, 6], below: [7, 8, 9], sky: [128, 0, 128] },
    drawn: { above: true, below: false },
  });
  const png = decodePng(atlas);
  assert.deepEqual([png.width, png.height], [128, 72]);
  const texel = (x, y) => [...png.rgba.subarray((y * 128 + x) * 4, (y * 128 + x) * 4 + 4)];
  assert.deepEqual(texel(10, 10), [255, 0, 0, 255]);
  assert.deepEqual(texel(100, 63), [0, 0, 255, 255]);
  assert.deepEqual(texel(100, 67), [0, 0, 255, 255], 'its last row repeated under it, so the white is not blended into it');
  assert.deepEqual(texel(64, 70), [255, 255, 255, 255]);
});

test('a board\'s fighter reads its blocks and blends a seam between two joints by its weights', () => {
  /* Three records: none, a joint leaving one vertex whole and one at half weight, a joint copying the first and adding its own to the second's. */
  const blocks = [];
  const block = (...w) => {
    blocks.push(w);
    return blocks.length - 1;
  };
  const point = (x, y, z) => [(x & 0xffff) | ((y & 0xffff) << 16), z & 0xffff];
  const records = [
    null,
    {
      vertices: block(2, ...point(10, 0, 0), ...point(20, 0, 0), 0, 2, 0 | (0x1000 << 16), 1 | (0x800 << 16), 0),
      normals: block(1, ...point(0, -4096, 0), 0, 0, 0),
      polygons: block(1, 0 | (1 << 8) | (0 << 16), 0, 0, 0, 0),
      texture: block(1, 0x0000 | (0x86 << 16), 0x0408, 0x0800, 0, 0, 0),
    },
    {
      vertices: block(1, ...point(5, 5, 5), 1, 0, 0, 1, 1 | (0x800 << 16)),
      normals: block(1, ...point(0, 0, 4096), 0, 0, 0),
      polygons: block(0, 0, 1, 0 | (1 << 8) | (0 << 16), 0, 0),
      texture: block(0, 0, 1, 0x1010 | (0x01 << 16), 0x1020 | (0x80 << 16), 0x2010, 0),
    },
  ];
  const header = 16 + records.length * 0x38;
  const at = [];
  let offset = header;
  for (const b of blocks) {
    at.push(offset);
    offset += b.length * 4;
  }
  const bytes = new Uint8Array(offset);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, records.length, true);
  bytes.set([0x33, 0x44, 0x4d, 0x4b], 8);
  records.forEach((r, i) => {
    if (r === null) return;
    [r.vertices, 0, r.normals, r.polygons, r.texture].forEach((b, k) => view.setInt32(16 + i * 0x38 + k * 4, k === 1 ? 0 : at[b], true));
    view.setInt32(16 + i * 0x38 + 8 * 4, i - 1, true);
  });
  blocks.forEach((b, k) => b.forEach((w, n) => view.setUint32(at[k] + n * 4, w >>> 0, true)));

  const model = readArcadeFighter(bytes);
  assert.equal(model.records[0], null);
  assert.deepEqual(model.records[1].vertices.left, [{ slot: 0, weight: 0x1000 }, { slot: 1, weight: 0x800 }]);
  const { polygons, problems } = resolveArcadeFighter(model);
  assert.deepEqual(problems, []);
  assert.equal(polygons.length, 2);
  /* The first joint draws its own points whole. */
  assert.deepEqual(polygons[0].corners.map((c) => c.position), [[{ joint: 1, p: [10, 0, 0], w: 1 }], [{ joint: 1, p: [20, 0, 0], w: 1 }], [{ joint: 1, p: [10, 0, 0], w: 1 }]]);
  assert.deepEqual(polygons[0].corners[0].uv, [0, 0]);
  assert.deepEqual(polygons[0].target, { page: { x: 0x1c & 0xf, y: 1, mode: 0 }, clut: { x: ((0x5c30 + 0x86) & 0x3f) * 16, y: (0x5c30 + 0x86) >> 6 } });
  /* The second joint's vertex blended half and half with the first's, and the first's other vertex copied whole. */
  assert.deepEqual(polygons[1].corners[0].position, [
    { joint: 2, p: [5, 5, 5], w: 0.5 },
    { joint: 1, p: [20, 0, 0], w: 0.5 },
  ]);
  assert.deepEqual(polygons[1].corners[1].position, [{ joint: 1, p: [10, 0, 0], w: 1 }]);
  assert.deepEqual(polygons[1].corners[1].normal, { joint: 2, n: [0, 0, 4096] });
  assert.equal(polygons[1].target.page.mode, 1, 'its page word an 8-bit one');
});

test('a board\'s accessory is turned as it loads and hangs on its own joint, at its rest with its spring\'s angles', () => {
  const block = (points) => ({ points, copied: [], left: [], added: [] });
  const records = Array(24).fill(null);
  records[18] = { index: 18, vertices: block([[10, 0, 0]]), normals: block([[4096, 0, 0]]), shapes: null, offset: [20, 0, -121], parent: 11, rest: [0, 0x4000, 0] };
  records[19] = { index: 19, vertices: block([[5, 0, 0]]), normals: block([[4096, 0, 0]]), shapes: null, offset: [100, 0, 0], parent: 18, rest: [0, 0, 0] };
  const spring = { reach: 128, keep: 128, pull: 64, slant: 192, axes: [1, 1, 1, 1, 1, 1], aim: null, knees: false, yawHeld: false, pitchAtLeast: null, limits: null, smoothing: 2, lean: false, clear: null };
  const board = Array.from({ length: 6 }, (_, k) => ({ shown: k < 2, turn: k === 0 ? [0, -0x8000, 0] : null, rest: k === 0 ? [0, 0x2000, 0] : [0, 0, 0], spring: k === 0 ? spring : null }));
  const { model, accessories, hung } = placeAccessories({ records }, board);
  /* Half a turn about the up axis as it loads, its points then on its own joint as they are. */
  assert.deepEqual(model.records[18].vertices.points, [[-10, 0, 0]]);
  assert.equal(accessories.get(18).joint, 18);
  assert.deepEqual(accessories.get(18).point([-10, 0, 0]), [-10, 0, 0]);
  assert.equal(accessories.get(19).joint, 19);
  assert.deepEqual(hung[0], { shown: true, parent: 11, offset: [20, 0, 121], rest: [0, 0x6000, 0], spring });
  assert.deepEqual(hung[1], { shown: true, parent: 18, offset: [100, 0, 0], rest: [0, 0, 0], spring: null });
  assert.deepEqual(hung.slice(2), [null, null, null, null]);
  /* One the board's tables leave out is not drawn, but still hangs for those on it. */
  const hidden = placeAccessories({ records }, board.map((b, k) => ({ ...b, shown: k === 1 })));
  assert.equal(hidden.model.records[18], null);
  assert.equal(hidden.accessories.has(18), false);
  assert.equal(hidden.hung[0].shown, false);
});

const arcade = path.join(root, '.cache/arcade');
const read = existsSync(path.join(arcade, 'data.bin')) && existsSync(path.join(arcade, 'program.bin'));
const skip = !read && 'no arcade data; run npm run arcade';

test('every arcade stage, background and moving piece reads from the board\'s data', { skip }, () => {
  const data = new Uint8Array(readFileSync(path.join(arcade, 'data.bin')));
  const program = new Uint8Array(readFileSync(path.join(arcade, 'program.bin')));
  const code = decompress(program, PROGRAM_CODE.at);
  const archives = [...[...STAGE_ARCHIVES].map(([s, at]) => [s, archiveAt(data, at)]), ...[...PROGRAM_STAGES].map(([s, at]) => [s, archiveAt(program, at)])].sort(([a], [b]) => a - b);
  for (const [s, archive] of archives) {
    const books = (STAGE_OBJECTS.get(s) ?? []).filter((o) => o.flipbook !== undefined).map((o) => o.flipbook);
    const stage = exportArcadeStage(archive, encodePng, books, program);
    assert.equal(stage.stats.grid, 16, `stage ${s}'s grid`);
    assert.ok(stage.stats.polygons > 300, `stage ${s}'s polygons`);
    for (const book of stage.books) assert.ok(book.stats.polygons > 0, `stage ${s}'s flipbook`);
    if (s < BACKGROUND_TABLES.stages) {
      const { atlas, columns, rows, perTurn, mask } = exportArcadeBackground(code, s, archive, encodePng);
      const png = decodePng(atlas);
      assert.deepEqual([png.width, png.height], [columns * 64, rows * 64 + 8], `stage ${s}'s panorama`);
      assert.ok(mask.length === rows && mask.every((row) => row.length === perTurn), `stage ${s}'s mask`);
    }
    for (const object of STAGE_OBJECTS.get(s) ?? []) {
      if (object.parts === undefined) continue;
      assert.ok(exportArcadeObject(program, object, encodePng).stats.polygons > 0, `stage ${s}'s ${object.name}`);
    }
  }
});

test('every fighter\'s accessories read from the board\'s tables: a spring\'s reach, its weights and its kinds', { skip }, () => {
  const program = new Uint8Array(readFileSync(path.join(arcade, 'program.bin')));
  const code = decompress(program, PROGRAM_CODE.at);
  let springs = 0;
  for (let fighter = 0; fighter < 32; fighter += 1) {
    for (const { spring } of boardAccessories(code, PROGRAM_CODE.base, ACCESSORY_TABLES, fighter)) {
      if (spring === null) continue;
      springs += 1;
      assert.ok(0 < spring.reach && spring.reach < 1024, `fighter ${fighter}'s reach ${spring.reach}`);
      assert.ok(0 <= spring.keep + spring.pull && spring.keep + spring.pull <= 256, `fighter ${fighter}'s weights`);
      assert.ok(1 <= spring.smoothing && spring.smoothing <= 4, `fighter ${fighter}'s smoothing ${spring.smoothing}`);
      if (spring.clear !== null) assert.ok(spring.clear.radius > 0 && spring.clear.joint < 18, `fighter ${fighter}'s clear`);
    }
  }
  assert.ok(springs > 40, `springs read: ${springs}`);
});

test('every fighter of the board\'s data reads and resolves, its seams\' weights summing to one', { skip }, () => {
  const fighters = arcadeFighters(new Uint8Array(readFileSync(path.join(arcade, 'data.bin'))));
  assert.equal(fighters.length, 32);
  fighters.forEach(({ model }, k) => {
    const { polygons, problems } = resolveArcadeFighter(readArcadeFighter(model));
    assert.deepEqual(problems, [], `fighter ${k}`);
    assert.ok(polygons.length > 400, `fighter ${k}'s polygons`);
  });
});

test('the board\'s one stand-in is for Julia\'s second costume (pack 21), which it has no model of', { skip }, () => {
  const fighters = arcadeFighters(new Uint8Array(readFileSync(path.join(arcade, 'data.bin'))));
  assert.deepEqual(fighters.flatMap((f, pack) => (standIn(f) ? [pack] : [])), [21]);
});

test('a board\'s fighter\'s coat hung on the hips alone is put on a joint of its own, a fighter with none has none', { skip }, () => {
  const program = new Uint8Array(readFileSync(path.join(arcade, 'program.bin')));
  const code = decompress(program, PROGRAM_CODE.at);
  const fighters = arcadeFighters(new Uint8Array(readFileSync(path.join(arcade, 'data.bin'))));
  const garmentOf = (pack) => {
    const result = exportArcadeFighter(fighters[pack], boardAccessories(code, PROGRAM_CODE.base, ACCESSORY_TABLES, pack), new Map(), encodePng);
    const mesh = readFtr(result.mesh);
    return { flagged: result.garment, header: mesh.garment, on: mesh.vertices.filter((v) => v.influences.every((f) => f.joint === GARMENT)).length };
  };
  const coat = garmentOf(15);
  assert.equal(coat.flagged, true);
  assert.equal(coat.header, GARMENT);
  assert.ok(coat.on > 20, `the coat's vertices on its joint: ${coat.on}`);
  assert.deepEqual(garmentOf(0), { flagged: false, header: 0, on: 0 });
});
