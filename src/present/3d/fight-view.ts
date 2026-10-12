/**
 * The fight drawn from its state: each fighter on screen posed from its joints' world matrices,
 * its hands (and True Ogre's wings) in the shapes the game draws them in and its eyes open or
 * shut, the stage's scenery and ground laid as the game lays them, the fighters' shadows on the
 * floor, a heavy blow's flash as a glow on each fighter, the sparks, dust and bursts as particles,
 * all through the game's own camera and projection, the picture widened past 4:3 to fill the
 * window.
 */
import { Camera, computeLightMatrix, createEnvironment, type RendererApi, type ShadowCasters, type SurfaceTextureHandle } from '@driftengine/core';
import type { ArenaTables } from '../../assets/arena.ts';
import { handPart, wingsPart } from '../../sim/fight/hands.ts';
import type { FightData, FightState, Fighter as FighterState } from '../../sim/fight/state.ts';
import { Fighter, readFighterMesh, type JointTransform } from './fighter/fighter.ts';
import { Ground } from './stage/ground.ts';
import { createStage, type Stage } from './stage/stage.ts';
import { layGround, layScenery, newGround, newScenery } from './layout.ts';
import { Effects } from './effects/effects.ts';

/**
 * Where the presentation finds a model pack's and a stage's drawing files; whether the textures
 * are the enlarged ones, drawn smoothly (filtered, with mipmaps), or the originals, each texel sharp.
 */
export interface DrawingFiles {
  fighter(pack: number): Promise<{ mesh: ArrayBuffer; texture: ImageBitmap }>;
  stage(stage: number): Promise<{ mesh: ArrayBuffer; ground: ArrayBuffer; texture: ImageBitmap }>;
  readonly smooth: boolean;
}

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
/** The picture's half-height in the game's pixels, which its projection distance is against. */
const HALF_HEIGHT = 240;
/** Stage 11's sky behind its clouds, unless True Ogre plays there (8-bit sRGB). */
const SKY = [0x48, 0x68, 200] as const;
const SKY_STAGE = 0xb;
const FLASH_FRAMES = 0x30;
const SHADOW_STRENGTH = 1;

const linear = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

export class FightView {
  private readonly renderer: RendererApi;
  /** The match's data (a new match's replaces it). */
  data: FightData;
  private readonly arena: ArenaTables;
  private readonly files: DrawingFiles;
  private readonly camera = new Camera();
  private readonly view = new Float32Array(16);
  private readonly lightMatrix = new Float32Array(16);
  private readonly env = createEnvironment({
    directionalDir: [-0.4, 0.8, 0.45],
    directionalColor: [1.2, 1.15, 1.08],
    ambient: [0.14, 0.14, 0.15],
    ambientGround: [0.1, 0.1, 0.09],
    emissiveGain: 1,
    nightFactor: 1,
    fogColor: [0, 0, 0],
    fogDensity: 0,
    fogHeightFalloff: 0,
    fogBaseY: 0,
  });
  /** The floor's tint, undoing what the light adds where nothing shades it, so it keeps the game's colours. */
  private readonly groundTint: [number, number, number];
  private readonly white: SurfaceTextureHandle;
  private readonly sides: ({ pack: number; fighter: Fighter | null } | null)[] = [null, null];
  private readonly stages = new Map<number, { stage: Stage; ground: Ground } | null>();
  private readonly ground = newGround();
  private readonly scenery = newScenery();
  private readonly sceneryModel = new Float32Array(16);
  private readonly casting: Fighter[] = [];
  private readonly effects: Effects;
  /** The fighters' packs and stage `prepare` found ready, and those it waits on the compiles of. */
  private prepared = '';
  private preparing = '';

  constructor(renderer: RendererApi, data: FightData, arena: ArenaTables, files: DrawingFiles) {
    this.renderer = renderer;
    this.data = data;
    this.arena = arena;
    this.files = files;
    this.camera.near = 0.05;
    this.camera.far = 400;
    this.env.lightViewProj = this.lightMatrix;
    this.env.shadowStrength = 0;
    const up = Math.max(0, this.env.directionalDir[1]!);
    this.groundTint = [0, 1, 2].map((c) => 1 / (this.env.ambient[c]! + this.env.directionalColor[c]! * up)) as [number, number, number];
    this.white = renderer.createSurfaceTexture(new ImageData(new Uint8ClampedArray([255, 255, 255, 255]), 1, 1), { colorSpace: 'linear', filter: 'nearest', mipmap: false, wrap: 'clamp' });
    this.effects = new Effects(renderer);
  }

  /** A side's fighter for its model pack, loaded the first time it is asked for (null until then). */
  private fighterFor(side: number, pack: number): Fighter | null {
    const current = this.sides[side] ?? null;
    if (current !== null && current.pack === pack) return current.fighter;
    current?.fighter?.dispose();
    const next: { pack: number; fighter: Fighter | null } = { pack, fighter: null };
    this.sides[side] = next;
    void this.files.fighter(pack).then(({ mesh, texture }) => {
      const handle = this.renderer.createSurfaceTexture(texture, this.textureOptions(false));
      const fighter = new Fighter(this.renderer, readFighterMesh(mesh), handle, this.white);
      if (this.sides[side] === next) next.fighter = fighter;
      else fighter.dispose();
    });
    return null;
  }

  /**
   * How a fighter's or a stage's texture is sampled: smoothly from the enlarged atlas, or each
   * original texel sharp. A stage has no mipmaps: its backdrop is seen far off, where the smaller
   * levels would blend its regions across their gutters into seams.
   */
  private textureOptions(stage: boolean): { colorSpace: 'srgb'; filter: 'linear' | 'nearest'; mipmap: boolean; wrap: 'clamp' } {
    return this.files.smooth ? { colorSpace: 'srgb', filter: 'linear', mipmap: !stage, wrap: 'clamp' } : { colorSpace: 'srgb', filter: 'nearest', mipmap: false, wrap: 'clamp' };
  }

  /** The stage's scenery and ground, loaded the first time it is asked for (null until then). */
  private stageFor(id: number): { stage: Stage; ground: Ground } | null {
    if (!this.stages.has(id)) {
      this.stages.set(id, null);
      void this.files.stage(id).then(({ mesh, ground, texture }) => {
        const handle = this.renderer.createSurfaceTexture(texture, this.textureOptions(true));
        const stage = createStage(this.renderer, mesh, handle);
        this.stages.set(id, { stage, ground: new Ground(this.renderer, ground, stage.atlasWidth, stage.atlasHeight, handle) });
      });
    }
    return this.stages.get(id) ?? null;
  }

  /**
   * Whether the drawing of `state` is ready, what it lacks asked for now: its two fighters' models
   * (none with `stageAlone`, as the records draw it) and its stage loaded, and every pipeline their
   * draws take compiled off the frame. A fight's models are otherwise asked for by its first frame,
   * which then draws it without them, and the frames after wait on their pipelines.
   */
  prepare(state: FightState, stageAlone = false): boolean {
    const packs = stageAlone ? [] : [0, 1].map((i) => state.fighters[i]!.costume);
    const key = `${stageAlone ? 'alone' : packs.join(' ')} ${state.stage}`;
    const fighters = packs.map((pack, i) => this.fighterFor(i, pack));
    const drawn = this.stageFor(state.stage);
    if (drawn === null || fighters.includes(null)) return false;
    if (this.prepared === key) return true;
    if (this.preparing === key) return false;
    this.preparing = key;
    for (const fighter of fighters) this.renderer.prepareMesh(fighter!.handle, fighter!.material);
    for (const cell of drawn.stage.cells) if (cell !== null) this.renderer.prepareMesh(cell, drawn.stage.material, { translucent: true });
    void this.renderer.ready().then(() => {
      if (this.preparing === key) this.prepared = key;
    });
    return false;
  }

  /** A fighter's joints from its hung parts: each world rotation (4.12) and position (mm). */
  private jointsOf(f: FighterState): (JointTransform | undefined)[] {
    const joints: (JointTransform | undefined)[] = [];
    f.parts.forEach((part, i) => {
      if (part.hung === 0) return;
      const j = this.data.skeleton.partJoints[i]!;
      const world = f.skeleton.joints[j]!.world;
      joints[j] = { r: Float64Array.from(world.rotation, (v) => v / 4096), t: Float64Array.from(world.translation) };
    });
    return joints;
  }

  /** The game's view in the engine's axes, and its projection over the picture's half-height. */
  private adoptCamera(state: FightState, aspect: number): void {
    const flip = [1, -1, -1];
    const r = state.view.rotation;
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) this.view[j * 4 + i] = (flip[i]! * r[i * 3 + j]! * flip[j]!) / 4096;
      this.view[12 + i] = (flip[i]! * state.view.translation[i]!) / 1000;
      this.view[i * 4 + 3] = 0;
    }
    this.view[15] = 1;
    const h = state.screen.distance || 500;
    this.camera.fovYDeg = (2 * Math.atan(HALF_HEIGHT / h) * 180) / Math.PI;
    this.camera.updateMatrices(0.6 * aspect);
    this.camera.adoptView(this.view, this.camera.projection);
  }

  /** The flash's glow on a fighter: its colour at the strength left, by how much of the blow's side the camera sees. */
  private light(state: FightState, fighter: Fighter, f: FighterState): void {
    const flash = state.flash;
    const strength = 0 < flash.left ? flash.left / FLASH_FRAMES / 0x1000 : 0;
    if (strength === 0) {
      fighter.light(0, 0, 0);
      return;
    }
    const root = f.skeleton.base.translation;
    const eye = state.camera.drawn.eye;
    const [bx, by, bz] = [0, 1, 2].map((i) => flash.at[i]! - root[i]!);
    const [cx, cy, cz] = [0, 1, 2].map((i) => eye[i]! - root[i]!);
    const cos = (bx! * cx! + by! * cy! + bz! * cz!) / (Math.hypot(bx!, by!, bz!) * Math.hypot(cx!, cy!, cz!) || 1);
    const facing = (1 + cos) / 3;
    const glow = (c: number): number => (1 + flash.colour[c]! * strength * facing) ** 2.2 - 1;
    fighter.light(glow(0), glow(1), glow(2));
  }

  /** The fighters' shadow map this field, around their midpoint. */
  private castShadows(state: FightState): void {
    const casting = this.casting;
    if (casting.length === 0) {
      this.env.shadowStrength = 0;
      return;
    }
    const [a, b] = state.fighters;
    const x = (a.skeleton.base.translation[0]! + b.skeleton.base.translation[0]!) / 2000;
    const z = -(a.skeleton.base.translation[2]! + b.skeleton.base.translation[2]!) / 2000;
    this.env.shadowDepthSpan = computeLightMatrix(this.env.directionalDir, x, 0.8, z, 4, this.renderer.shadowMapSize, this.lightMatrix);
    this.env.shadowStrength = SHADOW_STRENGTH;
    const casters: ShadowCasters = (sink) => {
      for (const fighter of casting) sink.mesh(fighter.handle, IDENTITY, fighter.material);
    };
    this.renderer.beginShadowPass(this.lightMatrix, 'dynamic');
    this.renderer.drawShadowCasters(casters);
    this.renderer.endShadowPass();
  }

  /** Where the scenery stands, in the engine's axes: at its place and the stage's height, turned by minus its yaw. */
  private sceneryMatrix(): Float32Array {
    const angle = (-this.scenery.yaw * 2 * Math.PI) / 4096;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    this.sceneryModel.set([c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, this.scenery.x / 1000, -this.scenery.y / 1000, -this.scenery.z / 1000, 1]);
    return this.sceneryModel;
  }

  /**
   * The field's picture, the fighters it posed on the stage; `behind` draws what goes in front of
   * the stage and behind the fighters, `after` what goes over the picture. With `stageAlone` only
   * the stage (the records screen's circling view): no fighters, no effects. Ogre's change draws
   * no effects, and from near its end no scenery (`only`); while True Ogre fights there is none.
   */
  render(state: FightState, aspect: number, behind?: () => void, after?: () => void, stageAlone = false, only: { effects: boolean; scenery: boolean } = { effects: true, scenery: true }): void {
    const renderer = this.renderer;
    const widening = Math.max(1, aspect / (4 / 3));
    this.adoptCamera(state, aspect);
    this.casting.length = 0;
    for (let i = 0; i < 2 && !stageAlone; i += 1) {
      if (((state.posed >> i) & 1) === 0) continue;
      const f = state.fighters[i]!;
      const fighter = this.fighterFor(i, f.costume);
      if (fighter === null) continue;
      for (let hand = 0; hand < 2; hand += 1) fighter.shape(handPart(f.roster, hand), f.hands.drawn[hand]!);
      fighter.shape(wingsPart(f.roster), f.trueOgre.wingDrawn);
      fighter.face(f.eyesShut !== 0 ? 1 : 0);
      fighter.pose(this.jointsOf(f));
      this.light(state, fighter, f);
      this.casting.push(fighter);
    }
    this.castShadows(state);
    if (!stageAlone && only.effects) this.effects.prepare(state, this.data, this.env, this.view, this.camera.position);
    else this.env.lightCount = 0;
    const sky = state.stage === SKY_STAGE && state.match.trueOgres === 0;
    const backdrop = sky ? SKY : ([0, 0, 0] as const);
    renderer.beginFrame([linear(backdrop[0]), linear(backdrop[1]), linear(backdrop[2])]);
    renderer.bindMeshPass(this.camera, this.env);
    const drawn = this.stageFor(state.stage);
    const layout = this.arena.stages[state.stage];
    if (drawn !== null && layout != null) {
      layGround(state, this.data, this.arena, layout, { widening }, this.ground);
      drawn.ground.update(this.ground);
      if (drawn.ground.mesh !== null) {
        renderer.setMaterial(drawn.ground.material);
        renderer.drawTranslucentMesh(drawn.ground.mesh, IDENTITY, 1, { lit: true, fog: false, tint: this.groundTint });
      }
      if (only.scenery && state.match.trueOgres === 0) {
        layScenery(state, this.data, this.arena, layout, { widening }, this.scenery);
        renderer.setMaterial(drawn.stage.material);
        const model = this.sceneryMatrix();
        drawn.stage.cells.forEach((cell, i) => {
          if (cell !== null && 0 < this.scenery.cells[i]!) renderer.drawTranslucentMesh(cell, model, 1, { lit: false, fog: false });
        });
        renderer.setMaterial(null);
      }
    }
    behind?.();
    for (const fighter of this.casting) {
      renderer.setMaterial(fighter.material);
      renderer.drawMesh(fighter.handle, IDENTITY);
      renderer.setMaterial(null);
    }
    if (!stageAlone && only.effects) this.effects.draw(this.camera, this.env, state.frameCount / 60);
    renderer.endFrame();
    after?.();
  }
}
