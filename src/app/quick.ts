/**
 * A quick match, without the menus (`?quick`, or any of `p1`, `p2`, `stage`, `cpu`): set up as the
 * menus leave a versus match, the fight stepped from the pads and drawn from its state. `p1` and
 * `p2` are roster ids, `cpu` the sides the computer plays (`2` by default, `0` none, `1`, or `12`
 * both).
 */
import { loadFightTables, loadMoveset } from '../assets/load.ts';
import { Fight } from '../sim/fight/fight.ts';
import { fightDataFor, matchMovesets, type MatchSetup } from '../sim/fight/match.ts';
import { FightView, type DrawingFiles } from '../present/3d/fight-view.ts';
import { Hud } from '../present/hud/hud.ts';
import { PauseScreen } from '../present/hud/pause.ts';
import { loadTypefaces } from '../present/2d/typefaces.ts';
import { assetBytes, assetImage, dataBytes, image, json, pageRenderer, params, play, status, two } from './page.ts';
import { startSound } from './sound.ts';

/** Roster ids the remake cannot set up yet: Mokujin's draw and True Ogre's skeleton. */
const NOT_YET = new Set([15, 20]);
const KAZUYA = 22;
const PAUL = 0;
const LAW = 1;

/** Whether the fighters and stages are drawn with their textures enlarged and smooth, or as the console drew them (`?textures=psx`). */
const smooth = params.get('textures') !== 'psx';
/** A fighter's, an intro model's or a stage's texture atlas by its file's name: the enlarged one, or the original. */
const atlas = (kind: string, name: string): Promise<ImageBitmap> => (smooth ? assetImage(`textures/${kind}/${name}.png`) : image(`${kind}/${name}.png`));
/** Whether the fighters are drawn rounded, or with the console's meshes (`?models=psx`). */
const rounded = params.get('models') !== 'psx';
/** A fighter's or an intro model's mesh by its file's name: the rounded one, or the original. */
const fighterMesh = (kind: string, name: string): Promise<ArrayBuffer> => (rounded ? assetBytes(`models/${kind}/${name}.ftr`) : dataBytes(`${kind}/${name}.ftr`));

const stage = async (id: number): Promise<{ mesh: ArrayBuffer; ground: ArrayBuffer; texture: ImageBitmap }> => {
  const [mesh, ground, texture] = await Promise.all([dataBytes(`stages/${two(id)}.stg`), dataBytes(`stages/${two(id)}.gnd`), atlas('stages', two(id))]);
  return { mesh, ground, texture };
};

/** The fighters' and stages' drawing data, by pack and stage. */
export const drawingFiles: DrawingFiles = {
  fighter: async (pack) => {
    const [mesh, texture] = await Promise.all([fighterMesh('fighters', two(pack)), atlas('fighters', two(pack))]);
    return { mesh, texture };
  },
  stage,
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
  play(
    {
      field: (pads) => {
        fight.field(pads);
        sound?.field(fight.state, fight.state.vsyncSeen);
      },
      render(width, height) {
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
