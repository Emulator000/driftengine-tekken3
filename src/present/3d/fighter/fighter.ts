/**
 * A fighter on screen: the extracted mesh (`FTR`, scripts/lib/fighter.mjs and, for Kazuya,
 * scripts/lib/t4/kazuya.mjs), posed on the device every frame from the skeleton's world transforms
 * (the engine's point skin).
 *
 * Each vertex is up to four joint-space points with their weights: one, or a seam of two weighted
 * half and half, as the game's renderer averages them; Kazuya's smooth skin takes up to four. Its
 * normal turns on a joint of its own, which the skin takes as the vertex's first (weighing nothing
 * where it is none of the vertex's points). Game axes are millimetres with Y down; the player's are
 * metres with Y up and Z toward the viewer, a half turn about X, made part of each joint's
 * transform.
 *
 * Versions: 1 holds two influences and whole texels; 2 the same with texture coordinates in eighths
 * of a texel; 3 up to four influences, 48 bytes a vertex (a count, the normal's joint, two spare
 * bytes, four of a joint, a weight in 255ths and a point, then the normal and the coordinates); 4
 * the same followed by a Tekken 4 model's nodes (a count, then a parent, an offset and a rest
 * rotation each), for the joints past Tekken 3's its vertices hang on (`tekken4.ts`); 5 as 4, each
 * weight a part of the vertex's weights' sum, then the hands' shapes and the face's pictures
 * (`scripts/lib/ftr.mjs`).
 *
 * A hand's shapes: per part, the shape each of its steps draws, and the points and normals of the
 * vertices the shapes move, copied in when the drawn shape changes. A face's pictures (its eyes
 * open and closed): each picture's triangles on vertices of their own, those of every picture but
 * the one on the face weighing nothing, so drawn collapsed to a point. Either change makes the skin
 * again, a few times a second where a pose is sixty.
 *
 * A garment (version 5: the joint its header names, posed as the hips) and the tails hung from the
 * hips on joints of their own are kept off the thighs (`garment.ts`): each of their points is
 * placed on the CPU and handed over as a joint of its own.
 */
import { createMover, type MeshHandle, type Mover, type PointSkinData, type PointSkinHandle, type RendererApi, type SurfaceMaterial, type SurfaceTextureHandle } from '@driftengine/core';
import type { Rotation } from '../../../motion/motion.ts';
import { HelperRig, type Frame, type RigNode } from '../../../mod/kazuya/tekken4.ts';
import { hingesOf, HIPS, keepClothOff, LEGS, newLimb, placeLimb, profileOf, unturn, type LimbNow } from './garment.ts';

const FTR_MAGIC = 0x31525446;
/** The most joints a vertex hangs on. */
const INFLUENCES = 4;
/** A step whose shape keeps the shape drawn. */
const KEEP_SHAPE = 255;

/** A hand's other shapes, for the part its steps are drawn on. */
export interface ShapeGroup {
  readonly part: number;
  /** Per step, the shape it draws (`KEEP_SHAPE` keeps the one drawn). */
  readonly steps: Uint8Array;
  /** The vertices the shapes move. */
  readonly vertices: Uint16Array;
  /** Per shape, each vertex's four points (as `FighterMesh.points` lays a vertex's) and its normal. */
  readonly points: readonly Int16Array[];
  readonly normals: readonly Int16Array[];
}

export interface FighterMesh {
  readonly vertexCount: number;
  /** Per vertex, how many of its four influence slots it uses. */
  readonly influenceCount: Uint8Array;
  /** Per vertex, four joints, four weights (summing to one) and four joint-space points. */
  readonly joints: Uint8Array;
  readonly weights: Float32Array;
  readonly points: Int16Array;
  readonly normalJoint: Uint8Array;
  readonly normal: Int16Array;
  readonly uv: Float32Array;
  readonly indices: Uint32Array;
  /** The joints past Tekken 3's, for a Tekken 4 model (version 4). */
  readonly rig: HelperRig | null;
  /** The hands' other shapes (version 5). */
  readonly shapes: readonly ShapeGroup[];
  /** Per vertex, the picture it is drawn with (1 the first, the face as loaded), or 0 for always. */
  readonly pictureOf: Uint8Array;
  /** How many pictures the face has (none, or the face as loaded and the others). */
  readonly pictures: number;
  /** The joint its garment hangs on, posed as the hips and kept off the thighs; 0 where it has none (version 5). */
  readonly garment: number;
}

export function readFighterMesh(buffer: ArrayBuffer): FighterMesh {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== FTR_MAGIC) throw new Error('not a fighter mesh');
  const version = view.getUint32(4, true);
  const n = view.getUint32(8, true);
  const indexCount = view.getUint32(12, true);
  /* From version 2, texture coordinates are in eighths of a texel. */
  const subtexel = version >= 2 ? 8 : 1;
  const width = view.getUint16(16, true) * subtexel;
  const height = view.getUint16(18, true) * subtexel;
  const mesh = {
    vertexCount: n,
    influenceCount: new Uint8Array(n),
    joints: new Uint8Array(n * INFLUENCES),
    weights: new Float32Array(n * INFLUENCES),
    points: new Int16Array(n * INFLUENCES * 3),
    normalJoint: new Uint8Array(n),
    normal: new Int16Array(n * 3),
    uv: new Float32Array(n * 2),
    indices: new Uint32Array(indexCount),
    rig: null as HelperRig | null,
    shapes: [] as ShapeGroup[],
    pictureOf: new Uint8Array(n),
    pictures: 0,
    garment: version >= 5 ? view.getUint32(20, true) : 0,
  };
  const stride = version >= 3 ? 48 : 28;
  let at = 24;
  for (let i = 0; i < n; i += 1) {
    if (version >= 3) {
      const count = view.getUint8(at);
      mesh.influenceCount[i] = count;
      mesh.normalJoint[i] = view.getUint8(at + 1);
      /* From version 5, each weight is a part of their sum (a seam's halves exact); before, 255ths. */
      let total = 255;
      if (version >= 5) {
        total = 0;
        for (let k = 0; k < count; k += 1) total += view.getUint8(at + 5 + k * 8);
      }
      for (let k = 0; k < count; k += 1) {
        const slot = at + 4 + k * 8;
        mesh.joints[i * INFLUENCES + k] = view.getUint8(slot);
        mesh.weights[i * INFLUENCES + k] = view.getUint8(slot + 1) / total;
        for (let c = 0; c < 3; c += 1) mesh.points[(i * INFLUENCES + k) * 3 + c] = view.getInt16(slot + 2 + c * 2, true);
      }
      for (let c = 0; c < 3; c += 1) mesh.normal[i * 3 + c] = view.getInt16(at + 36 + c * 2, true);
      mesh.uv[i * 2] = view.getUint16(at + 42, true) / width;
      mesh.uv[i * 2 + 1] = view.getUint16(at + 44, true) / height;
    } else {
      const weightB = view.getUint8(at + 2) / 256;
      mesh.influenceCount[i] = weightB > 0 ? 2 : 1;
      mesh.joints[i * INFLUENCES] = view.getUint8(at);
      mesh.joints[i * INFLUENCES + 1] = view.getUint8(at + 1);
      mesh.weights[i * INFLUENCES] = 1 - weightB;
      mesh.weights[i * INFLUENCES + 1] = weightB;
      mesh.normalJoint[i] = view.getUint8(at + 3);
      for (let c = 0; c < 3; c += 1) {
        mesh.points[i * INFLUENCES * 3 + c] = view.getInt16(at + 4 + c * 2, true);
        mesh.points[(i * INFLUENCES + 1) * 3 + c] = view.getInt16(at + 10 + c * 2, true);
        mesh.normal[i * 3 + c] = view.getInt16(at + 16 + c * 2, true);
      }
      /* Texel corners, as the PlayStation samples them, over the atlas's size. */
      mesh.uv[i * 2] = view.getUint16(at + 22, true) / width;
      mesh.uv[i * 2 + 1] = view.getUint16(at + 24, true) / height;
    }
    at += stride;
  }
  for (let i = 0; i < indexCount; i += 1) mesh.indices[i] = view.getUint16(at + i * 2, true);
  at += indexCount * 2;
  if (version >= 4) {
    const nodes: RigNode[] = [];
    const count = view.getUint32(at, true);
    for (let i = 0; i < count; i += 1) {
      const node = at + 4 + i * 28;
      const floats = (from: number): number[] => [0, 1, 2].map((k) => view.getFloat32(node + from + k * 4, true));
      nodes.push({ parent: view.getInt32(node, true), offset: floats(4), rotation: floats(16) });
    }
    if (version === 4 || count > 0) mesh.rig = new HelperRig(nodes);
    at += 4 + count * 28;
  }
  if (version >= 5) readShapesAndPictures(view, at, mesh);
  return mesh;
}

/** Version 5's hand shapes and face pictures, from `at` (after the rig). */
function readShapesAndPictures(view: DataView, start: number, mesh: FighterMesh & { shapes: ShapeGroup[]; pictures: number }): void {
  let at = start;
  const groups = view.getUint32(at, true);
  at += 4;
  for (let g = 0; g < groups; g += 1) {
    const part = view.getUint8(at);
    const shapeCount = view.getUint8(at + 1);
    const stepCount = view.getUint8(at + 2);
    at += 4;
    const steps = new Uint8Array(view.buffer.slice(view.byteOffset + at, view.byteOffset + at + stepCount));
    at += stepCount;
    const count = view.getUint32(at, true);
    at += 4;
    const vertices = new Uint16Array(count);
    for (let k = 0; k < count; k += 1) vertices[k] = view.getUint16(at + k * 2, true);
    at += count * 2;
    const points: Int16Array[] = [];
    const normals: Int16Array[] = [];
    for (let s = 0; s < shapeCount; s += 1) {
      const shapePoints = new Int16Array(count * INFLUENCES * 3);
      const shapeNormals = new Int16Array(count * 3);
      for (let k = 0; k < count; k += 1) {
        const used = mesh.influenceCount[vertices[k]!] ?? 0;
        for (let f = 0; f < used * 3; f += 1) {
          shapePoints[k * INFLUENCES * 3 + f] = view.getInt16(at, true);
          at += 2;
        }
        for (let c = 0; c < 3; c += 1) {
          shapeNormals[k * 3 + c] = view.getInt16(at, true);
          at += 2;
        }
      }
      points.push(shapePoints);
      normals.push(shapeNormals);
    }
    mesh.shapes.push({ part, steps, vertices, points, normals });
  }
  const pictures = view.getUint32(at, true);
  mesh.pictures = pictures;
  at += 4;
  for (let p = 0; p < pictures; p += 1) {
    const count = view.getUint32(at, true);
    at += 4;
    for (let k = 0; k < count; k += 1) {
      const t = view.getUint32(at + k * 4, true);
      for (let c = 0; c < 3; c += 1) mesh.pictureOf[mesh.indices[t * 3 + c]!] = p + 1;
    }
    at += count * 4;
  }
}

/** A joint's world transform in game axes: rotation and translation in millimetres. */
export interface JointTransform {
  readonly r: Rotation;
  readonly t: Float64Array;
}

/** A joint the skeleton lacks: its points as they are. */
const STILL: Frame = { r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };

export class Fighter {
  readonly handle: MeshHandle;
  readonly material: SurfaceMaterial<SurfaceTextureHandle>;
  /** Which object its draws are, frame to frame, for a reconstructing renderer. */
  readonly mover: Mover = createMover();
  /** Light added over its own colours, linear: the hit flash (`light`). */
  private readonly glow: [number, number, number] = [0, 0, 0];
  private readonly renderer: RendererApi;
  private readonly mesh: FighterMesh;
  private readonly texture: SurfaceTextureHandle;
  /** Per shape group, the shape drawn. */
  private readonly drawn: number[];
  /** The picture on its face (0 the face as loaded). */
  private picture = 0;
  /** The vertices of the face's pictures. */
  private readonly onPictures: Uint32Array;
  /** The skin as the device was last given it, and whether a hand or the face changed it since. */
  private readonly data: PointSkinData;
  private skin: PointSkinHandle;
  private stale = false;
  /** Each joint a vertex names, as its transform into the player's axes: sixteen floats, column-major; then the kept points'. */
  private readonly matrices: Float32Array;
  /** How many joints the vertices name. */
  private readonly slots: number;
  /** The points kept off the thighs, where it has any. */
  private readonly worn: Worn | null;

  /**
   * It owns `mesh`: a hand's shape is copied into its points and normals. `tails` are the joints
   * hung from the hips whose points are kept clear of the legs, as the garment's are; null keeps
   * none clear, the garment's posed as the hips.
   */
  constructor(
    renderer: RendererApi,
    mesh: FighterMesh,
    texture: SurfaceTextureHandle,
    white: SurfaceTextureHandle | null = null,
    tails: readonly number[] | null = [],
    /** A highlight on the skin and cloth, and the atlas's maps where it has them. */
    look: { readonly normal: SurfaceTextureHandle | null; readonly orm: SurfaceTextureHandle | null } | null = null,
  ) {
    this.renderer = renderer;
    this.mesh = mesh;
    this.texture = texture;
    this.drawn = mesh.shapes.map(() => 0);
    const n = mesh.vertexCount;
    let slots = 0;
    for (const j of mesh.joints) slots = Math.max(slots, j + 1);
    for (const j of mesh.normalJoint) slots = Math.max(slots, j + 1);
    this.slots = slots;
    this.worn = tails === null ? null : wornOf(mesh, slots, tails);
    this.matrices = new Float32Array((slots + (this.worn?.hangs.length ?? 0)) * 16);
    this.onPictures = Uint32Array.from(Array.from(mesh.pictureOf.keys()).filter((i) => mesh.pictureOf[i] !== 0));
    const normals = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) normals[i * 3 + 1] = 1;
    this.handle = renderer.createMesh(
      {
        positions: new Float32Array(n * 3),
        normals,
        colors: new Float32Array(n * 3).fill(1),
        emissive: new Float32Array(n).fill(1),
        specular: new Float32Array(n).fill(look === null ? 0 : 0.12),
        roughness: new Float32Array(n).fill(look === null ? 1 : 0.7),
        uvs: mesh.uv,
        indices: mesh.indices,
      },
      { dynamic: true },
    );
    this.data = { joints: new Float32Array(n * INFLUENCES), weights: new Float32Array(n * INFLUENCES), points: new Float32Array(n * INFLUENCES * 3), normals: new Float32Array(n * 3) };
    for (let i = 0; i < n; i += 1) this.skinVertex(i);
    this.skin = renderer.createPointSkin(this.handle, this.data);
    /* Emission through a white map, so its scale is the glow's colour over the fighter's own. */
    this.material = {
      albedo: texture,
      cutout: 0.5,
      doubleSided: true,
      ...(white === null ? {} : { emissive: white, emissiveScale: this.glow }),
      ...(look?.normal == null ? {} : { normal: look.normal, normalStrength: 0.8 }),
      ...(look?.orm == null ? {} : { orm: look.orm }),
    };
  }

  /** The light a blow throws on it this frame, added over its colours (linear; 0 is none). */
  light(r: number, g: number, b: number): void {
    this.glow[0] = r;
    this.glow[1] = g;
    this.glow[2] = b;
  }

  /** Its skin, mesh and texture let go, once the match no longer has it. */
  dispose(): void {
    this.renderer.disposePointSkin(this.skin);
    this.renderer.disposeMesh(this.handle);
    this.renderer.disposeSurfaceTexture(this.texture);
  }

  /**
   * The hand on `part` drawn at the game's `step` for it (one of four from open to a fist, or
   * another shape): where the shape changes, its vertices' points and normals copied in.
   */
  shape(part: number, step: number): void {
    const m = this.mesh;
    for (let g = 0; g < m.shapes.length; g += 1) {
      const group = m.shapes[g]!;
      if (group.part !== part) continue;
      const shape = step >= 0 && step < group.steps.length ? group.steps[step]! : KEEP_SHAPE;
      if (shape === KEEP_SHAPE || shape === this.drawn[g]) continue;
      this.drawn[g] = shape;
      const points = group.points[shape]!;
      const normals = group.normals[shape]!;
      for (let k = 0; k < group.vertices.length; k += 1) {
        const v = group.vertices[k]!;
        for (let c = 0; c < INFLUENCES * 3; c += 1) m.points[v * INFLUENCES * 3 + c] = points[k * INFLUENCES * 3 + c]!;
        for (let c = 0; c < 3; c += 1) m.normal[v * 3 + c] = normals[k * 3 + c]!;
        this.skinVertex(v);
      }
      this.stale = true;
    }
  }

  /** The picture on its face: 0 the face as loaded (the eyes open), 1 the next (the eyes closed). */
  face(picture: number): void {
    const shown = picture < this.mesh.pictures ? picture : 0;
    if (shown === this.picture) return;
    this.picture = shown;
    for (const v of this.onPictures) this.skinVertex(v);
    this.stale = true;
  }

  /**
   * Poses every vertex for the joints' world transforms, on the device; a joint the skeleton lacks
   * leaves its points as they are. A hand or a face changed since the last pose makes the skin again.
   */
  pose(skeleton: readonly (JointTransform | undefined)[]): void {
    const m = this.mesh;
    const joints: readonly (Frame | undefined)[] = m.rig === null ? skeleton : m.rig.extend(skeleton);
    const f = this.matrices;
    for (let j = 0, o = 0; j < this.slots; j += 1, o += 16) {
      const { r, t } = joints[m.garment !== 0 && j === m.garment ? HIPS : j] ?? STILL;
      /* Game axes to the player's: millimetres to metres, and a half turn about X. */
      f[o] = r[0]! / 1000;
      f[o + 1] = -r[3]! / 1000;
      f[o + 2] = -r[6]! / 1000;
      f[o + 3] = 0;
      f[o + 4] = r[1]! / 1000;
      f[o + 5] = -r[4]! / 1000;
      f[o + 6] = -r[7]! / 1000;
      f[o + 7] = 0;
      f[o + 8] = r[2]! / 1000;
      f[o + 9] = -r[5]! / 1000;
      f[o + 10] = -r[8]! / 1000;
      f[o + 11] = 0;
      f[o + 12] = t[0]! / 1000;
      f[o + 13] = -t[1]! / 1000;
      f[o + 14] = -t[2]! / 1000;
      f[o + 15] = 1;
    }
    if (this.worn !== null) this.wear(this.worn, joints);
    if (this.stale) {
      this.stale = false;
      this.renderer.disposePointSkin(this.skin);
      this.skin = this.renderer.createPointSkin(this.handle, this.data);
    }
    this.renderer.posePointSkin(this.skin, f);
  }

  /**
   * The cloth kept off the legs: each point placed as its joints hold it, kept off the legs
   * (`keepClothOff`), and its joint placed there, turned as the joint its normal turns on.
   */
  private wear(worn: Worn, joints: readonly (Frame | undefined)[]): void {
    const f = this.matrices;
    const garment = this.mesh.garment;
    const hips = joints[HIPS] ?? STILL;
    const { r, t } = hips;
    const limbs = worn.limbs;
    LEGS.forEach((leg, l) => {
      for (let k = 0; k < 2; k += 1) {
        const [thigh, from, to] = [joints[leg[0]], joints[leg[k]!], joints[leg[k + 1]!]];
        const limb = limbs[l * 2 + k]!;
        if (thigh === undefined || from === undefined || to === undefined) limb.length = 0;
        else placeLimb(hips, thigh, from, to, limb);
      }
    });
    const { placed, hinges, kept } = worn;
    const count = worn.hangs.length;
    const point = WORN_POINT;
    for (let g = 0; g < count; g += 1) {
      point[0] = point[1] = point[2] = 0;
      for (let k = g * INFLUENCES; k < g * INFLUENCES + INFLUENCES; k += 1) {
        const w = worn.weights[k]!;
        if (w === 0) continue;
        const joint = worn.joints[k]!;
        const on = joint === garment ? hips : (joints[joint] ?? STILL);
        const [px, py, pz] = [worn.points[k * 3]!, worn.points[k * 3 + 1]!, worn.points[k * 3 + 2]!];
        for (let c = 0; c < 3; c += 1) point[c] = point[c]! + w * (on.r[c * 3]! * px + on.r[c * 3 + 1]! * py + on.r[c * 3 + 2]! * pz + on.t[c]!);
      }
      unturn(r, point[0]! - t[0]!, point[1]! - t[1]!, point[2]! - t[2]!, point);
      for (let c = 0; c < 3; c += 1) placed[g * 3 + c] = point[c]!;
    }
    if (worn.lengths === null) {
      /* As first placed: how far apart each edge's points are, and where each panel's point hangs from. */
      worn.lengths = new Float32Array(worn.edges.length / 2);
      for (let e = 0; e < worn.edges.length; e += 2) {
        const [a, b] = [worn.edges[e]! * 3, worn.edges[e + 1]! * 3];
        worn.lengths[e >> 1] = Math.hypot(placed[a]! - placed[b]!, placed[a + 1]! - placed[b + 1]!, placed[a + 2]! - placed[b + 2]!);
      }
      const tops = limbs.filter((l) => l.length > 0).map((l) => l.top);
      hingesOf(placed, worn.turning, tops.length === 0 ? Infinity : Math.min(...tops), hinges);
    }
    keepClothOff(placed, worn.turning, hinges, worn.edges, worn.lengths, limbs, worn.turns, kept);
    for (let g = 0, o = this.slots * 16; g < count; g += 1, o += 16) {
      const turnsOn = worn.normalJoints[g]! * 16;
      for (let c = 0; c < 12; c += 1) f[o + c] = f[turnsOn + c]!;
      const [x, y, z] = [kept[g * 3]!, kept[g * 3 + 1]!, kept[g * 3 + 2]!];
      f[o + 12] = (r[0]! * x + r[1]! * y + r[2]! * z + t[0]!) / 1000;
      f[o + 13] = -(r[3]! * x + r[4]! * y + r[5]! * z + t[1]!) / 1000;
      f[o + 14] = -(r[6]! * x + r[7]! * y + r[8]! * z + t[2]!) / 1000;
      f[o + 15] = 1;
    }
  }

  /**
   * The posed skin's lowest points into `out`, metres above the floor (below it where less than 0):
   * the body's, and its feet's (the vertices the joints in `feet` weigh most in). A vertex hanging on
   * one of `leftOut` (an accessory: hair, a tail) is not counted.
   */
  lowest(feet: ReadonlySet<number>, leftOut: ReadonlySet<number>, out: { body: number; feet: number }): void {
    const { joints, weights, points } = this.data;
    const f = this.matrices;
    out.body = Infinity;
    out.feet = Infinity;
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
        const hung = joint < this.slots ? joint : this.worn!.hangs[joint - this.slots]!;
        if (leftOut.has(hung)) continue vertices;
        if (w > heaviest) [heaviest, on] = [w, hung];
        const o = joint * 16;
        y += w * (f[o + 1]! * points[k * 3]! + f[o + 5]! * points[k * 3 + 1]! + f[o + 9]! * points[k * 3 + 2]! + f[o + 13]!);
        sum += w;
      }
      /* A vertex weighing nothing (a picture the face does not show) is drawn nowhere. */
      if (sum === 0) continue;
      if (y < out.body) out.body = y;
      if (feet.has(on) && y < out.feet) out.feet = y;
    }
  }

  /**
   * Vertex `i` in the skin: its weighted points, the one on its normal's joint first (or that joint
   * weighing nothing, where it holds none of them); nothing, on a picture the face does not show.
   */
  private skinVertex(i: number): void {
    const m = this.mesh;
    const { joints, weights, points, normals } = this.data;
    const at = i * INFLUENCES;
    joints.fill(0, at, at + INFLUENCES);
    weights.fill(0, at, at + INFLUENCES);
    points.fill(0, at * 3, (at + INFLUENCES) * 3);
    const picture = m.pictureOf[i]!;
    if (picture !== 0 && picture !== this.picture + 1) {
      normals.fill(0, i * 3, i * 3 + 3);
      return;
    }
    const count = m.influenceCount[i]!;
    const normalJoint = m.normalJoint[i]!;
    let first = -1;
    for (let k = 0; k < count && first < 0; k += 1) if (m.weights[at + k] !== 0 && m.joints[at + k] === normalJoint) first = k;
    let slot = 0;
    const put = (k: number): void => {
      if (slot === INFLUENCES) throw new Error(`fighter mesh: vertex ${i} hangs on four joints and turns its normal on a fifth`);
      joints[at + slot] = m.joints[at + k]!;
      weights[at + slot] = m.weights[at + k]!;
      for (let c = 0; c < 3; c += 1) points[(at + slot) * 3 + c] = m.points[(at + k) * 3 + c]!;
      slot += 1;
    };
    if (first >= 0) put(first);
    else {
      joints[at] = normalJoint;
      slot = 1;
    }
    for (let k = 0; k < count; k += 1) if (k !== first && m.weights[at + k] !== 0) put(k);
    for (let c = 0; c < 3; c += 1) normals[i * 3 + c] = m.normal[i * 3 + c]! / 4096;
    /* A kept vertex is its point's joint, placed where the point is put; its normal turns as the joint it hangs on. */
    const own = this.worn?.jointOf[i] ?? -1;
    if (own < 0) return;
    joints.fill(0, at, at + INFLUENCES);
    weights.fill(0, at, at + INFLUENCES);
    points.fill(0, at * 3, (at + INFLUENCES) * 3);
    joints[at] = own;
    weights[at] = 1;
  }
}

/** A point, as each frame's cloth places it. */
const WORN_POINT = [0, 0, 0];

/**
 * The cloth a mesh keeps off the legs, a point for each different place a vertex weighing on the
 * garment's joint or a tail's has: per vertex, the joint of its point (from the mesh's), or -1; per
 * point, its joints, weights and places (four each, as the mesh lays a vertex's), the joint its
 * normal turns on, the cloth's joint it weighs on most and whether that is the garment's (a
 * panel's point, which turns); the edges between them (two points each) and their lengths (as
 * first placed); the legs' parts, with the surfaces the mesh gives them; and room for each frame's
 * places, hinges, turns and kept places.
 */
interface Worn {
  readonly jointOf: Int32Array;
  readonly joints: Uint8Array;
  readonly weights: Float32Array;
  readonly points: Float32Array;
  readonly normalJoints: Uint8Array;
  readonly hangs: Uint8Array;
  readonly turning: Uint8Array;
  readonly edges: Uint32Array;
  lengths: Float32Array | null;
  readonly limbs: readonly LimbNow[];
  readonly placed: Float32Array;
  readonly hinges: Float32Array;
  readonly turns: Float32Array;
  readonly kept: Float32Array;
}

/** The cloth a mesh keeps off the legs: what weighs on its garment's joint and on `tails`; null where nothing does. */
function wornOf(mesh: FighterMesh, slots: number, tails: readonly number[]): Worn | null {
  const cloth = new Set([...(mesh.garment === 0 ? [] : [mesh.garment]), ...tails]);
  if (cloth.size === 0) return null;
  const jointOf = new Int32Array(mesh.vertexCount).fill(-1);
  const pointOf = new Int32Array(mesh.vertexCount).fill(-1);
  const places = new Map<string, number>();
  const [joints, weights, points, normalJoints, hangs]: number[][] = [[], [], [], [], []];
  for (let v = 0; v < mesh.vertexCount; v += 1) {
    const at = v * INFLUENCES;
    let most = -1;
    for (let k = at; k < at + mesh.influenceCount[v]!; k += 1) if (mesh.weights[k]! > 0 && cloth.has(mesh.joints[k]!) && (most < 0 || mesh.weights[k]! > mesh.weights[most]!)) most = k;
    if (most < 0) continue;
    const key = [mesh.normalJoint[v], ...Array.from(mesh.joints.subarray(at, at + INFLUENCES)), ...Array.from(mesh.weights.subarray(at, at + INFLUENCES)), ...Array.from(mesh.points.subarray(at * 3, (at + INFLUENCES) * 3))].join();
    let g = places.get(key);
    if (g === undefined) {
      g = hangs!.length;
      places.set(key, g);
      for (let k = at; k < at + INFLUENCES; k += 1) {
        const used = k < at + mesh.influenceCount[v]!;
        joints!.push(used ? mesh.joints[k]! : 0);
        weights!.push(used ? mesh.weights[k]! : 0);
        points!.push(mesh.points[k * 3]!, mesh.points[k * 3 + 1]!, mesh.points[k * 3 + 2]!);
      }
      normalJoints!.push(mesh.normalJoint[v]!);
      hangs!.push(mesh.joints[most]!);
    }
    pointOf[v] = g;
    jointOf[v] = slots + g;
  }
  const count = hangs!.length;
  if (count === 0) return null;
  const edges = new Map<string, [number, number]>();
  for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
    for (let c = 0; c < 3; c += 1) {
      const [a, b] = [pointOf[mesh.indices[i + c]!]!, pointOf[mesh.indices[i + ((c + 1) % 3)]!]!];
      if (a < 0 || b < 0 || a === b) continue;
      edges.set(a < b ? `${a},${b}` : `${b},${a}`, [Math.min(a, b), Math.max(a, b)]);
    }
  }
  return {
    jointOf,
    joints: Uint8Array.from(joints!),
    weights: Float32Array.from(weights!),
    points: Float32Array.from(points!),
    normalJoints: Uint8Array.from(normalJoints!),
    hangs: Uint8Array.from(hangs!),
    turning: Uint8Array.from(hangs!, (j) => (j === mesh.garment ? 1 : 0)),
    edges: Uint32Array.from([...edges.values()].flat()),
    lengths: null,
    limbs: LEGS.flatMap((leg) => [0, 1].map((k) => newLimb(profileOf(leg[k]!, mesh.joints, mesh.weights, mesh.points)))),
    placed: new Float32Array(count * 3),
    hinges: new Float32Array(count * 3),
    turns: new Float32Array(count),
    kept: new Float32Array(count * 3),
  };
}
