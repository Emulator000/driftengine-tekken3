/**
 * A fighter's mesh rounded: each triangle made a curved patch through its corners (PN triangles) at
 * the model's bind pose and cut `steps` by `steps`, creases and open borders running straight, so
 * neighbouring faces meet exactly; then the cut surface made even (`round/fair.mjs`), each place
 * off a crease, a border or a tip moved along its normal only, so a low-poly finger, limb or head's
 * corners and facets even out into a round shape of its size. An original vertex keeps its skin and
 * texture coordinates, its points moved with its place (its normal becomes the surface's). A new
 * vertex hangs on its corners' joints: for each joint, the weighted mean of the corners' own points
 * on it, so it moves exactly as the flat triangle does in every pose, then pushed out by its place's
 * offset from the flat triangle turned into each joint's frame; its texture coordinates are its
 * corners', interpolated flat. A round vertex's normal lies halfway between the patch's and the cut
 * surface's own. A face the bind pose cannot hold as the model does (`surface.mjs`) stays flat, its
 * new vertices taking their nearest corner's own normal.
 *
 * A hand's other shapes are rounded the same way on the same surface: its welded points, creases
 * and groups as the mesh has them, each face whose corners a shape moves made again from the
 * shape's places and normals and the cut surface made even again, so every shape has the same
 * vertices and triangles. A face's pictures (its closed eyes) are rounded once, as the face is
 * loaded, and each picture's triangles made from those on vertices of their own, their texture
 * coordinates moved to its region. A face drawn from both faces (version 6) is cut into triangles
 * drawn from both, each wound as the face is; a face lying right under one stays flat
 * (`round/surface.mjs`).
 */
import { bindPose } from './round/bind.mjs';
import { readFtr, writeFtr5 } from './ftr.mjs';
import { fair, neighboursOf } from './round/fair.mjs';
import { edgePoint, evaluate, patchOf } from './round/pn.mjs';
import { edgeKey, surfaceOf } from './round/surface.mjs';
import { add, applyT, dot, lerp, normalize, scale, sub } from './round/vec.mjs';

/** Each triangle cut into this many by this many. */
export const STEPS = 3;

/** A whole number, never -0 (so a shape's record compares equal to one made directly). */
const whole = (x) => Math.round(x) + 0;
const unit = (n) => n.map((x) => whole(x * 4096));
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
    point: add(scale(sum.point, 1 / sum.weight), applyT(frames[joint].r, bulge)).map(whole),
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
  const both = new Set(mesh.twoFaced ?? []);
  const surface = surfaceOf(core.vertices, core.indices, frames, new Set(core.faceOf.flatMap((t, f) => (both.has(t) ? [f] : []))));
  const { faces } = surface;
  const edgeOf = (f, s) => edgeKey(faces[f].points[s], faces[f].points[(s + 1) % 3]);

  /*
   * The cut surface: each face's grid, each of its points a vertex made once (by a key the faces that
   * reach it alike share) by the first face to reach it, lying at a place (which every vertex there
   * shares) and taking its normal from a side (the vertices there on one side of a crease).
   */
  const made = [];
  const keys = new Map();
  const places = new Map();
  const sides = new Map();
  const idOf = (map, key) => {
    if (!map.has(key)) map.set(key, map.size);
    return map.get(key);
  };
  const grids = faces.map(() => []);
  const triangles = faces.map((face, f) => {
    const c = face.corners;
    /* The grid point `a` steps toward corner 1 and `b` toward corner 2. */
    const make = (a, b) => {
      const which = a === 0 && b === 0 ? 0 : a === n && b === 0 ? 1 : a === 0 && b === n ? 2 : -1;
      /* On an edge: from its lower surface point up, so both its faces make it alike. */
      const edge = which >= 0 ? null : b === 0 ? [0, 1, a] : a + b === n ? [1, 2, b] : a === 0 ? [2, 0, n - b] : null;
      let key = null;
      let point;
      let place;
      let side;
      if (which >= 0) {
        const group = surface.group(f, which);
        key = `c:${c[which]}:${group}`;
        place = `p:${face.points[which]}`;
        side = `${place}:${group}`;
        point = { which };
      } else if (edge !== null) {
        const [i, j, k] = edge;
        const forward = face.points[i] < face.points[j] || (face.points[i] === face.points[j] && c[i] < c[j]);
        const [lo, hi, step] = forward ? [i, j, k] : [j, i, n - k];
        const t = step / n;
        const uv = [0, 1].map((m) => Math.round(core.vertices[c[lo]].uv[m] * (1 - t) + core.vertices[c[hi]].uv[m] * t));
        place = `e:${face.points[lo]}:${face.points[hi]}:${step}`;
        side = `${place}:${surface.group(f, lo)}:${surface.group(f, hi)}`;
        key = `${side}:${uv}`;
        point = { edge: i, forward, lo, hi, t, uv };
      } else {
        const weights = [(n - a - b) / n, a / n, b / n];
        place = side = `i:${f}:${a}:${b}`;
        point = { weights, uv: [0, 1].map((m) => Math.round(weights.reduce((s, w, k) => s + core.vertices[c[k]].uv[m] * w, 0))) };
      }
      let v = key === null ? undefined : keys.get(key);
      if (v === undefined) {
        v = made.length;
        made.push({ f, ...point, place: idOf(places, place), side: idOf(sides, side) });
        if (key !== null) keys.set(key, v);
      }
      grids[f].push({ a, b, v });
      return v;
    };
    const grid = new Map();
    const id = (a, b) => {
      const key = a * (n + 1) + b;
      if (!grid.has(key)) grid.set(key, make(a, b));
      return grid.get(key);
    };
    const list = [];
    for (let a = 0; a < n; a += 1) {
      for (let b = 0; b < n - a; b += 1) {
        list.push([id(a, b), id(a + 1, b), id(a, b + 1)]);
        if (a + b + 2 <= n) list.push([id(a + 1, b), id(a + 1, b + 1), id(a, b + 1)]);
      }
    }
    return list;
  });

  /*
   * The places free to be made even: on round faces only, off creases, borders and tips, with every
   * vertex there on one side.
   */
  const free = new Uint8Array(places.size).fill(1);
  const sideAt = new Int32Array(places.size).fill(-1);
  for (const m of made) {
    if (sideAt[m.place] < 0) sideAt[m.place] = m.side;
    else if (sideAt[m.place] !== m.side) free[m.place] = 0;
  }
  faces.forEach((face, f) => {
    for (const { a, b, v } of grids[f]) {
      const on = [b === 0, a + b === n, a === 0];
      const which = a === 0 && b === 0 ? 0 : a === n && b === 0 ? 1 : a === 0 && b === n ? 2 : -1;
      if (!face.round || on.some((edge, s) => edge && !surface.smooth(edgeOf(f, s))) || (which >= 0 && surface.cusp(f, which))) free[made[v].place] = 0;
    }
  });
  const neighbours = neighboursOf(places.size, triangles.flat(2).map((v) => made[v].place));
  const passes = n * n;

  /*
   * The cut surface as `geometry` shapes it (the vertices, their places, the corners' and faces'
   * normals): for the faces in `list`, each vertex's place on the flat triangle and on the patch and
   * the patch's normal there (the others' as `base` has them); the places made even; and each round
   * vertex's normal, halfway between the patch's and its side's triangles' (weighted by their area).
   */
  const shapeOf = (geometry, list, base = null) => {
    const flat = base === null ? [] : base.flat.slice();
    const at = base === null ? [] : base.at.slice();
    const bent = base === null ? [] : base.bent.slice();
    for (const f of list) {
      const face = faces[f];
      const p = face.corners.map((i) => geometry.position[i]);
      const normals = [0, 1, 2].map((s) => geometry.normal(f, s));
      const straight = [0, 1, 2].map((s) => !surface.smooth(edgeOf(f, s)));
      /* Each edge's normals at its ends, and each corner's within the face: a tip's its two edges' mean. */
      const ends = [0, 1, 2].map((s) => [geometry.along(f, s, (s + 1) % 3), geometry.along(f, (s + 1) % 3, s)]);
      const inner = [0, 1, 2].map((s) => (geometry.cusp(f, s) ? normalize(add(ends[s][0], ends[(s + 2) % 3][1])) : normals[s]));
      const patch = patchOf(p, inner, straight, ends);
      for (const { v } of grids[f]) {
        const m = made[v];
        if (m.f !== f) continue;
        let point;
        if (m.which !== undefined) {
          flat[v] = p[m.which];
          point = { position: p[m.which], normal: normals[m.which] };
        } else if (m.edge !== undefined) {
          flat[v] = lerp(p[m.lo], p[m.hi], m.t);
          const [lo, hi] = m.forward ? ends[m.edge] : [ends[m.edge][1], ends[m.edge][0]];
          point = edgePoint(p[m.lo], p[m.hi], lo, hi, straight[m.edge], m.t);
        } else {
          flat[v] = m.weights.reduce((s, w, k) => add(s, scale(p[k], w)), [0, 0, 0]);
          point = evaluate(patch, ...m.weights);
        }
        at[v] = face.round ? point.position : flat[v];
        bent[v] = face.round ? point.normal : [0, 0, 0];
      }
    }
    const start = new Float64Array(places.size * 3);
    const direction = new Float64Array(places.size * 3);
    made.forEach((m, v) => {
      start.set(at[v], m.place * 3);
      direction.set(bent[v], m.place * 3);
    });
    const even = fair(start, direction, free, neighbours, passes);
    const placeOf = (v) => [0, 1, 2].map((k) => even[made[v].place * 3 + k]);
    const sums = new Float64Array(sides.size * 3);
    const across = [0, 0, 0];
    faces.forEach((face, f) => {
      if (!face.round) return;
      const facing = geometry.facing(f);
      for (const t of triangles[f]) {
        const [a, b, c] = t.map((v) => made[v].place * 3);
        for (let k = 0; k < 3; k += 1) {
          const [i, j] = [(k + 1) % 3, (k + 2) % 3];
          across[k] = (even[b + i] - even[a + i]) * (even[c + j] - even[a + j]) - (even[b + j] - even[a + j]) * (even[c + i] - even[a + i]);
        }
        const sign = dot(across, facing) < 0 ? -1 : 1;
        for (const v of t) for (let k = 0; k < 3; k += 1) sums[made[v].side * 3 + k] += sign * across[k];
      }
    });
    const normal = made.map((m, v) => {
      const k = m.side * 3;
      const sum = Math.hypot(sums[k], sums[k + 1], sums[k + 2]);
      return sum > 1e-9 ? normalize(add([sums[k] / sum, sums[k + 1] / sum, sums[k + 2] / sum], bent[v])) : bent[v];
    });
    return { flat, at, bent, even, placeOf, normal };
  };

  /* A vertex's record from its shape: an original one's skin moved with its place, a new one hung on its corners' joints. */
  const recordOf = (v, geometry, shape) => {
    const m = made[v];
    const face = faces[m.f];
    const corner = (s) => geometry.vertices[face.corners[s]];
    const here = shape.placeOf(v);
    if (m.which !== undefined) {
      const original = corner(m.which);
      if (!face.round) return original;
      const move = sub(here, shape.at[v]);
      return {
        ...original,
        influences: original.influences.map((f) => ({ ...f, point: add(f.point, applyT(frames[f.joint].r, move)).map(whole) })),
        normal: unit(applyT(frames[original.normalJoint].r, shape.normal[v])),
      };
    }
    /* A flat face's new vertex takes the normal of the corner it lies nearest. */
    const own = (s) => ({ joint: corner(s).normalJoint, local: corner(s).normal });
    const weights = m.edge !== undefined ? [0, 1, 2].map((s) => (s === m.lo ? 1 - m.t : s === m.hi ? m.t : 0)) : m.weights;
    const terms = weights.flatMap((weight, s) => (weight > 0 ? [{ vertex: corner(s), weight }] : []));
    if (!face.round) return blended(frames, terms, NO_BULGE, own(weights.indexOf(Math.max(...weights))), m.uv);
    return blended(frames, terms, sub(here, shape.flat[v]), { bind: shape.normal[v] }, m.uv);
  };

  /* The mesh as loaded. */
  const loaded = { vertices: core.vertices, position: surface.position, normal: surface.normal, cusp: surface.cusp, along: surface.along, facing: surface.facing };
  const base = shapeOf(loaded, faces.map((_, f) => f));
  const vertices = made.map((_, v) => recordOf(v, loaded, base));
  const indices = triangles.flat(2);

  /*
   * Each shape of each group: the faces its moved corners touch shaped again, the surface made even
   * again, and every vertex that comes out otherwise made again.
   */
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
      const changed = faces.map((face, f) =>
        face.corners.some(
          (c, s) =>
            moved[c] !== core.vertices[c] ||
            !same(geometry.position[c], surface.position[c]) ||
            !same(geometry.normal(f, s), surface.normal(f, s)) ||
            [1, 2].some((k) => !same(geometry.along(f, s, (s + k) % 3), surface.along(f, s, (s + k) % 3))),
        ),
      );
      const shape = shapeOf(geometry, faces.flatMap((_, f) => (changed[f] ? [f] : [])), base);
      return vertices.map((record, v) => {
        const m = made[v];
        const unmoved = [0, 1, 2].every((k) => shape.even[m.place * 3 + k] === base.even[m.place * 3 + k]) && same(shape.normal[v], base.normal[v]);
        return !changed[m.f] && unmoved ? record : recordOf(v, geometry, shape);
      });
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

  /* Each face's triangles drawn from both faces where the face is. */
  const per = n * n;
  const twoFaced = core.faceOf.flatMap((t, f) => (both.has(t) ? Array.from({ length: per }, (_, k) => f * per + k) : []));

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
          } else later.push({ picture, copied, both: both.has(mesh.pictures[picture][at.i]) });
        });
      }
    });
    for (const { picture, copied, both: drawnBoth } of later) {
      if (drawnBoth) twoFaced.push(indices.length / 3);
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
    twoFaced: mesh.twoFaced == null ? null : twoFaced,
  };
}

/** A fighter mesh's bytes (FTR version 1, 5 or 6, as extracted) rounded, as FTR version 5, or 6 from 6. */
export const roundFighter = (bytes, skeleton, steps = STEPS) => writeFtr5(roundMesh(readFtr(bytes), skeleton, steps));
