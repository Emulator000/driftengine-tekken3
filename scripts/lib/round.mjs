/**
 * A fighter's mesh rounded: each triangle made a curved patch through its corners (PN triangles) at
 * the model's bind pose and cut `steps` by `steps`, creases and open borders running straight, so
 * neighbouring faces meet exactly. An original vertex keeps its skin and texture coordinates (its
 * normal becomes the surface's). A new vertex hangs on its corners' joints: for each joint, the
 * weighted mean of the corners' own points on it, so it moves exactly as the flat triangle does in
 * every pose, then pushed out by the patch's bulge turned into each joint's frame; its texture
 * coordinates are its corners', interpolated flat. A face the bind pose cannot hold as the model
 * does (`surface.mjs`) stays flat, its new vertices taking their nearest corner's own normal.
 *
 * A hand's other shapes are rounded the same way on the same surface: its welded points, creases
 * and groups as the mesh has them, each face whose corners a shape moves made again from the
 * shape's places and normals, so every shape has the same vertices and triangles. A face's
 * pictures (its closed eyes) are rounded once, as the face is loaded, and each picture's triangles
 * made from those on vertices of their own, their texture coordinates moved to its region.
 */
import { bindPose } from './round/bind.mjs';
import { readFtr, writeFtr5 } from './ftr.mjs';
import { edgePoint, evaluate, patchOf } from './round/pn.mjs';
import { edgeKey, surfaceOf } from './round/surface.mjs';
import { add, applyT, lerp, scale, sub } from './round/vec.mjs';

/** Each triangle cut into this many by this many. */
export const STEPS = 3;

const unit = (n) => n.map((x) => Math.round(x * 4096));
const NO_BULGE = [0, 0, 0];
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * A new vertex from its corners (`terms`, each a vertex and its weight): each joint's point the
 * weighted mean of the corners' points on it plus `bulge` turned into the joint's bind frame, the
 * four heaviest joints kept. Its normal is `normal.bind` (bind space) on its heaviest joint, or a
 * corner's own (`normal.joint`, `normal.local`).
 */
function blended(frames, terms, bulge, normal, uv) {
  if (![...bulge, ...(normal.bind ?? [])].every(Number.isFinite)) throw new Error('a rounded point is not finite');
  const sums = new Map();
  for (const { vertex, weight } of terms) {
    for (const f of vertex.influences) {
      const w = weight * f.weight;
      if (w <= 1e-9) continue;
      const sum = sums.get(f.joint) ?? { weight: 0, point: [0, 0, 0] };
      sums.set(f.joint, { weight: sum.weight + w, point: add(sum.point, scale(f.point, w)) });
    }
  }
  const kept = [...sums].sort((a, b) => b[1].weight - a[1].weight || a[0] - b[0]).slice(0, 4);
  const total = kept.reduce((s, [, sum]) => s + sum.weight, 0);
  const influences = kept.map(([joint, sum]) => ({
    joint,
    weight: sum.weight / total,
    point: add(scale(sum.point, 1 / sum.weight), applyT(frames[joint].r, bulge)).map(Math.round),
  }));
  if (normal.bind === undefined) return { influences, normalJoint: normal.joint, normal: normal.local, uv };
  return { influences, normalJoint: influences[0].joint, normal: unit(applyT(frames[influences[0].joint].r, normal.bind)), uv };
}

/**
 * The mesh the surface is made of: every triangle but a later picture's, on its vertices merged
 * where every attribute and shape matches (as a mesh without pictures has them), in their order.
 * `faceOf` gives each face's triangle in the mesh; each vertex carries its shapes (`forms`, null
 * where no shape moves it).
 */
function coreOf(mesh) {
  const pictureOf = new Map();
  mesh.pictures.forEach((list, p) => list.forEach((t, i) => pictureOf.set(t, { picture: p, i })));
  const formOf = new Map();
  mesh.shapes.forEach((group, g) => group.vertices.forEach((v, k) => formOf.set(v, { group: g, shapes: group.shapes.map((shape) => shape[k]) })));
  const kept = [];
  const used = new Set();
  for (let t = 0; t * 3 < mesh.indices.length; t += 1) {
    if ((pictureOf.get(t)?.picture ?? 0) !== 0) continue;
    kept.push(t);
    for (let k = 0; k < 3; k += 1) used.add(mesh.indices[t * 3 + k]);
  }
  const keys = new Map();
  const toCore = new Map();
  const vertices = [];
  const forms = [];
  for (let v = 0; v < mesh.vertices.length; v += 1) {
    if (!used.has(v)) continue;
    const form = formOf.get(v) ?? null;
    const key = JSON.stringify([mesh.vertices[v], form]);
    if (!keys.has(key)) {
      keys.set(key, vertices.length);
      vertices.push(mesh.vertices[v]);
      forms.push(form);
    }
    toCore.set(v, keys.get(key));
  }
  const indices = kept.flatMap((t) => [0, 1, 2].map((k) => toCore.get(mesh.indices[t * 3 + k])));
  return { vertices, forms, indices, faceOf: kept, pictureOf };
}

/** A mesh (as `readFtr` gives it) rounded, as records for `writeFtr5`. */
export function roundMesh(mesh, skeleton, steps = STEPS) {
  const n = steps;
  const core = coreOf({ shapes: [], pictures: [], ...mesh });
  const frames = bindPose(core.vertices, skeleton, core.indices);
  const surface = surfaceOf(core.vertices, core.indices, frames);

  /**
   * A face's n² triangles, its vertices made through `put(key, make)` (a key shared by the faces
   * that make the same vertex, or null for one of the face's own), from `geometry`: the vertices,
   * their places and the corners' normals.
   */
  const emit = (f, geometry, put) => {
    const face = surface.faces[f];
    const c = face.corners;
    const corner = (s) => geometry.vertices[c[s]];
    const p = c.map((i) => geometry.position[i]);
    const normals = [0, 1, 2].map((s) => geometry.normal(f, s));
    const straight = [0, 1, 2].map((s) => !surface.smooth(edgeKey(face.points[s], face.points[(s + 1) % 3])));
    const patch = patchOf(p, normals, straight);
    /* A flat face's new vertex takes the normal of the corner it lies nearest. */
    const own = (s) => ({ joint: corner(s).normalJoint, local: corner(s).normal });

    /* The grid point `a` steps toward corner 1 and `b` toward corner 2. */
    const at = (a, b) => {
      const which = a === 0 && b === 0 ? 0 : a === n && b === 0 ? 1 : a === 0 && b === n ? 2 : -1;
      if (which >= 0) {
        const original = corner(which);
        if (!face.round) return put(`c:${c[which]}:${surface.group(f, which)}`, () => original);
        return put(`c:${c[which]}:${surface.group(f, which)}`, () => ({ ...original, normal: unit(applyT(frames[original.normalJoint].r, normals[which])) }));
      }
      /* On an edge: computed from its lower surface point up, so both its faces compute it alike. */
      const edge = b === 0 ? [0, 1, a] : a + b === n ? [1, 2, b] : a === 0 ? [2, 0, n - b] : null;
      if (edge !== null) {
        const [i, j, k] = edge;
        const forward = face.points[i] < face.points[j] || (face.points[i] === face.points[j] && c[i] < c[j]);
        const [lo, hi, step] = forward ? [i, j, k] : [j, i, n - k];
        const t = step / n;
        const uv = [0, 1].map((m) => Math.round(corner(lo).uv[m] * (1 - t) + corner(hi).uv[m] * t));
        const key = `e:${face.points[lo]}:${face.points[hi]}:${step}:${surface.group(f, lo)}:${surface.group(f, hi)}:${uv}`;
        return put(key, () => {
          const terms = [{ vertex: corner(lo), weight: 1 - t }, { vertex: corner(hi), weight: t }];
          if (!face.round) return blended(frames, terms, NO_BULGE, own(t < 0.5 ? lo : hi), uv);
          const point = edgePoint(p[lo], p[hi], normals[lo], normals[hi], straight[i], t);
          return blended(frames, terms, sub(point.position, lerp(p[lo], p[hi], t)), { bind: point.normal }, uv);
        });
      }
      const weights = [(n - a - b) / n, a / n, b / n];
      const uv = [0, 1].map((m) => Math.round(weights.reduce((s, w, k) => s + corner(k).uv[m] * w, 0)));
      const terms = weights.map((weight, s) => ({ vertex: corner(s), weight }));
      return put(null, () => {
        if (!face.round) return blended(frames, terms, NO_BULGE, own(weights.indexOf(Math.max(...weights))), uv);
        const point = evaluate(patch, ...weights);
        const flat = weights.reduce((s, w, k) => add(s, scale(p[k], w)), [0, 0, 0]);
        return blended(frames, terms, sub(point.position, flat), { bind: point.normal }, uv);
      });
    };

    const grid = new Map();
    const id = (a, b) => {
      const key = a * (n + 1) + b;
      if (!grid.has(key)) grid.set(key, at(a, b));
      return grid.get(key);
    };
    const triangles = [];
    for (let a = 0; a < n; a += 1) {
      for (let b = 0; b < n - a; b += 1) {
        triangles.push([id(a, b), id(a + 1, b), id(a, b + 1)]);
        if (a + b + 2 <= n) triangles.push([id(a + 1, b), id(a + 1, b + 1), id(a, b + 1)]);
      }
    }
    return triangles;
  };

  /* The mesh as loaded: each face's vertices, shared by key, and the order each face made them in. */
  const vertices = [];
  const indices = [];
  const slots = [];
  const shared = new Map();
  const loaded = { vertices: core.vertices, position: surface.position, normal: surface.normal };
  surface.faces.forEach((_, f) => {
    const made = [];
    const put = (key, make) => {
      let index = key === null ? undefined : shared.get(key);
      if (index === undefined) {
        index = vertices.length;
        vertices.push(make());
        if (key !== null) shared.set(key, index);
      }
      made.push(index);
      return index;
    };
    for (const t of emit(f, loaded, put)) indices.push(...t);
    slots.push(made);
  });

  /* Each shape of each group: the faces its moved corners touch made again into the same vertices. */
  const forms = vertices.map(() => null);
  const groups = (mesh.shapes ?? []).map((group, g) => {
    const shapes = group.shapes.map((_, s) => {
      const moved = core.vertices.map((v, i) => {
        const form = core.forms[i];
        if (form === null || form.group !== g) return v;
        const { points, normal } = form.shapes[s];
        return { ...v, influences: v.influences.map((f, k) => ({ ...f, point: points[k] })), normal };
      });
      if (moved.every((v, i) => v === core.vertices[i] || (same(v.normal, core.vertices[i].normal) && v.influences.every((f, k) => same(f.point, core.vertices[i].influences[k].point))))) return vertices;
      const geometry = { vertices: moved, ...surface.reshape(moved) };
      const out = vertices.slice();
      surface.faces.forEach((face, f) => {
        const changed = face.corners.some((c, s) => moved[c] !== core.vertices[c] || !same(geometry.position[c], surface.position[c]) || !same(geometry.normal(f, s), surface.normal(f, s)));
        if (!changed) return;
        let k = 0;
        emit(f, geometry, (_, make) => {
          const index = slots[f][k++];
          out[index] = make();
          return index;
        });
      });
      return out;
    });
    const formOf = (v, s) => ({ points: shapes[s][v].influences.map((f) => f.point), normal: shapes[s][v].normal });
    vertices.forEach((_, v) => {
      const all = shapes.map((_, s) => formOf(v, s));
      if (all.every((form) => same(form.normal, vertices[v].normal) && form.points.every((p, k) => same(p, vertices[v].influences[k].point)))) return;
      if (forms[v] !== null) throw new Error('two groups move one rounded vertex');
      forms[v] = { group: g, shapes: all };
    });
    return { part: group.part, steps: group.steps };
  });

  /* Each picture's triangles on vertices of their own: the first's as loaded, the others' texture coordinates moved to their regions. */
  const pictures = (mesh.pictures ?? []).map(() => []);
  if (pictures.length > 0) {
    const copies = pictures.map(() => new Map());
    const copyOf = (picture, v, offset) => {
      const key = `${v}:${offset}`;
      if (!copies[picture].has(key)) {
        copies[picture].set(key, vertices.length);
        vertices.push({ ...vertices[v], uv: [vertices[v].uv[0] + offset[0], vertices[v].uv[1] + offset[1]] });
        forms.push(forms[v]);
      }
      return copies[picture].get(key);
    };
    const later = [];
    const per = n * n;
    surface.faces.forEach((_, f) => {
      const at = core.pictureOf.get(core.faceOf[f]);
      if (at === undefined) return;
      const corners = (t) => [0, 1, 2].map((k) => mesh.vertices[mesh.indices[t * 3 + k]].uv);
      const offsets = mesh.pictures.map((list) => {
        const [mine, theirs] = [corners(core.faceOf[f]), corners(list[at.i])];
        const offset = [theirs[0][0] - mine[0][0], theirs[0][1] - mine[0][1]];
        if (!theirs.every((uv, k) => uv[0] - mine[k][0] === offset[0] && uv[1] - mine[k][1] === offset[1])) throw new Error("a picture's triangle is not its face's moved");
        return offset;
      });
      for (let t = f * per; t < (f + 1) * per; t += 1) {
        const triangle = indices.slice(t * 3, t * 3 + 3);
        offsets.forEach((offset, picture) => {
          const copied = triangle.map((v) => copyOf(picture, v, offset));
          if (picture === 0) {
            indices.splice(t * 3, 3, ...copied);
            pictures[0].push(t);
          } else later.push({ picture, copied });
        });
      }
    });
    for (const { picture, copied } of later) {
      pictures[picture].push(indices.length / 3);
      indices.push(...copied);
    }
  }

  /* Vertices no triangle uses any more (a picture's face as first made) left out. */
  const keep = new Int32Array(vertices.length).fill(-1);
  for (const i of indices) keep[i] = 0;
  let count = 0;
  keep.forEach((k, v) => {
    if (k === 0) keep[v] = count++;
  });
  const kept = vertices.filter((_, v) => keep[v] >= 0);
  const keptForms = forms.filter((_, v) => keep[v] >= 0);
  return {
    width: mesh.width,
    height: mesh.height,
    garment: mesh.garment ?? 0,
    vertices: kept,
    indices: indices.map((i) => keep[i]),
    shapes: groups.map((group, g) => {
      const members = keptForms.flatMap((form, v) => (form?.group === g ? [v] : []));
      return { ...group, vertices: members, shapes: mesh.shapes[g].shapes.map((_, s) => members.map((v) => keptForms[v].shapes[s])) };
    }),
    pictures,
  };
}

/** A fighter mesh's bytes (FTR version 1 or 5, as extracted) rounded, as FTR version 5. */
export const roundFighter = (bytes, skeleton, steps = STEPS) => writeFtr5(roundMesh(readFtr(bytes), skeleton, steps));
