/**
 * The results after a run, on their own screens before the records. Time Attack's (scene 0xd):
 * "TIME ATTACK CLEAR!", then each of the ten stages' times counted up in turn beside its
 * opponent, then the run's total with the runner's character, "NEW RECORD" when it is one, and
 * the runner's own line (or a cheer) with the announcer after it; any button of the runner's hides
 * and shows the total, start skips to the end, and after a while it fades out to the records.
 * Survival's (scene 0xe): "SURVIVAL RESULTS", each character beaten (the most beaten first) with
 * its count counted up, then the total wins and the run's place among the records ("YOU NEED
 * MORE PRACTICE!" with none), and the runner's line when it has a place. Team Battle's (scene
 * 0xc): "TEAM BATTLE RESULTS", each team's row of members under its player's label, each bout in
 * turn (a line from the one member to the other, both crossed out as beaten, and its line in the
 * list below), then the outcome; start on either pad goes back to fight again (that pad's player
 * in), select alone shows them again. Tekken Force's (scene 0xf): "TEKKEN FORCE", the run's score,
 * the best (and "NEW RECORD!!"), then what the run brought: Dr. B saved, or the keys held ("TO BE
 * CONTINUED..."), or with Dr. B already earned the four bosses beaten and the soldiers beaten
 * counted up; start on the human's pad ends it, and after a while it fades out to the records.
 */
import { fighterLine } from '../fight/hud.ts';
import type { SceneTables } from '../data/scenes.ts';
import type { FightTables } from '../fight/match.ts';
import type { FightData } from '../fight/state.ts';
import { voiceSounding } from '../fight/voice-timing.ts';
import { keyOffVoices, musicAfterWin, playSong, voiceLine } from '../fight/voices.ts';
import { softReset } from './fight-scene.ts';
import { print } from './printer.ts';
import { setStreakSide, sortPairs } from './records.ts';
import { lookOf } from './select.ts';
import { Scene, type GameState } from './state.ts';
import { fade } from './title.ts';

/** What the results read: the tables, and the last match's data (its sounds, for its line's length). */
export interface ResultsData {
  readonly tables: FightTables;
  readonly match: FightData | null;
}

const START = 0x800;
const BUTTONS = 0xf0;
/** The results' song, the sounds of a row counted and of the runner's cheer, and the announcer's line after the runner's own. */
const SONG = 6;
const ROW_SOUND = 0x55f5;
const CHEER = 0x86ca;
const AFTER_LINE = 0x86da;
/** The voice the runner's line plays on, and the frames the announcer waits after it. */
const LINE_VOICE = 1;
const LINE_WAIT = 0xf;
/** The fade's table entry, its rise in and fall out a field. */
const FADE = { layer: 7, in: 8, out: 4, clear: 0x100 } as const;
/** How long the results show before they go on by themselves. */
const SHOWN_FRAMES = 0x1248;
/** The longest time shown (99'59"99). */
const LONGEST = 359999;

/** Time Attack's results' states. */
const TimeStep = { SET_UP: 0, FADE_IN: 1, COUNT: 2, PAUSE: 3, TOTAL: 4, TOTAL_WAIT: 5, SHOWN: 6, END: 7, FADE_OUT: 8, DONE: 9 } as const;
/** A stage's row counts up over 16 fields, then waits 6; the total waits 30 before the line. */
const COUNT_FIELDS = 0x10;
const ROW_PAUSE = 6;
const TOTAL_WAIT = 0x1e;
const STAGES = 10;

/** The attract cycle moved on a step past the records' (3), as a run's end does. */
function attractPastRecords(game: GameState): void {
  do {
    const step = game.attract.step + 1;
    game.attract.step = 3 < step ? 0 : step;
  } while (game.attract.step === 3);
}

/** The announcer's line after the runner's own: readied, then once that line is over and a wait has passed, said. */
function stepLineAfter(game: GameState, data: ResultsData): void {
  const r = game.results;
  if (r.line === 1) r.line = 2;
  else if (r.line === 2) {
    if (data.match === null || !voiceSounding(game.world, data.match, LINE_VOICE)) r.line = 3;
  } else if (r.line === 3) {
    r.lineWait = (r.lineWait - 1) & 0xff;
    if (0 < ((r.lineWait << 24) >> 24)) return;
    voiceLine(game.world, data.tables, 0, AFTER_LINE, 0);
    r.line = 0;
  }
}

/** The runner's own line, the announcer's to follow; a cheer for a character with none. */
function runnersLine(game: GameState, data: ResultsData): void {
  const r = game.results;
  if (fighterLine(game.world, data.tables, r.side) === 0) r.line = 1;
  else voiceLine(game.world, data.tables, r.side, CHEER, 0);
}

/** A time as minutes, seconds and hundredths, at most 99'59"99. */
export function timeParts(frames: number): [number, number, number] {
  const t = Math.min(frames, LONGEST);
  return [Math.trunc(Math.trunc(t / 60) / 60), Math.trunc(t / 60) % 60, Math.trunc(((t % 60) * 100) / 60)];
}
const two = (n: number): string => String(n).padStart(2, '0');

/** A stage's row: its number, its time's marks and digits (the picture of its opponent and its band are drawn with it). */
function printStageRow(game: GameState, stage: number, frames: number, x: number, y: number): void {
  print(game, 0, 6, x + 0x22, y + 0x10, `STAGE ${stage + 1}`);
  print(game, 1, 6, x + 0x39, y + 0x20, "'");
  print(game, 1, 6, x + 0x5c, y + 0x20, '"');
  const [m, s, h] = timeParts(frames);
  print(game, 1, 6, x + 0x22, y + 0x24, two(m));
  print(game, 1, 6, x + 0x42, y + 0x24, two(s));
  print(game, 1, 6, x + 0x66, y + 0x24, two(h));
}

/** The run's total, and "NEW RECORD" blinking under it when it is one. */
function printTotal(game: GameState): void {
  const r = game.results;
  if (r.showTotal === 0) return;
  print(game, 1, 2, 0x25, 0x160, 'YOUR TIME');
  for (const x of [0x80, 0xbd, 200]) print(game, 2, 7, x, 0x17c, "'");
  const [m, s, h] = timeParts(r.total);
  print(game, 2, 7, 0x5e, 0x17c, two(m));
  print(game, 2, 7, 0x97, 0x17c, two(s));
  print(game, 2, 7, 0xd7, 0x17c, two(h));
  if (r.wait === 0 && r.newRecord !== 0) print(game, 1, (game.world.vsyncSeen & 3) !== 0 ? 5 : 6, 0x62, 0x1a8, 'NEW RECORD');
}

/** The time a stage's row shows: the stage's, or the one being counted up so far. */
export function rowTime(game: GameState, stage: number): number {
  const frames = game.run.stageTimes[stage]!.frames;
  return stage < game.results.shown ? frames : (frames * game.results.counting) >> 4;
}

/** Scene 0xd. */
export function timeResultsScene(game: GameState, data: ResultsData, scenes: SceneTables): void {
  const r = game.results;
  const world = game.world;
  r.frames += 1;
  if (((world.input.fresh[0]! | world.input.fresh[1]!) & START) !== 0 && TimeStep.COUNT <= game.step && game.step <= TimeStep.SHOWN) game.step = TimeStep.END;
  switch (game.step) {
    case TimeStep.SET_UP:
      attractPastRecords(game);
      playSong(world, SONG, false);
      Object.assign(r, { frames: 0, shown: 0, counting: 0, showTotal: 0, fade: 0, wait: 0 });
      r.total = Math.min(
        game.run.stageTimes.reduce((sum, stage) => sum + stage.frames, 0),
        LONGEST,
      );
      r.newRecord = game.records.naming & 1;
      game.step = TimeStep.FADE_IN;
      r.side = game.run.ending.side;
      r.code = game.run.ending.code;
      r.line = 0;
      r.lineWait = LINE_WAIT;
      keyOffVoices(world, true);
      break;
    case TimeStep.FADE_IN:
      r.fade += FADE.in;
      if (r.fade < FADE.clear) break;
      r.fade = FADE.clear;
      game.step = TimeStep.COUNT;
      break;
    case TimeStep.COUNT:
      r.counting += 1;
      if (COUNT_FIELDS < r.counting) {
        voiceLine(world, data.tables, 0, ROW_SOUND, 0);
        game.count = 0;
        r.counting = 0;
        game.step = TimeStep.PAUSE;
        r.shown += 1;
      }
      break;
    case TimeStep.PAUSE:
      game.count += 1;
      if (game.count < ROW_PAUSE) break;
      game.step = STAGES - 1 < r.shown ? TimeStep.TOTAL : TimeStep.COUNT;
      break;
    case TimeStep.TOTAL:
    case TimeStep.TOTAL_WAIT:
      if (game.step === TimeStep.TOTAL) {
        r.showTotal = 1;
        r.wait = TOTAL_WAIT;
        game.step = TimeStep.TOTAL_WAIT;
      }
      r.wait -= 1;
      if (r.wait < 1) {
        r.wait = 0;
        voiceLine(world, data.tables, 0, ROW_SOUND, 0);
        runnersLine(game, data);
        game.step = TimeStep.SHOWN;
      }
      break;
    case TimeStep.SHOWN:
    case TimeStep.END:
      if (game.step === TimeStep.SHOWN) {
        if ((world.input.fresh[r.side]! & BUTTONS) !== 0) r.showTotal = (r.showTotal + 1) & 1;
        if (r.frames < SHOWN_FRAMES) break;
      }
      r.showTotal = 0;
      r.fade = FADE.clear;
      game.step = TimeStep.FADE_OUT;
      break;
    case TimeStep.FADE_OUT:
      r.fade -= FADE.out;
      if (r.fade < 1) {
        r.fade = 0;
        game.step = TimeStep.DONE;
      }
      break;
    case TimeStep.DONE:
      game.scene = Scene.RECORDS_LOADER;
      game.step = 0;
  }
  stepLineAfter(game, data);
  fade(game, FADE.layer, r.fade);
  print(game, 1, 6, 0x43, 0x20, 'TIME ATTACK CLEAR!');
  printTotal(game);
  const rows = r.counting !== 0 ? r.shown + 1 : r.shown;
  for (let stage = 0; stage < Math.min(rows, STAGES); stage += 1) {
    const { x, y } = scenes.results.stages[stage]!;
    printStageRow(game, stage, rowTime(game, stage), x, y);
  }
}

/** Survival's results' states. */
const SurvivalStep = { SET_UP: 0, FADE_IN: 1, NEXT: 2, COUNT: 3, ALL: 4, TOTAL: 5, TOTAL_WAIT: 6, SHOWN: 7, END: 8, FADE_OUT: 9, DONE: 10 } as const;
/** A count's step every four fields; the total shows (its value 2) after thirty; the music faded as they end. */
const COUNT_STEP = 4;
const TOTAL_SHOWS = 2;
const END_VOLUME = 0x3c;
const CHOOSE_SOUND = 0x50f4;
const CHARACTERS = 22;
/** The total's place, and the rank's line's; a count's digits past its icon. */
const TOTAL = { x: 0x78, y: 0x160, label: { x: 0x54, y: 0x148 } } as const;
const RANK = { x: 99, y: 400, colour: 6 } as const;
/** The backdrop's scrolls' periods, and the screen's width they run across. */
const STRIP_PERIOD = 0x180;
const LINE_PERIOD = 0x344;
const SCREEN_WIDTH = 0x170;

/** Survival's total wins and "WIN" or "WINS", from (x, y). */
function printWins(game: GameState, wins: number, x: number, y: number): void {
  const shown = Math.min(wins, 99999999);
  const digits = Math.min(String(shown).length, 3);
  print(game, 2, 0, x + 0x1a + (3 - digits) * 22, y, String(shown));
  print(game, 1, 6, x + 0x60, y + 0xe, wins < 2 ? 'WIN' : 'WINS');
}

/** The run's place among the records, blinking: "YOU ARE THE 1ST GREATEST SURVIVOR!", or "YOU NEED MORE PRACTICE!" with none. */
function printRank(game: GameState, scenes: SceneTables, rank: number, y: number): void {
  if (rank === 0) {
    print(game, 1, (game.world.vsyncSeen & 0x10) !== 0 ? 5 : 2, 0x22, y + 0x1a, 'YOU NEED MORE PRACTICE!');
    return;
  }
  const place = Math.min(rank, 99);
  const tens = Math.trunc(place / 10);
  const ordinal = scenes.results.ordinals[Math.min(rank, 4) - 1]!;
  const pen = print(game, 1, 5, 0x56, y, 'YOU ARE THE');
  print(game, 1, (game.world.vsyncSeen & 2) !== 0 ? 6 : 2, pen, y, `${tens === 0 ? ' ' : String(tens)}${place % 10}${ordinal}`);
  print(game, 1, 5, 0x43, y + 0x1c, 'GREATEST SURVIVOR!');
}

/** How many times a character was beaten, as its place shows it. */
export function beatenShown(game: GameState, k: number): number {
  const r = game.results;
  return k < r.shown - 1 ? game.run.survival.beaten[r.beaten[k]!]! : r.counting;
}

/** Scene 0xe. */
export function survivalResultsScene(game: GameState, data: ResultsData, scenes: SceneTables): void {
  const r = game.results;
  const world = game.world;
  const beaten = game.run.survival.beaten;
  r.frames += 1;
  if (((world.input.fresh[0]! | world.input.fresh[1]!) & START) !== 0 && SurvivalStep.NEXT <= game.step && game.step <= SurvivalStep.SHOWN) game.step = SurvivalStep.END;
  switch (game.step) {
    case SurvivalStep.SET_UP: {
      attractPastRecords(game);
      playSong(world, SONG, false);
      keyOffVoices(world, true);
      r.line = 0;
      r.lineWait = LINE_WAIT;
      r.frames = 0;
      r.fade = 0;
      const pairs: [number, number][] = [];
      for (let roster = 0; roster < CHARACTERS; roster += 1) if (beaten[roster] !== 0) pairs.push([roster, beaten[roster]!]);
      sortPairs(pairs, false);
      r.beatenCount = pairs.length;
      pairs.forEach(([roster], k) => (r.beaten[k] = roster));
      game.count = 0;
      r.shown = 0;
      r.showTotal = TOTAL_SHOWS;
      r.wait = TOTAL_WAIT;
      r.total = 0;
      game.step = SurvivalStep.FADE_IN;
      r.side = game.run.ending.side;
      r.code = game.run.ending.code;
      r.rank = world.match.survivalRank;
      break;
    }
    case SurvivalStep.FADE_IN:
      r.fade += FADE.in;
      if (r.fade < FADE.clear) break;
      r.fade = FADE.clear;
      game.step = SurvivalStep.NEXT;
      r.shown = 0;
      r.counting = 0;
      if (r.beatenCount < 1) {
        game.step = SurvivalStep.ALL;
        r.shown = r.beatenCount;
      }
      break;
    case SurvivalStep.NEXT:
    case SurvivalStep.COUNT:
      if (game.step === SurvivalStep.NEXT) {
        r.counting = 1;
        game.count = COUNT_STEP;
        game.step = SurvivalStep.COUNT;
        r.total += 1;
      }
      game.count -= 1;
      if (game.count < 1) {
        voiceLine(world, data.tables, 0, ROW_SOUND, 0);
        if (r.counting < beaten[r.beaten[r.shown]!]!) {
          game.count = COUNT_STEP;
          r.counting += 1;
          r.total += 1;
        } else {
          r.shown += 1;
          game.count = 0;
          if (r.shown < r.beatenCount) game.step = SurvivalStep.NEXT;
          else {
            game.step = SurvivalStep.ALL;
            r.shown = r.beatenCount;
          }
        }
      }
      break;
    case SurvivalStep.ALL:
      game.count = COUNT_STEP;
      game.step = SurvivalStep.TOTAL;
      break;
    case SurvivalStep.TOTAL:
    case SurvivalStep.TOTAL_WAIT:
      if (game.step === SurvivalStep.TOTAL) {
        r.showTotal = TOTAL_SHOWS;
        r.wait = TOTAL_WAIT;
        game.step = SurvivalStep.TOTAL_WAIT;
      }
      r.wait -= 1;
      if (r.wait === 0) {
        voiceLine(world, data.tables, 0, CHOOSE_SOUND, 0);
        if (r.rank !== 0) runnersLine(game, data);
        game.step = SurvivalStep.SHOWN;
      }
      break;
    case SurvivalStep.SHOWN:
    case SurvivalStep.END:
      if (game.step === SurvivalStep.SHOWN && r.frames < SHOWN_FRAMES) break;
      r.showTotal = 0;
      musicAfterWin(world, END_VOLUME);
      r.fade = FADE.clear;
      game.step = SurvivalStep.FADE_OUT;
      break;
    case SurvivalStep.FADE_OUT:
      r.fade -= FADE.out;
      if (r.fade < 1) {
        r.fade = 0;
        game.step = SurvivalStep.DONE;
      }
      break;
    case SurvivalStep.DONE:
      game.scene = Scene.RECORDS_LOADER;
      game.step = 0;
  }
  stepLineAfter(game, data);
  fade(game, FADE.layer, r.fade);
  print(game, 1, 6, 0x52, 0x1c, 'SURVIVAL RESULTS');
  if (1 < r.showTotal) {
    printWins(game, r.total, TOTAL.x, TOTAL.y);
    print(game, 1, 6, TOTAL.label.x, TOTAL.label.y, 'TOTAL');
    if (r.wait === 0) printRank(game, scenes, r.rank, RANK.y);
  }
  /* The backdrop's scrolls: the game's name a pixel a field, the tournament's line two (under everything). */
  r.strip = (r.strip + STRIP_PERIOD - 1) % STRIP_PERIOD;
  r.scroll = (r.scroll + LINE_PERIOD - 2) % LINE_PERIOD;
  for (let x = r.scroll - LINE_PERIOD; x < SCREEN_WIDTH; x += LINE_PERIOD) print(game, 2, 6, x, 0xcb, scenes.vsSelect.tournament, 0);
  /* Each character beaten so far, the last of them showing the count under way. */
  if (r.showTotal === 0) return;
  for (let k = 0; k < r.shown; k += 1) {
    const { x, y } = scenes.results.beaten[k]!;
    const count = beatenShown(game, k);
    print(game, 0, scenes.results.countColours[Math.trunc(count / 100) & 3]!, x + 0x14 + (count % 100 < 10 ? 9 : 0), y + 0x44, String(count % 100));
  }
}

/** Team Battle's results' states. */
const TeamStep = { SET_UP: 0, FADE_IN: 1, BOUT: 2, BOUT_PAUSE: 3, OUTCOME: 4, OUTCOME_WAIT: 5, SHOWN_START: 6, SHOWN: 7, FADE_OUT: 8, DONE: 9, AGAIN: 10 } as const;
/** A bout's line draws over eight fields, then waits two; the results show this long. */
const BOUT_FIELDS = 8;
const BOUT_PAUSE = 2;
const TEAM_SHOWN_FRAMES = 0x707;
const SELECT_ONLY = 0x100;
/** The outcomes: their lines, colours and which way they slide in from (1 the right). */
const OUTCOMES = [
  { text: 'YOU WIN!', colour: 7 },
  { text: 'YOU LOSE!', colour: 3 },
  { text: 'DRAW GAME', colour: 6 },
  { text: 'PLAYER-1 WINS!', colour: 7 },
  { text: 'PLAYER-2 WINS!', colour: 7 },
] as const;
/** The players' labels: each side's by who plays it (a human, the computer), and their places. */
const TEAM_LABELS = [
  [
    { text: 'PLAYER 1', x: 0x14 },
    { text: 'CPU', x: 0x14 },
  ],
  [
    { text: 'PLAYER 2', x: 0xf4 },
    { text: 'CPU', x: 0x13e },
  ],
] as const;
const TEAM_LABEL_Y = [0x4c, 0x104] as const;

/** How far down the second team and the bouts' list sit: more bouts, higher. */
export const teamsDrop = (game: GameState): number => {
  const [a, b] = game.world.match.teams;
  return (5 - Math.trunc((a!.size + b!.size + 1) / 3)) * 0x1e;
};

/** Which outcome the results show, and which way it slides in from. */
export function teamOutcome(game: GameState): { outcome: number; from: number } {
  const match = game.world.match;
  const [a, b] = game.results.left;
  if (match.humanCount === 1) {
    if (a === b) return { outcome: 2, from: match.humanSide === 0 ? -1 : 1 };
    return { outcome: game.results.left[match.computerSide]! < game.results.left[match.humanSide]! ? 0 : 1, from: match.humanSide === 0 ? -1 : 1 };
  }
  if (a === b) return { outcome: 2, from: -1 };
  return b! < a! ? { outcome: 3, from: -1 } : { outcome: 4, from: 1 };
}

/** Scene 0xc. */
export function teamResultsScene(game: GameState, data: ResultsData, scenes: SceneTables): void {
  const r = game.results;
  const world = game.world;
  const team = game.run.team;
  if (softReset(game, data.tables)) return;
  if (TeamStep.FADE_IN < game.step) {
    for (const pad of [0, 1]) {
      if ((world.input.fresh[pad]! & START) === 0) continue;
      world.joined[pad] = 1;
      setStreakSide(game, pad);
      game.step = TeamStep.AGAIN;
    }
  }
  switch (game.step) {
    case TeamStep.SET_UP: {
      playSong(world, SONG, false);
      keyOffVoices(world, true);
      const next = [0, 0];
      for (let bout = 0; bout < team.bout; bout += 1) {
        r.boutMembers[0]![bout] = next[0]!;
        r.boutMembers[1]![bout] = next[1]!;
        const winner = team.bouts[bout];
        if (winner === 2 || winner === 3) next[0]! += 1;
        if (winner === 1 || winner === 3) next[1]! += 1;
      }
      r.shown = 0;
      r.fade = 0;
      r.beatenSoFar.fill(0);
      r.counting = 0;
      r.showTotal = 0;
      r.wait = 0;
      game.step = TeamStep.FADE_IN;
      r.left[0] = world.match.teams[0]!.size;
      r.left[1] = world.match.teams[1]!.size;
      break;
    }
    case TeamStep.FADE_IN:
      r.fade += FADE.in;
      if (r.fade < FADE.clear) break;
      r.fade = FADE.clear;
      game.step = TeamStep.BOUT;
      break;
    case TeamStep.BOUT: {
      r.counting += 1;
      if (r.counting < BOUT_FIELDS + 1) break;
      r.counting = BOUT_FIELDS;
      const winner = team.bouts[r.shown];
      if (winner === 1 || winner === 3) {
        r.beatenSoFar[1]! += 1;
        r.left[1]! -= 1;
      }
      if (winner === 2 || winner === 3) {
        r.beatenSoFar[0]! += 1;
        r.left[0]! -= 1;
      }
      game.count = 0;
      game.step = TeamStep.BOUT_PAUSE;
      break;
    }
    case TeamStep.BOUT_PAUSE:
      game.count += 1;
      if (game.count < BOUT_PAUSE) break;
      voiceLine(world, data.tables, 0, ROW_SOUND, 0);
      r.counting = 0;
      r.shown += 1;
      game.step = team.bout <= r.shown ? TeamStep.OUTCOME : TeamStep.BOUT;
      break;
    case TeamStep.OUTCOME:
    case TeamStep.OUTCOME_WAIT:
      if (game.step === TeamStep.OUTCOME) {
        r.showTotal = 1;
        r.wait = TOTAL_WAIT;
        game.step = TeamStep.OUTCOME_WAIT;
      }
      r.wait -= 1;
      if (r.wait < 1) {
        r.wait = 0;
        voiceLine(world, data.tables, 0, CHOOSE_SOUND, 0);
        game.step = TeamStep.SHOWN_START;
      }
      break;
    case TeamStep.SHOWN_START:
    case TeamStep.SHOWN: {
      if (game.step === TeamStep.SHOWN_START) {
        game.count = 0;
        game.step = TeamStep.SHOWN;
      }
      const pressed = world.input.fresh[0]! | world.input.fresh[1]!;
      if (pressed === SELECT_ONLY) {
        game.step = TeamStep.SET_UP;
        break;
      }
      if ((pressed & BUTTONS) !== 0) r.showTotal = (r.showTotal + 1) & 1;
      game.count += 1;
      if (TEAM_SHOWN_FRAMES < game.count) {
        r.showTotal = 0;
        r.fade = FADE.clear;
        game.step = TeamStep.FADE_OUT;
      }
      break;
    }
    case TeamStep.FADE_OUT:
      r.fade -= FADE.out;
      if (r.fade < 1) {
        r.fade = 0;
        game.step = TeamStep.DONE;
      }
      break;
    case TeamStep.DONE:
      game.scene = Scene.RECORDS_LOADER;
      game.step = 0;
      break;
    case TeamStep.AGAIN:
      game.scene = Scene.FIGHT;
      game.step = 0;
      break;
  }
  fade(game, FADE.layer, r.fade);
  print(game, 1, 6, 0x3f, 0x1c, 'TEAM BATTLE RESULTS');
  printOutcome(game);
  printTeamLabels(game);
  printBouts(game);
  r.strip = (r.strip + STRIP_PERIOD - 1) % STRIP_PERIOD;
  r.scroll = (r.scroll + LINE_PERIOD - 2) % LINE_PERIOD;
  for (let x = r.scroll - LINE_PERIOD; x < SCREEN_WIDTH; x += LINE_PERIOD) print(game, 2, 6, x, 0xcb, scenes.vsSelect.tournament, 0);
}

/** The outcome, sliding in, once the bouts are all shown. */
function printOutcome(game: GameState): void {
  const r = game.results;
  if (r.showTotal === 0) return;
  const { outcome, from } = teamOutcome(game);
  const { text, colour } = OUTCOMES[outcome]!;
  let x = r.wait === 0 ? 0xb8 : Math.trunc((r.wait * SCREEN_WIDTH) / TOTAL_WAIT) * from + 0xb8;
  x -= (text.length * 22) >> 1;
  print(game, 2, colour, x, Math.trunc(teamsDrop(game) / 2) + 0x9e, text);
}

/** Each team's label: its player's (a human's, or the computer's). */
function printTeamLabels(game: GameState): void {
  const match = game.world.match;
  for (const side of [0, 1]) {
    const label = TEAM_LABELS[side]![match.humanCount === 1 && side === match.computerSide ? 1 : 0]!;
    print(game, 1, 6, label.x, TEAM_LABEL_Y[side]! + (side === 1 ? teamsDrop(game) : 0), label.text);
  }
}

/** The bouts' list: each bout shown so far by its number, the rest's numbers dimmed. */
function printBouts(game: GameState): void {
  const r = game.results;
  const team = game.run.team;
  const total = game.world.match.teams[0]!.size + game.world.match.teams[1]!.size - 1;
  const shown = Math.min(r.shown, team.bout);
  for (let bout = 0; bout < Math.max(shown, total); bout += 1) {
    const x = (bout % 3) * 0x60;
    const y = Math.trunc(bout / 3) * 0x1e + teamsDrop(game) + 0x132;
    print(game, 0, bout < shown ? 6 : 0x1a, x + 0x2c, y, `${String(bout + 1).padStart(2, ' ')}.  VS`);
  }
}

/** Tekken Force's results' states. */
export const ForceStep = { SET_UP: 0, FADE_IN: 1, SHOWN: 2, END: 3, FADE_OUT: 4, DONE: 5 } as const;
/** The sound of a line shown, and of Dr. B saved. */
const SCORE_SOUND = 0x4c6c;
/** The fields shown at which each line comes: the score, the best, then what the run brought. */
const FORCE_SHOWS = { score: 0x1e, best: 0x3c, brought: 0x5a } as const;
/** The keys' lines: the flag, the fields shown it waits for, its colour, its line, its name. */
const KEY_LINES = [
  { flag: 1, from: 0x5a, colour: 2, y: 0x148, text: 'COPPER' },
  { flag: 2, from: 0x78, colour: 6, y: 0x162, text: 'SILVER' },
  { flag: 4, from: 0x96, colour: 5, y: 0x17c, text: 'GOLD' },
] as const;
/** "TO BE CONTINUED..." from these fields shown, blinking off one in four of them. */
const CONTINUED = { from: 0xb4, blink: 0x30 } as const;
/** The bosses' row: a boss more every 0x14 of its count, the FORCE count starting past 0x4f. */
const BOSS_STEP = 0x14;
const COUNT_FROM = 0x4f;
/** The run's flags: the final stage cleared, Dr. B earned before it began. */
const FORCE_FINAL = 8;
const FORCE_DR_B = 0x10;
/** The FORCE count's states. */
const CountState = { WAITING: 0, COUNTING: 1, DONE: 2 } as const;

/** A number right-aligned in `places` glyphs (its lowest digits when longer), as the printer pads it. */
const padded = (value: number, places: number): string => String(value % 10 ** places).padStart(places, ' ');

/** How many of the four bosses Tekken Force's results show (with Dr. B earned before the run). */
export function forceBossesShown(game: GameState): number {
  const bosses = game.results.force.bosses;
  return bosses === 0 ? 0 : Math.min(4, Math.trunc(bosses / BOSS_STEP) + 1);
}

/** Tekken Force's lines: the score, the best, and what the run brought, each with its sound as it first shows. */
function printForce(game: GameState, data: ResultsData): void {
  const r = game.results;
  const force = r.force;
  const run = game.world.match.force;
  const sound = (code: number): void => voiceLine(game.world, data.tables, 0, code, 0);
  const blink = (r.frames & 2) !== 0 ? 6 : 2;
  print(game, 2, 0, 0x34, 0x1c, 'TEKKEN FORCE');
  let y = 0x78;
  if (FORCE_SHOWS.score - 1 < force.shown) {
    print(game, 1, 5, 0x9e, y, 'YOUR SCORE:');
    y = 0xc6;
    print(game, 1, 6, 0xf9, 0x92, padded(run.score, 8));
    if (force.shown === FORCE_SHOWS.score) sound(SCORE_SOUND);
  }
  if (FORCE_SHOWS.best - 1 < force.shown) {
    print(game, 1, 5, 0x9e, y, 'HIGH SCORE:');
    print(game, 1, 6, 0xf9, y + 0x1a, padded(game.records.forceBest, 8));
    y += 0x34;
    if (run.newRecord !== 0) print(game, 1, blink, 0xc5, y, 'NEW RECORD!!');
    if (force.shown === FORCE_SHOWS.best) sound(SCORE_SOUND);
  }
  if (!(FORCE_SHOWS.brought - 1 < force.shown)) return;
  const first = force.shown === FORCE_SHOWS.brought;
  if ((run.flags & FORCE_DR_B) === 0 && (run.flags & FORCE_FINAL) !== 0) {
    const pen = print(game, 1, 8, 0xf, y + 0xb6, 'YOU SAVED ');
    print(game, 1, blink, pen, y + 0xb6, 'DR.BOSKONOVITCH!');
    if (first) sound(CHOOSE_SOUND);
  } else if ((run.flags & FORCE_DR_B) === 0) {
    print(game, 1, 5, 0x9e, y + 0x4e, 'KEYS:');
    for (const key of KEY_LINES) {
      if ((run.flags & key.flag) === 0 || !(key.from - 1 < force.shown)) continue;
      print(game, 1, key.colour, 0xdf, key.y, key.text);
      if (force.shown === key.from) sound(SCORE_SOUND);
    }
    if (CONTINUED.from <= force.shown && (force.shown & CONTINUED.blink) !== 0) print(game, 1, 8, 0x43, 0x1b0, 'TO BE CONTINUED...');
  } else {
    force.bosses += 1;
    print(game, 1, 5, 0x27, 0x162, 'BOSS:');
    if (first || force.bosses === BOSS_STEP || force.bosses === BOSS_STEP * 2 || force.bosses === BOSS_STEP * 3) sound(SCORE_SOUND);
    if (force.countState === CountState.COUNTING) {
      print(game, 1, 5, 0xdf, 0x162, 'FORCE:');
      print(game, 1, 6, 0x12d, 0x17c, padded(force.count, 4));
      if ((force.shown & 1) === 0) {
        force.count += 1;
        sound(ROW_SOUND);
      }
      if (run.kills < force.count || ForceStep.SHOWN < game.step) force.countState = CountState.DONE;
    } else if (force.countState === CountState.WAITING) {
      if (COUNT_FROM < force.bosses) {
        force.countState = CountState.COUNTING;
        force.count = 0;
      }
    } else {
      print(game, 1, 5, 0xdf, 0x162, 'FORCE:');
      print(game, 1, 6, 0x12d, 0x17c, padded(run.kills, 4));
    }
  }
}

/** Scene 0xf. */
export function forceResultsScene(game: GameState, data: ResultsData, scenes: SceneTables): void {
  const r = game.results;
  const force = r.force;
  const world = game.world;
  const side = world.match.force.side & 1;
  r.frames += 1;
  if ((world.input.fresh[side]! & START) !== 0 && game.step === ForceStep.SHOWN) game.step = ForceStep.END;
  switch (game.step) {
    case ForceStep.SET_UP: {
      attractPastRecords(game);
      playSong(world, SONG, false);
      r.frames = 0;
      r.fade = 0;
      const look = lookOf(scenes, game.entrants.roster[side]!, game.entrants.costume[side]!);
      Object.assign(force, { shown: 0, bosses: 0, countState: CountState.WAITING, count: 0, colour: look >>> 8, flipped: ((look & 0xff) >> 5) & 1 });
      r.line = 0;
      r.lineWait = LINE_WAIT;
      keyOffVoices(world, true);
      game.step = ForceStep.FADE_IN;
      break;
    }
    case ForceStep.FADE_IN:
      r.fade += FADE.in;
      if (r.fade < FADE.clear) break;
      r.fade = FADE.clear;
      game.step = ForceStep.SHOWN;
      break;
    case ForceStep.SHOWN:
      if (SHOWN_FRAMES < r.frames) game.step = ForceStep.END;
      break;
    case ForceStep.END:
      musicAfterWin(world, END_VOLUME);
      r.fade = FADE.clear;
      game.step = ForceStep.FADE_OUT;
      break;
    case ForceStep.FADE_OUT:
      r.fade -= FADE.out;
      if (r.fade < 1) {
        r.fade = 0;
        game.step = ForceStep.DONE;
      }
      break;
    case ForceStep.DONE:
      game.scene = Scene.RECORDS_LOADER;
      game.step = 0;
      break;
  }
  if (ForceStep.FADE_IN < game.step) force.shown += 1;
  fade(game, FADE.layer, r.fade);
  printForce(game, data);
}
