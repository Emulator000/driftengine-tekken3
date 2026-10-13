/**
 * A stage: its 36 cells of scenery as one mesh in 8 mm units, game
 * axes, with a texture atlas of the texture pages and palettes its polygons and its ground's tiles
 * use; and the ground's 100 map cells with their atlas UVs, which the game lays as a patch that
 * follows the fighters.
 *
 * The mesh format (`STG1` version 2, little-endian): u32 magic, u32 version, u32 vertex count,
 * u32 index count, u16 atlas width, u16 atlas height, u32 the model's cell size (its second word);
 * per cell of the 6 × 6 grid, u32 first index and u32 index count; per vertex 20 bytes: i16 x, y,
 * z (8 mm units), u8 r, g, b (128 is unchanged), u8 reserved, u16 u, v (atlas texels), u16
 * reserved, u16 reserved; then u32 indices, cell by cell.
 */
import { absoluteVram, packAtlas, packetTarget, readTimChain } from './texture.mjs';

export const STG_MAGIC = 0x31475453; // 'STG1'
/** The stage model's 6 × 6 grid of cells. */
const CELLS = 36;

/** A ground map's size, in tiles each way. */
const MAP = 10;
/**
 * A tile's corner UV offsets: four sets of four, each (u | v << 8), and the four orders a tile
 * takes them in (bits 25 and 26 of its first word).
 */
const PATTERNS = [
  [0x0000, 0x003f, 0x3f00, 0x3f3f],
  [0x3f00, 0x0000, 0x3f3f, 0x003f],
  [0x3f3f, 0x3f00, 0x003f, 0x0000],
  [0x003f, 0x3f3f, 0x0000, 0x3f00],
];
const ORDERS = [
  [0, 1, 2, 3],
  [1, 0, 3, 2],
  [2, 3, 0, 1],
  [3, 2, 1, 0],
];

/**
 * The ground's 100 map cells (the stage archive's second member): each entry is two words, the UV
 * base and texture page (the pattern set in bits 30 and 31, the corner order in 25 and 26), then
 * the palette. Each cell's four corners, in the order the game's quad takes them, with their UVs.
 */
function groundCells(map) {
  const view = new DataView(map.buffer, map.byteOffset, map.byteLength);
  const cells = [];
  for (let row = 0; row < MAP; row += 1) {
    for (let column = 0; column < MAP; column += 1) {
      const a = view.getUint32(4 + row * MAP * 8 + column * 8, true);
      const b = view.getUint32(8 + row * MAP * 8 + column * 8, true);
      const set = PATTERNS[a >>> 30];
      const order = ORDERS[(a >>> 25) & 3];
      const base = a & 0xffff;
      const uvs = [0, 1, 2, 3].map((k) => {
        const sum = base + set[order[k]];
        return [sum & 0xff, (sum >> 8) & 0xff];
      });
      cells.push({ target: packetTarget((a >>> 16) & 0x39ff, b >>> 16), uvs });
    }
  }
  return cells;
}

/** The ground file (`GND1`, little-endian): u32 magic, u32 version, then per map cell four corners of u16 u, v atlas texels. */
export const GND_MAGIC = 0x31444e47;

/**
 * A stage's files. With no model (`modelBytes` null: Tekken Ball's beach) the mesh has no polygons
 * and a cell size of 0; `tims` are its textures when they are not a chain in the first member.
 */
export function exportStage(modelBytes, textureMembers, encodePng, tims = readTimChain(textureMembers[0])) {
  const view = modelBytes === null ? null : new DataView(modelBytes.buffer, modelBytes.byteOffset, modelBytes.byteLength);
  const cellCount = view === null ? 0 : view.getUint32(8, true);
  const polygons = [];

  for (let c = 0; c < cellCount; c += 1) {
    const e = (k) => view.getInt32(12 + c * 28 + k * 4, true);
    const vertexAt = 12 + e(0);
    const count = e(5);
    if (count <= 0) continue;
    const vertex = (i) => [view.getInt16(vertexAt + i * 8, true), view.getInt16(vertexAt + i * 8 + 2, true), view.getInt16(vertexAt + i * 8 + 4, true)];
    let at = 12 + e(4);
    for (let p = 0; p < count; p += 1) {
      const w0 = view.getUint32(at, true);
      const code = w0 >>> 24;
      const rgb = [w0 & 0xff, (w0 >> 8) & 0xff, (w0 >> 16) & 0xff];
      if (code === 0x2c || code === 0x24) {
        const w1 = view.getUint32(at + 4, true);
        const w2 = view.getUint32(at + 8, true);
        const w3 = view.getUint32(at + 12, true);
        const w4 = view.getUint32(at + 16, true);
        const corners = code === 0x2c ? 4 : 3;
        const uvs = [w1 & 0xffff, w2 & 0xffff, w3 & 0xffff, w3 >>> 16].slice(0, corners).map((uv) => [uv & 0xff, uv >> 8]);
        const ids = [w4 & 0xff, (w4 >> 8) & 0xff, (w4 >> 16) & 0xff, w4 >>> 24].slice(0, corners);
        polygons.push({ cell: c, target: packetTarget(w2 >>> 16, w1 >>> 16), rgb, corners: ids.map((id, k) => ({ p: vertex(id), uv: uvs[k] })) });
        at += 20;
      } else if (code === 0x28) {
        const w1 = view.getUint32(at + 4, true);
        const ids = [w1 & 0xff, (w1 >> 8) & 0xff, (w1 >> 16) & 0xff, w1 >>> 24];
        polygons.push({ cell: c, target: null, rgb, corners: ids.map((id) => ({ p: vertex(id), uv: [0, 0] })) });
        at += 8;
      } else {
        throw new Error(`cell ${c}: polygon code ${code.toString(16)} is not one the stage renderer draws`);
      }
    }
  }

  const cells = textureMembers[1]?.length === 808 ? groundCells(textureMembers[1]) : [];

  const vram = absoluteVram(tims);
  const packed = packAtlas(vram, [
    ...polygons.map((p) => ({ target: p.target, uvs: p.corners.map((c) => c.uv) })),
    ...cells.map((c) => ({ target: c.target, uvs: c.uvs })),
  ]);
  const { width, height, atlas } = packed;

  const vertices = [];
  const indices = [];
  /* Per cell, where its polygons' indices start and how many, so the cells the game culls can be left out. */
  const cellRanges = Array.from({ length: CELLS }, () => [0, 0]);
  for (const polygon of polygons) {
    const base = vertices.length;
    if (cellRanges[polygon.cell][1] === 0) cellRanges[polygon.cell][0] = indices.length;
    for (const corner of polygon.corners) vertices.push([...corner.p, ...polygon.rgb, ...packed.place(polygon.target, corner.uv)]);
    if (polygon.corners.length === 3) indices.push(base, base + 1, base + 2);
    else indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    cellRanges[polygon.cell][1] = indices.length - cellRanges[polygon.cell][0];
  }
  const mesh = new Uint8Array(24 + CELLS * 8 + vertices.length * 20 + indices.length * 4);
  const out = new DataView(mesh.buffer);
  out.setUint32(0, STG_MAGIC, true);
  out.setUint32(4, 2, true);
  out.setUint32(8, vertices.length, true);
  out.setUint32(12, indices.length, true);
  out.setUint16(16, width, true);
  out.setUint16(18, height, true);
  out.setUint32(20, view === null ? 0 : view.getUint32(4, true), true);
  let at = 24;
  for (const [start, count] of cellRanges) {
    out.setUint32(at, start, true);
    out.setUint32(at + 4, count, true);
    at += 8;
  }
  for (const v of vertices) {
    for (let k = 0; k < 3; k += 1) out.setInt16(at + k * 2, v[k], true);
    for (let k = 0; k < 3; k += 1) out.setUint8(at + 6 + k, v[3 + k]);
    out.setUint16(at + 10, v[6], true);
    out.setUint16(at + 12, v[7], true);
    at += 20;
  }
  for (const i of indices) {
    out.setUint32(at, i, true);
    at += 4;
  }
  const ground = new Uint8Array(8 + cells.length * 16);
  const g = new DataView(ground.buffer);
  g.setUint32(0, GND_MAGIC, true);
  g.setUint32(4, 1, true);
  cells.forEach((cell, i) => {
    cell.uvs.forEach((uv, k) => {
      const [u, v] = packed.place(cell.target, uv);
      g.setUint16(8 + i * 16 + k * 4, u, true);
      g.setUint16(8 + i * 16 + k * 4 + 2, v, true);
    });
  });
  return { mesh, ground, map: textureMembers[1], atlas: encodePng(width, height, atlas), stats: { polygons: polygons.length, atlas: [width, height] } };
}
