/**
 * The arcade board's reader on synthetic bytes: its chips recognised by their SHA-256 and joined a
 * pair at a time, a stage model's polygons of each kind read (their colours stored or shaded as the
 * fight runs, their corners, a tiled texture's window, a decal's layer over the polygon it lies on),
 * and a panorama laid from its tiles. And on the board's own data, when `npm run arcade` has read
 * it: every stage, panorama and moving piece reads.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { archiveAt, identifyChips, joinData, joinPair, PROGRAM_STAGES, sha256, STAGE_ARCHIVES, STAGE_OBJECTS, STAGE_PANORAMAS } from '../scripts/lib/arcade/board.mjs';
import { exportArcadeObject, exportArcadePanorama, exportArcadeStage, readArcadeModel } from '../scripts/lib/arcade/stage.mjs';
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

test('a panorama is laid from its tiles a row at a time, its top fading and its sky\'s colours taken', () => {
  /* Two 4-bit tiles of 64 texels, each one colour through its own palette: red, then blue. */
  const tile = (colour) => {
    const clut = new Uint8Array(12 + 32);
    const cv = new DataView(clut.buffer);
    cv.setUint32(0, clut.length, true);
    cv.setUint16(8, 16, true);
    cv.setUint16(10, 1, true);
    for (let k = 0; k < 16; k += 1) cv.setUint16(12 + k * 2, colour, true);
    const image = new Uint8Array(12 + 64 * 64 / 2);
    const iv = new DataView(image.buffer);
    iv.setUint32(0, image.length, true);
    iv.setUint16(8, 16, true);
    iv.setUint16(10, 64, true);
    const header = new Uint8Array(8);
    new DataView(header.buffer).setUint32(0, 0x10, true);
    new DataView(header.buffer).setUint32(4, 8, true);
    return [...header, ...clut, ...image];
  };
  const chain = Uint8Array.from([...tile(31), ...tile(31 << 10)]);
  const archive = new Uint8Array(4 + 16 + 4 + chain.length);
  const av = new DataView(archive.buffer);
  av.setUint32(0, 2, true);
  av.setUint32(4, 20, true);
  av.setUint32(8, 4, true);
  av.setUint32(12, 24, true);
  av.setUint32(16, chain.length, true);
  archive.set(chain, 24);
  const result = exportArcadePanorama(archive, { first: 0, count: 2, columns: 1 }, encodePng);
  const png = decodePng(result.atlas);
  assert.deepEqual([png.width, png.height], [64, 128]);
  assert.deepEqual(result.top, [255, 0, 0]);
  assert.deepEqual(result.bottom, [0, 0, 255]);
  assert.equal(png.rgba[3], 0);
  assert.equal(png.rgba[(127 * 64) * 4 + 3], 255);
});

const arcade = path.join(root, '.cache/arcade');
const read = existsSync(path.join(arcade, 'data.bin')) && existsSync(path.join(arcade, 'program.bin'));
const skip = !read && 'no arcade data; run npm run arcade';

test('every arcade stage, panorama and moving piece reads from the board\'s data', { skip }, () => {
  const data = new Uint8Array(readFileSync(path.join(arcade, 'data.bin')));
  const program = new Uint8Array(readFileSync(path.join(arcade, 'program.bin')));
  const archives = [...STAGE_ARCHIVES.map((at, s) => [s, archiveAt(data, at)]), ...[...PROGRAM_STAGES].map(([s, at]) => [s, archiveAt(program, at)])];
  for (const [s, archive] of archives) {
    const books = (STAGE_OBJECTS.get(s) ?? []).filter((o) => o.flipbook !== undefined).map((o) => o.flipbook);
    const stage = exportArcadeStage(archive, encodePng, books, program);
    assert.equal(stage.stats.grid, 16, `stage ${s}'s grid`);
    assert.ok(stage.stats.polygons > 300, `stage ${s}'s polygons`);
    for (const book of stage.books) assert.ok(book.stats.polygons > 0, `stage ${s}'s flipbook`);
    const layout = STAGE_PANORAMAS.get(s);
    if (layout !== undefined) {
      const png = decodePng(exportArcadePanorama(archive, layout, encodePng).atlas);
      assert.equal(png.width, layout.columns * 64, `stage ${s}'s panorama`);
    }
    for (const object of STAGE_OBJECTS.get(s) ?? []) {
      if (object.parts === undefined) continue;
      assert.ok(exportArcadeObject(program, object, encodePng).stats.polygons > 0, `stage ${s}'s ${object.name}`);
    }
  }
});
