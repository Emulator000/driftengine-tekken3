/**
 * A quick match, without the menus (`?quick`, or any of `p1`, `p2`, `stage`, `cpu`): set up as the
 * menus leave a versus match, the fight stepped from the pads and drawn from its state. `p1` and
 * `p2` are roster ids, `cpu` the sides the computer plays (`2` by default, `0` none, `1`, or `12`
 * both).
 */
import { loadFightTables, loadMoveset } from '../assets/load.ts';
import { Fight, type QuickMatch } from '../sim/fight/fight.ts';
import { fightDataFor, matchMovesets } from '../sim/fight/match.ts';
import { FightView, type ArcadeStageFiles, type DrawingFiles, type FloorFiles, type MaterialMaps, type SkyFiles } from '../present/3d/fight-view.ts';
import { parseManifest, type ArcadeObject, type ArcadePanorama } from '../assets/manifest.ts';
import { parseArcadeFighters, withOwnAccessories } from '../assets/models.ts';
import type { FightTables } from '../sim/fight/match.ts';
import { Hud } from '../present/hud/hud.ts';
import { PauseScreen } from '../present/hud/pause.ts';
import { loadTypefaces } from '../present/2d/typefaces.ts';
import { assetBytes, assetImage, crtAsked, dataBytes, floorFade, image, json, pageQuality, pageRenderer, params, play, remastered, status, two } from './page.ts';
import { CrtFilter } from './crt.ts';
import { asked, settings } from './settings.ts';
import { startSound } from './sound.ts';

/** Roster ids the remake cannot set up yet: Mokujin's draw. */
const NOT_YET = new Set([15]);
const KAZUYA = 22;
const PAUL = 0;
const LAW = 1;

/** Whether the fighters and stages are drawn with their textures enlarged and smooth, or as the console drew them (`?textures=psx`). */
const smooth = asked(params, 'textures', settings.textures, [null, 'psx']) !== 'psx';
/**
 * Whether a stage the arcade board's data has is drawn with the arcade's scenery, the default once
 * `npm run arcade` has read it, or with the disc's (`?stages=psx`).
 */
const arcadeScenery = asked(params, 'stages', settings.stages, [null, 'psx']) !== 'psx';
/** Whether a fighter the board's data has a model of is drawn with it, the default, or with the disc's (`?fighters=psx`). */
const arcadeModels = asked(params, 'fighters', settings.fighters, [null, 'psx']) !== 'psx';
/** Whether the cloth is kept clear of the legs, the default, or drawn as the original draws it (`?cloth=original`). */
const cloth = asked(params, 'cloth', settings.cloth, [null, 'original']) !== 'original';
interface ArcadeList {
  readonly stages: ReadonlySet<number>;
  readonly panoramas: readonly ArcadePanorama[];
  readonly objects: readonly ArcadeObject[];
  readonly fighters: ReadonlySet<number>;
}
let arcadeLists: Promise<ArcadeList> | null = null;
/** The stages drawn with the arcade's scenery, their panoramas and their moving pieces; the packs drawn with the board's fighters. */
const arcadeStagesOf = (): Promise<ArcadeList> =>
  (arcadeLists ??=
    arcadeScenery || arcadeModels
      ? json('manifest.json').then((m) => {
          const manifest = parseManifest(m);
          return {
            stages: new Set(arcadeScenery ? manifest.arcadeStages : []),
            panoramas: manifest.arcadePanoramas,
            objects: manifest.arcadeObjects,
            fighters: new Set(arcadeModels ? manifest.arcadeFighters : []),
          };
        })
      : Promise.resolve({ stages: new Set(), panoramas: [], objects: [], fighters: new Set() }));
/**
 * The fight's tables with the arcade board's fighters' own accessories, for the packs drawn with
 * the board's models: the fight hangs and swings each on its own joint and the board's spring.
 */
export async function withArcadeFighters<T extends { readonly tables: FightTables }>(loaded: T): Promise<T> {
  const { fighters } = await arcadeStagesOf();
  if (fighters.size === 0) return loaded;
  const own = parseArcadeFighters(await json('tables/arcade-fighters.json'));
  for (const pack of [...own.keys()]) if (!fighters.has(pack)) own.delete(pack);
  return { ...loaded, tables: { ...loaded.tables, models: withOwnAccessories(loaded.tables.models, own) } };
}
const optional = (path: string): Promise<ImageBitmap | null> => assetImage(path).catch(() => null);
/** A fighter's, an intro model's or a stage's texture atlas by its file's name: remastered, the one made for it; the enlarged one, or the original. */
const atlas = async (kind: string, name: string): Promise<ImageBitmap> =>
  (remastered() ? await optional(`remaster/${kind}/${name}.png`) : null) ?? (smooth ? assetImage(`textures/${kind}/${name}.png`) : image(`${kind}/${name}.png`));
/** Remastered, an atlas's normal and ORM maps and its heights. */
const mapsOf = async (kind: string, name: string): Promise<MaterialMaps | null> => {
  if (!remastered()) return null;
  const [normal, orm, height] = await Promise.all([optional(`remaster/${kind}/${name}.normal.png`), optional(`remaster/${kind}/${name}.orm.png`), optional(`remaster/${kind}/${name}.height.png`)]);
  return normal === null && orm === null ? null : { normal, orm, height };
};
/** Remastered, a stage's sky made for it and its panorama's ridge. */
const skyOf = async (id: number): Promise<SkyFiles | undefined> => {
  if (!remastered()) return undefined;
  const [picture, clouds, ridge] = await Promise.all([optional(`remaster/sky/${two(id)}.png`), optional(`remaster/sky/${two(id)}.clouds.png`), json(`remaster/sky/${two(id)}.ridge.json`).catch(() => null)]);
  return picture === null ? undefined : { picture, clouds, ridge: ridge as SkyFiles['ridge'] };
};
/** Remastered, a stage's floor redrawn: its atlas of the ground's regions, its maps and where each region went. */
const floorOf = async (id: number): Promise<FloorFiles | undefined> => {
  if (!remastered()) return undefined;
  const [texture, maps, layout] = await Promise.all([optional(`remaster/stages/${two(id)}.floor.png`), mapsOf('stages', `${two(id)}.floor`), json(`remaster/stages/${two(id)}.floor.json`).catch(() => null)]);
  return texture === null || layout === null ? undefined : { texture, maps, layout: layout as FloorFiles['layout'] };
};
/**
 * Whether the fighters are drawn rounded, or with the console's meshes: `?models=psx` or
 * `?models=rounded`, else the console's on a very low page, whose GPU the rounded meshes' vertices
 * cost a third of its frame.
 */
const rounded = (): boolean => {
  const models = asked(params, 'models', settings.models, [null, 'rounded', 'psx']);
  return models === null ? pageQuality() !== 'verylow' : models !== 'psx';
};
/** A fighter's or an intro model's mesh by its file's name: the rounded one, or the original. */
const fighterMesh = (kind: string, name: string): Promise<ArrayBuffer> => (rounded() ? assetBytes(`models/${kind}/${name}.ftr`) : dataBytes(`${kind}/${name}.ftr`));

/** Tekken Ball's beach, whose panorama comes with it, and Tekken Force's stages, whose backdrops come with them. */
const BEACH = 0x13;
const FORCE_STAGES = { first: 0xf, last: 0x12 } as const;

/** A stage's backdrop picture, for the stages that have one. */
const backdropOf = (id: number): Promise<ImageBitmap> | undefined => {
  if (id === BEACH) return assetImage('pictures/ball-backdrop.png');
  if (FORCE_STAGES.first <= id && id <= FORCE_STAGES.last) return assetImage(`pictures/force-backdrop-${id}.png`);
  return undefined;
};

/** The arcade's scenery for a stage and its atlas, where it is drawn, and its background where it has one. */
const arcadeOf = async (id: number): Promise<ArcadeStageFiles | undefined> => {
  const { stages, panoramas, objects } = await arcadeStagesOf();
  if (!stages.has(id)) return undefined;
  const sky = panoramas.find((p) => p.stage === id);
  const own = objects.filter((o) => o.stage === id);
  const [mesh, texture, maps, picture, pieces] = await Promise.all([
    dataBytes(`arcade/stages/${two(id)}.stg`),
    atlas('arcade/stages', two(id)),
    mapsOf('arcade/stages', two(id)),
    sky === undefined ? null : atlas('arcade/stages', `${two(id)}.sky`),
    Promise.all(own.map(async (o) => ({ ...o, mesh: await dataBytes(`arcade/stages/${two(id)}-${o.piece}.stg`), texture: await atlas('arcade/stages', `${two(id)}-${o.piece}`) }))),
  ]);
  const panorama = sky === undefined || picture === null ? undefined : { picture, layout: sky };
  return { mesh, texture, maps, objects: pieces, ...(panorama === undefined ? {} : { panorama }) };
};

const stage = async (id: number): Promise<{ mesh: ArrayBuffer; ground: ArrayBuffer; texture: ImageBitmap; maps?: MaterialMaps | null; backdrop?: ImageBitmap; arcade?: ArcadeStageFiles; floor?: FloorFiles; sky?: SkyFiles }> => {
  const [mesh, ground, texture, maps, backdrop, arcade, floor, sky] = await Promise.all([dataBytes(`stages/${two(id)}.stg`), dataBytes(`stages/${two(id)}.gnd`), atlas('stages', two(id)), mapsOf('stages', two(id)), backdropOf(id), arcadeOf(id), floorOf(id), skyOf(id)]);
  return { mesh, ground, texture, maps, ...(backdrop === undefined ? {} : { backdrop }), ...(arcade === undefined ? {} : { arcade }), ...(floor === undefined ? {} : { floor }), ...(sky === undefined ? {} : { sky }) };
};

/** The fighters' and stages' drawing data, by pack and stage. */
export const drawingFiles: DrawingFiles = {
  fighter: async (pack) => {
    const kind = (await arcadeStagesOf()).fighters.has(pack) ? 'arcade/fighters' : 'fighters';
    const [mesh, texture, maps] = await Promise.all([fighterMesh(kind, two(pack)), atlas(kind, two(pack)), mapsOf(kind, two(pack))]);
    return { mesh, texture, maps };
  },
  stage,
  picture: (name) => assetImage(`pictures/${name}.png`),
  smooth,
  cloth,
  get remaster() {
    return remastered();
  },
  get floorFade() {
    return floorFade.on;
  },
  get fineRelief() {
    return pageQuality() === 'high';
  },
};

/** An attract intro's drawing data: for each pack, the model its archive holds in the pair its table names; the stages as the fight's. */
export const introFiles = (intro: number, pairs: readonly number[]): DrawingFiles => ({
  fighter: async (pack) => {
    const name = `${intro}-${two(pairs[pack]!)}`;
    const [mesh, texture, maps] = await Promise.all([fighterMesh('intro', name), atlas('intro', name), mapsOf('intro', name)]);
    return { mesh, texture, maps };
  },
  stage,
  smooth,
  cloth,
  get remaster() {
    return remastered();
  },
  get floorFade() {
    return floorFade.on;
  },
  get fineRelief() {
    return pageQuality() === 'high';
  },
});

export async function playQuickMatch(): Promise<void> {
  const { renderer, backend } = await pageRenderer();
  new CrtFilter().on = crtAsked();
  status.textContent = 'loading';
  const [{ tables, arena, commands }] = await Promise.all([loadFightTables(json).then(withArcadeFighters), loadTypefaces()]);
  const manifest = (await json('manifest.json')) as { kazuya?: boolean };
  const pick = (key: string, fallback: number): number => {
    const v = Number(params.get(key) ?? NaN);
    return Number.isInteger(v) && v >= 0 && v <= (manifest.kazuya === true ? KAZUYA : KAZUYA - 1) && !NOT_YET.has(v) ? v : fallback;
  };
  const cpu = params.get('cpu') ?? '2';
  const stage = Math.max(0, Math.min(arena.stages.length - 1, Number(params.get('stage') ?? 0) || 0));
  const setup: QuickMatch = {
    /* `?walls=on`: the remake's walls. */
    walls: params.get('walls') === 'on' ? 1 : 0,
    stage,
    entrants: [
      { roster: pick('p1', manifest.kazuya === true ? KAZUYA : PAUL), costume: 0, computer: cpu.includes('1') },
      { roster: pick('p2', LAW), costume: 0, computer: cpu.includes('2') },
    ],
  };
  const [first, second] = matchMovesets(tables, setup);
  const [movesetA, movesetB, common] = await Promise.all([loadMoveset(json, two(first)), second < 0 ? null : loadMoveset(json, two(second)), loadMoveset(json, 'common')]);
  const data = fightDataFor(tables, setup, (id) => (id === first ? movesetA : movesetB!), common);
  const fight = Fight.quick(data, setup);
  const sound = await startSound();
  const view = new FightView(renderer, data, arena, drawingFiles);
  const hud = new Hud(renderer, data, fight.state);
  const pause = new PauseScreen(renderer, data, commands);
  /* Nothing steps, sounds or shows until every model the fight draws is loaded and every pipeline compiled. */
  let ready = false;
  play(
    {
      field: (pads) => {
        if (!ready) {
          ready = view.prepare(fight.state);
          status.textContent = ready ? '' : 'loading';
          return false;
        }
        fight.field(pads);
        sound?.field(fight.state, fight.state.vsyncSeen);
      },
      render(width, height) {
        if (!ready) return;
        hud.prepare(fight.state, width, height);
        pause.prepare(fight.state, width, height);
        view.render(
          fight.state,
          height > 0 ? width / height : 1,
          () => hud.drawBack(),
          () => {
            hud.drawFront();
            pause.draw();
          },
        );
      },
      about: () => {
        const world = fight.state;
        const name = (f: (typeof world.fighters)[number]): string => `${tables.roster.codes[f.rosterCode]?.name ?? '?'} (roster ${f.roster}, model ${f.costume})`;
        return { Scene: 'quick match', Fighters: `${name(world.fighters[0]!)} vs ${name(world.fighters[1]!)}`, Stage: world.stage, Round: world.round.number };
      },
      probe: () => ({
        setup,
        sound: sound?.probe() ?? null,
        round: fight.state.round.number,
        flow: fight.state.round.flow,
        health: fight.state.fighters.slice(0, 2).map((f) => f.health / 65536),
        x: fight.state.fighters.slice(0, 2).map((f) => f.position[0]),
        pause: { frozen: fight.state.pause.frozen, cursor: fight.state.pauseMenu.cursor, choice: fight.state.pauseMenu.choice, drawn: fight.state.pauseMenu.drawn },
      }),
      fighting: () => true,
    },
    renderer,
    backend,
  );
}
