/**
 * The game's progress as it is kept between plays: the characters, costumes and modes earned, the
 * endings seen, the unlock schedule's progress, each character's plays, the best records, the
 * options, and the attract cycle's intros. It is read as the page starts and saved where the
 * console saves its memory card (`saveRecords`, `GameState.saving`); where it is kept is the
 * page's.
 */
import type { GameState } from './state.ts';

/** A best time: its frames and its holder's initials. */
export interface SavedTime {
  readonly frames: number;
  readonly initials: string;
}

/** A survival record: its character, its wins and its holder's initials. */
export interface SavedSurvivor {
  readonly roster: number;
  readonly wins: number;
  readonly initials: string;
}

export interface Progress {
  readonly records: {
    readonly earnedRoster: number;
    readonly extraCostumes: number;
    readonly extraDrawn: number;
    /** Per character (an added one last): its Arcade plays, versus wins, versus losses and versus draws. */
    readonly plays: readonly (readonly number[])[];
    readonly endings: readonly number[];
    readonly times: readonly SavedTime[];
    readonly survivors: readonly SavedSurvivor[];
    readonly newest: number;
    readonly demoTurn: number;
    readonly playsSince: number;
    readonly scheduleStep: number;
    readonly scheduleStarted: number;
  };
  readonly options: {
    readonly difficulty: number;
    readonly rounds: number;
    readonly roundTime: number;
    readonly alwaysChip: number;
    readonly continueChooses: number;
    readonly vibration: readonly number[];
    readonly lastChoices: readonly number[];
    readonly keepChoices: number;
    readonly modeSetting: number;
    readonly keys: readonly (readonly number[])[];
  };
  readonly earned: { readonly ball: number; readonly theater: number };
  readonly attract: { readonly intros: number; readonly intro: number };
}

/** The game's progress as it stands. */
export function progressOf(game: GameState): Progress {
  const { records, options, earned, attract } = game;
  return {
    records: {
      earnedRoster: records.earnedRoster,
      extraCostumes: records.extraCostumes,
      extraDrawn: records.extraDrawn,
      plays: records.plays.map((counts) => [...counts]),
      endings: [...records.endings],
      times: records.times.map(({ frames, initials }) => ({ frames, initials })),
      survivors: records.survivors.map(({ roster, wins, initials }) => ({ roster, wins, initials })),
      newest: records.newest,
      demoTurn: records.demoTurn,
      playsSince: records.playsSince,
      scheduleStep: records.scheduleStep,
      scheduleStarted: records.scheduleStarted,
    },
    options: {
      difficulty: options.difficulty,
      rounds: options.rounds,
      roundTime: options.roundTime,
      alwaysChip: options.alwaysChip,
      continueChooses: options.continueChooses,
      vibration: [...options.vibration],
      lastChoices: [...options.lastChoices],
      keepChoices: options.keepChoices,
      modeSetting: options.modeSetting,
      keys: options.keys.map((keys) => [...keys]),
    },
    earned: { ball: earned.ball, theater: earned.theater },
    attract: { intros: attract.intros, intro: attract.intro },
  };
}

/** Each element of `from` put in `to`'s place, the two the same length. */
function fill<T>(to: T[], from: readonly T[]): void {
  if (to.length !== from.length) throw new Error(`a saved list of ${from.length} where the game keeps ${to.length}`);
  from.forEach((value, i) => (to[i] = value));
}

/** The game given a saved progress. */
export function restoreProgress(game: GameState, progress: Progress): void {
  const { records, options, earned, attract } = game;
  const saved = progress.records;
  records.earnedRoster = saved.earnedRoster;
  records.extraCostumes = saved.extraCostumes;
  records.extraDrawn = saved.extraDrawn;
  if (records.plays.length !== saved.plays.length) throw new Error(`saved plays for ${saved.plays.length} characters where the game keeps ${records.plays.length}`);
  records.plays.forEach((counts, k) => fill(counts, saved.plays[k]!));
  fill(records.endings, saved.endings);
  fill(records.times, saved.times.map(({ frames, initials }) => ({ frames, initials })));
  fill(records.survivors, saved.survivors.map(({ roster, wins, initials }) => ({ roster, wins, initials })));
  records.newest = saved.newest;
  records.demoTurn = saved.demoTurn;
  records.playsSince = saved.playsSince;
  records.scheduleStep = saved.scheduleStep;
  records.scheduleStarted = saved.scheduleStarted;
  const chosen = progress.options;
  options.difficulty = chosen.difficulty;
  options.rounds = chosen.rounds;
  options.roundTime = chosen.roundTime;
  options.alwaysChip = chosen.alwaysChip;
  options.continueChooses = chosen.continueChooses;
  fill(options.vibration, chosen.vibration);
  fill(options.lastChoices, chosen.lastChoices);
  options.keepChoices = chosen.keepChoices;
  options.modeSetting = chosen.modeSetting;
  if (options.keys.length !== chosen.keys.length) throw new Error(`saved keys for ${chosen.keys.length} pads where the game keeps ${options.keys.length}`);
  options.keys.forEach((keys, pad) => fill(keys, chosen.keys[pad]!));
  earned.ball = progress.earned.ball;
  earned.theater = progress.earned.theater;
  attract.intros = progress.attract.intros;
  attract.intro = progress.attract.intro;
}
