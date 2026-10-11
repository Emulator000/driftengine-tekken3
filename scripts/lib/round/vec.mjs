/** Three-vectors as `[x, y, z]`, rotations as row-major `number[9]`, frames as `{ r, t }`. */
export const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a) => Math.hypot(a[0], a[1], a[2]);
export const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** `a` made unit length, or zero where it has none. */
export function normalize(a) {
  const l = length(a);
  return l > 1e-12 ? scale(a, 1 / l) : [0, 0, 0];
}

/** r · p, and rᵀ · p. */
export const apply = (r, p) => [r[0] * p[0] + r[1] * p[1] + r[2] * p[2], r[3] * p[0] + r[4] * p[1] + r[5] * p[2], r[6] * p[0] + r[7] * p[1] + r[8] * p[2]];
export const applyT = (r, p) => [r[0] * p[0] + r[3] * p[1] + r[6] * p[2], r[1] * p[0] + r[4] * p[1] + r[7] * p[2], r[2] * p[0] + r[5] * p[1] + r[8] * p[2]];

/** a · b. */
export function mul(a, b) {
  const r = new Array(9);
  for (let i = 0; i < 3; i += 1) for (let k = 0; k < 3; k += 1) r[i * 3 + k] = a[i * 3] * b[k] + a[i * 3 + 1] * b[3 + k] + a[i * 3 + 2] * b[6 + k];
  return r;
}

/** A point out of a frame's space, and back into it. */
export const place = (frame, p) => add(apply(frame.r, p), frame.t);
export const unplace = (frame, p) => applyT(frame.r, sub(p, frame.t));
