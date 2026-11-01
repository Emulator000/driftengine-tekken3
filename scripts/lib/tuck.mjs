/**
 * The joins between the hips and a leg kept behind the hips' skin over them. A fighter's hips are
 * joined to its thighs by triangles each corner of which hangs on the one or the other alone; where
 * the hips' skin lies over such a join (a skirt made of it, on the hips or blended with a leg as its
 * hem is, or the hips' shell overlapping a thigh's top), the join sweeps out through it as the leg
 * swings. The console, drawing whole polygons by their depth, kept it behind, where a depth buffer
 * shows the thin slice that comes through. So a join hidden at rest (the line out along its face
 * meets the hips' skin facing the same way within `SKIRT_REACH`) has its places on the hips moved
 * `TUCK` nearer the hips' axis: every point at each place, so no seam opens.
 */
import { bindPose, bindPosition } from './round/bind.mjs';
import { cross, dot, sub, unplace } from './round/vec.mjs';

/** The hips' joint, and the legs' (thighs, shins and feet). */
const HIPS = 11;
const LEGS = new Set([12, 13, 14, 15, 16, 17]);
/** How far a hidden join's place on the hips is moved toward the hips' axis, and how far over it the hips' skin may lie (millimetres). */
export const TUCK = 15;
export const SKIRT_REACH = 80;
/** How nearly the layer over a join faces its way: within about 70°. */
const FACING = 0.35;

/** How far along the line from `o` along `d` it crosses triangle `a b c`, as a share of `d`; -1 where it does not. */
function crossing(o, d, a, b, c) {
  const e1 = sub(b, a);
  const e2 = sub(c, a);
  const p = cross(d, e2);
  const det = dot(e1, p);
  if (Math.abs(det) < 1e-9) return -1;
  const s = sub(o, a);
  const u = dot(s, p) / det;
  if (u < 0 || u > 1) return -1;
  const q = cross(s, e1);
  const v = dot(d, q) / det;
  if (v < 0 || u + v > 1) return -1;
  return dot(e2, q) / det;
}

/** Joints as the hips and the legs see them: `garment` (posed as the hips, 0 none) one of the hips. */
function parts(garment) {
  const hipsLike = (j) => j === HIPS || (garment !== 0 && j === garment);
  return {
    onHips: (v) => v.influences.every((f) => f.weight === 0 || hipsLike(f.joint)),
    onLeg: (v) => v.influences.every((f) => f.weight === 0 || LEGS.has(f.joint)),
    touchesHips: (v) => v.influences.some((f) => f.weight > 0 && hipsLike(f.joint)),
  };
}

/** Whether a triangle (its three points) joins the hips to a leg, each corner on the one or the other alone. */
const joining = (vs, { onHips, onLeg }) => vs.every((v) => onHips(v) || onLeg(v)) && vs.some(onHips) && vs.some(onLeg);

/**
 * The test of whether a triangle lies hidden under the hips' own skin at rest: whether the line out
 * along its face, from its middle or a corner, meets the hips' skin (a triangle with a corner on the
 * hips, alone or blended, joining nothing to a leg, and sharing no place with it) facing the same
 * way (a layer over it) within `SKIRT_REACH`. `at`, each point's place at rest; the test takes a
 * triangle's three corners.
 */
function hiddenUnderHips(vertices, indices, at, garment = 0) {
  const p = parts(garment);
  const skin = [];
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const corners = [indices[i], indices[i + 1], indices[i + 2]];
    const vs = corners.map((c) => vertices[c]);
    if (!joining(vs, p) && vs.some(p.touchesHips)) skin.push(corners);
  }
  const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 0.5;
  return (corners) => {
    const [a, b, c] = corners.map((k) => at[k]);
    const face = cross(sub(b, a), sub(c, a));
    const size = Math.hypot(face[0], face[1], face[2]);
    if (size < 1e-6) return false;
    const n = face.map((x) => x / size);
    const middle = [0, 1, 2].map((k) => (a[k] + b[k] + c[k]) / 3);
    return [middle, a, b, c].some((from) =>
      skin.some((t) => {
        if (t.some((k) => corners.some((j) => near(at[k], at[j])))) return false;
        const along = crossing(from, n, at[t[0]], at[t[1]], at[t[2]]);
        if (!(along > 0.5 && along < SKIRT_REACH)) return false;
        const over = cross(sub(at[t[1]], at[t[0]]), sub(at[t[2]], at[t[0]]));
        return dot(over, n) > FACING * Math.hypot(over[0], over[1], over[2]);
      }),
    );
  };
}

/**
 * The hidden joins' places on the hips tucked in (`readFtr`'s mesh, its `skeleton` as exported;
 * `garment`, the joint posed as the hips, 0 none), in place; returns how many points moved.
 */
export function tuckUnderSkirt(mesh, skeleton, garment = mesh.garment ?? 0) {
  const { vertices, indices } = mesh;
  if (!skeleton.some((j) => j.joint === HIPS)) return 0;
  const p = parts(garment);
  const placeOf = (v) => v.influences.map((f) => `${f.joint}:${f.weight}:${f.point.join(',')}`).join('|');
  const frames = bindPose(vertices, skeleton, indices);
  /* Every point at rest in the hips' frame: x down the hips, the axis where y and z are 0. */
  const at = vertices.map((v) => unplace(frames[HIPS], bindPosition(v, frames)));
  const hidden = hiddenUnderHips(vertices, indices, at, garment);
  /* A hidden join has its places on the hips tucked toward the hips' axis. */
  const tucked = new Map();
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const corners = [indices[i], indices[i + 1], indices[i + 2]];
    if (!joining(corners.map((c) => vertices[c]), p) || !hidden(corners)) continue;
    for (const c of corners) {
      if (!p.onHips(vertices[c])) continue;
      const out = Math.hypot(at[c][1], at[c][2]);
      if (out >= 1) tucked.set(placeOf(vertices[c]), Math.max(0, out - TUCK) / out);
    }
  }
  let moved = 0;
  for (const v of vertices) {
    const k = tucked.get(placeOf(v));
    if (k === undefined) continue;
    for (const f of v.influences) f.point = [f.point[0], Math.round(f.point[1] * k), Math.round(f.point[2] * k)];
    moved += 1;
  }
  return moved;
}
