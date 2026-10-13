/**
 * What the presentation lays the arena by each frame, from the executable and the stages' files:
 *
 * - The ground's template (compressed at 0x8001e36c, the game's LZ: a flag byte for eight items,
 *   literal bytes or a big-endian pair of a back distance in 11 bits and a count in 5): 121
 *   vertices (x and z, signed halfwords) and 100 quads (four vertex numbers each), a 10 × 10 patch
 *   of 1800 mm tiles about its origin.
 * - Tekken Force's ground template (compressed at 0x8001e6c4, the same way): 44 vertices and 30
 *   quads, a 10 × 3 patch of 2500 mm tiles.
 * - The shade a ground corner takes by its depth past the fighters (0x8001df6c, 1024 bytes).
 * - Each stage's height (0x80025138, a halfword every four bytes) and the scenery grid's cell
 *   order (0x80025804, 36 halfwords).
 * - Per stage, from its files: the ground map's kind (`+0x324`) and shade strength (`+0x326`),
 *   and the scenery model's cell size (the model's word at 20; 0 for Tekken Ball's beach, 19,
 *   which has none, nor Tekken Force's stages, 15 to 18).
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const TEMPLATE = 0x8001e36c;
const FORCE_TEMPLATE = 0x8001e6c4;
const SHADES = 0x8001df6c;
const STAGE_HEIGHTS = 0x80025138;
const GRID_CELLS = 0x80025804;
const STAGES = 20;
const VERTICES = 121;
const QUADS = 100;
const FORCE_VERTICES = 44;
const FORCE_QUADS = 30;

/** The game's LZ from `at` in the executable, into a fresh buffer. */
function decompress(exe, at) {
  const out = [];
  let src = at;
  let flags = exe.u8(src);
  for (;;) {
    src += 1;
    if (flags === 0) break;
    for (let f = flags; 1 < f; f >>= 1) {
      if ((f & 1) === 0) {
        const pair = exe.u8(src) * 0x100 + exe.u8(src + 1);
        src += 2;
        let back = pair & 0x7ff;
        if (back === 0) back = 0x800;
        let count = pair >> 11;
        if (count === 0) count = 0x20;
        for (let k = 0; k < count; k += 1) out.push(out[out.length - back]);
      } else {
        out.push(exe.u8(src));
        src += 1;
      }
    }
    flags = exe.u8(src);
  }
  return new Uint8Array(out);
}

/** A ground template's vertices (x and z) and quads. */
function groundTemplate(exe, at, vertexCount, quadCount) {
  const template = decompress(exe, at);
  const view = new DataView(template.buffer);
  const vertices = 0xc + view.getUint32(0xc, true);
  const quads = 0xc + view.getUint32(0x1c, true);
  return {
    vertices: Array.from({ length: vertexCount }, (_, v) => [view.getInt16(vertices + v * 4 + 2, true), view.getInt16(vertices + v * 4, true)]),
    quads: Array.from({ length: quadCount }, (_, q) => [0, 1, 2, 3].map((k) => template[quads + q * 4 + k])),
  };
}

export function arenaTables(exe, root) {
  const stages = Array.from({ length: STAGES }, (_, stage) => {
    const file = (ext) => path.join(root, `public/data/stages/${String(stage).padStart(2, '0')}.${ext}`);
    if (!existsSync(file('map')) || !existsSync(file('stg'))) return null;
    const map = new DataView(new Uint8Array(readFileSync(file('map'))).buffer);
    const model = new DataView(new Uint8Array(readFileSync(file('stg'))).buffer);
    return { groundKind: map.getInt16(0x324, true), shadeStrength: map.getInt16(0x326, true), cellSize: model.getUint32(20, true) };
  });
  return {
    ground: groundTemplate(exe, TEMPLATE, VERTICES, QUADS),
    forceGround: groundTemplate(exe, FORCE_TEMPLATE, FORCE_VERTICES, FORCE_QUADS),
    shades: Array.from({ length: 0x400 }, (_, i) => exe.u8(SHADES + i)),
    stageHeights: Array.from({ length: STAGES }, (_, stage) => exe.s16(STAGE_HEIGHTS + stage * 4)),
    gridCells: Array.from({ length: 36 }, (_, i) => exe.s16(GRID_CELLS + i * 2)),
    stages,
  };
}
