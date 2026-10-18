/**
 * The fight drawn from its state: each fighter on screen posed from its joints' world matrices,
 * its hands (and True Ogre's wings) in the shapes the game draws them in and its eyes open or
 * shut, the stage's scenery and ground laid as the game lays them, the fighters' shadows on the
 * floor, a heavy blow's flash as a glow on each fighter, the sparks, dust and bursts as particles,
 * all through the game's own camera and projection, the picture widened past 4:3 to fill the
 * window. Tekken Ball's beach has no scenery: its panorama and sky behind, the court's lines on
 * the sand, and the ball. Tekken Force's stages have none either: their backdrop far behind, three
 * fighters (each enemy's soldiers and the boss loaded ahead, as they change mid-stage), and the
 * +LIFE items.
 */
import { Camera, computeLightMatrix, createEnvironment, type RendererApi, type ShadowCasters, type SurfaceTextureHandle } from '@driftengine/core';
import type { ArenaTables } from '../../assets/arena.ts';
import { handPart, wingsPart } from '../../sim/fight/hands.ts';
import type { FightData, FightState, Fighter as FighterState } from '../../sim/fight/state.ts';
import { WALL_REACH, wallsOn } from '../../sim/fight/walls.ts';
import { Fighter, readFighterMesh, type JointTransform } from './fighter/fighter.ts';
import { HEAD as HEAD_JOINT, HeadEase } from './fighter/head-ease.ts';
import { hungFromHips } from '../../sim/fight/match.ts';
import { Ground } from './stage/ground.ts';
import { floorLookOf, floorTint, type RedrawnFloor } from './stage/floor-look.ts';
import { Grass, type Caster } from './stage/grass.ts';
import { Puddles } from './stage/puddles.ts';
import { lookOfStage, pixelsOf } from './stage/looks.ts';
import { Backdrop, type Ridge } from './stage/backdrop.ts';
import { createStage, stageAtlasSize, type Stage } from './stage/stage.ts';
import { ACCESSORIES, cameraInWalls, fadeScenery, FEET, GROUND_TILE, layGround, layScenery, liftOnto, newGround, newHeldScenery, newScenery, newSceneryFade } from './layout.ts';
import { Effects } from './effects/effects.ts';
import { BallView } from './ball.ts';
import { Beach, BEACH_STAGE, beachClear } from './stage/beach.ts';
import { FORCE_STAGES, ForceBackdrop } from './stage/force-backdrop.ts';
import { ArcadeBackground } from './stage/arcade-background.ts';
import { placeParts } from './stage/pieces.ts';
import { freeView } from './free-view.ts';
import { mirror } from '../2d/mirror.ts';
import { otherSideCamera, otherSideView, type DrawnCamera } from './other-side.ts';
import type { ArcadePanorama, PieceMotion } from '../../assets/manifest.ts';
import { ForceItems } from './effects/force-items.ts';
import { stageCodes } from '../../sim/fight/force-stage.ts';

/**
 * Where the presentation finds a model pack's and a stage's drawing files; whether the textures
 * are the enlarged ones, drawn smoothly (filtered, with mipmaps), or the originals, each texel sharp.
 */
export interface DrawingFiles {
  fighter(pack: number): Promise<{ mesh: ArrayBuffer; texture: ImageBitmap; maps?: MaterialMaps | null }>;
  /**
   * A stage's scenery, ground and atlas, and Tekken Ball's beach's panorama or a Tekken Force
   * stage's backdrop with them; and the arcade's scenery and its atlas, drawn in place of the
   * disc's, when the arcade has the stage and it is wanted.
   */
  stage(stage: number): Promise<{ mesh: ArrayBuffer; ground: ArrayBuffer; texture: ImageBitmap; maps?: MaterialMaps | null; backdrop?: ImageBitmap; arcade?: ArcadeStageFiles; floor?: FloorFiles; sky?: SkyFiles }>;
  /** One of the original pictures by name (Tekken Force's item and its shadow). */
  picture?(name: string): Promise<ImageBitmap>;
  readonly smooth: boolean;
  /** Whether a board's model's cloth is kept clear of the legs (its garment and the accessories it hangs from the hips). */
  readonly cloth: boolean;
  /** Whether the fight is remastered: drawn with the engine's lighting, the stage's own sky and light, and the assets made on this machine. */
  readonly remaster?: boolean;
  /** Remastered, whether the floors fade into the dark as the game's do (the default), or are lit evenly. */
  readonly floorFade?: boolean;
  /** Remastered, whether a sunk floor's tiles are cut finely, for the picture at its best (the default), or coarsely. */
  readonly fineRelief?: boolean;
}

/** An atlas's normal and ORM maps, and its heights, made on this machine for the remaster. */
export interface MaterialMaps {
  readonly normal: ImageBitmap | null;
  readonly orm: ImageBitmap | null;
  readonly height?: ImageBitmap | null;
}

/** A stage's sky made for the remaster, and its panorama's ridge. */
export interface SkyFiles {
  readonly picture: ImageBitmap;
  /** The clouds over it, their colour and how much they cover, drawn turning with the wind. */
  readonly clouds: ImageBitmap | null;
  readonly ridge: Ridge | null;
}

/** A floor redrawn for the remaster: its atlas, its maps and where the ground's regions went. */
export type FloorFiles = RedrawnFloor;

/** An arcade stage's background: its picture (its panorama's tiles over a few white rows) and how the stage lays it out. */
export interface ArcadePanoramaFiles {
  readonly picture: ImageBitmap;
  readonly layout: ArcadePanorama;
}

/** An arcade stage's scenery and atlas, its panorama where it has one, and its moving pieces (each a mesh and atlas, where its middle stands, how fast it turns). */
export interface ArcadeStageFiles {
  readonly mesh: ArrayBuffer;
  readonly texture: ImageBitmap;
  readonly maps?: MaterialMaps | null;
  readonly panorama?: ArcadePanoramaFiles;
  readonly objects?: readonly ArcadePieceFiles[];
}

/** A moving piece: its mesh (a cell a part, or a frame) and atlas, how it moves, its frames and the fields each shows. */
export interface ArcadePieceFiles extends PieceMotion {
  readonly mesh: ArrayBuffer;
  readonly texture: ImageBitmap;
  readonly frames: number;
  readonly fields: number;
}

/** A stage as drawn: its scenery and ground, Tekken Ball's beach, a Tekken Force backdrop, an arcade stage's background and moving pieces. */
interface StageDrawing {
  readonly stage: Stage;
  readonly ground: Ground;
  readonly beach: Beach | null;
  readonly force: ForceBackdrop | null;
  readonly background: ArcadeBackground | null;
  readonly objects: readonly { readonly stage: Stage; readonly motion: ArcadePieceFiles; readonly placed: Float32Array[] }[];
  readonly grass: Grass | null;
  readonly puddles: Puddles | null;
  readonly sky: Backdrop | null;
}

/** Remastered, how bright the lit scenery is against its own colours where the sun misses it, and how much brighter where it falls full on it. */
const SHADE = 0.78;
const SUNLIT = 0.75;

/**
 * An arcade stage's scenery grid; how far the fighters' midpoint (mm) and the scenery's turn
 * (4096ths) go before the scenery is moved, an arcade stage's and the disc's, which stands nearer.
 */
const ARCADE_GRID = 16;
/** Every scenery cell drawn whole, as the reflection probe sees the stage. */
const ALL_SHOWN = new Float32Array(256).fill(1);
const HELD = { arcade: { radius: 3000, slack: 0x155 }, disc: { radius: 1500, slack: 0xaa } } as const;
/** How much larger a stage is drawn where the remake's walls stand: as puts its own nearest walls (`reach`, metres) on them, from 1 to `WALL_SCALE` times; as it is where none stands near. */
const WALL_SCALE = 1.5;
/** How far inside the walls the camera is kept, and the nearest it comes to the fighters doing so, across (mm). */
const CAMERA_INSIDE = 300;
const CAMERA_NEAREST = 2500;
export const wallScale = (reach: number | null): number => (reach === null ? 1 : Math.min(WALL_SCALE, Math.max(1, WALL_REACH / 1000 / reach)));

/** The arcade stages whose floor ends at their own edge (the helipad's, a square this far from its middle, model units), where the fight's floor is cut off. */
const EDGED = new Map([[11, 1068]]);
/**
 * The arcade stages whose floor covers what of their scenery lies below it, as a solid floor does:
 * stage 4's, under which lie the lower terrace past its balcony and the stairs down to it, which
 * otherwise show over the courtyard's floor as the camera turns toward them.
 */
const COVERED = new Set([4]);
/** How much deeper than the scenery's own floors, and than they sink where remastered, the cover lies (metres). */
const COVER_MARGIN = 0.01;
/**
 * The arcade stages with a ceiling over the fight (the dojo's, 4.4 m up, its beams from 3.2 m), and
 * the height (metres over their floors) what lies wholly above is their ceiling from: kept over the
 * camera where the cells nearest it are left out, while the camera is under it, so the ceiling runs
 * on over a camera drawn back past the near wall rather than end before it.
 */
const CEILINGS = new Map([[8, 3]]);

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
/** How much nearer the fighters' depth lies than the fighters (a share of their distance from the eye): a few centimetres at the fight's distances. */
const FIGHTER_DEPTH = 0.01;
/** A camera's pitch and yaw as the game counts them (4096ths), from where it looks in the engine's axes: the fight's, a replay's or the free camera's. */
const lookOf = (camera: Camera): { pitch: number; yaw: number } => {
  const [x, y, z] = camera.forward as [number, number, number];
  const turn = 4096 / (2 * Math.PI);
  return { pitch: Math.round(Math.asin(Math.max(-1, Math.min(1, -y))) * turn) & 0xfff, yaw: Math.round(Math.atan2(-x, -z) * turn) & 0xfff };
};
/** The picture's half-height in the game's pixels, which its projection distance is against. */
const HALF_HEIGHT = 240;
/** Stage 11's sky behind its clouds, unless True Ogre plays there (8-bit sRGB). */
const SKY = [0x48, 0x68, 200] as const;
const SKY_STAGE = 0xb;
const TEKKEN_BALL = 7;
const TEKKEN_FORCE = 8;
/** Tekken Force's final stage, past its four. */
const FINAL_STAGE = 4;
const FLASH_FRAMES = 0x30;
/** Practice's mode, and how strongly its colour lights a fighter. */
const PRACTICE = 5;
const TINT = 0.9;
const SHADOW_STRENGTH = 1;
/**
 * How far a fighter's shadow caster is pushed away from the light: `OFFSET` metres, and `SHEAR`
 * more per metre of height above the floor. Along the light, so each point's shadow falls on the
 * floor where it did, only deeper: a low-polygon body no longer shades its own facets in hard
 * patches where they turn from the light, while a limb or a chin well in front of the body still
 * shades it. Small enough that a point a few centimetres up still shades the floor.
 */
const OFFSET = 0.05;
const SHEAR = 0.03;
/** How far the reflection probe's camera sees (the engine's 200 metres, less a margin): its sky is drawn within it. */
const PROBE_SIGHT = 180;
/** Remastered, the stage each renderer's reflection probe holds: one probe a renderer, whichever view baked it. */
const PROBE_HOLDS = new WeakMap<RendererApi, number>();
/** Remastered, the frames a stage is drawn before its probe is baked; and the air between the arena and a sky's far world. */
const PROBE_WAIT = 4;
const HAZE = { density: 0.00017, falloff: 0.0006, baseY: -40 } as const;
/** How far around the fighters the shadow map reaches (metres): a wider square, softer edges. */
const SHADOW_RADIUS = 4;

const linear = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

/**
 * The eye of a view matrix (column-major) whose rows may be scaled apart, as the game's stretches
 * the picture's height, into `out`. The engine reads it as though they were not, which puts the eye
 * of the fight's view metres too high, and the light then takes a surface turned a little from that
 * eye for the back of a two-sided one, shading it as though it faced the other way.
 */
export function eyeOf(view: ArrayLike<number>, out: { [index: number]: number }): void {
  const scale = [0, 1, 2].map((i) => Math.hypot(view[i]!, view[4 + i]!, view[8 + i]!) || 1);
  for (let j = 0; j < 3; j += 1) {
    let sum = 0;
    for (let i = 0; i < 3; i += 1) sum += (view[j * 4 + i]! / scale[i]!) * (view[12 + i]! / scale[i]!);
    out[j] = -sum;
  }
}

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
  /** Per side, its models by pack: the one it shows, and in Tekken Force those it may change to. */
  private readonly sides: Map<number, { fighter: Fighter | null }>[] = [new Map(), new Map(), new Map()];
  private readonly stages = new Map<number, StageDrawing | null>();
  /** Tekken Ball's ball, made for the first match that has one. */
  private ball: BallView | null = null;
  /** Tekken Force's items, made once their pictures are loaded for the first match that has them. */
  private items: ForceItems | null | undefined;
  private readonly ground = newGround();
  private readonly scenery = newScenery();
  private readonly sceneryFade = newSceneryFade();
  /** The scenery, held still on the floor while the fighters move a little way: an arcade stage's, and the disc's. */
  private readonly heldArcade = newHeldScenery(HELD.arcade.radius, HELD.arcade.slack);
  private readonly heldDisc = newHeldScenery(HELD.disc.radius, HELD.disc.slack);
  private readonly sceneryModel = new Float32Array(16);
  /** How much larger the scenery is drawn: 1, but where the remake's walls stand (`wallScale`). */
  private sceneryScale = 1;
  /** The camera as drawn this frame, where it is not the game's: an online fight seen from the other side. */
  private drawnCamera: DrawnCamera | null = null;
  private readonly fighterModel = new Float32Array(16);
  private readonly casting: Fighter[] = [];
  /** Per side, its head's easing (`head-ease.ts`). */
  private readonly heads: HeadEase[] = [];
  /** Per fighter cast, how far it is lifted onto the floor (metres), and its shadow's model. */
  private readonly lifts: number[] = [];
  private readonly low = { body: 0, feet: 0 };
  private readonly casterModels: Float32Array[] = [];
  private readonly effects: Effects;
  /** Remastered, where the camera stood and looked last frame, to tell a cut from a move. */
  private readonly lastEye = new Float64Array(3);
  private readonly lastForward = new Float64Array(3);
  private seen = false;
  /** Remastered, the frames drawn of a stage the probe does not hold yet. */
  private probeWait = 0;
  /** The fighters' packs and stage `prepare` found ready, and those it waits on the compiles of. */
  private prepared = '';
  private preparing = '';
  /** The stage whose every scenery draw was made once (`warmScenery`), and the matrix that draws a piece to a point. */
  private warmedStage: StageDrawing | null = null;
  private readonly toPoint = new Float32Array(16);

  constructor(renderer: RendererApi, data: FightData, arena: ArenaTables, files: DrawingFiles) {
    this.renderer = renderer;
    this.data = data;
    this.arena = arena;
    this.files = files;
    this.camera.near = 0.05;
    this.camera.far = 400;
    this.env.lightViewProj = this.lightMatrix;
    this.env.shadowStrength = 0;
    if (files.remaster === true) {
      /* The sky's light a little bluer, as bright as the game's; the far world (sky, sea, mountains) in sight. */
      ([0.13, 0.145, 0.17] as const).forEach((v, k) => (this.env.ambient[k] = v));
      this.camera.far = 9000;
    }
    const up = Math.max(0, this.env.directionalDir[1]!);
    this.groundTint = [0, 1, 2].map((c) => 1 / (this.env.ambient[c]! + this.env.directionalColor[c]! * up)) as [number, number, number];
    this.white = renderer.createSurfaceTexture(new ImageData(new Uint8ClampedArray([255, 255, 255, 255]), 1, 1), { colorSpace: 'linear', filter: 'nearest', mipmap: false, wrap: 'clamp' });
    this.effects = new Effects(renderer);
  }

  /**
   * A side's fighter for its model pack, loaded the first time it is asked for (null until then);
   * the side's other models are let go but those in `kept` (the packs it may change to).
   */
  private fighterFor(side: number, pack: number, kept: readonly number[] = []): Fighter | null {
    if (pack < 0) return null;
    const models = this.sides[side]!;
    for (const [other, entry] of models) {
      if (other === pack || kept.includes(other)) continue;
      entry.fighter?.dispose();
      models.delete(other);
    }
    const found = models.get(pack);
    if (found !== undefined) return found.fighter;
    const next: { fighter: Fighter | null } = { fighter: null };
    models.set(pack, next);
    void this.files.fighter(pack).then(({ mesh, texture, maps }) => {
      const handle = this.renderer.createSurfaceTexture(texture, this.textureOptions(false));
      const look = this.files.remaster === true ? this.mapTextures(maps ?? null) : null;
      /* The accessories a model hangs from the hips are kept clear of the legs, as a board's model's garment is: a board's model's own, and the console's (the attract intros' among them). */
      const tails = this.files.cloth ? hungFromHips(this.data, pack) : null;
      const fighter = new Fighter(this.renderer, readFighterMesh(mesh), handle, this.white, tails, look);
      if (models.get(pack) === next) next.fighter = fighter;
      else fighter.dispose();
    });
    return null;
  }

  /** The sides a fight draws: three in Tekken Force (the third not on its final stage), else two. */
  private sidesOf(state: FightState): number {
    if (state.mode !== TEKKEN_FORCE) return 2;
    return state.force.stage < FINAL_STAGE ? 3 : 2;
  }

  /** The packs a side may change to mid-stage: in Tekken Force each enemy's soldiers and the boss, none for the player or elsewhere. */
  private packsAhead(state: FightState, side: number): number[] {
    if (state.mode !== TEKKEN_FORCE || side === 0) return [];
    const codes = stageCodes(this.data, state.fighters[0]!.rosterCode, state.force.stage);
    return codes.map((code) => this.data.roster.codes[code]?.pack ?? -1).filter((pack) => pack >= 0);
  }

  /**
   * How a fighter's or a stage's texture is sampled: smoothly from the enlarged atlas, or each
   * original texel sharp. A stage has no mipmaps: its backdrop is seen far off, where the smaller
   * levels would blend its regions across their gutters into seams. `remastered`: whether it is the
   * atlas the remaster made (with its maps), whose gutters are wide enough at four times for them.
   */
  private textureOptions(stage: boolean, remastered = this.files.remaster === true): { colorSpace: 'srgb'; filter: 'linear' | 'nearest'; mipmap: boolean; wrap: 'clamp'; anisotropy?: number } {
    if (remastered) return { colorSpace: 'srgb', filter: 'linear', mipmap: true, wrap: 'clamp', anisotropy: 16 };
    return this.files.smooth ? { colorSpace: 'srgb', filter: 'linear', mipmap: !stage, wrap: 'clamp' } : { colorSpace: 'srgb', filter: 'nearest', mipmap: false, wrap: 'clamp' };
  }

  /** An atlas's maps on the device, sampled as data. */
  private mapTextures(maps: MaterialMaps | null): { normal: SurfaceTextureHandle | null; orm: SurfaceTextureHandle | null } {
    const options = { colorSpace: 'linear', filter: 'linear', mipmap: true, wrap: 'clamp' } as const;
    return { normal: maps?.normal == null ? null : this.renderer.createSurfaceTexture(maps.normal, options), orm: maps?.orm == null ? null : this.renderer.createSurfaceTexture(maps.orm, options) };
  }

  /** The stage's scenery and ground, loaded the first time it is asked for (null until then). */
  private stageFor(id: number): StageDrawing | null {
    if (!this.stages.has(id)) {
      this.stages.set(id, null);
      void this.files.stage(id).then(({ mesh, ground, texture, maps: ownMaps, backdrop, arcade, floor, sky }) => {
        const remaster = this.files.remaster === true;
        const handle = this.renderer.createSurfaceTexture(texture, this.textureOptions(true, remaster && ownMaps != null));
        /* The ground's cells are in the disc's atlas, whichever scenery is drawn. */
        const atlas = stageAtlasSize(mesh);
        const stageLook = lookOfStage(id);
        /* The scenery's maps: the arcade board's where its scenery is drawn, the disc's otherwise. */
        const sceneryMaps = (arcade === undefined ? ownMaps : arcade.maps) ?? null;
        const heights = remaster && stageLook.relief > 0 && sceneryMaps?.height != null ? pixelsOf(sceneryMaps.height) : null;
        const look = remaster ? { light: { dir: stageLook.sun, sun: stageLook.sunColour, sky: stageLook.ambient, ground: stageLook.ambientGround, shade: SHADE, sunlit: SUNLIT }, ...this.mapTextures(sceneryMaps), height: heights, relief: stageLook.relief, ragged: stageLook.ragged === true } : null;
        const stage = arcade === undefined ? createStage(this.renderer, mesh, handle, look) : createStage(this.renderer, arcade.mesh, this.renderer.createSurfaceTexture(arcade.texture, this.textureOptions(true, remaster && arcade.maps != null)), look, remaster, CEILINGS.get(id) ?? null);
        const floorLook = remaster ? floorLookOf(this.renderer, texture, atlas, floor, stageLook, this.files.fineRelief !== false) : null;
        const tint = remaster ? floorTint(stageLook) : this.groundTint;
        const laid = new Ground(this.renderer, ground, atlas.width, atlas.height, handle, tint, floorLook);
        let grass: Grass | null = null;
        if (remaster) {
          const canvas = new OffscreenCanvas(texture.width, texture.height);
          const context = canvas.getContext('2d')!;
          context.drawImage(texture, 0, 0);
          grass = new Grass(this.renderer, context.getImageData(0, 0, texture.width, texture.height), laid.sourceUvs);
        }
        const force = backdrop !== undefined && FORCE_STAGES.first <= id && id <= FORCE_STAGES.last;
        const beach = backdrop === undefined || force ? null : new Beach(this.renderer, backdrop, this.white);
        const forceBackdrop = force ? new ForceBackdrop(this.renderer, backdrop, this.white) : null;
        const background = arcade?.panorama === undefined ? null : new ArcadeBackground(this.renderer, arcade.panorama, remaster);
        const objects = (arcade?.objects ?? []).map((o) => ({ stage: createStage(this.renderer, o.mesh, this.renderer.createSurfaceTexture(o.texture, this.textureOptions(true, remaster && arcade?.maps != null))), motion: o, placed: [] }));
        const built = sky === undefined ? null : new Backdrop(this.renderer, sky.picture, sky.clouds, sky.ridge, stageLook.ownMountains === true ? null : (arcade?.panorama ?? null), this.white, id, stageLook);
        const puddles = remaster && stageLook.puddles !== undefined ? new Puddles(this.renderer, stageLook.puddles, id) : null;
        this.stages.set(id, { stage, ground: laid, beach, force: forceBackdrop, background, objects, grass, puddles, sky: built });
      });
    }
    return this.stages.get(id) ?? null;
  }

  /** Tekken Force's items, their pictures loaded the first time they are asked for (null until then, or with no pictures to load). */
  private itemsFor(): ForceItems | null {
    if (this.items === undefined) {
      this.items = null;
      const picture = this.files.picture?.bind(this.files);
      if (picture !== undefined) {
        void Promise.all([picture('force-item'), picture('force-glow')]).then(([item, glow]) => {
          const options = { colorSpace: 'srgb', filter: 'linear', mipmap: false, wrap: 'clamp' } as const;
          this.items = new ForceItems(this.renderer, this.renderer.createSurfaceTexture(item, options), this.renderer.createSurfaceTexture(glow, options));
        });
      }
    }
    return this.items;
  }

  /**
   * Whether the drawing of `state` is ready, what it lacks asked for now: its two fighters' models
   * (none with `stageAlone`, as the records draw it) and its stage loaded, and every pipeline their
   * draws take compiled off the frame: the fighters', the scenery's, its moving pieces' and the
   * floor's. A fight's models are otherwise asked for by its first frame, which then draws it
   * without them, and the frames after wait on their pipelines, so a piece would show late.
   */
  prepare(state: FightState, stageAlone = false): boolean {
    const sides = stageAlone ? [] : Array.from({ length: this.sidesOf(state) }, (_, i) => ({ pack: state.fighters[i]!.costume, ahead: this.packsAhead(state, i) }));
    const key = `${stageAlone ? 'alone' : sides.map((side) => [side.pack, ...side.ahead].join(',')).join(' ')} ${state.stage}`;
    const fighters = sides.flatMap(({ pack, ahead }, i) => [pack, ...ahead].map((p) => this.fighterFor(i, p, [pack, ...ahead])));
    const drawn = this.stageFor(state.stage);
    if (state.mode === TEKKEN_FORCE && !stageAlone) this.itemsFor();
    if (drawn === null || fighters.includes(null)) return false;
    if (this.prepared === key) return true;
    if (this.preparing === key) return false;
    this.preparing = key;
    for (const fighter of fighters) this.renderer.prepareMesh(fighter!.handle, fighter!.material);
    for (const cell of drawn.stage.cells) for (const piece of cell) this.renderer.prepareMesh(piece.mesh, piece.oneSided ? drawn.stage.oneSidedMaterial : drawn.stage.material, { translucent: true });
    for (const object of drawn.objects) for (const cell of object.stage.cells) for (const piece of cell) this.renderer.prepareMesh(piece.mesh, object.stage.material, { translucent: true });
    /* A sunk floor's grids made, and their pipelines compiled, before the fight shows. */
    drawn.ground.prepare(state.mode === TEKKEN_FORCE ? undefined : GROUND_TILE, drawn.stage.grid === ARCADE_GRID);
    if (drawn.puddles !== null) this.renderer.prepareMesh(drawn.puddles.mesh, drawn.puddles.material);
    void this.renderer.ready().then(() => {
      if (this.preparing === key) this.prepared = key;
    });
    return false;
  }

  /** A fighter's joints from its hung parts: each world rotation (4.12) and position (mm). */
  /** The joints that hang from the head, however far down. */
  private belowHead(f: FighterState): number[] {
    const joints = f.skeleton.joints;
    const below: number[] = [];
    joints.forEach((_, j) => {
      for (let p = joints[j]!.parent; p !== null && p >= 0; p = joints[p]!.parent) {
        if (p !== HEAD_JOINT) continue;
        below.push(j);
        break;
      }
    });
    return below;
  }

  private jointsOf(f: FighterState): (JointTransform | undefined)[] {
    const joints: (JointTransform | undefined)[] = [];
    f.parts.forEach((part, i) => {
      if (part.hung === 0) return;
      /* The parts past the game's table are a model's own accessories, each its own joint. */
      const j = this.data.skeleton.partJoints[i] ?? i;
      const world = f.skeleton.joints[j]!.world;
      joints[j] = { r: Float64Array.from(world.rotation, (v) => v / 4096), t: Float64Array.from(world.translation) };
    });
    return joints;
  }

  /**
   * Every scenery piece drawn once in each way it is ever drawn (whole and fading, at its depth
   * layer), through a matrix that collapses it to a point before the camera: nothing shows, but the
   * pipeline each needs is built now, where `prepare` builds only the whole draw's at the first
   * layer and the first fade, cut or cell of another layer built the rest as it came, a frame or
   * more each (the attract intro played slower than its song over its first seconds).
   */
  private warmScenery(drawn: StageDrawing): void {
    if (this.warmedStage === drawn) return;
    this.warmedStage = drawn;
    const renderer = this.renderer;
    const point = this.toPoint;
    point.fill(0);
    const ahead = 2;
    for (let i = 0; i < 3; i += 1) point[12 + i] = this.camera.position[i]! - this.view[i * 4 + 2]! * ahead;
    point[15] = 1;
    for (const oneSided of [false, true]) {
      renderer.setMaterial(oneSided ? drawn.stage.oneSidedMaterial : drawn.stage.material);
      for (const cell of drawn.stage.cells) {
        for (const piece of cell) {
          if (piece.oneSided !== oneSided) continue;
          const lit = drawn.stage.lit && piece.far !== true;
          for (const depthWrite of [true, false]) for (const opacity of [1, 0.5]) renderer.drawTranslucentMesh(piece.mesh, point, opacity, { lit, fog: false, depthLayer: piece.layer, reconstructed: true, depthWrite });
        }
      }
    }
    for (const object of drawn.objects) {
      renderer.setMaterial(object.stage.material);
      for (const cell of object.stage.cells) for (const piece of cell) renderer.drawTranslucentMesh(piece.mesh, point, 1, { lit: false, fog: false, depthLayer: piece.layer, reconstructed: true });
    }
    renderer.setMaterial(null);
  }

  /**
   * The scenery's cells the game keeps (each as much as `shown` says) and its moving pieces (each
   * part where `placeParts` set it, or a flipbook's frame): the solid polygons, or those cut out of
   * their textures. The cells drawn whole, with the moving pieces; or, `fading`, those partly drawn,
   * writing no depth, so what lies behind a cell fading out shows through it. Where the frame is
   * reconstructed, drawn into it, its edges resolved with the rest of the picture's (drawn after it,
   * they would be stepped, and lit at the fighters' outlines).
   */
  private drawScenery(state: FightState, drawn: StageDrawing, cut: boolean, shown: Float32Array, fading = false): void {
    const renderer = this.renderer;
    const model = this.sceneryMatrix();
    /* A ceiling drawn whole over the cells left out round the camera while the camera is under it (the eye's height over the scenery's floors). */
    const ceiling = drawn.stage.ceiling;
    const overhead = ceiling !== null && (this.scenery.y - (this.drawnCamera ?? state.camera.drawn).eye[1]!) / 1000 < ceiling * this.sceneryScale;
    for (const oneSided of [false, true]) {
      renderer.setMaterial(oneSided ? drawn.stage.oneSidedMaterial : drawn.stage.material);
      drawn.stage.cells.forEach((cell, i) => {
        const opacity = shown[i]!;
        /* The sky over the stage a picture, unlit as the game draws it. */
        for (const piece of cell) {
          if (piece.oneSided !== oneSided || piece.cut !== cut) continue;
          const whole = opacity === 1 || (overhead && piece.overhead === true);
          if (fading ? whole || !(0 < opacity && opacity < 1) : !whole) continue;
          renderer.drawTranslucentMesh(piece.mesh, model, fading ? opacity : 1, { lit: drawn.stage.lit && piece.far !== true, fog: false, depthLayer: piece.layer, reconstructed: true, depthWrite: !fading });
        }
      });
    }
    renderer.setMaterial(null);
    if (fading) return;
    for (const object of drawn.objects) {
      const motion = object.motion;
      const cells = motion.frames > 1 ? [[Math.floor(state.frameCount / motion.fields) % motion.frames, 0]] : motion.parts.map((_, i) => [i, i]);
      /* Drawn from both sides: a piece is closed, and its own polygons face as the game's moving pieces do, not as its scenery's. */
      renderer.setMaterial(object.stage.material);
      for (const [cell, part] of cells) {
        for (const piece of object.stage.cells[cell!] ?? []) if (piece.cut === cut) renderer.drawTranslucentMesh(piece.mesh, object.placed[part!]!, 1, { lit: false, fog: false, depthLayer: piece.layer, reconstructed: true });
      }
    }
    renderer.setMaterial(null);
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
    eyeOf(this.view, this.camera.position);
  }

  /**
   * An online fight seen from this player's side where the game puts it on the other: the camera
   * across the fighters' line (`other-side.ts`), the game's camera as the layout reads it with it.
   */
  private lookFromOtherSide(state: FightState): DrawnCamera {
    const [a, b] = [state.fighters[0]!.skeleton.base.translation, state.fighters[1]!.skeleton.base.translation];
    otherSideView(this.view, a, b);
    this.camera.adoptView(this.view, this.camera.projection);
    eyeOf(this.view, this.camera.position);
    return otherSideCamera(state.camera.drawn, a, b);
  }

  /**
   * Where the remake's walls stand, the camera drawn kept inside them (`cameraInWalls`): one the
   * game puts past a wall, as it does with the fighters along it, moved along its line to them, its
   * view's turn kept, but never nearer them than `CAMERA_NEAREST` (past the wall then, the scenery
   * hides what stands between); where it stands, the game's millimetres.
   */
  private keepCameraInWalls(state: FightState): [number, number, number] {
    const p = this.camera.position;
    const eye: [number, number, number] = [p[0]! * 1000, -p[1]! * 1000, -p[2]! * 1000];
    const [a, b] = state.fighters;
    const roots = [a.skeleton.base.translation, b.skeleton.base.translation];
    const kept = cameraInWalls(eye, [(roots[0]![0]! + roots[1]![0]!) / 2, (roots[0]![2]! + roots[1]![2]!) / 2], WALL_REACH - CAMERA_INSIDE, CAMERA_NEAREST);
    if (kept[0] === eye[0] && kept[2] === eye[2]) return eye;
    const e = [kept[0] / 1000, -kept[1] / 1000, -kept[2] / 1000];
    for (let i = 0; i < 3; i += 1) this.view[12 + i] = -(this.view[i]! * e[0]! + this.view[4 + i]! * e[1]! + this.view[8 + i]! * e[2]!);
    this.camera.adoptView(this.view, this.camera.projection);
    eyeOf(this.view, this.camera.position);
    return kept;
  }

  /** The flash's glow on a fighter: its colour at the strength left, by how much of the blow's side the camera sees. */
  private light(state: FightState, fighter: Fighter, f: FighterState): void {
    /* Practice's HIT ANALYSIS colours a fighter wholly in place of its light. */
    const tint = state.mode === PRACTICE ? state.practice.colours[f.movesetSlot] : undefined;
    if (tint !== undefined && tint[0] !== 0) {
      fighter.light((tint[1]! / 0xff) * TINT, (tint[2]! / 0xff) * TINT, (tint[3]! / 0xff) * TINT);
      return;
    }
    const flash = state.flash;
    const strength = 0 < flash.left ? flash.left / FLASH_FRAMES / 0x1000 : 0;
    if (strength === 0) {
      fighter.light(0, 0, 0);
      return;
    }
    const root = f.skeleton.base.translation;
    const eye = (this.drawnCamera ?? state.camera.drawn).eye;
    const [bx, by, bz] = [0, 1, 2].map((i) => flash.at[i]! - root[i]!);
    const [cx, cy, cz] = [0, 1, 2].map((i) => eye[i]! - root[i]!);
    const cos = (bx! * cx! + by! * cy! + bz! * cz!) / (Math.hypot(bx!, by!, bz!) * Math.hypot(cx!, cy!, cz!) || 1);
    const facing = (1 + cos) / 3;
    const glow = (c: number): number => (1 + flash.colour[c]! * strength * facing) ** 2.2 - 1;
    fighter.light(glow(0), glow(1), glow(2));
  }

  /**
   * Remastered, a new shot where the camera jumped since the last frame (more than a metre, or
   * turned more than 20 degrees), so a temporal resolve does not blend the last shot into it.
   */
  private cutIfJumped(): void {
    const eye = this.camera.position as unknown as ArrayLike<number>;
    const forward = this.camera.forward as unknown as ArrayLike<number>;
    const moved = Math.hypot(eye[0]! - this.lastEye[0]!, eye[1]! - this.lastEye[1]!, eye[2]! - this.lastEye[2]!);
    const turned = forward[0]! * this.lastForward[0]! + forward[1]! * this.lastForward[1]! + forward[2]! * this.lastForward[2]!;
    if (this.seen && (moved > 1 || turned < Math.cos((20 * Math.PI) / 180))) this.renderer.cameraCut();
    this.seen = true;
    for (let k = 0; k < 3; k += 1) {
      this.lastEye[k] = eye[k]!;
      this.lastForward[k] = forward[k]!;
    }
  }

  /**
   * Remastered, the stage seen from the middle of the fight, a metre up, into the reflection probe a
   * wet floor or its puddles mirror: its sky, mountains, scenery (all of it, not what the game's camera keeps) and
   * floor; a few frames after the stage is laid, and again whenever the probe holds another stage.
   */
  private bakeProbe(state: FightState): void {
    const drawn = this.stages.get(state.stage);
    const look = lookOfStage(state.stage);
    if (drawn == null || PROBE_HOLDS.get(this.renderer) === state.stage || (look.floor.reflectivity === 0 && look.puddles === undefined)) {
      this.probeWait = 0;
      return;
    }
    this.probeWait += 1;
    if (this.probeWait < PROBE_WAIT) return;
    this.probeWait = 0;
    PROBE_HOLDS.set(this.renderer, state.stage);
    const f = state.fighters.slice(0, 2);
    const x = f.reduce((sum, g) => sum + g.skeleton.base.translation[0]!, 0) / f.length / 1000;
    const z = -f.reduce((sum, g) => sum + g.skeleton.base.translation[2]!, 0) / f.length / 1000;
    const renderer = this.renderer;
    renderer.bakeReflectionProbe([x, 1, z], [0, 0, 0], (camera) => {
      renderer.bindMeshPass(camera, this.env);
      drawn.sky?.draw(camera, state.frameCount / 60, lookOfStage(state.stage).wind, this.scenery.yaw, PROBE_SIGHT);
      this.drawScenery(state, drawn, false, ALL_SHOWN);
      renderer.setMaterial(drawn.ground.material);
      if (drawn.ground.mesh !== null) renderer.drawMesh(drawn.ground.mesh, IDENTITY);
      drawn.ground.drawRelief();
      renderer.setMaterial(null);
      this.drawScenery(state, drawn, true, ALL_SHOWN);
    }, { irradiance: false });
  }

  /** The fighters' shadow map this field, around their midpoint (in Tekken Force the midpoint of those drawn). */
  private castShadows(state: FightState, drawn: readonly FighterState[]): void {
    const casting = this.casting;
    if (casting.length === 0) {
      this.env.shadowStrength = 0;
      return;
    }
    const around = state.mode === TEKKEN_FORCE ? drawn : state.fighters.slice(0, 2);
    const x = around.reduce((sum, f) => sum + f.skeleton.base.translation[0]!, 0) / around.length / 1000;
    const z = -around.reduce((sum, f) => sum + f.skeleton.base.translation[2]!, 0) / around.length / 1000;
    this.env.shadowDepthSpan = computeLightMatrix(this.env.directionalDir, x, 0.8, z, SHADOW_RADIUS, this.renderer.shadowMapSize, this.lightMatrix);
    this.env.shadowStrength = SHADOW_STRENGTH;
    const [dx, dy, dz] = this.env.directionalDir;
    const length = Math.hypot(dx, dy, dz);
    const [ax, ay, az] = [-dx / length, -dy / length, -dz / length];
    const casters: ShadowCasters = (sink) => {
      casting.forEach((fighter, i) => {
        /* Lifted as it is drawn, then pushed from the light (see `OFFSET`): p + away * (OFFSET + SHEAR * y). */
        const lift = this.lifts[i]!;
        const model = (this.casterModels[i] ??= IDENTITY.slice());
        model.set([ax * SHEAR, 1 + ay * SHEAR, az * SHEAR], 4);
        model.set([ax * (OFFSET + SHEAR * lift), lift + ay * (OFFSET + SHEAR * lift), az * (OFFSET + SHEAR * lift)], 12);
        sink.mesh(fighter.handle, model, fighter.material);
      });
    };
    this.renderer.beginShadowPass(this.lightMatrix, 'dynamic');
    this.renderer.drawShadowCasters(casters);
    this.renderer.endShadowPass();
  }

  /**
   * A fighter lifted onto the floor by `lift` metres, and drawn pulled toward the eye along each
   * line of sight: every point on the same pixel, a little nearer, so a sole on the floor stays in
   * sight over it, while the floor and the shadows cast on it stay where they are.
   */
  private fighterMatrix(state: FightState, lift: number): Float32Array {
    const eye = (this.drawnCamera ?? state.camera.drawn).eye;
    const k = 1 - FIGHTER_DEPTH;
    const [ex, ey, ez] = freeView.active ? freeView.eye : [eye[0]! / 1000, -eye[1]! / 1000, -eye[2]! / 1000];
    this.fighterModel.set([k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0, (1 - k) * ex, k * lift + (1 - k) * ey, (1 - k) * ez, 1]);
    return this.fighterModel;
  }

  /** Where the scenery stands, in the engine's axes: at its place and the stage's height, turned by minus its yaw. */
  private sceneryMatrix(): Float32Array {
    const angle = (-this.scenery.yaw * 2 * Math.PI) / 4096;
    const k = this.sceneryScale;
    const c = Math.cos(angle) * k;
    const s = Math.sin(angle) * k;
    this.sceneryModel.set([c, 0, s, 0, 0, k, 0, 0, -s, 0, c, 0, this.scenery.x / 1000, -this.scenery.y / 1000, -this.scenery.z / 1000, 1]);
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
    this.drawnCamera = !freeView.active && mirror.on ? this.lookFromOtherSide(state) : null;
    if (freeView.active) freeView.apply(this.camera, 0.6 * aspect);
    const eyeInWalls = !freeView.active && wallsOn(state) ? this.keepCameraInWalls(state) : null;
    if (this.files.remaster === true) this.cutIfJumped();
    this.casting.length = 0;
    const posed: FighterState[] = [];
    const sides = this.sidesOf(state);
    /* A side no longer drawn (the third, after Tekken Force) lets its models go. */
    for (let i = sides; i < this.sides.length; i += 1) {
      for (const entry of this.sides[i]!.values()) entry.fighter?.dispose();
      this.sides[i]!.clear();
    }
    for (let i = 0; i < sides && !stageAlone; i += 1) {
      const f = state.fighters[i]!;
      const ahead = this.packsAhead(state, i);
      /* Every model the side may change to is loading or loaded, whether or not it is on screen now. */
      for (const pack of ahead) this.fighterFor(i, pack, [f.costume, ...ahead]);
      const fighter = this.fighterFor(i, f.costume, ahead);
      if (((state.posed >> i) & 1) === 0 || fighter === null) continue;
      posed.push(f);
      for (let hand = 0; hand < 2; hand += 1) fighter.shape(handPart(f.roster, hand), f.hands.drawn[hand]!);
      fighter.shape(wingsPart(f.roster), f.trueOgre.wingDrawn);
      fighter.face(f.eyesShut !== 0 ? 1 : 0);
      const joints = this.jointsOf(f);
      /* The head eased where the game switches its turn toward the opponent on or off. */
      (this.heads[i] ??= new HeadEase()).apply(joints, this.belowHead(f), state.looks[f.movesetSlot]!.turned, state.frameCount);
      fighter.pose(joints);
      this.light(state, fighter, f);
      fighter.lowest(FEET, ACCESSORIES, this.low);
      this.lifts[this.casting.length] = liftOnto(this.low);
      this.casting.push(fighter);
    }
    if (this.files.remaster === true) {
      /* Remastered, the stage's own light. */
      const look = lookOfStage(state.stage);
      const l = Math.hypot(...look.sun);
      look.sun.forEach((v, k) => (this.env.directionalDir[k] = v / l));
      look.sunColour.forEach((v, k) => (this.env.directionalColor[k] = v));
      look.ambient.forEach((v, k) => (this.env.ambient[k] = v));
      look.ambientGround.forEach((v, k) => (this.env.ambientGround![k] = v));
      /* The air between the arena and a sky's far world, in its colour at the horizon; none without one. */
      const haze = this.stages.get(state.stage)?.sky?.haze;
      if (haze !== undefined) for (let k = 0; k < 3; k += 1) this.env.fogColor[k] = haze[k]!;
      this.env.fogDensity = haze === undefined ? 0 : HAZE.density;
      this.env.fogHeightFalloff = HAZE.falloff;
      this.env.fogBaseY = HAZE.baseY;
    }
    this.castShadows(state, posed);
    if (this.files.remaster === true) this.bakeProbe(state);
    if (!stageAlone && only.effects) this.effects.prepare(state, this.data, this.env, this.view, this.camera.position);
    else this.env.lightCount = 0;
    const sky = state.stage === SKY_STAGE && state.match.trueOgres === 0;
    const backdrop = sky ? SKY : ([0, 0, 0] as const);
    renderer.beginFrame(state.stage === BEACH_STAGE ? beachClear(state) : [linear(backdrop[0]), linear(backdrop[1]), linear(backdrop[2])]);
    renderer.bindMeshPass(this.camera, this.env);
    const drawn = this.stageFor(state.stage);
    const layout = this.arena.stages[state.stage];
    const scenery = drawn !== null && layout != null && only.scenery && state.match.trueOgres === 0 && layout.cellSize !== 0;
    /* Where the remake's walls stand, the stage fixed in place, drawn as large as puts its own walls on them. */
    const fixed = drawn !== null && wallsOn(state) ? { scale: wallScale(drawn.stage.reach), ...(eyeInWalls === null ? {} : { eye: eyeInWalls }) } : undefined;
    const camera = this.drawnCamera === null ? {} : { camera: this.drawnCamera };
    const view = fixed === undefined ? { widening, ...camera } : { widening, fixed, ...camera };
    this.sceneryScale = fixed?.scale ?? 1;
    if (scenery) layScenery(state, this.data, this.arena, drawn.stage, view, this.scenery, fixed !== undefined ? undefined : drawn.stage.grid === ARCADE_GRID ? this.heldArcade : this.heldDisc);
    /* The free camera sees every cell: the game's culling is its own camera's. */
    if (scenery && freeView.active) this.scenery.cells.fill(1);
    if (scenery) fadeScenery(state, this.scenery, this.sceneryFade, this.drawnCamera ?? state.camera.drawn);
    /* An arcade stage's background, behind everything drawn after it. */
    if (drawn?.sky != null && only.scenery && state.match.trueOgres === 0) drawn.sky.draw(this.camera, state.frameCount / 60, lookOfStage(state.stage).wind, this.scenery.yaw);
    else if (drawn?.background != null && only.scenery && state.match.trueOgres === 0) drawn.background.draw(lookOf(this.camera), aspect, this.scenery.yaw, sky);
    const ball = state.mode === TEKKEN_BALL && !stageAlone;
    /* Tekken Force's backdrop is the farthest thing drawn: everything after it lies over it. */
    if (drawn?.force != null && state.mode === TEKKEN_FORCE) {
      drawn.force.draw(state, this.data, aspect);
      /* Its depth where the frame is put together from the ones before, for the fight's own camera (the free camera's view is not the one it scrolls with). */
      if (this.files.remaster === true && !freeView.active) drawn.force.drawDepth(this.view, this.camera.position, state.screen.distance || 500);
    }
    if (drawn !== null && layout != null) {
      const arcade = drawn.stage.grid === ARCADE_GRID;
      layGround(state, this.data, this.arena, layout, view, this.ground, arcade, arcade && scenery ? this.scenery : null);
      const fade = this.files.floorFade !== false;
      const edge = arcade ? EDGED.get(state.stage) : undefined;
      drawn.ground.update(this.ground, edge === undefined ? null : { x: this.scenery.x, z: this.scenery.z, yaw: this.scenery.yaw, half: edge * 8 * this.sceneryScale }, fade);
      const puddles = (): void => {
        if (drawn.puddles === null) return;
        renderer.setMaterial(drawn.puddles.material);
        renderer.drawMesh(drawn.puddles.mesh, IDENTITY);
        renderer.setMaterial(null);
      };
      /*
       * An arcade stage's floor is drawn under its scenery, as the board draws its floor before its
       * stage and paints the stage over it: its colours (its veil and puddles with them) writing no
       * depth, so the stage's own floors and what lies below them show over it, then its depth alone.
       * In the attract intro, whose camera goes down to the floor, it is solid as a floor is, so
       * what lies below it (stage 4's lower terrace) stays under it rather than hang over it.
       */
      const under = arcade && state.attractIntro === 0;
      if (under) {
        drawn.ground.drawUnder();
        puddles();
        /* Under the scenery's own floors, which stand a little under the fight's and, remastered, sink by up to half the stage's relief. */
        if (scenery && COVERED.has(state.stage)) drawn.ground.drawCover(this.scenery.y / 1000 + (this.files.remaster === true ? lookOfStage(state.stage).relief / 2 : 0) + COVER_MARGIN);
      }
      if (scenery) {
        /* The stage's moving pieces: a model's parts each where the piece and the part stand this field. */
        for (const object of drawn.objects) placeParts(object.motion, state.frameCount, this.sceneryMatrix(), object.placed);
        /* Remastered, an arcade stage's own floors fade as the fight's does. */
        drawn.stage.darkenFloors(this.sceneryMatrix(), fade ? this.ground.shadeOf : null);
        this.warmScenery(drawn);
        this.drawScenery(state, drawn, false, this.sceneryFade.shown);
      }
      /*
       * The floor is solid, so the fighters' shadows and the occlusion where they stand land on it;
       * the fighters are drawn a little nearer than they stand (fighterMatrix), so a sole the pose
       * sinks into it stays in sight as the game, drawing the floor first and everything over it,
       * keeps it. A sunk floor's veil over it, under its puddles.
       */
      if (under) drawn.ground.drawDepth();
      else {
        renderer.setMaterial(drawn.ground.material);
        drawn.ground.drawRelief();
        if (drawn.ground.mesh !== null) renderer.drawMesh(drawn.ground.mesh, IDENTITY);
        renderer.setMaterial(null);
        drawn.ground.drawVeil();
        puddles();
      }
      if (drawn.grass !== null) {
        drawn.grass.plant(this.ground);
        /* The fighters press the grass where a joint of theirs is near the floor: their feet, and all of them when they are down. */
        for (const f of posed) for (const joint of f.skeleton.joints) {
          const t = joint.world.translation;
          if (-t[1]! / 1000 < 0.25) drawn.grass.press(t[0]! / 1000, -t[2]! / 1000);
        }
        /* Their bones' shadows on the floor, cast along the light, darken the grass under them. */
        const [lx, ly, lz] = this.env.directionalDir as unknown as [number, number, number];
        const casters: Caster[] = [];
        const onFloor = (t: ArrayLike<number>): [number, number] => {
          const y = Math.max(0, -t[1]! / 1000);
          return [t[0]! / 1000 - (lx * y) / Math.max(0.05, ly), -t[2]! / 1000 - (lz * y) / Math.max(0.05, ly)];
        };
        for (const f of posed) {
          for (const joint of f.skeleton.joints) {
            if (joint.parent === null || joint.parent < 0) continue;
            const parent = f.skeleton.joints[joint.parent];
            if (parent === undefined) continue;
            const [x0, z0] = onFloor(parent.world.translation);
            const [x1, z1] = onFloor(joint.world.translation);
            casters.push({ x0, z0, x1, z1, radius: 0.085 });
          }
        }
        drawn.grass.shade(casters);
        drawn.grass.draw(this.camera, this.env, state.frameCount / 60, lookOfStage(state.stage).wind);
      }
      if (drawn.beach !== null) {
        if (ball) drawn.beach.drawCourt(state, (this.data.ball.kinds[state.match.ball.kind] ?? this.data.ball.kinds[0]!).strip);
        drawn.beach.drawPanorama(state, this.data, aspect);
      }
    }
    /*
     * The cut-out scenery, over the solid scenery and the floor: its soft edges blend with what lies
     * behind it. Then the cells fading in or out, over all of it and under the fighters.
     */
    if (drawn !== null && layout != null && scenery) {
      const shown = this.sceneryFade.shown;
      this.drawScenery(state, drawn, true, shown);
      this.drawScenery(state, drawn, false, shown, true);
      this.drawScenery(state, drawn, true, shown, true);
    }
    /*
     * What goes behind the fighters (the gauges, the names, the time), as the game layers it; but
     * remastered, over the finished picture, after the frame's antialiasing over time, which would
     * blend its last positions into its text.
     */
    const remastered = this.files.remaster === true;
    if (!remastered) behind?.();
    this.casting.forEach((fighter, i) => {
      renderer.setMaterial(fighter.material);
      renderer.drawMesh(fighter.handle, this.fighterMatrix(state, this.lifts[i]!), undefined, null, fighter.mover);
      renderer.setMaterial(null);
    });
    if (ball) {
      this.ball ??= new BallView(renderer, this.data.ball, this.data.math, this.white);
      this.ball.draw(state, this.view);
    }
    if (state.mode === TEKKEN_FORCE && !stageAlone) this.itemsFor()?.draw(state);
    if (!stageAlone && only.effects) this.effects.draw(this.camera, this.env, state.frameCount / 60);
    if (ball) this.ball?.drawBeams(state, aspect);
    renderer.endFrame();
    if (remastered) behind?.();
    after?.();
  }
}
