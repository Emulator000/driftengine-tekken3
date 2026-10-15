/**
 * A fighter's normals turned the way its faces face. The player draws a face from its front alone
 * (`FTR` version 6), lit by its corners' normals; a corner whose normal points against the triangles
 * it is on (their fronts, by their winding, weighed by their area, at the bind pose) would light its
 * face from behind, and has its normal turned round, in each of its hand's shapes too.
 */
import { bindNormal, bindPose, bindPosition } from './round/bind.mjs';
import { add, cross, dot, sub } from './round/vec.mjs';

/**
 * `mesh` as `writeFtr5` takes it, its triangles wound counter-clockwise seen from their front, and
 * the skeleton it hangs on: the mesh with its normals turned the way its faces face, and how many
 * were turned.
 */
export function facingNormals(mesh, skeleton) {
  const { vertices, indices, shapes = [] } = mesh;
  const frames = bindPose(vertices, skeleton, indices);
  const place = vertices.map((v) => bindPosition(v, frames));
  const fronts = vertices.map(() => [0, 0, 0]);
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]];
    const front = cross(sub(place[b], place[a]), sub(place[c], place[a]));
    for (const i of [a, b, c]) fronts[i] = add(fronts[i], front);
  }
  const turned = vertices.map((v, i) => dot(bindNormal(v, frames), fronts[i]) < 0);
  const round = (n) => n.map((x) => -x + 0);
  return {
    mesh: {
      ...mesh,
      vertices: vertices.map((v, i) => (turned[i] ? { ...v, normal: round(v.normal) } : v)),
      shapes: shapes.map((group) => ({
        ...group,
        shapes: group.shapes.map((form) => form.map((f, k) => (turned[group.vertices[k]] ? { ...f, normal: round(f.normal) } : f))),
      })),
    },
    turned: turned.filter(Boolean).length,
  };
}
