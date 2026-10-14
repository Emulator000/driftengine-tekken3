/**
 * A viewer for every fighter and every move, decoded from the disc (`?viewer` in the address).
 *
 * ← → fighter · ↑ ↓ move (hold shift for ten) · A S stage · space pause · , . step a frame ·
 * drag to orbit, wheel to zoom. The address bar takes `fighter`, `move` and `stage`, and
 * `fighters=arcade` for the arcade board's models where it was read.
 */
import { Camera, MeshBuilder, createEnvironment, createRenderer, startLoop } from '@driftengine/core';
import type { SurfaceTextureHandle } from '@driftengine/core';
import { Fighter, readFighterMesh, type JointTransform } from './present/3d/fighter/fighter.ts';
import { CHANNELS, eulerMatrix, poseRotations, sampleMotion, type Motion, type MotionTables, type Rotation } from './motion/motion.ts';
import { motionOfMove, readMoveset, type Moveset } from './motion/moveset.ts';
import { createStage, type Stage } from './present/3d/stage/stage.ts';

const DATA = `${import.meta.env.BASE_URL}data/`;
/** The game advances a move one frame per field at 60 a second. */
const FPS = 60;

const canvas = document.querySelector<HTMLCanvasElement>('#stage');
const status = document.querySelector<HTMLElement>('#status');
if (canvas === null || status === null) throw new Error('the page is missing #stage or #status');

async function fetchBytes(path: string): Promise<ArrayBuffer> {
  const response = await fetch(DATA + path);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}. Have \`npm run disc\` and \`npm run extract\` run?`);
  return response.arrayBuffer();
}
const fetchJson = async <T>(path: string): Promise<T> => JSON.parse(new TextDecoder().decode(await fetchBytes(path))) as T;

const { renderer, backend, reason } = await createRenderer(canvas, {
  /*
   * The console saturates each channel on its own, in a texel times its colour over 128 and in an
   * additive blend alike, so a plain sRGB clip is its look; 'shoulder' would keep hues it loses.
   */
  outputTransform: 'srgb',
  screenEffects: true,
  hdrScene: true,
  maxDevicePixelRatio: 2,
  sceneSamples: 4,
});
console.log(`[tekken3] ${backend}: ${reason}`);
renderer.resize();
addEventListener('resize', () => renderer.resize());

const ENV = createEnvironment({
  directionalDir: [-0.4, 0.8, 0.45],
  directionalColor: [1, 0.96, 0.9],
  ambient: [0.35, 0.35, 0.38],
  ambientGround: [0.25, 0.24, 0.22],
  emissiveGain: 1,
  nightFactor: 0,
  fogColor: [0, 0, 0],
  fogDensity: 0,
  fogHeightFalloff: 0,
  fogBaseY: 0,
});

/* ---- Data. ---- */

interface Tables {
  sine: number[];
  curve: number[];
  channelShift: number[];
  fixup: number[];
  offsets: number[];
}
const raw = await fetchJson<Tables>('tables.json');
const tables: MotionTables = {
  sine: Int16Array.from(raw.sine),
  curve: Uint8Array.from(raw.curve),
  channelShift: Uint8Array.from(raw.channelShift),
  fixup: Int16Array.from(raw.fixup),
  offsets: Int32Array.from(raw.offsets),
};
const manifest = await fetchJson<{ fighters: { pack: number; moveset: number }[]; stages: { stage: number }[]; arcadeStages?: number[]; arcadeFighters?: number[] }>('manifest.json');
/** The packs drawn with the arcade board's models (`?fighters=arcade`), where it was read. */
const boardFighters = new Set(new URLSearchParams(location.search).get('fighters') === 'arcade' ? (manifest.arcadeFighters ?? []) : []);
const common = readMoveset(await fetchBytes('moves/common.bin'));

interface Joint {
  joint: number;
  parent: number;
  offset: [number, number, number];
  /** An accessory's rest rotation (joints 18 and up), three 16-bit angles. */
  rest?: [number, number, number];
}

interface Loaded {
  fighter: Fighter;
  skeleton: Joint[];
  moveset: Moveset;
}
const loaded = new Map<number, Promise<Loaded>>();

async function loadFighter(pack: number): Promise<Loaded> {
  const id = String(pack).padStart(2, '0');
  /* Mokujin (30, 31) has no moveset of his own; the viewer shows Paul's. */
  const moveset = String(Math.max(0, manifest.fighters.find((f) => f.pack === pack)?.moveset ?? 0)).padStart(2, '0');
  const dir = boardFighters.has(pack) ? 'arcade/fighters' : 'fighters';
  const [mesh, json, png, moves] = await Promise.all([
    fetchBytes(`${dir}/${id}.ftr`),
    fetchJson<{ skeleton: Joint[] }>(`${dir}/${id}.json`),
    fetchBytes(`${dir}/${id}.png`),
    fetchBytes(`moves/${moveset}.bin`),
  ]);
  const bitmap = await createImageBitmap(new Blob([png], { type: 'image/png' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const texture: SurfaceTextureHandle = renderer.createSurfaceTexture(bitmap, { colorSpace: 'srgb', filter: 'nearest', mipmap: false, wrap: 'clamp' });
  return { fighter: new Fighter(renderer, readFighterMesh(mesh), texture), skeleton: json.skeleton, moveset: readMoveset(moves) };
}

const stages = new Map<number, Promise<Stage>>();

async function loadTexture(path: string): Promise<SurfaceTextureHandle> {
  const bitmap = await createImageBitmap(new Blob([await fetchBytes(path)], { type: 'image/png' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  /* Unfiltered, as the PlayStation samples. */
  return renderer.createSurfaceTexture(bitmap, { colorSpace: 'srgb', filter: 'nearest', mipmap: false, wrap: 'clamp' });
}

/** A stage's scenery: the arcade's where its data has the stage, unless `?stages=psx`, else the disc's. */
async function loadStage(index: number): Promise<Stage> {
  const entry = manifest.stages[index]!;
  const id = String(entry.stage).padStart(2, '0');
  const arcade = new URLSearchParams(location.search).get('stages') !== 'psx' && (manifest.arcadeStages ?? []).includes(entry.stage);
  const dir = arcade ? 'arcade/stages' : 'stages';
  const [mesh, texture] = await Promise.all([fetchBytes(`${dir}/${id}.stg`), loadTexture(`${dir}/${id}.png`)]);
  return createStage(renderer, mesh, texture);
}

/* ---- The skeleton: world transforms from a pose. ---- */

const IDENTITY = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
const rotations: Rotation[] = Array.from({ length: 18 }, () => new Float64Array(9));
const values = new Int16Array(CHANNELS);

function multiply(a: Rotation, b: Rotation): Float64Array {
  const r = new Float64Array(9);
  for (let i = 0; i < 3; i += 1) {
    for (let k = 0; k < 3; k += 1) {
      r[i * 3 + k] = (a[i * 3] ?? 0) * (b[k] ?? 0) + (a[i * 3 + 1] ?? 0) * (b[3 + k] ?? 0) + (a[i * 3 + 2] ?? 0) * (b[6 + k] ?? 0);
    }
  }
  return r;
}

/** World transforms: each joint its parent's, then its own rotation, at its bone offset. */
function skeletonPose(skeleton: Joint[], motion: Motion, frame: number): (JointTransform | undefined)[] {
  sampleMotion(motion, frame, tables, values);
  poseRotations(values, tables, rotations);
  const world: (JointTransform | undefined)[] = [];
  const byJoint = new Map(skeleton.map((j) => [j.joint, j]));
  const solve = (joint: number): JointTransform | undefined => {
    if (world[joint] !== undefined) return world[joint];
    const node = byJoint.get(joint);
    if (node === undefined) return undefined;
    /*
     * An accessory (hair, a ponytail, an eyelid) hangs at its rest rotation here. The fight swings
     * it on its spring from where it hung the frame before, which a move shown on its own, a frame
     * at a time in any order, does not have.
     */
    const local = joint < 18 ? rotations[joint]! : node.rest ? eulerMatrix(tables, node.rest[0], node.rest[1], node.rest[2], new Float64Array(9)) : IDENTITY;
    const offset = joint === 0 ? [values[0]! + node.offset[0], values[1]! + node.offset[1], values[2]! + node.offset[2]] : node.offset;
    const parent = node.parent >= 0 ? solve(node.parent) : undefined;
    if (parent === undefined) {
      world[joint] = { r: new Float64Array(local), t: new Float64Array(offset) };
    } else {
      const pr = parent.r;
      world[joint] = {
        r: multiply(pr, local),
        t: new Float64Array([
          (pr[0] ?? 0) * offset[0]! + (pr[1] ?? 0) * offset[1]! + (pr[2] ?? 0) * offset[2]! + (parent.t[0] ?? 0),
          (pr[3] ?? 0) * offset[0]! + (pr[4] ?? 0) * offset[1]! + (pr[5] ?? 0) * offset[2]! + (parent.t[1] ?? 0),
          (pr[6] ?? 0) * offset[0]! + (pr[7] ?? 0) * offset[1]! + (pr[8] ?? 0) * offset[2]! + (parent.t[2] ?? 0),
        ]),
      };
    }
    return world[joint];
  };
  for (const j of skeleton) solve(j.joint);
  return world;
}

/* ---- State and input. ---- */

const params = new URLSearchParams(location.search);
const packs = manifest.fighters.map((f) => f.pack);
let packIndex = Math.max(0, packs.indexOf(Number(params.get('fighter') ?? 0)));
let move = Number(params.get('move') ?? 0) || 0;
let frame = 0;
let paused = params.get('paused') === '1';
let stageIndex = Math.max(0, Math.min(manifest.stages.length - 1, Number(params.get('stage') ?? 0) || 0));
let stage: Stage | null = null;
async function showStage(): Promise<void> {
  if (!stages.has(stageIndex)) stages.set(stageIndex, loadStage(stageIndex));
  stage = await stages.get(stageIndex)!;
}
let current: Loaded | null = null;
let motion: { motion: Motion; shared: boolean } | null = null;

async function show(): Promise<void> {
  const pack = packs[packIndex] ?? 0;
  if (!loaded.has(pack)) loaded.set(pack, loadFighter(pack));
  current = await loaded.get(pack)!;
  move = Math.max(0, Math.min(move, current.moveset.moveCount - 1));
  motion = motionOfMove(current.moveset, common, move);
  frame = 0;
}

addEventListener('keydown', (event) => {
  const step = event.shiftKey ? 10 : 1;
  if (event.key === 'ArrowRight') packIndex = (packIndex + 1) % packs.length;
  else if (event.key === 'ArrowLeft') packIndex = (packIndex + packs.length - 1) % packs.length;
  else if (event.key === 'ArrowUp') move += step;
  else if (event.key === 'ArrowDown') move = Math.max(0, move - step);
  else if (event.key === 's' || event.key === 'a') {
    stageIndex = (stageIndex + (event.key === 's' ? 1 : manifest.stages.length - 1)) % manifest.stages.length;
    void showStage();
  } else if (event.key === ' ') paused = !paused;
  else if (event.key === '.') frame += 1;
  else if (event.key === ',') frame = Math.max(0, frame - 1);
  else return;
  event.preventDefault();
  if (event.key.startsWith('Arrow')) void show();
});

let yaw = 0.6;
let pitch = 0.15;
let distance = 4;
let dragging = false;
canvas.addEventListener('pointerdown', (e) => {
  dragging = true;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointerup', () => (dragging = false));
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  yaw -= e.movementX * 0.008;
  pitch = Math.max(-0.4, Math.min(1.2, pitch + e.movementY * 0.006));
});
canvas.addEventListener('wheel', (e) => {
  distance = Math.max(1.2, Math.min(12, distance * Math.exp(e.deltaY * 0.001)));
  e.preventDefault();
}, { passive: false });

/* ---- Drawing. ---- */

const floor = renderer.createMesh(new MeshBuilder().addBox([0, -0.05, 0], [4, 0.05, 4], [0.32, 0.33, 0.36]).build());
const IDENTITY_MODEL = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const camera = new Camera();
camera.fovYDeg = 35;
camera.near = 0.05;
camera.far = 100;

await Promise.all([show(), showStage()]);

let clock = 0;
startLoop({
  simulate() {},
  render(_alpha, frameDt) {
    if (current !== null && motion !== null) {
      if (!paused) {
        clock += frameDt * FPS;
        while (clock >= 1) {
          clock -= 1;
          frame = (frame + 1) % motion.motion.frames;
        }
      }
      frame = Math.min(frame, motion.motion.frames - 1);
      current.fighter.pose(skeletonPose(current.skeleton, motion.motion, frame));
      status.textContent = `stage ${stageIndex} · fighter ${packs[packIndex]} · move ${move}/${current.moveset.moveCount - 1}${motion.shared ? ' (shared motion)' : ''} · frame ${frame + 1}/${motion.motion.frames}${paused ? ' · paused' : ''}`;
    }

    camera.position[0] = Math.sin(yaw) * Math.cos(pitch) * distance;
    camera.position[1] = 1 + Math.sin(pitch) * distance;
    camera.position[2] = Math.cos(yaw) * Math.cos(pitch) * distance;
    camera.lookAt(0, 1, 0);
    camera.updateMatrices(canvas.height > 0 ? canvas.width / canvas.height : 1);

    renderer.beginFrame([0.1, 0.11, 0.13]);
    renderer.bindMeshPass(camera, ENV);
    if (stage !== null) {
      renderer.setMaterial(stage.material);
      for (const cell of stage.cells) for (const piece of cell) if (!piece.cut) renderer.drawTranslucentMesh(piece.mesh, IDENTITY_MODEL, 1, { lit: false, fog: false, depthLayer: piece.layer });
      renderer.setMaterial(null);
    } else {
      renderer.drawMesh(floor, IDENTITY_MODEL);
    }
    if (current !== null) {
      renderer.setMaterial(current.fighter.material);
      renderer.drawMesh(current.fighter.handle, IDENTITY_MODEL);
      renderer.setMaterial(null);
    }
    /* The cut-out scenery over the solid, its soft edges over what lies behind it. */
    if (stage !== null) {
      renderer.setMaterial(stage.material);
      for (const cell of stage.cells) for (const piece of cell) if (piece.cut) renderer.drawTranslucentMesh(piece.mesh, IDENTITY_MODEL, 1, { lit: false, fog: false, depthLayer: piece.layer });
      renderer.setMaterial(null);
    }
    renderer.endFrame();
  },
});

Object.assign(globalThis, { __tekken3: () => ({ backend, stage: stageIndex, fighter: packs[packIndex], move, frame }) });
