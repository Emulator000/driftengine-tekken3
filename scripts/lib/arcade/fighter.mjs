/**
 * A fighter from the arcade board's data, in the form the player draws (`FTR` version 5,
 * `scripts/lib/ftr.mjs`): each vertex a joint-space point or a seam blended between two joints by
 * its own weights, with the board's textures; its accessories (hair, a tail, a sash) each on its
 * own joint, which the fight swings on the board's spring; and its garment (a coat's panels: the
 * hips' polygons drawn both faces and hung on the hips alone) on a joint of its own, `GARMENT`,
 * which the player poses as the hips and keeps off the thighs.
 *
 * A board's model has the disc's header and part records, one record a joint (0 to 17 the body,
 * 18 to 23 accessories), its points in the joint's frame as the game's are but for the feet's, a
 * quarter turn about the up axis, and an accessory's, which its tables turn as the fighter loads.
 * Its blocks differ:
 *   vertices  a count and the points (x, y, z, a spare halfword); a count and the shared slots the
 *             vertices after them are copied from; a count and, from the first point on, a slot and
 *             a weight (4096ths) each, a point left in its slot whole or weighed; a count and, from
 *             the next point on, the same, a point weighed and added to what its slot holds (the
 *             blend kept in the slot and drawn), or left there whole
 *   normals   the same: the normals, the slots copied from, and the two lists
 *   polygons  flat triangles (three vertex bytes and a flags byte, a colour), flat quads (four
 *             vertex bytes, a colour and a flags byte), smooth triangles (three vertex bytes and a
 *             flags byte, three colours), smooth quads (four vertex bytes, four colours, a flags
 *             byte); a flags byte's top bit draws both faces
 *   texture   per polygon, three words: the first corner's place and the palette, the second's and
 *             the page, the third's (and a quad's fourth's), the palette and the page from the
 *             fighter's place in VRAM
 *   shapes    a hand's: a table of vertex blocks by its step, or 0 to keep the one drawn
 */
import { facingNormals } from '../facing.mjs';
import { KEEP_SHAPE, writeFtr5 } from '../ftr.mjs';
import { absoluteVram, packAtlas, readTimChain } from '../texture.mjs';

/** The archive of the fighters, a texture chain then a model each, in the disc's pack order. */
export const FIGHTER_ARCHIVE = 0x7f3c;
const RECORD = 0x38;
/** The body's joints; the first of the accessories; the accessories' records. */
const BODY = 18;
const ACCESSORIES = 6;
/** The hips' joint; the joint a garment hung on the hips is put on. */
const HIPS = 11;
export const GARMENT = 24;
/** A whole weight; how far the board's two weights of a seam may sum from it (its rounding). */
const WHOLE = 0x1000;
const ROUNDING = 2 / WHOLE;
/** The fighter's place in the board's VRAM: its pages from page 0x1c, its palettes from palette word 0x5c30. */
const PAGE_BASE = 0x1c;
const PALETTE_BASE = 0x5c30;
const IMAGE_ORIGIN = { x: 12 * 64, y: 256 };
const PALETTE_ORIGIN = { x: (PALETTE_BASE & 0x3f) * 16, y: PALETTE_BASE >> 6 };
const VRAM_ROWS = 1024;

/** The fighters the board's archive holds: a texture chain and a model each. */
export function arcadeFighters(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = view.getUint32(FIGHTER_ARCHIVE, true);
  const member = (i) => {
    const at = FIGHTER_ARCHIVE + view.getUint32(FIGHTER_ARCHIVE + 4 + i * 8, true);
    return data.subarray(at, at + view.getUint32(FIGHTER_ARCHIVE + 8 + i * 8, true));
  };
  return Array.from({ length: count >> 1 }, (_, k) => ({ textures: member(k * 2), model: member(k * 2 + 1) }));
}

function reader(bytes, at) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    get at() {
      return at;
    },
    u32() {
      const v = view.getUint32(at, true);
      at += 4;
      return v;
    },
    point() {
      const p = [view.getInt16(at, true), view.getInt16(at + 2, true), view.getInt16(at + 4, true)];
      at += 8;
      return p;
    },
  };
}

const list = (r, each) => Array.from({ length: r.u32() }, () => each(r));
const entry = (r) => {
  const w = r.u32();
  return { slot: w & 0xffff, weight: w >>> 16 };
};

/** A vertex or normal block: its points, the slots copied after them, and the two weighted lists. */
function pointBlock(bytes, at) {
  const r = reader(bytes, at);
  const points = list(r, (r) => r.point());
  const copied = list(r, (r) => r.u32());
  const left = list(r, entry);
  const added = list(r, entry);
  return { points, copied, left, added };
}

function polygonBlock(bytes, at) {
  const r = reader(bytes, at);
  const bytesOf = (w, n) => Array.from({ length: n }, (_, k) => (w >>> (k * 8)) & 0xff);
  const ft3 = list(r, (r) => {
    const w = r.u32();
    const k = r.u32();
    return { v: bytesOf(w, 3), c: [k & 0xff], doubleSided: (w & 0x80000000) !== 0 };
  });
  const ft4 = list(r, (r) => {
    const w = r.u32();
    const k = r.u32();
    return { v: bytesOf(w, 4), c: [k & 0xff], doubleSided: (k & 0x8000) !== 0 };
  });
  const gt3 = list(r, (r) => {
    const w = r.u32();
    const k = r.u32();
    return { v: bytesOf(w, 3), c: bytesOf(k, 3), doubleSided: (w & 0x80000000) !== 0 };
  });
  const gt4 = list(r, (r) => {
    const w = r.u32();
    const k = r.u32();
    const f = r.u32();
    return { v: bytesOf(w, 4), c: bytesOf(k, 4), doubleSided: (f & 0x80) !== 0 };
  });
  return { ft3, ft4, gt3, gt4 };
}

/** Per polygon kind, each polygon's corners' places in its page, its page and its palette words (from the fighter's place). */
function textureBlock(bytes, at) {
  const r = reader(bytes, at);
  const one = (corners) => (r) => {
    const a = r.u32();
    const b = r.u32();
    const c = r.u32();
    const uv = (h) => [h & 0xff, (h >>> 8) & 0xff];
    const uvs = [uv(a & 0xffff), uv(b & 0xffff), uv(c & 0xffff)];
    if (corners === 4) uvs.push(uv(c >>> 16));
    return { uvs, page: PAGE_BASE + (b >>> 16), palette: PALETTE_BASE + (a >>> 16) };
  };
  return { ft3: list(r, one(3)), ft4: list(r, one(4)), gt3: list(r, one(3)), gt4: list(r, one(4)) };
}

/** A hand's shapes: the table of blocks by step, up to the next block any record names, each block read once. */
function shapeBlocks(bytes, at, end) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const table = [];
  for (let k = at; k + 4 <= end; k += 4) table.push(view.getUint32(k, true));
  const read = new Map();
  const steps = table.map((w) => {
    if (w === 0) return null;
    if (!read.has(w)) read.set(w, pointBlock(bytes, w));
    return read.get(w);
  });
  return { table, steps };
}

/** A board's model: per record, its blocks, its offset from its parent and its parent. */
export function readArcadeFighter(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(...bytes.subarray(8, 12)) !== '3DMK') throw new Error('not a 3DMK model');
  const count = view.getUint32(0, true);
  const word = (i, k) => view.getInt32(16 + i * RECORD + k * 4, true);
  const starts = [];
  for (let i = 0; i < count; i += 1) for (let k = 0; k < 5; k += 1) if (word(i, k) > 0) starts.push(word(i, k));
  const next = (at) => Math.min(...starts.filter((w) => w > at), bytes.length);
  const records = Array.from({ length: count }, (_, i) => {
    if (word(i, 0) <= 0) return null;
    const vertices = pointBlock(bytes, word(i, 0));
    if (vertices.points.length === 0) return null;
    return {
      index: i,
      vertices,
      shapes: word(i, 1) > 0 ? shapeBlocks(bytes, word(i, 1), next(word(i, 1))) : null,
      normals: pointBlock(bytes, word(i, 2)),
      polygons: polygonBlock(bytes, word(i, 3)),
      texture: textureBlock(bytes, word(i, 4)),
      offset: [word(i, 5), word(i, 6), word(i, 7)],
      parent: word(i, 8),
      /* An accessory's rest: three 16-bit angles, the low halves of its words. */
      rest: [9, 10, 11].map((k) => (word(i, k) << 16) >> 16),
    };
  });
  return { records };
}

/**
 * A fighter's accessories as the board's tables give them (`code`, the program's code unpacked;
 * `tables`, where the tables lie): per record from 18, whether it is drawn, the turn its points are
 * given as the fighter loads (or null), the angles its spring adds to its rest, and its spring as the
 * fight swings it (null where it does not swing).
 */
export function boardAccessories(code, base, tables, fighter) {
  const view = new DataView(code.buffer, code.byteOffset, code.byteLength);
  const at = (address) => address - base;
  const half = (address) => view.getInt16(at(address), true);
  const angles = (address) => [0, 1, 2].map((c) => half(address + c * 2));
  const row = (r) => Array.from({ length: 6 }, (_, c) => view.getInt8(at(tables.axes) + r * 6 + c));
  const limits = tables.limits.get(fighter);
  return Array.from({ length: ACCESSORIES }, (_, k) => {
    const shown = code[at(tables.shown) + fighter * ACCESSORIES + BODY + k];
    const block = view.getUint32(at(tables.springs) + (fighter * ACCESSORIES + k) * 4, true);
    const s = (n) => half(block + n * 2);
    const kind = s(9);
    const spring =
      block === tables.none
        ? null
        : {
            reach: s(7),
            keep: s(5),
            pull: s(6),
            slant: s(8),
            axes: row(s(3)),
            aim: kind === 1 ? { joint: s(10), point: [s(11), s(12), s(13)], weights: [row(s(14))[5], row(s(14))[4]], behind: null } : null,
            knees: false,
            yawHeld: false,
            pitchAtLeast: null,
            limits: limits === undefined ? null : [half(limits), half(limits + 2)],
            smoothing: s(4),
            lean: false,
            clear: kind === 2 ? { joint: s(10), along: [s(12), s(13)], radius: s(14) } : null,
          };
    return { shown: shown !== 0, turn: shown > 1 ? angles(tables.turns + shown * 8) : null, rest: angles(block), spring };
  });
}

/** Rz · Ry · Rx from three 16-bit turns, as the game builds a joint's rest. */
function euler([rx, ry, rz]) {
  const a = (t) => (t / 0x10000) * 2 * Math.PI;
  const [sx, cx, sy, cy, sz, cz] = [Math.sin(a(rx)), Math.cos(a(rx)), Math.sin(a(ry)), Math.cos(a(ry)), Math.sin(a(rz)), Math.cos(a(rz))];
  return [
    [cy * cz, sy * sx * cz - cx * sz, sx * sz + sy * cx * cz],
    [cy * sz, cx * cz + sy * sx * sz, cx * sz * sy - sx * cz],
    [-sy, sx * cy, cy * cx],
  ];
}
const apply = (m, p) => m.map((r) => r[0] * p[0] + r[1] * p[1] + r[2] * p[2]);
const s16 = (v) => (v << 16) >> 16;

/** A block's points and normals turned, as the board turns an accessory's as the fighter loads. */
function turned(block, turn) {
  const m = euler(turn);
  return { ...block, points: block.points.map((p) => apply(m, p).map(Math.round)) };
}

/**
 * The board's accessories as it draws them: those its tables leave out gone, the rest turned as the
 * fighter loads, each on its own joint (18 on), the fight swinging it on its spring
 * (`resolveArcadeFighter`'s `accessories`); and each as the fight hangs it (`OwnAccessory`): drawn,
 * its parent joint, its offset (z negated, as the game reads it), its rest with its spring's angles,
 * and its spring.
 */
export function placeAccessories(model, board) {
  const records = model.records.map((r, i) => {
    if (r === null || i < BODY) return r;
    const { shown, turn } = board[i - BODY];
    if (!shown) return null;
    if (turn === null) return r;
    return { ...r, vertices: turned(r.vertices, turn), normals: turned(r.normals, turn), shapes: r.shapes && { ...r.shapes, steps: r.shapes.steps.map((b) => b && turned(b, turn)) } };
  });
  const accessories = new Map();
  const hung = [];
  for (let k = 0; k < ACCESSORIES; k += 1) {
    const r = model.records[BODY + k];
    if (r === null || r.parent < 0) {
      hung.push(null);
      continue;
    }
    const { shown, rest, spring } = board[k];
    if (shown) accessories.set(BODY + k, { joint: BODY + k, point: (p) => p, normal: (n) => n });
    hung.push({ shown, parent: r.parent, offset: [r.offset[0], r.offset[1], -r.offset[2] | 0], rest: r.rest.map((v, c) => s16(v + rest[c])), spring });
  }
  return { model: { records }, accessories, hung };
}
const scaled = (terms, s) => terms.map((t) => ({ ...t, w: t.w * s }));

/** The feet's joints, whose points the board keeps a quarter turn about the up axis from the game's: (x, y, z) is the game's (-z, y, x). */
const FEET = new Set([14, 17]);
const toGame = (joint, p) => (FEET.has(joint) ? [-p[2], p[1], p[0]] : p);

/**
 * The fighter's polygons, as the board draws them in record order: each corner's position as joint
 * terms (a point and its weight; a seam's two weights sum to one), its normal (a joint's), its
 * place in its page and its target in the board's VRAM. `vertexBlocks` puts a hand's shape in its
 * record's place; `accessories`, by record, places each accessory drawn (`placeAccessories`), the
 * others left out.
 */
export function resolveArcadeFighter(model, vertexBlocks = new Map(), accessories = new Map()) {
  const cache = new Map();
  const colours = new Map();
  const polygons = [];
  const problems = [];
  for (const record of model.records) {
    if (record === null) continue;
    /* An accessory is drawn where it is placed: on a joint, its points and normals given in that joint's frame. */
    const placed = record.index < BODY ? { joint: record.index, point: (p) => toGame(record.index, p), normal: (n) => toGame(record.index, n) } : accessories.get(record.index);
    if (placed === undefined) continue;
    const { joint } = placed;
    const vb = vertexBlocks.get(record.index) ?? record.vertices;
    const local = vb.points.map((p) => [{ joint, p: placed.point(p), w: 1 }]);
    for (const slot of vb.copied) {
      if (!cache.has(slot)) problems.push(`record ${record.index}: slot ${slot} copied before it is left`);
      local.push(cache.get(slot) ?? []);
    }
    let v = 0;
    for (const { slot, weight } of vb.left) {
      cache.set(slot, weight === WHOLE ? local[v] : scaled(local[v], weight / WHOLE));
      v += 1;
    }
    for (const { slot, weight } of vb.added) {
      if (weight !== WHOLE) local[v] = [...scaled(local[v], weight / WHOLE), ...(cache.get(slot) ?? [])];
      cache.set(slot, local[v]);
      v += 1;
    }

    const nb = record.normals;
    const normals = nb.points.map((n) => ({ joint, n: placed.normal(n) }));
    for (const slot of nb.copied) normals.push(colours.get(slot) ?? null);
    let c = 0;
    for (const { slot } of nb.left) colours.set(slot, normals[c++]);
    for (const { slot, weight } of nb.added) {
      /* A seam's normal is the drawing part's own: the board halves and adds the two lights. */
      if (weight === WHOLE || !colours.has(slot)) colours.set(slot, normals[c]);
      c += 1;
    }

    for (const kind of ['ft3', 'ft4', 'gt3', 'gt4']) {
      record.polygons[kind].forEach((poly, i) => {
        const tex = record.texture[kind][i];
        if (tex === undefined) problems.push(`record ${record.index} ${kind} ${i}: no texture`);
        const corners = poly.v.map((slot, k) => ({
          position: local[slot],
          normal: normals[poly.c.length === 1 ? poly.c[0] : poly.c[k]],
          uv: tex?.uvs[k],
        }));
        for (const corner of corners) {
          const weight = (corner.position ?? []).reduce((a, t) => a + t.w, 0);
          if (Math.abs(weight - 1) > ROUNDING) problems.push(`record ${record.index} ${kind} ${i}: a corner weighs ${weight}`);
          if (!corner.normal) problems.push(`record ${record.index} ${kind} ${i}: a corner has no normal`);
        }
        polygons.push({ record: record.index, kind, doubleSided: poly.doubleSided, target: tex && arcadeTarget(tex.page, tex.palette), corners });
      });
    }
  }
  return { polygons, problems };
}

/** A texture page word and a palette word, absolute in the board's VRAM. */
function arcadeTarget(page, palette) {
  return {
    page: { x: page & 0xf, y: ((page >> 4) & 1) | ((page >> 10) & 2), mode: (page >> 7) & 3 },
    clut: { x: (palette & 0x3f) * 16, y: palette >> 6 },
  };
}

/** The fighter's textures, at its place in the board's VRAM. */
function fighterVram(textures) {
  const tims = readTimChain(textures).map((t) => ({
    ...t,
    image: t.image && { ...t.image, x: t.image.x + IMAGE_ORIGIN.x, y: t.image.y + IMAGE_ORIGIN.y },
    clut: t.clut && { ...t.clut, x: t.clut.x + PALETTE_ORIGIN.x, y: t.clut.y + PALETTE_ORIGIN.y },
  }));
  return { ...absoluteVram(tims, VRAM_ROWS), loaded: tims.flatMap((t) => (t.image ? [t.image] : [])) };
}

/**
 * Whether a polygon draws from an image its archive loads (a palette alone loads none), each corner
 * outside it (over a gap between two images) brought to its nearest texel in the image the
 * polygon's other corners lie in. The GPU stops a texel short of a polygon's right and bottom
 * edges, so a corner there may lie one past its image.
 */
function fitTexels(polygon, images) {
  const { page } = polygon.target;
  const per = [4, 2, 1][page.mode];
  const us = polygon.corners.map((c) => c.uv[0]);
  const vs = polygon.corners.map((c) => c.uv[1]);
  const texel = ([u, v]) => [page.x * 64 + Math.floor((u === Math.max(...us) && u > Math.min(...us) ? u - 1 : u) / per), page.y * 256 + (v === Math.max(...vs) && v > Math.min(...vs) ? v - 1 : v)];
  const holding = ([x, y]) => images.find((i) => i.x <= x && x < i.x + i.w && i.y <= y && y < i.y + i.h);
  const home = polygon.corners.map((c) => holding(texel(c.uv))).find((i) => i !== undefined);
  if (home === undefined) return false;
  for (const corner of polygon.corners) {
    if (holding(texel(corner.uv)) !== undefined) continue;
    const u0 = (home.x - page.x * 64) * per;
    const v0 = home.y - page.y * 256;
    corner.uv = [Math.min(Math.max(corner.uv[0], u0), u0 + home.w * per - 1), Math.min(Math.max(corner.uv[1], v0), v0 + home.h - 1)];
  }
  return true;
}

/** A corner's terms, one a joint, their weights made to sum to one. */
function influencesOf(terms) {
  const byJoint = new Map();
  /* Two points of one joint (an accessory held on the joint it is joined to) blend into their weighted mean. */
  for (const t of terms) {
    const had = byJoint.get(t.joint);
    const w = (had?.w ?? 0) + t.w;
    byJoint.set(t.joint, { joint: t.joint, p: had === undefined ? t.p : had.p.map((v, k) => Math.round((v * had.w + t.p[k] * t.w) / w)), w });
  }
  const out = [...byJoint.values()].filter((t) => t.w > 1e-6);
  if (out.length > 4) throw new Error(`a corner blends ${out.length} joints`);
  /* The board's weights in 4096ths, made to sum to one. */
  const sum = out.reduce((a, t) => a + t.w, 0);
  return out.map((t) => ({ ...t, w: t.w / sum }));
}

/**
 * The hands' shapes: per hand record with a table, each step's shape (`KEEP_SHAPE` where the table
 * keeps the one drawn), a shape for each different block, the first the record's own, and the
 * body's polygons resolved with each shape's block in place.
 */
function handShapes(model, handParts, accessories) {
  const groups = [];
  for (const record of model.records.slice(0, BODY)) {
    if (record?.shapes === null || record?.shapes === undefined || !record.shapes.steps.some((b) => b !== null)) continue;
    const part = handParts.get(record.index);
    if (part === undefined) continue;
    const blocks = [record.vertices];
    const steps = record.shapes.steps.map((block) => {
      if (block === null) return KEEP_SHAPE;
      let shape = blocks.findIndex((b) => b === block || JSON.stringify(b) === JSON.stringify(block));
      if (shape < 0) {
        shape = blocks.length;
        blocks.push(block);
      }
      return shape;
    });
    const shapes = blocks.map((block) => {
      const resolved = resolveArcadeFighter(model, new Map([[record.index, block]]), accessories);
      if (resolved.problems.length) throw new Error(`record ${record.index}'s hand shape does not resolve: ${resolved.problems[0]}`);
      return resolved.polygons;
    });
    groups.push({ part, steps, shapes });
  }
  return groups;
}

/** Whether the board's archive holds a stand-in for a costume it has no model of: a texture chain of one image. */
export const standIn = ({ textures }) => readTimChain(textures).filter((t) => t.image).length <= 1;

/**
 * The fighter's mesh and atlas from the board (`model` and `textures`, its archive's two members;
 * `board`, its accessories as the board's tables give them), each accessory on its own joint; and
 * its accessories as the fight hangs and swings them. `handParts` gives the part each hand's joint
 * is drawn as. The mesh's triangles are wound counter-clockwise seen from their front, the other way
 * round from the board's, with those it draws from both faces listed (`FTR` version 6). Given the
 * body's skeleton (`bodyJoints`, the disc's, joints 0 to 17), its skeleton is the body's, the
 * accessories' and the garment's, and its normals are turned the way its faces face (`facing.mjs`).
 */
export function exportArcadeFighter({ model: modelBytes, textures }, board, handParts, encodePng, bodyJoints = null) {
  const { model, accessories, hung } = placeAccessories(readArcadeFighter(modelBytes), board);
  const body = resolveArcadeFighter(model, new Map(), accessories);
  if (body.problems.length) throw new Error(`the board's model does not resolve: ${body.problems[0]}`);
  const groups = handShapes(model, handParts, accessories);

  const vram = fighterVram(textures);
  const missing = body.polygons.filter((p) => !fitTexels(p, vram.loaded)).length;
  if (missing > 0) throw new Error(`${missing} of its polygons draw from textures its archive does not hold`);
  const polygons = body.polygons;
  const packed = packAtlas(
    vram,
    polygons.map((p) => ({ target: p.target, uvs: p.corners.map((c) => c.uv) })),
  );
  const { width, height, atlas } = packed;

  const vertices = [];
  const shapesOf = [];
  const lookup = new Map();
  const indices = [];
  /* A garment's corner: on the hips' record, drawn both faces, hung on the hips alone. */
  const worn = (p, position) => (p.record === HIPS && p.doubleSided && position.every((t) => t.joint === HIPS) ? position.map((t) => ({ ...t, joint: GARMENT })) : position);
  const vertexOf = (i, k) => {
    const p = polygons[i];
    const corner = p.corners[k];
    const influences = influencesOf(worn(p, corner.position));
    let shaped = null;
    groups.forEach((group, g) => {
      const forms = group.shapes.map((shape) => influencesOf(worn(p, shape[i].corners[k].position)));
      for (const form of forms) {
        if (form.length !== influences.length || form.some((f, n) => f.joint !== influences[n].joint)) throw new Error('a hand shape moves a corner onto other joints');
      }
      if (forms.every((form) => form.every((f, n) => f.p.join() === forms[0][n].p.join()))) return;
      if (shaped !== null) throw new Error('two hands move one corner');
      shaped = { group: g, points: forms.map((form) => form.map((f) => f.p)) };
    });
    const [u, v] = packed.place(p.target, corner.uv);
    const record = {
      influences: influences.map((f) => ({ joint: f.joint, weight: f.w, point: f.p })),
      normalJoint: corner.normal.joint,
      normal: corner.normal.n,
      uv: [u * 8, v * 8],
    };
    const key = JSON.stringify([record, shaped]);
    let index = lookup.get(key);
    if (index === undefined) {
      index = vertices.length;
      lookup.set(key, index);
      vertices.push(record);
      shapesOf.push(shaped);
    }
    return index;
  };
  /* The GPU draws a quad as (0, 1, 2) and (1, 3, 2); each turned round, its front counter-clockwise. */
  const triangles = (ids) => (ids.length === 3 ? [[ids[0], ids[2], ids[1]]] : [[ids[0], ids[2], ids[1]], [ids[1], ids[2], ids[3]]]);
  const twoFaced = [];
  polygons.forEach((p, i) => {
    for (const t of triangles(p.corners.map((_, k) => vertexOf(i, k)))) {
      if (p.doubleSided) twoFaced.push(indices.length / 3);
      indices.push(...t);
    }
  });
  const shapes = groups.map((group, g) => {
    const members = shapesOf.flatMap((s, v) => (s?.group === g ? [v] : []));
    return {
      part: group.part,
      steps: group.steps,
      vertices: members,
      shapes: group.shapes.map((_, s) => members.map((v) => ({ points: shapesOf[v].points[s], normal: vertices[v].normal }))),
    };
  });
  const garment = vertices.filter((v) => v.influences.some((f) => f.joint === GARMENT)).length;
  const records = { width, height, vertices, indices, shapes, pictures: [], garment: garment > 0 ? GARMENT : 0, twoFaced };
  /* The body's joints, the accessories' on their own (18 on), and the garment's where the hips are. */
  const skeleton =
    bodyJoints === null
      ? null
      : [
          ...bodyJoints.filter((j) => j.joint < BODY),
          ...hung.flatMap((a, k) => (a === null ? [] : [{ joint: BODY + k, parent: a.parent, offset: a.offset, rest: a.rest }])),
          ...(garment > 0 ? [{ joint: GARMENT, parent: HIPS, offset: [0, 0, 0], rest: [0, 0, 0] }] : []),
        ];
  const facing = skeleton === null ? { mesh: records, turned: 0 } : facingNormals(records, skeleton);
  return {
    mesh: writeFtr5(facing.mesh),
    atlas: encodePng(width, height, atlas),
    skeleton,
    accessories: hung,
    garment: garment > 0,
    stats: {
      polygons: polygons.length,
      accessories: [...accessories.keys()],
      garment,
      vertices: vertices.length,
      triangles: indices.length / 3,
      twoFaced: twoFaced.length,
      turned: facing.turned,
      atlas: [width, height],
      shapes: shapes.map((s) => [s.part, s.shapes.length, s.vertices.length]),
    },
  };
}
