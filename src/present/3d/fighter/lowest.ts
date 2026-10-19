/**
 * A posed fighter's lowest points (metres, the picture's y): its whole body's and its feet's, read
 * from each vertex's weighted points through its joints' matrices, every frame, for lifting it
 * onto the floor. Its joint sets are flags, one a joint, read with no lookup.
 */

/** The most joints a vertex hangs on. */
const INFLUENCES = 4;

/** A set of joints as flags, one a joint (1 in the set). */
export function jointFlags(joints: ReadonlySet<number>): Uint8Array {
  const flags = new Uint8Array(256);
  for (const joint of joints) flags[joint] = 1;
  return flags;
}

/**
 * Into `out`, the lowest of the vertices (`joints`, `weights` and `points`, four slots a vertex) as
 * `matrices` (sixteen a joint, column-major) pose them, and the lowest of those whose heaviest joint
 * is one of `feet`; a vertex on any of `leftOut` (a joint past `slots` standing for the one
 * `hangs` names) left out, and one weighing nothing drawn nowhere.
 */
export function lowestPoint(joints: Float32Array, weights: Float32Array, points: Float32Array, matrices: Float32Array, slots: number, hangs: Uint8Array | null, feet: Uint8Array, leftOut: Uint8Array, out: { body: number; feet: number }): void {
  let body = Infinity;
  let lowestFoot = Infinity;
  vertices: for (let at = 0; at < weights.length; at += INFLUENCES) {
    let y = 0;
    let sum = 0;
    let heaviest = 0;
    let on = -1;
    for (let k = at; k < at + INFLUENCES; k += 1) {
      const w = weights[k]!;
      if (w === 0) continue;
      const joint = joints[k]!;
      /* A kept point's joint stands for the joint it hangs on. */
      const hung = joint < slots ? joint : hangs![joint - slots]!;
      if (leftOut[hung] === 1) continue vertices;
      if (w > heaviest) {
        heaviest = w;
        on = hung;
      }
      const o = joint * 16;
      const p = k * 3;
      y += w * (matrices[o + 1]! * points[p]! + matrices[o + 5]! * points[p + 1]! + matrices[o + 9]! * points[p + 2]! + matrices[o + 13]!);
      sum += w;
    }
    if (sum === 0) continue;
    if (y < body) body = y;
    if (on >= 0 && feet[on] === 1 && y < lowestFoot) lowestFoot = y;
  }
  out.body = body;
  out.feet = lowestFoot;
}
