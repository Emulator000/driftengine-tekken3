/**
 * A cut surface made even (Taubin's λ|μ smoothing): each pass moves every free place toward its
 * neighbours' mean, the next back by a little more, so bumps and flat facets even out while the
 * surface keeps its size. A place moves only along its normal, so its texture stays where it lies;
 * places not free stay where they are.
 */

/** How far a pass moves a place toward its neighbours' mean, and the pass after it back. */
export const LAMBDA = 0.5;
export const MU = -0.53;

/** Each place's neighbours from triangles of places (three a triangle): `start[i]` to `start[i + 1]` in `list`. */
export function neighboursOf(count, triangles) {
  const sets = Array.from({ length: count }, () => new Set());
  for (let t = 0; t + 2 < triangles.length; t += 3) {
    for (let k = 0; k < 3; k += 1) {
      const [a, b] = [triangles[t + k], triangles[t + ((k + 1) % 3)]];
      if (a === b) continue;
      sets[a].add(b);
      sets[b].add(a);
    }
  }
  const start = new Int32Array(count + 1);
  sets.forEach((set, i) => (start[i + 1] = start[i] + set.size));
  const list = new Int32Array(start[count]);
  sets.forEach((set, i) => list.set([...set].sort((a, b) => a - b), start[i]));
  return { start, list };
}

/**
 * Places `at` (three numbers a place) after `passes` pairs of passes over `neighbours`, each free
 * place moving along its unit `direction` (three numbers a place).
 */
export function fair(at, direction, free, neighbours, passes) {
  const { start, list } = neighbours;
  let from = Float64Array.from(at);
  let to = new Float64Array(at.length);
  for (let pass = 0; pass < passes * 2; pass += 1) {
    const factor = pass % 2 === 0 ? LAMBDA : MU;
    to.set(from);
    for (let i = 0; i < free.length; i += 1) {
      const count = start[i + 1] - start[i];
      if (!free[i] || count === 0) continue;
      let along = 0;
      for (let c = 0; c < 3; c += 1) {
        let sum = 0;
        for (let k = start[i]; k < start[i + 1]; k += 1) sum += from[list[k] * 3 + c];
        along += (sum / count - from[i * 3 + c]) * direction[i * 3 + c];
      }
      for (let c = 0; c < 3; c += 1) to[i * 3 + c] = from[i * 3 + c] + factor * along * direction[i * 3 + c];
    }
    [from, to] = [to, from];
  }
  return from;
}
