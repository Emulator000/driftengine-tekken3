/**
 * Fighter meshes (`FTR`) as plain records, for the extractor and the importer.
 * `src/present/3d/fighter/fighter.ts` reads every version.
 *
 * A header of 24 bytes: u32 magic, u32 version, u32 vertex count, u32 index count, u16 atlas width
 * and height in texels, u32 reserved (from version 5, the joint a garment hangs on, posed as the
 * hips and kept off the thighs; 0 where there is none). Then the vertices, the u16 indices (three a
 * triangle), and what the version adds.
 *
 * - Version 1: 28 bytes a vertex: u8 joint A, u8 joint B, u8 weight of B in 256ths, u8 normal's
 *   joint, i16 point in A's space ×3, i16 point in B's ×3, i16 normal ×3 (1/4096), u16 u and v in
 *   whole texels, u16 reserved.
 * - Version 3: 48 bytes a vertex: u8 influence count, u8 normal's joint, two spare bytes, four
 *   influences of a u8 joint, a u8 weight in 255ths and an i16 point ×3, then the i16 normal ×3 and
 *   u16 u and v in eighths of a texel, two spare bytes.
 * - Version 4 (Kazuya's, `scripts/lib/t4/kazuya.mjs`): version 3, then a rig.
 * - Version 5: version 3's vertices, each weight a part of their sum (a seam's halves exact), the
 *   indices, a rig of no nodes (a zero count), then the alternative shapes and the face's pictures:
 *   - u32 group count; per group: u8 part, u8 shape count, u8 step count, u8 spare; per step, u8
 *     the shape it draws (255 keeps the one drawn); u32 vertex count and u16 vertices; then per
 *     shape, per vertex, each of its influences' points (i16 ×3) and its normal (i16 ×3);
 *   - u32 picture count; per picture, u32 triangle count and u32 triangle numbers (a triangle's
 *     indices at three times its number): the triangles drawn only while that picture is on the
 *     face, the first picture the face as loaded, the i-th triangle of each picture the same face.
 */
export const FTR_MAGIC = 0x31525446;
const V1_BYTES = 28;
const V3_BYTES = 48;
/** A step whose shape keeps the shape drawn. */
export const KEEP_SHAPE = 255;

/** A mesh's vertices, triangles, shapes and pictures, texture coordinates in eighths of a texel whatever the version. */
export function readFtr(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== FTR_MAGIC) throw new Error('not a fighter mesh');
  const version = view.getUint32(4, true);
  if (version !== 1 && version !== 3 && version !== 5) throw new Error(`fighter mesh version ${version} is not read here`);
  const count = view.getUint32(8, true);
  const indexCount = view.getUint32(12, true);
  const width = view.getUint16(16, true);
  const height = view.getUint16(18, true);
  const garment = version === 5 ? view.getUint32(20, true) : 0;
  const vertices = [];
  let at = 24;
  const triple = (offset) => [0, 1, 2].map((c) => view.getInt16(offset + c * 2, true));
  for (let i = 0; i < count; i += 1) {
    if (version >= 3) {
      const used = view.getUint8(at);
      const bytesOf = Array.from({ length: used }, (_, k) => view.getUint8(at + 5 + k * 8));
      const total = version === 5 ? bytesOf.reduce((s, b) => s + b, 0) : 255;
      const influences = bytesOf.map((b, k) => ({ joint: view.getUint8(at + 4 + k * 8), weight: b / total, point: triple(at + 6 + k * 8) }));
      vertices.push({ influences, normalJoint: view.getUint8(at + 1), normal: triple(at + 36), uv: [view.getUint16(at + 42, true), view.getUint16(at + 44, true)] });
      at += V3_BYTES;
    } else {
      const weightB = view.getUint8(at + 2) / 256;
      const influences = [{ joint: view.getUint8(at), weight: 1 - weightB, point: triple(at + 4) }];
      if (weightB > 0) influences.push({ joint: view.getUint8(at + 1), weight: weightB, point: triple(at + 10) });
      vertices.push({ influences, normalJoint: view.getUint8(at + 3), normal: triple(at + 16), uv: [view.getUint16(at + 22, true) * 8, view.getUint16(at + 24, true) * 8] });
      at += V1_BYTES;
    }
  }
  const indices = Array.from({ length: indexCount }, (_, k) => view.getUint16(at + k * 2, true));
  at += indexCount * 2;
  const shapes = [];
  const pictures = [];
  if (version === 5) {
    if (view.getUint32(at, true) !== 0) throw new Error('a version 5 mesh with a rig is not read here');
    at += 4;
    const groups = view.getUint32(at, true);
    at += 4;
    for (let g = 0; g < groups; g += 1) {
      const part = view.getUint8(at);
      const shapeCount = view.getUint8(at + 1);
      const stepCount = view.getUint8(at + 2);
      at += 4;
      const steps = Array.from({ length: stepCount }, (_, k) => view.getUint8(at + k));
      at += stepCount;
      const vertexCount = view.getUint32(at, true);
      at += 4;
      const members = Array.from({ length: vertexCount }, (_, k) => view.getUint16(at + k * 2, true));
      at += vertexCount * 2;
      const forms = [];
      for (let s = 0; s < shapeCount; s += 1) {
        forms.push(
          members.map((v) => {
            const points = vertices[v].influences.map(() => {
              const p = triple(at);
              at += 6;
              return p;
            });
            const normal = triple(at);
            at += 6;
            return { points, normal };
          }),
        );
      }
      shapes.push({ part, steps, vertices: members, shapes: forms });
    }
    const pictureCount = view.getUint32(at, true);
    at += 4;
    for (let p = 0; p < pictureCount; p += 1) {
      const n = view.getUint32(at, true);
      at += 4;
      pictures.push(Array.from({ length: n }, (_, k) => view.getUint32(at + k * 4, true)));
      at += n * 4;
    }
  }
  return { version, width, height, garment, vertices, indices, shapes, pictures };
}

/** Weights as 255ths that sum to 255: each rounded down, the largest remainders rounded up. */
export function weightBytes(weights) {
  const scaled = weights.map((w) => w * 255);
  const bytes = scaled.map((s) => Math.floor(s + 1e-9));
  let left = 255 - bytes.reduce((s, b) => s + b, 0);
  const order = scaled.map((s, i) => [s - bytes[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (left <= 0) break;
    bytes[i] += 1;
    left -= 1;
  }
  return bytes;
}

/** Weights as parts of their sum: 256ths where each is a whole number of them (a seam's halves), else 255ths. */
export function weightParts(weights) {
  if (weights.length > 1 && weights.every((w) => Number.isInteger(w * 256) && w * 256 > 0 && w * 256 < 256)) return weights.map((w) => w * 256);
  return weightBytes(weights);
}

const i16 = (x) => {
  if (!Number.isInteger(x) || x < -32768 || x > 32767) throw new Error(`${x} does not fit i16`);
  return x;
};

/** A growing byte buffer, little-endian. */
function writer(size) {
  let bytes = new Uint8Array(size);
  let view = new DataView(bytes.buffer);
  let at = 0;
  const room = (n) => {
    if (at + n <= bytes.length) return;
    const next = new Uint8Array(Math.max(bytes.length * 2, at + n));
    next.set(bytes);
    bytes = next;
    view = new DataView(bytes.buffer);
  };
  return {
    u8(v) {
      room(1);
      view.setUint8(at, v);
      at += 1;
    },
    u16(v) {
      room(2);
      view.setUint16(at, v, true);
      at += 2;
    },
    u32(v) {
      room(4);
      view.setUint32(at, v, true);
      at += 4;
    },
    i16(v) {
      room(2);
      view.setInt16(at, i16(v), true);
      at += 2;
    },
    done: () => bytes.slice(0, at),
  };
}

function writeMesh(version, { width, height, vertices, indices, garment = 0 }, out, weightsOf) {
  if (vertices.length > 0xffff) throw new Error(`${vertices.length} vertices do not fit u16 indices`);
  out.u32(FTR_MAGIC);
  out.u32(version);
  out.u32(vertices.length);
  out.u32(indices.length);
  out.u16(width);
  out.u16(height);
  out.u32(version === 5 ? garment : 0);
  for (const v of vertices) {
    if (v.influences.length < 1 || v.influences.length > 4) throw new Error(`a vertex with ${v.influences.length} influences`);
    out.u8(v.influences.length);
    out.u8(v.normalJoint);
    out.u16(0);
    const weights = weightsOf(v.influences.map((f) => f.weight));
    for (let k = 0; k < 4; k += 1) {
      const f = v.influences[k];
      out.u8(f ? f.joint : 0);
      out.u8(f ? weights[k] : 0);
      for (let c = 0; c < 3; c += 1) out.i16(f ? f.point[c] : 0);
    }
    for (let c = 0; c < 3; c += 1) out.i16(v.normal[c]);
    out.u16(v.uv[0]);
    out.u16(v.uv[1]);
    out.u16(0);
  }
  for (const i of indices) out.u16(i);
}

/** A mesh as FTR version 3. */
export function writeFtr3(mesh) {
  const out = writer(24 + mesh.vertices.length * V3_BYTES + mesh.indices.length * 2);
  writeMesh(3, mesh, out, weightBytes);
  return out.done();
}

/**
 * A mesh as FTR version 5, with its shapes (`[{ part, steps, vertices, shapes }]`, each shape a
 * `{ points, normal }` per vertex), pictures (triangle numbers per picture) and the joint its
 * garment hangs on (`garment`, 0 for none). A shape's vertex must have as many points as
 * influences, and a picture's triangles vertices of their own.
 */
export function writeFtr5(mesh) {
  const { vertices, indices, shapes = [], pictures = [] } = mesh;
  const out = writer(24 + vertices.length * V3_BYTES + indices.length * 2 + 64);
  writeMesh(5, mesh, out, weightParts);
  out.u32(0);
  out.u32(shapes.length);
  for (const group of shapes) {
    if (group.shapes.length > 255 || group.steps.length > 255) throw new Error(`a group of ${group.shapes.length} shapes and ${group.steps.length} steps`);
    out.u8(group.part);
    out.u8(group.shapes.length);
    out.u8(group.steps.length);
    out.u8(0);
    for (const s of group.steps) {
      if (s !== KEEP_SHAPE && s >= group.shapes.length) throw new Error(`a step draws shape ${s} of ${group.shapes.length}`);
      out.u8(s);
    }
    out.u32(group.vertices.length);
    for (const v of group.vertices) out.u16(v);
    for (const form of group.shapes) {
      if (form.length !== group.vertices.length) throw new Error(`a shape of ${form.length} vertices in a group of ${group.vertices.length}`);
      form.forEach(({ points, normal }, k) => {
        if (points.length !== vertices[group.vertices[k]].influences.length) throw new Error(`a shape's vertex with ${points.length} points for ${vertices[group.vertices[k]].influences.length} influences`);
        for (const p of points) for (let c = 0; c < 3; c += 1) out.i16(p[c]);
        for (let c = 0; c < 3; c += 1) out.i16(normal[c]);
      });
    }
  }
  /* A picture's vertices are its own: hiding them hides nothing else. */
  const owner = new Map();
  const pictureOf = new Map();
  pictures.forEach((triangles, p) => {
    if (triangles.length !== pictures[0].length) throw new Error(`picture ${p} has ${triangles.length} triangles, the first ${pictures[0].length}`);
    for (const t of triangles) {
      pictureOf.set(t, p);
      for (let k = 0; k < 3; k += 1) owner.set(indices[t * 3 + k], p);
    }
  });
  for (let t = 0; t * 3 < indices.length; t += 1) {
    const mine = pictureOf.get(t) ?? -1;
    for (let k = 0; k < 3; k += 1) {
      const p = owner.get(indices[t * 3 + k]);
      if (p !== undefined && p !== mine) throw new Error(`triangle ${t} shares a vertex with picture ${p}`);
    }
  }
  out.u32(pictures.length);
  for (const triangles of pictures) {
    out.u32(triangles.length);
    for (const t of triangles) out.u32(t);
  }
  return out.done();
}
