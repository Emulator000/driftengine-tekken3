/**
 * The fight's assets from `public/assets/`, each validated: the tables every fight reads, the
 * arena's and the command lists for the presentation, and the movesets with their motions by id (and the common one).
 * `json` fetches a file by its path under the assets.
 */
import type { LoadedMoveset } from '../sim/fight/state.ts';
import type { FightTables } from '../sim/fight/match.ts';
import type { SceneTables } from '../sim/data/scenes.ts';
import type { FighterModels } from '../sim/data/models.ts';
import { parseArenaTables, type ArenaTables } from './arena.ts';
import { parseSoundBanks } from './banks.ts';
import { parseCameraTables } from './camera.ts';
import { parseCancelTables } from './cancels.ts';
import { parseCommandTables, type CommandTables } from './commands.ts';
import { parseComputerTables } from './computer.ts';
import { parseEffectTables } from './effects.ts';
import { parseBallTables } from './ball.ts';
import { parseForceTables } from './force.ts';
import { parseHitTables, parseSharedHits } from './hits.ts';
import { parseInputTables } from './input.ts';
import { parseManifest } from './manifest.ts';
import { parseMathTables } from './math.ts';
import { parseFighterModels } from './models.ts';
import { parseCurveTables, parseMotions } from './motion.ts';
import { parseMoveset } from './moveset.ts';
import { parseReactionTables } from './reactions.ts';
import { parseRosterTables } from './roster.ts';
import { parseSceneTables } from './scenes.ts';
import { parseSkeletonTables } from './skeleton.ts';
import { parseSoundTables } from './sound.ts';
import { parseMusicTables } from './playback.ts';

export type FetchJson = (path: string) => Promise<unknown>;

/** The roster's id rows: the game's 22, an added character its stand-in's. */
const ROWS = 22;

/** The tables every fight reads, the arena's, and the command lists. */
export async function loadFightTables(json: FetchJson): Promise<{ tables: FightTables; arena: ArenaTables; commands: CommandTables; scenes: SceneTables }> {
  parseManifest(await json('manifest.json'));
  const table = (name: string): Promise<unknown> => json(`tables/${name}.json`);
  const [[math, motion, input, skeleton, roster, hits, reactions, cancels, camera, computer, sound, effects, banks, fighters, arena, commands, scenes, ball, force], music] = await Promise.all([
    Promise.all(['math', 'motion', 'input', 'skeleton', 'roster', 'hits', 'reactions', 'cancels', 'camera', 'computer', 'sound', 'effects', 'banks', 'fighters', 'arena', 'commands', 'scenes', 'ball', 'force'].map(table)),
    json('sound/music.json'),
  ]);
  const rosterTables = parseRosterTables(roster);
  const sceneTables = parseSceneTables(scenes);
  const standIns = new Map(rosterTables.standIns);
  return {
    tables: {
      math: parseMathTables(math),
      curves: parseCurveTables(motion),
      input: parseInputTables(input),
      skeleton: parseSkeletonTables(skeleton),
      roster: { ...rosterTables, rowOf: (id: number) => (id < ROWS ? id : (standIns.get(id) ?? id)) },
      sharedHits: parseSharedHits(hits),
      reactions: parseReactionTables(reactions),
      cancels: parseCancelTables(cancels),
      hitTables: parseHitTables(hits),
      camera: parseCameraTables(camera),
      computer: parseComputerTables(computer),
      sound: parseSoundTables(sound),
      music: parseMusicTables(music),
      effects: parseEffectTables(effects),
      ball: parseBallTables(ball),
      force: parseForceTables(force),
      banks: parseSoundBanks(banks),
      models: parseFighterModels(fighters),
      lines: { coin: sceneTables.select.coinLines, credit: sceneTables.select.creditLines },
    },
    arena: parseArenaTables(arena),
    commands: parseCommandTables(commands),
    scenes: sceneTables,
  };
}

/** The attract intros' models, by the pack each stands for (`tables/intro-models.json`). */
export async function loadIntroModels(json: FetchJson): Promise<FighterModels[]> {
  const intros = await json('tables/intro-models.json');
  if (!Array.isArray(intros)) throw new Error('tables/intro-models.json is not a list of intros');
  return intros.map((models, i) => parseFighterModels(models, `tables/intro-models.json[${i}]`));
}

/** A moveset and its motions, by id (`common` for the common one). */
export async function loadMoveset(json: FetchJson, name: string): Promise<LoadedMoveset> {
  const [moveset, motions] = await Promise.all([json(`movesets/${name}.json`), json(`motions/${name}.json`)]);
  return { moveset: parseMoveset(moveset, name), motions: parseMotions(motions, name) };
}
