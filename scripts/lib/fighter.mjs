/**
 * A fighter, from its model and its archive, in the form the player draws (`FTR` version 5,
 * `scripts/lib/ftr.mjs`): vertices as one or two joint-space points (a seam is two, weighted half
 * and half), a joint-space normal, and a place in a texture atlas made of the texture pages and
 * palettes its polygons use.
 *
 * A hand's other shapes go with it: each part whose record holds a table of whole vertex blocks by
 * the hand's step is drawn with each block in turn, and every vertex one of them moves gets its
 * points in each. And a face's closed eyes: the triangles whose texels the costume's closed eyes,
 * copied over its face in VRAM, change are drawn twice, once as the face is loaded and once
 * sampling an atlas region decoded with the closed eyes in place, each on vertices of its own.
 */
import { KEEP_SHAPE, writeFtr5 } from './ftr.mjs';
import { resolveFighter } from './model.mjs';
import { attributeTarget, decodePage, packAtlas, readTimChain, vramOf } from './texture.mjs';

/** Texels of the face kept around a picture's region, so it is enlarged as the face is around it. */
const PICTURE_MARGIN = 4;
const VRAM_W = 1024;

/**
 * The part table from the executable (four tables at 0x8001a044..0x8001a08c, 22 parts), for one
 * character pack: parts 18 and up are its accessories, each drawn only where the pack's byte in
 * the table at 0x80095e10 says so.
 */
export function partTable(exe, pack) {
  const at = (address) => address - 0x80010000 + 0x800;
  return Array.from({ length: 22 }, (_, i) => ({
    index: i,
    joint: exe[at(0x8001a074) + i],
    record: exe[at(0x8001a05c) + i],
    drawn: exe.readInt16LE(at(0x8001a08c) + i * 2) >= 0 && (i < 18 || exe[at(0x80095e10) + pack * 6 + (i - 18)] !== 0),
    secondary: exe[at(0x8001a044) + i] === 1,
  }));
}

/** The skeleton: per joint, its parent joint and its offset from it (game axes, millimetres). */
function skeletonOf(model, parts) {
  const jointOfPart = new Map(parts.map((p) => [p.index, p.joint]));
  const joints = [];
  for (const part of parts) {
    const record = model.records[part.record];
    if (!record) continue;
    joints.push({
      joint: part.joint,
      parent: record.parent < 0 ? -1 : (jointOfPart.get(record.parent) ?? -1),
      offset: [record.offset[0], record.offset[1], -record.offset[2]],
      ...(part.joint >= 18 ? { rest: record.rest } : {}),
    });
  }
  return joints.sort((a, b) => a.joint - b.joint);
}

const sameBlock = (a, b) => JSON.stringify({ ...a, end: 0 }) === JSON.stringify({ ...b, end: 0 });

/**
 * Each drawn part with tables of hand shapes (its record's, and its second record's): each step's
 * shape (`KEEP_SHAPE` where the tables have none), a shape for each different set of blocks the
 * steps put in the records' places, the first the records' own; and every polygon of the fighter
 * resolved with each shape's blocks in place.
 */
function shapeGroups(model, parts) {
  const groups = [];
  for (const part of parts) {
    if (!part.drawn) continue;
    const records = [part.record, ...(part.secondary ? [part.record + 1] : [])]
      .map((r) => model.records[r])
      .filter((record) => record?.shapes && record.shapes.steps.some((block) => block !== null));
    if (records.length === 0) continue;
    const length = Math.max(...records.map((r) => r.shapes.table.length));
    /* Per step, the block each record draws, or null where its table keeps the one drawn. */
    const chosen = Array.from({ length }, (_, step) => records.map((r) => r.shapes.steps[step] ?? null));
    const ids = new Map();
    const idOf = (block) => {
      if (!ids.has(block)) ids.set(block, ids.size);
      return ids.get(block);
    };
    const own = records.map((r) => r.vertices);
    const sets = [own];
    const keys = [null];
    const steps = chosen.map((blocks) => {
      if (blocks.every((b) => b === null)) return KEEP_SHAPE;
      if (blocks.some((b) => b === null)) throw new Error(`part ${part.index}'s records keep and change their shapes at one step`);
      if (blocks.every((b, k) => sameBlock(b, own[k]))) return 0;
      const key = blocks.map(idOf).join('|');
      let shape = keys.indexOf(key);
      if (shape < 0) {
        shape = sets.length;
        sets.push(blocks);
        keys.push(key);
      }
      return shape;
    });
    const shapes = sets.map((blocks) => {
      const variant = { records: model.records.map((r) => (records.includes(r) ? { ...r, vertices: blocks[records.indexOf(r)] } : r)) };
      const resolved = resolveFighter(variant, parts);
      if (resolved.problems.length) throw new Error(`part ${part.index}'s hand shape does not resolve: ${resolved.problems[0]}`);
      return resolved.polygons;
    });
    groups.push({ part: part.index, steps, shapes });
  }
  return groups;
}

/** A corner's one or two points, each a joint and its point, checked to be one point or a seam of halves. */
function pointsOf(terms) {
  if (terms.length > 2) throw new Error(`a corner blends ${terms.length} joints; the format holds two`);
  const [a, b] = terms;
  if (b && (a.w !== 0.5 || b.w !== 0.5)) throw new Error(`a seam weighs ${a.w} and ${b.w}, not halves`);
  return terms.map((t) => ({ joint: t.joint, point: t.p }));
}

/**
 * The VRAM with a picture copied over the face (`eyes`: the face's rectangle `to`, `w` by `h`
 * halfwords, and where the picture lies, `from`, both relative to the slot), as the game's copy does.
 */
function withPicture(vram, { to, from, w, h }) {
  const images = vram.images.slice();
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) images[(to.y + y) * VRAM_W + to.x + x] = vram.images[(from.y + y) * VRAM_W + from.x + x];
  }
  return { images, palettes: vram.palettes };
}

/** Whether any texel a polygon's texture coordinates span differs between two decodes of its page. */
function texelsDiffer(open, shut, uvs) {
  const us = uvs.map((uv) => uv[0]);
  const vs = uvs.map((uv) => uv[1]);
  for (let v = Math.min(...vs); v <= Math.max(...vs); v += 1) {
    for (let u = Math.min(...us); u <= Math.max(...us); u += 1) {
      const i = (v * 256 + u) * 4;
      if (open[i] !== shut[i] || open[i + 1] !== shut[i + 1] || open[i + 2] !== shut[i + 2] || open[i + 3] !== shut[i + 3]) return true;
    }
  }
  return false;
}

/**
 * The fighter's mesh, skeleton and atlas. `eyes`, where the costume has closed eyes, says where
 * they are copied over its face (`withPicture`); `shapesFrom`, where one record's shapes lie
 * outside the model (`parseModel`).
 */
export function exportFighter(modelBytes, archiveMembers, parts, parseModel, encodePng, { eyes = null, shapesFrom = null } = {}) {
  const model = parseModel(modelBytes, { shapesFrom });
  const resolved = resolveFighter(model, parts);
  if (resolved.problems.length) throw new Error(`the model does not resolve: ${resolved.problems[0]}`);
  const groups = shapeGroups(model, parts);
  const polygons = resolved.polygons;

  /* The polygons whose texels the closed eyes change, and the region each is drawn from with them. */
  const vram = vramOf(readTimChain(archiveMembers[0]));
  const targetOf = polygons.map((p) => attributeTarget(p.attr ?? 0));
  const shut = new Set();
  let closed = null;
  if (eyes !== null) {
    closed = withPicture(vram, eyes);
    const pages = new Map();
    const pagesOf = (target) => {
      const key = JSON.stringify(target);
      if (!pages.has(key)) pages.set(key, [decodePage(vram, target.page, target.clut), decodePage(closed, target.page, target.clut)]);
      return pages.get(key);
    };
    polygons.forEach((p, i) => {
      if (p.corners.every((c) => c.uv) && texelsDiffer(...pagesOf(targetOf[i]), p.corners.map((c) => c.uv))) shut.add(i);
    });
  }
  const closedTarget = (target) => ({ ...target, picture: 1 });
  const uses = polygons.map((p, i) => ({ target: targetOf[i], uvs: p.corners.map((c) => c.uv) }));
  for (const i of shut) {
    const uvs = polygons[i].corners.map((c) => c.uv);
    const edge = (k, side) => Math.max(0, Math.min(255, side(...uvs.map((uv) => uv[k])) + (side === Math.min ? -PICTURE_MARGIN : PICTURE_MARGIN)));
    uses.push({ target: closedTarget(targetOf[i]), uvs: [[edge(0, Math.min), edge(1, Math.min)], [edge(0, Math.max), edge(1, Math.max)]], from: closed });
  }
  const packed = packAtlas(vram, uses);
  const { width, height, atlas } = packed;

  /* Vertices, merged where every attribute (and, for a picture's, the picture) matches. */
  const vertices = [];
  const shapesOf = [];
  const lookup = new Map();
  const indices = [];
  const vertexOf = (i, k, target, picture) => {
    const corner = polygons[i].corners[k];
    const influences = pointsOf(corner.position);
    const weight = 1 / influences.length;
    /* Its points in each group's shapes, where any moves it. */
    let shaped = null;
    groups.forEach((group, g) => {
      const forms = group.shapes.map((shape) => pointsOf(shape[i].corners[k].position));
      for (const form of forms) {
        if (form.length !== influences.length || form.some((f, n) => f.joint !== influences[n].joint)) throw new Error(`a hand shape moves a corner onto other joints`);
      }
      if (forms.every((form) => form.every((f, n) => f.point.join() === forms[0][n].point.join()))) return;
      if (shaped !== null) throw new Error('two hands move one corner');
      shaped = { group: g, points: forms.map((form) => form.map((f) => f.point)) };
    });
    const [u, v] = packed.place(target, corner.uv);
    const record = {
      influences: influences.map((f) => ({ joint: f.joint, weight, point: f.point })),
      normalJoint: corner.normal.joint,
      normal: corner.normal.n,
      uv: [u * 8, v * 8],
    };
    const key = JSON.stringify([record, shaped, picture]);
    let index = lookup.get(key);
    if (index === undefined) {
      index = vertices.length;
      lookup.set(key, index);
      vertices.push(record);
      shapesOf.push(shaped);
    }
    return index;
  };
  /* The GPU draws a quad as (0, 1, 2) and (1, 3, 2). */
  const triangles = (ids) => (ids.length === 3 ? [ids] : [[ids[0], ids[1], ids[2]], [ids[1], ids[3], ids[2]]]);
  const pictures = [[], []];
  const emit = (i, target, picture) => {
    for (const t of triangles(polygons[i].corners.map((_, k) => vertexOf(i, k, target, picture)))) {
      if (picture !== null) pictures[picture].push(indices.length / 3);
      indices.push(...t);
    }
  };
  polygons.forEach((_, i) => emit(i, targetOf[i], shut.has(i) ? 0 : null));
  for (const i of shut) emit(i, closedTarget(targetOf[i]), 1);
  if (vertices.length > 0xffff) throw new Error(`${vertices.length} vertices do not fit u16 indices`);

  const shapes = groups.map((group, g) => {
    const members = shapesOf.flatMap((s, v) => (s?.group === g ? [v] : []));
    return {
      part: group.part,
      steps: group.steps,
      vertices: members,
      shapes: group.shapes.map((_, s) => members.map((v) => ({ points: shapesOf[v].points[s], normal: vertices[v].normal }))),
    };
  });
  const mesh = writeFtr5({ width, height, vertices, indices, shapes, pictures: shut.size > 0 ? pictures : [] });
  return {
    mesh,
    skeleton: skeletonOf(model, parts),
    atlas: encodePng(width, height, atlas),
    stats: {
      polygons: polygons.length,
      vertices: vertices.length,
      triangles: indices.length / 3,
      atlas: [width, height],
      shapes: shapes.map((s) => [s.part, s.shapes.length, s.vertices.length]),
      eyes: shut.size,
    },
  };
}
