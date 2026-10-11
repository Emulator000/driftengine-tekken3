/**
 * A fighter on screen: the extracted mesh (`FTR`, scripts/lib/fighter.mjs and, for Kazuya,
 * scripts/lib/t4/kazuya.mjs), skinned on the CPU every frame from the skeleton's world transforms.
 *
 * Each vertex is up to four joint-space points with their weights: one, or a seam of two weighted
 * half and half, as the game's renderer averages them; Kazuya's smooth skin takes up to four. Game
 * axes are millimetres with Y down; the player's are metres with Y up and Z toward the viewer, a
 * half turn about X.
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
 * the one on the face drawn collapsed to a point.
 */
import type { MeshHandle, RendererApi, SurfaceMaterial, SurfaceTextureHandle } from '@driftengine/core';
import type { Rotation } from '../../../motion/motion.ts';
import { HelperRig, type Frame, type RigNode } from '../../../mod/kazuya/tekken4.ts';

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

export class Fighter {
  readonly handle: MeshHandle;
  readonly material: SurfaceMaterial<SurfaceTextureHandle>;
  /** Light added over its own colours, linear: the hit flash (`light`). */
  private readonly glow: [number, number, number] = [0, 0, 0];
  private readonly positions: Float32Array;
  private readonly normals: Float32Array;
  private readonly renderer: RendererApi;
  private readonly mesh: FighterMesh;
  private readonly texture: SurfaceTextureHandle;
  /** Per shape group, the shape drawn. */
  private readonly drawn: number[];
  /** The picture on its face (0 the face as loaded). */
  private picture = 0;

  /** It owns `mesh`: a hand's shape is copied into its points and normals. */
  constructor(renderer: RendererApi, mesh: FighterMesh, texture: SurfaceTextureHandle, white: SurfaceTextureHandle | null = null) {
    this.renderer = renderer;
    this.mesh = mesh;
    this.texture = texture;
    this.drawn = mesh.shapes.map(() => 0);
    const n = mesh.vertexCount;
    this.positions = new Float32Array(n * 3);
    this.normals = new Float32Array(n * 3);
    /* Bounds are measured at upload; two corners make them cover the arena. */
    this.positions.set([-6, -1, -6, 6, 4, 6]);
    for (let i = 0; i < n; i += 1) this.normals[i * 3 + 1] = 1;
    this.handle = renderer.createMesh(
      {
        positions: this.positions,
        normals: this.normals,
        colors: new Float32Array(n * 3).fill(1),
        emissive: new Float32Array(n).fill(1),
        specular: new Float32Array(n),
        roughness: new Float32Array(n).fill(1),
        uvs: mesh.uv,
        indices: mesh.indices,
      },
      { dynamic: true },
    );
    /* Emission through a white map, so its scale is the glow's colour over the fighter's own. */
    this.material = { albedo: texture, cutout: 0.5, doubleSided: true, ...(white === null ? {} : { emissive: white, emissiveScale: this.glow }) };
  }

  /** The light a blow throws on it this frame, added over its colours (linear; 0 is none). */
  light(r: number, g: number, b: number): void {
    this.glow[0] = r;
    this.glow[1] = g;
    this.glow[2] = b;
  }

  /** Its mesh and texture let go, once the match no longer has it. */
  dispose(): void {
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
      }
    }
  }

  /** The picture on its face: 0 the face as loaded (the eyes open), 1 the next (the eyes closed). */
  face(picture: number): void {
    this.picture = picture < this.mesh.pictures ? picture : 0;
  }

  /** Places every vertex for the joints' world transforms and uploads the result; a picture not on the face collapses to a point. */
  pose(skeleton: readonly (JointTransform | undefined)[]): void {
    const m = this.mesh;
    const joints: readonly (Frame | undefined)[] = m.rig === null ? skeleton : m.rig.extend(skeleton);
    const out = this.positions;
    const outNormal = this.normals;
    const place = (joint: number, x: number, y: number, z: number, into: number[]): void => {
      const j = joints[joint];
      if (j === undefined) {
        into[0] = x;
        into[1] = y;
        into[2] = z;
        return;
      }
      const r = j.r;
      into[0] = (r[0] ?? 0) * x + (r[1] ?? 0) * y + (r[2] ?? 0) * z + (j.t[0] ?? 0);
      into[1] = (r[3] ?? 0) * x + (r[4] ?? 0) * y + (r[5] ?? 0) * z + (j.t[1] ?? 0);
      into[2] = (r[6] ?? 0) * x + (r[7] ?? 0) * y + (r[8] ?? 0) * z + (j.t[2] ?? 0);
    };
    const a = [0, 0, 0];
    const b = [0, 0, 0];
    const shown = this.picture + 1;
    for (let i = 0; i < m.vertexCount; i += 1) {
      const p = i * 3;
      const picture = m.pictureOf[i]!;
      if (picture !== 0 && picture !== shown) {
        out[p] = 0;
        out[p + 1] = 0;
        out[p + 2] = 0;
        outNormal[p] = 0;
        outNormal[p + 1] = 1;
        outNormal[p + 2] = 0;
        continue;
      }
      a[0] = 0;
      a[1] = 0;
      a[2] = 0;
      const count = m.influenceCount[i] ?? 1;
      for (let k = 0; k < count; k += 1) {
        const slot = i * INFLUENCES + k;
        const w = m.weights[slot] ?? 0;
        if (w === 0) continue;
        place(m.joints[slot] ?? 0, m.points[slot * 3] ?? 0, m.points[slot * 3 + 1] ?? 0, m.points[slot * 3 + 2] ?? 0, b);
        a[0] += b[0]! * w;
        a[1] += b[1]! * w;
        a[2] += b[2]! * w;
      }
      /* Game axes to the player's: millimetres to metres, and a half turn about X. */
      out[p] = a[0]! / 1000;
      out[p + 1] = -a[1]! / 1000;
      out[p + 2] = -a[2]! / 1000;

      const j = joints[m.normalJoint[i] ?? 0];
      const nx = (m.normal[p] ?? 0) / 4096;
      const ny = (m.normal[p + 1] ?? 0) / 4096;
      const nz = (m.normal[p + 2] ?? 0) / 4096;
      let wx = nx;
      let wy = ny;
      let wz = nz;
      if (j !== undefined) {
        const r = j.r;
        wx = (r[0] ?? 0) * nx + (r[1] ?? 0) * ny + (r[2] ?? 0) * nz;
        wy = (r[3] ?? 0) * nx + (r[4] ?? 0) * ny + (r[5] ?? 0) * nz;
        wz = (r[6] ?? 0) * nx + (r[7] ?? 0) * ny + (r[8] ?? 0) * nz;
      }
      const length = Math.hypot(wx, wy, wz) || 1;
      outNormal[p] = wx / length;
      outNormal[p + 1] = -wy / length;
      outNormal[p + 2] = -wz / length;
    }
    this.renderer.updateMesh(this.handle, out, outNormal);
  }
}
