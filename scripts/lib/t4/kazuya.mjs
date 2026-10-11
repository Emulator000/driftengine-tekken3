/**
 * Kazuya, carried from Tekken 4 into the port as a Tekken 3 fighter: his skeleton in Tekken 3's
 * shape, his mesh skinned to it in the player's `FTR` format, and his textures in one atlas.
 *
 * His Tekken 3 skeleton keeps Tekken 3's eighteen joints with his own bone lengths (`retarget.mjs`
 * says which nodes each joint stands for). His bind pose is his rest pose run through the motion
 * conversion and Tekken 3's own pose code, so the mesh hangs on the frames the game will move.
 * Tekken 4's helper bones (nodes 29 to 54: muscles, twists, half bends), neck and head are joints of
 * their own past Tekken 3's, posed from its joints by Tekken 4's rules and the neck's share of the
 * head's turn (`src/mod/kazuya/tekken4.ts`); every other node folds into its nearest ancestor's joint.
 * A vertex keeps its four strongest.
 */
import { HelperRig, JOINT_OF_NODE, RIG_NODES, rigJoint } from '../../../src/mod/kazuya/tekken4.ts';
import { poseRotations } from '../../../src/motion/motion.ts';
import { decodeTexture } from './chrtk4.mjs';
import { apply, convertPose, mul, restRotation, transpose } from './retarget.mjs';

const FLIP = [1, 0, 0, 0, -1, 0, 0, 0, -1];
/** How far a drawing laid over another stands off it, in Tekken 3's units (millimetres, near enough). */
const LIFT = 2;
/** A model's size in hundredths: as made. */
const FULL_SIZE = 100;

/** Tekken 3's joints: the node each stands at, and its parent. */
const JOINTS = [
  { parent: -1, nodes: [0] },
  { parent: 0, nodes: [1] },
  { parent: 1, nodes: [2, 3] },
  { parent: 1, nodes: [2, 5] },
  { parent: 3, nodes: [6] },
  { parent: 4, nodes: [7] },
  { parent: 5, nodes: [8] },
  { parent: 1, nodes: [2, 9] },
  { parent: 7, nodes: [10] },
  { parent: 8, nodes: [11] },
  { parent: 9, nodes: [12] },
  { parent: 0, nodes: [13] },
  { parent: 11, nodes: [14] },
  { parent: 12, nodes: [15] },
  { parent: 13, nodes: [16] },
  { parent: 11, nodes: [18] },
  { parent: 15, nodes: [19] },
  { parent: 16, nodes: [20] },
];
/**
 * His hands as fists: Tekken 4 poses its finger joints by hand shape, which Tekken 3's hands do not
 * have, so the mesh is bound with each finger's three segments curled toward the palm, the thumb
 * across it. Pairs of a finger's first node and the turns (radians, about its Z) of its segments.
 */
const FIST = [
  [55, [0.3, 0.5, 0.5]], [58, [1.5, 1.6, 1.2]], [61, [1.5, 1.6, 1.2]], [64, [1.5, 1.6, 1.2]], [67, [1.5, 1.6, 1.2]],
  [70, [0.3, 0.5, 0.5]], [73, [1.5, 1.6, 1.2]], [76, [1.5, 1.6, 1.2]], [79, [1.5, 1.6, 1.2]], [82, [1.5, 1.6, 1.2]],
];
/** The belt's two hanging chains: their first nodes, which the bind pose turns to hang down. */
const BELT = [111, 114];

/** A rotation about Z, for column vectors. */
const turnZ = (a) => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];

/** The rotation turning unit vector `a` onto unit vector `b` by the shortest way. */
function turnOnto(a, b) {
  const axis = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const s = Math.hypot(axis[0], axis[1], axis[2]);
  const c = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (s < 1e-9) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const [x, y, z] = axis.map((v) => v / s);
  const t = 1 - c;
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c];
}

/**
 * His vertices and normals as the model holds them, but posed for binding: the fists closed, and
 * the belt's tails hanging straight down, as Tekken 4's cloth leaves them and Tekken 3's rigid hips
 * keep them. Skinned on Tekken 4's own skeleton from its rest pose, every other node still.
 */
export function bindPose(model) {
  const rest = model.nodes.map((n) => restRotation(n.rotation));
  const posed = rest.slice();
  /* The right hand's finger frames mirror the left's, so its fingers curl the other way about Z. */
  for (const [first, turns] of FIST) {
    const side = first < 70 ? 1 : -1;
    turns.forEach((angle, k) => (posed[first + k] = mul(rest[first + k], turnZ(side * angle))));
  }
  const world = (locals) => {
    const frames = [];
    model.nodes.forEach((node, i) => {
      if (node.parent < 0) frames[i] = { r: locals[i], t: [0, 0, 0] };
      else {
        const p = frames[node.parent];
        const o = apply(p.r, node.offset);
        frames[i] = { r: mul(p.r, locals[i]), t: [p.t[0] + o[0], p.t[1] + o[1], p.t[2] + o[2]] };
      }
    });
    return frames;
  };
  /* Each belt chain's first node turned so its bone points down, the rest of the chain following. */
  const resting = world(rest);
  for (const first of BELT) {
    const parent = resting[model.nodes[first].parent];
    const along = [resting[first].r[0], resting[first].r[3], resting[first].r[6]];
    posed[first] = mul(transpose(parent.r), mul(turnOnto(along, [0, -1, 0]), resting[first].r));
  }
  const to = world(posed);
  /* Each node's move: back into its rest frame, out of its posed one. */
  const place = (i, v) => {
    const f = resting[i];
    const local = apply(transpose(f.r), [v[0] - f.t[0], v[1] - f.t[1], v[2] - f.t[2]]);
    const out = apply(to[i].r, local);
    return [out[0] + to[i].t[0], out[1] + to[i].t[1], out[2] + to[i].t[2]];
  };
  const turn = resting.map((f, i) => mul(to[i].r, transpose(f.r)));
  return model.lists.map((list) =>
    list.meshes.map((mesh) =>
      mesh.vertices.map((vertex) => {
        const position = [0, 0, 0];
        const normal = [0, 0, 0];
        for (const { node, weight } of vertex.influences) {
          const p = place(node, vertex.position);
          const n = apply(turn[node], vertex.normal);
          for (let k = 0; k < 3; k += 1) {
            position[k] += p[k] * weight;
            normal[k] += n[k] * weight;
          }
        }
        return { position, normal };
      }),
    ),
  );
}

/**
 * Each node's joint: its own where the rig poses it, a main node's Tekken 3 joint, else its nearest
 * ancestor's (the face's nodes go with the head, the trousers' cloth with the thigh's swing helpers).
 */
export function jointsOfNodes(nodes) {
  return nodes.map((node, i) => {
    for (let n = i; n >= 0; n = nodes[n].parent) {
      if (RIG_NODES.includes(n)) return rigJoint(n);
      if (JOINT_OF_NODE.has(n)) return JOINT_OF_NODE.get(n);
    }
    return 0;
  });
}

/** The joints' offsets from their parents, in Tekken 3's axes (mm), from his node offsets. */
export function skeletonOf(nodes) {
  return JOINTS.map(({ parent, nodes: chain }, joint) => {
    const offset = [0, 0, 0];
    for (const n of chain) for (let k = 0; k < 3; k += 1) offset[k] += nodes[n].offset[k];
    return { joint, parent, offset: offset.map(Math.round) };
  });
}

/** His arm and leg lengths, for the conversion. */
export const bonesOf = (nodes) => ({ arm: [nodes[7].offset[0], nodes[8].offset[0]], leg: [nodes[15].offset[0], nodes[16].offset[0]] });

/** The joints' world frames for a pose's 49 channels: Tekken 3's pose code over his offsets. */
export function framesOf(channels, skeleton, tables) {
  const rotations = poseRotations(Int16Array.from(channels), tables);
  const frames = [];
  for (const { joint, parent, offset } of skeleton) {
    const r = Array.from(rotations[joint]);
    if (parent < 0) frames[joint] = { r, t: [channels[0], channels[1], channels[2]] };
    else {
      const p = frames[parent];
      const o = apply(p.r, offset);
      frames[joint] = { r: mul(p.r, r), t: [p.t[0] + o[0], p.t[1] + o[1], p.t[2] + o[2]] };
    }
  }
  return frames;
}

/** His rest pose as Tekken 3 channels, rounded as the game stores them. */
export function restChannels(nodes, tables) {
  const rest = nodes.map((n) => restRotation(n.rotation));
  const fixup = Array.from(tables.fixup, (v) => v / 4096);
  return convertPose(rest, [0, 0, 0], fixup, Array.from(tables.offsets), bonesOf(nodes)).map(Math.round);
}

/** A strip's texture: its page, palette and clamp region. */
const regionKey = (strip) => {
  const c = strip.clamp;
  return `${strip.tex0.tbp}/${strip.tex0.cbp}/${c ? [c.wms, c.wmt, c.minu, c.maxu, c.minv, c.maxv].join(',') : ''}`;
};

/** Packs rectangles into rows of a power-of-two square, each kept a texel clear of the next. */
function packRows(sizes) {
  const order = sizes.map((s, i) => i).sort((a, b) => sizes[b].height - sizes[a].height);
  for (let side = 256; side <= 4096; side *= 2) {
    const places = [];
    let x = 0;
    let y = 0;
    let row = 0;
    let fits = true;
    for (const i of order) {
      const w = sizes[i].width + 2;
      const h = sizes[i].height + 2;
      if (x + w > side) {
        x = 0;
        y += row;
        row = 0;
      }
      if (y + h > side) {
        fits = false;
        break;
      }
      places[i] = { x: x + 1, y: y + 1 };
      x += w;
      row = Math.max(row, h);
    }
    if (fits) return { side, places };
  }
  throw new Error('the textures do not fit a 4096 atlas');
}

/**
 * The mesh (`FTR` version 4: four influences a vertex, and his nodes), the atlas and the skeleton
 * from his model (`parseChrtk4`), its textures (`parseUploads`) and Tekken 3's motion tables.
 */
export function exportKazuya(model, uploads, tables, encodePng) {
  const skeleton = skeletonOf(model.nodes);
  const posed = bindPose(model);
  const bind = new HelperRig(model.nodes).extend(framesOf(restChannels(model.nodes, tables), skeleton, tables));
  const jointOf = jointsOfNodes(model.nodes);

  /* The textures the strips draw, packed. */
  const textures = new Map();
  for (const list of model.lists) {
    for (const mesh of list.meshes) {
      for (const strip of mesh.strips) {
        const key = regionKey(strip);
        if (!textures.has(key)) textures.set(key, decodeTexture(uploads, strip.tex0, strip.clamp));
      }
    }
  }
  const keys = [...textures.keys()];
  const { side, places } = packRows(keys.map((k) => textures.get(k)));
  const atlas = new Uint8Array(side * side * 4);
  keys.forEach((key, i) => {
    const t = textures.get(key);
    const { x, y } = places[i];
    /* Each region's edge texels are repeated a texel outward, so filtering at its border stays in it. */
    for (let ty = -1; ty <= t.height; ty += 1) {
      for (let tx = -1; tx <= t.width; tx += 1) {
        const sx = Math.min(t.width - 1, Math.max(0, tx));
        const sy = Math.min(t.height - 1, Math.max(0, ty));
        const from = (sy * t.width + sx) * 4;
        atlas.set(t.rgba.subarray(from, from + 4), ((y + ty) * side + x + tx) * 4);
      }
    }
  });
  const placeOf = new Map(keys.map((k, i) => [k, places[i]]));

  /* Whether a region covers whatever it is drawn over: no texel of it anything but opaque. */
  const opaque = new Map(keys.map((key) => [key, textures.get(key).rgba.every((x, i) => i % 4 !== 3 || x === 255)]));

  /* Vertices: up to four joints each, joint-space points; merged where everything matches. */
  const vertices = [];
  const lookup = new Map();
  const indices = [];
  let dropped = 0;
  const toJoint = (joint, v) => apply(transpose(bind[joint].r), v);
  const local = (joint, v) => {
    const f = bind[joint];
    return toJoint(joint, [v[0] - f.t[0], v[1] - f.t[1], v[2] - f.t[2]]).map((x) => Math.round(x));
  };
  for (const [l, list] of model.lists.entries()) {
    for (const [m, mesh] of list.meshes.entries()) {
      const prepared = mesh.vertices.map((vertex, v) => {
        const weights = new Map();
        for (const { node, weight } of vertex.influences) weights.set(jointOf[node], (weights.get(jointOf[node]) ?? 0) + weight);
        const ranked = [...weights].sort((a, b) => b[1] - a[1]);
        if (ranked.length > 4) dropped += 1;
        const kept = ranked.slice(0, 4);
        const total = kept.reduce((sum, [, w]) => sum + w, 0);
        /* Weights in 255ths that add up to 255, the remainder on the strongest. */
        const shares = kept.map(([, w]) => Math.round((w / total) * 255));
        shares[0] += 255 - shares.reduce((a, b) => a + b, 0);
        const position = apply(FLIP, posed[l][m][v].position);
        const normal = apply(FLIP, posed[l][m][v].normal);
        return {
          /* Its points in each joint's space, `layer` lifts off the surface along its normal. */
          influences: (layer) =>
            kept.map(([joint], k) => {
              const lift = toJoint(joint, normal).map((x) => Math.round(x * LIFT * layer));
              return [joint, shares[k], ...local(joint, position).map((x, a) => x + lift[a])];
            }),
          normalJoint: kept[0][0],
          n: toJoint(kept[0][0], normal).map((x) => Math.round(x * 4096)),
        };
      });
      /*
       * A mesh can draw a triangle again with another texture: the trousers' flames over their cloth,
       * the hair's edge over the back of his head. The GS draws the later one over the earlier at the
       * same depth (its test is greater-or-equal). An earlier drawing a later opaque one covers is
       * dropped; a later one is lifted off the surface by its layer, so no depth test decides.
       */
      const cornersOf = (strip, i) => [strip.items[i - 2].vertex, strip.items[i - 1].vertex, strip.items[i].vertex].sort((a, b) => a - b).join();
      const drawings = new Map();
      mesh.strips.forEach((strip, s) => {
        for (let i = 2; i < strip.items.length; i += 1) {
          const corners = cornersOf(strip, i);
          if (!drawings.has(corners)) drawings.set(corners, []);
          drawings.get(corners).push({ s, i, key: regionKey(strip) });
        }
      });
      for (const [s, strip] of mesh.strips.entries()) {
        const key = regionKey(strip);
        const place = placeOf.get(key);
        const region = textures.get(key);
        /* The GS clamps to the region, so the coordinate does too, measured from its corner. */
        const within = (value, from, size) => Math.min(size, Math.max(0, value - from));
        const idOf = (item, layer) => {
          const v = prepared[item.vertex];
          const u = Math.round((place.x + within(item.s * strip.tex0.tw, region.x, region.width)) * 8);
          const w = Math.round((place.y + within(item.t * strip.tex0.th, region.y, region.height)) * 8);
          const fields = { influences: v.influences(layer), normalJoint: v.normalJoint, n: v.n, u, w };
          const k = JSON.stringify(fields);
          let index = lookup.get(k);
          if (index === undefined) {
            index = vertices.length;
            lookup.set(k, index);
            vertices.push(fields);
          }
          return index;
        };
        /* A GS strip: every vertex after the second makes a triangle with the two before it. */
        for (let i = 2; i < strip.items.length; i += 1) {
          const all = drawings.get(cornersOf(strip, i));
          const at = all.findIndex((d) => d.s === s && d.i === i);
          if (all.slice(at + 1).some((d) => opaque.get(d.key))) continue;
          const layer = all.slice(0, at).filter((d, k) => !all.slice(k + 1).some((e) => opaque.get(e.key))).length;
          indices.push(idOf(strip.items[i - 2], layer), idOf(strip.items[i - 1], layer), idOf(strip.items[i], layer));
        }
      }
    }
  }
  if (vertices.length > 0xffff) throw new Error(`${vertices.length} vertices do not fit u16 indices`);

  /* Version 4: version 3, then his nodes (a count, and a parent, offset and rest rotation each) for the rig. */
  const mesh = new Uint8Array(24 + vertices.length * 48 + indices.length * 2 + 4 + model.nodes.length * 28);
  const view = new DataView(mesh.buffer);
  view.setUint32(0, 0x31525446, true);
  view.setUint32(4, 4, true);
  view.setUint32(8, vertices.length, true);
  view.setUint32(12, indices.length, true);
  view.setUint16(16, side, true);
  view.setUint16(18, side, true);
  let at = 24;
  for (const f of vertices) {
    view.setUint8(at, f.influences.length);
    view.setUint8(at + 1, f.normalJoint);
    f.influences.forEach(([joint, weight, x, y, z], k) => {
      const slot = at + 4 + k * 8;
      view.setUint8(slot, joint);
      view.setUint8(slot + 1, weight);
      view.setInt16(slot + 2, x, true);
      view.setInt16(slot + 4, y, true);
      view.setInt16(slot + 6, z, true);
    });
    for (let k = 0; k < 3; k += 1) view.setInt16(at + 36 + k * 2, f.n[k], true);
    view.setUint16(at + 42, f.u, true);
    view.setUint16(at + 44, f.w, true);
    at += 48;
  }
  for (const i of indices) {
    view.setUint16(at, i, true);
    at += 2;
  }
  view.setUint32(at, model.nodes.length, true);
  at += 4;
  for (const { parent, offset, rotation } of model.nodes) {
    view.setInt32(at, parent, true);
    offset.forEach((x, k) => view.setFloat32(at + 4 + k * 4, x, true));
    rotation.forEach((x, k) => view.setFloat32(at + 16 + k * 4, x, true));
    at += 28;
  }
  return {
    mesh,
    atlas: encodePng(side, side, atlas),
    atlasPixels: { width: side, height: side, rgba: atlas },
    skeleton: skeleton.map(({ joint, parent, offset }) => ({ joint, parent, offset })),
    stats: { vertices: vertices.length, triangles: indices.length / 3, atlas: side, textures: keys.length, fiveJointVertices: dropped },
  };
}

/**
 * A Tekken 3 model file (`3DMK`) carrying his joint offsets: the game hangs its skeleton on each
 * part's record (words 5 to 7, the offset from its parent, z negated) and reads nothing else of it
 * that the player draws, but its size (the header's second word, in hundredths), by which it scales
 * the root's place and not the body hung under it. His motions are Tekken 4's, made at his full
 * size, so his is 100: at Heihachi's 98 his root sat 2% lower over legs of his full length, his
 * feet that far through the floor. `parts` is the executable's part table for the model's pack.
 */
export function withOffsets(model3dmk, parts, skeleton) {
  const out = Uint8Array.from(model3dmk);
  const view = new DataView(out.buffer);
  view.setUint32(4, FULL_SIZE, true);
  for (const part of parts) {
    if (part.joint >= skeleton.length) continue;
    const [x, y, z] = skeleton[part.joint].offset;
    const at = 16 + part.record * 56 + 20;
    view.setInt32(at, x, true);
    view.setInt32(at + 4, y, true);
    view.setInt32(at + 8, -z, true);
  }
  return out;
}
