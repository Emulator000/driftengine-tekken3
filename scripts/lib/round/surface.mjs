/**
 * A mesh's surface at its bind pose: corners welded into the points they are (one skin, and a
 * chain of facings each within 120° of the next: only the two sides of a thin piece face further
 * apart, and they stay apart; the model gives each texture panel its own normals, which must not
 * split the surface), faces turned the way their corners face, each edge smooth or a crease (bent
 * past 100°, or for a small part's faces, a finger's, past 140°; bent past 60° onto a face less
 * than a third as wide across it as the other, as a sandal's broad face folds onto its narrow side,
 * where rounding would swell past the narrow face; or an open border: a low-poly limb bends 60° to
 * 100° between faces of a like width, and rounds). Two borders lying on one another, their corners
 * facing too far apart to weld (a thin finger's sides), are one edge where that edge rounds. Each
 * corner's normal comes from the faces joined to it across smooth edges, weighted by their angle
 * there and their area (so a thin block's broad faces hold its corners' normals, and it rounds at
 * its edges rather than swelling); at a tip (a horn's), whose faces face every way, each edge
 * takes its own normal there instead (`along`), so the edges run into the tip as they lie.
 *
 * A face rounds only where the bind pose holds it as the model has it (`round`): none of its corners
 * a seam whose places do not meet (an armpit), and every two joints it spans either joined by seams
 * that meet within 2 mm or both placed by trusted frames. Any other face stays flat, its edges
 * straight.
 *
 * `reshape` gives the places and the corners' and faces' normals of the same surface with its
 * vertices moved (a hand's other shape): the same points, faces, edges and groups.
 */
import { bindNormal, bindPosition, ELASTIC, trustedJoints } from './bind.mjs';
import { add, cross, dot, length, normalize, place, scale, sub } from './vec.mjs';

/** Two joints whose seams meet within this (their median, millimetres) are placed right against each other. */
export const TIGHT = 2;

const pairKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

/** Corners at one place facing further apart than 120° are two surfaces (a thin piece's two sides). */
export const WELD = Math.cos((2 * Math.PI) / 3);

/** Faces bent further apart than 100° meet at a crease. */
export const CREASE = Math.cos((100 * Math.PI) / 180);

/** Faces bent up to 60° apart always round together; past it, only faces of a like width across their edge (`NARROW`). */
export const BEND = Math.cos(Math.PI / 3);

/** A face less than this part as wide across an edge as its neighbour is a narrow side, folded onto past `BEND`. */
export const NARROW = 1 / 3;

/** Faces of a small part (no side longer than `SMALL`, millimetres: a finger's) round together bent up to `SHARP`, 140°. */
export const SHARP = Math.cos((140 * Math.PI) / 180);
export const SMALL = 80;

/** A corner whose faces' normals, weighted, average shorter than this is a tip (a horn's, a cone's sharper than 30° across). */
export const CUSP = 0.25;

/** An edge between two surface points, either way round. */
export const edgeKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);

const skinKey = (v) => v.influences.map((f) => `${f.joint}:${f.weight}:${f.point.join(',')}`).join('|');

/** The angle at each corner of a triangle. */
function cornerAngles(p) {
  return [0, 1, 2].map((i) => {
    const a = sub(p[(i + 1) % 3], p[i]);
    const b = sub(p[(i + 2) % 3], p[i]);
    const la = length(a);
    const lb = length(b);
    return la > 0 && lb > 0 ? Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (la * lb)))) : 0;
  });
}

export function surfaceOf(vertices, indices, frames) {
  const position = vertices.map((v) => bindPosition(v, frames));
  const given = vertices.map((v) => bindNormal(v, frames));

  /*
   * Welding: one skin, and a chain of corners each facing within 120° of the next (a vertex with no
   * normal joins the first; one first with no normal takes them all).
   */
  const bySkin = new Map();
  vertices.forEach((v, i) => {
    const key = skinKey(v);
    if (!bySkin.has(key)) bySkin.set(key, []);
    bySkin.get(key).push(i);
  });
  const weld = Int32Array.from({ length: vertices.length }, (_, i) => i);
  const root = (i) => {
    while (weld[i] !== i) i = weld[i] = weld[weld[i]];
    return i;
  };
  const join = (a, b) => {
    const [x, y] = [root(a), root(b)];
    if (x !== y) weld[Math.max(x, y)] = Math.min(x, y);
  };
  const known = given.map((n) => length(n) > 0.5);
  for (const list of bySkin.values()) {
    list.forEach((a, k) => {
      if (!known[a] || !known[list[0]]) join(list[0], a);
      else for (const b of list.slice(k + 1)) if (known[b] && dot(given[a], given[b]) >= WELD) join(a, b);
    });
  }

  /* How far apart each seam's places lie, and each pair of joints' seams at their median. */
  const gapOf = vertices.map((v) => (v.influences.length >= 2 ? length(sub(place(frames[v.influences[0].joint], v.influences[0].point), place(frames[v.influences[1].joint], v.influences[1].point))) : 0));
  const pairGaps = new Map();
  vertices.forEach((v, i) => {
    if (v.influences.length < 2) return;
    const key = pairKey(v.influences[0].joint, v.influences[1].joint);
    if (!pairGaps.has(key)) pairGaps.set(key, []);
    pairGaps.get(key).push(gapOf[i]);
  });
  const pairs = new Map([...pairGaps].map(([key, gaps]) => [key, median(gaps)]));
  const trusted = trustedJoints(frames);
  const placedTogether = (a, b) => (pairs.has(pairKey(a, b)) ? pairs.get(pairKey(a, b)) <= TIGHT : trusted.has(a) && trusted.has(b));
  const roundable = (corners) => {
    if (corners.some((c) => gapOf[c] > ELASTIC)) return false;
    const joints = [...new Set(corners.flatMap((c) => vertices[c].influences.map((f) => f.joint)))];
    return joints.every((a, i) => joints.slice(i + 1).every((b) => placedTogether(a, b)));
  };

  /* Faces, each turned the way its corners' normals face. */
  const faces = [];
  for (let f = 0; f + 2 < indices.length; f += 3) {
    const corners = [indices[f], indices[f + 1], indices[f + 2]];
    faces.push({ corners, points: corners.map(root), ...faceShape(corners, position, given), round: roundable(corners) });
  }

  /* The faces each edge bounds. */
  const edgesOf = () => {
    const map = new Map();
    faces.forEach((face, f) => {
      for (let s = 0; s < 3; s += 1) {
        const key = edgeKey(face.points[s], face.points[(s + 1) % 3]);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(f);
      }
    });
    return map;
  };
  /* How wide a face is across its edge from corner `s` to `t`: its height over that edge. */
  const widthAcross = (f, s, t) => {
    const face = faces[f];
    const span = length(sub(position[face.corners[t]], position[face.corners[s]]));
    return span > 0 ? (2 * face.area) / span : 0;
  };
  /* Whether round faces `x` and `y` round across their edge, `widths` wide across it. */
  const rounds = (x, y, widths) => {
    const bend = dot(faces[x].normal, faces[y].normal);
    if (bend >= BEND) return true;
    if (bend < CREASE) return bend >= SHARP && Math.max(faces[x].size, faces[y].size) <= SMALL;
    return Math.min(...widths) >= NARROW * Math.max(...widths);
  };

  /*
   * Two borders lying on one another, their corners facing too far apart to weld (a thin finger's
   * sides), made one edge where it rounds: each end's corners on either side welded.
   */
  const twins = new Map();
  for (const [key, list] of edgesOf()) {
    if (list.length !== 1 || !faces[list[0]].round) continue;
    const face = faces[list[0]];
    const [s, t] = key.split('-').map(Number).map((point) => face.points.indexOf(point));
    const skins = [s, t].map((k) => skinKey(vertices[face.corners[k]]));
    const pair = skins[0] < skins[1] ? `${skins[0]}#${skins[1]}` : `${skins[1]}#${skins[0]}`;
    if (!twins.has(pair)) twins.set(pair, []);
    twins.get(pair).push({ f: list[0], ends: skins[0] < skins[1] ? [s, t] : [t, s] });
  }
  for (const list of twins.values()) {
    const [x, y] = list;
    if (list.length !== 2 || x.f === y.f) continue;
    const widths = [widthAcross(x.f, ...x.ends), widthAcross(y.f, ...y.ends)];
    if (!rounds(x.f, y.f, widths)) continue;
    for (const k of [0, 1]) join(faces[x.f].corners[x.ends[k]], faces[y.f].corners[y.ends[k]]);
  }
  const pointOf = new Int32Array(vertices.length);
  const ids = new Map();
  vertices.forEach((_, i) => {
    if (!ids.has(root(i))) ids.set(root(i), ids.size);
    pointOf[i] = ids.get(root(i));
  });
  for (const face of faces) face.points = face.corners.map((c) => pointOf[c]);
  const edges = edgesOf();

  const smooth = (key) => {
    const list = edges.get(key);
    if (list === undefined || list.length !== 2 || !faces[list[0]].round || !faces[list[1]].round) return false;
    const [a, b] = key.split('-').map(Number);
    const widths = list.map((f) => widthAcross(f, faces[f].points.indexOf(a), faces[f].points.indexOf(b)));
    return rounds(list[0], list[1], widths);
  };

  /* Corners joined across a smooth edge share a group: union-find over (face, corner). */
  const parent = Int32Array.from({ length: faces.length * 3 }, (_, i) => i);
  const find = (i) => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    while (parent[i] !== root) [parent[i], i] = [root, parent[i]];
    return root;
  };
  const cornerAt = (f, point) => f * 3 + faces[f].points.indexOf(point);
  for (const [key, list] of edges) {
    if (!smooth(key)) continue;
    const [a, b] = key.split('-').map(Number);
    for (const point of [a, b]) {
      const [x, y] = [find(cornerAt(list[0], point)), find(cornerAt(list[1], point))];
      if (x !== y) parent[Math.max(x, y)] = Math.min(x, y);
    }
  }
  const group = (f, s) => find(f * 3 + s);
  /*
   * A corner's normal: its group's, else its own given one, else its face's, else up. `along` gives
   * a corner's normal for one of its face's edges: the corner's own, or at a tip (`cusp`: its faces'
   * normals, weighted, averaging less than `CUSP`) the edge's, its two faces' mean, so the edge runs
   * straight into the tip and the faces round about it.
   */
  const normalsOf = (shapes, givenNormals) => {
    const sums = new Map();
    const weights = new Map();
    shapes.forEach((shape, f) => {
      for (let s = 0; s < 3; s += 1) {
        const g = group(f, s);
        sums.set(g, add(sums.get(g) ?? [0, 0, 0], scale(shape.normal, shape.angles[s] * shape.area)));
        weights.set(g, (weights.get(g) ?? 0) + shape.angles[s] * shape.area);
      }
    });
    const normal = (f, s) => {
      for (const n of [normalize(sums.get(group(f, s))), givenNormals[faces[f].corners[s]], shapes[f].normal]) if (length(n) > 0.5) return n;
      return [0, -1, 0];
    };
    const cusp = (f, s) => length(sums.get(group(f, s))) < CUSP * weights.get(group(f, s));
    const along = (f, s, t) => {
      if (!cusp(f, s)) return normal(f, s);
      const key = edgeKey(faces[f].points[s], faces[f].points[t]);
      if (!smooth(key)) return shapes[f].normal;
      const [x, y] = edges.get(key);
      return normalize(add(shapes[x].normal, shapes[y].normal));
    };
    return { normal, cusp, along, facing: (f) => shapes[f].normal };
  };
  const { normal, cusp, along, facing } = normalsOf(faces, given);
  /**
   * The surface with its vertices moved (another shape of a hand): their places and corners'
   * normals, from the same points, faces, edges and groups.
   */
  const reshape = (moved) => {
    const at = moved.map((v) => bindPosition(v, frames));
    const facing = moved.map((v) => bindNormal(v, frames));
    return { position: at, ...normalsOf(faces.map((face) => faceShape(face.corners, at, facing)), facing) };
  };
  return { position, pointOf, faces, smooth, group, normal, cusp, along, facing, reshape };
}

/** A face's normal (turned the way its corners' normals face), its area, the angle at each corner and its longest side. */
function faceShape(corners, position, given) {
  const p = corners.map((c) => position[c]);
  const across = cross(sub(p[1], p[0]), sub(p[2], p[0]));
  let normal = normalize(across);
  if (dot(normal, corners.map((c) => given[c]).reduce(add)) < 0) normal = scale(normal, -1);
  const size = Math.max(...[0, 1, 2].map((k) => length(sub(p[(k + 1) % 3], p[k]))));
  return { normal, area: length(across) / 2, angles: cornerAngles(p), size };
}
