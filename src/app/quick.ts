/**
 * A quick match, without the menus (`?quick`, or any of `p1`, `p2`, `stage`, `cpu`): set up as the
 * menus leave a versus match, the fight stepped from the pads and drawn from its state. `p1` and
 * `p2` are roster ids, `cpu` the sides the computer plays (`2` by default, `0` none, `1`, or `12`
 * both).
 */
import { loadFightTables, loadMoveset } from '../assets/load.ts';
import { Fight } from '../sim/fight/fight.ts';
import { fightDataFor, matchMovesets, type MatchSetup } from '../sim/fight/match.ts';
import { FightView, type ArcadeStageFiles, type DrawingFiles } from '../present/3d/fight-view.ts';
import { TEXTURE_SCALE, type ArcadeObject, type ArcadePanorama } from '../assets/manifest.ts';
import { Hud } from '../present/hud/hud.ts';
import { PauseScreen } from '../present/hud/pause.ts';
import { loadTypefaces } from '../present/2d/typefaces.ts';
import { assetBytes, assetImage, dataBytes, image, json, pageQuality, pageRenderer, params, play, status, two } from './page.ts';
import { startSound } from './sound.ts';

/** Roster ids the remake cannot set up yet: Mokujin's draw. */
const NOT_YET = new Set([15]);
const KAZUYA = 22;
const PAUL = 0;
const LAW = 1;

/** Whether the fighters and stages are drawn with their textures enlarged and smooth, or as the console drew them (`?textures=psx`). */
const smooth = params.get('textures') !== 'psx';
/**
 * Whether a stage the arcade board's data has is drawn with the arcade's scenery, the default once
 * `npm run arcade` has read it, or with the disc's (`?stages=psx`).
 */
const arcadeScenery = params.get('stages') !== 'psx';
interface ArcadeList {
  readonly stages: ReadonlySet<number>;
  readonly panoramas: readonly ArcadePanorama[];
  readonly objects: readonly ArcadeObject[];
}
let arcadeStages: Promise<ArcadeList> | null = null;
/** The stages drawn with the arcade's scenery, their panoramas and their moving pieces. */
const arcadeStagesOf = (): Promise<ArcadeList> =>
  (arcadeStages ??= arcadeScenery
    ? json('manifest.json').then((m) => {
        const manifest = m as { arcadeStages?: number[]; arcadePanoramas?: ArcadePanorama[]; arcadeObjects?: ArcadeObject[] };
        return { stages: new Set(manifest.arcadeStages ?? []), panoramas: manifest.arcadePanoramas ?? [], objects: manifest.arcadeObjects ?? [] };
      })
    : Promise.resolve({ stages: new Set(), panoramas: [], objects: [] }));
/** A fighter's, an intro model's or a stage's texture atlas by its file's name: the enlarged one, or the original. */
const atlas = (kind: string, name: string): Promise<ImageBitmap> => (smooth ? assetImage(`textures/${kind}/${name}.png`) : image(`${kind}/${name}.png`));
/**
 * Whether the fighters are drawn rounded, or with the console's meshes: `?models=psx` or
 * `?models=rounded`, else the console's on a very low page, whose GPU the rounded meshes' vertices
 * cost a third of its frame.
 */
const rounded = (): boolean => {
  const asked = params.get('models');
  return asked === null ? pageQuality() !== 'verylow' : asked !== 'psx';
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

/** The arcade's scenery for a stage and its atlas, where it is drawn, and its panorama where it has one. */
const arcadeOf = async (id: number): Promise<ArcadeStageFiles | undefined> => {
  const { stages, panoramas, objects } = await arcadeStagesOf();
  if (!stages.has(id)) return undefined;
  const sky = panoramas.find((p) => p.stage === id);
  const own = objects.filter((o) => o.stage === id);
  const [mesh, texture, picture, pieces] = await Promise.all([
    dataBytes(`arcade/stages/${two(id)}.stg`),
    atlas('arcade/stages', two(id)),
    sky === undefined ? null : atlas('arcade/stages', `${two(id)}.sky`),
    Promise.all(own.map(async (o) => ({ ...o, mesh: await dataBytes(`arcade/stages/${two(id)}-${o.piece}.stg`), texture: await atlas('arcade/stages', `${two(id)}-${o.piece}`) }))),
  ]);
  const scale = smooth ? TEXTURE_SCALE.stages : 1;
  const panorama = sky === undefined || picture === null ? undefined : { picture, width: picture.width / scale, height: picture.height / scale, top: sky.top, bottom: sky.bottom, horizon: sky.horizon };
  return { mesh, texture, objects: pieces, ...(panorama === undefined ? {} : { panorama }) };
};

const stage = async (id: number): Promise<{ mesh: ArrayBuffer; ground: ArrayBuffer; texture: ImageBitmap; backdrop?: ImageBitmap; arcade?: ArcadeStageFiles }> => {
  const [mesh, ground, texture, backdrop, arcade] = await Promise.all([dataBytes(`stages/${two(id)}.stg`), dataBytes(`stages/${two(id)}.gnd`), atlas('stages', two(id)), backdropOf(id), arcadeOf(id)]);
  return { mesh, ground, texture, ...(backdrop === undefined ? {} : { backdrop }), ...(arcade === undefined ? {} : { arcade }) };
};

/** The fighters' and stages' drawing data, by pack and stage. */
export const drawingFiles: DrawingFiles = {
  fighter: async (pack) => {
    const [mesh, texture] = await Promise.all([fighterMesh('fighters', two(pack)), atlas('fighters', two(pack))]);
    return { mesh, texture };
  },
  stage,
  picture: (name) => assetImage(`pictures/${name}.png`),
  smooth,
};

/** An attract intro's drawing data: for each pack, the model its archive holds in the pair its table names; the stages as the fight's. */
export const introFiles = (intro: number, pairs: readonly number[]): DrawingFiles => ({
  fighter: async (pack) => {
    const name = `${intro}-${two(pairs[pack]!)}`;
    const [mesh, texture] = await Promise.all([fighterMesh('intro', name), atlas('intro', name)]);
    return { mesh, texture };
  },
  stage,
  smooth,
});

export async function playQuickMatch(): Promise<void> {
  const { renderer, backend } = await pageRenderer();
  status.textContent = 'loading';
  const [{ tables, arena, commands }] = await Promise.all([loadFightTables(json), loadTypefaces()]);
  const manifest = (await json('manifest.json')) as { kazuya?: boolean };
  const pick = (key: string, fallback: number): number => {
    const v = Number(params.get(key) ?? NaN);
    return Number.isInteger(v) && v >= 0 && v <= (manifest.kazuya === true ? KAZUYA : KAZUYA - 1) && !NOT_YET.has(v) ? v : fallback;
  };
  const cpu = params.get('cpu') ?? '2';
  const stage = Math.max(0, Math.min(arena.stages.length - 1, Number(params.get('stage') ?? 0) || 0));
  const setup: MatchSetup = {
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
