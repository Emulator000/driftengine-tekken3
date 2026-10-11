/**
 * A mesh's surface at its bind pose: corners welded into the points they are (one skin, facing
 * within 120° of each other: only the two sides of a thin piece face further apart, and they stay
 * apart; the model gives each texture panel its own normals, which must not split the surface),
 * faces turned the way their corners face, each edge smooth or a crease (bent past 100°; bent past
 * 60° onto a face less than a third as wide across it as the other, as a sandal's broad face folds
 * onto its narrow side, where rounding would swell past the narrow face; or an open border: a
 * low-poly limb bends 60° to 100° between faces of a like width, and rounds), and each
 * corner's normal from the faces joined to it across smooth edges, weighted by their angle there
 * and their area (so a thin block's broad faces hold its corners' normals, and it rounds at its
 * edges rather than swelling).
 *
 * A face rounds only where the bind pose holds it as the model has it (`round`): none of its corners
 * a seam whose places do not meet (an armpit), and every two joints it spans either joined by seams
 * that meet within 2 mm or both placed by trusted frames. Any other face stays flat, its edges
 * straight.
 *
 * `reshape` gives the places and corners' normals of the same surface with its vertices moved (a
 * hand's other shape): the same points, faces, edges and groups.
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

  /* Welding: one skin, and a facing within 120° (a vertex with no normal joins the first). */
  const pointOf = new Int32Array(vertices.length);
  const clusters = new Map();
  let points = 0;
  vertices.forEach((v, i) => {
    const key = skinKey(v);
    if (!clusters.has(key)) clusters.set(key, []);
    const list = clusters.get(key);
    const known = length(given[i]) > 0.5;
    let cluster = list.find((c) => !known || !c.known || dot(c.normal, given[i]) >= WELD);
    if (cluster === undefined) {
      cluster = { normal: given[i], known, id: points };
      points += 1;
      list.push(cluster);
    }
    pointOf[i] = cluster.id;
  });

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
    faces.push({ corners, points: corners.map((c) => pointOf[c]), ...faceShape(corners, position, given), round: roundable(corners) });
  }

  /* The faces each edge bounds. */
  const edges = new Map();
  faces.forEach((face, f) => {
    for (let s = 0; s < 3; s += 1) {
      const key = edgeKey(face.points[s], face.points[(s + 1) % 3]);
      if (!edges.has(key)) edges.set(key, []);
      edges.get(key).push(f);
    }
  });
  /* How wide a face is across one of its edges: its height over that edge. */
  const widthAcross = (f, a, b) => {
    const face = faces[f];
    const [pa, pb] = [a, b].map((point) => position[face.corners[face.points.indexOf(point)]]);
    const span = length(sub(pb, pa));
    return span > 0 ? (2 * face.area) / span : 0;
  };
  const smooth = (key) => {
    const list = edges.get(key);
    if (list === undefined || list.length !== 2 || !faces[list[0]].round || !faces[list[1]].round) return false;
    const bend = dot(faces[list[0]].normal, faces[list[1]].normal);
    if (bend >= BEND) return true;
    if (bend < CREASE) return false;
    const [a, b] = key.split('-').map(Number);
    const widths = list.map((f) => widthAcross(f, a, b));
    return Math.min(...widths) >= NARROW * Math.max(...widths);
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
  /* A corner's normal: its group's, else its own given one, else its face's, else up. */
  const normalsOf = (shapes, givenNormals) => {
    const sums = new Map();
    shapes.forEach((shape, f) => {
      for (let s = 0; s < 3; s += 1) {
        const g = group(f, s);
        sums.set(g, add(sums.get(g) ?? [0, 0, 0], scale(shape.normal, shape.angles[s] * shape.area)));
      }
    });
    return (f, s) => {
      for (const n of [normalize(sums.get(group(f, s))), givenNormals[faces[f].corners[s]], shapes[f].normal]) if (length(n) > 0.5) return n;
      return [0, -1, 0];
    };
  };
  const normal = normalsOf(faces, given);
  /**
   * The surface with its vertices moved (another shape of a hand): their places and corners'
   * normals, from the same points, faces, edges and groups.
   */
  const reshape = (moved) => {
    const at = moved.map((v) => bindPosition(v, frames));
    const facing = moved.map((v) => bindNormal(v, frames));
    return { position: at, normal: normalsOf(faces.map((face) => faceShape(face.corners, at, facing)), facing) };
  };
  return { position, pointOf, faces, smooth, group, normal, reshape };
}

/** A face's normal (turned the way its corners' normals face), its area and the angle at each corner. */
function faceShape(corners, position, given) {
  const p = corners.map((c) => position[c]);
  const across = cross(sub(p[1], p[0]), sub(p[2], p[0]));
  let normal = normalize(across);
  if (dot(normal, corners.map((c) => given[c]).reduce(add)) < 0) normal = scale(normal, -1);
  return { normal, area: length(across) / 2, angles: cornerAngles(p) };
}
