/**
 * Tekken Ball's ball drawn from its state: a sphere of eight gores, each in its ball's colour, lit
 * (the iron ball darker; a set-up ball's light pulsing), or one flat grey or white while it fades
 * in or out, turns into a point, or has just been touched; turned by its spin, squashed along its
 * stretch's axis, and over everything while it fades in at the centre (and on the versus select).
 * Drawn round, finely divided, its gores' edges along the game's mesh's. Under it a black disc on
 * the sand, smaller the higher it flies; and while it turns into a
 * point, four beams of light from it to the picture's top and bottom. On the versus select the
 * ball being chosen turns under the names, round on the picture, sliding off and in as the next
 * is chosen.
 */
import { Camera, createEnvironment, type MeshHandle, type RendererApi, type SurfaceMaterial, type SurfaceTextureHandle } from '@driftengine/core';
import { createSpritePass, drawSprite, type SpritePass } from '@driftengine/ui2d';
import type { BallTables } from '../../sim/data/ball.ts';
import type { MathTables } from '../../sim/data/tables.ts';
import { rootRotation } from '../../sim/fight/skeleton.ts';
import { rotateLong } from '../../sim/math/matrix.ts';
import { projectPoint } from '../../sim/math/projection.ts';
import type { FightState } from '../../sim/fight/state.ts';

/** The ball's looks: flat in the drawn grey (fading in, fading out), flat white (a point, struck, chained), lit with its back colour pulsing (set up), drawn over everything (fading in; the versus select's). */
const Look = { FADING_IN: 0, FADING_OUT: 1, POINT: 2, SET_UP: 4, STRUCK: 5, CHAINED: 8, SELECT: 0xa } as const;
const FLAT_WHITE = new Set<number>([Look.POINT, Look.STRUCK, Look.CHAINED]);
/** The ball's gores, how finely each is divided (slices across it, rings from pole to pole), and the shadow disc's sides. */
const GORES = 8;
const SPHERE = { slices: 8, rings: 32 } as const;
const SHADOW_SIDES = 48;
/** How high over the sand the shadow lies (mm). */
const SHADOW_LIFT = 3;
/** The fight's picture: its middle across, its lines (the beams reach its top and bottom), and its units across a 4:3 picture's height; the depth over everything a ball is laid at (mm). */
const PICTURE = { middle: 192, lines: 0x1e0, across: 288 } as const;
const NEAR = 120;
/** The beams' grey at their far ends (of 0xff), the wedge they are painted in, and the light a lit ball's back colour gives (its share). */
const BEAM_EDGE = 0x30;
const WEDGE = { w: 64, h: 256 } as const;
const BACK = 0x200;
/**
 * The select's ball: the lines of the picture its centre is below the middle (centred across under
 * the names), how many lines its radius covers, and the lines across a millimetre of its slide
 * moves it, as the game's view and the select's picture put it.
 */
const SELECT = { below: 111, radius: 64, across: 0.2316 } as const;
/** The select camera's distance to its picture, in lines. */
const SELECT_DISTANCE = 500;

const linear = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

/** A beam's wedge: from its point at the top's middle to its full width at the bottom, white fading to the beam's end's grey. */
function wedge(): OffscreenCanvas {
  const canvas = new OffscreenCanvas(WEDGE.w, WEDGE.h);
  const g = canvas.getContext('2d')!;
  const fade = g.createLinearGradient(0, 0, 0, WEDGE.h);
  fade.addColorStop(0, 'rgba(255, 255, 255, 1)');
  fade.addColorStop(1, `rgba(255, 255, 255, ${BEAM_EDGE / 0xff})`);
  g.fillStyle = fade;
  g.beginPath();
  g.moveTo(WEDGE.w / 2, 0);
  g.lineTo(WEDGE.w, WEDGE.h);
  g.lineTo(0, WEDGE.h);
  g.closePath();
  g.fill();
  return canvas;
}

/** 3 × 3 products, row-major. */
const multiply = (a: readonly number[], b: readonly number[]): number[] => [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => a[i * 3]! * b[j]! + a[i * 3 + 1]! * b[3 + j]! + a[i * 3 + 2]! * b[6 + j]!));
const transpose = (a: readonly number[]): number[] => [a[0]!, a[3]!, a[6]!, a[1]!, a[4]!, a[7]!, a[2]!, a[5]!, a[8]!];
/** A rotation from three 12-bit turns, as floats. */
function turned(math: MathTables, x: number, y: number, z: number): number[] {
  const out = new Array<number>(9).fill(0);
  rootRotation(math, (x << 4) & 0xffff, (y << 4) & 0xffff, (z << 4) & 0xffff, out);
  return out.map((v) => v / 4096);
}

/** A game rotation (row-major) and position (mm) as an engine model matrix (column-major, metres, y up, z toward the eye). */
function modelOf(r: readonly number[], t: readonly number[], out: Float32Array): Float32Array {
  const flip = [1, -1, -1];
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) out[j * 4 + i] = flip[i]! * r[i * 3 + j]! * flip[j]!;
    out[12 + i] = (flip[i]! * t[i]!) / 1000;
    out[i * 4 + 3] = 0;
  }
  out[15] = 1;
  return out;
}

/** Where a point of the fight lands on the picture, as the game projects it. */
export function screenOf(state: FightState, at: readonly number[]): { x: number; y: number; depth: number } {
  const moved = [0, 0, 0];
  rotateLong(state.view.rotation, at[0]!, at[1]!, at[2]!, moved);
  const t = state.view.translation;
  return projectPoint(state.screen, (moved[0]! + t[0]!) | 0, (moved[1]! + t[1]!) | 0, (moved[2]! + t[2]!) | 0);
}

export class BallView {
  private readonly renderer: RendererApi;
  private readonly tables: BallTables;
  private readonly math: MathTables;
  /** Each ball's mesh in its gores' colours, and one all white for the flat looks. */
  private readonly meshes: MeshHandle[];
  private readonly flat: MeshHandle;
  private readonly shadow: MeshHandle;
  private readonly beamPass: SpritePass;
  private readonly beamHandle: number;
  private readonly transform = new Float32Array(6);
  private readonly material: SurfaceMaterial<SurfaceTextureHandle>;
  private readonly model = new Float32Array(16);
  private readonly shadowModel = new Float32Array(16);
  private readonly near = new Float32Array(16);
  private readonly scaled = new Float32Array(16);
  private readonly selectCamera = new Camera();
  private readonly selectView = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  private readonly selectEnv = createEnvironment({
    directionalDir: [-0.4, 0.8, 0.45],
    directionalColor: [1.2, 1.15, 1.08],
    ambient: [0.2, 0.2, 0.21],
    ambientGround: [0.12, 0.12, 0.11],
    emissiveGain: 1,
    nightFactor: 1,
    fogColor: [0, 0, 0],
    fogDensity: 0,
    fogHeightFalloff: 0,
    fogBaseY: 0,
  });

  constructor(renderer: RendererApi, tables: BallTables, math: MathTables, white: SurfaceTextureHandle) {
    this.renderer = renderer;
    this.tables = tables;
    this.math = math;
    this.material = { albedo: white, cutout: 0, doubleSided: true };
    this.meshes = tables.kinds.map((kind) => this.sphere((gore) => kind.colours[gore]!.map(linear)));
    this.flat = this.sphere(() => [1, 1, 1]);
    this.shadow = this.disc();
    this.beamPass = createSpritePass({ label: 'ball beams', capacity: 4, slots: 1 });
    this.beamHandle = renderer.registerPass(this.beamPass);
    this.beamPass.setTexture(0, wedge(), { colorSpace: 'srgb', filter: 'linear' });
  }

  /**
   * The ball drawn round: its eight gores (each an eighth of its turn about the vertical, from +z
   * toward +x, as the game's mesh has them) each in its colour, finely divided, smooth.
   */
  private sphere(colour: (gore: number) => number[]): MeshHandle {
    const radius = this.tables.vertices[1]![1]! / 1000;
    const positions: number[] = [];
    const ns: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    for (let gore = 0; gore < GORES; gore += 1) {
      const rgb = colour(gore);
      const base = positions.length / 3;
      for (let ring = 0; ring <= SPHERE.rings; ring += 1) {
        const down = (ring / SPHERE.rings) * Math.PI;
        for (let step = 0; step <= SPHERE.slices; step += 1) {
          const turn = ((gore + step / SPHERE.slices) / GORES) * Math.PI * 2;
          /* Game axes (y down, z away) turned to the engine's. */
          const n = [Math.sin(down) * Math.sin(turn), Math.cos(down), -Math.sin(down) * Math.cos(turn)];
          positions.push(n[0]! * radius, n[1]! * radius, n[2]! * radius);
          ns.push(n[0]!, n[1]!, n[2]!);
          colors.push(...rgb);
        }
      }
      const row = SPHERE.slices + 1;
      for (let ring = 0; ring < SPHERE.rings; ring += 1) {
        for (let step = 0; step < SPHERE.slices; step += 1) {
          const v = base + ring * row + step;
          indices.push(v, v + row, v + 1, v + 1, v + row, v + row + 1);
        }
      }
    }
    const n = positions.length / 3;
    return this.renderer.createMesh({ positions: new Float32Array(positions), normals: new Float32Array(ns), colors: new Float32Array(colors), emissive: new Float32Array(n), uvs: new Float32Array(n * 2), indices: new Uint32Array(indices) });
  }

  /** The shadow: a round disc as wide as the ball, flat, black. */
  private disc(): MeshHandle {
    const radius = this.tables.vertices[1]![1]! / 1000;
    const positions = [0, 0, 0];
    for (let k = 0; k < SHADOW_SIDES; k += 1) {
      const a = (k / SHADOW_SIDES) * Math.PI * 2;
      positions.push(Math.sin(a) * radius, 0, -Math.cos(a) * radius);
    }
    const n = positions.length / 3;
    const indices = Array.from({ length: SHADOW_SIDES }, (_, k) => [0, 1 + k, 1 + ((k + 1) % SHADOW_SIDES)]).flat();
    return this.renderer.createMesh({ positions: new Float32Array(positions), normals: new Float32Array(n * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)), colors: new Float32Array(n * 3), emissive: new Float32Array(n), uvs: new Float32Array(n * 2), indices: new Uint32Array(indices) });
  }


  /**
   * The versus select's ball, in its colours, lit, turning by its three turns, slid across by `x`
   * (mm), under the select's lines; inside a frame, before them. `aspect` the window's.
   */
  drawSelect(ball: { readonly x: number; readonly yaw: number; readonly pitch: number; readonly roll: number }, kind: number, aspect: number): void {
    const camera = this.selectCamera;
    camera.near = 0.05;
    camera.far = 50;
    camera.fovYDeg = (2 * Math.atan(PICTURE.lines / 2 / SELECT_DISTANCE) * 180) / Math.PI;
    camera.updateMatrices(aspect);
    camera.adoptView(this.selectView, camera.projection);
    const depth = (this.tables.vertices[1]![1]! / 1000) * (SELECT_DISTANCE / SELECT.radius);
    const toMetres = depth / SELECT_DISTANCE;
    const r = turned(this.math, ball.pitch, ball.yaw, ball.roll);
    modelOf(r, [ball.x * SELECT.across * toMetres * 1000, SELECT.below * toMetres * 1000, depth * 1000], this.model);
    const choice = this.tables.kinds[kind] ?? this.tables.kinds[0]!;
    const light = 1 + choice.back[0]! / BACK;
    const renderer = this.renderer;
    renderer.bindMeshPass(camera, this.selectEnv);
    renderer.setMaterial(this.material);
    renderer.drawMesh(this.meshes[kind] ?? this.meshes[0]!, this.model, 0, [light, light, light]);
    renderer.setMaterial(null);
  }

  /** The ball's rotation: its spin, squashed along its stretch's axis when it stretches. */
  private rotation(state: FightState): number[] {
    const ball = state.ball;
    const spin = turned(this.math, ball.spin[0]!, ball.spin[1]!, ball.spin[2]!);
    const stretch = ((ball.stretch << 16) >> 16) / 4096;
    if (stretch === 0) return spin;
    const axis = turned(this.math, ball.stretchAngles[0]!, ball.stretchAngles[1]!, ball.stretchAngles[2]!);
    const squash = [1 - stretch, 0, 0, 0, 1 + stretch, 0, 0, 0, 1 + stretch];
    return multiply(multiply(multiply(axis, squash), transpose(axis)), spin);
  }

  /** A model moved toward the eye to `NEAR` along its line of sight, the same on the picture, so it lies over everything. */
  private overEverything(view: Float32Array, model: Float32Array, depth: number): Float32Array {
    const k = NEAR / Math.max(NEAR, depth);
    /* view⁻¹ · k · view · model: the camera's space scaled about the eye. */
    const scaled = this.scaled;
    for (let c = 0; c < 4; c += 1) {
      for (let r = 0; r < 4; r += 1) {
        let v = 0;
        for (let m = 0; m < 4; m += 1) v += view[m * 4 + r]! * model[c * 4 + m]!;
        scaled[c * 4 + r] = r < 3 ? v * k : v;
      }
    }
    for (let c = 0; c < 4; c += 1) {
      const [x, y, z] = [scaled[c * 4]!, scaled[c * 4 + 1]!, scaled[c * 4 + 2]!];
      const w = scaled[c * 4 + 3]!;
      const tx = x - view[12]! * w;
      const ty = y - view[13]! * w;
      const tz = z - view[14]! * w;
      for (let r = 0; r < 3; r += 1) this.near[c * 4 + r] = view[r * 4]! * tx + view[r * 4 + 1]! * ty + view[r * 4 + 2]! * tz;
      this.near[c * 4 + 3] = w;
    }
    return this.near;
  }

  /** The ball, its shadow and its beams this frame (`view` the camera's, the engine's axes). */
  draw(state: FightState, view: Float32Array): void {
    const ball = state.ball;
    if (state.nothingDrawn !== 0 || ball.state === 0) return;
    const renderer = this.renderer;
    const r = this.rotation(state);
    const model = modelOf(r, ball.position, this.model);
    const look = ball.look;
    renderer.setMaterial(this.material);
    this.drawShadow(state);
    const over = look === Look.FADING_IN || look === Look.SELECT;
    const drawn = over ? this.overEverything(view, model, screenOf(state, ball.position).depth) : model;
    if (look === Look.FADING_IN || look === Look.FADING_OUT || FLAT_WHITE.has(look)) {
      const n = ball.timer;
      const grey = look === Look.FADING_IN ? -(n * 8) & 0xff : look === Look.FADING_OUT ? (n * 8 - 1) & 0xff : 0xff;
      const g = linear(grey);
      renderer.drawTranslucentMesh(this.flat, drawn, 1, { lit: false, fog: false, tint: [g, g, g] });
    } else {
      const kind = this.tables.kinds[state.match.ball.kind] ?? this.tables.kinds[0]!;
      let back = kind.back[0]!;
      if (look === Look.SET_UP && state.pause.frozen === 0) {
        const x = (state.vsyncSeen << 4) & 0x1ff;
        back = 0xff < x ? 0x1ff - x : x;
      }
      const light = 1 + back / BACK;
      if (over) renderer.drawTranslucentMesh(this.meshes[state.match.ball.kind] ?? this.meshes[0]!, drawn, 1, { lit: true, fog: false, tint: [light, light, light] });
      else renderer.drawMesh(this.meshes[state.match.ball.kind] ?? this.meshes[0]!, drawn, 0, [light, light, light]);
    }
    renderer.setMaterial(null);
  }

  /** The shadow on the sand under the ball, turned and squashed with it about the vertical, smaller the higher the ball. */
  private drawShadow(state: FightState): void {
    const ball = state.ball;
    const spin = turned(this.math, 0, ball.spin[1]!, 0);
    const stretch = ((ball.stretch << 16) >> 16) / 4096;
    const axis = turned(this.math, 0, ball.stretchAngles[1]!, 0);
    const k = ((ball.position[1]! >> 1) + 0x1000) / 4096;
    const turn = multiply(multiply(axis, [1 - stretch, 0, 0, 0, 1 + stretch, 0, 0, 0, 1 + stretch]), spin);
    const scaled = multiply(turn, [k, 0, 0, 0, 1, 0, 0, 0, k]);
    modelOf(scaled, [ball.position[0]!, -SHADOW_LIFT, ball.position[2]!], this.shadowModel);
    this.renderer.drawMesh(this.shadow, this.shadowModel, 1);
  }

  /**
   * The point's four beams, each a wedge from the ball's place on the picture out to the picture's
   * top or bottom, as wide there as the game draws it, white at the ball and dim at its end, over
   * everything: `aspect` the picture's.
   */
  drawBeams(state: FightState, aspect: number): void {
    const ball = state.ball;
    if (state.nothingDrawn !== 0 || ball.state === 0 || ball.look !== Look.POINT) return;
    const half = (PICTURE.across / 2) * aspect;
    this.transform.set([1 / half, 0, 0, -2 / PICTURE.lines, -PICTURE.middle / half, 1]);
    const pass = this.beamPass;
    pass.setTransform(this.transform);
    pass.reset();
    const centre = screenOf(state, ball.position);
    ball.beams.forEach((beam, k) => {
      const y = (k & 2) === 0 ? PICTURE.lines : 0;
      const x1 = (beam.x1 << 16) >> 16;
      const x2 = (beam.x2 << 16) >> 16;
      const dx = (x1 + x2) / 2 - centre.x;
      const dy = y - centre.y;
      const length = Math.hypot(dx, dy);
      if (length === 0) return;
      const width = (Math.abs(x2 - x1) * Math.abs(dy)) / length;
      drawSprite(pass.batch, 0, { x: centre.x - width / 2, y: centre.y, w: width, h: length, rotation: Math.atan2(-dx, dy), pivotX: 0.5, pivotY: 0 }, null, null);
    });
    this.renderer.drawPass(this.beamHandle);
  }

}
