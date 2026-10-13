/**
 * What the game keeps between plays: each character's plays, the characters and costumes earned,
 * the endings seen, and the unlocking that plays bring (a count of plays since the last unlock
 * moves a schedule on every 100 plays, 50 once the first has come; endings move it too); the
 * streak of wins in a row; and the best records the modes set: a best time per character,
 * survival's ten, and Tekken Force's best score and the keys toward Dr. B.
 */
import type { SceneTables } from '../data/scenes.ts';
import { MenuMode } from './menu.ts';
import { saveProgress } from './save.ts';
import type { GameState } from './state.ts';

/** The costumes the schedule and plays can give. */
const COSTUME_MASK = 0x50382;
const EVERYONE = 0x1fffff;
/** The newest character earned when none is. */
const NONE = 0x16;
/** The hidden character met in Arcade, earned by beating him (or by the name entry's secret name). */
export const HIDDEN = 0x11;
/** The schedule's steps. */
const Step = { NOTHING: 0, CHARACTER: 1, COSTUME: 2, THEATER: 3, BALL: 4, EVERYTHING: 5 } as const;
const MOST_STEPS = 0xe;
/** The added characters' row of plays, past the game's 22. */
const ROWS = 0x16;

const playsOf = (game: GameState, roster: number): number[] => game.records.plays[roster < ROWS ? roster : ROWS]!;
const bump = (counts: number[], k: number): void => void (counts[k] = Math.min(counts[k]! + 1, 0xffff));
const bumpSince = (game: GameState): void => void (game.records.playsSince = Math.min(game.records.playsSince + 1, 0xffff));
const popcount = (bits: number): number => {
  let count = 0;
  for (let v = bits >>> 0; v !== 0; v >>>= 1) count += v & 1;
  return count;
};

/** How often a character has been played: its Arcade plays, versus losses and versus draws. */
export function playCount(game: GameState, roster: number): number {
  const counts = playsOf(game, roster);
  return counts[0]! + counts[2]! + counts[3]!;
}

/** With auto save on, the progress saved if the records changed since it last was. */
export function saveRecords(game: GameState): void {
  if (game.options.autoSave !== 0 && game.records.changed !== 0) saveProgress(game);
  game.records.changed = 0;
}

/** The unlocks plays bring checked, and the records marked to be saved. */
export function recordsChanged(game: GameState, scenes: SceneTables): void {
  checkUnlocks(game, scenes);
  game.records.changed = 1;
}

/** An Arcade run's character counted. */
export function countArcadePlay(game: GameState, scenes: SceneTables, roster: number): void {
  bump(playsOf(game, roster), 0);
  bumpSince(game);
  recordsChanged(game, scenes);
}

/** A versus match's winner and loser counted. */
export function countVersusResult(game: GameState, scenes: SceneTables, winner: number, loser: number): void {
  bump(playsOf(game, winner), 1);
  bump(playsOf(game, loser), 2);
  bumpSince(game);
  recordsChanged(game, scenes);
}

/** A versus match drawn: both characters counted. */
export function countVersusDraw(game: GameState, scenes: SceneTables, first: number, second: number): void {
  for (const roster of [first, second]) {
    bump(playsOf(game, roster), 3);
    bumpSince(game);
  }
  recordsChanged(game, scenes);
}

/** An extra costume given, the plays' count restarting when it is new. */
function giveCostume(game: GameState, bit: number): void {
  const costumes = game.records.extraCostumes;
  if ((costumes & bit) === 0) game.records.playsSince = 0;
  game.records.extraCostumes = ((costumes | bit) & COSTUME_MASK) >>> 0;
}

/** A character earned, announced as the newest and the plays' count restarted when it is new. */
export function earn(game: GameState, roster: number): void {
  const bit = (1 << roster) >>> 0;
  if ((game.records.earnedRoster & bit) === 0) {
    game.records.newest = roster;
    game.records.playsSince = 0;
  }
  game.records.earnedRoster = (game.records.earnedRoster | bit) >>> 0;
}

/** Dr. B's roster, which Tekken Force's final stage earns. */
const DR_B = 0x13;

/** Whether Dr. B is earned. */
export function drBEarned(game: GameState): number {
  return (game.records.earnedRoster >>> DR_B) & 1;
}

/** Dr. B earned, if he is not yet. */
export function earnDrB(game: GameState): void {
  if (drBEarned(game) === 0) earn(game, DR_B);
}

/** Tekken Force's best score set, the records marked to be saved. */
export function setForceBest(game: GameState, scenes: SceneTables, score: number): void {
  game.records.forceBest = score >>> 0;
  recordsChanged(game, scenes);
}

/** A key toward Dr. B added (at most 255), the records marked to be saved. */
export function addForceKey(game: GameState, scenes: SceneTables): void {
  game.records.forceKeys = Math.min(game.records.forceKeys + 1, 0xff);
  recordsChanged(game, scenes);
}

/** Tekken Ball or the Theater earned (shown once more), the plays' count restarted when it is new. */
export function earnMode(game: GameState, mode: 'ball' | 'theater'): void {
  if (game.earned[mode] !== 0) return;
  game.earned[mode] = 1;
  game.records.playsSince = 0;
}

/** How many attract intros the cycle offers: 2 with Dr. B earned, 1 with fifteen characters, else 0. */
function updateIntros(game: GameState): void {
  const earned = game.records.earnedRoster;
  game.attract.intros = (earned & 0x80000) !== 0 ? 2 : 15 <= popcount(earned) ? 1 : 0;
}

/** The first `steps` (at most 14) of the unlock schedule applied. */
export function applySchedule(game: GameState, scenes: SceneTables, steps: number): void {
  if (!(steps >>> 0 < 15)) steps = MOST_STEPS;
  for (let k = 0; k < steps; k += 1) {
    const [kind, value] = scenes.schedule[k]!;
    switch (kind) {
      case Step.NOTHING:
        game.records.playsSince = 0;
        break;
      case Step.CHARACTER:
        earn(game, value);
        break;
      case Step.COSTUME:
        giveCostume(game, (1 << value) >>> 0);
        break;
      case Step.THEATER:
        if ((game.records.endings[0]! & 0x3ff) === 0x3ff) earnMode(game, 'theater');
        break;
      case Step.BALL:
        earnMode(game, 'ball');
        break;
      case Step.EVERYTHING:
        for (let roster = 0; roster < ROWS; roster += 1) {
          if (((EVERYONE >> roster) & 1) !== 0) earn(game, roster);
          if (((COSTUME_MASK >> roster) & 1) !== 0) giveCostume(game, (1 << roster) >>> 0);
        }
        earnMode(game, 'ball');
        earnMode(game, 'theater');
        updateIntros(game);
        break;
    }
  }
  if ((game.records.endings[0]! & 0x3ff) === 0x3ff) earnMode(game, 'theater');
  updateIntros(game);
}

/** What plays give: costumes for characters played often, the intros, and the schedule's next step once enough plays have come. */
function checkUnlocks(game: GameState, scenes: SceneTables): void {
  if (50 <= playCount(game, 9)) giveCostume(game, 0x200);
  if (50 <= playCount(game, 7)) giveCostume(game, 0x80);
  if (25 <= playCount(game, 0x12)) giveCostume(game, 0x40000);
  if (10 <= playCount(game, 0x10)) giveCostume(game, 0x10000);
  updateIntros(game);
  const records = game.records;
  const needed = records.scheduleStarted !== 0 ? 50 : 100;
  if (records.playsSince < needed) return;
  records.scheduleStarted = 1;
  let step = records.scheduleStep + 1;
  records.playsSince = 0;
  if (!(step < 15)) step = MOST_STEPS;
  records.scheduleStep = step;
  applySchedule(game, scenes, step);
}

/** Beating the hidden character met in Arcade earns him. */
export function earnOnDefeat(game: GameState, roster: number): void {
  const records = game.records;
  if (roster !== HIDDEN || (records.earnedRoster & 0x20000) !== 0) return;
  if (game.world.mode !== MenuMode.ARCADE && game.world.mode !== MenuMode.TEKKEN_BALL) return;
  records.newest = roster;
  records.playsSince = 0;
  records.earnedRoster = (records.earnedRoster | 0x20000) >>> 0;
}

/** An Arcade ending seen, by costume for the characters that have two; the schedule moved to the endings' count. */
export function recordEnding(game: GameState, scenes: SceneTables, roster: number, costume: number): void {
  if (game.world.mode !== MenuMode.ARCADE) return;
  const records = game.records;
  const endings = records.endings;
  records.newest = NONE;
  if (roster === 0xb) endings[costume === 1 ? 1 : 0] = (endings[costume === 1 ? 1 : 0]! | 0x800) >>> 0;
  else if (roster === 8) endings[costume < 2 ? 0 : 1] = (endings[costume < 2 ? 0 : 1]! | 0x100) >>> 0;
  else if (roster === 0x10) {
    if ((endings[0]! & 0x10000) === 0) endings[0] = (endings[0]! | 0x10000) >>> 0;
    else endings[1] = (endings[1]! | 0x10000) >>> 0;
  } else endings[0] = (endings[0]! | (1 << (roster & 0x1f))) >>> 0;
  const seen = popcount((endings[0]! | endings[1]!) & EVERYONE);
  endings[0] = endings[0]! & EVERYONE;
  endings[1] = endings[1]! & EVERYONE;
  let steps = 0;
  for (let bit = 0; bit < seen; bit += 1) if ((scenes.endingSteps & (1 << bit)) !== 0) steps += 1;
  applySchedule(game, scenes, steps);
}

/** One of Arcade's stage times kept, with who cleared it. */
export function recordStageTime(game: GameState, stage: number, roster: number, costume: number, side: number, frames: number): void {
  Object.assign(game.run.stageTimes[stage]!, { side, roster, costume, frames });
}

/** The side that won last, the other side the newcomer's, the streak restarted. */
export function setStreakSide(game: GameState, side: number): void {
  game.world.match.streakSide = side;
  game.run.newcomer = (side + 1) & 1;
  game.world.match.streak = 0;
}

/** A side's win added to the streak, or a new streak for a new winner. */
export function addStreakWin(game: GameState, side: number): void {
  const match = game.world.match;
  if (side === match.streakSide) {
    match.streak = (match.streak + 1) & 0xffff;
    return;
  }
  match.streakSide = side;
  game.run.newcomer = (side + 1) & 1;
  match.streak = 1;
}

/** Pairs of a key and a value sorted by value, largest first unless `ascending`, equal values kept in order. */
export function sortPairs(pairs: [number, number][], ascending: boolean): void {
  for (let i = 0; i < pairs.length - 1; i += 1) {
    for (let j = i; 0 <= j; j -= 1) {
      const [here, next] = [pairs[j]!, pairs[j + 1]!];
      if (!(ascending ? next[1] < here[1] : here[1] < next[1])) break;
      [pairs[j], pairs[j + 1]] = [next, here];
    }
  }
}

/** What waits for its name: a best time, survival's record (bits). */
export const Naming = { TIME: 1, SURVIVAL: 2 } as const;
/** The rankings the records screen shows for each. */
const TIMES_RANKING = 0;
const SURVIVORS_RANKING = 1;

/**
 * As Time Attack's run ends: the times ranking shown next; when one side cleared all ten stages
 * with one character and their total beats that character's best, it is the new best, its
 * initials blank and its name waiting.
 */
export function checkTimeRecord(game: GameState, scenes: SceneTables): void {
  const records = game.records;
  records.list = TIMES_RANKING;
  const stages = game.run.stageTimes;
  const last = stages[stages.length - 1]!;
  let total = 0;
  for (const stage of stages) {
    if (stage.side !== last.side || stage.roster !== last.roster) return;
    total = (total + stage.frames) >>> 0;
  }
  const record = records.times[last.roster]!;
  if (!(total < record.frames >>> 0)) return;
  records.naming |= Naming.TIME;
  records.timeSet = last.roster;
  records.holder.roster = last.roster & 0xff;
  records.holder.side = last.side & 0xff;
  record.frames = total;
  record.initials = scenes.records.naming.fresh;
}

/**
 * As a survival run ends with `wins` for `side` playing `roster`: the survivors' ranking shown
 * next; when the wins beat one of the ten, the record goes in among them (after any with as
 * many), the last falls off, its initials blank and its name waiting. Returns 1 when it went in.
 */
export function checkSurvivalRecord(game: GameState, scenes: SceneTables, side: number, roster: number, wins: number): number {
  const records = game.records;
  records.list = SURVIVORS_RANKING;
  if (!records.survivors.some((record) => record.wins < wins)) return 0;
  records.holder.roster = roster & 0xff;
  records.holder.side = side & 0xff;
  const ranked = [...records.survivors.map((record) => ({ ...record })), { roster: roster & 0xffff, wins: wins & 0xffff, initials: scenes.records.naming.fresh }];
  const pairs = ranked.map((record, i): [number, number] => [i, i < records.survivors.length ? record.wins : wins]);
  sortPairs(pairs, false);
  for (let k = 0; k < records.survivors.length; k += 1) {
    const [from] = pairs[k]!;
    if (from === records.survivors.length) records.survivorSet = k;
    Object.assign(records.survivors[k]!, ranked[from]!);
  }
  records.naming |= Naming.SURVIVAL;
  return 1;
}
