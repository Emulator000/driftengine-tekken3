/**
 * A fighter's bind pose: where each joint sits so that the two points of every seam meet. A model's
 * parts are made in their joints' spaces, a seam naming one place in two of them; the skeleton's
 * offsets with every rotation at zero do not bring them together. Each joint is placed, parents
 * first, by the rigid motion that best brings its seam points onto those of the joints already
 * placed (Horn's quaternion method); where they lie on one line, its origin at its offset fixes the
 * turn; where they are one place, it is turned home from its offset pose and spun about that place
 * so the faces joining it to the joints placed lie closest to them; a joint with no such points, or
 * whose points do not meet even so, hangs from its parent by its offset and, for an accessory, its
 * rest rotation. Each frame says how it was placed (`placed`): by its seams, by its seams and
 * origin, by one seam and its faces, hung with no seams to meet, or hung because its seams failed to
 * place it.
 */
import { add, apply, cross, dot, IDENTITY, length, mul, normalize, place, scale, sub } from './vec.mjs';

const TURN = 65536;

/** A seam whose two places lie further apart than this (millimetres) at the bind pose does not close: an armpit, stretched in every pose. */
export const ELASTIC = 5;

/** Rz · Ry · Rx from three 16-bit angles, as the game turns a joint. */
export function eulerRotation(rx, ry, rz) {
  const angle = (a) => (a / TURN) * 2 * Math.PI;
  const [sx, cx] = [Math.sin(angle(rx)), Math.cos(angle(rx))];
  const [sy, cy] = [Math.sin(angle(ry)), Math.cos(angle(ry))];
  const [sz, cz] = [Math.sin(angle(rz)), Math.cos(angle(rz))];
  return [cy * cz, sy * sx * cz - cx * sz, sx * sz + sy * cx * cz, cy * sz, cx * cz + sy * sx * sz, cx * sz * sy - sx * cz, -sy, sx * cy, cy * cx];
}

/** The eigenvalues and eigenvectors (column `i` is vector `i`) of a symmetric matrix, by cyclic Jacobi rotations. */
export function symmetricEigen(m) {
  const n = m.length;
  const a = m.map((row) => [...row]);
  const v = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 64; sweep += 1) {
    let off = 0;
    for (let p = 0; p < n; p += 1) for (let q = p + 1; q < n; q += 1) off += a[p][q] * a[p][q];
    if (off < 1e-30) break;
    for (let p = 0; p < n; p += 1) {
      for (let q = p + 1; q < n; q += 1) {
        if (a[p][q] === 0) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k += 1) {
          const [kp, kq] = [a[k][p], a[k][q]];
          a[k][p] = c * kp - s * kq;
          a[k][q] = s * kp + c * kq;
        }
        for (let k = 0; k < n; k += 1) {
          const [pk, qk] = [a[p][k], a[q][k]];
          a[p][k] = c * pk - s * qk;
          a[q][k] = s * pk + c * qk;
        }
        for (let k = 0; k < n; k += 1) {
          const [kp, kq] = [v[k][p], v[k][q]];
          v[k][p] = c * kp - s * kq;
          v[k][q] = s * kp + c * kq;
        }
      }
    }
  }
  return { values: a.map((row, i) => row[i]), vectors: v };
}

/** The rotation that best turns the points `a` onto `b` (both about their centroids), or null where they do not fix one. */
export function fitRotation(a, b) {
  const s = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < a.length; i += 1) for (let r = 0; r < 3; r += 1) for (let c = 0; c < 3; c += 1) s[r * 3 + c] += a[i][r] * b[i][c];
  const [xx, xy, xz, yx, yy, yz, zx, zy, zz] = s;
  const { values, vectors } = symmetricEigen([
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ]);
  const order = values.map((value, i) => [value, i]).sort((p, q) => q[0] - p[0]);
  const [[top, best], [second]] = order;
  if (top - second <= 1e-6 * Math.max(1, Math.abs(top))) return null;
  const [w, x, y, z] = vectors.map((row) => row[best]);
  return [
    w * w + x * x - y * y - z * z, 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), w * w - x * x + y * y - z * z, 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), w * w - x * x - y * y + z * z,
  ];
}

/** A turn by `angle` about the unit `axis`. */
function turnAbout([x, y, z], angle) {
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  const k = 1 - c;
  return [c + x * x * k, x * y * k - z * s, x * z * k + y * s, y * x * k + z * s, c + y * y * k, y * z * k - x * s, z * x * k - y * s, z * y * k + x * s, c + z * z * k];
}

/** The smallest turn taking the unit `u` onto the unit `w`. */
function turnBetween(u, w) {
  const axis = cross(u, w);
  const sin = length(axis);
  if (sin > 1e-9) return turnAbout(scale(axis, 1 / sin), Math.atan2(sin, dot(u, w)));
  if (dot(u, w) > 0) return IDENTITY;
  return turnAbout(normalize(cross(u, Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])), Math.PI);
}

const centroid = (points) => scale(points.reduce(add, [0, 0, 0]), 1 / points.length);

/** The rigid motion that best brings `mine` onto `theirs` (centroids and Horn's rotation), or null. */
function fitRigid(mine, theirs) {
  const [ca, cb] = [centroid(mine), centroid(theirs)];
  const r = fitRotation(mine.map((p) => sub(p, ca)), theirs.map((p) => sub(p, cb)));
  return r === null ? null : { r, t: sub(cb, apply(r, ca)) };
}

/**
 * The rigid motion that best brings `mine` onto `theirs` while every pair meets within the elastic
 * gap: while one does not, the seam place (with its copies) whose leaving out lets the rest meet
 * best is left out, so an armpit does not pull the joint off the seams that close. Null where three
 * places do not fix a turn.
 */
function fitClosing(mine, theirs) {
  const keys = mine.map((p, i) => `${p}|${theirs[i]}`);
  const fitOf = (kept) => fitRigid(kept.map((i) => mine[i]), kept.map((i) => theirs[i]));
  const worstOf = (fit, kept) => Math.max(...kept.map((i) => length(sub(place(fit, mine[i]), theirs[i]))));
  let kept = mine.map((_, i) => i);
  let fit = fitOf(kept);
  while (fit !== null && worstOf(fit, kept) > ELASTIC) {
    const places = [...new Set(kept.map((i) => keys[i]))];
    if (places.length <= 3) break;
    let best = null;
    for (const key of places) {
      const fewer = kept.filter((i) => keys[i] !== key);
      const refit = fitOf(fewer);
      const worst = refit === null ? Infinity : worstOf(refit, fewer);
      if (best === null || worst < best.worst) best = { fewer, refit, worst };
    }
    if (best.refit === null) break;
    [kept, fit] = [best.fewer, best.refit];
  }
  return fit;
}

/**
 * The turn about `axis` (radians) that keeps `edges` shortest for the joint's frame turned so from
 * `base`: each edge one vertex on the joint, one off it, both on placed joints otherwise.
 */
function bestSpin(joint, base, t, axis, edges, frames) {
  const at = (v, frame) => v.influences.reduce((s, f) => add(s, scale(place(f.joint === joint ? frame : frames[f.joint], f.point), f.weight)), [0, 0, 0]);
  const energy = (angle) => {
    const frame = { r: mul(turnAbout(axis, angle), base), t };
    return edges.reduce((s, [u, v]) => s + dot(sub(at(u, frame), at(v, frame)), sub(at(u, frame), at(v, frame))), 0);
  };
  let best = 0;
  for (const step of [Math.PI / 180, Math.PI / 1800, Math.PI / 18000]) {
    const from = step === Math.PI / 180 ? 0 : best - 10 * step;
    const count = step === Math.PI / 180 ? 360 : 21;
    let low = energy(best);
    for (let k = 0; k < count; k += 1) {
      const angle = from + k * step;
      const e = energy(angle);
      if (e < low) [best, low] = [angle, e];
    }
  }
  return best;
}

function placeJoint(node, frames, seams, edges) {
  const parent = node.parent < 0 ? { r: IDENTITY, t: [0, 0, 0] } : frames[node.parent];
  const hung = { r: mul(parent.r, node.rest ? eulerRotation(...node.rest) : IDENTITY), t: place(parent, node.offset), placed: 'hung', against: node.parent < 0 ? [] : [node.parent] };
  const mine = [];
  const theirs = [];
  const against = new Set();
  for (const v of seams) {
    const own = v.influences.find((f) => f.joint === node.joint);
    if (own === undefined) continue;
    for (const other of v.influences) {
      if (other === own || frames[other.joint] === undefined) continue;
      mine.push(own.point);
      theirs.push(place(frames[other.joint], other.point));
      against.add(other.joint);
    }
  }
  if (mine.length === 0) return hung;
  if (mine.length >= 3) {
    const fit = fitClosing(mine, theirs);
    if (fit !== null) return { ...fit, placed: 'seams', against: [...against] };
  }
  /* Seams on one line (a foot joined to its shin at two places): the joint's origin where its offset puts it fixes the turn. */
  const r = fitRotation(mine, theirs.map((p) => sub(p, hung.t)));
  if (r !== null) return { r, t: hung.t, placed: 'origin', against: [...against, ...hung.against] };
  /* One seam place (an upper arm on its shoulder): turned home from the offset pose, spun so the faces joining the joint lie closest. */
  const far = mine.reduce((best, p, i) => (length(p) > length(mine[best]) ? i : best), 0);
  const [a, b] = [apply(hung.r, mine[far]), sub(theirs[far], hung.t)];
  if (length(a) < 1e-6 || length(b) < 1e-6) return { ...hung, placed: 'failed' };
  const axis = normalize(b);
  const base = mul(turnBetween(normalize(a), axis), hung.r);
  const joining = edges.filter(([u, v]) => {
    const [ju, jv] = [u, v].map((x) => x.influences.map((f) => f.joint));
    return ju.includes(node.joint) && !jv.includes(node.joint) && [...ju, ...jv].every((j) => j === node.joint || frames[j] !== undefined);
  });
  const frame = { r: mul(turnAbout(axis, bestSpin(node.joint, base, hung.t, axis, joining, frames)), base), t: hung.t };
  if (mine.some((p, i) => length(sub(place(frame, p), theirs[i])) > ELASTIC)) return { ...hung, placed: 'failed' };
  return { ...frame, placed: 'spin', against: [...against, ...hung.against] };
}

/** Each joint's bind frame, by joint (a sparse array), from the mesh's vertices and, where they help, its triangles' edges. */
export function bindPose(vertices, skeleton, indices = []) {
  const frames = [];
  const seams = vertices.filter((v) => v.influences.length >= 2);
  /* Each edge once, either way round, as its two vertices (each edge an [u, v] with u on the joint placed). */
  const pairs = new Map();
  for (let f = 0; f + 2 < indices.length; f += 3) {
    for (let s = 0; s < 3; s += 1) {
      const [a, b] = [indices[f + s], indices[f + ((s + 1) % 3)]];
      pairs.set(a < b ? `${a}-${b}` : `${b}-${a}`, [vertices[a], vertices[b]]);
    }
  }
  const edges = [...pairs.values()].flatMap(([a, b]) => [[a, b], [b, a]]);
  const pending = [...skeleton].sort((a, b) => a.joint - b.joint);
  while (pending.length > 0) {
    const k = pending.findIndex((j) => j.parent < 0 || frames[j.parent] !== undefined);
    if (k < 0) throw new Error(`joints ${pending.map((j) => j.joint).join(', ')} hang on no joint of the skeleton`);
    const [node] = pending.splice(k, 1);
    frames[node.joint] = placeJoint(node, frames, seams, edges);
  }
  for (const v of vertices) {
    for (const joint of [...v.influences.map((f) => f.joint), v.normalJoint]) {
      if (frames[joint] === undefined) throw new Error(`a vertex hangs on joint ${joint}, which the skeleton does not have`);
    }
  }
  return frames;
}

/** The joints whose bind frames can be trusted: each but those its seams failed to place, and those placed against one of them. */
export function trustedJoints(frames) {
  const trusted = new Map();
  const trust = (joint) => {
    if (!trusted.has(joint)) {
      trusted.set(joint, false);
      const frame = frames[joint];
      trusted.set(joint, frame.placed !== 'failed' && frame.against.every(trust));
    }
    return trusted.get(joint);
  };
  return new Set(frames.flatMap((frame, joint) => (frame !== undefined && trust(joint) ? [joint] : [])));
}

/** A vertex's place at the bind pose: its points through their joints, weighted (a seam's two averaged). */
export const bindPosition = (v, frames) => v.influences.reduce((s, f) => add(s, scale(place(frames[f.joint], f.point), f.weight)), [0, 0, 0]);

/** A vertex's normal at the bind pose, unit, or zero where it has none. */
export const bindNormal = (v, frames) => normalize(apply(frames[v.normalJoint].r, v.normal.map((x) => x / 4096)));

/** How far apart each seam's two points lie at the bind pose. */
export const seamGaps = (vertices, frames) =>
  vertices.filter((v) => v.influences.length >= 2).map(({ influences: [a, b] }) => length(sub(place(frames[a.joint], a.point), place(frames[b.joint], b.point))));
