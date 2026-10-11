/**
 * Kazuya drawn from his own model, for what of his portrait Tekken 4's art leaves out
 * (`kazuya-select.mjs`). The renderer is a plain one: his mesh posed by Tekken 3's pose code and the
 * Tekken 4 rig (`src/mod/kazuya/tekken4.ts`), textured (bilinear), lit in linear light by a key, a fill
 * and a rim, drawn `supersample` times over in each direction and averaged down, alpha the share of
 * samples he covers.
 */
import { readFighterMesh } from '../../../src/present/3d/fighter/fighter.ts';
import { bonesOf, framesOf, restChannels } from './kazuya.mjs';
import { readMotion } from './motion.mjs';
import { convertFrame, restRotation } from './retarget.mjs';

const toLinear = (c) => (c / 255) ** 2.2;

/** His mesh in a pose (Tekken 3's 49 channels): every vertex placed and its normal turned, in the game's axes (Y down). */
function posed(meshBytes, skeleton, tables, channels) {
  const mesh = readFighterMesh(meshBytes.buffer.slice(meshBytes.byteOffset, meshBytes.byteOffset + meshBytes.byteLength));
  const base = framesOf(channels, skeleton, tables).map((f) => ({ r: Float64Array.from(f.r), t: Float64Array.from(f.t) }));
  const joints = mesh.rig ? mesh.rig.extend(base) : base;
  const n = mesh.vertexCount;
  const P = new Float64Array(n * 3);
  const N = new Float64Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    for (let k = 0; k < mesh.influenceCount[i]; k += 1) {
      const slot = i * 4 + k;
      const j = joints[mesh.joints[slot]];
      const w = mesh.weights[slot];
      const p = [mesh.points[slot * 3], mesh.points[slot * 3 + 1], mesh.points[slot * 3 + 2]];
      for (let a = 0; a < 3; a += 1) P[i * 3 + a] += w * (j.r[a * 3] * p[0] + j.r[a * 3 + 1] * p[1] + j.r[a * 3 + 2] * p[2] + j.t[a]);
    }
    const j = joints[mesh.normalJoint[i]];
    const q = [mesh.normal[i * 3] / 4096, mesh.normal[i * 3 + 1] / 4096, mesh.normal[i * 3 + 2] / 4096];
    for (let a = 0; a < 3; a += 1) N[i * 3 + a] = j.r[a * 3] * q[0] + j.r[a * 3 + 1] * q[1] + j.r[a * 3 + 2] * q[2];
  }
  return { mesh, P, N, base };
}
const toDisplay = (v) => Math.round(255 * Math.min(1, Math.max(0, v)) ** (1 / 2.2));

/**
 * His mesh in a pose (Tekken 3's 49 channels), seen from `eye` toward `target` (Tekken 3's axes:
 * Y down), `fov` degrees across the height, into `width` by `height` pixels of display colour.
 * `lights` are directions toward each light with a colour; `background(x, y)` the colour behind.
 */
export function renderKazuya({ mesh: meshBytes, atlas, skeleton, tables, channels, eye, target, fov, width, height, lights, ambient, rim, above = -Infinity, supersample = 4 }) {
  const { mesh, P, N } = posed(meshBytes, skeleton, tables, channels);

  const n = mesh.vertexCount;

  /* The camera: forward toward the target, up against Y (the game's Y is down). */
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const forward = unit(sub(target, eye));
  const right = unit(cross(forward, [0, -1, 0]));
  const up = cross(right, forward);
  const W = width * supersample;
  const H = height * supersample;
  const focal = H / 2 / Math.tan((fov * Math.PI) / 360);
  const screen = new Float64Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    const d = sub([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], eye);
    const z = dot(d, forward);
    screen[i * 3] = W / 2 + (dot(d, right) * focal) / z;
    screen[i * 3 + 1] = H / 2 - (dot(d, up) * focal) / z;
    screen[i * 3 + 2] = z;
  }

  const colour = new Float32Array(W * H * 3);
  const depth = new Float32Array(W * H).fill(Infinity);
  /* Bilinear, over the texels that are drawn; none drawn, nothing. */
  const texel = (u, v) => {
    const fx = u * atlas.width - 0.5;
    const fy = v * atlas.height - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const sum = [0, 0, 0];
    let weight = 0;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const tx = Math.min(atlas.width - 1, Math.max(0, x0 + dx));
      const ty = Math.min(atlas.height - 1, Math.max(0, y0 + dy));
      const w = (dx ? fx - x0 : 1 - (fx - x0)) * (dy ? fy - y0 : 1 - (fy - y0));
      const o = (ty * atlas.width + tx) * 4;
      if (atlas.rgba[o + 3] < 128 || w === 0) continue;
      for (let a = 0; a < 3; a += 1) sum[a] += toLinear(atlas.rgba[o + a]) * w;
      weight += w;
    }
    return weight === 0 ? null : sum.map((c) => c / weight);
  };
  const viewDir = forward.map((v) => -v);
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const ids = [mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]];
    /* Leave out what lies wholly above `above` (Y is down). */
    if (ids.every((i) => P[i * 3 + 1] < above)) continue;
    const X = ids.map((i) => screen[i * 3]);
    const Y = ids.map((i) => screen[i * 3 + 1]);
    const Z = ids.map((i) => screen[i * 3 + 2]);
    if (Z.some((z) => z <= 1)) continue;
    const area = (X[1] - X[0]) * (Y[2] - Y[0]) - (X[2] - X[0]) * (Y[1] - Y[0]);
    if (Math.abs(area) < 1e-9) continue;
    const x0 = Math.max(0, Math.floor(Math.min(...X)));
    const x1 = Math.min(W - 1, Math.ceil(Math.max(...X)));
    const y0 = Math.max(0, Math.floor(Math.min(...Y)));
    const y1 = Math.min(H - 1, Math.ceil(Math.max(...Y)));
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const px = x + 0.5;
        const py = y + 0.5;
        let b0 = ((X[1] - px) * (Y[2] - py) - (X[2] - px) * (Y[1] - py)) / area;
        let b1 = ((X[2] - px) * (Y[0] - py) - (X[0] - px) * (Y[2] - py)) / area;
        let b2 = 1 - b0 - b1;
        if (b0 < 0 || b1 < 0 || b2 < 0) continue;
        /* Perspective-correct weights. */
        const w0 = b0 / Z[0];
        const w1 = b1 / Z[1];
        const w2 = b2 / Z[2];
        const sum = w0 + w1 + w2;
        b0 = w0 / sum;
        b1 = w1 / sum;
        b2 = w2 / sum;
        const z = 1 / sum;
        if (z >= depth[y * W + x]) continue;
        const u = b0 * mesh.uv[ids[0] * 2] + b1 * mesh.uv[ids[1] * 2] + b2 * mesh.uv[ids[2] * 2];
        const v = b0 * mesh.uv[ids[0] * 2 + 1] + b1 * mesh.uv[ids[1] * 2 + 1] + b2 * mesh.uv[ids[2] * 2 + 1];
        const albedo = texel(u, v);
        if (!albedo) continue;
        depth[y * W + x] = z;
        let normal = unit([0, 1, 2].map((a) => b0 * N[ids[0] * 3 + a] + b1 * N[ids[1] * 3 + a] + b2 * N[ids[2] * 3 + a]));
        /* Two-sided: a normal turned away from the eye is the back of a face seen. */
        if (dot(normal, viewDir) < 0) normal = normal.map((v) => -v);
        const lit = [...ambient];
        for (const { direction, colour: c } of lights) {
          const d = Math.max(0, dot(normal, unit(direction)));
          for (let a = 0; a < 3; a += 1) lit[a] += c[a] * d;
        }
        const edge = (1 - Math.max(0, dot(normal, viewDir))) ** 3;
        const rimLight = Math.max(0, dot(normal, unit(rim.direction)));
        for (let a = 0; a < 3; a += 1) colour[(y * W + x) * 3 + a] = albedo[a] * lit[a] + rim.colour[a] * edge * rimLight;
      }
    }
  }

  /* Averaged down over the samples he covers, to display colour; alpha the share covered. */
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const acc = [0, 0, 0];
      let covered = 0;
      for (let sy = 0; sy < supersample; sy += 1) {
        for (let sx = 0; sx < supersample; sx += 1) {
          const at = (y * supersample + sy) * W + x * supersample + sx;
          if (depth[at] === Infinity) continue;
          covered += 1;
          for (let a = 0; a < 3; a += 1) acc[a] += colour[at * 3 + a];
        }
      }
      const n = Math.max(1, covered);
      out.set([toDisplay(acc[0] / n), toDisplay(acc[1] / n), toDisplay(acc[2] / n), Math.round((255 * covered) / (supersample * supersample))], (y * width + x) * 4);
    }
  }
  return out;
}

/** His neck's base: Tekken 3's head joint, at the top of his spine. */
const NECK = 2;
/** The pose his chest is drawn in: his own motion 93 halfway (one no move plays; standing straight, arms down). */
const CHEST_MOTION = 93;
/** How far from his chest the camera stands, in millimetres: far enough that his chest is drawn almost flat, as a portrait lens does. */
const DISTANCE = 2400;
/** What of him is left out above his neck's base, in millimetres: his head, which the art draws. */
const HEAD_CUT = 60;

/**
 * What draws his chest for the portrait: `{ width, height, crown, neck }` (the portrait as it shows,
 * square pixels; the line his hair's top is on and his neck's base's point) to RGBA, his head left
 * out. The scale is his own: his head's height over his neck's base, standing as built, over the
 * lines between `crown` and `neck`. `bank` is his own motions (`parseBank`), `nodes` his model's.
 */
export function chestDrawer({ mesh, atlas, skeleton, tables, nodes, bank }) {
  const standing = posed(mesh, skeleton, tables, restChannels(nodes, tables));
  let top = Infinity;
  for (let i = 0; i < standing.mesh.vertexCount; i += 1) top = Math.min(top, standing.P[i * 3 + 1]);
  const head = standing.base[NECK].t[1] - top;
  const motion = readMotion(bank.bytes, bank.offsets[CHEST_MOTION]);
  const rest = nodes.map((n) => restRotation(n.rotation));
  const fixup = Array.from(tables.fixup, (v) => v / 4096);
  const channels = convertFrame(motion.frame(Math.floor(motion.frames / 2)), fixup, Array.from(tables.offsets), rest, bonesOf(nodes)).map(Math.round);
  const neckAt = posed(mesh, skeleton, tables, channels).base[NECK].t;
  return ({ width, height, crown, neck }) => {
    const perPixel = head / (neck[1] - crown);
    /* The camera faces him (along +Z, X to the right, Y down), his neck's base at `neck`. */
    const target = [neckAt[0] - (neck[0] - width / 2) * perPixel, neckAt[1] - (neck[1] - height / 2) * perPixel, neckAt[2]];
    return renderKazuya({
      mesh,
      atlas,
      skeleton,
      tables,
      channels,
      eye: [target[0], target[1], target[2] - DISTANCE],
      target,
      fov: (2 * Math.atan(((height / 2) * perPixel) / DISTANCE) * 180) / Math.PI,
      width,
      height,
      above: neckAt[1] - HEAD_CUT,
      lights: [
        { direction: [-0.55, -0.75, -0.55], colour: [1.25, 1.12, 1.0] },
        { direction: [0.9, -0.1, -0.3], colour: [0.22, 0.26, 0.38] },
      ],
      ambient: [0.12, 0.12, 0.14],
      rim: { direction: [0.4, -0.6, 1], colour: [0.6, 0.55, 0.65] },
    });
  };
}
