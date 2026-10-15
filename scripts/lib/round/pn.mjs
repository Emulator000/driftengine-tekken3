/**
 * Curved triangles through their corners (Vlachos, Peters, Boyd and Mitchell's PN triangles): a
 * cubic patch whose edges bulge along the corners' normals, or run straight where told, and a
 * quadratic normal across it. A point along an edge depends on that edge alone, so the two faces of
 * an edge that compute it from the same ends meet exactly.
 */
import { add, dot, lerp, normalize, scale, sub } from './vec.mjs';

/** An edge's two inner control points, from a to b: pulled along the ends' normals, or on the straight edge. */
function edgeControls(pa, pb, na, nb, straight) {
  if (straight) return [lerp(pa, pb, 1 / 3), lerp(pa, pb, 2 / 3)];
  const d = sub(pb, pa);
  return [scale(sub(add(scale(pa, 2), pb), scale(na, dot(d, na))), 1 / 3), scale(add(add(scale(pb, 2), pa), scale(nb, dot(d, nb))), 1 / 3)];
}

/** The normal halfway along an edge, turned back as the edge bends, or the ends' mean on a straight edge. */
function edgeNormal(pa, pb, na, nb, straight) {
  const sum = add(na, nb);
  if (straight) return normalize(sum);
  const d = sub(pb, pa);
  const dd = dot(d, d);
  return normalize(sub(sum, scale(d, dd > 0 ? (2 * dot(d, sum)) / dd : 0)));
}

/** The point at `t` along an edge from a to b, and its normal. */
export function edgePoint(pa, pb, na, nb, straight, t) {
  const [b1, b2] = edgeControls(pa, pb, na, nb, straight);
  const s = 1 - t;
  const position = add(add(scale(pa, s * s * s), scale(b1, 3 * s * s * t)), add(scale(b2, 3 * s * t * t), scale(pb, t * t * t)));
  const normal = normalize(add(add(scale(na, s * s), scale(nb, t * t)), scale(edgeNormal(pa, pb, na, nb, straight), s * t)));
  return { position, normal };
}

/**
 * A triangle's patch: corners `p`, their normals `n`, and whether each edge (0-1, 1-2, 2-0) runs
 * straight; `ends` gives each edge's normals at its two ends where they are not its corners'.
 */
export function patchOf(p, n, straight, ends = [[n[0], n[1]], [n[1], n[2]], [n[2], n[0]]]) {
  const [b210, b120] = edgeControls(p[0], p[1], ...ends[0], straight[0]);
  const [b021, b012] = edgeControls(p[1], p[2], ...ends[1], straight[1]);
  const [b102, b201] = edgeControls(p[2], p[0], ...ends[2], straight[2]);
  const e = scale([b210, b120, b021, b012, b102, b201].reduce(add), 1 / 6);
  const v = scale(add(add(p[0], p[1]), p[2]), 1 / 3);
  return {
    p,
    n,
    b210,
    b120,
    b021,
    b012,
    b102,
    b201,
    b111: add(e, scale(sub(e, v), 0.5)),
    n110: edgeNormal(p[0], p[1], ...ends[0], straight[0]),
    n011: edgeNormal(p[1], p[2], ...ends[1], straight[1]),
    n101: edgeNormal(p[2], p[0], ...ends[2], straight[2]),
  };
}

/** The patch at barycentric weights w, u, v of corners 0, 1, 2. */
export function evaluate(q, w, u, v) {
  const points = [
    [q.p[0], w * w * w], [q.p[1], u * u * u], [q.p[2], v * v * v],
    [q.b210, 3 * w * w * u], [q.b120, 3 * w * u * u], [q.b201, 3 * w * w * v],
    [q.b021, 3 * u * u * v], [q.b102, 3 * w * v * v], [q.b012, 3 * u * v * v],
    [q.b111, 6 * w * u * v],
  ];
  const normals = [[q.n[0], w * w], [q.n[1], u * u], [q.n[2], v * v], [q.n110, w * u], [q.n011, u * v], [q.n101, w * v]];
  return {
    position: points.reduce((s, [b, k]) => add(s, scale(b, k)), [0, 0, 0]),
    normal: normalize(normals.reduce((s, [m, k]) => add(s, scale(m, k)), [0, 0, 0])),
  };
}
