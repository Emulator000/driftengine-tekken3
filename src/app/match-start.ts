/**
 * An online match's start: the state both games begin it from, made from the host's start (its
 * options, both players' buttons and fighters, the stage it drew), what of the host's game a start
 * carries, and the word a game says of the disc it reads.
 */
import { parsePowerOn } from '../assets/scenes.ts';
import { hostPowersOn, playedWith, type Start } from '../net/online.ts';
import { StateSnapshotter } from '../net/snapshot.ts';
import type { SceneTables } from '../sim/data/scenes.ts';
import { stopMusic } from '../sim/fight/voices.ts';
import { FightStep } from '../sim/game/fight-scene.ts';
import { Game } from '../sim/game/game.ts';
import { MenuMode, mapPads, startMode } from '../sim/game/menu.ts';
import { lookOf } from '../sim/game/select.ts';
import { Scene, type GameState } from '../sim/game/state.ts';

/** The options the host's game decides for both. */
export const DECIDED = ['difficulty', 'rounds', 'roundTime', 'alwaysChip', 'continueChooses', 'modeSetting', 'keepChoices', 'musicSet', 'stereo'] as const;

/** What of the host's game its start's options carry for a match played as `as`: the values it powers on with, where that version begins from the host's. */
export function carriedPowerOn(as: string, data: Game['data']): { readonly powerOn?: unknown } {
  return hostPowersOn(as) ? { powerOn: data.scenes.powerOn } : {};
}

/** The data a match played as `as` powers on from: with the host's power-on values where that version takes them and they are whole, else this game's own. */
function poweringOn(data: Game['data'], start: Start, as: string): Game['data'] {
  if (!hostPowersOn(as) || start.options.powerOn === undefined) return data;
  try {
    return { ...data, scenes: { ...data.scenes, powerOn: parsePowerOn(start.options.powerOn, "the start's powerOn") } };
  } catch {
    return data;
  }
}

/**
 * The state a match begins from, both games alike, made in `state` (restored with `snapshotter`,
 * which knows the data's objects): the state the game powers on with, the host's options, both
 * players' buttons, Versus with both pads in, straight to the fight with each player's fighter and
 * the stage the host drew. The machine's own parts of the state (REMAKE OPTION's, ONLINE MODE's
 * page) are the caller's to keep.
 */
export function matchStart(state: GameState, data: Game['data'], start: Start, as: string, snapshotter: StateSnapshotter<GameState>): void {
  snapshotter.restore(new Game(poweringOn(data, start, as)).state as unknown as Parameters<typeof snapshotter.restore>[0]);
  for (const key of DECIDED) if (typeof start.options[key] === 'number') state.options[key] = start.options[key] as number;
  if (typeof start.options.earnedRoster === 'number') state.records.earnedRoster = start.options.earnedRoster;
  if (typeof start.options.extraCostumes === 'number') state.records.extraCostumes = start.options.extraCostumes;
  state.options.keys.splice(0, 2, [...start.keys[0]], [...start.keys[1]]);
  state.options.vibration.fill(1);
  mapPads(state, data.scenes);
  stopMusic(state.world);
  startMode(state, MenuMode.VERSUS, 1);
  /* Online: straight to the fight, each player's fighter as chosen in the waiting room, the stage the host drew. */
  state.run.online = 1;
  /* Three rounds to win (the option is the rounds less one), whatever the host's options; a round's end cut short by both players alone. */
  state.world.options.rounds = 2;
  state.world.match.online = 1;
  /* A level round that brings both to the rounds that win the match a draw, where both games agreed it, rather than the host's by the game's tie-break. */
  if (start.draws === 1) state.world.match.drawRule = 1;
  /* The remake's walls as the host's REACHABLE WALLS has them for an online match; none in one played as a version without them. */
  state.world.options.walls = playedWith(as, 'walls') && start.options.walls === 1 ? 1 : 0;
  /* The players who see the fight from the other side, their moves into the screen going by that view, where the version played has it. */
  state.world.match.depthTurned = playedWith(as, 'depthTurned') && Number.isInteger(start.turned) ? start.turned! & 3 : 0;
  /* A move's dust buzzing the pads as the version played does: once, or, before 0.7.15, twice. */
  state.world.match.dustBuzz = playedWith(as, 'dustBuzz') ? 0 : 1;
  state.run.onlineStage = typeof start.options.stage === 'number' ? start.options.stage : -1;
  start.fighters.forEach((fighter, n) => {
    state.entrants.roster[n] = fighter.roster;
    state.entrants.costume[n] = fighter.costume;
    state.entrants.chosen[n] = 1;
    state.entrants.computer[n] = 0;
    state.versusPortraits[n] = lookOf(data.scenes, fighter.roster, fighter.costume) & 0x1f;
  });
  state.modeOverlay = state.run.overlay;
  Object.assign(state, { scene: Scene.FIGHT, step: FightStep.MODE_SETUP });
}

/**
 * The disc a game reads, as a fingerprint of the tables it takes from the disc (the values it
 * powers on with, the buttons, the menus), Kazuya's place on the select, which only his own files
 * add, left out: two games that say the same read the same disc.
 */
export function discWord(scenes: SceneTables): string {
  return new StateSnapshotter({ scenes: { ...scenes, select: { ...scenes.select, added: [] } } }).digestNow();
}
